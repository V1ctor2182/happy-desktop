import { type CSSProperties } from "react";
import type { ConversationAttachment, ConversationEntry, UserError } from "happy2-state";
import { AgentActivityRow } from "./AgentActivityRow";
import { AgentStatusLine } from "./AgentStatusLine";
import { AgentTraceRow } from "./AgentTraceRow";
import { DayDivider, Message, SystemNotice, type MessageImage } from "./Message";
import {
    ConversationRequestView,
    type ConversationRequestDecision,
} from "./ConversationRequestView";
import { type RigUserInputAnswerMap } from "./RigUserInputPrompt";

export type ConversationEntryViewProps = {
    entry: ConversationEntry;
    /** Identity id of the reader, so their own messages take the own treatment. */
    viewerId?: string;
    /** Consecutive entry from the same author: no avatar/author row. */
    grouped?: boolean;
    /** Rewinds the conversation to a message; enables the per-message affordance. */
    onRewind?: (messageId: string) => void;
    /** Answers a pending question request entry. */
    onRequestAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Approves or denies a pending gate request entry. */
    onRequestDecide?: (requestId: string, decision: ConversationRequestDecision) => void;
    /**
     * Resolves a durable attachment to a fetchable URL. Inline attachments carry
     * their own bytes and never need this.
     */
    attachmentUrl?: (fileId: string) => string;
    /** Opens an attached image full size. */
    onImageOpen?: (messageId: string, attachmentId: string) => void;
    /** Disables request controls while a prior submission is in flight. */
    requestPending?: boolean;
    /** Last failed submission for this request. */
    requestError?: UserError;
    /** Renders rich activity bodies expanded from the first paint (blueprint/tests). */
    activityDefaultExpanded?: boolean;
    /** Shows or hides the intermediate entries of this message's finished turn. */
    onTraceToggle?: (turnId: string) => void;
    /** That turn's intermediate entries are currently listed. */
    traceOpen?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const NOTICE_ICON = { info: "dot", warning: "shield", error: "shield" } as const;

/**
 * ConversationEntryView — renders one `ConversationEntry` through the shared
 * chat vocabulary: an authored message is a `Message`, agent activity is one
 * glanceable `AgentActivityRow`, a service line is a `SystemNotice`, a section
 * boundary is a `DayDivider`, and something waiting on the reader is its request
 * prompt. Both stacks render their conversations through this one component, so
 * neither grows a second message list.
 *
 * A running turn needs no status row of its own: its steps are listed in the
 * transcript as it works, and the surface keeps one minimal status line in the
 * message-list footer. Once the turn ends the steps fold away behind the
 * compact "View traces" link on the line that opened the turn.
 */
export function ConversationEntryView(props: ConversationEntryViewProps) {
    const entry = props.entry;
    if (entry.kind === "agentActivity")
        return (
            <AgentActivityRow
                activity={entry.activity}
                className={props.className}
                data-testid={props["data-testid"]}
                defaultExpanded={props.activityDefaultExpanded}
                singleLine={entry.activity.kind === "tool"}
                style={props.style}
            />
        );
    if (entry.kind === "turnStatus")
        return (
            <AgentStatusLine
                className={["happy2-conversation-turn-status", props.className]
                    .filter(Boolean)
                    .join(" ")}
                data-testid={props["data-testid"]}
                elapsedMs={entry.durationMs}
                status={entry.status}
                style={props.style}
                tokens={entry.tokens}
                tools={entry.tools}
            />
        );
    if (entry.kind === "notice")
        return entry.variant === "divider" ? (
            <DayDivider className={props.className} label={entry.text} />
        ) : (
            // Mid-turn agent context (system prompts, reasoning preambles, run
            // notices) belongs to the turn that produced it, so it reads as a
            // quiet left-aligned hint rather than a centered channel banner.
            <SystemNotice
                align="start"
                className={props.className}
                icon={NOTICE_ICON[entry.level]}
                style={props.style}
                text={entry.title ? `${entry.title}: ${entry.text}` : entry.text}
            />
        );
    if (entry.kind === "request")
        return (
            <ConversationRequestView
                className={props.className}
                data-testid={props["data-testid"]}
                defaultExpanded={props.activityDefaultExpanded}
                error={props.requestError}
                onAnswer={(requestId, answers) => props.onRequestAnswer?.(requestId, answers)}
                onDecide={(requestId, decision) => props.onRequestDecide?.(requestId, decision)}
                pending={props.requestPending}
                request={entry.request}
                style={props.style}
            />
        );

    const message = entry.message;
    const author = message.sender;
    const own = author !== undefined && author.id === props.viewerId;
    const rewindable = props.onRewind !== undefined && author?.kind !== "agent";
    const images = imagesOf(message.attachments, props.attachmentUrl);
    const trace = message.agentTrace;
    /* A running turn lists its steps in the transcript and keeps its live
       readout on the message-list footer, so the message itself carries no
       bordered status row. The compact "View traces" link only appears once the
       turn has settled. */
    const traceCollapsible =
        trace !== undefined &&
        trace.status !== "pending" &&
        trace.status !== "running" &&
        trace.entryCount > 0;
    const traceToggle =
        trace && props.onTraceToggle ? () => props.onTraceToggle?.(trace.turnId) : undefined;
    return (
        <Message
            agent={author?.kind === "agent"}
            author={author?.displayName ?? "Unknown"}
            body={message.text}
            className={props.className}
            data-testid={props["data-testid"]}
            deliveryState={entry.delivery}
            generationStatus={message.generationStatus}
            grouped={props.grouped}
            initials={initialsOf(author?.displayName)}
            menuItems={
                rewindable
                    ? [{ id: "rewind", kind: "item", label: "Rewind to here", icon: "reply" }]
                    : undefined
            }
            metaAccessory={
                traceCollapsible && trace ? (
                    <AgentTraceRow
                        entryCount={trace.entryCount}
                        onOpen={traceToggle}
                        open={props.traceOpen}
                        status={trace.status === "failed" ? "failed" : "complete"}
                        toggles
                        toolCallCount={trace.toolCallCount}
                        totalTokens={trace.totalTokens}
                        variant="meta"
                    />
                ) : undefined
            }
            onMenuSelect={rewindable ? () => props.onRewind?.(message.id) : undefined}
            images={images.length > 0 ? [...images] : undefined}
            onImageOpen={
                props.onImageOpen
                    ? (imageId: string) => props.onImageOpen?.(message.id, imageId)
                    : undefined
            }
            own={own}
            style={props.style}
            time={messageTime(message.createdAt)}
        />
    );
}

/**
 * Projects message attachments into the renderable image list. Inline images
 * carry their bytes, so they become data URLs directly; a durable file needs the
 * owner to resolve a URL and is skipped when it cannot.
 */
function imagesOf(
    attachments: readonly ConversationAttachment[],
    attachmentUrl: ((fileId: string) => string) | undefined,
): readonly MessageImage[] {
    const images: MessageImage[] = [];
    for (const attachment of attachments) {
        if (attachment.kind === "inlineImage") {
            images.push({
                id: attachment.id,
                url: `data:${attachment.mediaType};base64,${attachment.data}`,
                alt: "Attached image",
            });
            continue;
        }
        if (!attachmentUrl) continue;
        const file = attachment.file;
        if (file.kind !== "photo" && file.kind !== "gif") continue;
        images.push({
            id: file.id,
            url: attachmentUrl(file.id),
            ...(file.originalName ? { alt: file.originalName } : {}),
            ...(file.width !== undefined ? { width: file.width } : {}),
            ...(file.height !== undefined ? { height: file.height } : {}),
        });
    }
    return images;
}

function messageTime(value: string): string | undefined {
    if (value.trim().length === 0) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function initialsOf(displayName: string | undefined): string {
    if (!displayName || displayName.length === 0) return "?";
    const parts = displayName.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "?";
    const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${second}`.toUpperCase();
}
