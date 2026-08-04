import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { entriesMerge } from "../conversation/conversationEntries.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    entryKey,
    type ConversationEntry,
    type ConversationRequestSubmission,
} from "../conversation/conversationEntry.js";
import {
    rigCompactionEntry,
    rigConversationBuild,
    rigNoticeEntry,
    rigShellEntry,
} from "./rigConversationProject.js";
import { rigConversationAttachTurnTraces } from "./rigConversationTurnTrace.js";
import { rigConnectConversationProject } from "./rigConnectConversationProject.js";
import type {
    ChatElement,
    MutationRejectedDelta,
    RigConnection,
    SessionState,
    SessionUsage,
} from "@slopus/rig-connect";
import { rigMenusDerive } from "./rigMenusStore.js";
import {
    rigSelectionEffortUpdate,
    rigSelectionEqual,
    rigSelectionModelUpdate,
    rigSelectionPermissionModeUpdate,
    rigSelectionServiceTierUpdate,
} from "./rigSessionDraftStore.js";
import { deepEqual, rigUserError } from "./rigSupport.js";
import type {
    RigAgentEvent,
    RigEventObserver,
    RigSessionEvent,
    RigTransport,
} from "./rigTransport.js";
import type {
    RigBackgroundProcess,
    RigEventId,
    RigGoal,
    RigImageInput,
    RigMessage,
    RigMenusSnapshot,
    RigContextGauge,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigQueuedMessage,
    RigSelection,
    RigServiceTier,
    RigSession,
    RigSessionId,
    RigSessionUsage,
    RigUsageContext,
    RigStreamingBlock,
    RigStreamingMessage,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigToolEntry,
    RigUserInputAnswers,
    RigUserInputRequest,
    RigWorkingPhase,
} from "./rigTypes.js";

/** Longest live status label the footer renders before it is elided. */
const WORKING_LABEL_MAX = 64;

function latestUserMessageId(messages: readonly RigMessage[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && !message.internal && message.role === "user") return message.id;
    }
    return undefined;
}

function transcriptSessionBusy(session: SessionState): boolean {
    return session.activeTurn !== undefined;
}

/** Projects protocol activity into the small, closed vocabulary the UI renders. */
function workingPhaseProject(
    session: SessionState | undefined,
    streaming: RigStreamingMessage | undefined,
): RigWorkingPhase {
    switch (session?.activity.kind) {
        case "thinking":
            return "thinking";
        case "generating_message":
            return "texting";
        case "generating_tool_call":
            return "generatingTools";
        case "executing_tool_call":
            return "callingTools";
    }
    if (streaming) {
        for (let index = streaming.blocks.length - 1; index >= 0; index -= 1) {
            const block = streaming.blocks[index];
            if (block?.kind === "tool" && block.tool.status === "running") return "callingTools";
            if (block?.kind === "thinking") return "thinking";
            if (block?.kind === "text") return "texting";
        }
    }
    return "working";
}

/**
 * Prefers the agent's own humanized activity text over the generic phase word.
 *
 * The daemon describes what it is doing right now — "Running Bash", or a tool's
 * own status such as "Reading AGENTS.md" — so a status line says something more
 * useful than "Calling tools". An idle session has nothing to say.
 */
function workingLabelProject(session: SessionState | undefined): string | undefined {
    const activity = session?.activity;
    if (activity === undefined || activity.kind === "idle") return undefined;
    const label = activity.label.split("\n")[0]?.trim() ?? "";
    if (label.length === 0) return undefined;
    // A status line is a glance, not a report. A daemon that describes itself
    // with a whole sentence — a reconnect reason, say — keeps the opening of it
    // here; the full text stays on the notice row that carries it.
    return label.length > WORKING_LABEL_MAX
        ? `${label.slice(0, WORKING_LABEL_MAX - 1).trimEnd()}…`
        : label;
}

/**
 * Both ends of the agent's scheduled wait, while one is running.
 *
 * The daemon describes a wait with an absolute deadline it computed once
 * ("Waiting until 11:17:06 AM"), and that sentence stops telling the reader
 * anything the moment it is written. Projecting the interval lets the surface
 * count down against its own clock and show how much of the wait is spent;
 * both ends travel together because either alone measures nothing.
 */
function workingWaitProject(session: SessionState | undefined): RigWorkingWait | undefined {
    const wait = session?.activity.wait;
    if (wait === undefined) return undefined;
    if (!Number.isFinite(wait.startedAt) || !Number.isFinite(wait.dueAt)) return undefined;
    return { startedAt: wait.startedAt, dueAt: wait.dueAt };
}

function transcriptUsageProject(usage: SessionUsage): RigSessionUsage {
    return {
        currentProviderId: usage.currentProviderId,
        groups: usage.groups.map((group) => ({
            modelId: group.modelId,
            providerId: group.providerId,
            inputTokens: group.usage.input,
            outputTokens: group.usage.output,
            cacheReadTokens: group.usage.cacheRead,
            cacheWriteTokens: group.usage.cacheWrite,
            totalTokens: group.usage.totalTokens,
            ...(group.usage.reasoning === undefined
                ? {}
                : { reasoningTokens: group.usage.reasoning }),
            cost: group.usage.cost.total,
        })),
        totalTokens: usage.totalTokens,
        totalCost: usage.totalCost,
        ...(usage.context
            ? {
                  context: {
                      modelId: usage.context.modelId,
                      providerId: usage.context.providerId,
                      totalTokens: usage.context.totalTokens,
                      approximate: usage.context.approximate,
                  },
              }
            : {}),
        quotas: usage.quotas.map((quota) => ({
            providerId: quota.providerId,
            windows: (
                [
                    ["fiveHour", quota.quota.windows.fiveHour],
                    ["weekly", quota.quota.windows.weekly],
                ] as const
            ).flatMap(([kind, window]) =>
                window?.status === "available"
                    ? [{ kind, usedPercent: window.usedPercent, resetsAt: window.resetsAt }]
                    : [],
            ),
        })),
    };
}

function transcriptPendingUserInputsProject(session: SessionState): readonly RigUserInputRequest[] {
    return session.pendingUserInputs.map((request) => ({
        requestId: request.requestId,
        questions: request.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            multiSelect: question.multiSelect,
            required: question.required ?? false,
            options: question.options,
        })),
    }));
}

function transcriptQueuedMessagesProject(session: SessionState): readonly RigQueuedMessage[] {
    return session.pendingSteeringMessages.map((pending) => ({
        id: pending.message.id,
        text: pending.message.blocks
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
    }));
}

function transcriptTasksProject(session: SessionState): readonly RigTask[] {
    return session.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        description: task.description,
        status: task.status,
        ...(task.activeForm === undefined ? {} : { activeForm: task.activeForm }),
        ...(task.owner === undefined ? {} : { owner: task.owner }),
        blockedBy: task.blockedBy,
        blocks: task.blocks,
    }));
}

function transcriptGoalProject(session: SessionState): RigGoal | undefined {
    const goal = session.goal;
    return goal === undefined
        ? undefined
        : {
              objective: goal.objective,
              status: goal.status,
              createdAt: goal.createdAt,
              updatedAt: goal.updatedAt,
          };
}

function transcriptSubagentsProject(session: SessionState): readonly RigSubagentSummary[] {
    return session.subagents.map((subagent) => ({
        id: subagent.id as RigSessionId,
        parentSessionId: subagent.parentSessionId as RigSessionId,
        ...(subagent.parentToolCallId === undefined
            ? {}
            : { parentToolCallId: subagent.parentToolCallId }),
        description: subagent.description,
        ...(subagent.taskName === undefined ? {} : { taskName: subagent.taskName }),
        modelId: subagent.modelId,
        status: subagent.status,
        depth: subagent.depth,
        createdAt: subagent.createdAt,
        updatedAt: subagent.updatedAt,
        ...(subagent.activeSince === undefined ? {} : { activeSince: subagent.activeSince }),
        ...(subagent.elapsedMs === undefined ? {} : { elapsedMs: subagent.elapsedMs }),
        ...(subagent.latestText === undefined ? {} : { latestText: subagent.latestText }),
        ...(subagent.totalTokens === undefined ? {} : { totalTokens: subagent.totalTokens }),
    }));
}

function transcriptBackgroundProcessesProject(
    session: SessionState,
): readonly RigBackgroundProcess[] {
    return session.backgroundProcesses.map((process) => ({
        id: process.sessionId,
        command: process.command,
        cwd: process.cwd,
        status: process.status,
    }));
}

function transcriptEphemeralProject(
    session: SessionState,
    legacy: readonly ConversationEntry[],
): readonly ConversationEntry[] {
    // rig-connect already owns compaction elements. Keep the legacy row only
    // for the legacy transcript fallback; merging it here renders the same
    // compaction twice under two unrelated element ids.
    const entries = new Map(
        legacy
            .filter((entry) => !entryKey(entry).startsWith("compaction:"))
            .map((entry) => [entryKey(entry), entry]),
    );
    for (const command of session.shellCommands) {
        const id = `shell:${command.commandId}`;
        entries.set(
            id,
            rigShellEntry(id, {
                command: command.command,
                output: command.output ?? command.errorMessage ?? "",
                exitCode: command.exitCode ?? null,
                running: command.status === "running",
                timedOut: command.timedOut ?? false,
            }),
        );
    }
    return [...entries.values()];
}

/** One scheduled wait an agent turn is sitting inside, as both of its ends. */
export interface RigWorkingWait {
    /** Epoch ms the wait began at. */
    readonly startedAt: number;
    /** Epoch ms the wait ends at. */
    readonly dueAt: number;
}

export interface RigChatSnapshot {
    readonly sessionId: RigSessionId;
    /** True once either rig-connect or the explicit legacy fallback has loaded. */
    readonly ready: boolean;
    readonly archived: boolean;
    readonly title?: string;
    readonly cwd?: string;
    readonly draft?: string;
    readonly draftUpdatedAt?: number;
    /** Durable session snapshot; the authoritative source for entries + config. */
    readonly session: Loadable<RigSession>;
    /** Ordered render list: durable messages, agent activity, notices, requests. */
    readonly entries: readonly ConversationEntry[];
    /** In-flight assistant message assembled from streaming deltas, when running. */
    readonly streaming?: RigStreamingMessage;
    readonly runStatus: "idle" | "running";
    readonly workingPhase: RigWorkingPhase;
    /** Display-ready activity text from the agent, when it describes its work. */
    readonly workingLabel?: string;
    /** The scheduled wait the agent is inside, so a surface can count it down. */
    readonly workingWait?: RigWorkingWait;
    /** Durable user-message id of the one turn currently running. */
    readonly activeTurnId?: string;
    readonly runId?: string;
    readonly runStartedAt?: number;
    /** Wall-clock duration of the most recently completed run, in milliseconds. */
    readonly turnElapsedMs?: number;
    readonly transcriptComplete: boolean;
    readonly loadingMore: boolean;
    readonly loadMoreError?: string;
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly requestSubmissions: readonly ConversationRequestSubmission[];
    /**
     * Options ticked into a pending question but not submitted yet, by request
     * id. They live here rather than inside the card because sending a message
     * answers the question, and that answer must carry a choice the reader has
     * already made.
     */
    readonly requestSelections: ReadonlyMap<string, Readonly<Record<string, readonly string[]>>>;
    /** Pending steering command state; the messages themselves live in `entries`. */
    readonly queuedMessages: readonly RigQueuedMessage[];
    readonly tasks: readonly RigTask[];
    readonly goal?: RigGoal;
    readonly subagents: readonly RigSubagentSummary[];
    readonly backgroundProcesses: readonly RigBackgroundProcess[];
    /**
     * True while the daemon will refuse a model change: a run is active or work
     * is queued behind it. Effort, access mode, and tier stay changeable.
     */
    readonly modelLocked: boolean;
    /** View state: whether thinking blocks are shown (hidden by default). */
    readonly showReasoning: boolean;
    /** Finished turns the reader opened; their intermediate entries are listed. */
    readonly expandedTurnIds: ReadonlySet<string>;
    /** View state: whether the `/usage` panel is open. */
    readonly usagePanelOpen: boolean;
    /** Latest usage snapshot while the panel is open; undefined before the first load. */
    readonly usage?: RigSessionUsage;
    /** True while a usage load/poll is in flight (first load or a refresh tick). */
    readonly usageLoading: boolean;
    /** Displayable message from the most recent failed usage load, if any. */
    readonly usageError?: string;
    /**
     * Room left in the context window, when both a token count and a declared
     * window are known. Unlike `usage`, this is meant to be on screen all the
     * time, so it is derived here rather than left to each surface.
     */
    readonly contextGauge?: RigContextGauge;
    /** View state: whether the `/goal` + `/tasks` + `/agents` activity panel is open. */
    readonly activityPanelOpen: boolean;
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
    /** Loads the next authoritative page before the current transcript window. */
    historyLoadMore(): void;
    /**
     * Submits when idle, steers when a run is active; rejects with a `UserError`.
     * `images` ride along inline with the turn, since a local session has no
     * upload step to reference bytes by id.
     *
     * While a question is pending this answers it instead of only queueing
     * words: the agent is stopped inside the call that asked and reads nothing
     * until that call returns, so a message sent beside the question would
     * leave it waiting on a reader who believes they have replied. Options
     * already ticked into the question are the answer to their own questions;
     * the typed text answers whatever was left blank, and is sent as an
     * ordinary message when the ticks already answered everything, so nothing
     * written or chosen is dropped.
     */
    messageSend(text: string, images?: readonly RigImageInput[]): Promise<void>;
    draftSet(draft: string, updatedAt: number, origin: string): Promise<void>;
    runAbort(): Promise<void>;
    answerInput(input: RigUserInputAnswers): Promise<void>;
    /**
     * Records the options ticked into a pending question before it is submitted,
     * so a message sent instead of pressing Submit can still carry them.
     */
    requestSelectionUpdate(
        requestId: string,
        answers: Readonly<Record<string, readonly string[]>>,
    ): void;
    /*
     * Picking a model, effort, access mode, or tier states an intent; sending is
     * what applies it. These are local and synchronous — nothing reaches the
     * daemon here, so choosing is instant and cannot fail, and the same act
     * configures a session that does not exist yet and one that does.
     *
     * The daemon refuses a model change while a run is active or queued, which
     * is why the choice cannot simply be applied on the spot: the reader would
     * be told to wait rather than have their next turn honoured.
     */
    modelUpdate(input: RigModelSelection): void;
    effortUpdate(effort?: RigThinkingLevel): void;
    permissionModeUpdate(permissionMode: RigPermissionMode): void;
    serviceTierUpdate(serviceTier?: RigServiceTier): void;
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
     * Reads the session's current usage snapshot for the `/usage` panel. Pure query
     * against the transport; does not mutate or cache durable snapshot state, so a
     * visible panel may poll it without disturbing the transcript.
     */
    usageGet(): Promise<RigSessionUsage>;
    /**
     * Opens the `/usage` panel. rig-connect keeps local usage live through the
     * session stream; the legacy fallback polls only while this panel is visible.
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
 * Why a compaction pass happened, in the reader's words rather than the wire's.
 */
const COMPACTION_REASON: Record<"context_window" | "manual" | "threshold", string> = {
    context_window: "context window full",
    manual: "requested",
    threshold: "reached threshold",
};

/** Why an inference attempt is being retried, in the reader's words. */
const RETRY_REASON: Record<"connection_lost" | "incomplete_response", string> = {
    connection_lost: "Connection lost",
    incomplete_response: "Incomplete response",
};

/**
 * Token counts as a reader scans them. Compaction figures run to six digits,
 * where the exact number is noise and the magnitude is the whole point.
 */
function tokensFormat(tokens: number): string {
    if (tokens < 1000) return String(Math.max(0, Math.round(tokens)));
    const thousands = tokens / 1000;
    return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, "") : String(Math.round(thousands))}k`;
}

/**
 * Room left in the window the reported tokens were counted against. The window
 * comes from the catalog entry for the model the usage names — not the model
 * currently selected, which may have been switched since — so the fraction is
 * always tokens and window agreeing about the same model.
 *
 * Nothing is reported when either half is missing or the window is zero: a
 * gauge with a made-up denominator is worse than no gauge.
 */
function contextGaugeDerive(
    catalog: RigModelCatalog,
    context: RigUsageContext | undefined,
): RigContextGauge | undefined {
    if (!context) return undefined;
    const total = catalog.providers
        .find((provider) => provider.id === context.providerId)
        ?.models.find((model) => model.id === context.modelId)?.contextWindow;
    if (total === undefined || total <= 0) return undefined;
    // Usage can exceed a declared window — an estimate can overshoot, and a
    // provider can count differently than it documents. Clamp rather than
    // render a negative remainder.
    const usedTokens = Math.max(0, Math.min(context.totalTokens, total));
    const remainingTokens = total - usedTokens;
    return {
        usedTokens,
        remainingTokens,
        totalTokens: total,
        remainingFraction: remainingTokens / total,
        approximate: context.approximate,
    };
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
            if (attachment.id !== attachmentId) continue;
            if (attachment.kind === "inlineImage")
                return {
                    id: attachment.id,
                    url: `data:${attachment.mediaType};base64,${attachment.data}`,
                    alt: "Attached image",
                };
            if (
                attachment.kind === "linked" &&
                attachment.attachmentKind === "image" &&
                attachment.openUrl
            )
                return {
                    id: attachment.id,
                    url: attachment.openUrl,
                    alt: attachment.name,
                };
        }
        return undefined;
    }
    return undefined;
}

export interface RigChatDeps {
    readonly transport: RigTransport;
    readonly catalog: RigModelCatalog;
    readonly selectionUsed?: (selection: RigSelection) => void;
    readonly modelSelect?: (current: RigSelection, input: RigModelSelection) => RigSelection;
    readonly output?: (event: RigChatOutput) => void;
    readonly createId?: () => string;
    readonly now?: () => number;
    /** Usage poll cadence in ms while the `/usage` panel is open. Defaults to 5s. */
    readonly usagePollMs?: number;
    /** Injectable timer for the usage poll; defaults to the global `setInterval`. */
    readonly setInterval?: (handler: () => void, milliseconds: number) => unknown;
    /** Injectable timer clear for the usage poll; defaults to the global `clearInterval`. */
    readonly clearInterval?: (handle: unknown) => void;
    /** Opens rig-connect's core transcript stream when this store becomes observed. */
    readonly transcriptConnect?: RigChatTranscriptConnect;
    /** Shared optimistic mutation authority paired with `transcriptConnect`. */
    readonly connectActions?: Pick<
        RigConnection,
        | "answerUserInput"
        | "compactSession"
        | "resetSession"
        | "rewindSession"
        | "runShellCommand"
        | "sendMessage"
        | "setDraft"
        | "setEffort"
        | "setPermissionMode"
        | "setServiceTier"
        | "stopBackgroundProcess"
        | "stopRun"
        | "switchModel"
    >;
    readonly connectMutationSubscribe?: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
}

export interface RigChatTranscriptConnection {
    close(): void;
    loadMore(token: string): void;
}

export type RigChatTranscriptConnect = (options: {
    readonly sessionId: RigSessionId;
    readonly onChange: (elements: readonly ChatElement[], session: SessionState) => void;
    readonly onError: (error: unknown) => void;
}) => RigChatTranscriptConnection;

/**
 * The chat surface store for one session. The constructor opens nothing; the
 * first subscriber opens rig-connect when supplied, and the last unsubscribe
 * tears it down. rig-connect owns the bounded transcript, live application state,
 * and mutations without a parallel session read or event backfill. The existing
 * reader activates only as a terminal fallback for an older/refused connector;
 * there, each legacy `SessionEvent` remains a delivery hint that schedules a
 * coalesced `sessionRead` rather than writing durable state or a cursor.
 * The HTTP event-history difference read supplies message timestamps and
 * per-message run outcomes because Rig's durable message objects omit them.
 * Agent deltas alone feed explicitly transient streaming presentation, which a
 * successful durable read supersedes on completion.
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
    let messageCreatedAt = new Map<string, number>();
    let messageGenerationStatus = new Map<string, "streaming" | "complete" | "failed">();
    let agentMessageIdsByRun = new Map<string, ReadonlySet<string>>();
    let runGenerationStatus = new Map<string, "complete" | "failed">();
    // Original request start, retained across every steering segment so the
    // final "Completed in" reports the whole run.
    let runStartedAtByRun = new Map<string, number>();
    // Current segment start, advanced by steering so intermediate boundaries
    // can report "Steered after" for the work since the preceding prompt.
    let turnStartedAtByRun = new Map<string, number>();
    let turnUserIdByRun = new Map<string, string>();
    let turnFinishedAtByRun = new Map<string, number>();
    let steeringMessageIds: ReadonlySet<string> = new Set();
    let toolCallCreatedAt = new Map<string, readonly number[]>();
    let messageTimestampCursor: RigEventId | undefined;
    let transientStreamingPresentation: RigStreamingMessage | undefined;
    // Run ids retired by durable completion. The bounded session-lifetime set
    // rejects delayed events from more than merely the most recent run.
    const retiredRunIds = new Set<string>();
    const retiredRunOrder: string[] = [];
    const RETIRED_RUN_LIMIT = 128;
    let ephemeral: ConversationEntry[] = [];
    let transcriptElements: readonly ChatElement[] | undefined;
    let transcriptSession: SessionState | undefined;
    let transcriptConnection: RigChatTranscriptConnection | undefined;
    let mutationRejection: MutationRejectedDelta | undefined;
    const pendingMutationIds = new Set<string>();
    const pendingMutationOrder: string[] = [];
    const PENDING_MUTATION_LIMIT = 2_048;
    /**
     * How much base64 image data one chat keeps on behalf of messages it has
     * sent. Comfortably several screenshots, and far short of what a window
     * should hold on to for pictures the daemon already has.
     */
    const SENT_IMAGE_BUDGET_BYTES = 32 * 1024 * 1024;
    /**
     * What the reader has picked but not yet sent. Absent means the pickers show
     * the session's own configuration; present means they show the choice, which
     * the next message applies. It is never seeded from the session — deriving
     * from `selectionIntent ?? selectionOf(session)` keeps one authority instead
     * of a copy that has to be kept in step with it.
     */
    let selectionIntent: RigSelection | undefined;
    let runStatus: "idle" | "running" = "idle";
    // A run can be locally pending before its submitted user message exists in
    // the durable session. Keep that gap unbound: inferring the last visible
    // turn here briefly reopens the previous completed turn on every send.
    let activeTurnId: string | undefined;
    let pendingFreshTurn: { readonly precedingUserId?: string } | undefined;
    let runId: string | undefined;
    let runStartedAt: number | undefined;
    let turnElapsedMs: number | undefined;
    /**
     * Final duration of each finished turn, keyed by the user message that
     * opened it. Durable event-history timestamps are authoritative; the live
     * request clock is only a fallback when that history is unavailable.
     */
    let turnDurations = new Map<string, number>();
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
    let openImage: RigOpenImage | undefined;
    // Entry ids hidden by a view-only `/clear`; new entries render as usual.
    let clearedIds = new Set<string>();
    let status: "loading" | "ready" | "error" = "loading";
    let error: UserError | undefined;
    const requestSubmissions = new Map<string, ConversationRequestSubmission>();
    const requestSubmissionPromises = new Map<string, Promise<void>>();
    const requestSelections = new Map<string, Readonly<Record<string, readonly string[]>>>();

    const store = createStore<RigChatSnapshot>()(() => ({
        sessionId,
        session: { type: "loading" },
        modelLocked: false,
        ready: false,
        archived: false,
        entries: [],
        runStatus: "idle",
        workingPhase: "working",
        transcriptComplete: true,
        loadingMore: false,
        activeTurnId: undefined,
        pendingUserInputs: [],
        requestSubmissions: [],
        requestSelections: new Map(),
        queuedMessages: [],
        tasks: [],
        subagents: [],
        backgroundProcesses: [],
        showReasoning: false,
        expandedTurnIds: new Set<string>(),
        usagePanelOpen: false,
        usageLoading: false,
        activityPanelOpen: false,
    }));

    const sessionLoadable = (): Loadable<RigSession> =>
        status === "ready" && session
            ? { type: "ready", value: session }
            : status === "error" && error
              ? { type: "error", error }
              : { type: "loading" };

    const commit = (): void => {
        const previous = store.getState();
        const pendingUserInputs =
            transcriptSession === undefined
                ? (session?.pendingUserInputs ?? [])
                : transcriptPendingUserInputsProject(transcriptSession);
        // Shell-mode commands still execute and reconcile, but are temporarily
        // absent from the transcript. Agent Bash tool calls remain ordinary
        // durable tool entries and are not affected by this view-only filter.
        const projectedEphemeral = (
            transcriptSession === undefined
                ? ephemeral
                : transcriptEphemeralProject(transcriptSession, ephemeral)
        ).filter((entry) => entry.kind !== "agentActivity" || entry.activity.kind !== "shell");
        // Also the transcript's source of sender names: background-work news
        // quotes the description of the subagent that sent it.
        const subagents =
            transcriptSession === undefined
                ? (session?.subagents ?? [])
                : transcriptSubagentsProject(transcriptSession);
        const built =
            transcriptElements === undefined
                ? rigConversationAttachTurnTraces(
                      rigConversationBuild({
                          sessionId,
                          session,
                          // Streaming belongs to a turn only after the authoritative
                          // session identifies that turn. Showing it earlier would append
                          // it to whichever completed turn happened to be last.
                          streaming:
                              activeTurnId === undefined
                                  ? undefined
                                  : transientStreamingPresentation,
                          ephemeral: projectedEphemeral,
                          showReasoning,
                          pendingUserInputs,
                          messageCreatedAt,
                          messageGenerationStatus,
                          toolCallCreatedAt,
                      }),
                      {
                          activeTurnId,
                          expandedTurnIds,
                          steeringMessageIds,
                          durations: turnDurations,
                      },
                  )
                : rigConnectConversationProject({
                      elements: transcriptElements,
                      sentImages,
                      sessionId,
                      showReasoning,
                      ephemeral: projectedEphemeral,
                      pendingUserInputs,
                      expandedGroupIds: expandedTurnIds,
                      subagents,
                  });
        const withHistoryState: readonly ConversationEntry[] =
            transcriptSession?.loadingMore === true
                ? [
                      {
                          kind: "notice",
                          id: "rig-connect:loading-more",
                          variant: "notice",
                          level: "info",
                          text: "Loading earlier messages…",
                          sequence: "",
                      },
                      ...built,
                  ]
                : transcriptSession?.loadMoreError
                  ? [
                        {
                            kind: "notice",
                            id: "rig-connect:load-more-error",
                            variant: "notice",
                            level: "error",
                            title: "Earlier messages unavailable",
                            text: transcriptSession.loadMoreError,
                            sequence: "",
                        },
                        ...built,
                    ]
                  : built;
        const withMutationState: readonly ConversationEntry[] = mutationRejection
            ? [
                  {
                      kind: "notice",
                      id: `rig-connect:mutation-rejected:${mutationRejection.mutationId}`,
                      variant: "notice",
                      level: "error",
                      title: "Action not applied",
                      text: mutationRejection.message,
                      sequence: "",
                  },
                  ...withHistoryState,
              ]
            : withHistoryState;
        const visible =
            clearedIds.size === 0
                ? withMutationState
                : withMutationState.filter((entry) => !clearedIds.has(entryKey(entry)));
        const entries = entriesMerge(previous.entries, visible);
        const next: RigChatSnapshot = {
            sessionId,
            ready: transcriptSession !== undefined || status === "ready",
            archived: transcriptSession?.archived ?? session?.status === "archived",
            ...((transcriptSession?.title ?? session?.title)
                ? { title: transcriptSession?.title ?? session?.title }
                : {}),
            ...((transcriptSession?.cwd ?? session?.displayCwd ?? session?.cwd)
                ? { cwd: transcriptSession?.cwd ?? session?.displayCwd ?? session?.cwd }
                : {}),
            ...((transcriptSession?.draft ?? session?.draft) !== undefined
                ? { draft: transcriptSession?.draft ?? session?.draft }
                : {}),
            ...((transcriptSession?.draftUpdatedAt ?? session?.draftUpdatedAt) !== undefined
                ? {
                      draftUpdatedAt: transcriptSession?.draftUpdatedAt ?? session?.draftUpdatedAt,
                  }
                : {}),
            session: sessionLoadable(),
            entries,
            streaming: transientStreamingPresentation,
            runStatus,
            workingPhase: workingPhaseProject(transcriptSession, transientStreamingPresentation),
            workingLabel: workingLabelProject(transcriptSession),
            workingWait: workingWaitProject(transcriptSession),
            activeTurnId,
            runId,
            runStartedAt,
            turnElapsedMs,
            transcriptComplete: transcriptSession?.transcriptComplete ?? true,
            loadingMore: transcriptSession?.loadingMore ?? false,
            ...(transcriptSession?.loadMoreError
                ? { loadMoreError: transcriptSession.loadMoreError }
                : {}),
            pendingUserInputs,
            requestSubmissions: [...requestSubmissions.values()],
            requestSelections: new Map(requestSelections),
            queuedMessages:
                transcriptSession === undefined
                    ? (session?.queuedMessages ?? [])
                    : transcriptQueuedMessagesProject(transcriptSession),
            tasks:
                transcriptSession === undefined
                    ? (session?.tasks ?? [])
                    : transcriptTasksProject(transcriptSession),
            goal:
                transcriptSession === undefined
                    ? session?.goal
                    : transcriptGoalProject(transcriptSession),
            subagents,
            backgroundProcesses:
                transcriptSession === undefined
                    ? (session?.backgroundProcesses ?? [])
                    : transcriptBackgroundProcessesProject(transcriptSession),
            showReasoning,
            expandedTurnIds,
            usagePanelOpen,
            usage:
                transcriptSession?.usage === undefined
                    ? usage
                    : transcriptUsageProject(transcriptSession.usage),
            usageLoading: transcriptSession === undefined ? usageLoading : false,
            usageError: transcriptSession === undefined ? usageError : undefined,
            ...(() => {
                const connectedUsage = transcriptSession?.usage
                    ? transcriptUsageProject(transcriptSession.usage)
                    : usage;
                const gauge = contextGaugeDerive(deps.catalog, connectedUsage?.context);
                return gauge ? { contextGauge: gauge } : {};
            })(),
            activityPanelOpen,
            openImage,
            modelLocked: transcriptSession?.modelLocked ?? session?.modelLocked ?? false,
            // The pickers show the pending choice when there is one, so what the
            // reader selected stays selected until the message that applies it.
            menus: transcriptSession
                ? rigMenusDerive(deps.catalog, {
                      providerId: transcriptSession.providerId,
                      modelId: transcriptSession.modelId,
                      effort: transcriptSession.effort as RigThinkingLevel | undefined,
                      permissionMode: transcriptSession.permissionMode as RigPermissionMode,
                      serviceTier: transcriptSession.serviceTier as RigServiceTier | undefined,
                  })
                : session
                  ? rigMenusDerive(deps.catalog, selectionIntent ?? selectionOf(session))
                  : undefined,
        };
        if (deepEqual(previous, next)) return;
        store.setState(next, true);
    };

    // --- streaming block helpers ------------------------------------------
    const transientStreamBlocks = (): RigStreamingBlock[] =>
        transientStreamingPresentation ? [...transientStreamingPresentation.blocks] : [];
    const transientStreamSet = (blocks: RigStreamingBlock[]): void => {
        transientStreamingPresentation = transientStreamingPresentation
            ? {
                  runId: transientStreamingPresentation.runId,
                  messageId: transientStreamingPresentation.messageId,
                  blocks,
              }
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
    /**
     * Places an ephemeral entry under its own stable key: a first delivery
     * appends, a repeat replaces in place. Every ephemeral row a run produces —
     * shell output, run notices, the compaction row — is keyed rather than
     * appended blindly, because SSE redelivers events and an append would show
     * the same failure or the same compaction twice.
     */
    const upsertEphemeral = (id: string, entry: ConversationEntry): void => {
        const index = ephemeral.findIndex((existing) => entryKey(existing) === id);
        if (index === -1) {
            ephemeral = [...ephemeral, entry];
            return;
        }
        const next = ephemeral.slice();
        next[index] = entry;
        ephemeral = next;
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
        upsertEphemeral(id, rigShellEntry(id, patch));
    };

    /** The compaction row of the run currently streaming, keyed so it settles in place. */
    const compactionEntryId = (): string => `compaction:${runId ?? "session"}`;

    /**
     * Marks the open compaction row finished. Compaction ends either by
     * reporting what it compacted (`context_compacted`) or by simply closing
     * (`context_compaction_finished`); whichever arrives first settles the row,
     * so a pass that never reports sizes still stops spinning.
     */
    const compactionSettle = (subject?: string): void => {
        const id = compactionEntryId();
        const open = ephemeral.find((entry) => entryKey(entry) === id);
        if (!open && subject === undefined) return;
        upsertEphemeral(id, rigCompactionEntry(id, "success", subject));
    };

    /** Run notices are keyed by what produced them so a redelivered event does not stack. */
    const noticeUpsert = (
        id: string,
        level: "info" | "warning" | "error",
        title: string,
        text: string,
        retry?: { readonly attempt?: number; readonly maxAttempts?: number },
    ): void => {
        upsertEphemeral(id, rigNoticeEntry(id, level, title, text, retry));
    };

    const transientAgentEventApply = (event: RigAgentEvent): void => {
        switch (event.type) {
            case "inference_iteration_start":
                break;
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
            case "toolcall_delta":
            case "toolcall_end":
                /*
                 * Provider inference events contain only the raw tool call.
                 * The first user-visible row arrives at execution start, when
                 * Rig has applied the tool-owned call presentation. Rendering
                 * this earlier would briefly flash a generic tool-name row.
                 */
                break;
            case "tool_execution_start":
                transientToolUpdate(
                    event.toolCallId,
                    (entry) => ({
                        ...entry,
                        toolName: event.toolName,
                        arguments: event.arguments,
                        ...(event.presentation ? { presentation: event.presentation } : {}),
                        status: "running",
                    }),
                    () => ({
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        arguments: event.arguments,
                        ...(event.presentation ? { presentation: event.presentation } : {}),
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
                        /*
                         * Exploration is authoritative call classification.
                         * Other call presentations are previews: a successful
                         * result enriches them, while a failed result has no
                         * presentation and leaves the preview intact.
                         */
                        ...(entry.presentation?.type !== "exploration" && event.presentation
                            ? { presentation: event.presentation }
                            : {}),
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
                        ...(event.presentation ? { presentation: event.presentation } : {}),
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
            case "context_compaction_started":
                upsertEphemeral(
                    compactionEntryId(),
                    rigCompactionEntry(compactionEntryId(), "running"),
                );
                break;
            case "context_compacted":
                // The pass reports what it compacted between. A manual
                // `/compact` produces this without a start event, so the row is
                // created here when it does not already exist.
                compactionSettle(
                    `${tokensFormat(event.estimatedTokensBefore)} → ${tokensFormat(
                        event.estimatedTokensAfter,
                    )} tokens · ${COMPACTION_REASON[event.reason]}`,
                );
                break;
            case "context_compaction_finished":
                compactionSettle();
                break;
            case "inference_retry":
                // Each attempt is its own row: a run that retries four times
                // should read as four attempts, not one line that rewrites
                // itself while the reader is looking away from the screen.
                noticeUpsert(
                    `retry:${runId ?? "session"}:${String(event.attempt)}`,
                    "warning",
                    "Retrying",
                    RETRY_REASON[event.reason],
                    { attempt: event.attempt, maxAttempts: event.maxAttempts },
                );
                break;
            case "error":
                // A mid-run failure the agent reported. It is keyed by its text
                // so a redelivered event does not stack, but two different
                // failures in one run both stay on screen.
                noticeUpsert(
                    `error:${runId ?? "session"}:${event.reason}`,
                    "error",
                    "Run failed",
                    event.reason,
                );
                break;
        }
    };

    const transientRunStart = (streamRunId: string): boolean => {
        if (retiredRunIds.has(streamRunId)) return false;
        // A delayed or reordered event for a different run must never replace
        // the stream whose id currently guards steering and abort operations.
        if (
            transientStreamingPresentation !== undefined &&
            transientStreamingPresentation.runId !== streamRunId
        )
            return false;
        runId = streamRunId;
        // Prefer the clock set when the user sent the request (before the first
        // token). Only fall back to "now" when the stream arrives without that.
        if (runStartedAt === undefined) runStartedAt = now();
        turnElapsedMs = undefined;
        runStatus = "running";
        return true;
    };

    const transientStreamingStart = (streamRunId: string, messageId: string): void => {
        if (!transientRunStart(streamRunId)) return;
        if (
            session?.messages.some(
                (message) =>
                    message.role === "agent" && !message.internal && message.id === messageId,
            )
        )
            return;
        if (
            transientStreamingPresentation?.runId === streamRunId &&
            transientStreamingPresentation.messageId === messageId
        )
            return;
        transientStreamingPresentation = { runId: streamRunId, messageId, blocks: [] };
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
                transientRunStart(event.runId);
                break;
            case "agent_event":
                if (event.event.type === "inference_iteration_start")
                    transientStreamingStart(event.runId, event.event.messageId);
                else if (event.messageId !== undefined)
                    transientStreamingStart(event.runId, event.messageId);
                else transientRunStart(event.runId);
                if (
                    transientStreamingPresentation?.runId === event.runId &&
                    (event.messageId === undefined ||
                        transientStreamingPresentation.messageId === event.messageId)
                )
                    transientAgentEventApply(event.event);
                break;
            case "run_error":
            case "run_finished":
                // A run that ends badly is the one failure the reader most
                // needs and the only place its text exists: the durable session
                // records that the run stopped, never why. A compaction row
                // still spinning when the run ends is closed with it, so a
                // failed pass cannot spin forever.
                compactionSettle();
                if (event.errorMessage !== undefined)
                    noticeUpsert(
                        `run-error:${event.runId}`,
                        "error",
                        "Run failed",
                        event.errorMessage,
                    );
                // The context gauge is on screen whether or not the usage panel
                // is, and a finished run is the only thing that moves it, so
                // refresh here rather than by polling a number that cannot
                // change between turns.
                if (!usagePanelOpen) usageLoad(true);
                runRetire(event.runId);
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
     * Records the finished request's duration under the user message that opened
     * the turn, so the permanent status line keeps "Done in Xm Ys".
     */
    const turnDurationRecord = (loaded: RigSession, elapsedMs: number): void => {
        for (let index = loaded.messages.length - 1; index >= 0; index -= 1) {
            const message = loaded.messages[index];
            if (!message || message.internal || message.role !== "user") continue;
            if (turnDurations.has(message.id)) break;
            turnDurations = new Map(turnDurations).set(message.id, elapsedMs);
            break;
        }
    };

    /**
     * Private authoritative-input boundary. Only transport reads/action results
     * enter here; session-event payloads never call it and it emits no output.
     */
    const sessionAuthoritativeWrite = (loaded: RigSession): void => {
        const loadedHasStreamingMessage =
            transientStreamingPresentation !== undefined &&
            loaded.messages.some(
                (message) =>
                    message.role === "agent" &&
                    !message.internal &&
                    message.id === transientStreamingPresentation?.messageId,
            );
        // Drop the live streaming presentation once durable agent text for this
        // run appears (or the session leaves running). Do not touch the
        // request-send clock here: mid-turn agent text is common while tools
        // keep going for minutes, and finalizing duration at that point is what
        // made a 10-minute run read as "Done in 6s".
        if (
            transientStreamingPresentation &&
            (loadedHasStreamingMessage || loaded.status !== "running")
        ) {
            if (loaded.status !== "running") runRetire(transientStreamingPresentation.runId);
            transientStreamingPresentation = undefined;
        }
        // The working clock spans the whole request: from message send until the
        // session itself is no longer running. Require that a real run was
        // observed (stream run id, or the server was already running) so an
        // optimistic post-send reconcile cannot stamp "Done in 0s" and clear
        // the clock before work starts.
        const serverWasRunning = session?.status === "running";
        if (
            runStartedAt !== undefined &&
            loaded.status !== "running" &&
            (runId !== undefined || serverWasRunning)
        ) {
            turnElapsedMs = Math.max(0, now() - runStartedAt);
            turnDurationRecord(loaded, turnElapsedMs);
            runStartedAt = undefined;
            runId = undefined;
        }
        session =
            loaded.lastEventId === undefined && session?.lastEventId !== undefined
                ? { ...loaded, lastEventId: session.lastEventId }
                : loaded;
        // The user message is the durable turn identity in Rig. Bind activity
        // only while the session itself says that exact turn is running; the
        // optimistic request interval intentionally has no active turn.
        const latestUserId = latestUserMessageId(loaded.messages);
        if (
            loaded.status === "running" &&
            latestUserId !== undefined &&
            (pendingFreshTurn === undefined || latestUserId !== pendingFreshTurn.precedingUserId)
        ) {
            activeTurnId = latestUserId;
            pendingFreshTurn = undefined;
        } else if (loaded.status !== "running") {
            activeTurnId = undefined;
            if (loaded.status === "error" || loaded.status === "aborted")
                pendingFreshTurn = undefined;
        }
        // The session already is what was pending — applied here, or changed to
        // it elsewhere — so there is nothing left to apply and the pickers go
        // back to reading the session directly.
        if (selectionIntent && rigSelectionEqual(selectionOf(loaded), selectionIntent))
            selectionIntent = undefined;
        const pendingRequestIds = new Set(
            loaded.pendingUserInputs.map((request) => request.requestId),
        );
        for (const requestId of requestSubmissions.keys())
            if (!pendingRequestIds.has(requestId)) requestSubmissions.delete(requestId);
        // A question that is no longer being asked has nothing left to tick.
        for (const requestId of requestSelections.keys())
            if (!pendingRequestIds.has(requestId)) requestSelections.delete(requestId);
        status = "ready";
        error = undefined;
        // Keep the UI in the running state for the whole request-send clock, not
        // only while the server reports "running" — after the first durable
        // agent text the stream presentation is gone but tools may still run.
        if (transcriptSession === undefined) {
            if (loaded.status === "error" || loaded.status === "aborted") {
                runStatus = "idle";
                if (runId === undefined) {
                    runStartedAt = undefined;
                    turnElapsedMs = undefined;
                }
            } else {
                runStatus =
                    loaded.status === "running" || runStartedAt !== undefined ? "running" : "idle";
            }
        }
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
            const [loaded, timestampEvents] = await Promise.all([
                deps.transport.sessionRead(sessionId),
                deps.transport
                    .sessionEventsBackfill(sessionId, messageTimestampCursor)
                    .catch(() => []),
            ]);
            if (disposed || !active || current !== generation) return;
            if (timestampEvents.length > 0) {
                const next = new Map(messageCreatedAt);
                const nextStatuses = new Map(messageGenerationStatus);
                const nextMessageIdsByRun = new Map(agentMessageIdsByRun);
                const nextRunStatuses = new Map(runGenerationStatus);
                const nextRunStartedAtByRun = new Map(runStartedAtByRun);
                const nextTurnStartedAtByRun = new Map(turnStartedAtByRun);
                const nextTurnUserIdByRun = new Map(turnUserIdByRun);
                const nextTurnFinishedAtByRun = new Map(turnFinishedAtByRun);
                const nextSteeringMessageIds = new Set(steeringMessageIds);
                const nextTools = new Map(toolCallCreatedAt);
                const durationReconcile = (eventRunId: string): void => {
                    const turnId = nextTurnUserIdByRun.get(eventRunId);
                    const startedAt = nextRunStartedAtByRun.get(eventRunId);
                    const finishedAt = nextTurnFinishedAtByRun.get(eventRunId);
                    if (turnId === undefined || startedAt === undefined || finishedAt === undefined)
                        return;
                    turnDurations = new Map(turnDurations).set(
                        turnId,
                        Math.max(0, finishedAt - startedAt),
                    );
                };
                for (const event of timestampEvents) {
                    if (event.type === "message_submitted") {
                        next.set(event.message.id, event.createdAt);
                        if (event.delivery === "steer") {
                            const priorTurnId = nextTurnUserIdByRun.get(event.runId);
                            const priorStartedAt = nextTurnStartedAtByRun.get(event.runId);
                            if (priorTurnId !== undefined && priorStartedAt !== undefined)
                                turnDurations = new Map(turnDurations).set(
                                    priorTurnId,
                                    Math.max(0, event.createdAt - priorStartedAt),
                                );
                            nextSteeringMessageIds.add(event.message.id);
                            nextTurnUserIdByRun.set(event.runId, event.message.id);
                            nextTurnStartedAtByRun.set(event.runId, event.createdAt);
                            durationReconcile(event.runId);
                        } else if (!nextTurnUserIdByRun.has(event.runId)) {
                            nextTurnUserIdByRun.set(event.runId, event.message.id);
                            nextRunStartedAtByRun.set(event.runId, event.createdAt);
                            nextTurnStartedAtByRun.set(event.runId, event.createdAt);
                            durationReconcile(event.runId);
                        }
                        continue;
                    }
                    if (event.type === "agent_message") {
                        next.set(event.message.id, event.createdAt);
                        const messageIds = new Set(nextMessageIdsByRun.get(event.runId) ?? []);
                        messageIds.add(event.message.id);
                        nextMessageIdsByRun.set(event.runId, messageIds);
                        nextStatuses.set(
                            event.message.id,
                            nextRunStatuses.get(event.runId) ?? "streaming",
                        );
                        continue;
                    }
                    if (
                        event.type === "agent_event" &&
                        event.event.type === "inference_iteration_start"
                    ) {
                        const messageIds = new Set(nextMessageIdsByRun.get(event.runId) ?? []);
                        messageIds.add(event.event.messageId);
                        nextMessageIdsByRun.set(event.runId, messageIds);
                        nextStatuses.set(
                            event.event.messageId,
                            nextRunStatuses.get(event.runId) ?? "streaming",
                        );
                        continue;
                    }
                    if (event.type === "run_error" || event.type === "run_finished") {
                        const outcome =
                            event.type === "run_error" ||
                            event.stopReason === "error" ||
                            event.stopReason === "aborted"
                                ? "failed"
                                : "complete";
                        nextRunStatuses.set(event.runId, outcome);
                        nextTurnFinishedAtByRun.set(event.runId, event.createdAt);
                        durationReconcile(event.runId);
                        for (const messageId of nextMessageIdsByRun.get(event.runId) ?? [])
                            nextStatuses.set(messageId, outcome);
                        continue;
                    }
                    if (event.type !== "agent_event" || event.event.type !== "toolcall_start")
                        continue;
                    const prior = nextTools.get(event.event.toolCallId) ?? [];
                    nextTools.set(event.event.toolCallId, [...prior, event.createdAt]);
                }
                messageCreatedAt = next;
                messageGenerationStatus = nextStatuses;
                agentMessageIdsByRun = nextMessageIdsByRun;
                runGenerationStatus = nextRunStatuses;
                runStartedAtByRun = nextRunStartedAtByRun;
                turnStartedAtByRun = nextTurnStartedAtByRun;
                turnUserIdByRun = nextTurnUserIdByRun;
                turnFinishedAtByRun = nextTurnFinishedAtByRun;
                steeringMessageIds = nextSteeringMessageIds;
                // A reconnect may observe the durable run before any new stream
                // hint. Recover the original request clock from event history;
                // steering advances only the segment clock, never this one.
                if (loaded.status === "running") {
                    let activeRun: { readonly id: string; readonly startedAt: number } | undefined;
                    for (const [candidateRunId, startedAt] of nextRunStartedAtByRun) {
                        if (nextTurnFinishedAtByRun.has(candidateRunId)) continue;
                        if (activeRun === undefined || startedAt > activeRun.startedAt)
                            activeRun = { id: candidateRunId, startedAt };
                    }
                    if (activeRun !== undefined) {
                        if (runId === undefined) runId = activeRun.id;
                        if (runStartedAt === undefined || activeRun.startedAt < runStartedAt)
                            runStartedAt = activeRun.startedAt;
                    }
                }
                toolCallCreatedAt = nextTools;
                messageTimestampCursor = timestampEvents[timestampEvents.length - 1]?.eventId;
            }
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
            // Delivery hint: the session and its cursor come only from sessionRead;
            // message times and run outcomes reconcile from HTTP event history.
            void reconcile();
        },
        error: () => {
            if (!disposed && active) void recover();
        },
        end: () => undefined,
    };

    const openStream = (): void => {
        if (unsubscribeSession) return;
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
        transcriptConnection = deps.transcriptConnect?.({
            sessionId,
            onChange: (elements, connectedSession) => {
                if (!active || disposed) return;
                // The accepted hello is now the session/transcript authority.
                // Retain the one bootstrap read for compatibility-only metadata,
                // but stop Happy's parallel event reconstruction immediately.
                unsubscribeSession?.();
                unsubscribeSession = undefined;
                transcriptElements = elements;
                transcriptSession = connectedSession;
                runStatus = transcriptSessionBusy(connectedSession) ? "running" : "idle";
                runStartedAt = connectedSession.activeTurn?.startedAt;
                runId = connectedSession.activeTurn?.runId;
                if (connectedSession.activeTurn) {
                    turnElapsedMs = undefined;
                } else {
                    for (let index = elements.length - 1; index >= 0; index -= 1) {
                        const element = elements[index];
                        if (element?.kind !== "group_end") continue;
                        turnElapsedMs = element.turnElapsedMs;
                        break;
                    }
                }
                commit();
            },
            onError: () => {
                if (!active || disposed) return;
                transcriptConnection?.close();
                transcriptConnection = undefined;
                transcriptElements = undefined;
                transcriptSession = undefined;
                runStatus =
                    session?.status === "running" || session?.status === "queued"
                        ? "running"
                        : "idle";
                commit();
                openStream();
                void reconcile();
            },
        });
        if (deps.transcriptConnect === undefined) {
            openStream();
            void reconcile();
        }
        if (deps.transcriptConnect === undefined && usagePanelOpen && usageTimer === undefined) {
            usageLoad();
            usageTimer = startInterval(usageLoad, usagePollMs);
        } else if (deps.transcriptConnect === undefined && !disposed) {
            // Opening a session shows its context gauge immediately, without
            // waiting for a turn to finish to learn where the window stands.
            usageLoad(true);
        }
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        reconcileAgain = false;
        unsubscribeSession?.();
        unsubscribeSession = undefined;
        transcriptConnection?.close();
        transcriptConnection = undefined;
        transcriptElements = undefined;
        transcriptSession = undefined;
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

    /**
     * The images of messages this window has sent, by the identity the message
     * carries.
     *
     * A sent message is shown from the prediction the protocol client made when
     * it was submitted, and that prediction is text: the transcript element it
     * appends has no images on it, and the daemon's own copy of the message is
     * then folded into the element already there rather than replacing it. So
     * nothing else in the transcript knows what was attached until it is rebuilt
     * from scratch. What was sent is known here, at the moment of sending, which
     * is why the pictures are kept here and handed to the projection.
     *
     * The budget bounds a long session of sending screenshots; the oldest are
     * dropped first, and a transcript rebuilt from the daemon carries its own.
     */
    const sentImages = new Map<string, readonly RigImageInput[]>();
    let sentImageBytes = 0;

    const sentImagesRemember = (messageId: string, images: readonly RigImageInput[]): void => {
        const bytes = images.reduce((total, image) => total + image.data.length, 0);
        sentImages.set(messageId, images);
        sentImageBytes += bytes;
        for (const [oldest, held] of sentImages) {
            if (sentImageBytes <= SENT_IMAGE_BUDGET_BYTES) break;
            if (oldest === messageId) break;
            sentImages.delete(oldest);
            sentImageBytes -= held.reduce((total, image) => total + image.data.length, 0);
        }
    };

    const connectMutationTrack = (mutationId: string): void => {
        const rejectionWasVisible = mutationRejection !== undefined;
        mutationRejection = undefined;
        pendingMutationIds.add(mutationId);
        pendingMutationOrder.push(mutationId);
        while (pendingMutationOrder.length > PENDING_MUTATION_LIMIT) {
            const expired = pendingMutationOrder.shift();
            if (expired) pendingMutationIds.delete(expired);
        }
        if (rejectionWasVisible) commit();
    };

    const unsubscribeMutationRejections = deps.connectMutationSubscribe?.((rejection) => {
        if (!pendingMutationIds.delete(rejection.mutationId)) return;
        mutationRejection = rejection;
        commit();
    });

    const sessionReplace = (loaded: RigSession): void => {
        sessionAuthoritativeWrite(loaded);
    };

    /**
     * Records a picker choice. It reduces from whatever the pickers currently
     * show — the pending choice if there is one, otherwise the session's own
     * configuration — so successive picks compose. A choice that lands back on
     * what the session already is clears the intent rather than storing a
     * no-op, which keeps the next send from issuing pointless requests.
     */
    const selectionIntentSet = (reduce: (current: RigSelection) => RigSelection): void => {
        const loaded = session;
        if (!loaded) return;
        const base = selectionIntent ?? selectionOf(loaded);
        const next = reduce(base);
        selectionIntent = rigSelectionEqual(next, selectionOf(loaded)) ? undefined : next;
        deps.selectionUsed?.(next);
        commit();
    };

    /**
     * Applies the pending choice to the session, in an order the daemon accepts:
     * the model carries its effort, so changing both is one request rather than
     * two, and a separate effort request follows only when the model is
     * unchanged.
     *
     * It fails closed. If any part cannot be applied the intent is kept and the
     * error is raised, so the caller does not send a message under a
     * configuration that was asked for but never took effect. The intent is
     * cleared only once the session the daemon returns actually reports it.
     */
    const selectionIntentApply = async (): Promise<void> => {
        const intent = selectionIntent;
        const loaded = session;
        if (!intent || !loaded) return;
        const current = selectionOf(loaded);
        if (rigSelectionEqual(intent, current)) {
            selectionIntent = undefined;
            return;
        }
        const modelChanged =
            intent.providerId !== current.providerId || intent.modelId !== current.modelId;
        if (modelChanged) {
            sessionReplace(
                await deps.transport.changeModel(sessionId, {
                    providerId: intent.providerId,
                    modelId: intent.modelId,
                    ...(intent.effort !== undefined ? { effort: intent.effort } : {}),
                }),
            );
        } else if (intent.effort !== current.effort) {
            sessionReplace(await deps.transport.changeEffort(sessionId, intent.effort));
        }
        if (intent.serviceTier !== current.serviceTier)
            sessionReplace(await deps.transport.changeServiceTier(sessionId, intent.serviceTier));
        if (intent.permissionMode !== current.permissionMode)
            sessionReplace(
                await deps.transport.changePermissionMode(sessionId, intent.permissionMode),
            );
        // Confirmed by the session the daemon returned, never by having asked.
        if (session && rigSelectionEqual(selectionOf(session), intent)) selectionIntent = undefined;
        commit();
    };

    // One usage fetch. The generation captured at call time guards against a stale
    // response (panel closed or reopened, or the store stopped) overwriting state.
    /**
     * Reads usage. A `background` read feeds the always-visible context gauge
     * rather than the panel, so it neither claims the panel's loading state nor
     * leaves an error behind: nobody asked for this number, and reporting a
     * failure to fetch it would be a banner about a request the reader never
     * made. It just leaves the gauge showing what it last knew.
     */
    const usageLoad = (background = false): void => {
        const current = usageGeneration;
        if (!background) {
            usageLoading = true;
            commit();
        }
        void deps.transport.usageGet(sessionId).then(
            (loaded) => {
                if (current !== usageGeneration) return;
                usage = loaded;
                if (!background) {
                    usageError = undefined;
                    usageLoading = false;
                }
                commit();
            },
            (caught) => {
                if (current !== usageGeneration) return;
                if (background) return;
                usageError = rigUserError(caught).message;
                usageLoading = false;
                commit();
            },
        );
    };

    /** Sends one answer to the daemon; shared by Submit and by answering with a message. */
    const answerInputRun = (input: RigUserInputAnswers): Promise<void> => {
        if (deps.connectActions) {
            connectMutationTrack(
                deps.connectActions.answerUserInput(sessionId, input.requestId, {
                    answers: input.answers,
                }),
            );
            output({ type: "inputAnswered", sessionId, requestId: input.requestId });
            return Promise.resolve();
        }
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
    };

    /**
     * Answers the question the session is stopped on with what was just typed
     * and whatever was already ticked into it, and says whether the words were
     * used up doing so.
     *
     * Only the first pending request is answered: a session waits inside the one
     * call that asked, so that request is what "the question" means to the
     * reader looking at the composer.
     *
     * A ticked question is answered by its ticks — they are a deliberate choice,
     * and a single-select question cannot carry the text beside one anyway. Only
     * the questions left blank take the text. When every question was already
     * ticked the text answers nothing, so the caller sends it as an ordinary
     * message instead of discarding it.
     */
    const pendingQuestionAnswer = async (text: string): Promise<{ textUsed: boolean }> => {
        const request = store.getState().pendingUserInputs[0];
        const message = text.trim();
        if (!request || message.length === 0) return { textUsed: false };
        const ticked = requestSelections.get(request.requestId) ?? {};
        const answers: Record<string, readonly string[]> = {};
        let textUsed = false;
        for (const question of request.questions) {
            const chosen = ticked[question.id] ?? [];
            if (chosen.length > 0) {
                answers[question.id] = [...chosen];
                continue;
            }
            answers[question.id] = [message];
            textUsed = true;
        }
        await answerInputRun({ requestId: request.requestId, answers });
        requestSelections.delete(request.requestId);
        return { textUsed };
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
        historyLoadMore() {
            const connected = transcriptSession;
            const token = connected?.loadMoreToken;
            if (!token || connected.loadingMore) return;
            transcriptConnection?.loadMore(token);
        },
        messageSend: (text, images) =>
            rejecting(async () => {
                // A session stopped on a question hears an answer, not a
                // message. When the ticks already answered every question the
                // words still have somewhere to go, and fall through to the
                // ordinary send below.
                if ((await pendingQuestionAnswer(text)).textUsed) return;
                if (deps.connectActions) {
                    const mutationId = deps.connectActions.sendMessage(
                        sessionId,
                        images && images.length > 0
                            ? {
                                  text,
                                  content: [
                                      { type: "text", text },
                                      ...images.map((image) => ({
                                          type: "image" as const,
                                          mediaType: image.mediaType,
                                          data: image.data,
                                      })),
                                  ],
                              }
                            : text,
                    );
                    if (images && images.length > 0) sentImagesRemember(mutationId, images);
                    connectMutationTrack(mutationId);
                    output({
                        type: "messageSent",
                        sessionId,
                        steered: runStatus === "running",
                    });
                    return;
                }
                const key = createId();
                const steered = runStatus === "running";
                // The pending choice is applied before the turn it was chosen
                // for, and only for a fresh turn: a steer joins the run already
                // in progress, which the daemon will not re-model mid-flight.
                // This throws if it fails, so the message is not sent under a
                // configuration the reader did not ask for.
                if (!steered) await selectionIntentApply();
                // A fresh turn starts the working clock at request send — when the
                // connection is made, before the first token — not when the first
                // stream event arrives.
                if (!steered) {
                    pendingFreshTurn = {
                        precedingUserId: session
                            ? latestUserMessageId(session.messages)
                            : undefined,
                    };
                    runStartedAt = now();
                    turnElapsedMs = undefined;
                    runStatus = "running";
                    commit();
                }
                try {
                    if (steered) {
                        await deps.transport.messageSteer(sessionId, text, key, runId, images);
                    } else {
                        await deps.transport.messageSubmit(sessionId, text, key, images);
                    }
                } catch (caught) {
                    if (!steered) {
                        pendingFreshTurn = undefined;
                        runStartedAt = undefined;
                        runStatus =
                            transcriptSession !== undefined
                                ? transcriptSessionBusy(transcriptSession)
                                    ? "running"
                                    : "idle"
                                : session?.status === "running"
                                  ? "running"
                                  : "idle";
                        commit();
                    }
                    throw caught;
                }
                output({ type: "messageSent", sessionId, steered });
            }),
        draftSet: (draft, updatedAt, origin) =>
            rejecting(async () => {
                if (deps.connectActions) {
                    connectMutationTrack(
                        deps.connectActions.setDraft(sessionId, { draft, updatedAt, origin }),
                    );
                    return;
                }
                await deps.transport.draftSet(sessionId, draft, updatedAt, origin);
            }),
        runAbort: () =>
            rejecting(async () => {
                if (deps.connectActions) {
                    connectMutationTrack(deps.connectActions.stopRun(sessionId));
                    output({ type: "runAborted", sessionId });
                    return;
                }
                await deps.transport.runAbort(sessionId, runId);
                output({ type: "runAborted", sessionId });
            }),
        answerInput: (input) => answerInputRun(input),
        requestSelectionUpdate(requestId, answers) {
            requestSelections.set(requestId, answers);
            commit();
        },
        modelUpdate(input) {
            if (deps.connectActions && transcriptSession) {
                const current: RigSelection = {
                    providerId: transcriptSession.providerId,
                    modelId: transcriptSession.modelId,
                    effort: transcriptSession.effort as RigThinkingLevel | undefined,
                    permissionMode: transcriptSession.permissionMode as RigPermissionMode,
                    serviceTier: transcriptSession.serviceTier as RigServiceTier | undefined,
                };
                const next =
                    deps.modelSelect?.(current, input) ??
                    rigSelectionModelUpdate(deps.catalog, current, input);
                deps.selectionUsed?.(next);
                connectMutationTrack(
                    deps.connectActions.switchModel(sessionId, {
                        providerId: next.providerId,
                        modelId: next.modelId,
                    }),
                );
                if (next.effort !== current.effort)
                    connectMutationTrack(deps.connectActions.setEffort(sessionId, next.effort));
                if (next.serviceTier !== current.serviceTier)
                    connectMutationTrack(
                        deps.connectActions.setServiceTier(sessionId, next.serviceTier),
                    );
                return;
            }
            selectionIntentSet(
                (current) =>
                    deps.modelSelect?.(current, input) ??
                    rigSelectionModelUpdate(deps.catalog, current, input),
            );
        },
        effortUpdate(effort) {
            if (deps.connectActions) {
                if (transcriptSession)
                    deps.selectionUsed?.(
                        rigSelectionEffortUpdate(transcriptSelectionOf(transcriptSession), effort),
                    );
                connectMutationTrack(deps.connectActions.setEffort(sessionId, effort));
                return;
            }
            selectionIntentSet((current) => rigSelectionEffortUpdate(current, effort));
        },
        permissionModeUpdate(permissionMode) {
            if (deps.connectActions) {
                connectMutationTrack(
                    deps.connectActions.setPermissionMode(sessionId, permissionMode),
                );
                return;
            }
            selectionIntentSet((current) =>
                rigSelectionPermissionModeUpdate(current, permissionMode),
            );
        },
        serviceTierUpdate(serviceTier) {
            if (deps.connectActions) {
                if (transcriptSession)
                    deps.selectionUsed?.(
                        rigSelectionServiceTierUpdate(
                            transcriptSelectionOf(transcriptSession),
                            serviceTier,
                        ),
                    );
                connectMutationTrack(deps.connectActions.setServiceTier(sessionId, serviceTier));
                return;
            }
            selectionIntentSet((current) => rigSelectionServiceTierUpdate(current, serviceTier));
        },
        compact: () =>
            rejecting(async () => {
                if (deps.connectActions) {
                    connectMutationTrack(deps.connectActions.compactSession(sessionId));
                    return;
                }
                await deps.transport.compact(sessionId);
                sessionReplace(await deps.transport.sessionRead(sessionId));
            }),
        rewind: (messageId) =>
            rejecting(async () => {
                if (deps.connectActions) {
                    connectMutationTrack(deps.connectActions.rewindSession(sessionId, messageId));
                    return;
                }
                sessionReplace(await deps.transport.rewind(sessionId, messageId));
            }),
        sessionReset: () =>
            rejecting(async () => {
                if (deps.connectActions) {
                    connectMutationTrack(deps.connectActions.resetSession(sessionId));
                    return;
                }
                if (transientStreamingPresentation) runRetire(transientStreamingPresentation.runId);
                transientStreamingPresentation = undefined;
                ephemeral = [];
                sessionReplace(await deps.transport.sessionReset(sessionId));
            }),
        shellRun: (command) =>
            rejecting(async () => {
                // The action result is authoritative for this one-off local
                // presentation; shell SSE payloads remain delivery hints only.
                const commandId = createId();
                if (deps.connectActions) {
                    connectMutationTrack(
                        deps.connectActions.runShellCommand(sessionId, { command, commandId }),
                    );
                    return;
                }
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
                if (deps.connectActions) {
                    connectMutationTrack(
                        deps.connectActions.stopBackgroundProcess(sessionId, processId),
                    );
                    return;
                }
                await deps.transport.backgroundProcessStop(sessionId, processId);
            }),
        usageGet: () =>
            transcriptSession?.usage
                ? Promise.resolve(transcriptUsageProject(transcriptSession.usage))
                : deps.transport.usageGet(sessionId),
        usagePanelOpen() {
            if (usagePanelOpen) return;
            usagePanelOpen = true;
            activityPanelOpen = false;
            usageError = undefined;
            if (transcriptConnection === undefined) {
                usageLoad();
                usageTimer = startInterval(usageLoad, usagePollMs);
            }
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
            unsubscribeMutationRejections?.();
            transcriptConnection?.close();
            transcriptConnection = undefined;
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

function transcriptSelectionOf(session: SessionState): RigSelection {
    return {
        providerId: session.providerId,
        modelId: session.modelId,
        effort: session.effort as RigThinkingLevel | undefined,
        permissionMode: session.permissionMode as RigPermissionMode,
        serviceTier: session.serviceTier as RigServiceTier | undefined,
    };
}

function defaultCreateId(): string {
    return `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
