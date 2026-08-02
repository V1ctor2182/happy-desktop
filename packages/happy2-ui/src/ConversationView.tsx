import { type CSSProperties, type ReactNode } from "react";
import type {
    ComposerSnapshot,
    ConversationAuthor,
    ConversationEntry,
    ConversationRequestSubmission,
    ConversationToolCall,
} from "happy2-state";
import {
    AGENT_WORKING_STATUS_ROW_HEIGHT,
    AgentWorkingStatus,
    type AgentWaitStatus,
    type AgentWorkingPhase,
} from "./AgentWorkingStatus";
import { ChannelHeader } from "./ChannelHeader";
import { ConversationDock } from "./ConversationDock";
import { ConversationEntryView } from "./ConversationEntryView";
import {
    conversationAgentRowStartsGroup,
    conversationEntryResumesAfterActivity,
    conversationMessageGrouped,
    conversationTurnStatusAfterActivity,
} from "./conversationMessageGrouped";
import { conversationRowHeight } from "./conversationRowHeight";
import { EmptyState } from "./EmptyState";
import { MessageList, type MessageListScrollPosition } from "./Message";
import type { RigUserInputAnswerMap } from "./RigUserInputPrompt";
import { Spinner } from "./Spinner";

export type ConversationViewProps = {
    /**
     * Titles this conversation's own 56px header. Omit it when the surface that
     * hosts this view already names what is open — the local workspace heads a
     * whole directory and switches sessions with tabs beneath that heading — and
     * no header renders at all.
     */
    title?: string;
    /** Secondary header line: the working directory, topic, or participants. */
    subtitle?: string;
    /** True while the agent is working; drives the live activity line. */
    running?: boolean;
    /** True while the addressed conversation is hydrating its transcript. */
    loading?: boolean;
    /** Elapsed run time in ms, supplied by the owner (no timers live in the UI). */
    elapsedMs?: number;
    /** Current reader-facing phase of the active turn. */
    workingPhase?: AgentWorkingPhase;
    /** Humanized activity text from the agent, preferred over the phase word. */
    workingLabel?: string;
    /** The scheduled wait the turn is inside, counted down by the owner's clock. */
    workingWait?: AgentWaitStatus;
    /** Subagents currently running under the active turn. */
    runningAgents?: number;
    /** Background tasks currently owned by the active turn. */
    backgroundTasks?: number;
    entries: readonly ConversationEntry[];
    /** Agent identity shown when a tool/activity row opens a turn before prose exists. */
    agentAuthor?: ConversationAuthor;
    /** Identity id of the reader, so their own messages take the own treatment. */
    viewerId?: string;
    /**
     * Which conversation these entries belong to. It is the transcript's
     * lifetime boundary: switching conversations mounts a new list, so one
     * conversation's reading position is never applied to another's.
     */
    conversationId?: string;
    /**
     * Where this conversation was last being read, restored on mount. Absent
     * means the newest content, which is where a conversation opens.
     */
    scrollPosition?: MessageListScrollPosition;
    /** Reports the reading position, including the final one before unmount. */
    onScrollPositionChange?: (position: MessageListScrollPosition) => void;
    /** Header controls composed by the surface owner. */
    headerActions?: ReactNode;
    /**
     * Controls rendered inside the composer toolbar, beneath the text input:
     * the model/effort picker and the settings affordance. They belong to the
     * message being written, so they sit with the input rather than the header.
     */
    composerControls?: ReactNode;
    /** Agent-authored contribution bar immediately above the composer. */
    composerAboveControl?: ReactNode;
    /** Controlled accessory below the composer card, aligned with cloud audience routing. */
    composerFooterControl?: ReactNode;
    /**
     * A modal-class surface (settings dialog, picker) hosted above this one.
     * The owner decides whether it is open; this surface only gives it a place
     * in the tree so it stacks over the whole conversation.
     */
    overlay?: ReactNode;
    /** Replaces the conversation body while an owner-selected panel is open. */
    panel?: ReactNode;
    /** Shows or hides the intermediate entries of a finished turn. */
    onTraceToggle?: (turnId: string) => void;
    /** Finished turns currently listing their intermediate entries. */
    expandedTurnIds?: ReadonlySet<string>;
    /** @deprecated Pending steering now renders as an ordered transcript message. */
    queued?: readonly { readonly id: string; readonly text: string }[];
    /** The composer surface snapshot; the draft never lives in this component. */
    composer: ComposerSnapshot;
    /** Keeps the conversation readable while disabling every composer action. */
    composerDisabled?: boolean;
    composerPlaceholder?: string;
    /** Makes this composer the last resort for typing; see `Composer.focusOnType`. */
    composerFocusOnType?: boolean;
    onComposerValueChange: (value: string) => void;
    onComposerFocusChange?: (focused: boolean) => void;
    onComposerSend: () => void;
    /** Receives images picked through the composer's picker or pasted into it. */
    onComposerAttachmentsSelect?: (files: File[]) => void;
    /** Removes one attachment chip from the draft. */
    onComposerAttachmentRemove?: (attachmentId: string) => void;
    /** Opens one transcript image full size; the owner hosts the viewer in `overlay`. */
    onImageOpen?: (messageId: string, attachmentId: string) => void;
    /** Opens one tool entry in the workspace's replaceable Preview tab. */
    onToolSelect?: (entryId: string, tool: ConversationToolCall) => void;
    /**
     * Opens a workspace file the transcript names — the file a tool call worked
     * on, or one a message links to — in the product's own file viewer. Absent
     * leaves those affordances out entirely, because a transcript with no
     * workspace behind it has nothing to open.
     */
    onFileOpen?: (path: string) => void;
    /** Runs a command chosen from the `/` palette. */
    onCommandInvoke?: (commandId: string) => void;
    /** Stops the current run; the composer's send control becomes this while running. */
    onAbort?: () => void;
    onRequestAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Request-id-scoped local answer submission lifecycles. */
    requestSubmissions?: readonly ConversationRequestSubmission[];
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/** Whether the turn this row carries the trace control for is currently open. */
function conversationEntryTraceOpen(
    entry: ConversationEntry,
    expandedTurnIds: ReadonlySet<string> | undefined,
): boolean {
    const trace =
        entry.kind === "message"
            ? entry.message.agentTrace
            : entry.kind === "agentActivity"
              ? entry.agentTrace
              : undefined;
    return trace !== undefined && expandedTurnIds?.has(trace.turnId) === true;
}

function elapsedFormat(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toString().padStart(2, "0")}s`;
}

/**
 * The agent's live run state for the header that names what is open. It sits
 * here rather than inside `ConversationView` because a surface whose heading
 * spans a whole directory still shows the open session's activity.
 */
export function ConversationStatus(props: { elapsedMs?: number; running?: boolean }) {
    return (
        <span
            className="happy2-conversation__status"
            data-happy2-ui="conversation-status"
            data-running={props.running ? "" : undefined}
        >
            <span aria-hidden="true" className="happy2-conversation__status-dot" />
            {props.running ? "Running" : "Idle"}
            {props.running && props.elapsedMs !== undefined ? (
                <span
                    className="happy2-conversation__status-elapsed"
                    data-happy2-ui="conversation-elapsed"
                >
                    {elapsedFormat(props.elapsedMs)}
                </span>
            ) : null}
        </span>
    );
}

/**
 * ConversationView — the assembled conversation surface: a `ChannelHeader` with
 * the title, subtitle, and owner-supplied controls; the virtualized shared
 * `MessageList` of `ConversationEntry` rows; an optional owner panel that takes
 * the body; and the shared `Composer` with its `/` command palette and `@`
 * mention candidates. A running turn keeps one minimal `AgentWorkingStatus` in the
 * message list footer — elapsed clock and current phase — which scrolls with
 * the transcript rather than floating over it.
 *
 * Every value comes from props and every draft keystroke goes back out through
 * `onComposerValueChange`, so the composer store — not this component — owns the
 * draft, the active command query, and the mention query.
 */
export function ConversationView(props: ConversationViewProps) {
    const composer = props.composer;
    return (
        <section
            className={["happy2-conversation", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="conversation-view"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {props.title === undefined ? null : (
                <ChannelHeader
                    actions={
                        <>
                            <ConversationStatus
                                elapsedMs={props.elapsedMs}
                                running={props.running}
                            />
                            {props.headerActions}
                        </>
                    }
                    icon="spark"
                    title={props.title}
                    topic={props.subtitle}
                />
            )}

            {props.panel ? (
                <div className="happy2-conversation__panel" data-happy2-ui="conversation-panel">
                    {props.panel}
                </div>
            ) : props.loading ? (
                <div
                    className="happy2-conversation__empty happy2-conversation__loading"
                    data-happy2-ui="conversation-loading"
                >
                    <Spinner label="Loading conversation" size={20} tone="muted" variant="line" />
                </div>
            ) : props.entries.length === 0 ? (
                <div className="happy2-conversation__empty" data-happy2-ui="conversation-empty">
                    <EmptyState
                        description="Send a message to start working in this conversation."
                        icon="chat"
                        size="panel"
                        title="Nothing here yet"
                    />
                </div>
            ) : (
                <MessageList
                    estimateRowSize={(index, width) =>
                        conversationRowHeight(props.entries, index, {
                            surface: "conversation",
                            viewerId: props.viewerId,
                            width,
                        })
                    }
                    footer={
                        <AgentWorkingStatus
                            active={props.running === true}
                            agents={props.runningAgents}
                            backgroundTasks={props.backgroundTasks}
                            className="happy2-conversation-turn-status"
                            elapsedMs={props.elapsedMs}
                            label={props.workingLabel}
                            phase={props.workingPhase}
                            wait={props.workingWait}
                        />
                    }
                    footerHeight={AGENT_WORKING_STATUS_ROW_HEIGHT}
                    initialScrollPosition={props.scrollPosition}
                    // The conversation is this list's lifetime: switching to
                    // another one mounts its own list, which is what lets each
                    // restore its own position instead of inheriting one.
                    key={props.conversationId}
                    onScrollPositionChange={props.onScrollPositionChange}
                    virtualize
                >
                    {props.entries.map((entry, index) => {
                        const submission =
                            entry.kind === "request"
                                ? props.requestSubmissions?.find(
                                      (candidate) =>
                                          candidate.requestId === entry.request.requestId,
                                  )
                                : undefined;
                        return (
                            <ConversationEntryView
                                activityAuthor={
                                    props.agentAuthor &&
                                    conversationAgentRowStartsGroup(props.entries, index)
                                        ? props.agentAuthor
                                        : undefined
                                }
                                className={
                                    entry.kind === "turnStatus" &&
                                    conversationTurnStatusAfterActivity(props.entries, index)
                                        ? "happy2-turn-status--after-trace"
                                        : conversationEntryResumesAfterActivity(
                                                props.entries,
                                                index,
                                            )
                                          ? "happy2-conversation__resumed"
                                          : undefined
                                }
                                entry={entry}
                                grouped={
                                    entry.kind === "message"
                                        ? conversationMessageGrouped(props.entries, index)
                                        : undefined
                                }
                                key={
                                    entry.kind === "message"
                                        ? entry.message.id
                                        : entry.kind === "turnStatus"
                                          ? entry.id
                                          : entry.id
                                }
                                onImageOpen={props.onImageOpen}
                                onRequestAnswer={props.onRequestAnswer}
                                onToolSelect={props.onToolSelect}
                                {...(props.onFileOpen ? { onFileOpen: props.onFileOpen } : {})}
                                onTraceToggle={props.onTraceToggle}
                                /* Either kind of row can be the one a turn hung
                                   its control on: the answer when the turn is
                                   folded up, the row its work starts on when it
                                   is open. */
                                traceOpen={conversationEntryTraceOpen(entry, props.expandedTurnIds)}
                                requestError={
                                    submission?.status === "failed" ? submission.error : undefined
                                }
                                requestPending={submission?.status === "pending"}
                                viewerId={props.viewerId}
                            />
                        );
                    })}
                </MessageList>
            )}

            <ConversationDock
                composer={composer}
                composerAboveControl={props.composerAboveControl}
                composerControls={props.composerControls}
                disabled={props.composerDisabled}
                composerFooterControl={props.composerFooterControl}
                composerFocusOnType={props.composerFocusOnType}
                composerPlaceholder={props.composerPlaceholder}
                onAbort={props.onAbort}
                onCommandInvoke={props.onCommandInvoke}
                onComposerAttachmentRemove={props.onComposerAttachmentRemove}
                onComposerAttachmentsSelect={props.onComposerAttachmentsSelect}
                onComposerFocusChange={props.onComposerFocusChange}
                onComposerSend={props.onComposerSend}
                onComposerValueChange={props.onComposerValueChange}
                running={props.running}
            />

            {props.overlay}
        </section>
    );
}
