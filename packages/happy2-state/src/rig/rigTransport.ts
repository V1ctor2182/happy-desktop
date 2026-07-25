import type {
    RigBackgroundProcess,
    RigEventId,
    RigFileSearchResult,
    RigGoal,
    RigJson,
    RigMessage,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigPermissionReview,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigShellCommandResult,
    RigSessionId,
    RigSessionStatus,
    RigSessionSummary,
    RigSessionUsage,
    RigStopReason,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigToolFailure,
    RigToolPresentation,
    RigToolStatus,
    RigUserInputAnswers,
    RigUserInputRequest,
} from "./rigTypes.js";

/**
 * One live delta inside an `agent_event`. This is the streaming subset a chat
 * surface needs to build in-flight assistant text, thinking, and tool entries;
 * the fuller Rig `AgentLoopEvent` union collapses here to what the chat renders.
 */
export type RigAgentEvent =
    | { readonly type: "text_start" }
    | { readonly type: "text_delta"; readonly text: string }
    | { readonly type: "text_end" }
    | { readonly type: "thinking_start" }
    | { readonly type: "thinking_delta"; readonly thinking: string }
    | { readonly type: "thinking_end" }
    | { readonly type: "toolcall_start"; readonly toolCallId: string; readonly toolName: string }
    | {
          readonly type: "toolcall_delta";
          readonly toolCallId: string;
          readonly argumentsDelta: string;
      }
    | {
          readonly type: "toolcall_end";
          readonly toolCallId: string;
          readonly arguments: RigJson;
      }
    | {
          readonly type: "tool_execution_start";
          readonly toolCallId: string;
          readonly toolName: string;
          readonly arguments: RigJson;
      }
    | {
          readonly type: "tool_execution_progress";
          readonly toolCallId: string;
          readonly display: string;
      }
    | {
          readonly type: "tool_execution_status";
          readonly toolCallId: string;
          readonly status: RigToolStatus;
      }
    | {
          readonly type: "tool_execution_end";
          readonly toolCallId: string;
          readonly toolName: string;
          readonly display: string;
          readonly failed: boolean;
          readonly failure?: RigToolFailure;
          readonly presentation?: RigToolPresentation;
      }
    | {
          readonly type: "permission_review";
          readonly toolCallId: string;
          readonly review: RigPermissionReview;
      }
    | {
          readonly type: "context_compacted";
          readonly reason: "context_window" | "threshold";
          readonly estimatedTokensBefore: number;
          readonly estimatedTokensAfter: number;
      }
    | {
          readonly type: "inference_retry";
          readonly attempt: number;
          readonly maxAttempts: number;
          readonly reason: "connection_lost" | "incomplete_response";
      }
    | { readonly type: "done"; readonly reason: RigStopReason }
    | { readonly type: "error"; readonly reason: string };

/**
 * Per-session realtime event. Mirrors the chat-relevant members of Rig's
 * `SessionEvent` union (B7/B8) using this package's own projections. Realtime
 * events are delivery hints: durable state is reconciled from the carried
 * `session`/message payloads or by re-reading the session.
 */
export type RigSessionEvent = {
    readonly eventId: RigEventId;
    readonly sessionId: RigSessionId;
    readonly createdAt: number;
} & (
    | { readonly type: "session_created"; readonly session: RigSession }
    | { readonly type: "session_updated"; readonly session: RigSession }
    | {
          readonly type: "message_submitted";
          readonly message: RigMessage;
          readonly displayText: string;
          readonly runId: string;
          readonly delivery?: "run" | "steer";
      }
    | { readonly type: "run_started"; readonly runId: string }
    | { readonly type: "agent_event"; readonly runId: string; readonly event: RigAgentEvent }
    | { readonly type: "agent_message"; readonly runId: string; readonly message: RigMessage }
    | {
          readonly type: "run_finished";
          readonly runId: string;
          readonly stopReason: RigStopReason;
          readonly modelLocked: boolean;
      }
    | {
          readonly type: "run_error";
          readonly runId: string;
          readonly errorMessage: string;
          readonly modelLocked: boolean;
      }
    | { readonly type: "session_reset"; readonly messages: readonly RigMessage[] }
    | {
          readonly type: "session_rewound";
          readonly messageId: string;
          readonly messages: readonly RigMessage[];
      }
    | {
          readonly type: "session_title_changed";
          readonly status: "idle" | "generating" | "ready" | "error";
          readonly title?: string;
          readonly recap?: string;
      }
    | {
          readonly type: "model_changed";
          readonly modelId: string;
          readonly providerId: string;
          readonly effort?: RigThinkingLevel;
      }
    | {
          readonly type: "effort_changed";
          readonly modelId: string;
          readonly effort?: RigThinkingLevel;
      }
    | { readonly type: "service_tier_changed"; readonly serviceTier: RigServiceTier | null }
    | { readonly type: "permission_mode_changed"; readonly permissionMode: RigPermissionMode }
    | { readonly type: "user_input_requested"; readonly request: RigUserInputRequest }
    | {
          readonly type: "user_input_resolved";
          readonly requestId: string;
          readonly status: "answered" | "cancelled";
      }
    | { readonly type: "tasks_changed"; readonly tasks: readonly RigTask[] }
    | { readonly type: "goal_changed"; readonly goal: RigGoal | null }
    | { readonly type: "subagent_changed"; readonly subagent: RigSubagentSummary }
    | {
          readonly type: "background_processes_changed";
          readonly processes: readonly RigBackgroundProcess[];
      }
    | {
          readonly type: "shell_command_started";
          readonly commandId: string;
          readonly command: string;
      }
    | {
          readonly type: "shell_command_finished";
          readonly commandId: string;
          readonly command: string;
          readonly output: string;
          readonly exitCode: number | null;
          readonly timedOut: boolean;
      }
);

/** Global (cross-session) realtime event used to keep the session list current. */
export type RigGlobalEvent =
    | {
          readonly cursor: number;
          readonly type: "session_created";
          readonly session: RigSessionSummary;
      }
    | {
          readonly cursor: number;
          readonly type: "session_updated";
          readonly session: RigSessionSummary;
      }
    | {
          readonly cursor: number;
          readonly type: "session_title_changed";
          readonly sessionId: RigSessionId;
          readonly status: RigSessionStatus;
          readonly title?: string;
          readonly recap?: string;
      };

export interface RigEventObserver<Event> {
    event(value: Event): void;
    error(error: unknown): void;
    end(): void;
}

/**
 * Already-authenticated, already-connected boundary to a Rig daemon. The
 * implementation (in the desktop/app layer) owns URLs, tokens, sockets, retries,
 * and the projection from raw `@slopus/rig` protocol types into the closed
 * projections above — this state package never sees a wire shape.
 *
 * Terminals are deliberately absent: the chat/tools/menus surface does not need
 * remote terminals yet, so that protocol area is deferred.
 */
export interface RigTransport {
    /** The model catalog; read once and cached by the client composition root. */
    modelsRead(): Promise<RigModelCatalog>;

    sessionsRead(): Promise<readonly RigSessionSummary[]>;
    sessionRead(sessionId: RigSessionId): Promise<RigSession>;
    subagentsRead(sessionId: RigSessionId): Promise<readonly RigSubagentSummary[]>;

    sessionCreate(input: RigSessionCreateInput): Promise<RigSession>;
    sessionFork(sessionId: RigSessionId): Promise<RigSession>;
    sessionReset(sessionId: RigSessionId): Promise<RigSession>;

    /** Submits a fresh user turn; `idempotencyKey` is stable across retries of one send. */
    messageSubmit(sessionId: RigSessionId, text: string, idempotencyKey: string): Promise<void>;
    /** Steers the in-flight run with an additional user message. */
    messageSteer(
        sessionId: RigSessionId,
        text: string,
        idempotencyKey: string,
        expectedRunId?: string,
    ): Promise<void>;
    runAbort(sessionId: RigSessionId, expectedRunId?: string): Promise<void>;
    compact(sessionId: RigSessionId): Promise<void>;
    rewind(sessionId: RigSessionId, messageId: string): Promise<RigSession>;

    /**
     * Runs a one-off shell command in the session workspace (composer shell mode).
     * `commandId` is stable across retries of one invocation so the daemon can
     * dedupe. Resolves when the command finishes with its captured result; live
     * start/finish also arrive as `shell_command_started`/`shell_command_finished`
     * session events for transcript reconciliation.
     */
    shellRun(
        sessionId: RigSessionId,
        command: string,
        commandId: string,
    ): Promise<RigShellCommandResult>;
    /**
     * Requests termination of one background terminal (`/stop`). Resolves once the
     * daemon has processed the request; the durable removal arrives as a
     * `background_processes_changed` session event, so callers do not mutate state
     * from the return value.
     */
    backgroundProcessStop(sessionId: RigSessionId, processId: number): Promise<void>;

    changeModel(sessionId: RigSessionId, input: RigModelSelection): Promise<RigSession>;
    changeEffort(sessionId: RigSessionId, effort?: RigThinkingLevel): Promise<RigSession>;
    changePermissionMode(
        sessionId: RigSessionId,
        permissionMode: RigPermissionMode,
    ): Promise<RigSession>;
    changeServiceTier(sessionId: RigSessionId, serviceTier?: RigServiceTier): Promise<RigSession>;

    answerUserInput(sessionId: RigSessionId, input: RigUserInputAnswers): Promise<RigSession>;

    /**
     * Searches the session workspace for files matching `query`, powering the
     * composer's `@`-mention autocomplete. Bounded by `limit`; the daemon owns
     * ranking. Returns quickly and is safe to call on each keystroke.
     */
    filesSearch(
        sessionId: RigSessionId,
        query: string,
        limit?: number,
    ): Promise<readonly RigFileSearchResult[]>;

    /**
     * Fetches the current token/cost usage snapshot for a session (`/usage`). No
     * realtime channel exists for usage, so callers read on demand and poll while
     * a usage panel is visible.
     */
    usageGet(sessionId: RigSessionId): Promise<RigSessionUsage>;

    /** Subscribes to per-session realtime events; returns an unsubscribe function. */
    sessionEventsSubscribe(
        sessionId: RigSessionId,
        observer: RigEventObserver<RigSessionEvent>,
        afterEventId?: RigEventId,
    ): () => void;
    /** Subscribes to the global event queue; returns an unsubscribe function. */
    globalEventsSubscribe(
        observer: RigEventObserver<RigGlobalEvent>,
        afterCursor?: number,
    ): () => void;
    /** Fetches events missed since `afterEventId` after a reconnect gap. */
    sessionEventsBackfill(
        sessionId: RigSessionId,
        afterEventId: RigEventId,
    ): Promise<readonly RigSessionEvent[]>;
}
