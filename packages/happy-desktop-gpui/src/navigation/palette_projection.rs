//! Pure command-palette projection over one immutable catalog snapshot.

use std::sync::Arc;

use crate::connectivity::{AgentCatalogSnapshot, AgentNamespace};

use super::{GroupId, Route, SessionId, SettingsSection};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PaletteSection {
    Suggestions,
    Chats,
    Workspaces,
    Tabs,
    Actions,
    Settings,
}

impl PaletteSection {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Suggestions => "Suggestions",
            Self::Chats => "Chats",
            Self::Workspaces => "Workspaces",
            Self::Tabs => "Tabs",
            Self::Actions => "Actions",
            Self::Settings => "Settings",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaletteCommand {
    Navigate(Route),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaletteMatch {
    pub stable_id: Arc<str>,
    pub section: PaletteSection,
    pub title: Arc<str>,
    pub detail: Option<Arc<str>>,
    pub command: PaletteCommand,
}

pub fn palette_matches(
    catalog: &AgentCatalogSnapshot,
    agent: &AgentNamespace,
    current: &Route,
    query: &str,
) -> Vec<PaletteMatch> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        let current_group = route_group(current, agent);
        let mut conversations: Vec<_> = catalog
            .active_conversations
            .iter()
            .filter(|row| current_group == Some(row.workspace_key.id()))
            .cloned()
            .collect();
        conversations.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.key.cmp(&right.key))
        });
        let mut result: Vec<_> = conversations
            .into_iter()
            .take(5)
            .map(|row| PaletteMatch {
                stable_id: format!("chat:{}", row.key.id()).into(),
                section: PaletteSection::Suggestions,
                title: row.label.clone().unwrap_or_else(|| Arc::from("New chat")),
                detail: catalog
                    .workspace(&row.workspace_key)
                    .map(|workspace| workspace.label.clone()),
                command: PaletteCommand::Navigate(Route::Chat {
                    agent: agent.clone(),
                    group: opaque_group(row.workspace_key.id()),
                    session: opaque_session(row.key.id()),
                }),
            })
            .collect();
        result.push(PaletteMatch {
            stable_id: "action:new-chat".into(),
            section: PaletteSection::Suggestions,
            title: "New chat".into(),
            detail: Some("Create a conversation".into()),
            command: PaletteCommand::Navigate(Route::Create {
                agent: agent.clone(),
            }),
        });
        result.push(PaletteMatch {
            stable_id: "settings:general".into(),
            section: PaletteSection::Suggestions,
            title: "Open settings".into(),
            detail: Some("General".into()),
            command: PaletteCommand::Navigate(Route::SettingsSection {
                section: SettingsSection::General,
            }),
        });
        return result;
    }

    let mut result = Vec::new();
    let mut chats: Vec<_> = catalog
        .active_conversations
        .iter()
        .filter_map(|row| {
            let title = row.label.clone().unwrap_or_else(|| Arc::from("New chat"));
            let workspace = catalog.workspace(&row.workspace_key)?;
            let score = rank(&query, &title, Some(&workspace.label))?;
            Some((
                score,
                row.updated_at,
                row.key.clone(),
                title,
                workspace.label.clone(),
            ))
        })
        .collect();
    chats.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    result.extend(
        chats
            .into_iter()
            .take(6)
            .map(|(_, _, key, title, workspace)| {
                let row = catalog
                    .conversation(&key)
                    .expect("projected conversation key");
                PaletteMatch {
                    stable_id: format!("chat:{}", key.id()).into(),
                    section: PaletteSection::Chats,
                    title,
                    detail: Some(workspace),
                    command: PaletteCommand::Navigate(Route::Chat {
                        agent: agent.clone(),
                        group: opaque_group(row.workspace_key.id()),
                        session: opaque_session(key.id()),
                    }),
                }
            }),
    );

    let mut workspaces: Vec<_> = catalog
        .active_projects
        .iter()
        .map(|row| {
            (
                rank(&query, &row.label, Some(&row.location)),
                row.order_key.clone(),
                row.key.id().to_owned(),
                row.label.clone(),
                row.location.clone(),
            )
        })
        .chain(
            catalog
                .active_workspaces
                .iter()
                .filter(|row| {
                    row.key.id() != row.project_key.as_ref().map(|key| key.id()).unwrap_or("")
                })
                .map(|row| {
                    (
                        rank(&query, &row.label, Some(&row.location)),
                        row.order_key.clone(),
                        row.key.id().to_owned(),
                        row.label.clone(),
                        row.location.clone(),
                    )
                }),
        )
        .filter_map(|(score, order, id, title, detail)| Some((score?, order, id, title, detail)))
        .collect();
    workspaces
        .sort_by(|left, right| (&left.0, &left.1, &left.2).cmp(&(&right.0, &right.1, &right.2)));
    result.extend(
        workspaces
            .into_iter()
            .take(6)
            .map(|(_, _, id, title, detail)| PaletteMatch {
                stable_id: format!("workspace:{id}").into(),
                section: PaletteSection::Workspaces,
                title,
                detail: Some(detail),
                command: PaletteCommand::Navigate(Route::Group {
                    agent: agent.clone(),
                    group: opaque_group(&id),
                }),
            }),
    );

    let action_title: Arc<str> = "New chat".into();
    if rank(&query, &action_title, Some("create conversation")).is_some() {
        result.push(PaletteMatch {
            stable_id: "action:new-chat".into(),
            section: PaletteSection::Actions,
            title: action_title,
            detail: Some("Create a conversation".into()),
            command: PaletteCommand::Navigate(Route::Create {
                agent: agent.clone(),
            }),
        });
    }
    let mut settings: Vec<_> = SettingsSection::ALL
        .into_iter()
        .filter_map(|section| {
            let title: Arc<str> = settings_label(section).into();
            Some((rank(&query, &title, None)?, section))
        })
        .collect();
    settings.sort_by_key(|(score, section)| (*score, section.as_str()));
    result.extend(
        settings
            .into_iter()
            .take(6)
            .map(|(_, section)| settings_match(PaletteSection::Settings, section)),
    );

    result
}

fn settings_match(section: PaletteSection, destination: SettingsSection) -> PaletteMatch {
    PaletteMatch {
        stable_id: format!("settings:{}", destination.as_str()).into(),
        section,
        title: settings_label(destination).into(),
        detail: Some("Settings".into()),
        command: PaletteCommand::Navigate(Route::SettingsSection {
            section: destination,
        }),
    }
}

fn settings_label(section: SettingsSection) -> &'static str {
    match section {
        SettingsSection::General => "General",
        SettingsSection::Account => "Account",
        SettingsSection::Instructions => "Instructions",
        SettingsSection::Secrets => "Secrets",
        SettingsSection::Providers => "Providers",
        SettingsSection::Usage => "Usage",
        SettingsSection::MobileAccess => "Mobile Access",
        SettingsSection::Debug => "Dev Tools",
    }
}

/// Prefix, word-prefix, substring, then matching secondary text.
fn rank(query: &str, title: &str, secondary: Option<&str>) -> Option<u8> {
    let title = title.to_lowercase();
    if title.starts_with(query) {
        return Some(0);
    }
    if title
        .split(|value: char| !value.is_alphanumeric())
        .any(|word| word.starts_with(query))
    {
        return Some(1);
    }
    if title.contains(query) {
        return Some(2);
    }
    let secondary = secondary?.to_lowercase();
    if secondary.starts_with(query) {
        Some(3)
    } else if secondary
        .split(|value: char| !value.is_alphanumeric())
        .any(|word| word.starts_with(query))
    {
        Some(4)
    } else if secondary.contains(query) {
        Some(5)
    } else {
        None
    }
}

fn route_group<'a>(route: &'a Route, agent: &AgentNamespace) -> Option<&'a str> {
    match route {
        Route::Group {
            agent: own_agent,
            group,
        }
        | Route::Chat {
            agent: own_agent,
            group,
            ..
        }
        | Route::File {
            agent: own_agent,
            group,
            ..
        } if own_agent == agent => Some(group.as_str()),
        _ => None,
    }
}

fn opaque_group(value: &str) -> GroupId {
    GroupId::new(Arc::<str>::from(value)).expect("daemon identities are non-empty")
}
fn opaque_session(value: &str) -> SessionId {
    SessionId::new(Arc::<str>::from(value)).expect("daemon identities are non-empty")
}
