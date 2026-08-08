import type { TerminalConnection } from "../transport.js";
import type {
    RigBackgroundProcess,
    RigChangedFileDocument,
    RigEventId,
    RigFileSearchResult,
    RigGoal,
    RigGroupId,
    RigImageInput,
    RigJson,
    RigMessage,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigPermissionReview,
    RigOpenInTargets,
    RigWorkspaceFileBytes,
    RigWorkspaceFileDocument,
    RigWorkspaceFiles,
    RigProjectCatalog,
    RigProjectCompute,
    RigProjectComputeState,
    RigProjectId,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigShellCommandResult,
    RigSessionId,
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
    | { readonly type: "inference_iteration_start"; readonly messageId: string }
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
          readonly presentation?: RigToolPresentation;
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
    /**
     * The bracket around one compaction pass, so the transcript can show that
     * the agent is busy shrinking its context rather than appearing stalled.
     * Neither end carries sizes; those arrive as `context_compacted`.
     */
    | { readonly type: "context_compaction_started" }
    | { readonly type: "context_compaction_finished" }
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

export type RigSessionTitleStatus = "idle" | "generating" | "ready" | "error";

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
    | {
          readonly type: "agent_event";
          readonly runId: string;
          /** Durable assistant-message identity embedded by inference stream events. */
          readonly messageId?: string;
          readonly event: RigAgentEvent;
      }
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
          readonly status: RigSessionTitleStatus;
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
          readonly status: RigSessionTitleStatus;
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
      }
    | { readonly type: "slots_changed" }
    | { readonly type: "applets_changed" };

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
     * The machine-wide instructions every agent this host starts is given — the
     * host's own `AGENTS.md`. A host that has never been given any answers with
     * empty text, so there is no such thing as a missing document to create.
     */
    globalInstructionsRead(signal?: AbortSignal): Promise<string>;

    /**
     * Replaces those instructions wholesale and answers with what was stored,
     * which is what the surface then shows: the host is free to have normalized
     * the text it was handed, and a refusal — text too large for it to keep —
     * arrives as a failure carrying the host's own reason.
     */
    globalInstructionsWrite(instructions: string): Promise<string>;

    /**
     * The machine-wide security policy its permission reviewer applies — the
     * host's own `SECURITY.md`, or empty text when it has not been configured.
     */
    globalSecurityPolicyRead(signal?: AbortSignal): Promise<string>;

    /** Replaces that policy wholesale and answers with what the host stored. */
    globalSecurityPolicyWrite(policy: string): Promise<string>;

    /**
     * The host's project and worktree catalog: the durable groups the workspace
     * lists sessions under. Read alongside `sessionsRead` on every reconcile, so
     * a renamed project or a freshly created worktree lands with the sessions
     * that belong to it rather than one tick apart.
     */
    projectsRead(): Promise<RigProjectCatalog>;

    /**
     * Applications this host can hand a project directory to, in menu order and
     * already filtered to the ones installed. An empty list means the host
     * offers none, which is the normal answer off macOS.
     */
    openInTargetsRead(): Promise<RigOpenInTargets>;

    /**
     * Opens a project or worktree root in one of those applications. The group
     * is named rather than the directory: the host resolves the path from its
     * own catalog, so this can only ever open something it already knows about.
     */
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;

    /** Lists every file in a project or worktree checkout, changed or not. */
    workspaceFilesRead(groupId: RigGroupId): Promise<RigWorkspaceFiles>;

    /**
     * Reads one existing text file from a project/worktree checkout.
     *
     * A file belongs to the checkout, not to whatever conversation happens to be
     * open over it, so every file operation here is addressed by the group. That
     * is also what lets a project be read with no session in it at all.
     */
    workspaceFileRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileDocument>;

    /**
     * Reads one workspace file as bytes, for a surface that shows the file
     * rather than editing it. Unlike `workspaceFileRead` this makes no claim
     * that the file is text, so an image, a video, or a PDF arrives intact.
     */
    workspaceFileBytesRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileBytes>;

    /**
     * Where one HTML document of a checkout is served as a page, so a viewer can
     * load it the way a browser loads a site: the document's own directory is
     * the root, and everything it references is fetched from there. The host
     * decides what a page may reach; this only asks for the address.
     */
    htmlPreviewOpen(groupId: RigGroupId, path: string): Promise<string>;

    /**
     * Reads Rig's whole durable slot catalog. Which entries a placement shows is
     * resolved against the addressed context by the state layer, so this read
     * does not depend on what the window currently has open.
     */
    slotsRead(): Promise<readonly import("./rigSlotsStore.js").RigSlotEntry[]>;

    /** Reads every imported applet and its version history from this Rig. */
    appletsRead(): Promise<readonly import("./rigSlotsStore.js").RigApplet[]>;

    /** Resolves one applet's current version into the host's isolated preview site. */
    appletPreviewOpen(name: string): Promise<string>;

    /**
     * Every secret bundle this Rig holds. The host answers with the environment
     * variables each one binds and never with their values, so this reads what
     * exists rather than what is in it.
     */
    secretsRead(signal?: AbortSignal): Promise<readonly import("./rigSecretsStore.js").RigSecret[]>;

    /**
     * Registers a secret bundle, replacing whatever is held under that id. The
     * host keys a bundle by its id and stores it whole, so this carries the
     * complete environment rather than a change to it, and answers with what the
     * host kept. A refusal — an id it will not accept, a variable name it cannot
     * bind — arrives as a failure in the host's own words.
     */
    secretWrite(secret: {
        readonly id: string;
        readonly description: string;
        readonly environment: Readonly<Record<string, string>>;
    }): Promise<import("./rigSecretsStore.js").RigSecret>;

    /** Forgets one secret bundle on this Rig, values included. */
    secretRemove(secretId: string): Promise<void>;

    /** Writes one existing text file back to its checkout. */
    workspaceFileWrite(
        groupId: RigGroupId,
        path: string,
        content: string,
        expectedHash: string | null,
    ): Promise<void>;

    /**
     * Copies an attached file into a project or worktree checkout and answers
     * with the path it landed on, relative to that checkout. The name is a
     * request rather than a promise: nothing is ever overwritten, so a name that
     * is already taken lands beside its neighbour as a numbered variant.
     */
    attachmentWrite(
        groupId: RigGroupId,
        name: string,
        content: string,
    ): Promise<{ readonly path: string }>;

    /** Reads one text file from a project/worktree changed-file list. */
    changedFileRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigChangedFileDocument>;
    /**
     * Throws away the working-tree changes of the named files in one checkout,
     * returning each to what HEAD holds — a file Git has never seen stops
     * existing, a deleted one comes back. Paths that are no longer changed are
     * skipped, so a selection overtaken by the agent still reverts the rest.
     */
    changedFilesRevert(groupId: RigGroupId, paths: readonly string[]): Promise<void>;

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

    /** Renames a project. The name is presentation only; nothing derives from it. */
    projectRename(projectId: RigProjectId, name: string): Promise<void>;

    /**
     * Reads where sessions started in one project run by default, from the host's
     * own account of that project.
     *
     * It is a read of its own rather than a field of `projectsRead` because the
     * host's live catalog does not describe the setting at all: a value carried
     * on the project row would be there in one reader's answer and gone from the
     * next.
     */
    projectComputeRead(projectId: RigProjectId): Promise<RigProjectComputeState>;

    /**
     * Sets where sessions started in one project run by default, or stops the
     * project stating it at all when `compute` is absent, and resolves with what
     * the host holds afterwards — read back by the host rather than echoed from
     * the request, so the answer is the value that actually won a race.
     *
     * `mutationId` is this submission's identity and is the same across every
     * attempt at it: the host answers a repeat of a submission it has already
     * applied with the project that application produced rather than applying it
     * twice. Rejects when the host refused, including because someone else
     * changed this same setting in between — that is not retried here, because
     * retrying it would throw their choice away on the reader's behalf.
     */
    projectComputeWrite(
        projectId: RigProjectId,
        compute: RigProjectCompute | undefined,
        mutationId: string,
    ): Promise<RigProjectComputeState>;

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

    /** Renames a worktree. */
    worktreeRename(projectId: RigProjectId, worktreeId: RigWorktreeId, name: string): Promise<void>;

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
     * Searches one project or worktree checkout for files matching `query`,
     * powering the composer's `@`-mention autocomplete. Bounded by `limit`; the
     * daemon owns ranking. Returns quickly and is safe to call on each keystroke.
     */
    filesSearch(
        groupId: RigGroupId,
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
    /** Fetches durable event history, optionally only events after `afterEventId`. */
    sessionEventsBackfill(
        sessionId: RigSessionId,
        afterEventId?: RigEventId,
    ): Promise<readonly RigSessionEvent[]>;
}
