import { entryKey, type ConversationEntry } from "happy-desktop-state";
import {
    conversationAgentRowStartsGroup,
    conversationEntryPrecedesActivity,
    conversationEntryResumesAfterActivity,
    conversationMessageClosedByStatus,
    conversationMessageGrouped,
    conversationTurnStatusAfterActivity,
    conversationTurnStatusStartsGroup,
} from "./conversationMessageGrouped";
import {
    asideTimeWidth,
    markdownBodyHeight,
    messageTextLayoutCacheCreate,
    messageTextLayoutCacheRefresh,
    noticeTextHeight,
    type MessageTextLayoutCache,
} from "./messageTextLayout";
import { SYSTEM_NOTIFICATION_HEIGHT } from "./systemNotification";

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
type CachedRowHeight = { readonly value: number | undefined };
type Dictionary<T> = Record<string, T | undefined>;
type CachedEntryHeights = {
    readonly entry: ConversationEntry;
    readonly variants: Dictionary<CachedRowHeight>;
};
const dictionaryCreate = <T>(): Dictionary<T> => Object.create(null) as Dictionary<T>;
export interface ConversationRowHeightCache {
    /** Immutable-entry results at every width this conversation has occupied. */
    rows: Dictionary<CachedEntryHeights>;
    /** Prepared text and final text-layout results owned by this conversation. */
    readonly text: MessageTextLayoutCache;
}
/** Creates the virtually unbounded measurement cache owned by one conversation. */
export function conversationRowHeightCacheCreate(): ConversationRowHeightCache {
    return {
        rows: dictionaryCreate(),
        text: messageTextLayoutCacheCreate(),
    };
}
function rowHeightCached(
    cache: ConversationRowHeightCache | undefined,
    entry: ConversationEntry,
    key: string,
    calculate: () => number | undefined,
): number | undefined {
    if (!cache) return calculate();
    if (messageTextLayoutCacheRefresh(cache.text)) cache.rows = dictionaryCreate();
    const id = entryKey(entry);
    let cachedEntry = cache.rows[id];
    if (!cachedEntry || cachedEntry.entry !== entry) {
        cachedEntry = { entry, variants: dictionaryCreate() };
        cache.rows[id] = cachedEntry;
    }
    const hit = cachedEntry.variants[key];
    if (hit) return hit.value;
    const value = calculate();
    cachedEntry.variants[key] = { value };
    return value;
}
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
/**
 * `.happy2-conversation__continues` gives prose the same 8px on the way into a
 * tool run that `.happy2-conversation__resumed` gives it on the way out, and
 * `.happy2-conversation__closing` trims an answer's trailing padding to 4px so
 * the status closing it sits a paragraph break away. Only the bottom edge
 * changes.
 */
const CONTINUES_PADDING_BOTTOM = 8;
const CLOSING_PADDING_BOTTOM = 4;
const CONVERSATION_AGENT_PADDING_BOTTOM = { leading: 16, grouped: 2 } as const;
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
/**
 * The narrowest a lone photo is drawn once its height is capped. A page-tall
 * screenshot scaled whole would arrive as an unreadable 90px sliver, so past this
 * ratio the box keeps a usable width and the image crops — the click that opens
 * it full size is right there.
 */
const MEDIA_SINGLE_MIN_W = 240;
/** Box for a lone image whose format hid its dimensions: 240 × 4:3. */
const MEDIA_FALLBACK_W = 240;
const MEDIA_FALLBACK_H = 180;
/** Linked attachment cards: 64px cards, 4px gaps, and the message slot's top inset. */
const ATTACHMENT_CARD_HEIGHT = 64;
const ATTACHMENT_CARD_GAP = 4;
/** Collapsed `.happy2-agent-activity-row` heights, by activity kind. */
const ACTIVITY_HEIGHT = { tool: 32, labeled: 32, reasoning: 40 } as const;
/** Tool-first Message: 16px top inset + 20px identity row, then no lower chrome. */
const ACTIVITY_LEAD_CHROME = 36;
/**
 * A lead row holding a run of activity restores the meta row's margin, because
 * the identity line opens its own boundary onto the run beneath it. Only a lead
 * whose content is an activity row pays it.
 */
const ACTIVITY_LEAD_RUN_SEPARATION = 6;
/** One delegated agent row: 20px call + 20px metadata + 4px vertical inset. */
const DELEGATION_HEIGHT = 44;
/** `.happy2-day-divider` — 20px padding around a 20px label that never wraps. */
export const DIVIDER_HEIGHT = 60;
/** Centered `.happy2-system-notice`: 16px padding above and below. */
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
 * The box a lone photo is drawn in, from its intrinsic pixel size alone.
 *
 * Scaling down is the only transform: an image smaller than the cap keeps its own
 * size rather than being blown up past its detail. Larger, it scales to
 * `MEDIA_SINGLE_MAX_W`, and if that leaves it taller than `MEDIA_SINGLE_MAX_H` the
 * height is capped — by scaling further down, or, once that would take the width
 * below `MEDIA_SINGLE_MIN_W`, by holding that width and letting the painted image
 * crop into it. This is the single source of that arithmetic: `Message` styles the
 * element with it and this module reserves the row for it, and the two disagreeing
 * is a visible jump the moment the image loads.
 */
export function messageMediaSingleBox(image: {
    readonly width?: number;
    readonly height?: number;
}): { readonly width: number; readonly height: number } {
    if (!image.width || !image.height) return { width: MEDIA_FALLBACK_W, height: MEDIA_FALLBACK_H };
    const ratio = image.width / image.height;
    const width = Math.min(image.width, MEDIA_SINGLE_MAX_W);
    const height = width / ratio;
    if (height <= MEDIA_SINGLE_MAX_H)
        return { width: Math.round(width), height: Math.round(height) };
    return {
        width: Math.round(
            Math.min(Math.max(MEDIA_SINGLE_MAX_H * ratio, MEDIA_SINGLE_MIN_W), width),
        ),
        height: MEDIA_SINGLE_MAX_H,
    };
}
/**
 * Painted height of a message's image grid. A lone photo reserves the exact box
 * `messageMediaSingleBox` computes; a 2–4 tile grid is two square columns. An own
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
    if (count === 1) return margin + messageMediaSingleBox(images[0]!).height;
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
    cache?: MessageTextLayoutCache,
): number {
    if (treatment === "agent") return width - AGENT_INSET;
    if (treatment === "incoming") return (width - INCOMING_INSET) * BUBBLE_CAP - BUBBLE_PADDING;
    const column = width - OWN_INSET;
    const aside = asideTimeWidth(time, cache);
    return Math.min(column * BUBBLE_CAP, column - ASIDE_TIME_GAP - aside) - BUBBLE_PADDING;
}
/** Collapsed height of an activity row, or `undefined` when it renders expanded. */
export function conversationActivityHeight(kind: string): number | undefined {
    return kind === "tool" || kind === "labeled" || kind === "reasoning"
        ? ACTIVITY_HEIGHT[kind]
        : undefined;
}
/** Height of a service line, wrapped at the measure its alignment leaves it. */
export function noticeRowHeight(
    text: string,
    width: number,
    align: "center" | "start",
    cache?: MessageTextLayoutCache,
): number {
    if (align === "start") return SYSTEM_NOTIFICATION_HEIGHT;
    return NOTICE_CHROME_CENTER + noticeTextHeight(text, width - NOTICE_INSET, cache);
}
/** Height of a steering notice: its service line above the message it quotes. */
export function steeringNoticeRowHeight(
    text: string,
    quote: string,
    width: number,
    cache?: MessageTextLayoutCache,
): number {
    return (
        STEERING_LINE_CHROME +
        noticeTextHeight(text, width - NOTICE_INSET, cache) +
        noticeTextHeight(
            quote,
            Math.min(STEERING_QUOTE_MEASURE, width) - STEERING_QUOTE_INSET,
            cache,
        ) +
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
    readonly textCache?: MessageTextLayoutCache;
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
    const measure = messageBodyMeasure(input.width, input.treatment, input.time, input.textCache);
    return chrome + markdownBodyHeight(input.body, measure, input.textCache);
}
/**
 * Height of one row, or `undefined` when the entry's kind genuinely cannot be
 * resolved without laying it out: a shell activity renders its output expanded,
 * an error card owns its own bubble measure, and every request prompt wraps flex
 * options against their own label widths.
 */
export function conversationRowHeight(
    entries: readonly ConversationEntry[],
    index: number,
    context: ConversationRowContext,
    cache?: ConversationRowHeightCache,
): number | undefined {
    const entry = entries[index];
    if (!entry) return undefined;
    const width = contentWidth(context.width);
    if (entry.kind === "agentActivity") {
        const activityHeight = conversationActivityHeight(entry.activity.kind);
        const startsGroup =
            context.surface === "conversation" &&
            conversationAgentRowStartsGroup(entries, index) &&
            activityHeight !== undefined;
        return rowHeightCached(
            cache,
            entry,
            `activity:${context.surface}:${startsGroup ? "lead" : "plain"}`,
            () =>
                startsGroup
                    ? ACTIVITY_LEAD_CHROME + ACTIVITY_LEAD_RUN_SEPARATION + activityHeight
                    : activityHeight,
        );
    }
    /* A settled footer owns the clearance above it when prior activity exists. */
    if (entry.kind === "turnStatus") {
        const afterActivity = conversationTurnStatusAfterActivity(entries, index);
        const startsGroup =
            context.surface === "conversation" && conversationTurnStatusStartsGroup(entries, index);
        return rowHeightCached(
            cache,
            entry,
            [
                "turn-status",
                afterActivity ? "after-activity" : "plain",
                startsGroup ? "leading" : "continuous",
            ].join(":"),
            () => (afterActivity ? 36 : 32) + (startsGroup ? ACTIVITY_LEAD_CHROME : 0),
        );
    }
    if (entry.kind === "delegation") {
        const startsGroup =
            context.surface === "conversation" && conversationAgentRowStartsGroup(entries, index);
        return rowHeightCached(
            cache,
            entry,
            `delegation:${startsGroup ? "lead" : "plain"}`,
            () => DELEGATION_HEIGHT + (startsGroup ? ACTIVITY_LEAD_CHROME : 0),
        );
    }
    if (entry.kind === "notice") {
        /* A compute row owns its own measure: its detail disclosure is local to
           the row, and the provider sentence beside the label wraps against
           whatever the metrics and controls leave it. */
        if (entry.variant === "compute")
            return rowHeightCached(cache, entry, "notice:compute", () => undefined);
        if (entry.variant === "divider")
            return rowHeightCached(cache, entry, "notice:divider", () => DIVIDER_HEIGHT);
        if (entry.level === "error")
            return rowHeightCached(cache, entry, "notice:error", () => undefined);
        /* A notice that opens its turn wears the same identity header a
           tool-first row does, and therefore the same chrome above it. */
        const lead =
            context.surface === "conversation" && conversationAgentRowStartsGroup(entries, index)
                ? ACTIVITY_LEAD_CHROME
                : 0;
        return rowHeightCached(
            cache,
            entry,
            `notice:${String(width)}:${String(lead)}`,
            () => lead + SYSTEM_NOTIFICATION_HEIGHT,
        );
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
    const resumesAfterActivity =
        agent &&
        context.surface === "conversation" &&
        conversationEntryResumesAfterActivity(entries, index);
    const precedesActivity =
        agent &&
        context.surface === "conversation" &&
        conversationEntryPrecedesActivity(entries, index);
    const closedByStatus =
        context.surface === "conversation" && conversationMessageClosedByStatus(entries, index);
    const cacheKey = [
        "message",
        String(width),
        context.surface,
        treatment,
        grouped ? "grouped" : "leading",
        traceCollapsible ? "trace" : "plain",
        resumesAfterActivity ? "resumed" : "continuous",
        precedesActivity ? "continues" : closedByStatus ? "closing" : "open",
    ].join(":");
    return rowHeightCached(cache, entry, cacheKey, () => {
        let height = messageRowHeight({
            body: message.text,
            bodyVisible: hasBody || message.generationStatus !== undefined || traceCollapsible,
            grouped,
            metaAccessory: !own && traceCollapsible,
            surface: context.surface,
            textCache: cache?.text,
            time: own ? messageTimeSample(message.createdAt) : "",
            treatment,
            width,
        });
        if (resumesAfterActivity)
            height +=
                RESUMED_PADDING_TOP -
                (grouped
                    ? CONVERSATION_AGENT_PADDING_TOP.grouped
                    : CONVERSATION_AGENT_PADDING_TOP.leading);
        if (precedesActivity || closedByStatus)
            height +=
                (precedesActivity ? CONTINUES_PADDING_BOTTOM : CLOSING_PADDING_BOTTOM) -
                (grouped
                    ? CONVERSATION_AGENT_PADDING_BOTTOM.grouped
                    : CONVERSATION_AGENT_PADDING_BOTTOM.leading);
        const images: { readonly width?: number; readonly height?: number }[] = [];
        let cards = 0;
        for (const attachment of message.attachments) {
            if (
                attachment.kind === "inlineImage" ||
                (attachment.attachmentKind === "image" && attachment.openUrl !== undefined)
            ) {
                images.push({ width: attachment.width, height: attachment.height });
            } else {
                cards += 1;
            }
        }
        if (images.length > 0) height += messageMediaHeight(images, width, treatment, hasBody);
        if (cards > 0)
            height +=
                (hasBody ? MEDIA_MARGIN : MEDIA_MARGIN_BARE) +
                cards * ATTACHMENT_CARD_HEIGHT +
                (cards - 1) * ATTACHMENT_CARD_GAP;
        return height;
    });
}
/**
 * The rendered clock string for a timestamp, formatted exactly as
 * `ConversationEntryView` formats it so its measured width is the real one.
 */
function messageTimeSample(value: string): string {
    if (value.trim().length === 0) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return MESSAGE_TIME_FORMATTER.format(date);
}
const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
});
