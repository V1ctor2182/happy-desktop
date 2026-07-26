import {
    contentWidth,
    conversationActivityHeight,
    messageMediaHeight,
    messageRowHeight,
    noticeRowHeight,
    steeringNoticeRowHeight,
    DIVIDER_HEIGHT,
    type MessageTreatment,
} from "../../conversationRowHeight.js";
import type { MessageImage } from "./ChatPageComponents.js";
import { afterToolSteps, messagesGrouped, type WorkspaceEntry } from "./chatPageModels.js";

/**
 * Height of one chat transcript row, computed from the entry and the list's
 * measure — no mounted element, no render.
 *
 * The chat page renders a different vocabulary from the local conversation
 * surface (`WorkspaceEntry` through `ChatMessageEntry`, not `ConversationEntry`
 * through `ConversationEntryView`), so it needs its own mapping onto the shared
 * geometry in `conversationRowHeight`. What it shares is the reason: the
 * virtualizer must size rows nobody has scrolled to, and a constant guess makes
 * the scrollbar fiction and every newly reached row a correction.
 *
 * Returns `undefined` for a row whose height genuinely needs layout — an MCP app
 * surface, an expanded shell step — so the list falls back to its average
 * measured row rather than inventing a number.
 */
export type ChatRowContext = {
    /** The scroll port's content width in px. */
    readonly width: number;
    /** Identity of the reader; their own messages take the own bubble geometry. */
    readonly viewerId?: string;
    /** Attachment projection for a message, exactly as the row renders it. */
    readonly attachments: (entry: WorkspaceEntry & { kind: "message" }) => {
        readonly images: readonly MessageImage[];
        readonly files: number;
    };
    /** Whether this message carries an interactive MCP app surface. */
    readonly hasAppNodes: (entry: WorkspaceEntry & { kind: "message" }) => boolean;
};
/** `.happy2-chat-conversation .happy2-message[data-agent]` — 8px top and bottom. */
const CHAT_AGENT_PADDING = 8;
/*
 * `.happy2-message--turn-header` hides its body, but its `padding-bottom: 0`
 * loses to `.happy2-chat-conversation .happy2-message[data-agent]` on
 * specificity — so the row keeps the agent padding on both edges and only the
 * body goes away.
 */
/** `.happy2-message--after-trace-steps` reopens 8px above resumed prose. */
const AFTER_TRACE_PADDING_TOP = 8;
/** `.happy2-chat-turn-status` — a 28px AgentTraceRow with 4px of clearance. */
const TURN_STATUS_HEIGHT = 36;
/** A chat `FileAttachment` card, and the 4px column gap between two of them. */
const FILE_ATTACHMENT = 64;
const FILE_ATTACHMENT_GAP = 4;
const ATTACHMENTS_MARGIN = 8;
/** `.happy2-message__reactions` — 6px margin above a row of 24px chips. */
const REACTIONS_MARGIN = 6;
const REACTION_CHIP = 24;

export function chatRowHeight(
    entries: readonly WorkspaceEntry[],
    index: number,
    context: ChatRowContext,
): number | undefined {
    const entry = entries[index];
    if (!entry) return undefined;
    const width = contentWidth(context.width);
    if (entry.kind === "divider") return DIVIDER_HEIGHT;
    if (entry.kind === "notice") return noticeRowHeight(entry.text, width, "center");
    if (entry.kind === "steering") return steeringNoticeRowHeight(entry.text, entry.quote, width);
    if (entry.kind === "traceStep") return conversationActivityHeight(entry.activity.kind);
    if (entry.kind === "turnStatus") return TURN_STATUS_HEIGHT;
    if (context.hasAppNodes(entry)) return undefined;
    const own = !entry.agent && (entry.own || entry.senderId === context.viewerId);
    const treatment: MessageTreatment = entry.agent ? "agent" : own ? "own" : "incoming";
    const grouped = messagesGrouped(entries, index, entry);
    const trace = entry.agentTrace;
    const traceCollapsible =
        trace !== undefined &&
        trace.status !== "pending" &&
        trace.status !== "running" &&
        trace.entryCount > 0;
    /* The line that opens a turn holds its identity row and nothing else: its
       body is hidden and its bottom padding removed. */
    const turnHeader = entry.turnBlock === true && entry.body.length === 0;
    const { images, files } = context.attachments(entry);
    let height = messageRowHeight({
        body: turnHeader ? "" : entry.body,
        bodyVisible: !turnHeader,
        grouped,
        metaAccessory: traceCollapsible,
        surface: "chat",
        text: entry.body,
        time: entry.gutterTime ?? entry.time,
        treatment,
        width,
    });
    if (grouped && afterToolSteps(entries, index))
        height += AFTER_TRACE_PADDING_TOP - CHAT_AGENT_PADDING;
    if (images.length > 0)
        height += messageMediaHeight(images, width, treatment, entry.body.length > 0);
    if (files > 0)
        height += ATTACHMENTS_MARGIN + files * FILE_ATTACHMENT + (files - 1) * FILE_ATTACHMENT_GAP;
    const reactions = entry.agent ? 0 : (entry.reactions?.length ?? 0);
    if (reactions > 0) height += REACTIONS_MARGIN + REACTION_CHIP;
    return height;
}
