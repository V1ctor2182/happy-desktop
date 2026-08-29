//! Framework-neutral authoritative catalog projection for one Happy Agent lifetime.
//!
//! `AgentCatalogStore` owns one immutable snapshot. Reconciliation replaces that
//! snapshot while retaining the `Arc` for every projected row whose value did
//! not change. It owns no transport, timers, subscriptions, or GPUI entities.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use super::{
    Agent, AgentNamespace, AgentStatus, AgentTitleStatus, AvatarSource, Bot, BotStatus,
    DesktopBootstrap, GitComparison, GitState, GitSummary, InitializationStatus, Project,
    ProjectAvatar, ProjectStatus, Workspace, WorkspaceKind, WorkspaceStatus,
};

macro_rules! catalog_key {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name {
            namespace: AgentNamespace,
            id: Arc<str>,
        }

        impl $name {
            pub fn new(namespace: AgentNamespace, id: impl Into<Arc<str>>) -> Self {
                Self {
                    namespace,
                    id: id.into(),
                }
            }

            pub fn namespace(&self) -> &AgentNamespace {
                &self.namespace
            }
            pub fn id(&self) -> &str {
                &self.id
            }
        }
    };
}

catalog_key!(ProjectKey);
catalog_key!(WorkspaceKey);
catalog_key!(ConversationKey);
catalog_key!(BotKey);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogLifecycleState {
    Active,
    Archiving,
    Archived,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogInitializationState {
    Initializing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogLifecycle {
    pub state: CatalogLifecycleState,
    pub archived_at: Option<i64>,
    pub initialization: Option<CatalogInitializationState>,
    pub initialization_error: Option<Arc<str>>,
}

impl CatalogLifecycle {
    /// The exact daemon predicate used for active catalog membership.
    pub fn is_active(&self) -> bool {
        self.state == CatalogLifecycleState::Active && self.archived_at.is_none()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BranchFacts {
    pub branch: Option<Arc<str>>,
    pub detached: bool,
    pub head: Option<Arc<str>>,
    pub upstream: Option<Arc<str>>,
    pub ahead: u64,
    pub behind: u64,
    pub comparison: Option<CatalogGitComparison>,
    pub base: Option<Arc<str>>,
    pub conflicted: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogGitComparison {
    Ready,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitTotals {
    pub changed_files: u64,
    pub insertions: u64,
    pub deletions: u64,
    pub counts_exact: bool,
    pub files_truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActivityAggregate {
    pub idle_conversations: u64,
    pub waiting_for_person_conversations: u64,
    pub thinking_conversations: u64,
    pub working_conversations: u64,
    pub generating_tools_conversations: u64,
    pub running_tools_conversations: u64,
    pub running_processes: u64,
    pub running_subagents: u64,
    pub total_subagents: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnreadAggregate {
    pub conversations: u64,
    pub oldest_since: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationUnread {
    pub reason: Arc<str>,
    pub since: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CatalogAvatar {
    Home,
    Image {
        source: CatalogAvatarSource,
        thumbhash: Arc<str>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogAvatarSource {
    User,
    Generated,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectCatalogRow {
    pub key: ProjectKey,
    pub label: Arc<str>,
    pub location: Arc<str>,
    pub avatar: Option<CatalogAvatar>,
    pub lifecycle: CatalogLifecycle,
    pub order_key: Arc<str>,
    pub branch: Option<BranchFacts>,
    pub git_totals: Option<GitTotals>,
    pub activity: ActivityAggregate,
    pub unread: UnreadAggregate,
    pub workspace_keys: Vec<WorkspaceKey>,
    pub conversation_keys: Vec<ConversationKey>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceCatalogRow {
    pub key: WorkspaceKey,
    pub project_key: Option<ProjectKey>,
    pub parent_key: Option<WorkspaceKey>,
    pub bot_key: Option<BotKey>,
    pub label: Arc<str>,
    pub location: Arc<str>,
    pub lifecycle: CatalogLifecycle,
    pub kind: CatalogWorkspaceKind,
    pub order_key: Arc<str>,
    pub branch: Option<BranchFacts>,
    pub git_totals: Option<GitTotals>,
    pub activity: ActivityAggregate,
    pub unread: UnreadAggregate,
    pub conversation_keys: Vec<ConversationKey>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogWorkspaceKind {
    Root,
    Worktree,
    Copy,
    Bot,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BotCatalogRow {
    pub key: BotKey,
    pub workspace_key: WorkspaceKey,
    pub label: Arc<str>,
    pub username: Arc<str>,
    pub location: Arc<str>,
    pub avatar: Option<CatalogAvatar>,
    pub lifecycle: CatalogLifecycle,
    pub order_key: Arc<str>,
    pub branch: Option<BranchFacts>,
    pub git_totals: Option<GitTotals>,
    pub activity: ActivityAggregate,
    pub unread: UnreadAggregate,
    pub conversation_keys: Vec<ConversationKey>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationCatalogRow {
    pub key: ConversationKey,
    pub workspace_key: WorkspaceKey,
    pub project_key: Option<ProjectKey>,
    pub bot_key: Option<BotKey>,
    pub parent_key: Option<ConversationKey>,
    pub label: Option<Arc<str>>,
    pub title_ready: bool,
    pub lifecycle: CatalogLifecycle,
    pub order_key: Option<Arc<str>>,
    pub status: CatalogConversationStatus,
    pub unread: Option<ConversationUnread>,
    pub pending_question_id: Option<Arc<str>>,
    pub can_send_messages: Option<bool>,
    pub managed_by_another_agent: Option<bool>,
    pub running_processes: u64,
    pub running_subagents: u64,
    pub total_subagents: u64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogConversationStatus {
    Idle,
    Thinking,
    Working,
    GeneratingTools,
    RunningTools,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CatalogIssue {
    DuplicateProject {
        key: ProjectKey,
    },
    DuplicateWorkspace {
        key: WorkspaceKey,
    },
    DuplicateBot {
        key: BotKey,
    },
    DuplicateConversation {
        key: ConversationKey,
    },
    WorkspaceProjectMissing {
        workspace: WorkspaceKey,
        project: ProjectKey,
    },
    WorkspaceParentMissing {
        workspace: WorkspaceKey,
        parent: WorkspaceKey,
    },
    WorkspaceBotMissing {
        workspace: WorkspaceKey,
        bot: BotKey,
    },
    BotWorkspaceDoesNotNameBot {
        bot: BotKey,
        workspace: WorkspaceKey,
        named_bot: Option<BotKey>,
    },
    ConversationWorkspaceMissing {
        conversation: ConversationKey,
        workspace: WorkspaceKey,
    },
    ConversationProjectMismatch {
        conversation: ConversationKey,
        containing_project: ProjectKey,
        workspace_project: Option<ProjectKey>,
    },
    ConversationBotMismatch {
        conversation: ConversationKey,
        containing_bot: BotKey,
        workspace_bot: Option<BotKey>,
    },
    ConversationParentMissing {
        conversation: ConversationKey,
        parent: ConversationKey,
    },
    GitTargetMissing {
        workspace_id: Arc<str>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentCatalogSnapshot {
    pub namespace: AgentNamespace,
    pub active_projects: Vec<Arc<ProjectCatalogRow>>,
    pub archived_projects: Vec<Arc<ProjectCatalogRow>>,
    pub active_workspaces: Vec<Arc<WorkspaceCatalogRow>>,
    pub archived_workspaces: Vec<Arc<WorkspaceCatalogRow>>,
    pub active_bots: Vec<Arc<BotCatalogRow>>,
    pub archived_bots: Vec<Arc<BotCatalogRow>>,
    pub active_conversations: Vec<Arc<ConversationCatalogRow>>,
    pub archived_conversations: Vec<Arc<ConversationCatalogRow>>,
    pub issues: Vec<CatalogIssue>,
}

impl AgentCatalogSnapshot {
    fn empty(namespace: AgentNamespace) -> Self {
        Self {
            namespace,
            active_projects: Vec::new(),
            archived_projects: Vec::new(),
            active_workspaces: Vec::new(),
            archived_workspaces: Vec::new(),
            active_bots: Vec::new(),
            archived_bots: Vec::new(),
            active_conversations: Vec::new(),
            archived_conversations: Vec::new(),
            issues: Vec::new(),
        }
    }

    pub fn project(&self, key: &ProjectKey) -> Option<&Arc<ProjectCatalogRow>> {
        self.active_projects
            .iter()
            .chain(&self.archived_projects)
            .find(|row| &row.key == key)
    }
    pub fn workspace(&self, key: &WorkspaceKey) -> Option<&Arc<WorkspaceCatalogRow>> {
        self.active_workspaces
            .iter()
            .chain(&self.archived_workspaces)
            .find(|row| &row.key == key)
    }
    pub fn bot(&self, key: &BotKey) -> Option<&Arc<BotCatalogRow>> {
        self.active_bots
            .iter()
            .chain(&self.archived_bots)
            .find(|row| &row.key == key)
    }
    pub fn conversation(&self, key: &ConversationKey) -> Option<&Arc<ConversationCatalogRow>> {
        self.active_conversations
            .iter()
            .chain(&self.archived_conversations)
            .find(|row| &row.key == key)
    }
}

pub struct AgentCatalogStore {
    namespace: AgentNamespace,
    snapshot: Arc<AgentCatalogSnapshot>,
}

impl AgentCatalogStore {
    pub fn new(namespace: AgentNamespace) -> Self {
        Self {
            snapshot: Arc::new(AgentCatalogSnapshot::empty(namespace.clone())),
            namespace,
        }
    }

    pub fn from_bootstrap(
        namespace: AgentNamespace,
        bootstrap: &DesktopBootstrap,
        git_states: &BTreeMap<String, GitState>,
    ) -> Self {
        let mut store = Self::new(namespace);
        store.reconcile(bootstrap, git_states);
        store
    }

    pub fn snapshot(&self) -> &Arc<AgentCatalogSnapshot> {
        &self.snapshot
    }

    pub fn reconcile(
        &mut self,
        bootstrap: &DesktopBootstrap,
        git_states: &BTreeMap<String, GitState>,
    ) -> Arc<AgentCatalogSnapshot> {
        let projected = project_catalog(&self.namespace, bootstrap, git_states);
        let projected = reuse_snapshot_rows(&self.snapshot, projected);
        self.snapshot = Arc::new(projected);
        Arc::clone(&self.snapshot)
    }
}

#[derive(Clone, Copy)]
enum ConversationSource<'a> {
    Project(&'a Project, &'a Agent),
    Workspace(&'a Agent),
    Bot(&'a Bot, &'a Agent),
}

fn project_catalog(
    namespace: &AgentNamespace,
    bootstrap: &DesktopBootstrap,
    git_states: &BTreeMap<String, GitState>,
) -> AgentCatalogSnapshot {
    let mut issues = Vec::new();
    let projects = unique_projects(namespace, &bootstrap.projects, &mut issues);
    let workspaces = unique_workspaces(namespace, &bootstrap.workspaces, &mut issues);
    let bots = unique_bots(namespace, &bootstrap.bots, &mut issues);

    for workspace in workspaces.values() {
        let workspace_key = WorkspaceKey::new(namespace.clone(), workspace.id.as_str());
        if let Some(id) = &workspace.project_id {
            if !projects.contains_key(id) {
                issues.push(CatalogIssue::WorkspaceProjectMissing {
                    workspace: workspace_key.clone(),
                    project: ProjectKey::new(namespace.clone(), id.as_str()),
                });
            }
        }
        if let Some(id) = &workspace.parent_id {
            if !workspaces.contains_key(id) {
                issues.push(CatalogIssue::WorkspaceParentMissing {
                    workspace: workspace_key.clone(),
                    parent: WorkspaceKey::new(namespace.clone(), id.as_str()),
                });
            }
        }
        if let Some(id) = &workspace.bot_id {
            if !bots.contains_key(id) {
                issues.push(CatalogIssue::WorkspaceBotMissing {
                    workspace: workspace_key,
                    bot: BotKey::new(namespace.clone(), id.as_str()),
                });
            }
        }
    }
    // Bot workspaces are owned by the bot resource and are not members of the
    // bootstrap workspace collection. Validate a relationship only when the
    // daemon also publishes that workspace as a normal workspace row.
    for bot in bots.values() {
        if let Some(workspace) = workspaces.get(&bot.workspace_id) {
            if workspace.bot_id.as_deref() != Some(bot.id.as_str()) {
                issues.push(CatalogIssue::BotWorkspaceDoesNotNameBot {
                    bot: BotKey::new(namespace.clone(), bot.id.as_str()),
                    workspace: WorkspaceKey::new(namespace.clone(), bot.workspace_id.as_str()),
                    named_bot: workspace
                        .bot_id
                        .as_ref()
                        .map(|id| BotKey::new(namespace.clone(), id.as_str())),
                });
            }
        }
    }
    let bot_workspace_ids: BTreeSet<&str> =
        bots.values().map(|bot| bot.workspace_id.as_str()).collect();
    for id in git_states.keys() {
        if !projects.contains_key(id)
            && !workspaces.contains_key(id)
            && !bot_workspace_ids.contains(id.as_str())
        {
            issues.push(CatalogIssue::GitTargetMissing {
                workspace_id: Arc::from(id.as_str()),
            });
        }
    }

    let sources = conversation_sources(&projects, &workspaces, &bots);
    let conversations = project_conversations(
        namespace,
        &sources,
        &workspaces,
        &projects,
        &bots,
        &mut issues,
    );

    let mut project_rows = Vec::new();
    for project in projects.values() {
        let key = ProjectKey::new(namespace.clone(), project.id.as_str());
        let workspace_keys = sorted_workspaces_for_project(namespace, project, &workspaces);
        let conversation_keys = sorted_conversations_for_project(&key, &conversations);
        let agents = rows_for_keys(&conversation_keys, &conversations);
        let (branch, git_totals) =
            git_projection(git_states.get(&project.id), project.git.as_ref());
        project_rows.push(ProjectCatalogRow {
            key,
            label: arc(&project.name),
            location: arc(project.compute.display_location()),
            avatar: project.avatar.as_ref().map(project_avatar),
            lifecycle: project_lifecycle(project),
            order_key: arc(&project.order_key),
            branch,
            git_totals,
            activity: activity_of(&agents),
            unread: unread_of(&agents),
            workspace_keys,
            conversation_keys,
        });
    }

    let mut workspace_rows = Vec::new();
    for workspace in workspaces.values() {
        let key = WorkspaceKey::new(namespace.clone(), workspace.id.as_str());
        let conversation_keys = sorted_conversations_for_workspace(&key, &conversations);
        let agents = rows_for_keys(&conversation_keys, &conversations);
        let (branch, git_totals) =
            git_projection(git_states.get(&workspace.id), workspace.git.as_ref());
        workspace_rows.push(WorkspaceCatalogRow {
            key,
            project_key: workspace
                .project_id
                .as_ref()
                .map(|id| ProjectKey::new(namespace.clone(), id.as_str())),
            parent_key: workspace
                .parent_id
                .as_ref()
                .map(|id| WorkspaceKey::new(namespace.clone(), id.as_str())),
            bot_key: workspace
                .bot_id
                .as_ref()
                .map(|id| BotKey::new(namespace.clone(), id.as_str())),
            label: arc(&workspace.name),
            location: arc(workspace.compute.display_location()),
            lifecycle: workspace_lifecycle(workspace),
            kind: workspace_kind(&workspace.kind),
            order_key: arc(&workspace.order_key),
            branch,
            git_totals,
            activity: activity_of(&agents),
            unread: unread_of(&agents),
            conversation_keys,
        });
    }

    let mut bot_rows = Vec::new();
    for bot in bots.values() {
        let key = BotKey::new(namespace.clone(), bot.id.as_str());
        let conversation_keys = sorted_conversations_for_bot(&key, &conversations);
        let agents = rows_for_keys(&conversation_keys, &conversations);
        let workspace_git = workspaces
            .get(&bot.workspace_id)
            .and_then(|workspace| workspace.git.as_ref());
        let (branch, git_totals) = git_projection(git_states.get(&bot.workspace_id), workspace_git);
        bot_rows.push(BotCatalogRow {
            key,
            workspace_key: WorkspaceKey::new(namespace.clone(), bot.workspace_id.as_str()),
            label: arc(&bot.name),
            username: arc(&bot.username),
            location: arc(bot.compute.display_location()),
            avatar: bot.avatar.as_ref().map(|avatar| CatalogAvatar::Image {
                source: avatar_source(&avatar.source),
                thumbhash: arc(&avatar.thumbhash),
            }),
            lifecycle: bot_lifecycle(bot),
            order_key: arc(&bot.order_key),
            branch,
            git_totals,
            activity: activity_of(&agents),
            unread: unread_of(&agents),
            conversation_keys,
        });
    }

    project_rows.sort_by(|a, b| (&a.order_key, &a.key).cmp(&(&b.order_key, &b.key)));
    workspace_rows.sort_by(|a, b| (&a.order_key, &a.key).cmp(&(&b.order_key, &b.key)));
    bot_rows.sort_by(|a, b| (&a.order_key, &a.key).cmp(&(&b.order_key, &b.key)));
    let mut conversation_rows: Vec<_> = conversations.into_values().collect();
    conversation_rows.sort_by(|a, b| (&a.order_key, &a.key).cmp(&(&b.order_key, &b.key)));

    let (active_projects, archived_projects) =
        partition(project_rows, |row| row.lifecycle.is_active());
    let (active_workspaces, archived_workspaces) =
        partition(workspace_rows, |row| row.lifecycle.is_active());
    let (active_bots, archived_bots) = partition(bot_rows, |row| row.lifecycle.is_active());
    let (active_conversations, archived_conversations) =
        partition(conversation_rows, |row| row.lifecycle.is_active());
    AgentCatalogSnapshot {
        namespace: namespace.clone(),
        active_projects,
        archived_projects,
        active_workspaces,
        archived_workspaces,
        active_bots,
        archived_bots,
        active_conversations,
        archived_conversations,
        issues,
    }
}

fn unique_projects<'a>(
    namespace: &AgentNamespace,
    values: &'a [Project],
    issues: &mut Vec<CatalogIssue>,
) -> BTreeMap<String, &'a Project> {
    let mut result = BTreeMap::new();
    for value in values {
        if result.insert(value.id.clone(), value).is_some() {
            issues.push(CatalogIssue::DuplicateProject {
                key: ProjectKey::new(namespace.clone(), value.id.as_str()),
            });
        }
    }
    result
}
fn unique_workspaces<'a>(
    namespace: &AgentNamespace,
    values: &'a [Workspace],
    issues: &mut Vec<CatalogIssue>,
) -> BTreeMap<String, &'a Workspace> {
    let mut result = BTreeMap::new();
    for value in values {
        if result.insert(value.id.clone(), value).is_some() {
            issues.push(CatalogIssue::DuplicateWorkspace {
                key: WorkspaceKey::new(namespace.clone(), value.id.as_str()),
            });
        }
    }
    result
}
fn unique_bots<'a>(
    namespace: &AgentNamespace,
    values: &'a [Bot],
    issues: &mut Vec<CatalogIssue>,
) -> BTreeMap<String, &'a Bot> {
    let mut result = BTreeMap::new();
    for value in values {
        if result.insert(value.id.clone(), value).is_some() {
            issues.push(CatalogIssue::DuplicateBot {
                key: BotKey::new(namespace.clone(), value.id.as_str()),
            });
        }
    }
    result
}

fn conversation_sources<'a>(
    projects: &BTreeMap<String, &'a Project>,
    workspaces: &BTreeMap<String, &'a Workspace>,
    bots: &BTreeMap<String, &'a Bot>,
) -> Vec<ConversationSource<'a>> {
    let bot_agent_ids: BTreeSet<&str> = bots.values().map(|bot| bot.agent.id.as_str()).collect();
    let mut sources = Vec::new();
    for workspace in workspaces.values() {
        for agent in &workspace.agents {
            if workspace.kind == WorkspaceKind::Bot && bot_agent_ids.contains(agent.id.as_str()) {
                continue;
            }
            sources.push(ConversationSource::Workspace(agent));
        }
    }
    for project in projects.values() {
        let has_root = workspaces
            .get(&project.id)
            .is_some_and(|workspace| workspace.project_id.as_deref() == Some(project.id.as_str()));
        if !has_root {
            for agent in &project.agents {
                sources.push(ConversationSource::Project(project, agent));
            }
        }
    }
    for bot in bots.values() {
        sources.push(ConversationSource::Bot(bot, &bot.agent));
    }
    sources
}

fn project_conversations(
    namespace: &AgentNamespace,
    sources: &[ConversationSource<'_>],
    workspaces: &BTreeMap<String, &Workspace>,
    _projects: &BTreeMap<String, &Project>,
    _bots: &BTreeMap<String, &Bot>,
    issues: &mut Vec<CatalogIssue>,
) -> BTreeMap<ConversationKey, ConversationCatalogRow> {
    let mut rows = BTreeMap::new();
    for source in sources {
        let (agent, containing_project, containing_bot) = match source {
            ConversationSource::Project(project, agent) => (
                *agent,
                Some(ProjectKey::new(namespace.clone(), project.id.as_str())),
                None,
            ),
            ConversationSource::Workspace(agent) => (*agent, None, None),
            ConversationSource::Bot(bot, agent) => (
                *agent,
                None,
                Some(BotKey::new(namespace.clone(), bot.id.as_str())),
            ),
        };
        let key = ConversationKey::new(namespace.clone(), agent.id.as_str());
        let workspace_key = WorkspaceKey::new(namespace.clone(), agent.workspace_id.as_str());
        let workspace = workspaces.get(&agent.workspace_id).copied();
        // A bot agent's workspace is part of the bot resource rather than the
        // bootstrap workspace collection. Its explicit workspace ID remains
        // useful for routing, but absence from `workspaces` is not corruption.
        if workspace.is_none() && containing_bot.is_none() {
            issues.push(CatalogIssue::ConversationWorkspaceMissing {
                conversation: key.clone(),
                workspace: workspace_key.clone(),
            });
        }
        let workspace_project = workspace
            .and_then(|value| value.project_id.as_ref())
            .map(|id| ProjectKey::new(namespace.clone(), id.as_str()));
        let workspace_bot = workspace
            .and_then(|value| value.bot_id.as_ref())
            .map(|id| BotKey::new(namespace.clone(), id.as_str()));
        if let Some(project) = &containing_project {
            if workspace_project.as_ref() != Some(project) {
                issues.push(CatalogIssue::ConversationProjectMismatch {
                    conversation: key.clone(),
                    containing_project: project.clone(),
                    workspace_project: workspace_project.clone(),
                });
            }
        }
        if let (Some(bot), Some(workspace_bot)) = (&containing_bot, &workspace_bot) {
            if workspace_bot != bot {
                issues.push(CatalogIssue::ConversationBotMismatch {
                    conversation: key.clone(),
                    containing_bot: bot.clone(),
                    workspace_bot: Some(workspace_bot.clone()),
                });
            }
        }
        let row = ConversationCatalogRow {
            key: key.clone(),
            workspace_key,
            project_key: containing_project.or(workspace_project),
            bot_key: containing_bot.or(workspace_bot),
            parent_key: agent
                .parent_agent_id
                .as_ref()
                .map(|id| ConversationKey::new(namespace.clone(), id.as_str())),
            label: agent.title.as_deref().map(arc),
            title_ready: agent.title_status == AgentTitleStatus::Ready,
            lifecycle: conversation_lifecycle(agent),
            order_key: agent.order_key.as_deref().map(arc),
            status: conversation_status(&agent.status),
            unread: agent.unread.as_ref().map(|unread| ConversationUnread {
                reason: arc(&unread.reason),
                since: unread.since,
            }),
            pending_question_id: agent.pending_question_id.as_deref().map(arc),
            can_send_messages: agent.can_send_messages,
            managed_by_another_agent: agent.managed_by_another_agent,
            running_processes: agent.processes.running,
            running_subagents: agent.subagents.running,
            total_subagents: agent.subagents.total,
            updated_at: agent.updated_at,
        };
        if rows.insert(key.clone(), row).is_some() {
            issues.push(CatalogIssue::DuplicateConversation { key });
        }
    }
    let keys: BTreeSet<_> = rows.keys().cloned().collect();
    for row in rows.values() {
        if let Some(parent) = &row.parent_key {
            if !keys.contains(parent) {
                issues.push(CatalogIssue::ConversationParentMissing {
                    conversation: row.key.clone(),
                    parent: parent.clone(),
                });
            }
        }
    }
    rows
}

fn sorted_workspaces_for_project(
    namespace: &AgentNamespace,
    project: &Project,
    workspaces: &BTreeMap<String, &Workspace>,
) -> Vec<WorkspaceKey> {
    let mut values: Vec<_> = workspaces
        .values()
        .filter(|workspace| workspace.project_id.as_deref() == Some(project.id.as_str()))
        .collect();
    values.sort_by(|a, b| (&a.order_key, &a.id).cmp(&(&b.order_key, &b.id)));
    values
        .into_iter()
        .map(|workspace| WorkspaceKey::new(namespace.clone(), workspace.id.as_str()))
        .collect()
}
fn sorted_conversations_for_project(
    key: &ProjectKey,
    rows: &BTreeMap<ConversationKey, ConversationCatalogRow>,
) -> Vec<ConversationKey> {
    sorted_conversation_keys(
        rows.values()
            .filter(|row| row.project_key.as_ref() == Some(key)),
    )
}
fn sorted_conversations_for_workspace(
    key: &WorkspaceKey,
    rows: &BTreeMap<ConversationKey, ConversationCatalogRow>,
) -> Vec<ConversationKey> {
    sorted_conversation_keys(rows.values().filter(|row| &row.workspace_key == key))
}
fn sorted_conversations_for_bot(
    key: &BotKey,
    rows: &BTreeMap<ConversationKey, ConversationCatalogRow>,
) -> Vec<ConversationKey> {
    sorted_conversation_keys(
        rows.values()
            .filter(|row| row.bot_key.as_ref() == Some(key)),
    )
}
fn sorted_conversation_keys<'a>(
    rows: impl Iterator<Item = &'a ConversationCatalogRow>,
) -> Vec<ConversationKey> {
    let mut rows: Vec<_> = rows.collect();
    rows.sort_by(|a, b| (&a.order_key, &a.key).cmp(&(&b.order_key, &b.key)));
    rows.into_iter().map(|row| row.key.clone()).collect()
}
fn rows_for_keys<'a>(
    keys: &[ConversationKey],
    rows: &'a BTreeMap<ConversationKey, ConversationCatalogRow>,
) -> Vec<&'a ConversationCatalogRow> {
    keys.iter().filter_map(|key| rows.get(key)).collect()
}

fn activity_of(rows: &[&ConversationCatalogRow]) -> ActivityAggregate {
    let mut value = ActivityAggregate::default();
    for row in rows {
        if row.pending_question_id.is_some() {
            value.waiting_for_person_conversations += 1;
        }
        match row.status {
            CatalogConversationStatus::Idle => value.idle_conversations += 1,
            CatalogConversationStatus::Thinking => value.thinking_conversations += 1,
            CatalogConversationStatus::Working => value.working_conversations += 1,
            CatalogConversationStatus::GeneratingTools => value.generating_tools_conversations += 1,
            CatalogConversationStatus::RunningTools => value.running_tools_conversations += 1,
        }
        value.running_processes += row.running_processes;
        value.running_subagents += row.running_subagents;
        value.total_subagents += row.total_subagents;
    }
    value
}
fn unread_of(rows: &[&ConversationCatalogRow]) -> UnreadAggregate {
    let mut value = UnreadAggregate::default();
    for unread in rows.iter().filter_map(|row| row.unread.as_ref()) {
        value.conversations += 1;
        value.oldest_since = Some(
            value
                .oldest_since
                .map_or(unread.since, |oldest| oldest.min(unread.since)),
        );
    }
    value
}

fn git_projection(
    state: Option<&GitState>,
    summary: Option<&GitSummary>,
) -> (Option<BranchFacts>, Option<GitTotals>) {
    match state {
        Some(state) => (
            Some(branch_facts(&state.facts, Some(state))),
            Some(GitTotals {
                changed_files: state.changed_files,
                insertions: state.insertions,
                deletions: state.deletions,
                counts_exact: state.counts_exact,
                files_truncated: state.files_truncated,
            }),
        ),
        None => (summary.map(|summary| branch_facts(summary, None)), None),
    }
}
fn branch_facts(summary: &GitSummary, state: Option<&GitState>) -> BranchFacts {
    BranchFacts {
        branch: summary.branch.as_deref().map(arc),
        detached: summary.detached,
        head: summary.head.as_deref().map(arc),
        upstream: summary.upstream.as_deref().map(arc),
        ahead: summary.ahead,
        behind: summary.behind,
        comparison: state.map(|value| match value.comparison {
            GitComparison::Ready => CatalogGitComparison::Ready,
            GitComparison::Unavailable => CatalogGitComparison::Unavailable,
        }),
        base: state.and_then(|value| value.base.as_deref()).map(arc),
        conflicted: state.map(|value| value.conflicted),
    }
}
fn project_lifecycle(value: &Project) -> CatalogLifecycle {
    CatalogLifecycle {
        state: match value.status {
            ProjectStatus::Active => CatalogLifecycleState::Active,
            ProjectStatus::Archived => CatalogLifecycleState::Archived,
        },
        archived_at: value.archived_at,
        initialization: Some(initialization_state(&value.initialization.status)),
        initialization_error: value.initialization.error.as_deref().map(arc),
    }
}
fn workspace_lifecycle(value: &Workspace) -> CatalogLifecycle {
    CatalogLifecycle {
        state: match value.status {
            WorkspaceStatus::Active => CatalogLifecycleState::Active,
            WorkspaceStatus::Archiving => CatalogLifecycleState::Archiving,
            WorkspaceStatus::Archived => CatalogLifecycleState::Archived,
        },
        archived_at: value.archived_at,
        initialization: Some(initialization_state(&value.initialization.status)),
        initialization_error: value.initialization.error.as_deref().map(arc),
    }
}
fn bot_lifecycle(value: &Bot) -> CatalogLifecycle {
    CatalogLifecycle {
        state: match value.status {
            BotStatus::Active => CatalogLifecycleState::Active,
            BotStatus::Archived => CatalogLifecycleState::Archived,
        },
        archived_at: value.archived_at,
        initialization: None,
        initialization_error: None,
    }
}
fn conversation_lifecycle(value: &Agent) -> CatalogLifecycle {
    CatalogLifecycle {
        state: if value.archived_at.is_none() {
            CatalogLifecycleState::Active
        } else {
            CatalogLifecycleState::Archived
        },
        archived_at: value.archived_at,
        initialization: None,
        initialization_error: None,
    }
}
fn initialization_state(value: &InitializationStatus) -> CatalogInitializationState {
    match value {
        InitializationStatus::Initializing => CatalogInitializationState::Initializing,
        InitializationStatus::Ready => CatalogInitializationState::Ready,
        InitializationStatus::Failed => CatalogInitializationState::Failed,
    }
}
fn workspace_kind(value: &WorkspaceKind) -> CatalogWorkspaceKind {
    match value {
        WorkspaceKind::Root => CatalogWorkspaceKind::Root,
        WorkspaceKind::Worktree => CatalogWorkspaceKind::Worktree,
        WorkspaceKind::Copy => CatalogWorkspaceKind::Copy,
        WorkspaceKind::Bot => CatalogWorkspaceKind::Bot,
    }
}
fn conversation_status(value: &AgentStatus) -> CatalogConversationStatus {
    match value {
        AgentStatus::Idle => CatalogConversationStatus::Idle,
        AgentStatus::Thinking => CatalogConversationStatus::Thinking,
        AgentStatus::Working => CatalogConversationStatus::Working,
        AgentStatus::GeneratingTools => CatalogConversationStatus::GeneratingTools,
        AgentStatus::RunningTools => CatalogConversationStatus::RunningTools,
    }
}
fn project_avatar(value: &ProjectAvatar) -> CatalogAvatar {
    match value {
        ProjectAvatar::Home => CatalogAvatar::Home,
        ProjectAvatar::Image { source, thumbhash } => CatalogAvatar::Image {
            source: avatar_source(source),
            thumbhash: arc(thumbhash),
        },
    }
}

fn avatar_source(value: &AvatarSource) -> CatalogAvatarSource {
    match value {
        AvatarSource::User => CatalogAvatarSource::User,
        AvatarSource::Generated => CatalogAvatarSource::Generated,
    }
}

fn arc(value: &str) -> Arc<str> {
    Arc::from(value)
}

fn partition<T>(values: Vec<T>, active: impl Fn(&T) -> bool) -> (Vec<Arc<T>>, Vec<Arc<T>>) {
    let mut active_values = Vec::new();
    let mut archived_values = Vec::new();
    for value in values {
        if active(&value) {
            active_values.push(Arc::new(value));
        } else {
            archived_values.push(Arc::new(value));
        }
    }
    (active_values, archived_values)
}

fn reuse_snapshot_rows(
    previous: &AgentCatalogSnapshot,
    mut next: AgentCatalogSnapshot,
) -> AgentCatalogSnapshot {
    reuse_rows(
        &mut next.active_projects,
        &previous.active_projects,
        &previous.archived_projects,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.archived_projects,
        &previous.active_projects,
        &previous.archived_projects,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.active_workspaces,
        &previous.active_workspaces,
        &previous.archived_workspaces,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.archived_workspaces,
        &previous.active_workspaces,
        &previous.archived_workspaces,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.active_bots,
        &previous.active_bots,
        &previous.archived_bots,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.archived_bots,
        &previous.active_bots,
        &previous.archived_bots,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.active_conversations,
        &previous.active_conversations,
        &previous.archived_conversations,
        |row| &row.key,
    );
    reuse_rows(
        &mut next.archived_conversations,
        &previous.active_conversations,
        &previous.archived_conversations,
        |row| &row.key,
    );
    next
}
fn reuse_rows<T, K: Ord + ?Sized>(
    next: &mut [Arc<T>],
    active: &[Arc<T>],
    archived: &[Arc<T>],
    key: impl Fn(&T) -> &K,
) where
    T: PartialEq,
{
    let previous: BTreeMap<&K, &Arc<T>> = active
        .iter()
        .chain(archived)
        .map(|row| (key(row), row))
        .collect();
    for row in next {
        if let Some(old) = previous.get(key(row)) {
            if old.as_ref() == row.as_ref() {
                *row = Arc::clone(old);
            }
        }
    }
}
