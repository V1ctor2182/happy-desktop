import type { TerminalConnection } from "../transport.js";
import type {
    RigBackgroundProcess,
    RigEventId,
    RigFileSearchResult,
    RigGoal,
    RigImageInput,
    RigJson,
    RigMessage,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigPermissionReview,
    RigProjectCatalog,
    RigProjectId,
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
    RigTerminal,
    RigTerminalId,
    RigThinkingLevel,
    RigToolFailure,
    RigToolPresentation,
    RigToolStatus,
    RigUserInputAnswers,
    RigUserInputRequest,
    RigWorktree,
    RigWorktreeId,
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
          readonly errorMessage?: string;
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
    | {
          readonly type: "session_draft_changed";
          readonly draft?: string;
          readonly origin?: string;
          readonly updatedAt: number;
      }
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

/** Global (cross-session) realtime event used to keep the workspace list current. */
export type RigGlobalEvent =
    | {
          readonly cursor: string;
          readonly type: "session_created";
          readonly session: RigSessionSummary;
      }
    | {
          readonly cursor: string;
          readonly type: "session_updated";
          readonly session: RigSessionSummary;
      }
    | {
          readonly cursor: string;
          readonly type: "session_title_changed";
          readonly sessionId: RigSessionId;
          readonly status: RigSessionStatus;
          readonly title?: string;
          readonly recap?: string;
      }
    | {
          readonly cursor: string;
          readonly type: "session_activity_changed";
          readonly sessionId: RigSessionId;
      }
    /**
     * A project or worktree was created or changed — its name, picture, or
     * initialization state. Payload-free on purpose: the list reconciles the
     * catalog rather than trusting an event.
     */
    | { readonly cursor: string; readonly type: "catalog_changed" }
    | {
          readonly type: "git_changed";
          readonly projectId: RigProjectId;
          readonly worktreeId?: RigWorktreeId;
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
 */
export interface RigTransport {
    /** The model catalog; read once and cached by the client composition root. */
    modelsRead(): Promise<RigModelCatalog>;

    /**
     * The host's project and worktree catalog: the durable groups the workspace
     * lists sessions under. Read alongside `sessionsRead` on every reconcile, so
     * a renamed project or a freshly created worktree lands with the sessions
     * that belong to it rather than one tick apart.
     */
    projectsRead(): Promise<RigProjectCatalog>;

    sessionsRead(): Promise<readonly RigSessionSummary[]>;
    sessionRead(sessionId: RigSessionId): Promise<RigSession>;
    subagentsRead(sessionId: RigSessionId): Promise<readonly RigSubagentSummary[]>;

    sessionCreate(input: RigSessionCreateInput): Promise<RigSession>;
    sessionFork(sessionId: RigSessionId): Promise<RigSession>;
    sessionReset(sessionId: RigSessionId): Promise<RigSession>;
    /**
     * Closes a session: it stops being listed by `sessionsRead` from here on,
     * durably, while the session itself keeps existing and stays readable by id.
     * Archiving is a host decision, not a run-state change, so it reports nothing
     * back beyond completing.
     */
    sessionArchive(sessionId: RigSessionId): Promise<void>;
    /**
     * Moves one session directly after `afterId` within its own group, or to the
     * front of that group when `afterId` is null. The host owns presentation
     * order — `sessionsRead` already returns sessions in it — and mints the
     * moved session's new key, so this reports one move rather than restating
     * the whole arrangement; two clients dragging different rows therefore both
     * land instead of overwriting each other.
     */
    sessionReorder(sessionId: RigSessionId, afterId: RigSessionId | null): Promise<void>;

    /** Moves one project after `afterId`, or to the front of the list when null. */
    projectReorder(projectId: RigProjectId, afterId: RigProjectId | null): Promise<void>;

    /**
     * Archives a project: it stops being listed by `projectsRead`, its
     * conversations are closed, and its worktrees are archived with their
     * checkouts removed by the host. The directory itself stays, and the host
     * restores the project when work starts in it again — which is why there is
     * no unarchive here.
     */
    projectArchive(projectId: RigProjectId): Promise<void>;

    /**
     * Reserves a worktree in the project and resolves with it while its checkout
     * is still being prepared — `status` says whether it is usable yet, and the
     * host reports the change through the catalog. `idempotencyKey` is stable
     * across retries of one creation, so a retry returns the same worktree
     * instead of reserving a second one.
     */
    worktreeCreate(
        projectId: RigProjectId,
        input: { readonly name: string; readonly idempotencyKey: string },
    ): Promise<RigWorktree>;

    /**
     * Archives a worktree: it stops being listed and the host removes its
     * checkout. The sessions that ran in it are closed by the host.
     */
    worktreeArchive(projectId: RigProjectId, worktreeId: RigWorktreeId): Promise<void>;

    /** Moves one worktree after `afterId` within its project, or to the front when null. */
    worktreeReorder(
        projectId: RigProjectId,
        worktreeId: RigWorktreeId,
        afterId: RigWorktreeId | null,
    ): Promise<void>;

    /**
     * Submits a fresh user turn; `idempotencyKey` is stable across retries of one
     * send. `images` are carried inline with the turn, since a local session has
     * no upload step to reference bytes by id.
     */
    messageSubmit(
        sessionId: RigSessionId,
        text: string,
        idempotencyKey: string,
        images?: readonly RigImageInput[],
    ): Promise<void>;
    /** Steers the in-flight run with an additional user message. */
    messageSteer(
        sessionId: RigSessionId,
        text: string,
        idempotencyKey: string,
        expectedRunId?: string,
        images?: readonly RigImageInput[],
    ): Promise<void>;
    /** Stores or clears the session's shared unsent composer draft. */
    draftSet(
        sessionId: RigSessionId,
        draft: string,
        updatedAt: number,
        origin: string,
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
     * Starts one interactive terminal in the session's working directory, running
     * the user's own login shell. The terminal is ephemeral and lives only as long
     * as it is attached to and not stopped; the returned summary is its identity
     * and the size the daemon actually gave it, which may differ from the
     * requested one.
     */
    terminalCreate(sessionId: RigSessionId, cols: number, rows: number): Promise<RigTerminal>;
    /**
     * Ends one terminal and kills its process. Resolves once the daemon has
     * processed the request; a terminal that had already exited is not an error,
     * because stopping is what the caller wanted either way.
     */
    terminalStop(sessionId: RigSessionId, terminalId: RigTerminalId): Promise<void>;
    /**
     * Opens the byte channel carrying one terminal's binary protocol frames. The
     * channel begins connecting immediately and buffers writes until it is ready;
     * every attach and every reconnect asks for a fresh one, so the protocol's
     * resume state is the caller's to hold, not the transport's.
     */
    terminalConnect(sessionId: RigSessionId, terminalId: RigTerminalId): TerminalConnection;

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
        afterCursor?: string,
    ): () => void;
    /** Fetches events missed since `afterEventId` after a reconnect gap. */
    sessionEventsBackfill(
        sessionId: RigSessionId,
        afterEventId: RigEventId,
    ): Promise<readonly RigSessionEvent[]>;
}
