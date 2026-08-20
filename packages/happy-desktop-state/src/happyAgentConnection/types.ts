import type {
    Agent,
    HappyAgentClient,
    HappyAgentEvent,
    MessageBlock,
    MessageMode,
    MutationId,
    Project,
} from "@slopus/happy-agent-client";
import type { RigDebugLogInput } from "../rig/rigDebugLogStore.js";

export type { MutationId };

export type ConnectionState = "connecting" | "live" | "reconnecting" | "closed";

interface RigProfile {
    id: string;
    name: string;
    photo?: { data: string; mediaType: string };
    version?: number;
}

export type ToolPresentation =
    | {
          kind: "compaction";
          trigger: "manual" | "automatic";
          tokensBefore?: number;
          tokensAfter?: number;
          failureReason?: string;
      }
    | {
          kind: "command";
          command: string;
          output?: string;
          terminalId?: number;
      }
    | {
          kind: "exploration";
          steps: readonly (
              | { kind: "list"; target: string }
              | { kind: "read"; name: string }
              | { kind: "search"; command: string; query?: string; path?: string }
          )[];
      }
    | {
          kind: "file_edit";
          files: readonly {
              path: string;
              kind: "add" | "delete" | "update";
              language?: string;
              added: number;
              deleted: number;
              omittedLines?: number;
              hunks: readonly {
                  oldStart: number;
                  newStart: number;
                  lines: readonly { kind: "context" | "add" | "delete"; text: string }[];
              }[];
          }[];
          omittedFiles?: number;
      }
    | {
          kind: "terminal_input";
          terminalId: number;
          command: string;
          input: string;
      }
    | {
          kind: "search";
          target: "web" | "x";
          query: string;
          sources?: readonly { url: string; title: string }[];
      };

interface BaseChatElement {
    id: string;
    groupId: string;
    runId: string;
    createdAt: number;
}

export interface UserMessageElement extends BaseChatElement {
    kind: "user_message";
    messageId: string;
    identity: string | null;
    profile?: RigProfile;
    delivery: "pending_steering" | "sent";
    text: string;
    attachments?: readonly { data: string; mediaType: string }[];
    source?: "notification";
}

export interface SystemNoticeElement extends BaseChatElement {
    kind: "system_notice";
    text: string;
    structured?: {
        kind: "compute_preparation";
        state: "unprovisioned" | "provisioning" | "ready" | "unavailable" | "failed" | "stopped";
        phase: string;
        provider: string;
        computeInstanceId: string;
        message: string;
        percent?: number;
        elapsedMs?: number;
    };
}

export interface InferenceElement extends BaseChatElement {
    kind: "inference";
    state: "waiting";
}

export interface AgentTextElement extends BaseChatElement {
    kind: "agent_text";
    text: string;
    complete: boolean;
}

export interface AgentAttachmentsElement extends BaseChatElement {
    kind: "agent_attachments";
    messageId: string;
    attachments: readonly AgentAttachment[];
}

export type AgentAttachment =
    | {
          bytes: number;
          downloadUrl?: string;
          height: number;
          id: string;
          kind: "image";
          mediaType: string;
          name: string;
          source: string;
          thumbhash: string;
          width: number;
      }
    | {
          bytes: number;
          downloadUrl?: string;
          duration: number;
          height: number;
          id: string;
          kind: "video";
          mediaType?: string;
          name: string;
          preview: {
              downloadUrl?: string;
              height: number;
              mediaType: "image/png";
              path: string;
              thumbhash: string;
              width: number;
          };
          source: string;
          width: number;
      }
    | {
          bytes: number;
          downloadUrl?: string;
          duration: number;
          id: string;
          kind: "audio";
          mediaType?: string;
          name: string;
          source: string;
      }
    | {
          bytes: number;
          downloadUrl?: string;
          id: string;
          kind: "file";
          mediaType?: string;
          name: string;
          source: string;
      }
    | {
          description?: string;
          id: string;
          image?: string;
          kind: "url";
          siteName?: string;
          source: string;
          title: string;
      }
    | {
          applet: string;
          description: string;
          id: string;
          image: string;
          kind: "applet";
          name: string;
          path?: string;
          query?: Record<string, string>;
          thumbhash: string;
      };

export interface ThinkingElement extends BaseChatElement {
    kind: "thinking";
    text: string;
    complete: boolean;
}

export type ToolCallStatus = "pending" | "running" | "succeeded" | "failed" | "interrupted";

export interface ToolCallElement extends BaseChatElement {
    kind: "tool_call";
    toolCallId: string;
    name: string;
    arguments: unknown;
    argumentsComplete: boolean;
    status: ToolCallStatus;
    progress?: string;
    result?: string;
    presentation?: ToolPresentation;
    /**
     * The call crossed the automatic permission-review boundary and its
     * execution was granted temporary Full access. Absent on a call that was
     * never reviewed and on a reviewed call that stayed inside the sandbox.
     */
    elevated?: boolean;
    permissionReview?:
        | {
              action: string;
              status: "reviewing";
          }
        | {
              action: string;
              status: "completed";
              reason: string;
              decision: "allow" | "ask" | "deny";
              risk: "low" | "medium" | "high" | "critical";
              userAuthorization: "unknown" | "low" | "medium" | "high";
          };
}

export interface CompactionElement extends BaseChatElement {
    kind: "compaction";
    compactionId: string;
    status: "running" | "completed" | "cancelled" | "failed";
    estimatedTokensBefore: number;
    estimatedTokensAfter?: number;
}

export interface FailureElement extends BaseChatElement {
    kind: "failure";
    outcome: "retried" | "continued" | "failed";
    attempt?: number;
    reason: string;
}

export type GroupEndReason = "completed" | "steering" | "compaction" | "abort" | "error";

export interface GroupEndElement extends BaseChatElement {
    kind: "group_end";
    turnKind?: "compaction";
    outcome: "success" | "error" | "stopped";
    reason: GroupEndReason;
    errorMessage?: string;
    startedAt: number;
    endedAt: number;
    elapsedMs: number;
    turnStartedAt: number;
    turnElapsedMs: number;
}

export type ChatElement =
    | UserMessageElement
    | SystemNoticeElement
    | InferenceElement
    | AgentTextElement
    | AgentAttachmentsElement
    | ThinkingElement
    | ToolCallElement
    | CompactionElement
    | FailureElement
    | GroupEndElement;

export interface UserInputRequest {
    requestId: string;
    questions: readonly {
        id: string;
        header: string;
        question: string;
        multiSelect: boolean;
        required?: boolean;
        options: readonly { label: string; description: string }[];
    }[];
}

export interface SessionUsage {
    currentProviderId: string;
    groups: readonly {
        modelId: string;
        providerId: string;
        usage: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            totalTokens: number;
            reasoning?: number;
            cost: { total: number };
        };
    }[];
    totalTokens: number;
    totalCost: number;
    context?: {
        modelId?: string;
        providerId: string;
        totalTokens: number;
        contextWindow: number | null;
        approximate: boolean;
    };
    quotas: readonly {
        providerId: string;
        quota: {
            windows: {
                fiveHour?: { status: "available"; usedPercent: number; resetsAt: number };
                weekly?: { status: "available"; usedPercent: number; resetsAt: number };
            };
        };
    }[];
}

export interface SessionState {
    /** The connection's placeholder before the first durable history snapshot arrives. */
    historyLoading?: boolean;
    activity: {
        kind:
            | "idle"
            | "queued"
            | "thinking"
            | "generating_message"
            | "generating_tool_call"
            | "executing_tool_call";
        label: string;
        since: number;
        wait?: { startedAt: number; dueAt: number };
    };
    activeGroup?: { groupId: string; runId: string; startedAt: number };
    activeTurn?: { runId: string; startedAt: number; kind?: "compaction" };
    status: "idle" | "running" | "completed" | "failed" | "suspended";
    archived: boolean;
    sessionId: string;
    ownerInstanceId: string;
    scope:
        | { kind: "project"; projectId: string }
        | { kind: "workspace"; projectId: string; workspaceId: string }
        | { kind: "unsorted" };
    projectId?: string;
    workspaceId?: string;
    orderKey?: string;
    cwd: string;
    draft?: string;
    draftUpdatedAt?: number;
    modelId: string;
    providerId: string;
    title?: string;
    recap?: string;
    titleStatus: "error" | "generating" | "idle" | "ready";
    effort?: string;
    serviceTier?: string;
    permissionMode: string;
    modelLocked: boolean;
    modelCatalog: {
        defaultModelId: string;
        defaultProviderId: string;
        models: readonly unknown[];
        providers: readonly unknown[];
    };
    models: readonly unknown[];
    pendingUserInputs: readonly UserInputRequest[];
    pendingSteeringMessages: readonly {
        message: { id: string; blocks: readonly MessageBlock[] };
    }[];
    tasks: readonly {
        id: string;
        subject: string;
        description: string;
        status: "pending" | "in_progress" | "completed";
        activeForm?: string;
        owner?: string;
        blockedBy: readonly string[];
        blocks: readonly string[];
    }[];
    goal?: {
        objective: string;
        status: "active" | "blocked" | "complete" | "paused";
        createdAt: number;
        updatedAt: number;
    };
    subagents: readonly {
        id: string;
        parentSessionId: string;
        parentToolCallId?: string;
        description: string;
        taskName?: string;
        modelId: string;
        status:
            | "idle"
            | "queued"
            | "running"
            | "completed"
            | "aborted"
            | "suspended"
            | "error"
            | "archived";
        depth: number;
        createdAt: number;
        updatedAt: number;
        activeSince?: number;
        elapsedMs?: number;
        latestText?: string;
        totalTokens?: number;
    }[];
    backgroundProcesses: readonly {
        sessionId: number;
        command: string;
        cwd: string;
        status: "running";
    }[];
    usage?: SessionUsage;
    connection: ConnectionState;
    transcriptComplete: boolean;
    loadMoreToken?: string;
    loadingMore: boolean;
    loadMoreError?: string;
    lastEventId?: string;
}

export type ChatDelta =
    | { type: "elements_changed"; elements: readonly ChatElement[] }
    | { type: "session_changed"; session: SessionState }
    | { type: "connection_changed"; connection: ConnectionState }
    | MutationRejectedDelta;

export interface GitChangeSnapshot {
    changedFiles: number;
    insertions: number;
    deletions: number;
    files: readonly {
        path: string;
        previousPath?: string;
        status: string;
        staged: boolean;
        unstaged: boolean;
        binary: boolean;
        insertions?: number;
        deletions?: number;
    }[];
    generation: string;
    version: number;
    revision?: string;
}

export interface GroupSession {
    archived: boolean;
    createdAt: number;
    cwd: string;
    draft?: string;
    draftUpdatedAt?: number;
    effort?: string;
    id: string;
    lastMessageAt?: number;
    modelId: string;
    ownerInstanceId: string;
    orderKey?: string;
    permissionMode: string;
    scope:
        | { kind: "project"; projectId: string }
        | { kind: "workspace"; projectId: string; workspaceId: string };
    providerId: string;
    recap?: string;
    serviceTier?: string;
    status: SessionState["status"];
    title?: string;
    trackUnread: boolean;
    unread?: { reason: "attention_needed" | "turn_finished"; since: number };
    wait?: { startedAt: number; dueAt: number };
    updatedAt: number;
}

export interface WorkspaceGroup {
    id: string;
    name: string;
    orderKey: string;
    path: string;
    presence: "present" | "missing";
    projectId: string;
    status: "initializing" | "ready" | "failed";
    error?: string;
    git?: GitChangeSnapshot;
    sessions: readonly GroupSession[];
    usage: { totalTokens: number };
    unread: { count: number; attentionCount: number; reason?: string; since?: number };
}

export interface ProjectGroup {
    id: string;
    kind: "regular" | "home";
    name: string;
    branch?: string;
    orderKey: string;
    path: string;
    presence: "present" | "missing";
    initializationError?: string;
    initializationStatus: "initializing" | "ready" | "failed";
    remoteSource?: { kind: "github"; repository: string } | { kind: "git"; url: string };
    requiredSecretKind?: "github";
    avatar?: { height: number; url: string; width: number };
    git?: GitChangeSnapshot;
    usage: { totalTokens: number };
    unread: { count: number; attentionCount: number; reason?: string; since?: number };
    workspaces: readonly WorkspaceGroup[];
    sessions: readonly GroupSession[];
}

export interface GroupsState {
    connection: ConnectionState;
    sessionsComplete: boolean;
}

export type GroupDelta =
    | { type: "projects_changed"; projects: readonly ProjectGroup[] }
    | { type: "groups_state_changed"; state: GroupsState }
    | { type: "project_added"; projectId: string }
    | { type: "workspace_added"; projectId: string; workspaceId: string }
    | { type: "session_added"; sessionId: string }
    | { type: "session_removed"; sessionId: string }
    | MutationRejectedDelta;

export type MutationAction =
    | "create_project"
    | "archive_project"
    | "create_workspace"
    | "archive_workspace"
    | "create_session"
    | "send_message"
    | "stop_background_process"
    | "stop_run"
    | "switch_model"
    | "set_effort"
    | "set_service_tier"
    | "set_permission_mode"
    | "set_draft"
    | "answer_user_input"
    | "compact_session"
    | "set_session_archived"
    | "mark_session_read"
    | "rename_group"
    | "reorder_group"
    | "reorder_session";

export interface MutationRejectedDelta {
    action: string;
    message: string;
    mutationId: string;
    type: "mutation_rejected";
}

export interface RigSessionSubscriptionOptions {
    sessionId: string;
    onChange: (elements: readonly ChatElement[], session: SessionState) => void;
    onDelta?: (delta: ChatDelta) => void;
    onError?: (error: unknown) => void;
    transcriptTurnLimit?: number;
}

export interface RigSessionConnection {
    elements: () => readonly ChatElement[];
    session: () => SessionState;
    loadMore: (token: string) => void;
    close: () => void;
}

export interface RigGroupsSubscriptionOptions {
    onChange: (projects: readonly ProjectGroup[], state: GroupsState) => void;
    onDelta?: (delta: GroupDelta) => void;
    onError?: (error: unknown) => void;
}

export interface RigGroupsConnection {
    projects: () => readonly ProjectGroup[];
    state: () => GroupsState;
    close: () => void;
}

export interface SendMessageInput {
    content?: readonly (
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; data: string }
    )[];
    text: string;
}

export interface DraftUpdate {
    draft: string | null;
    updatedAt?: number;
    origin?: string;
}

export interface ModelSelection {
    modelId: string;
    providerId?: string;
}

export interface CreateSessionInput {
    cwd: string;
    effort?: string;
    modelId?: string;
    permissionMode?: string;
    projectId?: string;
    providerId?: string;
    serviceTier?: string;
    workspaceId?: string;
}

export interface CreateWorkspaceInput {
    baseRef?: string;
    name: string;
    projectId: string;
}

export interface ProjectAddOptions {
    projectId?: string;
    signal?: AbortSignal;
}

export interface CreateRemoteProjectInput {
    name: string;
    projectId?: string;
    secret?: { kind: "github" };
    source: { kind: "github"; repository: string } | { kind: "git"; url: string };
}

export type GroupTarget =
    | { kind: "project"; projectId: string }
    | { kind: "workspace"; projectId: string; workspaceId: string };

export interface UserInputAnswers {
    answers: Readonly<Record<string, readonly string[]>>;
}

export interface ConnectHappyAgentOptions {
    endpoint: string | URL;
    token: string;
    /** Reuses the composition root's stateless client instead of opening a second authority. */
    client?: HappyAgentClient;
    fetch?: typeof globalThis.fetch;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    onMutationRejected?: (delta: MutationRejectedDelta) => void;
    onCompatibilityChange?: (compatibility: ServerCompatibility) => void;
    /** Receives bounded, display-ready diagnostics without exposing credentials. */
    onDebugEntry?: (entry: RigDebugLogInput) => void;
    onSessionFinished?: (sessionId: string) => void;
}

export interface RigConnection {
    compatibility: () => ServerCompatibility;
    connectSession: (options: RigSessionSubscriptionOptions) => RigSessionConnection;
    connectGroups: (options: RigGroupsSubscriptionOptions) => RigGroupsConnection;
    projects: {
        add(path: string, options?: ProjectAddOptions): Promise<Project>;
        archive(projectId: string): MutationId;
        clone(input: CreateRemoteProjectInput): MutationId;
    };
    createWorkspace(input: CreateWorkspaceInput): MutationId;
    archiveWorkspace(projectId: string, workspaceId: string): MutationId;
    createSession(input: CreateSessionInput): MutationId;
    markSessionRead(sessionId: string): MutationId;
    sendMessage(sessionId: string, message: string | SendMessageInput): MutationId;
    stopBackgroundProcess(sessionId: string, projectedProcessId: number): MutationId;
    stopRun(sessionId: string): MutationId;
    compactSession(sessionId: string): MutationId;
    setDraft(sessionId: string, update: string | DraftUpdate): MutationId;
    switchModel(sessionId: string, selection: string | ModelSelection): MutationId;
    setEffort(sessionId: string, effort?: string): MutationId;
    setServiceTier(sessionId: string, serviceTier?: string): MutationId;
    setPermissionMode(sessionId: string, permissionMode: string): MutationId;
    answerUserInput(sessionId: string, requestId: string, response: UserInputAnswers): MutationId;
    setSessionArchived(sessionId: string, archived: boolean): MutationId;
    renameGroup(target: GroupTarget, name: string): MutationId;
    reorderProject(projectId: string, afterId: string | null): MutationId;
    reorderWorkspace(workspaceId: string, afterId: string | null): MutationId;
    reorderSession(sessionId: string, afterId: string | null): MutationId;
    close(): void;
}

export type ServerCompatibility =
    | {
          status: "checking";
          maximumSupportedProtocolVersion: number;
          minimumSupportedProtocolVersion: number;
      }
    | {
          status: "compatible" | "server_outdated" | "client_outdated";
          maximumSupportedProtocolVersion: number;
          minimumSupportedProtocolVersion: number;
          serverProtocolVersion: number;
      };

export type SessionEvent = HappyAgentEvent;
export interface SessionStreamHello {
    connection: ConnectionState;
    session?: SessionState;
}

export type ProtocolSession = Partial<SessionState> & {
    id: string;
    archived: boolean;
    cwd: string;
    modelId: string;
    ownerInstanceId: string;
    permissionMode: string;
    providerId: string;
};

export interface ChatStoreSnapshot {
    agent: Agent;
    mode: MessageMode;
}
