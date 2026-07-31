import type {
    CreateRemoteTerminalRequest,
    HealthResponse,
    ModelCatalog,
    ProtocolSession as PublishedProtocolSession,
    RemoteTerminalResponse,
    RemoteTerminalSummary,
    SubagentSummary,
} from "@slopus/rig/types";

export type {
    CreateRemoteTerminalRequest,
    HealthResponse,
    ModelCatalog,
    RemoteTerminalResponse,
    RemoteTerminalSummary,
    SubagentSummary,
};

export type ProtocolSession = PublishedProtocolSession & {
    readonly draft?: string;
    readonly draftUpdatedAt?: number;
};

/**
 * Rig's project/worktree protocol shapes. They are part of the daemon's HTTP
 * surface but not of its published `@slopus/rig/types` entry point, so — like the
 * session summary and event shapes below — this file states the subset Happy
 * reads. Anything the projection does not consume is deliberately absent.
 */
export interface ProjectAvatar {
    readonly hash: string;
    readonly width: number;
    readonly height: number;
    readonly mediaType: "image/webp";
    /** Daemon-relative asset path (`/project-assets/<hash>`). */
    readonly url: string;
}

export interface Project {
    readonly id: string;
    readonly kind: "regular" | "home";
    readonly name: string;
    /** Fractional index the daemon sorts projects by, ascending then by id. */
    readonly orderKey: string;
    readonly path: string;
    readonly initializationStatus: "initializing" | "ready" | "failed";
    readonly avatar?: ProjectAvatar;
    /** Optimistic-concurrency token the daemon requires to guard a reorder or an archive. */
    readonly version: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    /**
     * When the project was archived; absent while it is listed. The daemon keeps
     * archived projects in its catalog reads, so the projection below is what
     * leaves them out of the workspace list.
     */
    readonly archivedAt?: number;
    readonly git?: GitRepositoryFacts;
    readonly changedFiles?: number;
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: readonly GitChangedFile[];
}

export type ProjectWorkspaceStatus =
    | "initializing"
    | "ready"
    | "failed"
    | "archiving"
    | "archive_failed"
    | "archived";

export interface ProjectWorkspace {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    /** Fractional index the daemon sorts a project's worktrees by. */
    readonly orderKey: string;
    readonly path: string;
    readonly status: ProjectWorkspaceStatus;
    /** Optimistic-concurrency token the daemon requires to guard an archive or reorder. */
    readonly version: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly git?: GitRepositoryFacts;
    readonly changedFiles?: number;
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: readonly GitChangedFile[];
}

export interface GitChangedFile {
    readonly path: string;
    readonly previousPath?: string;
    readonly status: "added" | "deleted" | "modified" | "renamed" | "untracked";
    readonly revision: string;
    /** Lines gained and lost against HEAD. Absent when the file is binary. */
    readonly addedLines?: number;
    readonly deletedLines?: number;
}

/**
 * The daemon's one-shot catalog read. It carries the whole global snapshot —
 * model catalog, identity, sessions, terminal groups — but Happy reads it only
 * for projects and worktrees, so the rest is deliberately absent here.
 */
export interface GlobalCatalogResponse {
    readonly projects: readonly Project[];
    readonly workspaces: readonly ProjectWorkspace[];
}

export interface GitRepositoryFacts {
    readonly ahead: number;
    readonly behind: number;
    readonly detached: boolean;
}

export interface GitChangeSnapshot {
    readonly changedFiles: number;
}

export type GlobalLiveEvent =
    | {
          readonly type: "project_git_changed";
          readonly projectId: string;
          readonly data: { readonly git: GitChangeSnapshot };
      }
    | {
          readonly type: "workspace_git_changed";
          readonly projectId: string;
          readonly workspaceId: string;
          readonly data: { readonly git: GitChangeSnapshot };
      };

export type GlobalEventDelivery =
    | GlobalEventQueueEntry
    | { readonly live: true; readonly event: GlobalLiveEvent };

export interface GitWatchResponse {
    readonly snapshots: readonly GlobalLiveEvent[];
}

/** One project avatar's bytes, as the daemon's asset route serves them. */
export interface ProjectAssetResponse {
    readonly bytes: Buffer;
    readonly mediaType: string;
}

export type EventId = string;
export type AgentSnapshot = ProtocolSession["snapshot"];
export type Message = AgentSnapshot["messages"][number];
export type AgentMessage = Extract<Message, { readonly role: "agent" }>;
export type AgentBlock = AgentMessage["blocks"][number];
export type ToolResultBlock = Extract<AgentBlock, { readonly type: "tool_result" }>;
export type ToolResultPresentation = NonNullable<ToolResultBlock["presentation"]>;
export type ToolCallPresentation = NonNullable<
    Extract<AgentBlock, { readonly type: "tool_call" }>["presentation"]
>;
export type FileDiff = Extract<
    ToolResultPresentation,
    { readonly type: "file_diff" }
>["files"][number];
export type Model = ModelCatalog["models"][number];
export type UserInputRequest = ProtocolSession["pendingUserInputs"][number];
export type SessionTask = ProtocolSession["tasks"][number];
export type SessionGoal = NonNullable<ProtocolSession["goal"]>;
export type BashSessionActivity = NonNullable<ProtocolSession["backgroundProcesses"]>[number];

export interface SessionSummary {
    readonly id: string;
    readonly projectId: string;
    readonly workspaceId?: string;
    /**
     * Fractional index the daemon sorts sessions by within their group. Absent
     * for a session with no place in an ordered list, such as a subagent.
     */
    readonly orderKey?: string;
    readonly cwd: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly permissionMode: ProtocolSession["permissionMode"];
    readonly status: ProtocolSession["status"];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly effort?: string;
    readonly serviceTier?: ProtocolSession["serviceTier"];
    readonly title?: string;
    readonly recap?: string;
    readonly lastMessageAt?: number;
    readonly titleStatus: ProtocolSession["titleStatus"];
    readonly draft?: string;
    readonly draftUpdatedAt?: number;
}

export interface UsageValue {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly totalTokens: number;
    readonly reasoning?: number;
    readonly cost: { readonly total: number };
}

export interface GetSessionUsageResponse {
    readonly currentProviderId: string;
    readonly groups: readonly {
        readonly modelId: string;
        readonly providerId: string;
        readonly usage: UsageValue;
    }[];
    readonly context?: {
        readonly approximate: boolean;
        readonly modelId: string;
        readonly providerId: string;
        readonly totalTokens: number;
    };
    readonly quotas: readonly {
        readonly providerId: string;
        readonly quota: {
            readonly windows: {
                readonly fiveHour?: QuotaWindow;
                readonly weekly?: QuotaWindow;
            };
        };
    }[];
}

type QuotaWindow =
    | {
          readonly status: "available";
          readonly usedPercent: number;
          readonly resetsAt: number;
      }
    | { readonly status: "unavailable" };

export type RunShellCommandResponse =
    | {
          readonly status: "running";
          readonly command: string;
          readonly commandId: string;
          readonly eventId: EventId;
          readonly sessionId: number;
      }
    | {
          readonly status: "finished";
          readonly command: string;
          readonly commandId: string;
          readonly eventId: EventId;
          readonly output: string;
          readonly exitCode: number | null;
          readonly timedOut: boolean;
          readonly errorMessage?: string;
          readonly sessionId?: number;
      };

export interface ToolCall {
    readonly type: "toolCall";
    readonly id: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly presentation?: ToolCallPresentation;
}

export interface AssistantMessage {
    readonly content: readonly (
        | ToolCall
        | { readonly type: "text" | "thinking" | "image"; readonly [key: string]: unknown }
    )[];
}

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type AgentLoopEvent =
    | {
          readonly type: "text_start" | "text_end" | "thinking_start" | "thinking_end";
          readonly messageId: string;
      }
    | {
          readonly type: "text_delta" | "thinking_delta";
          readonly delta: string;
          readonly messageId: string;
      }
    | {
          readonly type: "toolcall_start" | "toolcall_delta";
          readonly partial: AssistantMessage;
          readonly contentIndex: number;
          readonly delta: string;
          readonly messageId: string;
      }
    | { readonly type: "toolcall_end"; readonly toolCall: ToolCall; readonly messageId: string }
    | { readonly type: "done"; readonly reason: StopReason; readonly messageId: string }
    | {
          readonly type: "error";
          readonly reason: string;
          readonly error: { readonly errorMessage?: string };
          readonly messageId: string;
      }
    | {
          readonly type: "context_compacted";
          readonly reason: "context_window" | "manual" | "threshold";
          readonly estimatedTokensBefore: number;
          readonly estimatedTokensAfter: number;
      }
    | {
          readonly type: "inference_retry";
          readonly attempt: number;
          readonly maxAttempts: number;
          readonly reason: "connection_lost" | "incomplete_response";
      }
    | {
          readonly type: "tool_execution_start";
          readonly toolCall: ToolCall;
      }
    | {
          readonly type: "tool_execution_progress";
          readonly toolCallId: string;
          readonly display: string;
      }
    | {
          readonly type: "tool_execution_end";
          readonly result: Pick<
              ToolResultBlock,
              "display" | "failure" | "isError" | "presentation" | "toolCallId" | "toolName"
          >;
      }
    /**
     * The bracket around one compaction pass. Neither end carries a payload:
     * the sizes it compacted between arrive separately as `context_compacted`,
     * so these two only report that the pass is under way.
     */
    | { readonly type: "context_compaction_started" | "context_compaction_finished" }
    | {
          readonly type:
              | "background_processes_stopped"
              | "permission_denial_limit_reached"
              | "permission_review"
              | "steering_applied"
              | "tool_batch_rejected"
              | "tool_execution_status";
      }
    | {
          readonly type: "inference_iteration_start";
          readonly iteration: number;
          readonly messageId: string;
      }
    | {
          readonly type: "background_processes_changed";
          readonly processes?: readonly BashSessionActivity[];
          readonly running: number;
      };

interface BaseSessionEvent<TType extends string, TData> {
    readonly createdAt: number;
    readonly data: TData;
    readonly id: EventId;
    readonly sessionId: string;
    readonly type: TType;
}

type ProjectedSessionEvent =
    | BaseSessionEvent<"session_created" | "session_updated", { readonly session: ProtocolSession }>
    | BaseSessionEvent<
          "message_submitted",
          {
              readonly displayText: string;
              readonly delivery?: "run" | "steer";
              readonly message: Message;
              readonly runId: string;
          }
      >
    | BaseSessionEvent<"run_started", { readonly runId: string }>
    | BaseSessionEvent<"agent_event", { readonly event: AgentLoopEvent; readonly runId: string }>
    | BaseSessionEvent<"agent_message", { readonly message: Message; readonly runId: string }>
    | BaseSessionEvent<
          "run_finished",
          {
              readonly errorMessage?: string;
              readonly modelLocked: boolean;
              readonly runId: string;
              readonly stopReason: StopReason;
          }
      >
    | BaseSessionEvent<
          "run_error",
          { readonly errorMessage: string; readonly modelLocked: boolean; readonly runId: string }
      >
    | BaseSessionEvent<"session_reset", { readonly snapshot: AgentSnapshot }>
    | BaseSessionEvent<
          "session_rewound",
          { readonly messageId: string; readonly snapshot: AgentSnapshot }
      >
    | BaseSessionEvent<
          "session_title_changed",
          {
              readonly recap?: string;
              readonly status: "idle" | "generating" | "ready" | "error";
              readonly title?: string;
          }
      >
    | BaseSessionEvent<
          "model_changed",
          {
              readonly effort?: string;
              readonly modelId: string;
              readonly snapshot: AgentSnapshot;
          }
      >
    | BaseSessionEvent<"effort_changed", { readonly effort?: string; readonly modelId: string }>
    | BaseSessionEvent<
          "service_tier_changed",
          { readonly serviceTier: ProtocolSession["serviceTier"] | null }
      >
    | BaseSessionEvent<
          "permission_mode_changed",
          { readonly permissionMode: ProtocolSession["permissionMode"] }
      >
    | BaseSessionEvent<
          "session_draft_changed",
          { readonly draft?: string; readonly origin?: string; readonly updatedAt: number }
      >
    | BaseSessionEvent<"user_input_requested", UserInputRequest>
    | BaseSessionEvent<
          "user_input_resolved",
          { readonly requestId: string; readonly status: "answered" | "cancelled" }
      >
    | BaseSessionEvent<"tasks_changed", { readonly tasks: readonly SessionTask[] }>
    | BaseSessionEvent<"goal_changed", { readonly goal: SessionGoal | null }>
    | BaseSessionEvent<"subagent_changed", { readonly subagent: SubagentSummary }>
    | BaseSessionEvent<
          "shell_command_started",
          { readonly commandId: string; readonly command: string }
      >
    | BaseSessionEvent<
          "shell_command_finished",
          {
              readonly commandId: string;
              readonly command: string;
              readonly output: string;
              readonly exitCode: number | null;
              readonly timedOut: boolean;
          }
      >;

type UnprojectedSessionEventType =
    | "abort_requested"
    | "external_tool_call_requested"
    | "external_tool_call_resolved"
    | "mcp_servers_changed"
    | "provider_quota_observed"
    | "secrets_changed"
    | "steering_applied"
    | "subagents_suspended"
    | "workflow_changed";

export type SessionEvent =
    | ProjectedSessionEvent
    | BaseSessionEvent<UnprojectedSessionEventType, unknown>;

interface BaseProjectEvent<TType extends string, TData> {
    readonly createdAt: number;
    readonly data: TData;
    readonly id: EventId;
    readonly projectId: string;
    readonly type: TType;
}

/** Project and worktree lifecycle events, delivered on the same global queue as session events. */
export type ProjectEvent =
    | BaseProjectEvent<"project_created" | "project_updated", { readonly project: Project }>
    | (BaseProjectEvent<
          "workspace_created" | "workspace_updated",
          { readonly workspace: ProjectWorkspace }
      > & { readonly workspaceId: string });

export type GlobalEvent = SessionEvent | ProjectEvent;

export interface GlobalEventQueueEntry {
    /**
     * Opaque queue position. Rig made this a string when the queue started
     * carrying project events, so it is echoed back as-is rather than parsed.
     */
    readonly cursor: string;
    readonly event: GlobalEvent;
}
