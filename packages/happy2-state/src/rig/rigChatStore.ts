import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { entriesMerge } from "../conversation/conversationEntries.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    entryKey,
    type ConversationEntry,
    type ConversationRequestSubmission,
} from "../conversation/conversationEntry.js";
import { rigConversationBuild, rigShellEntry } from "./rigConversationProject.js";
import { rigConversationAttachTurnTraces } from "./rigConversationTurnTrace.js";
import { rigMenusDerive } from "./rigMenusStore.js";
import { deepEqual, rigUserError } from "./rigSupport.js";
import type {
    RigAgentEvent,
    RigEventObserver,
    RigSessionEvent,
    RigTransport,
} from "./rigTransport.js";
import type {
    RigBackgroundProcess,
    RigFileSearchResult,
    RigGoal,
    RigImageInput,
    RigMenusSnapshot,
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
    RigUserInputAnswers,
    RigUserInputRequest,
} from "./rigTypes.js";

export interface RigChatSnapshot {
    readonly sessionId: RigSessionId;
    /** Durable session snapshot; the authoritative source for entries + config. */
    readonly session: Loadable<RigSession>;
    /** Ordered render list: durable messages, agent activity, notices, requests. */
    readonly entries: readonly ConversationEntry[];
    /** In-flight assistant message assembled from streaming deltas, when running. */
    readonly streaming?: RigStreamingMessage;
    readonly runStatus: "idle" | "running";
    readonly runId?: string;
    readonly runStartedAt?: number;
    /** Wall-clock duration of the most recently completed run, in milliseconds. */
    readonly turnElapsedMs?: number;
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly requestSubmissions: readonly ConversationRequestSubmission[];
    /** Steering messages queued to submit after the current tool call (composer preview). */
    readonly queuedMessages: readonly RigQueuedMessage[];
    readonly tasks: readonly RigTask[];
    readonly goal?: RigGoal;
    readonly subagents: readonly RigSubagentSummary[];
    readonly backgroundProcesses: readonly RigBackgroundProcess[];
    /** View state: whether thinking blocks are shown (hidden by default). */
    readonly showReasoning: boolean;
    /** Finished turns the reader opened; their intermediate entries are listed. */
    readonly expandedTurnIds: ReadonlySet<string>;
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
    /** View state: whether the session settings dialog is open. */
    readonly settingsOpen: boolean;
    /** The transcript image the reader opened full size, if any. */
    readonly openImage?: RigOpenImage;
    /** Derived pickers for model/effort/permission/service-tier. */
    readonly menus?: RigMenusSnapshot;
}

/**
 * The transcript image currently shown full size. Resolved when it is opened, so
 * the viewer renders from one value rather than the surface re-deriving a source
 * from the entry list on every notification.
 */
export interface RigOpenImage {
    readonly id: string;
    /** Displayable source for the image; a local image is a data URL. */
    readonly url: string;
    readonly alt: string;
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
    /** Retries a failed authoritative session read. */
    sessionRetry(): void;
    /**
     * Submits when idle, steers when a run is active; rejects with a `UserError`.
     * `images` ride along inline with the turn, since a local session has no
     * upload step to reference bytes by id.
     */
    messageSend(text: string, images?: readonly RigImageInput[]): Promise<void>;
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
     * Session events remain delivery hints; the authoritative action result renders
     * the completed command. Rejects with a `UserError` if the request itself fails.
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
    /**
     * Opens the session settings dialog. The dialog hosts the view toggles and the
     * access/service-tier pickers that would otherwise crowd the header, so this is
     * pure local view state: it starts no transport work and closes no panel.
     */
    settingsOpen(): void;
    /** Closes the session settings dialog. */
    settingsClose(): void;
    /**
     * Opens one transcript image full size. The image is resolved from the named
     * message's attachments here rather than by the surface, so the viewer has a
     * source the moment it opens; an id that names nothing opens nothing.
     */
    imageOpen(messageId: string, attachmentId: string): void;
    /** Closes the full-size image viewer. */
    imageClose(): void;
    /** Local view toggle: show or hide thinking entries. */
    reasoningToggle(): void;
    /**
     * Local view toggle: shows or hides one finished turn's intermediate
     * messages and tool rows. A finished turn renders as its trace row plus its
     * final message until it is expanded; a running turn always shows everything.
     */
    turnTraceToggle(turnId: string): void;
    /**
     * View-only clear: hides every currently visible transcript entry without
     * touching the durable server snapshot (mirrors the TUI `/clear`). New messages
     * and future runs still render; a `session_reset`/reload restores full history.
     */
    viewClear(): void;
    [Symbol.dispose](): void;
}

/**
 * Finds one message's image attachment and states it as a viewable source. A
 * local attachment carries its own bytes, so the data URL is built here and the
 * viewer needs no fetch; anything else (an unknown id, a non-image) resolves to
 * nothing rather than opening an empty viewer.
 */
function openImageResolve(
    entries: readonly ConversationEntry[],
    messageId: string,
    attachmentId: string,
): RigOpenImage | undefined {
    for (const entry of entries) {
        if (entry.kind !== "message" || entry.message.id !== messageId) continue;
        for (const attachment of entry.message.attachments) {
            if (attachment.kind !== "inlineImage" || attachment.id !== attachmentId) continue;
            return {
                id: attachment.id,
                url: `data:${attachment.mediaType};base64,${attachment.data}`,
                alt: "Attached image",
            };
        }
        return undefined;
    }
    return undefined;
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
 * Every `SessionEvent` is a delivery hint that schedules a coalesced
 * `sessionRead`; event and backfill payloads never write durable session state or
 * its cursor. Agent deltas alone feed explicitly transient streaming
 * presentation, which a successful durable read supersedes on completion.
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

    // --- durable state + explicitly transient presentation -----------------
    let session: RigSession | undefined;
    let transientStreamingPresentation: RigStreamingMessage | undefined;
    let transientStreamingBaseAgentIds = new Set<string>();
    // Run ids retired by durable completion. The bounded session-lifetime set
    // rejects delayed events from more than merely the most recent run.
    const retiredRunIds = new Set<string>();
    const retiredRunOrder: string[] = [];
    const RETIRED_RUN_LIMIT = 128;
    let ephemeral: ConversationEntry[] = [];
    let runStatus: "idle" | "running" = "idle";
    let runId: string | undefined;
    let runStartedAt: number | undefined;
    let turnElapsedMs: number | undefined;
    let showReasoning = false;
    // Finished turns the reader opened from their trace row; a running turn is
    // always open, so this set only grows by explicit intent.
    let expandedTurnIds: ReadonlySet<string> = new Set();
    // `/usage` panel: open flag, latest snapshot, in-flight/error, poll timer and a
    // generation guard so a stale in-flight fetch never overwrites a newer state.
    let usagePanelOpen = false;
    let usage: RigSessionUsage | undefined;
    let usageLoading = false;
    let usageError: string | undefined;
    let usageTimer: unknown;
    let usageGeneration = 0;
    let activityPanelOpen = false;
    let settingsOpen = false;
    let openImage: RigOpenImage | undefined;
    // Entry ids hidden by a view-only `/clear`; new entries render as usual.
    let clearedIds = new Set<string>();
    let status: "loading" | "ready" | "error" = "loading";
    let error: UserError | undefined;
    const requestSubmissions = new Map<string, ConversationRequestSubmission>();
    const requestSubmissionPromises = new Map<string, Promise<void>>();

    const store = createStore<RigChatSnapshot>()(() => ({
        sessionId,
        session: { type: "loading" },
        entries: [],
        runStatus: "idle",
        pendingUserInputs: [],
        requestSubmissions: [],
        queuedMessages: [],
        tasks: [],
        subagents: [],
        backgroundProcesses: [],
        showReasoning: false,
        expandedTurnIds: new Set<string>(),
        usagePanelOpen: false,
        usageLoading: false,
        activityPanelOpen: false,
        settingsOpen: false,
    }));

    const sessionLoadable = (): Loadable<RigSession> =>
        status === "ready" && session
            ? { type: "ready", value: session }
            : status === "error" && error
              ? { type: "error", error }
              : { type: "loading" };

    const commit = (): void => {
        const previous = store.getState();
        const built = rigConversationAttachTurnTraces(
            rigConversationBuild({
                sessionId,
                session,
                streaming: transientStreamingPresentation,
                ephemeral,
                showReasoning,
                pendingUserInputs: session?.pendingUserInputs ?? [],
            }),
            { running: runStatus === "running", expandedTurnIds },
        );
        const visible =
            clearedIds.size === 0
                ? built
                : built.filter((entry) => !clearedIds.has(entryKey(entry)));
        const entries = entriesMerge(previous.entries, visible);
        const next: RigChatSnapshot = {
            sessionId,
            session: sessionLoadable(),
            entries,
            streaming: transientStreamingPresentation,
            runStatus,
            runId,
            runStartedAt,
            turnElapsedMs,
            pendingUserInputs: session?.pendingUserInputs ?? [],
            requestSubmissions: [...requestSubmissions.values()],
            queuedMessages: session?.queuedMessages ?? [],
            tasks: session?.tasks ?? [],
            goal: session?.goal,
            subagents: session?.subagents ?? [],
            backgroundProcesses: session?.backgroundProcesses ?? [],
            showReasoning,
            expandedTurnIds,
            usagePanelOpen,
            usage,
            usageLoading,
            usageError,
            activityPanelOpen,
            settingsOpen,
            openImage,
            menus: session ? rigMenusDerive(deps.catalog, selectionOf(session)) : undefined,
        };
        if (deepEqual(previous, next)) return;
        store.setState(next, true);
    };

    // --- streaming block helpers ------------------------------------------
    const transientStreamBlocks = (): RigStreamingBlock[] =>
        transientStreamingPresentation ? [...transientStreamingPresentation.blocks] : [];
    const transientStreamSet = (blocks: RigStreamingBlock[]): void => {
        transientStreamingPresentation = transientStreamingPresentation
            ? { runId: transientStreamingPresentation.runId, blocks }
            : transientStreamingPresentation;
    };
    const transientToolUpdate = (
        toolCallId: string,
        update: (entry: RigToolEntry) => RigToolEntry,
        create?: () => RigToolEntry,
    ): void => {
        if (!transientStreamingPresentation) return;
        const blocks = transientStreamBlocks();
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
        transientStreamSet(blocks);
    };
    const transientTextAppend = (kind: "text" | "thinking", chunk: string): void => {
        if (!transientStreamingPresentation) return;
        const blocks = transientStreamBlocks();
        const last = blocks[blocks.length - 1];
        if (last && last.kind === kind) {
            blocks[blocks.length - 1] = { kind, text: last.text + chunk };
        } else {
            blocks.push({ kind, text: chunk });
        }
        transientStreamSet(blocks);
    };
    const transientBlockStart = (kind: "text" | "thinking"): void => {
        if (!transientStreamingPresentation) return;
        const blocks = transientStreamBlocks();
        blocks.push({ kind, text: "" });
        transientStreamSet(blocks);
    };
    // Shell-mode action results render as ephemeral transcript entries keyed by
    // commandId so a retried result replaces rather than duplicates its command.
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
        const entry = rigShellEntry(id, patch);
        const index = ephemeral.findIndex((existing) => entryKey(existing) === id);
        if (index === -1) {
            ephemeral = [...ephemeral, entry];
        } else {
            const next = ephemeral.slice();
            next[index] = entry;
            ephemeral = next;
        }
    };

    const transientAgentEventApply = (event: RigAgentEvent): void => {
        switch (event.type) {
            case "text_start":
                transientBlockStart("text");
                break;
            case "text_delta":
                transientTextAppend("text", event.text);
                break;
            case "thinking_start":
                transientBlockStart("thinking");
                break;
            case "thinking_delta":
                transientTextAppend("thinking", event.thinking);
                break;
            case "text_end":
            case "thinking_end":
            case "done":
                break;
            case "toolcall_start":
                transientToolUpdate(
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
                transientToolUpdate(event.toolCallId, (entry) => ({
                    ...entry,
                    arguments: event.arguments,
                }));
                break;
            case "tool_execution_start":
                transientToolUpdate(
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
                transientToolUpdate(event.toolCallId, (entry) => ({
                    ...entry,
                    display: event.display,
                }));
                break;
            case "tool_execution_status":
                transientToolUpdate(event.toolCallId, (entry) => ({
                    ...entry,
                    status: event.status,
                }));
                break;
            case "tool_execution_end":
                transientToolUpdate(
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
                transientToolUpdate(
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
            case "inference_retry":
            case "error":
                break;
        }
    };

    const transientStreamingStart = (streamRunId: string): void => {
        if (retiredRunIds.has(streamRunId)) return;
        if (transientStreamingPresentation?.runId === streamRunId) return;
        // A delayed or reordered event for a different run must never replace
        // the stream whose id currently guards steering and abort operations.
        if (transientStreamingPresentation !== undefined) return;
        transientStreamingPresentation = { runId: streamRunId, blocks: [] };
        transientStreamingBaseAgentIds = new Set(
            session?.messages
                .filter((message) => message.role === "agent" && !message.internal)
                .map((message) => message.id) ?? [],
        );
        runId = streamRunId;
        runStartedAt = now();
        turnElapsedMs = undefined;
    };

    const runRetire = (completedRunId: string): void => {
        if (retiredRunIds.has(completedRunId)) return;
        retiredRunIds.add(completedRunId);
        retiredRunOrder.push(completedRunId);
        if (retiredRunOrder.length <= RETIRED_RUN_LIMIT) return;
        const oldest = retiredRunOrder.shift();
        if (oldest !== undefined) retiredRunIds.delete(oldest);
    };

    /**
     * Applies only non-durable live presentation from an SSE event. The event's
     * session/message/config/cursor payload is deliberately unreachable here.
     */
    const transientStreamingHintApply = (event: RigSessionEvent): void => {
        switch (event.type) {
            case "run_started":
                transientStreamingStart(event.runId);
                break;
            case "agent_event":
                transientStreamingStart(event.runId);
                if (transientStreamingPresentation?.runId === event.runId)
                    transientAgentEventApply(event.event);
                break;
            default:
                break;
        }
    };

    // --- lifecycle: hydrate + subscribe -----------------------------------
    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let generation = 0;
    let reconciling = false;
    let reconcileAgain = false;
    let recovering = false;
    let unsubscribeSession: (() => void) | undefined;

    /**
     * Private authoritative-input boundary. Only transport reads/action results
     * enter here; session-event payloads never call it and it emits no output.
     */
    const sessionAuthoritativeWrite = (loaded: RigSession): void => {
        const loadedHasCompletedAgentMessage =
            transientStreamingPresentation !== undefined &&
            loaded.messages.some(
                (message) =>
                    message.role === "agent" &&
                    !message.internal &&
                    !transientStreamingBaseAgentIds.has(message.id),
            );
        if (
            transientStreamingPresentation &&
            (loadedHasCompletedAgentMessage || loaded.status !== "running")
        ) {
            runRetire(transientStreamingPresentation.runId);
            transientStreamingPresentation = undefined;
            transientStreamingBaseAgentIds = new Set();
            turnElapsedMs = runStartedAt !== undefined ? now() - runStartedAt : undefined;
            runId = undefined;
            runStartedAt = undefined;
        }
        session =
            loaded.lastEventId === undefined && session?.lastEventId !== undefined
                ? { ...loaded, lastEventId: session.lastEventId }
                : loaded;
        const pendingRequestIds = new Set(
            loaded.pendingUserInputs.map((request) => request.requestId),
        );
        for (const requestId of requestSubmissions.keys())
            if (!pendingRequestIds.has(requestId)) requestSubmissions.delete(requestId);
        status = "ready";
        error = undefined;
        runStatus = loaded.status === "running" ? "running" : "idle";
        commit();
    };

    const reconcile = async (): Promise<void> => {
        if (reconciling) {
            reconcileAgain = true;
            return;
        }
        reconciling = true;
        const current = generation;
        try {
            const loaded = await deps.transport.sessionRead(sessionId);
            if (disposed || !active || current !== generation) return;
            sessionAuthoritativeWrite(loaded);
        } catch (caught) {
            if (disposed || !active || current !== generation) return;
            if (status !== "ready") {
                status = "error";
                error = rigUserError(caught);
                commit();
            }
        } finally {
            reconciling = false;
            if (reconcileAgain && !disposed && active) {
                reconcileAgain = false;
                void reconcile();
            }
        }
    };

    const observer: RigEventObserver<RigSessionEvent> = {
        event: (value) => {
            if (disposed || !active) return;
            transientStreamingHintApply(value);
            if (value.type === "run_started" || value.type === "agent_event") commit();
            // Delivery hint: durable fields and lastEventId come only from sessionRead.
            void reconcile();
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
        if (recovering) return;
        recovering = true;
        unsubscribeSession?.();
        unsubscribeSession = undefined;
        const current = generation;
        const after = session?.lastEventId;
        try {
            if (after) await deps.transport.sessionEventsBackfill(sessionId, after);
        } catch {
            // A failed backfill is still a delivery hint; the full read below is
            // authoritative and sufficient to recover current durable state.
        } finally {
            recovering = false;
        }
        if (disposed || !active || current !== generation) return;
        await reconcile();
        if (active && !disposed && current === generation) openStream();
    };

    const start = (): void => {
        active = true;
        generation += 1;
        openStream();
        void reconcile();
        // Resume the usage poll if the panel was left open across a no-subscriber gap.
        if (usagePanelOpen && usageTimer === undefined && !disposed) {
            usageLoad();
            usageTimer = startInterval(usageLoad, usagePollMs);
        }
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        reconcileAgain = false;
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

    const sessionReplace = (loaded: RigSession): void => {
        sessionAuthoritativeWrite(loaded);
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
        sessionRetry: () => {
            if (status === "error" && active && !disposed) void reconcile();
        },
        messageSend: (text, images) =>
            rejecting(async () => {
                const key = createId();
                const steered = runStatus === "running";
                if (steered) {
                    await deps.transport.messageSteer(sessionId, text, key, runId, images);
                } else {
                    await deps.transport.messageSubmit(sessionId, text, key, images);
                }
                output({ type: "messageSent", sessionId, steered });
            }),
        runAbort: () =>
            rejecting(async () => {
                await deps.transport.runAbort(sessionId, runId);
                output({ type: "runAborted", sessionId });
            }),
        answerInput(input) {
            const existing = requestSubmissionPromises.get(input.requestId);
            if (existing) return existing;
            const operation = (async (): Promise<void> => {
                requestSubmissions.set(input.requestId, {
                    requestId: input.requestId,
                    status: "pending",
                });
                commit();
                try {
                    const loaded = await deps.transport.answerUserInput(sessionId, input);
                    requestSubmissions.delete(input.requestId);
                    sessionReplace(loaded);
                    output({ type: "inputAnswered", sessionId, requestId: input.requestId });
                } catch (caught) {
                    const submissionError = rigUserError(caught);
                    requestSubmissions.set(input.requestId, {
                        requestId: input.requestId,
                        status: "failed",
                        error: submissionError,
                    });
                    commit();
                    throw submissionError;
                } finally {
                    requestSubmissionPromises.delete(input.requestId);
                }
            })();
            requestSubmissionPromises.set(input.requestId, operation);
            return operation;
        },
        modelChange: (input) =>
            rejecting(async () => {
                sessionReplace(await deps.transport.changeModel(sessionId, input));
            }),
        effortChange: (effort) =>
            rejecting(async () => {
                sessionReplace(await deps.transport.changeEffort(sessionId, effort));
            }),
        permissionModeChange: (permissionMode) =>
            rejecting(async () => {
                sessionReplace(
                    await deps.transport.changePermissionMode(sessionId, permissionMode),
                );
            }),
        serviceTierChange: (serviceTier) =>
            rejecting(async () => {
                sessionReplace(await deps.transport.changeServiceTier(sessionId, serviceTier));
            }),
        compact: () =>
            rejecting(async () => {
                await deps.transport.compact(sessionId);
                sessionReplace(await deps.transport.sessionRead(sessionId));
            }),
        rewind: (messageId) =>
            rejecting(async () => {
                sessionReplace(await deps.transport.rewind(sessionId, messageId));
            }),
        sessionReset: () =>
            rejecting(async () => {
                if (transientStreamingPresentation) runRetire(transientStreamingPresentation.runId);
                transientStreamingPresentation = undefined;
                transientStreamingBaseAgentIds = new Set();
                ephemeral = [];
                sessionReplace(await deps.transport.sessionReset(sessionId));
            }),
        shellRun: (command) =>
            rejecting(async () => {
                // The action result is authoritative for this one-off local
                // presentation; shell SSE payloads remain delivery hints only.
                const commandId = createId();
                const result = await deps.transport.shellRun(sessionId, command, commandId);
                if (!ephemeral.some((entry) => entryKey(entry) === `shell:${commandId}`)) {
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
        settingsOpen() {
            if (settingsOpen) return;
            settingsOpen = true;
            commit();
        },
        settingsClose() {
            if (!settingsOpen) return;
            settingsOpen = false;
            commit();
        },
        imageOpen(messageId, attachmentId) {
            const resolved = openImageResolve(store.getState().entries, messageId, attachmentId);
            if (!resolved) return;
            openImage = resolved;
            commit();
        },
        imageClose() {
            if (!openImage) return;
            openImage = undefined;
            commit();
        },
        reasoningToggle() {
            showReasoning = !showReasoning;
            commit();
        },
        turnTraceToggle(turnId) {
            const next = new Set(expandedTurnIds);
            if (!next.delete(turnId)) next.add(turnId);
            expandedTurnIds = next;
            commit();
        },
        viewClear() {
            clearedIds = new Set(store.getState().entries.map(entryKey));
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

function defaultCreateId(): string {
    return `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
