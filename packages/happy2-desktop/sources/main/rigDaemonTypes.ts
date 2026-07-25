import type {
    HealthResponse,
    ModelCatalog,
    ProtocolSession,
    SubagentSummary,
} from "@slopus/rig/types";

export type { HealthResponse, ModelCatalog, ProtocolSession, SubagentSummary };

export type EventId = string;
export type AgentSnapshot = ProtocolSession["snapshot"];
export type Message = AgentSnapshot["messages"][number];
export type AgentMessage = Extract<Message, { readonly role: "agent" }>;
export type AgentBlock = AgentMessage["blocks"][number];
export type ToolResultBlock = Extract<AgentBlock, { readonly type: "tool_result" }>;
export type ToolResultPresentation = NonNullable<ToolResultBlock["presentation"]>;
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
}

export interface AssistantMessage {
    readonly content: readonly (
        | ToolCall
        | { readonly type: "text" | "thinking" | "image"; readonly [key: string]: unknown }
    )[];
}

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type AgentLoopEvent =
    | { readonly type: "text_start" | "text_end" | "thinking_start" | "thinking_end" }
    | { readonly type: "text_delta" | "thinking_delta"; readonly delta: string }
    | {
          readonly type: "toolcall_start" | "toolcall_delta";
          readonly partial: AssistantMessage;
          readonly contentIndex: number;
          readonly delta: string;
      }
    | { readonly type: "toolcall_end"; readonly toolCall: ToolCall }
    | { readonly type: "done"; readonly reason: StopReason }
    | {
          readonly type: "error";
          readonly reason: string;
          readonly error: { readonly errorMessage?: string };
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
    | {
          readonly type:
              | "background_processes_stopped"
              | "context_compaction_finished"
              | "context_compaction_started"
              | "inference_iteration_start"
              | "permission_denial_limit_reached"
              | "permission_review"
              | "steering_applied"
              | "tool_batch_rejected"
              | "tool_execution_status";
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

export interface GlobalEventQueueEntry {
    readonly cursor: number;
    readonly event: SessionEvent;
}
