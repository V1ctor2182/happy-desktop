import { type CSSProperties } from "react";
import type { ComposerSnapshot, ConversationAuthor, ConversationEntry } from "happy2-state";
import { Avatar } from "../../Avatar";
import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { Button } from "../../Button";
import { ConversationDock } from "../../ConversationDock";
import { ConversationEntryView } from "../../ConversationEntryView";
import {
    conversationAgentRowStartsGroup,
    conversationEntryResumesAfterActivity,
    conversationMessageGrouped,
    conversationTurnStatusAfterActivity,
} from "../../conversationMessageGrouped";
import { conversationRowHeight } from "../../conversationRowHeight";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { MessageList } from "../../Message";
import { Spinner } from "../../Spinner";
import { Toolbar } from "../../Toolbar";
import { Ionicon } from "../../vectorIcons/VectorIcon";

export interface SharedSessionViewProps {
    title: string;
    ownerName: string;
    ownerInitials: string;
    ownerPhotoUrl?: string;
    /** Whether the owner is still sharing this session. */
    live: boolean;
    /** Why it ended, in the surface's own words, when it has. */
    endedReason?: string;
    /** The replicated transcript, already projected by the caller. */
    entries: readonly ConversationEntry[];
    /** Identity id of the reader, so their own friend messages take the own treatment. */
    viewerId?: string;
    /** Agent identity for a tool row that opens a turn before prose exists. */
    agentAuthor?: ConversationAuthor;
    /** True before the first page of the transcript arrives. */
    loading?: boolean;
    /** True while a further page towards the present is being read. */
    loadingMore?: boolean;
    /** False while newer entries remain; true once the replica has caught up to the present. */
    complete?: boolean;
    /** Asks for the page after the newest row currently held, reading on towards the present. */
    onLoadMore?: () => void;
    /** Leaves this replica and returns to the sessions shared with the reader. */
    onClose?: () => void;
    /** The feed failed; what was already read stays readable. */
    error?: string;
    /** Composing a message back to the owner. Absent leaves the composer out. */
    composer?: ComposerSnapshot;
    onComposerValueChange?: (value: string) => void;
    onComposerSend?: () => void;
    /** Why a message cannot be sent right now, said in the composer. */
    composerRefusal?: string;
    /** Shows or hides the intermediate entries of a finished turn. */
    onTraceToggle?: (turnId: string) => void;
    expandedTurnIds?: ReadonlySet<string>;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Height reserved for the "Newer messages" row before it has been measured. */
const MORE_ROW_HEIGHT = 44;

/** Whether the turn this row carries the trace control for is currently open. */
function traceOpen(
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

/**
 * P-019 SharedSessionView — somebody else's session, replicated here and read.
 *
 * It is deliberately not the owner's conversation surface with its controls
 * removed. The header names the person whose work this is rather than the work
 * itself, and a strip under it states, permanently, that nothing on this screen
 * can be changed — including by the reader's own habits, which is what a
 * transcript that looks exactly like an editable one would otherwise invite.
 * Whether the owner is still sharing is stated in the same place, so a replica
 * that has stopped receiving content never reads as a session that has gone
 * quiet.
 *
 * The transcript itself is the product's own vocabulary — the shared
 * `MessageList` and `ConversationEntryView` — because a replica of a
 * conversation is a conversation, and a second renderer would drift from the
 * one the owner sees. Every write-side callback of an entry is left out on
 * purpose: no approvals, no answers, no tool previews, no attachment actions.
 * The one thing a reader may write is a message back to the owner, and only
 * when the caller hands over a composer to write it in.
 *
 * Props only: it holds no replica, pages nothing itself, and reports both acts
 * upward.
 */
export function SharedSessionView(props: SharedSessionViewProps) {
    const entries = props.entries;
    const showMore = props.complete !== true && props.entries.length > 0;
    const composer = props.composer;
    const refused = props.composerRefusal !== undefined && props.composerRefusal.length > 0;
    return (
        <section
            /* The transcript keeps the conversation surface's own row geometry:
               a replica that laid its messages out differently from the session
               it copies would be a second reading of the same rows. */
            className={["happy2-shared-session happy2-conversation", props.className]
                .filter(Boolean)
                .join(" ")}
            data-happy2-ui="shared-session-view"
            data-live={props.live ? "" : undefined}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <Toolbar
                height={SURFACE_HEADER_HEIGHT}
                leading={
                    <>
                        {props.onClose ? (
                            <Button
                                aria-label="Back to sessions shared with you"
                                className="happy2-shared-session__back"
                                iconOnly
                                onClick={() => props.onClose?.()}
                                size="small"
                                variant="ghost"
                            >
                                {/* The curated glyph set has no left-pointing
                                    arrow, so this reaches for the same Ionicon
                                    the browser panel's Back already uses rather
                                    than pointing a reader the wrong way. */}
                                <Ionicon name="arrow-back-outline" size={14} />
                            </Button>
                        ) : null}
                        <Avatar
                            aria-label={props.ownerName}
                            {...(props.ownerPhotoUrl ? { imageUrl: props.ownerPhotoUrl } : {})}
                            initials={props.ownerInitials}
                            size="md"
                        />
                    </>
                }
                subtitle={`Shared by ${props.ownerName}`}
                title={props.title}
                titleLevel={1}
                trailing={
                    <Badge
                        label={props.live ? "Live" : "Ended"}
                        variant={props.live ? "accent" : "neutral"}
                    />
                }
            />

            <div
                className="happy2-shared-session__notice"
                data-happy2-ui="shared-session-notice"
                data-live={props.live ? "" : undefined}
                role="status"
            >
                <span aria-hidden="true" className="happy2-shared-session__notice-mark">
                    <Icon name={props.live ? "eye" : "lock"} size={14} />
                </span>
                <span
                    className="happy2-shared-session__notice-text"
                    data-happy2-ui="shared-session-notice-text"
                >
                    {props.live
                        ? `You are watching ${props.ownerName}'s session. Nothing here can be changed.`
                        : `${props.endedReason ?? "The owner stopped sharing"}. What you already read stays here; nothing new will arrive.`}
                </span>
            </div>

            {props.error ? (
                <div className="happy2-shared-session__error">
                    <Banner icon="alert" title="This may be out of date" tone="danger">
                        {props.error}
                    </Banner>
                </div>
            ) : null}

            {props.loading && entries.length === 0 ? (
                <div
                    className="happy2-shared-session__loading"
                    data-happy2-ui="shared-session-loading"
                >
                    <Spinner
                        label="Loading the shared session"
                        size={20}
                        tone="muted"
                        variant="line"
                    />
                </div>
            ) : entries.length === 0 ? (
                <div className="happy2-shared-session__empty" data-happy2-ui="shared-session-empty">
                    <EmptyState
                        description={`Nothing has been said in ${props.ownerName}'s session yet.`}
                        icon="chat"
                        size="panel"
                        title="Nothing here yet"
                    />
                </div>
            ) : (
                <MessageList
                    estimateRowSize={(index, width) => {
                        if (showMore && index === entries.length) return MORE_ROW_HEIGHT;
                        return conversationRowHeight(entries, index, {
                            surface: "conversation",
                            ...(props.viewerId === undefined ? {} : { viewerId: props.viewerId }),
                            width,
                        });
                    }}
                    virtualize
                >
                    {entries.map((entry, index) => (
                        <ConversationEntryView
                            activityAuthor={
                                props.agentAuthor && conversationAgentRowStartsGroup(entries, index)
                                    ? props.agentAuthor
                                    : undefined
                            }
                            className={
                                entry.kind === "turnStatus" &&
                                conversationTurnStatusAfterActivity(entries, index)
                                    ? "happy2-turn-status--after-trace"
                                    : conversationEntryResumesAfterActivity(entries, index)
                                      ? "happy2-conversation__resumed"
                                      : undefined
                            }
                            entry={entry}
                            grouped={
                                entry.kind === "message"
                                    ? conversationMessageGrouped(entries, index)
                                    : undefined
                            }
                            key={entry.kind === "message" ? entry.message.id : entry.id}
                            onTraceToggle={props.onTraceToggle}
                            traceOpen={traceOpen(entry, props.expandedTurnIds)}
                            viewerId={props.viewerId}
                        />
                    ))}
                    {showMore ? (
                        <div
                            className="happy2-shared-session__more"
                            data-happy2-ui="shared-session-more"
                            key="__happy2_shared_session_more__"
                        >
                            <Button
                                disabled={props.loadingMore}
                                icon="chevron-down"
                                onClick={() => props.onLoadMore?.()}
                                size="small"
                                variant="ghost"
                            >
                                {props.loadingMore ? "Catching up…" : "Newer messages"}
                            </Button>
                        </div>
                    ) : null}
                </MessageList>
            )}

            {composer ? (
                <div className="happy2-shared-session__dock" data-happy2-ui="shared-session-dock">
                    {refused ? (
                        <p
                            className="happy2-shared-session__refusal"
                            data-happy2-ui="shared-session-refusal"
                            role="status"
                        >
                            {props.composerRefusal}
                        </p>
                    ) : null}
                    <ConversationDock
                        composer={composer}
                        composerPlaceholder={`Write to ${props.ownerName}…`}
                        disabled={refused}
                        onComposerSend={() => props.onComposerSend?.()}
                        onComposerValueChange={(value) => props.onComposerValueChange?.(value)}
                    />
                </div>
            ) : null}
        </section>
    );
}
