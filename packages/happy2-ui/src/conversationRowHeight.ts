import type { ConversationEntry } from "happy2-state";
import {
    conversationEntryResumesAfterActivity,
    conversationMessageGrouped,
} from "./conversationMessageGrouped";
import { asideTimeWidth, markdownBodyHeight, noticeTextHeight } from "./messageTextLayout";

/**
 * Height of one conversation row, computed from the entry and the list's measure
 * alone — no mounted element, no render.
 *
 * The virtualizer needs a size for every row, including the thousands nobody has
 * scrolled to. Estimating them all at one constant makes the scrollbar
 * proportions fiction and turns each newly reached row into a visible
 * correction. Modelling height per entry kind removes that: free text is laid
 * out with Pretext, an activity row is a known constant, and an image box is
 * arithmetic on its intrinsic dimensions.
 *
 * Rows still measure themselves once mounted — this is a truthful estimate, not
 * a replacement for measurement — so a kind this model cannot resolve returns
 * `undefined` and falls back to the list's running average rather than guessing.
 *
 * Every constant mirrors `styles/message.css`, `styles/conversation.css`,
 * `styles/chat-conversation.css`, and `styles/agent-activity-row.css`. They are
 * duplicated deliberately: reading them from the cascade needs the element this
 * module exists to avoid mounting. A change to that CSS must be made here too.
 */
export type ConversationSurface = "conversation" | "chat";
export type ConversationRowContext = {
    /** The scroll port's content width in px. */
    readonly width: number;
    /** Which surface's row padding applies; the two chrome scales differ. */
    readonly surface: ConversationSurface;
    /** Identity of the reader, so their own messages take the own geometry. */
    readonly viewerId?: string;
};
/**
 * `--happy2-chat-measure`. Both surfaces centre their scrolling column at this
 * readable measure — `.happy2-conversation` in `conversation.css`, and
 * `.happy2-chat-conversation` in `terminal-panel.css` — so a wide window does
 * not widen a row, and neither does its text measure.
 */
export const CHAT_MEASURE = 880;
/** Vertical chrome around a message body, by author treatment and grouping. */
const MESSAGE_CHROME = {
    conversation: { agent: [57, 4], incoming: [77, 28], own: [52, 28] },
    chat: { agent: [41, 16], incoming: [77, 28], own: [52, 28] },
} as const;
/**
 * `.happy2-conversation__resumed` raises an agent row's top padding to 8px when
 * its prose resumes after a tool run, replacing whichever padding grouping had
 * given it. Only the top edge changes.
 */
const RESUMED_PADDING_TOP = 8;
const CONVERSATION_AGENT_PADDING_TOP = { leading: 16, grouped: 2 } as const;
/** `.happy2-message__meta` — 20px row plus its 5px separation from the body. */
const META_ROW = 25;
/** Horizontal chrome: row padding, then the 76% bubble cap, then bubble padding. */
const AGENT_INSET = 94;
const INCOMING_INSET = 50;
const OWN_INSET = 48;
const BUBBLE_CAP = 0.76;
const BUBBLE_PADDING = 24;
/** The transparent-until-hover time that shares an own message's bubble line. */
const ASIDE_TIME_GAP = 8;
/** `.happy2-message__media` — top margin, inter-tile gap, and its own cap. */
const MEDIA_GAP = 4;
const MEDIA_MARGIN = 8;
const MEDIA_MARGIN_BARE = 4;
const MEDIA_MAX_WIDTH = 420;
const MEDIA_SINGLE_MAX_W = 380;
const MEDIA_SINGLE_MAX_H = 320;
const MEDIA_FALLBACK_H = 180;
/** Collapsed `.happy2-agent-activity-row` heights, by activity kind. */
const ACTIVITY_HEIGHT = { tool: 24, labeled: 24, reasoning: 40 } as const;
/** `.happy2-day-divider` — 20px padding around a 20px label that never wraps. */
export const DIVIDER_HEIGHT = 60;
/** `.happy2-system-notice`: 4px padding at `align="start"`, 16px centered. */
const NOTICE_CHROME = 8;
const NOTICE_CHROME_CENTER = 32;
const NOTICE_INSET = 50;
/* A steering notice keeps the notice row's 16px lead but closes to 4px above the
   quote it introduces; the quote itself wraps at 560px, inset 20px per side, and
   closes the row with the notice's usual 16px. */
const STEERING_LINE_CHROME = 20;
const STEERING_QUOTE_MEASURE = 560;
const STEERING_QUOTE_INSET = 40;
const STEERING_QUOTE_MARGIN = 16;

/** The list's content measure, after the shared readable maximum. */
export function contentWidth(width: number): number {
    return Math.min(width, CHAT_MEASURE);
}
/**
 * Painted height of a message's image grid. A lone photo reserves the exact box
 * `mediaItemStyle` computes; a 2–4 tile grid is two square columns. An own
 * message's grid shrinks to fit its content instead of stretching, so its tile
 * width is not knowable here — the stretched width is used as the floor and the
 * row's measurement corrects it.
 */
function mediaHeight(
    images: readonly { readonly width?: number; readonly height?: number }[],
    measure: number,
    hasBody: boolean,
): number {
    const margin = hasBody ? MEDIA_MARGIN : MEDIA_MARGIN_BARE;
    const count = Math.min(images.length, 4);
    if (count === 1) {
        const image = images[0]!;
        if (!image.width || !image.height) return margin + MEDIA_FALLBACK_H;
        const ratio = image.width / image.height;
        const width = Math.round(
            Math.min(image.width, MEDIA_SINGLE_MAX_W, MEDIA_SINGLE_MAX_H * ratio),
        );
        return margin + width / ratio;
    }
    const column = (Math.min(measure, MEDIA_MAX_WIDTH) - MEDIA_GAP) / 2;
    const rows = Math.ceil(count / 2);
    return margin + rows * column + (rows - 1) * MEDIA_GAP;
}
/** Which of the three author treatments a message row takes. */
export type MessageTreatment = "agent" | "incoming" | "own";
/**
 * The text measure a message body wraps at, after its row padding, the 76%
 * bubble cap, the bubble's own padding, and — for an own message — the mono time
 * that shares its bubble line and takes real width from it.
 */
export function messageBodyMeasure(
    width: number,
    treatment: MessageTreatment,
    time: string,
): number {
    if (treatment === "agent") return width - AGENT_INSET;
    if (treatment === "incoming") return (width - INCOMING_INSET) * BUBBLE_CAP - BUBBLE_PADDING;
    const column = width - OWN_INSET;
    const aside = asideTimeWidth(time);
    return Math.min(column * BUBBLE_CAP, column - ASIDE_TIME_GAP - aside) - BUBBLE_PADDING;
}
/** Collapsed height of an activity row, or `undefined` when it renders expanded. */
export function conversationActivityHeight(kind: string): number | undefined {
    return kind === "tool" || kind === "labeled" || kind === "reasoning"
        ? ACTIVITY_HEIGHT[kind]
        : undefined;
}
/** Height of a service line, wrapped at the measure its alignment leaves it. */
export function noticeRowHeight(text: string, width: number, align: "center" | "start"): number {
    const chrome = align === "start" ? NOTICE_CHROME : NOTICE_CHROME_CENTER;
    return chrome + noticeTextHeight(text, width - NOTICE_INSET);
}
/** Height of a steering notice: its service line above the message it quotes. */
export function steeringNoticeRowHeight(text: string, quote: string, width: number): number {
    return (
        STEERING_LINE_CHROME +
        noticeTextHeight(text, width - NOTICE_INSET) +
        noticeTextHeight(quote, Math.min(STEERING_QUOTE_MEASURE, width) - STEERING_QUOTE_INSET) +
        STEERING_QUOTE_MARGIN
    );
}
/** Height of a message's image grid at the measure its treatment leaves it. */
export function messageMediaHeight(
    images: readonly { readonly width?: number; readonly height?: number }[],
    width: number,
    treatment: MessageTreatment,
    hasBody: boolean,
): number {
    return mediaHeight(images, messageBodyMeasure(width, treatment, ""), hasBody);
}
/**
 * Height of a message row: its chrome for the author treatment and grouping,
 * plus the body wrapped at that treatment's measure. Attachments, media, and
 * reactions are added by the caller, which is what knows how its own surface
 * projects them.
 */
export function messageRowHeight(input: {
    readonly body: string;
    readonly bodyVisible: boolean;
    readonly grouped: boolean;
    readonly metaAccessory: boolean;
    readonly surface: ConversationSurface;
    readonly text: string;
    readonly time: string;
    readonly treatment: MessageTreatment;
    readonly width: number;
}): number {
    const [leading, tight] = MESSAGE_CHROME[input.surface][input.treatment];
    /* A grouped follow-up drops the identity row, unless a settled turn's trace
       control rides it — Message keeps the meta row for the accessory alone. */
    const chrome =
        (input.grouped ? tight : leading) + (input.grouped && input.metaAccessory ? META_ROW : 0);
    if (!input.bodyVisible) return chrome;
    const measure = messageBodyMeasure(input.width, input.treatment, input.time);
    return chrome + markdownBodyHeight(input.body, measure);
}
/**
 * Height of one row, or `undefined` when the entry's kind genuinely cannot be
 * resolved without laying it out: a shell activity renders its output expanded,
 * and every request prompt wraps flex options against their own label widths.
 */
export function conversationRowHeight(
    entries: readonly ConversationEntry[],
    index: number,
    context: ConversationRowContext,
): number | undefined {
    const entry = entries[index];
    if (!entry) return undefined;
    const width = contentWidth(context.width);
    if (entry.kind === "agentActivity") return conversationActivityHeight(entry.activity.kind);
    /* 12px margin above the 24px status line — the gap after the last message. */
    if (entry.kind === "turnStatus") return 36;
    if (entry.kind === "notice") {
        if (entry.variant === "divider") return DIVIDER_HEIGHT;
        const text = entry.title ? `${entry.title}: ${entry.text}` : entry.text;
        return noticeRowHeight(text, width, "start");
    }
    if (entry.kind === "request") return undefined;
    const message = entry.message;
    const agent = message.sender?.kind === "agent";
    const own = message.sender !== undefined && message.sender.id === context.viewerId;
    const grouped = conversationMessageGrouped(entries, index);
    const treatment: MessageTreatment = agent ? "agent" : own ? "own" : "incoming";
    const trace = message.agentTrace;
    /* A running turn keeps its live readout on the message-list footer, so the
       message row itself only gains the compact "View traces" accessory once the
       turn has settled. */
    const traceCollapsible =
        trace !== undefined &&
        trace.status !== "pending" &&
        trace.status !== "running" &&
        trace.entryCount > 0;
    const hasBody = message.text.trim().length > 0;
    let height = messageRowHeight({
        body: message.text,
        bodyVisible: hasBody || message.generationStatus !== undefined,
        grouped,
        metaAccessory: !own && traceCollapsible,
        surface: context.surface,
        text: message.text,
        time: messageTimeSample(message.createdAt),
        treatment,
        width,
    });
    if (
        agent &&
        context.surface === "conversation" &&
        conversationEntryResumesAfterActivity(entries, index)
    )
        height +=
            RESUMED_PADDING_TOP -
            (grouped
                ? CONVERSATION_AGENT_PADDING_TOP.grouped
                : CONVERSATION_AGENT_PADDING_TOP.leading);
    const images = message.attachments.filter(
        (attachment) =>
            attachment.kind === "inlineImage" ||
            attachment.file.kind === "photo" ||
            attachment.file.kind === "gif",
    );
    if (images.length > 0)
        height += messageMediaHeight(
            images.map((attachment) =>
                attachment.kind === "inlineImage"
                    ? {}
                    : { width: attachment.file.width, height: attachment.file.height },
            ),
            width,
            treatment,
            hasBody,
        );
    return height;
}
/**
 * The rendered clock string for a timestamp, formatted exactly as
 * `ConversationEntryView` formats it so its measured width is the real one.
 */
function messageTimeSample(value: string): string {
    if (value.trim().length === 0) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
