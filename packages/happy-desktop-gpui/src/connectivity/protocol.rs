//! The small native-client projection of Happy Agent wire protocol v23.
//!
//! Serde ignores fields outside this projection. Every field used by GPUI is
//! still named and typed here; the transport never guesses owned data from
//! shapes or strings.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const HAPPY_AGENT_PROTOCOL_VERSION: u32 = 23;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub healthy: bool,
    pub ready: bool,
    #[serde(default)]
    pub draining: bool,
    pub status: DaemonStatus,
    pub version: DaemonVersion,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DaemonStatus {
    Starting,
    Ready,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct DaemonVersion {
    pub daemon: String,
    pub protocol: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct OnboardingState {
    pub completed: bool,
    pub steps: OnboardingSteps,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct OnboardingSteps {
    pub profile: CompletionStep,
    pub project: CompletionStep,
    pub providers: ProviderCompletionStep,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct CompletionStep {
    pub done: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCompletionStep {
    pub done: bool,
    pub signed_in: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct OnboardingCompletedResponse {
    pub completed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: Option<String>,
    pub email: Option<String>,
    pub photo: Option<ProfilePhoto>,
    pub updated_at: i64,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ProfilePhoto {
    pub thumbhash: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub workspace_id: String,
    pub title: Option<String>,
    pub title_status: AgentTitleStatus,
    pub status: AgentStatus,
    pub unread: Option<AgentUnread>,
    pub pending_question_id: Option<String>,
    pub subagents: AgentSubagents,
    pub processes: AgentProcesses,
    pub archived_at: Option<i64>,
    pub order_key: Option<String>,
    pub parent_agent_id: Option<String>,
    pub last_cursor: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: String,
    #[serde(default)]
    pub can_send_messages: Option<bool>,
    #[serde(default)]
    pub managed_by_another_agent: Option<bool>,
    #[serde(default)]
    pub user_visible: Option<bool>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Working,
    GeneratingTools,
    RunningTools,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentTitleStatus {
    Idle,
    Ready,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentUnread {
    pub reason: String,
    pub since: i64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentSubagents {
    pub running: u64,
    pub total: u64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentProcesses {
    pub running: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Compute {
    Host { path: String },
    Docker { image: String },
}
impl Compute {
    pub fn display_location(&self) -> &str {
        match self {
            Self::Host { path } => path,
            Self::Docker { image } => image,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub ahead: u64,
    pub behind: u64,
    #[serde(default)]
    pub branch: Option<String>,
    pub detached: bool,
    /// Protocol 23 daemons return `null` for a repository without a commit.
    pub head: Option<String>,
    pub upstream: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectAvatar {
    Home,
    Image {
        source: AvatarSource,
        thumbhash: String,
    },
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AvatarSource {
    User,
    Generated,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub order_key: String,
    pub status: ProjectStatus,
    pub archived_at: Option<i64>,
    pub agents: Vec<Agent>,
    pub initialization: Initialization,
    pub compute: Compute,
    pub avatar: Option<ProjectAvatar>,
    pub git: Option<GitSummary>,
    pub default_branch: Option<String>,
    pub worktree_support: WorktreeSupport,
    #[serde(default)]
    pub worktree_unsupported_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Active,
    Archived,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeSupport {
    Supported,
    Unsupported,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub bot_id: Option<String>,
    pub name: String,
    pub order_key: String,
    pub kind: WorkspaceKind,
    pub status: WorkspaceStatus,
    pub archived_at: Option<i64>,
    pub agents: Vec<Agent>,
    pub initialization: Initialization,
    pub compute: Compute,
    pub git: Option<GitSummary>,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Root,
    Worktree,
    Copy,
    Bot,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    Active,
    Archiving,
    Archived,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Initialization {
    pub attempt: u32,
    pub error: Option<String>,
    pub status: InitializationStatus,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InitializationStatus {
    Initializing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub workspace_id: String,
    pub agent: Agent,
    pub name: String,
    pub username: String,
    pub order_key: String,
    pub status: BotStatus,
    pub archived_at: Option<i64>,
    pub compute: Compute,
    pub avatar: Option<BotAvatar>,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BotStatus {
    Active,
    Archived,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct BotAvatar {
    pub kind: BotAvatarKind,
    pub source: AvatarSource,
    pub thumbhash: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BotAvatarKind {
    Image,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub facts: GitSummary,
    pub comparison: GitComparison,
    pub base: Option<String>,
    pub changed_files: u64,
    pub insertions: u64,
    pub deletions: u64,
    pub counts_exact: bool,
    pub conflicted: bool,
    pub files: Vec<GitFileChange>,
    pub files_truncated: bool,
    pub scanned_at: i64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitComparison {
    Ready,
    Unavailable,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitFileChange {
    pub path: String,
    pub status: GitFileStatus,
    pub staged: bool,
    pub unstaged: bool,
    pub binary: bool,
    pub insertions: Option<u64>,
    pub deletions: Option<u64>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Conflicted,
    TypeChanged,
    Submodule,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub defaults: CatalogDefaults,
    pub models: BTreeMap<String, ModelDefinition>,
    pub providers: BTreeMap<String, ProviderDefinition>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDefaults {
    pub effort: String,
    pub model_id: String,
    pub permission_mode: PermissionMode,
    pub provider_id: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    ReadOnly,
    WorkspaceWrite,
    Auto,
    FullAccess,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefinition {
    pub name: String,
    pub efforts: Vec<String>,
    pub default_effort: String,
    pub context_window: Option<u64>,
    pub service_tiers: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ProviderDefinition {
    pub enabled: bool,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub models: Vec<ProviderModel>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub enabled: bool,
    pub name: Option<String>,
    pub efforts: Option<Vec<String>>,
    pub default_effort: Option<String>,
    pub service_tiers: Option<Vec<String>>,
}

/// What local credential discovery found during this scan.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderCredentialStatus {
    Available,
    Missing,
    Error,
}

/// Why a provider has its current effective enabled state.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderEnablement {
    Explicit,
    Scan,
    Default,
}

/// One provider's result from the completed system credential scan.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderScanResult {
    pub credentials: ProviderCredentialStatus,
    pub enabled: bool,
    pub enablement: ProviderEnablement,
    pub provider_id: String,
    pub remembered: bool,
}

/// Exact protocol v23 response from `POST /v0/providers/scan`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderScanResponse {
    pub completed_at: i64,
    pub providers: Vec<ProviderScanResult>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderVerificationLevel {
    Credentials,
    Authentication,
    Inference,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderVerificationStatus {
    Passed,
    Failed,
}

/// Exact protocol v23 response from `POST /v0/providers/:id/verify`.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVerificationResponse {
    pub checked_at: i64,
    pub model_id: Option<String>,
    pub performed_level: ProviderVerificationLevel,
    pub provider_id: String,
    pub requested_level: ProviderVerificationLevel,
    pub status: ProviderVerificationStatus,
}

/// Authoritative catalog state. Event frames are only hints to replace this snapshot.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct DesktopBootstrap {
    pub cursor: String,
    pub config: CatalogSnapshot,
    pub onboarding: OnboardingState,
    pub profile: Profile,
    pub projects: Vec<Project>,
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub bots: Vec<Bot>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ConfigResponse {
    pub config: CatalogSnapshot,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ProfileResponse {
    pub profile: Profile,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ProjectListResponse {
    pub projects: Vec<Project>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WorkspaceListResponse {
    pub workspaces: Vec<Workspace>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct BotListResponse {
    pub bots: Vec<Bot>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct GitStateResponse {
    pub git: GitState,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WatchGitResponse {
    pub snapshots: BTreeMap<String, GitState>,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchGitRequest {
    pub workspace_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventStreamHello {
    pub cursor: String,
    pub gap: bool,
    pub resumed: bool,
    pub connected_at: i64,
    #[serde(default)]
    pub daemon_id: Option<String>,
    #[serde(default)]
    pub daemon_started_at: Option<i64>,
    #[serde(default)]
    pub draining: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum HappyAgentEventType {
    #[serde(rename = "daemon.draining")]
    DaemonDraining,
    #[serde(rename = "project.created")]
    ProjectCreated,
    #[serde(rename = "project.updated")]
    ProjectUpdated,
    #[serde(rename = "workspace.created")]
    WorkspaceCreated,
    #[serde(rename = "workspace.updated")]
    WorkspaceUpdated,
    #[serde(rename = "secret.created")]
    SecretCreated,
    #[serde(rename = "secret.updated")]
    SecretUpdated,
    #[serde(rename = "secret.attached")]
    SecretAttached,
    #[serde(rename = "secret.detached")]
    SecretDetached,
    #[serde(rename = "secret.removed")]
    SecretRemoved,
    #[serde(rename = "bot.created")]
    BotCreated,
    #[serde(rename = "bot.updated")]
    BotUpdated,
    #[serde(rename = "terminal.created")]
    TerminalCreated,
    #[serde(rename = "terminal.updated")]
    TerminalUpdated,
    #[serde(rename = "git.updated")]
    GitUpdated,
    #[serde(rename = "files.updated")]
    FilesUpdated,
    #[serde(rename = "agent.created")]
    AgentCreated,
    #[serde(rename = "agent.updated")]
    AgentUpdated,
    #[serde(rename = "agent.context.updated")]
    AgentContextUpdated,
    #[serde(rename = "agent.draft.updated")]
    AgentDraftUpdated,
    #[serde(rename = "agent.slash_commands.updated")]
    AgentSlashCommandsUpdated,
    #[serde(rename = "process.started")]
    ProcessStarted,
    #[serde(rename = "process.updated")]
    ProcessUpdated,
    #[serde(rename = "process.exited")]
    ProcessExited,
    #[serde(rename = "question.created")]
    QuestionCreated,
    #[serde(rename = "question.updated")]
    QuestionUpdated,
    #[serde(rename = "run.started")]
    RunStarted,
    #[serde(rename = "run.boundary")]
    RunBoundary,
    #[serde(rename = "run.finished")]
    RunFinished,
    #[serde(rename = "message.created")]
    MessageCreated,
    #[serde(rename = "message.updated")]
    MessageUpdated,
    #[serde(rename = "message.delta")]
    MessageDelta,
    #[serde(rename = "message.deleted")]
    MessageDeleted,
    #[serde(rename = "config.updated")]
    ConfigUpdated,
    #[serde(rename = "profile.updated")]
    ProfileUpdated,
    #[serde(rename = "cloud.updated")]
    CloudUpdated,
    #[serde(rename = "cloud.profile.updated")]
    CloudProfileUpdated,
    #[serde(rename = "cloud.social.updated")]
    CloudSocialUpdated,
    #[serde(rename = "crdt.service.created")]
    CrdtServiceCreated,
    #[serde(rename = "crdt.service.updated")]
    CrdtServiceUpdated,
    #[serde(rename = "crdt.connection.updated")]
    CrdtConnectionUpdated,
    #[serde(rename = "happy.integration.updated")]
    HappyIntegrationUpdated,
}

/// An SSE delivery hint. Its payload is deliberately not treated as durable state.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct EventHint {
    pub cursor: String,
    #[serde(rename = "type")]
    pub event_type: HappyAgentEventType,
    #[serde(default)]
    pub payload: Option<EventHintPayload>,
}

/// Only identity-bearing fields needed to target authoritative reconciliation.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventHintPayload {
    #[serde(default)]
    pub workspace_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn health_projection_parses_protocol_23_and_ignores_unowned_fields() {
        let health: HealthResponse = serde_json::from_value(json!({
            "healthy": true,
            "ready": true,
            "draining": false,
            "status": "ready",
            "version": { "daemon": "0.4.27", "protocol": 23, "future": true },
            "unowned": { "anything": true }
        }))
        .unwrap();
        assert_eq!(health.version.protocol, HAPPY_AGENT_PROTOCOL_VERSION);
        assert_eq!(health.version.daemon, "0.4.27");
        assert_eq!(health.status, DaemonStatus::Ready);
    }

    #[test]
    fn event_projection_accepts_only_the_closed_protocol_vocabulary() {
        let hint: EventHint = serde_json::from_value(json!({
            "cursor": "cursor-2",
            "type": "agent.draft.updated"
        }))
        .unwrap();
        assert_eq!(hint.event_type, HappyAgentEventType::AgentDraftUpdated);
        assert!(
            serde_json::from_value::<EventHint>(json!({
                "cursor": "cursor-3",
                "type": "peer.route.guessed"
            }))
            .is_err()
        );
    }

    #[test]
    fn provider_scan_and_authentication_verification_match_protocol_23() {
        let scan: ProviderScanResponse = serde_json::from_value(json!({
            "completedAt": 42,
            "providers": [{
                "credentials": "available",
                "enabled": true,
                "enablement": "scan",
                "providerId": "claude",
                "remembered": true
            }]
        }))
        .unwrap();
        assert_eq!(
            scan.providers[0].credentials,
            ProviderCredentialStatus::Available
        );
        assert_eq!(scan.providers[0].enablement, ProviderEnablement::Scan);

        let verification: ProviderVerificationResponse = serde_json::from_value(json!({
            "checkedAt": 43,
            "modelId": null,
            "performedLevel": "authentication",
            "providerId": "claude",
            "requestedLevel": "authentication",
            "status": "passed"
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(ProviderVerificationLevel::Authentication).unwrap(),
            json!("authentication")
        );
        assert_eq!(
            verification.performed_level,
            ProviderVerificationLevel::Authentication
        );
        assert_eq!(verification.status, ProviderVerificationStatus::Passed);
    }

    #[test]
    fn stream_hello_defaults_optional_daemon_metadata() {
        let hello: EventStreamHello = serde_json::from_value(json!({
            "cursor": "cursor-1",
            "gap": false,
            "resumed": true,
            "connectedAt": 123
        }))
        .unwrap();
        assert_eq!(hello.daemon_id, None);
        assert_eq!(hello.daemon_started_at, None);
        assert_eq!(hello.draining, None);
    }
}
