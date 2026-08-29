//! Exact protocol-v23 models for the focused-agent chat work loop.
//!
//! These types deliberately cover only current Happy Agent routes. Serde's default
//! object behavior tolerates additive response fields without weakening any field
//! that this client owns.

use super::Agent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type ClientMetadata = BTreeMap<String, Value>;
pub type UsageBreakdown = BTreeMap<String, BTreeMap<String, ModelUsage>>;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessagePermissionMode {
    ReadOnly,
    WorkspaceWrite,
    Auto,
    FullAccess,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageMode {
    pub effort: String,
    pub model_id: String,
    pub permission_mode: MessagePermissionMode,
    pub provider_id: String,
    pub service_tier: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDraft {
    pub text: String,
    pub provider_id: String,
    pub model_id: String,
    pub effort: String,
    pub service_tier: Option<String>,
    pub permission_mode: MessagePermissionMode,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDraftSnapshot {
    pub value: Option<AgentDraft>,
    pub updated_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentDraftResponse {
    pub draft: AgentDraftSnapshot,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentModeResponse {
    pub mode: Option<MessageMode>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextUsage {
    pub approximate: bool,
    pub context_tokens: u64,
    pub context_window: Option<u64>,
    pub model_id: Option<String>,
    pub provider_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentUsageResponse {
    pub context: Option<AgentContextUsage>,
    pub usage: UsageBreakdown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandImage {
    pub thumbhash: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub description: String,
    pub has_arguments: bool,
    #[serde(default)]
    pub image: Option<SlashCommandImage>,
    #[serde(default)]
    pub kind: Option<String>,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    pub agent: Agent,
    pub slash_commands: Vec<SlashCommand>,
}
pub type CreateAgentResponse = AgentResponse;
pub type ArchiveAgentResponse = AgentResponse;
pub type UnarchiveAgentResponse = AgentResponse;
pub type ReorderAgentResponse = AgentResponse;
pub type MarkAgentReadResponse = AgentResponse;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcess {
    pub id: String,
    pub agent_id: String,
    pub command: String,
    pub status: BackgroundProcessStatus,
    pub exit_code: Option<i64>,
    pub version: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundProcessStatus {
    Running,
    Exited,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct BackgroundProcessResponse {
    pub process: BackgroundProcess,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct AgentActivityResponse {
    pub subagents: Vec<Agent>,
    pub processes: Vec<BackgroundProcess>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentBootstrapResponse {
    pub agent: Agent,
    pub slash_commands: Vec<SlashCommand>,
    pub mode: Option<MessageMode>,
    pub draft: AgentDraftSnapshot,
    pub context: Option<AgentContextUsage>,
    pub usage: UsageBreakdown,
    pub pending: Vec<UserMessage>,
    #[serde(default)]
    pub processes: Option<Vec<BackgroundProcess>>,
    #[serde(default)]
    pub subagents: Option<Vec<Agent>>,
    pub cursor: String,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageHistoryQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omit_tool_data: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessageHistoryResponse {
    pub cursor: String,
    pub has_more: bool,
    pub runs: Vec<HistoryRun>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub status: RunStatus,
    pub reason: Option<RunReason>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub usage: UsageBreakdown,
    pub cost_usd: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRun {
    pub id: String,
    pub status: RunStatus,
    pub reason: Option<RunReason>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub usage: UsageBreakdown,
    pub cost_usd: Option<f64>,
    pub messages: Vec<Message>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Completed,
    Aborted,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunReason {
    Completed,
    Steering,
    Abort,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    User(UserMessageFields),
    Agent(MessageFields),
    System(MessageFields),
    Service(MessageFields),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessageFields {
    pub id: String,
    pub created_at: i64,
    pub content: Vec<MessageBlock>,
    pub metadata: MessageMetadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageFields {
    pub id: String,
    pub created_at: i64,
    pub content: Vec<MessageBlock>,
    pub metadata: MessageMetadata,
    #[serde(default)]
    pub client_metadata: Option<ClientMetadata>,
    #[serde(default)]
    pub profile: Option<String>,
    pub status: UserMessageStatus,
    pub delivery: MessageDelivery,
    pub mode: MessageMode,
    pub run_id: Option<String>,
}

/// The standalone user-message shape used by bootstrap pending and send responses.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserMessage {
    pub id: String,
    pub role: UserRole,
    pub created_at: i64,
    pub content: Vec<MessageBlock>,
    pub metadata: MessageMetadata,
    #[serde(default)]
    pub client_metadata: Option<ClientMetadata>,
    #[serde(default)]
    pub profile: Option<String>,
    pub status: UserMessageStatus,
    pub delivery: MessageDelivery,
    pub mode: MessageMode,
    pub run_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    User,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageMetadata {
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub sender_agent_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageDelivery {
    Queue,
    Steer,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserMessageStatus {
    Pending,
    Accepted,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MessageBlock {
    Text {
        text: String,
    },
    Image {
        mime_type: String,
        data: String,
    },
    ToolCallRequest {
        name: String,
        arguments: BTreeMap<String, Value>,
    },
    Reasoning {
        text: String,
    },
    ToolCall(ToolCallBlock),
    Compaction(CompactionBlock),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ToolCallBlock {
    pub id: String,
    pub name: String,
    pub status: ToolCallStatus,
    #[serde(default)]
    pub arguments: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    pub result: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    pub presentation: Option<ToolPresentation>,
    #[serde(default)]
    pub elevated: Option<bool>,
    #[serde(default)]
    pub review: Option<ToolPermissionReview>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ToolPresentation {
    Exploration {
        operations: Vec<ExplorationOperation>,
    },
    ExecCommand {
        command: String,
        #[serde(default)]
        output: Option<String>,
        #[serde(default)]
        terminal_id: Option<String>,
    },
    BackgroundTerminalInteraction {
        command: String,
        input: String,
        terminal_id: String,
    },
    FileDiff {
        files: Vec<FileDiff>,
        #[serde(default)]
        omitted_files: Option<u64>,
    },
    Search {
        query: String,
        #[serde(default)]
        sources: Option<Vec<SearchSource>>,
        target: SearchTarget,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ExplorationOperation {
    List {
        target: String,
    },
    Read {
        name: String,
    },
    Search {
        command: String,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        query: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub added: u64,
    pub deleted: u64,
    pub hunks: Vec<FileDiffHunk>,
    pub kind: FileDiffKind,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub omitted_lines: Option<u64>,
    pub path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileDiffKind {
    Add,
    Delete,
    Update,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffHunk {
    pub lines: Vec<FileDiffLine>,
    pub new_start: i64,
    pub old_start: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FileDiffLine {
    pub kind: FileDiffLineKind,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileDiffLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct SearchSource {
    pub title: String,
    pub url: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchTarget {
    Web,
    X,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "outcome",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum ToolPermissionReview {
    Allowed {
        reason: String,
        risk: ToolPermissionRisk,
        user_authorization: ToolPermissionUserAuthorization,
    },
    Denied {
        reason: String,
        risk: ToolPermissionRisk,
        user_authorization: ToolPermissionUserAuthorization,
    },
    Unproven {
        kind: UnprovenReviewKind,
        reason: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolPermissionRisk {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolPermissionUserAuthorization {
    Unknown,
    Low,
    Medium,
    High,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnprovenReviewKind {
    TimedOut,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum CompactionBlock {
    Running {
        trigger: CompactionTrigger,
        started_at: i64,
        #[serde(default)]
        completed_at: Option<()>,
        tokens_before: Option<u64>,
        #[serde(default)]
        tokens_after: Option<()>,
        #[serde(default)]
        failure_reason: Option<()>,
    },
    Completed {
        trigger: CompactionTrigger,
        started_at: i64,
        completed_at: i64,
        tokens_before: Option<u64>,
        tokens_after: Option<u64>,
        #[serde(default)]
        failure_reason: Option<()>,
    },
    Failed {
        trigger: CompactionTrigger,
        started_at: i64,
        completed_at: i64,
        tokens_before: Option<u64>,
        #[serde(default)]
        tokens_after: Option<()>,
        failure_reason: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompactionTrigger {
    Manual,
    Automatic,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub agent_id: String,
    pub run_id: String,
    pub status: QuestionStatus,
    pub questions: Vec<QuestionPrompt>,
    pub auto_resolve_at: Option<i64>,
    pub answers: Option<BTreeMap<String, Vec<String>>>,
    pub version: String,
    pub created_at: i64,
    pub answered_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QuestionStatus {
    Pending,
    Answered,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionPrompt {
    pub id: String,
    pub header: String,
    pub question: String,
    pub multi_select: bool,
    pub options: Vec<QuestionOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct PendingQuestionResponse {
    pub question: Option<Question>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct QuestionResponse {
    pub question: Question,
}

// Current accepted mutation bodies. Optional fields are omitted, not emitted as null.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MutationOnlyRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

pub type ArchiveAgentRequest = MutationOnlyRequest;
pub type UnarchiveAgentRequest = MutationOnlyRequest;
pub type MarkAgentReadRequest = MutationOnlyRequest;
pub type CompactAgentRequest = MutationOnlyRequest;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReorderAgentRequest {
    pub after_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AbortAgentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentDraftRequest {
    pub draft: Option<AgentDraftRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDraftRequest {
    pub text: String,
    pub provider_id: String,
    pub model_id: String,
    pub effort: String,
    pub service_tier: Option<String>,
    pub permission_mode: MessagePermissionMode,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_metadata: Option<ClientMetadata>,
    /// Only inline images are accepted rich input. Files and tool-call requests are not send APIs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<SendMessageBlock>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery: Option<MessageDelivery>,
    pub mode: MessageMode,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum SendMessageBlock {
    Image { mime_type: String, data: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SendMessageResponse {
    pub message: UserMessage,
    pub cursor: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnswerQuestionRequest {
    pub answers: BTreeMap<String, Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeSlashCommandRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    pub mode: MessageMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeSlashCommandResponse {
    pub agent: Agent,
    pub slash_commands: Vec<SlashCommand>,
    pub command: SlashCommand,
    pub cursor: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAbortResponse {
    pub agent: Agent,
    pub slash_commands: Vec<SlashCommand>,
    pub cursor: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompactResponse {
    pub agent: Agent,
    pub slash_commands: Vec<SlashCommand>,
    pub run: Run,
    pub message: CompactionMessage,
    pub cursor: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompactionMessage {
    pub id: String,
    pub role: ServiceRole,
    pub created_at: i64,
    pub content: [CompactionEnvelope; 1],
    pub metadata: MessageMetadata,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceRole {
    Service,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CompactionEnvelope {
    Compaction(CompactionBlock),
}
