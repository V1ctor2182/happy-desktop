import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigMenusDerive } from "./rigMenusStore.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type {
    RigAgentEvent,
    RigEventObserver,
    RigSessionEvent,
    RigTransport,
} from "./rigTransport.js";
import type {
    RigBackgroundProcess,
    RigFileDiffHunk,
    RigFileDiffLineKind,
    RigFileSearchResult,
    RigGoal,
    RigMenusSnapshot,
    RigMessage,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigQueuedMessage,
    RigSelection,
    RigServiceTier,
    RigSession,
    RigSessionId,
    RigSessionUsage,
    RigStreamingBlock,
    RigStreamingMessage,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigToolEntry,
    RigTranscriptEntry,
    RigUserInputAnswers,
    RigUserInputRequest,
} from "./rigTypes.js";

export interface RigChatSnapshot {
    readonly sessionId: RigSessionId;
    readonly status: "loading" | "ready" | "error";
    readonly error?: UserError;
    /** Durable session snapshot; the authoritative source for transcript + config. */
    readonly session?: RigSession;
    /** Ordered render list: finalized messages, run notices, then the live message. */
    readonly transcript: readonly RigTranscriptEntry[];
    /** In-flight assistant message assembled from streaming deltas, when running. */
    readonly streaming?: RigStreamingMessage;
    readonly runStatus: "idle" | "running";
    readonly runId?: string;
    readonly runStartedAt?: number;
    /** Wall-clock duration of the most recently completed run, in milliseconds. */
    readonly turnElapsedMs?: number;
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    /** Steering messages queued to submit after the current tool call (composer preview). */
    readonly queuedMessages: readonly RigQueuedMessage[];
    readonly tasks: readonly RigTask[];
    readonly goal?: RigGoal;
    readonly subagents: readonly RigSubagentSummary[];
    readonly backgroundProcesses: readonly RigBackgroundProcess[];
    /** View state: whether thinking blocks are shown (hidden by default). */
    readonly showReasoning: boolean;
    /** View state: whether completed turns collapse to a summary. */
    readonly compactTurns: boolean;
    /** View state: whether the `/usage` panel is open (drives poll-while-visible). */
    readonly usagePanelOpen: boolean;
    /** Latest usage snapshot while the panel is open; undefined before the first load. */
    readonly usage?: RigSessionUsage;
    /** True while a usage load/poll is in flight (first load or a refresh tick). */
    readonly usageLoading: boolean;
    /** Displayable message from the most recent failed usage load, if any. */
    readonly usageError?: string;
    /** View state: whether the `/goal` + `/tasks` + `/agents` activity panel is open. */
    readonly activityPanelOpen: boolean;
    /** Derived pickers for model/effort/permission/service-tier. */
    readonly menus?: RigMenusSnapshot;
    /** Last failed optimistic action, when one is surfaced without rejecting. */
    readonly mutationError?: UserError;
}

export type RigChatOutput =
    | { readonly type: "messageSent"; readonly sessionId: RigSessionId; readonly steered: boolean }
    | { readonly type: "runAborted"; readonly sessionId: RigSessionId }
    | {
          readonly type: "inputAnswered";
          readonly sessionId: RigSessionId;
          readonly requestId: string;
      };

export interface RigChatStore {
    get(): RigChatSnapshot;
    subscribe(listener: () => void): () => void;
    /** Submits when idle, steers when a run is active; rejects with a `UserError`. */
    messageSend(text: string): Promise<void>;
    runAbort(): Promise<void>;
    answerInput(input: RigUserInputAnswers): Promise<void>;
    modelChange(input: RigModelSelection): Promise<void>;
    effortChange(effort?: RigThinkingLevel): Promise<void>;
    permissionModeChange(permissionMode: RigPermissionMode): Promise<void>;
    serviceTierChange(serviceTier?: RigServiceTier): Promise<void>;
    compact(): Promise<void>;
    rewind(messageId: string): Promise<void>;
    sessionReset(): Promise<void>;
    /**
     * Runs a one-off shell command in the session workspace (composer shell mode).
     * The live run reconciles from `shell_command_started`/`shell_command_finished`
     * events; this promise rejects with a `UserError` if the request itself fails.
     */
    shellRun(command: string): Promise<void>;
    /** Requests termination of one background terminal (`/stop`); rejects on failure. */
    backgroundProcessStop(processId: number): Promise<void>;
    /**
     * Searches the session workspace for `@`-mention candidates. A pure query with
     * no store mutation: results are transient composer typeahead, so the caller
     * renders them without them entering the durable snapshot.
     */
    filesSearch(query: string, limit?: number): Promise<readonly RigFileSearchResult[]>;
    /**
     * Reads the session's current usage snapshot for the `/usage` panel. Pure query
     * against the transport; does not mutate or cache durable snapshot state, so a
     * visible panel may poll it without disturbing the transcript.
     */
    usageGet(): Promise<RigSessionUsage>;
    /**
     * Opens the `/usage` panel and begins polling usage while it is open: an
     * immediate load plus a refresh on the configured interval. Idempotent — a
     * second open call does not stack timers. Reactivity without a refresh button:
     * there is no realtime usage channel, so the visible panel polls itself.
     */
    usagePanelOpen(): void;
    /** Closes the `/usage` panel and stops the poll; retains the last snapshot cleared. */
    usagePanelClose(): void;
    /**
     * Toggles the read-only activity panel (goal + tasks + subagents). Opening it
     * closes the usage panel (and stops its poll) so the surface shows one overlay
     * at a time. The panel is fully SSE-reactive, so it starts no work of its own.
     */
    activityPanelToggle(): void;
    /**
     * Idempotently opens the activity panel (goal + tasks + subagents). Used by the
     * `/tasks`, `/agents`, and `/goal` commands, which must open the panel rather
     * than toggle it. Opening it closes the usage panel and stops its poll.
     */
    activityPanelShow(): void;
    /** Local view toggle: show or hide thinking entries. */
    reasoningToggle(): void;
    /** Local view toggle: collapse or expand completed turns. */
    turnCompactToggle(): void;
    /**
     * View-only clear: hides every currently visible transcript entry without
     * touching the durable server snapshot (mirrors the TUI `/clear`). New messages
     * and future runs still render; a `session_reset`/reload restores full history.
     */
    viewClear(): void;
    [Symbol.dispose](): void;
}

export interface RigChatDeps {
    readonly transport: RigTransport;
    readonly catalog: RigModelCatalog;
    readonly output?: (event: RigChatOutput) => void;
    readonly createId?: () => string;
    readonly now?: () => number;
    /** Usage poll cadence in ms while the `/usage` panel is open. Defaults to 5s. */
    readonly usagePollMs?: number;
    /** Injectable timer for the usage poll; defaults to the global `setInterval`. */
    readonly setInterval?: (handler: () => void, milliseconds: number) => unknown;
    /** Injectable timer clear for the usage poll; defaults to the global `clearInterval`. */
    readonly clearInterval?: (handle: unknown) => void;
}

/**
 * The chat surface store for one session. The constructor opens nothing; the
 * first subscriber hydrates the durable session (`sessionRead`) and opens the
 * per-session realtime subscription, and the last unsubscribe tears both down.
 * `SessionEvent`s are reconciled into an immutable snapshot: finalized messages,
 * a live streaming message with per-tool execution state, pending user inputs,
 * run status, and turn timing. On a stream drop it backfills missed events by
 * `lastEventId` (SSE deltas are hints; durable truth is re-read on failure).
 */
export function rigChatStoreCreate(sessionId: RigSessionId, deps: RigChatDeps): RigChatStore {
    const output = deps.output ?? (() => undefined);
    const now = deps.now ?? Date.now;
    const createId = deps.createId ?? defaultCreateId;
    const usagePollMs = deps.usagePollMs ?? 5_000;
    const startInterval =
        deps.setInterval ?? ((handler, milliseconds) => setInterval(handler, milliseconds));
    const stopInterval =
        deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

    // --- mutable durable + live state (single source of truth) -------------
    let session: RigSession | undefined;
    let streaming: RigStreamingMessage | undefined;
    let ephemeral: RigTranscriptEntry[] = [];
    let runStatus: "idle" | "running" = "idle";
    let runId: string | undefined;
    let runStartedAt: number | undefined;
    let turnElapsedMs: number | undefined;
    let showReasoning = false;
    let compactTurns = false;
    // `/usage` panel: open flag, latest snapshot, in-flight/error, poll timer and a
    // generation guard so a stale in-flight fetch never overwrites a newer state.
    let usagePanelOpen = false;
    let usage: RigSessionUsage | undefined;
    let usageLoading = false;
    let usageError: string | undefined;
    let usageTimer: unknown;
    let usageGeneration = 0;
    let activityPanelOpen = false;
    // Entry ids hidden by a view-only `/clear`; new entries render as usual.
    let clearedIds = new Set<string>();
    let status: "loading" | "ready" | "error" = "loading";
    let error: UserError | undefined;
    let mutationError: UserError | undefined;
    let noticeSeq = 0;

    const store = createStore<RigChatSnapshot>()(() => ({
        sessionId,
        status: "loading",
        transcript: [],
        runStatus: "idle",
        pendingUserInputs: [],
        queuedMessages: [],
        tasks: [],
        subagents: [],
        backgroundProcesses: [],
        showReasoning: false,
        compactTurns: false,
        usagePanelOpen: false,
        usageLoading: false,
        activityPanelOpen: false,
    }));

    const commit = (): void => {
        const previous = store.getState();
        const built = buildTranscript(
            session,
            streaming,
            ephemeral,
            showReasoning,
            turnElapsedMs,
            compactTurns,
        );
        const visible =
            clearedIds.size === 0 ? built : built.filter((entry) => !clearedIds.has(entry.id));
        const transcript = referencesPreserve(previous.transcript, visible);
        store.setState(
            {
                sessionId,
                status,
                error,
                session,
                transcript,
                streaming,
                runStatus,
                runId,
                runStartedAt,
                turnElapsedMs,
                pendingUserInputs: session?.pendingUserInputs ?? [],
                queuedMessages: session?.queuedMessages ?? [],
                tasks: session?.tasks ?? [],
                goal: session?.goal,
                subagents: session?.subagents ?? [],
                backgroundProcesses: session?.backgroundProcesses ?? [],
                showReasoning,
                compactTurns,
                usagePanelOpen,
                usage,
                usageLoading,
                usageError,
                activityPanelOpen,
                menus: session ? rigMenusDerive(deps.catalog, selectionOf(session)) : undefined,
                mutationError,
            },
            true,
        );
    };

    // --- streaming block helpers ------------------------------------------
    const streamBlocks = (): RigStreamingBlock[] => (streaming ? [...streaming.blocks] : []);
    const setStream = (blocks: RigStreamingBlock[]): void => {
        streaming = streaming ? { runId: streaming.runId, blocks } : streaming;
    };
    const updateTool = (
        toolCallId: string,
        update: (entry: RigToolEntry) => RigToolEntry,
        create?: () => RigToolEntry,
    ): void => {
        if (!streaming) return;
        const blocks = streamBlocks();
        const index = blocks.findIndex(
            (block) => block.kind === "tool" && block.tool.toolCallId === toolCallId,
        );
        if (index >= 0) {
            const block = blocks[index]!;
            if (block.kind === "tool") blocks[index] = { kind: "tool", tool: update(block.tool) };
        } else if (create) {
            blocks.push({ kind: "tool", tool: update(create()) });
        } else {
            return;
        }
        setStream(blocks);
    };
    const appendText = (kind: "text" | "thinking", chunk: string): void => {
        if (!streaming) return;
        const blocks = streamBlocks();
        const last = blocks[blocks.length - 1];
        if (last && last.kind === kind) {
            blocks[blocks.length - 1] = { kind, text: last.text + chunk };
        } else {
            blocks.push({ kind, text: chunk });
        }
        setStream(blocks);
    };
    const startBlock = (kind: "text" | "thinking"): void => {
        if (!streaming) return;
        const blocks = streamBlocks();
        blocks.push({ kind, text: "" });
        setStream(blocks);
    };
    const pushNotice = (level: "info" | "warning" | "error", title: string, text: string): void => {
        ephemeral = [
            ...ephemeral,
            { id: `notice:${noticeSeq++}`, kind: "notice", level, title, text },
        ];
    };
    // Shell-mode runs render as ephemeral transcript entries keyed by commandId so a
    // `shell_command_started` entry is updated in place when its `finished` arrives.
    const upsertShell = (
        commandId: string,
        patch: {
            command: string;
            output: string;
            exitCode: number | null;
            running: boolean;
            timedOut: boolean;
        },
    ): void => {
        const id = `shell:${commandId}`;
        const entry: RigTranscriptEntry = { id, kind: "shell", ...patch };
        const index = ephemeral.findIndex((existing) => existing.id === id);
        if (index === -1) {
            ephemeral = [...ephemeral, entry];
        } else {
            const next = ephemeral.slice();
            next[index] = entry;
            ephemeral = next;
        }
    };

    const applyAgentEvent = (event: RigAgentEvent): void => {
        switch (event.type) {
            case "text_start":
                startBlock("text");
                break;
            case "text_delta":
                appendText("text", event.text);
                break;
            case "thinking_start":
                startBlock("thinking");
                break;
            case "thinking_delta":
                appendText("thinking", event.thinking);
                break;
            case "text_end":
            case "thinking_end":
            case "done":
                break;
            case "toolcall_start":
                updateTool(
                    event.toolCallId,
                    (entry) => entry,
                    () => ({
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        arguments: null,
                        status: "running",
                        failed: false,
                    }),
                );
                break;
            case "toolcall_delta":
                break;
            case "toolcall_end":
                updateTool(event.toolCallId, (entry) => ({ ...entry, arguments: event.arguments }));
                break;
            case "tool_execution_start":
                updateTool(
                    event.toolCallId,
                    (entry) => ({
                        ...entry,
                        toolName: event.toolName,
                        arguments: event.arguments,
                        status: "running",
                    }),
                    () => ({
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        arguments: event.arguments,
                        status: "running",
                        failed: false,
                    }),
                );
                break;
            case "tool_execution_progress":
                updateTool(event.toolCallId, (entry) => ({ ...entry, display: event.display }));
                break;
            case "tool_execution_status":
                updateTool(event.toolCallId, (entry) => ({ ...entry, status: event.status }));
                break;
            case "tool_execution_end":
                updateTool(
                    event.toolCallId,
                    (entry) => ({
                        ...entry,
                        toolName: event.toolName,
                        display: event.display,
                        failed: event.failed,
                        failure: event.failure,
                        presentation: event.presentation,
                        status: event.failed ? "failed" : "success",
                        permissionReview: undefined,
                    }),
                    () => ({
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        arguments: null,
                        status: event.failed ? "failed" : "success",
                        failed: event.failed,
                        failure: event.failure,
                        presentation: event.presentation,
                        display: event.display,
                    }),
                );
                break;
            case "permission_review":
                updateTool(
                    event.toolCallId,
                    (entry) => ({
                        ...entry,
                        status: "awaiting_approval",
                        permissionReview: event.review,
                    }),
                    () => ({
                        toolCallId: event.toolCallId,
                        toolName: event.review.action,
                        arguments: null,
                        status: "awaiting_approval",
                        failed: false,
                        permissionReview: event.review,
                    }),
                );
                break;
            case "context_compacted":
                pushNotice(
                    "info",
                    "Context compacted",
                    `Freed context (${event.estimatedTokensBefore} → ${event.estimatedTokensAfter} tokens).`,
                );
                break;
            case "inference_retry":
                pushNotice(
                    "warning",
                    "Retrying",
                    `Attempt ${event.attempt}/${event.maxAttempts} (${event.reason.replace("_", " ")}).`,
                );
                break;
            case "error":
                pushNotice("error", "Run error", event.reason);
                break;
        }
    };

    const messageUpsert = (message: RigMessage): void => {
        if (!session) return;
        const messages = session.messages.filter((existing) => existing.id !== message.id);
        messages.push(message);
        session = { ...session, messages };
    };

    const applyEvent = (event: RigSessionEvent): void => {
        switch (event.type) {
            case "session_created":
            case "session_updated":
                session = event.session;
                break;
            case "message_submitted":
                messageUpsert(event.message);
                break;
            case "run_started":
                runStatus = "running";
                runId = event.runId;
                runStartedAt = now();
                turnElapsedMs = undefined;
                streaming = { runId: event.runId, blocks: [] };
                break;
            case "agent_event":
                if (!streaming) streaming = { runId: event.runId, blocks: [] };
                applyAgentEvent(event.event);
                break;
            case "agent_message":
                messageUpsert(event.message);
                streaming = undefined;
                break;
            case "run_finished":
                runStatus = "idle";
                turnElapsedMs = runStartedAt !== undefined ? now() - runStartedAt : undefined;
                streaming = undefined;
                runId = undefined;
                break;
            case "run_error":
                runStatus = "idle";
                streaming = undefined;
                runId = undefined;
                pushNotice("error", "Run error", event.errorMessage);
                break;
            case "session_reset":
                if (session)
                    session = { ...session, messages: event.messages, pendingUserInputs: [] };
                streaming = undefined;
                ephemeral = [];
                clearedIds = new Set();
                break;
            case "session_rewound":
                if (session) session = { ...session, messages: event.messages };
                streaming = undefined;
                break;
            case "session_title_changed":
                if (session) session = { ...session, title: event.title, recap: event.recap };
                break;
            case "model_changed":
                if (session)
                    session = {
                        ...session,
                        modelId: event.modelId,
                        providerId: event.providerId,
                        effort: event.effort,
                    };
                break;
            case "effort_changed":
                if (session) session = { ...session, modelId: event.modelId, effort: event.effort };
                break;
            case "service_tier_changed":
                if (session) session = { ...session, serviceTier: event.serviceTier ?? undefined };
                break;
            case "permission_mode_changed":
                if (session) session = { ...session, permissionMode: event.permissionMode };
                break;
            case "user_input_requested":
                if (session) {
                    const pending = session.pendingUserInputs.filter(
                        (request) => request.requestId !== event.request.requestId,
                    );
                    pending.push(event.request);
                    session = { ...session, pendingUserInputs: pending };
                }
                break;
            case "user_input_resolved":
                if (session)
                    session = {
                        ...session,
                        pendingUserInputs: session.pendingUserInputs.filter(
                            (request) => request.requestId !== event.requestId,
                        ),
                    };
                break;
            case "tasks_changed":
                if (session) session = { ...session, tasks: event.tasks };
                break;
            case "goal_changed":
                if (session) session = { ...session, goal: event.goal ?? undefined };
                break;
            case "subagent_changed":
                if (session) {
                    const subagents = session.subagents.filter(
                        (subagent) => subagent.id !== event.subagent.id,
                    );
                    subagents.push(event.subagent);
                    session = { ...session, subagents };
                }
                break;
            case "background_processes_changed":
                if (session) session = { ...session, backgroundProcesses: event.processes };
                break;
            case "shell_command_started":
                upsertShell(event.commandId, {
                    command: event.command,
                    output: "",
                    exitCode: null,
                    running: true,
                    timedOut: false,
                });
                break;
            case "shell_command_finished":
                upsertShell(event.commandId, {
                    command: event.command,
                    output: event.output,
                    exitCode: event.exitCode,
                    running: false,
                    timedOut: event.timedOut,
                });
                break;
        }
        if (event.eventId && session) session = { ...session, lastEventId: event.eventId };
    };

    // --- lifecycle: hydrate + subscribe -----------------------------------
    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let generation = 0;
    let unsubscribeSession: (() => void) | undefined;

    const hydrate = async (): Promise<void> => {
        const current = generation;
        try {
            const loaded = await deps.transport.sessionRead(sessionId);
            if (disposed || current !== generation) return;
            session = loaded;
            status = "ready";
            error = undefined;
            runStatus = loaded.status === "running" ? "running" : "idle";
            commit();
        } catch (caught) {
            if (disposed || current !== generation) return;
            if (status !== "ready") {
                status = "error";
                error = rigUserError(caught);
                commit();
            }
        }
    };

    const observer: RigEventObserver<RigSessionEvent> = {
        event: (value) => {
            if (disposed || !active) return;
            applyEvent(value);
            commit();
        },
        error: () => {
            if (!disposed && active) void recover();
        },
        end: () => undefined,
    };

    const openStream = (): void => {
        unsubscribeSession = deps.transport.sessionEventsSubscribe(
            sessionId,
            observer,
            session?.lastEventId,
        );
    };

    const recover = async (): Promise<void> => {
        unsubscribeSession?.();
        unsubscribeSession = undefined;
        const current = generation;
        const after = session?.lastEventId;
        try {
            if (after) {
                const missed = await deps.transport.sessionEventsBackfill(sessionId, after);
                if (disposed || current !== generation) return;
                for (const missedEvent of missed) applyEvent(missedEvent);
                commit();
            } else {
                await hydrate();
            }
        } catch {
            await hydrate();
        }
        if (active && !disposed && current === generation) openStream();
    };

    const start = (): void => {
        active = true;
        generation += 1;
        void hydrate().then(() => {
            if (active && !disposed) openStream();
        });
        // Resume the usage poll if the panel was left open across a no-subscriber gap.
        if (usagePanelOpen && usageTimer === undefined && !disposed) {
            usageLoad();
            usageTimer = startInterval(usageLoad, usagePollMs);
        }
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        unsubscribeSession?.();
        unsubscribeSession = undefined;
        // Suspend polling while nothing observes this store; the open flag persists
        // so a re-subscription resumes it. No background work without subscribers.
        usagePollStop();
    };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };
    const storeUnsub = store.subscribe(notify);

    const rejecting = async (run: () => Promise<void>): Promise<void> => {
        try {
            await run();
        } catch (caught) {
            throw rigUserError(caught);
        }
    };

    const replaceSession = (loaded: RigSession): void => {
        session = loaded;
        status = "ready";
        commit();
    };

    // One usage fetch. The generation captured at call time guards against a stale
    // response (panel closed or reopened, or the store stopped) overwriting state.
    const usageLoad = (): void => {
        const current = usageGeneration;
        usageLoading = true;
        commit();
        void deps.transport.usageGet(sessionId).then(
            (loaded) => {
                if (current !== usageGeneration) return;
                usage = loaded;
                usageError = undefined;
                usageLoading = false;
                commit();
            },
            (caught) => {
                if (current !== usageGeneration) return;
                usageError = rigUserError(caught).message;
                usageLoading = false;
                commit();
            },
        );
    };

    // Tears down the poll timer and invalidates any in-flight fetch. Safe to call
    // when already stopped. Does not clear the open flag or last snapshot.
    const usagePollStop = (): void => {
        usageGeneration += 1;
        if (usageTimer !== undefined) {
            stopInterval(usageTimer);
            usageTimer = undefined;
        }
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        messageSend: (text) =>
            rejecting(async () => {
                const key = createId();
                const steered = runStatus === "running";
                if (steered) {
                    await deps.transport.messageSteer(sessionId, text, key, runId);
                } else {
                    await deps.transport.messageSubmit(sessionId, text, key);
                }
                output({ type: "messageSent", sessionId, steered });
            }),
        runAbort: () =>
            rejecting(async () => {
                await deps.transport.runAbort(sessionId, runId);
                output({ type: "runAborted", sessionId });
            }),
        answerInput: (input) =>
            rejecting(async () => {
                replaceSession(await deps.transport.answerUserInput(sessionId, input));
                output({ type: "inputAnswered", sessionId, requestId: input.requestId });
            }),
        modelChange: (input) =>
            rejecting(async () => {
                replaceSession(await deps.transport.changeModel(sessionId, input));
            }),
        effortChange: (effort) =>
            rejecting(async () => {
                replaceSession(await deps.transport.changeEffort(sessionId, effort));
            }),
        permissionModeChange: (permissionMode) =>
            rejecting(async () => {
                replaceSession(
                    await deps.transport.changePermissionMode(sessionId, permissionMode),
                );
            }),
        serviceTierChange: (serviceTier) =>
            rejecting(async () => {
                replaceSession(await deps.transport.changeServiceTier(sessionId, serviceTier));
            }),
        compact: () =>
            rejecting(async () => {
                await deps.transport.compact(sessionId);
                replaceSession(await deps.transport.sessionRead(sessionId));
            }),
        rewind: (messageId) =>
            rejecting(async () => {
                replaceSession(await deps.transport.rewind(sessionId, messageId));
            }),
        sessionReset: () =>
            rejecting(async () => {
                streaming = undefined;
                ephemeral = [];
                replaceSession(await deps.transport.sessionReset(sessionId));
            }),
        shellRun: (command) =>
            rejecting(async () => {
                // The started/finished events reconcile the transcript entry; the
                // returned result is a fallback for daemons that answer synchronously
                // without emitting events (e.g. a command that finished instantly).
                const commandId = createId();
                const result = await deps.transport.shellRun(sessionId, command, commandId);
                if (!ephemeral.some((entry) => entry.id === `shell:${commandId}`)) {
                    upsertShell(commandId, {
                        command: result.command,
                        output: result.output,
                        exitCode: result.exitCode,
                        running: false,
                        timedOut: result.timedOut,
                    });
                    commit();
                }
            }),
        backgroundProcessStop: (processId) =>
            rejecting(async () => {
                await deps.transport.backgroundProcessStop(sessionId, processId);
            }),
        filesSearch: (query, limit) => deps.transport.filesSearch(sessionId, query, limit),
        usageGet: () => deps.transport.usageGet(sessionId),
        usagePanelOpen() {
            if (usagePanelOpen) return;
            usagePanelOpen = true;
            activityPanelOpen = false;
            usageError = undefined;
            usageLoad();
            usageTimer = startInterval(usageLoad, usagePollMs);
            commit();
        },
        usagePanelClose() {
            if (!usagePanelOpen) return;
            usagePanelOpen = false;
            usagePollStop();
            usageLoading = false;
            commit();
        },
        activityPanelToggle() {
            activityPanelOpen = !activityPanelOpen;
            // Opening the activity panel replaces the usage panel; stop its poll.
            if (activityPanelOpen && usagePanelOpen) {
                usagePanelOpen = false;
                usagePollStop();
                usageLoading = false;
            }
            commit();
        },
        activityPanelShow() {
            if (activityPanelOpen) return;
            activityPanelOpen = true;
            // The activity panel replaces the usage panel; stop its poll.
            if (usagePanelOpen) {
                usagePanelOpen = false;
                usagePollStop();
                usageLoading = false;
            }
            commit();
        },
        reasoningToggle() {
            showReasoning = !showReasoning;
            commit();
        },
        turnCompactToggle() {
            compactTurns = !compactTurns;
            commit();
        },
        viewClear() {
            clearedIds = new Set(store.getState().transcript.map((entry) => entry.id));
            commit();
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            storeUnsub();
            listeners.clear();
        },
    };
}

function selectionOf(session: RigSession): RigSelection {
    return {
        providerId: session.providerId,
        modelId: session.modelId,
        effort: session.effort,
        permissionMode: session.permissionMode,
        serviceTier: session.serviceTier,
    };
}

interface TurnStats {
    count: number;
    tools: number;
    files: Set<string>;
    additions: number;
    deletions: number;
}

/** Folds one transcript entry into the in-progress turn's aggregate tool stats. */
function accumulateTurnStats(turn: TurnStats, entry: RigTranscriptEntry): void {
    turn.count += 1;
    if (entry.kind !== "tool") return;
    turn.tools += 1;
    const presentation = entry.tool.presentation;
    if (presentation?.type !== "fileDiff") return;
    for (const file of presentation.files) {
        turn.files.add(file.path);
        turn.additions +=
            file.added ?? file.hunks.reduce((sum, hunk) => sum + countLines(hunk, "add"), 0);
        turn.deletions +=
            file.deleted ?? file.hunks.reduce((sum, hunk) => sum + countLines(hunk, "delete"), 0);
    }
}

function countLines(hunk: RigFileDiffHunk, kind: RigFileDiffLineKind): number {
    return hunk.lines.reduce((sum, line) => sum + (line.kind === kind ? 1 : 0), 0);
}

function turnSeparator(index: number, turn: TurnStats, elapsedMs?: number): RigTranscriptEntry {
    return {
        id: `turn-separator:${index}`,
        kind: "turnSeparator",
        elapsedMs,
        toolCount: turn.tools,
        fileCount: turn.files.size,
        additions: turn.additions,
        deletions: turn.deletions,
    };
}

/**
 * Builds the ordered transcript the UI renders: finalized message blocks
 * (correlating tool calls with their results), turn-completion separators, then
 * run notices, then the live streaming message. Internal messages and (unless
 * enabled) thinking are omitted.
 */
function buildTranscript(
    session: RigSession | undefined,
    streaming: RigStreamingMessage | undefined,
    ephemeral: readonly RigTranscriptEntry[],
    showReasoning: boolean,
    turnElapsedMs: number | undefined,
    compactTurns: boolean,
): readonly RigTranscriptEntry[] {
    const durable: RigTranscriptEntry[] = [];
    if (session) {
        // The daemon delivers a tool call and its result in separate messages, so
        // correlate results across the whole session rather than within one
        // message. Without this, every completed tool renders as an empty success.
        const results = new Map<
            string,
            Extract<RigMessage["blocks"][number], { type: "toolResult" }>
        >();
        for (const message of session.messages) {
            for (const block of message.blocks) {
                if (block.type === "toolResult") results.set(block.toolCallId, block);
            }
        }
        for (const message of session.messages) {
            if (message.internal) continue;
            if (message.role === "user") {
                durable.push(userEntry(message));
                continue;
            }
            if (message.role === "system") {
                const text = joinText(message);
                if (text) durable.push({ id: message.id, kind: "system", text });
                continue;
            }
            appendAgentEntries(durable, message, results, showReasoning);
        }
    }

    // Close each completed turn with a boundary separator. A turn is a user message
    // and its following agent activity; the separator precedes the next user
    // message, and a trailing one closes the last turn once the run is idle. Only
    // the last completed turn has a known elapsed; historical turns show stats only.
    // When `compactTurns` is on, a completed turn's agent activity is buffered and
    // dropped, collapsing the turn to its user prompt plus the summary separator; an
    // in-flight (streaming) turn always stays expanded so live output is visible.
    const entries: RigTranscriptEntry[] = [];
    let turn: TurnStats | undefined;
    let buffer: RigTranscriptEntry[] = [];
    const closeTurn = (elapsedMs?: number): void => {
        if (!turn) return;
        if (!compactTurns) for (const entry of buffer) entries.push(entry);
        if (turn.count > 0) entries.push(turnSeparator(entries.length, turn, elapsedMs));
        turn = undefined;
        buffer = [];
    };
    for (const entry of durable) {
        if (entry.kind === "user") {
            closeTurn();
            turn = { count: 0, tools: 0, files: new Set(), additions: 0, deletions: 0 };
            entries.push(entry);
            continue;
        }
        // Entries before the first user message are a preamble with no turn to close.
        if (!turn) {
            entries.push(entry);
            continue;
        }
        accumulateTurnStats(turn, entry);
        buffer.push(entry);
    }
    // The trailing turn: while a run streams it is in flight, so keep its buffered
    // activity expanded and emit no separator; once idle it is a completed turn.
    if (streaming) {
        for (const entry of buffer) entries.push(entry);
    } else {
        closeTurn(turnElapsedMs);
    }

    for (const notice of ephemeral) entries.push(notice);
    if (streaming) {
        streaming.blocks.forEach((block, index) => {
            const id = `${streaming.runId}:stream:${index}`;
            if (block.kind === "text") {
                entries.push({ id, kind: "agentText", text: block.text, streaming: true });
            } else if (block.kind === "thinking") {
                if (showReasoning)
                    entries.push({ id, kind: "thinking", text: block.text, streaming: true });
            } else {
                entries.push({ id: block.tool.toolCallId, kind: "tool", tool: block.tool });
            }
        });
    }
    return entries;
}

function userEntry(message: RigMessage): RigTranscriptEntry {
    const images: { readonly mediaType: string; readonly data: string }[] = [];
    let text = "";
    for (const block of message.blocks) {
        if (block.type === "text") text += block.text;
        else if (block.type === "image")
            images.push({ mediaType: block.mediaType, data: block.data });
    }
    return { id: message.id, kind: "user", text, images };
}

function appendAgentEntries(
    entries: RigTranscriptEntry[],
    message: RigMessage,
    results: ReadonlyMap<string, Extract<RigMessage["blocks"][number], { type: "toolResult" }>>,
    showReasoning: boolean,
): void {
    message.blocks.forEach((block, index) => {
        const id = `${message.id}:${index}`;
        if (block.type === "text") {
            if (block.text)
                entries.push({ id, kind: "agentText", text: block.text, streaming: false });
        } else if (block.type === "thinking") {
            if (showReasoning && !block.redacted)
                entries.push({ id, kind: "thinking", text: block.thinking, streaming: false });
        } else if (block.type === "toolCall") {
            const result = results.get(block.id);
            entries.push({
                id: block.id,
                kind: "tool",
                tool: {
                    toolCallId: block.id,
                    toolName: block.name,
                    arguments: block.arguments,
                    status: result ? (result.failed ? "failed" : "success") : "success",
                    display: result?.display,
                    failed: result?.failed ?? false,
                    failure: result?.failure,
                    presentation: result?.presentation,
                },
            });
        }
    });
}

function joinText(message: RigMessage): string {
    let text = "";
    for (const block of message.blocks) if (block.type === "text") text += block.text;
    return text;
}

function defaultCreateId(): string {
    return `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
