use std::io;

use super::{FilePath, GroupId, HistoryPersistence, Route, SessionId};
use crate::connectivity::AgentNamespace;

const ENTRY_LIMIT: usize = 100;

/// One window's bounded, app-owned navigation stack.
///
/// Connectivity never enters this type. An offline agent remains a valid route
/// and is not pruned; only explicit file/session/group lifecycle events forget
/// destinations.
pub struct NavigationHistory {
    entries: Vec<Route>,
    index: usize,
    persistence: Option<HistoryPersistence>,
    persistence_error: Option<String>,
}

impl NavigationHistory {
    pub fn new(initial: Route) -> Self {
        Self {
            entries: vec![initial],
            index: 0,
            persistence: None,
            persistence_error: None,
        }
    }

    pub fn restore(
        persistence: HistoryPersistence,
        resolve_agent: impl Fn(&str) -> Option<AgentNamespace>,
    ) -> io::Result<Self> {
        let restored = persistence.read(&resolve_agent)?;
        let (mut entries, mut index) = restored.unwrap_or_else(|| (vec![Route::Home], 0));
        trim(&mut entries, &mut index);
        Ok(Self {
            entries,
            index,
            persistence: Some(persistence),
            persistence_error: None,
        })
    }

    pub fn current(&self) -> &Route {
        &self.entries[self.index]
    }

    pub fn index(&self) -> usize {
        self.index
    }

    pub fn entries(&self) -> &[Route] {
        &self.entries
    }

    pub fn can_go_back(&self) -> bool {
        self.index > 0
    }

    pub fn can_go_forward(&self) -> bool {
        self.index + 1 < self.entries.len()
    }

    pub fn back(&mut self) -> bool {
        if !self.can_go_back() {
            return false;
        }
        self.index -= 1;
        self.persist();
        true
    }

    pub fn forward(&mut self) -> bool {
        if !self.can_go_forward() {
            return false;
        }
        self.index += 1;
        self.persist();
        true
    }

    pub fn go(&mut self, delta: isize) -> bool {
        let next = self
            .index
            .saturating_add_signed(delta)
            .min(self.entries.len() - 1);
        if next == self.index {
            return false;
        }
        self.index = next;
        self.persist();
        true
    }

    /// Visits a destination. Forward history is abandoned. A revisit removes
    /// its older copy before becoming current, so Back cannot loop between
    /// duplicate tabs. Revisiting a file updates its kind/backing session in
    /// place because file identity is namespace + group + path.
    pub fn push(&mut self, route: Route) {
        if self.current().same_destination(&route) {
            self.entries[self.index] = route;
            self.persist();
            return;
        }

        self.entries.truncate(self.index + 1);
        for at in (0..self.entries.len()).rev() {
            if self.entries[at].same_destination(&route) {
                self.entries.remove(at);
                if at <= self.index {
                    self.index = self.index.saturating_sub(1);
                }
            }
        }
        self.entries.push(route);
        self.index = self.entries.len() - 1;
        trim(&mut self.entries, &mut self.index);
        self.persist();
    }

    pub fn replace(&mut self, route: Route) {
        self.entries[self.index] = route;
        collapse_adjacent(&mut self.entries, &mut self.index);
        self.persist();
    }

    /// Removes all visits to one file tab. If the current file closes, the most
    /// recently visited chat/file in that group wins. With none, the session
    /// behind the file wins, then the group itself.
    pub fn file_forget(
        &mut self,
        agent: &AgentNamespace,
        group: &GroupId,
        path: &FilePath,
    ) -> bool {
        let fallback = match self.current() {
            Route::File {
                agent: own_agent,
                group: own_group,
                session,
                path: own_path,
                ..
            } if own_agent == agent && own_group == group && own_path == path => session
                .as_ref()
                .map(|session| Route::Chat {
                    agent: agent.clone(),
                    group: group.clone(),
                    session: session.clone(),
                })
                .unwrap_or_else(|| Route::Group {
                    agent: agent.clone(),
                    group: group.clone(),
                }),
            _ => Route::Home,
        };
        self.forget(
            |route| {
                matches!(route,
                    Route::File { agent: own_agent, group: own_group, path: own_path, .. }
                    if own_agent == agent && own_group == group && own_path == path
                )
            },
            fallback,
            Some(|route: &Route| {
                matches!(route,
                    Route::Chat { agent: own_agent, group: own_group, .. }
                    | Route::File { agent: own_agent, group: own_group, .. }
                    if own_agent == agent && own_group == group
                )
            }),
        )
    }

    /// Removes an archived session. File tabs survive, but no longer claim the
    /// archived session as their backing surface.
    pub fn session_forget(
        &mut self,
        agent: &AgentNamespace,
        group: &GroupId,
        session: &SessionId,
        fallback_session: Option<&SessionId>,
    ) -> bool {
        let mut files_updated = false;
        for route in &mut self.entries {
            if let Route::File {
                agent: own_agent,
                group: own_group,
                session: own_session,
                ..
            } = route
                && own_agent == agent
                && own_group == group
                && own_session.as_ref() == Some(session)
            {
                *own_session = None;
                files_updated = true;
            }
        }
        let fallback = fallback_session
            .map(|fallback| Route::Chat {
                agent: agent.clone(),
                group: group.clone(),
                session: fallback.clone(),
            })
            .unwrap_or_else(|| Route::Group {
                agent: agent.clone(),
                group: group.clone(),
            });
        let removed = self.forget(
            |route| {
                matches!(route,
                    Route::Chat { agent: own_agent, group: own_group, session: own_session }
                    if own_agent == agent && own_group == group && own_session == session
                )
            },
            fallback,
            Some(|route: &Route| {
                matches!(route,
                    Route::Chat { agent: own_agent, group: own_group, .. }
                    | Route::File { agent: own_agent, group: own_group, .. }
                    if own_agent == agent && own_group == group
                )
            }),
        );
        if files_updated && !removed {
            self.persist();
        }
        removed || files_updated
    }

    /// Removes every group-backed destination. A current removed route moves to
    /// the nearest surviving global entry, or Home when nothing survives.
    pub fn group_forget(&mut self, agent: &AgentNamespace, group: &GroupId) -> bool {
        self.forget(
            |route| route.is_in_group(agent, group),
            Route::Home,
            None::<fn(&Route) -> bool>,
        )
    }

    /// Returns and clears the most recent durable-write error. Navigation stays
    /// usable in memory if the disk refuses a write.
    pub fn take_persistence_error(&mut self) -> Option<String> {
        self.persistence_error.take()
    }

    fn forget<P>(
        &mut self,
        matches: impl Fn(&Route) -> bool,
        fallback: Route,
        preferred: Option<P>,
    ) -> bool
    where
        P: Fn(&Route) -> bool,
    {
        if !self.entries.iter().any(&matches) {
            return false;
        }
        let standing_removed = matches(self.current());
        let old_index = self.index;
        let old_entries = std::mem::take(&mut self.entries);
        let mut kept = Vec::with_capacity(old_entries.len());
        let mut kept_index = None;

        for (at, route) in old_entries.into_iter().enumerate() {
            if matches(&route) {
                continue;
            }
            if kept
                .last()
                .is_some_and(|previous: &Route| previous.same_destination(&route))
            {
                if at <= old_index {
                    kept_index = Some(kept.len() - 1);
                }
                continue;
            }
            kept.push(route);
            if at <= old_index {
                kept_index = Some(kept.len() - 1);
            }
        }
        self.entries = kept;
        self.index = kept_index.unwrap_or(0);

        if standing_removed && let Some(preferred) = preferred.as_ref() {
            if let Some(at) = self.entries.iter().rposition(preferred) {
                self.index = at;
                self.persist();
                return true;
            }
            self.push_fallback(fallback);
            self.persist();
            return true;
        }

        if self.entries.is_empty() {
            self.push_fallback(fallback);
        }
        self.persist();
        true
    }

    fn push_fallback(&mut self, fallback: Route) {
        self.entries
            .retain(|route| !route.same_destination(&fallback));
        self.entries.push(fallback);
        self.index = self.entries.len() - 1;
        trim(&mut self.entries, &mut self.index);
    }

    fn persist(&mut self) {
        let Some(persistence) = &self.persistence else {
            return;
        };
        if let Err(error) = persistence.write(&self.entries, self.index) {
            self.persistence_error = Some(error.to_string());
        } else {
            self.persistence_error = None;
        }
    }
}

fn trim(entries: &mut Vec<Route>, index: &mut usize) {
    if entries.len() <= ENTRY_LIMIT {
        *index = (*index).min(entries.len() - 1);
        return;
    }
    let from = (entries.len() - ENTRY_LIMIT).min(*index);
    let end = (from + ENTRY_LIMIT).min(entries.len());
    entries.drain(end..);
    entries.drain(..from);
    *index -= from;
}

fn collapse_adjacent(entries: &mut Vec<Route>, index: &mut usize) {
    let mut at = 1;
    while at < entries.len() {
        if entries[at - 1].same_destination(&entries[at]) {
            entries.remove(at - 1);
            *index = index.saturating_sub(1);
        } else {
            at += 1;
        }
    }
}
