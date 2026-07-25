import { type CSSProperties } from "react";
import type { ConversationAttachment, ConversationEntry, UserError } from "happy2-state";
import { AgentActivityRow } from "./AgentActivityRow";
import { AgentTraceRow, type AgentTraceRowKind, type AgentTraceRowStatus } from "./AgentTraceRow";
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
    /** Another message from the same author follows (tool rows ignored). */
    groupContinues?: boolean;
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
    /** Opens the turn trace panel for an agent message. */
    onTraceOpen?: (messageId: string) => void;
    /** The trace panel is showing this message's turn. */
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
    const traceRunning =
        trace !== undefined &&
        (trace.status === "pending" || trace.status === "running") &&
        trace.entryCount > 0;
    const traceOpen = props.onTraceOpen ? () => props.onTraceOpen!(message.id) : undefined;
    const traceStatus = (): AgentTraceRowStatus => {
        if (!trace) return "running";
        if (trace.status === "failed") return "failed";
        if (trace.status === "running" || trace.status === "pending") return "running";
        return "complete";
    };
    const traceKind = (): AgentTraceRowKind | undefined => {
        const kind = trace?.latest?.kind;
        if (kind === "reasoning" || kind === "response" || kind === "tool") return kind;
        if (kind === "subagent") return "subagent";
        if (kind === "terminal") return "terminal";
        if (kind === "status") return "status";
        return undefined;
    };
    return (
        <Message
            agent={author?.kind === "agent"}
            author={author?.displayName ?? "Unknown"}
            body={message.text}
            className={props.className}
            data-testid={props["data-testid"]}
            deliveryState={entry.delivery}
            generationStatus={message.generationStatus}
            groupContinues={props.groupContinues}
            grouped={props.grouped}
            hideIncomingIdentity={!own}
            initials={initialsOf(author?.displayName)}
            menuItems={
                rewindable
                    ? [{ id: "rewind", kind: "item", label: "Rewind to here", icon: "reply" }]
                    : undefined
            }
            metaAccessory={
                trace && !traceRunning && trace.entryCount > 0 ? (
                    <AgentTraceRow
                        entryCount={trace.entryCount}
                        onOpen={traceOpen}
                        open={props.traceOpen}
                        status={traceStatus()}
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
        >
            {traceRunning && trace ? (
                <AgentTraceRow
                    detail={trace.latest?.detail}
                    entryCount={trace.entryCount}
                    kind={traceKind()}
                    onOpen={traceOpen}
                    open={props.traceOpen}
                    status="running"
                    title={trace.latest?.title}
                    variant="row"
                />
            ) : null}
        </Message>
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
