import { type CSSProperties, type ReactNode } from "react";
import type {
    ComposerSnapshot,
    ConversationEntry,
    ConversationRequestSubmission,
} from "happy2-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { ChannelHeader } from "./ChannelHeader";
import { Composer, type Mentionable } from "./Composer";
import { ConversationEntryView } from "./ConversationEntryView";
import {
    conversationEntryResumesAfterActivity,
    conversationMessageGrouped,
} from "./conversationMessageGrouped";
import { conversationRowHeight } from "./conversationRowHeight";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./Message";
import { RigCommandPalette } from "./RigCommandPalette";
import type { RigUserInputAnswerMap } from "./RigUserInputPrompt";

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
    /** Elapsed run time in ms, supplied by the owner (no timers live in the UI). */
    elapsedMs?: number;
    entries: readonly ConversationEntry[];
    /** Identity id of the reader, so their own messages take the own treatment. */
    viewerId?: string;
    /** Header controls composed by the surface owner. */
    headerActions?: ReactNode;
    /**
     * Controls rendered inside the composer toolbar, beneath the text input:
     * the model/effort picker and the settings affordance. They belong to the
     * message being written, so they sit with the input rather than the header.
     */
    composerControls?: ReactNode;
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
    /** Steering messages queued to submit after the current tool call (preview only). */
    queued?: readonly { readonly id: string; readonly text: string }[];
    /** The composer surface snapshot; the draft never lives in this component. */
    composer: ComposerSnapshot;
    composerPlaceholder?: string;
    onComposerValueChange: (value: string) => void;
    onComposerFocusChange?: (focused: boolean) => void;
    onComposerSend: () => void;
    /** Runs a command chosen from the `/` palette. */
    onCommandInvoke?: (commandId: string) => void;
    /** Stops the current run; the control appears only while running. */
    onAbort?: () => void;
    onRewind?: (messageId: string) => void;
    onRequestAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Request-id-scoped local answer submission lifecycles. */
    requestSubmissions?: readonly ConversationRequestSubmission[];
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

function elapsedFormat(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toString().padStart(2, "0")}s`;
}

function mentionsOf(composer: ComposerSnapshot): Mentionable[] {
    return composer.mentionCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.label,
        initials: candidate.label.slice(0, 1).toUpperCase(),
        kind: "document",
        ...(candidate.detail ? { description: candidate.detail } : {}),
    }));
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
 * mention candidates.
 *
 * Every value comes from props and every draft keystroke goes back out through
 * `onComposerValueChange`, so the composer store — not this component — owns the
 * draft, the active command query, and the mention query.
 */
export function ConversationView(props: ConversationViewProps) {
    const composer = props.composer;
    const paletteOpen = composer.commandQuery !== undefined && props.onCommandInvoke !== undefined;
    const sendEnabled =
        !paletteOpen && (composer.text.trim().length > 0 || composer.attachments.length > 0);
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
                                className={
                                    conversationEntryResumesAfterActivity(props.entries, index)
                                        ? "happy2-conversation__resumed"
                                        : undefined
                                }
                                entry={entry}
                                grouped={
                                    entry.kind === "message"
                                        ? conversationMessageGrouped(props.entries, index)
                                        : undefined
                                }
                                key={entry.kind === "message" ? entry.message.id : entry.id}
                                onRequestAnswer={props.onRequestAnswer}
                                onRewind={props.onRewind}
                                onTraceToggle={props.onTraceToggle}
                                traceOpen={
                                    entry.kind === "message" &&
                                    entry.message.agentTrace !== undefined &&
                                    props.expandedTurnIds?.has(entry.message.agentTrace.turnId) ===
                                        true
                                }
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

            {props.queued && props.queued.length > 0 ? (
                <div
                    className="happy2-conversation__queued"
                    data-happy2-ui="conversation-queued"
                    role="status"
                >
                    <span
                        className="happy2-conversation__queued-title"
                        data-happy2-ui="conversation-queued-title"
                    >
                        Messages to be submitted after the next tool call
                    </span>
                    {props.queued.map((message) => (
                        <span
                            className="happy2-conversation__queued-item"
                            data-happy2-ui="conversation-queued-item"
                            key={message.id}
                        >
                            {message.text}
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="happy2-conversation__dock" data-happy2-ui="conversation-dock">
                {composer.submission.status === "failed" ? (
                    <Banner
                        action={{ label: "Retry", onClick: props.onComposerSend }}
                        data-testid="conversation-submission-error"
                        tone="danger"
                        title="Message not sent"
                    >
                        {composer.submission.error.message}
                    </Banner>
                ) : null}
                {paletteOpen ? (
                    <div
                        className="happy2-conversation__palette"
                        data-happy2-ui="conversation-palette"
                    >
                        <RigCommandPalette
                            autoFocus={false}
                            commands={composer.capabilities.commands}
                            onClose={() => props.onComposerValueChange("")}
                            onCommand={(commandId) => props.onCommandInvoke?.(commandId)}
                            onQueryChange={(value) => props.onComposerValueChange(`/${value}`)}
                            query={composer.commandQuery ?? ""}
                        />
                    </div>
                ) : null}
                <div className="happy2-conversation__dock-inner">
                    {props.running && props.onAbort ? (
                        <Button
                            className="happy2-conversation__abort"
                            data-action="abort"
                            icon="close"
                            onClick={props.onAbort}
                            size="small"
                            variant="secondary"
                        >
                            Stop
                        </Button>
                    ) : null}
                    <Composer
                        hint={
                            composer.shellCommand !== undefined ? "Enter to run" : "Enter to send"
                        }
                        mentions={mentionsOf(composer)}
                        modelControl={props.composerControls}
                        onFocusChange={props.onComposerFocusChange}
                        onSend={props.onComposerSend}
                        onValueChange={props.onComposerValueChange}
                        pending={composer.submission.status === "pending"}
                        placeholder={props.composerPlaceholder ?? "Message the agent…"}
                        sendEnabled={sendEnabled}
                        value={composer.text}
                    />
                </div>
            </div>

            {props.overlay}
        </section>
    );
}
