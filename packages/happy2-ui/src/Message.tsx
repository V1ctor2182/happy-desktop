import { partitionComponentProps } from "./componentProps";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
    Children,
    isValidElement,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type HTMLAttributes,
    type ReactNode,
} from "react";
import { Avatar, type AvatarSize, type ToneName } from "./Avatar";
import { happyLogoUrl } from "./assets";
import { AutomatedTag } from "./AutomatedTag";
import { ReactionChip } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { renderMessageMarkdown, type MessageGenerationStatus } from "./MessageMarkdown";
export type MessageSegment =
    | {
          kind: "text";
          text: string;
      }
    | {
          kind: "mention";
          text: string;
      }
    | {
          kind: "code";
          text: string;
      }
    | {
          kind: "link";
          text: string;
      };
export type MessageReaction = {
    active?: boolean;
    count: number;
    emoji: string;
};
export type MessageImage = {
    id: string;
    url: string;
    /** Tiny decoded ThumbHash shown while the attachment preview downloads. */
    placeholderUrl?: string;
    alt?: string;
    /** Intrinsic pixel dimensions — reserve a stable box before the image loads. */
    width?: number;
    height?: number;
};
const MEDIA_SINGLE_MAX_W = 380;
const MEDIA_SINGLE_MAX_H = 320;
const MEDIA_SINGLE_FALLBACK_W = 240;
const MEDIA_SINGLE_FALLBACK_RATIO = "4 / 3";
/**
 * Inline box for a lone photo: an aspect-ratio plus a capped width reserves the
 * exact layout up front so nothing reflows when the image finishes loading.
 * Missing source dimensions use a stable 4:3 fallback rather than the image's
 * eventual intrinsic size. Multi-image tiles are square via CSS and need none.
 */
function mediaItemStyle(image: MessageImage, count: number): CSSProperties | undefined {
    if (count !== 1) return undefined;
    if (!image.width || !image.height)
        return {
            width: `${MEDIA_SINGLE_FALLBACK_W}px`,
            aspectRatio: MEDIA_SINGLE_FALLBACK_RATIO,
        };
    const ratio = image.width / image.height;
    const width = Math.round(Math.min(image.width, MEDIA_SINGLE_MAX_W, MEDIA_SINGLE_MAX_H * ratio));
    return { width: `${width}px`, aspectRatio: `${image.width} / ${image.height}` };
}

/** One image tile; without an open action it remains media, not a fake button. */
function MessageMediaItem(props: {
    count: number;
    image: MessageImage;
    onOpen?: (id: string) => void;
}) {
    const content = props.image.url ? (
        <img
            alt={props.image.alt ?? ""}
            className="happy2-message__media-image"
            data-happy2-ui="message-media-image"
            draggable={false}
            height={props.image.height}
            loading="lazy"
            src={props.image.url}
            width={props.image.width}
        />
    ) : (
        <span
            aria-label={`Loading ${props.image.alt ?? "image"}`}
            className="happy2-message__media-loading"
            data-happy2-ui="message-media-loading"
            role="status"
            style={
                props.image.placeholderUrl
                    ? { backgroundImage: `url(${props.image.placeholderUrl})` }
                    : undefined
            }
        />
    );
    const shared = {
        className: "happy2-message__media-item",
        "data-fixed": "",
        "data-media-id": props.image.id,
        "data-happy2-ui": "message-media-item",
        style: mediaItemStyle(props.image, props.count),
    } as const;
    return props.onOpen ? (
        <button
            {...shared}
            aria-label={props.image.alt ? `Open ${props.image.alt}` : "Open image"}
            data-interactive=""
            onClick={() => props.onOpen?.(props.image.id)}
            type="button"
        >
            {content}
        </button>
    ) : (
        <div {...shared}>{content}</div>
    );
}
export type MessageDeliveryState = "failed" | "pending_steering" | "sending" | "sent";
export type MessageProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
    /** Author is an agent → accent AGENT badge next to the name. */
    agent?: boolean;
    /**
     * The message was posted through automation (a plugin/API acting on the
     * author's behalf) rather than typed by hand. Shows a restrained "Automated"
     * marker beside the author. This is orthogonal to `agent`: an automated
     * message is still attributed to its human author and keeps their identity —
     * it is not the separate agent/system identity treatment.
     */
    automated?: boolean;
    /** Who the message addressed, e.g. "To agents · Happy + 1". */
    audienceLabel?: string;
    /** Compact optional action placed in the author metadata before the time. */
    metaAccessory?: ReactNode;
    author: string;
    body: string | MessageSegment[];
    /** Attachment cards (runs, approvals, events) rendered below the body. */
    children?: ReactNode;
    /** Follow-up message: no avatar/author row, time sits in the gutter. */
    compact?: boolean;
    /** Delivery styling that never inserts or removes layout. */
    deliveryState?: MessageDeliveryState;
    /**
     * Readable fallback for an intentionally empty message summary. Owners use
     * this for collapsed tool-only turns; expanded identity headers leave it off.
     */
    emptyText?: string;
    /** Agent reply generation lifecycle for a string body. Separate from
     * `deliveryState`: delivery is outgoing, generation is the incoming reply
     * being produced. `streaming` shows a live caret; `failed` a minimal marker. */
    generationStatus?: MessageGenerationStatus;
    /** Consecutive message from the same author. Preferred over `compact`. */
    grouped?: boolean;
    /** Compact time for the grouped gutter (e.g. "12:55") so a wide 12-hour
     * "12:55 AM" — fine inline on the first message — still fits the 36px gutter.
     * Defaults to `time`. */
    gutterTime?: string;
    imageUrl?: string;
    /** Inline photo attachments rendered as a clickable thumbnail grid. */
    images?: MessageImage[];
    /** Opens an image (by id) — wire to a web-modal lightbox, never a new tab. */
    onImageOpen?: (id: string) => void;
    /** Makes the avatar and author name clickable to open the author's profile.
     *  Only the leading message of a group renders an avatar/name, so grouped
     *  follow-ups intentionally carry no profile affordance. */
    onAuthorSelect?: () => void;
    initials?: string;
    /** Selects one of the existing reaction chips rendered below the message. */
    onReactionSelect?: (emoji: string) => void;
    /**
     * The viewer's own outgoing message. Renders as a right-aligned accent
     * bubble with no avatar and no author name — only humans send, so an `own`
     * message is never also an `agent`. Incoming human messages (neither flag)
     * render as a left neutral bubble; agents render on the surface unbubbled.
     */
    own?: boolean;
    reactions?: MessageReaction[];
    style?: CSSProperties;
    /**
     * Rendered send time. Optional because a producer may genuinely have none
     * (a local agent transcript is ordered, not timestamped); the meta and
     * gutter slots keep their boxes either way so no layout shifts.
     */
    time?: string;
    tone?: ToneName;
};
function deriveInitials(author: string) {
    return author
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] ?? "")
        .join("")
        .toUpperCase();
}
function renderSegment(segment: MessageSegment): ReactNode {
    switch (segment.kind) {
        case "mention":
            return (
                <span className="happy2-message__mention" data-happy2-ui="message-mention">
                    @{segment.text}
                </span>
            );
        case "code":
            return (
                <code className="happy2-message__code" data-happy2-ui="message-code">
                    {segment.text}
                </code>
            );
        case "link":
            return (
                <span className="happy2-message__link" data-happy2-ui="message-link">
                    {segment.text}
                </span>
            );
        default:
            return segment.text;
    }
}
function hasRenderableChild(value: ReactNode): boolean {
    if (Array.isArray(value)) return value.some(hasRenderableChild);
    return (
        value !== undefined && value !== null && value !== false && value !== true && value !== ""
    );
}
/**
 * One chat message on the app surface: a compact inline identity, author/time row,
 * rich body segments, attachment slot, reactions, and reply affordance.
 */
export function Message(props: MessageProps) {
    const [local, rest] = partitionComponentProps(props, [
        "agent",
        "audienceLabel",
        "automated",
        "author",
        "body",
        "children",
        "className",
        "compact",
        "deliveryState",
        "emptyText",
        "generationStatus",
        "grouped",
        "gutterTime",
        "imageUrl",
        "images",
        "onImageOpen",
        "initials",
        "metaAccessory",
        "onAuthorSelect",
        "onReactionSelect",
        "own",
        "reactions",
        "style",
        "time",
        "tone",
    ]);
    const attachments = local.children;
    const body = useRef<HTMLDivElement>(null);
    const generationMarker = useRef<HTMLSpanElement>(null);
    const segments = (): MessageSegment[] =>
        typeof local.body === "string" ? [{ kind: "text", text: local.body }] : local.body;
    const isMarkdownBody = () => typeof local.body === "string";
    const hasAttachments = () => hasRenderableChild(attachments);
    const grouped = () => local.grouped || local.compact;
    const showIncomingIdentity = () => !local.own && !grouped();
    /* The leading incoming message owns the author line. Grouped follow-ups keep
       their hover metadata inline after the body instead of repeating identity. */
    const showIncomingMeta = () => !local.own && !grouped();
    const authorActionLabel = () => `View ${local.author}’s profile`;
    const happyAgent = () => local.agent && local.author.trim().toLocaleLowerCase() === "happy";
    const renderAvatar = (size: AvatarSize) => (
        <Avatar
            imageUrl={happyAgent() ? happyLogoUrl : local.imageUrl}
            initials={local.initials ?? deriveInitials(local.author)}
            size={size}
            tone={local.tone}
            type={local.agent ? "agent" : "human"}
        />
    );
    const renderDanglingAvatar = () =>
        local.onAuthorSelect ? (
            <button
                aria-label={authorActionLabel()}
                className="happy2-message__identity happy2-message__avatar-dangling"
                data-happy2-ui="message-identity"
                onClick={() => local.onAuthorSelect?.()}
                type="button"
            >
                {renderAvatar("xs")}
            </button>
        ) : (
            <span className="happy2-message__avatar-dangling">{renderAvatar("xs")}</span>
        );
    const deliveryState = () => local.deliveryState ?? "sent";
    /* A failed-generation marker is painted at the end of the final rendered
       text run. It stays absolutely positioned so settling cannot alter the
       message's flow geometry. Streaming itself has no typing marker. */
    useLayoutEffect(() => {
        const bodyElement = body.current;
        const marker = generationMarker.current;
        if (!bodyElement || !marker) return;
        const position = () => {
            const textNodes = document.createTreeWalker(bodyElement, NodeFilter.SHOW_TEXT);
            let textRect: DOMRect | undefined;
            for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
                const text = node as Text;
                if (!text.textContent?.trim()) continue;
                const range = document.createRange();
                range.setStart(text, Math.max(0, text.length - 1));
                range.setEnd(text, text.length);
                const rects = range.getClientRects();
                const finalRect = rects.item(rects.length - 1);
                if (finalRect) textRect = finalRect;
            }
            if (!textRect) {
                marker.style.transform = "translate(0px, 0px)";
                marker.style.visibility = "visible";
                return;
            }
            const bodyRect = bodyElement.getBoundingClientRect();
            marker.style.transform = `translate(${textRect.right - bodyRect.left}px, ${
                textRect.top - bodyRect.top
            }px)`;
            marker.style.visibility = "visible";
        };
        position();
        const observer = new ResizeObserver(position);
        observer.observe(bodyElement);
        return () => observer.disconnect();
    }, [local.body, local.generationStatus]);
    /* Automation attribution belongs to the message, so on an own message it
       opens the bubble instead of floating beside it: the reader sees that a
       plugin posted this before reading a word of it. It never depends on hover
       for the same reason. */
    const ownAutomatedLine =
        local.own && local.automated ? (
            <span
                className="happy2-message__automated happy2-message__automated--own"
                data-happy2-ui="message-automated"
            >
                <AutomatedTag />
            </span>
        ) : null;
    const renderIncomingHoverMeta = (placement: "header" | "inline", leadingSeparator = false) =>
        !local.own && (local.metaAccessory || local.time) ? (
            <span
                className="happy2-message__hover-meta"
                data-happy2-ui="message-hover-meta"
                data-has-accessory={local.metaAccessory ? "" : undefined}
                data-placement={placement}
            >
                {leadingSeparator ? (
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy2-ui="message-meta-separator"
                    />
                ) : null}
                {local.metaAccessory ? (
                    <span
                        className="happy2-message__meta-accessory"
                        data-happy2-ui="message-meta-accessory"
                    >
                        {local.metaAccessory}
                    </span>
                ) : null}
                {local.metaAccessory && local.time ? (
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy2-ui="message-meta-separator"
                    />
                ) : null}
                {local.time ? (
                    <span className="happy2-message__time" data-happy2-ui="message-time">
                        <span data-happy2-ui="message-time-label">{local.time}</span>
                    </span>
                ) : null}
            </span>
        ) : null;
    const inlineIncomingHoverMeta = showIncomingIdentity()
        ? null
        : renderIncomingHoverMeta("inline");
    const bodyNode =
        !local.body &&
        local.emptyText === undefined &&
        local.generationStatus === undefined ? null : isMarkdownBody() ? (
            <div
                className="happy2-message__body happy2-message__body--markdown"
                data-markdown=""
                data-happy2-ui="message-body"
                ref={body}
            >
                {ownAutomatedLine}
                {typeof local.body === "string"
                    ? renderMessageMarkdown(local.body, inlineIncomingHoverMeta ?? undefined)
                    : null}
                {/* An empty generated reply keeps a non-breaking-space line box
                    so generation-state changes cannot collapse the message row. */}
                {!local.body && local.emptyText !== undefined ? (
                    <p className="happy2-message__empty-text" data-happy2-ui="message-empty-text">
                        {local.emptyText}
                    </p>
                ) : !local.body && local.generationStatus !== undefined ? (
                    <p aria-hidden="true" className="happy2-message__generation-anchor">
                        {"\u00a0"}
                    </p>
                ) : null}
                {local.generationStatus === "failed" ? (
                    <span
                        aria-label="Generation failed"
                        className="happy2-message__generation-marker"
                        data-empty={!local.body ? "" : undefined}
                        data-generation-marker="failed"
                        data-happy2-ui="message-generation-failed"
                        ref={generationMarker}
                        role="img"
                    />
                ) : null}
            </div>
        ) : (
            <div className="happy2-message__body" data-happy2-ui="message-body">
                {ownAutomatedLine}
                {segments().map((segment, index) => (
                    <span key={`${segment.kind}-${index}`}>{renderSegment(segment)}</span>
                ))}
                {inlineIncomingHoverMeta ? (
                    <>
                        {"\u00a0"}
                        {inlineIncomingHoverMeta}
                    </>
                ) : null}
            </div>
        );
    // An own attachment/image-only automated message still needs the durable
    // attribution marker. Normal media remains flush: this line exists only
    // when automation requires it, never for ordinary media-only messages.
    const ownBubbleLine =
        local.own &&
        (bodyNode !== null ||
            (local.automated && (Boolean(local.images?.length) || hasAttachments())));
    const groupedIncomingLine =
        !local.own && grouped() && bodyNode !== null ? (
            <div className="happy2-message__incoming-line" data-happy2-ui="message-incoming-line">
                {bodyNode}
            </div>
        ) : null;
    const incomingMeta = showIncomingMeta() ? (
        <div className="happy2-message__meta" data-happy2-ui="message-meta">
            {!showIncomingIdentity() ? null : local.onAuthorSelect ? (
                <button
                    aria-label={authorActionLabel()}
                    className="happy2-message__author happy2-message__author--button"
                    data-happy2-ui="message-author"
                    onClick={() => local.onAuthorSelect?.()}
                    type="button"
                >
                    <span data-happy2-ui="message-author-label">{local.author}</span>
                </button>
            ) : (
                <span className="happy2-message__author" data-happy2-ui="message-author">
                    <span data-happy2-ui="message-author-label">{local.author}</span>
                </span>
            )}
            {local.automated && showIncomingIdentity() ? (
                <>
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy2-ui="message-meta-separator"
                    />
                    <span className="happy2-message__automated" data-happy2-ui="message-automated">
                        <AutomatedTag />
                    </span>
                </>
            ) : null}
            {showIncomingIdentity() && (local.metaAccessory || local.time)
                ? renderIncomingHoverMeta("header", true)
                : null}
        </div>
    ) : null;
    return (
        <div
            {...rest}
            className={["happy2-message", local.className].filter(Boolean).join(" ")}
            data-agent={local.agent ? "" : undefined}
            data-own={local.own ? "" : undefined}
            data-compact={grouped() ? "" : undefined}
            data-delivery-state={deliveryState()}
            data-generation-status={local.generationStatus}
            data-grouped={grouped() ? "" : undefined}
            data-has-body={local.body || local.emptyText !== undefined ? "" : undefined}
            data-happy2-ui="message"
            aria-busy={
                deliveryState() === "sending" ||
                deliveryState() === "pending_steering" ||
                local.generationStatus === "streaming"
                    ? "true"
                    : undefined
            }
            style={local.style}
        >
            <div className="happy2-message__gutter" data-happy2-ui="message-gutter">
                {showIncomingIdentity() ? renderDanglingAvatar() : null}
            </div>
            <div className="happy2-message__content" data-happy2-ui="message-content">
                {/* Own messages carry no meta row — the accent bubble on the
                    right is identity enough; no author, time, or audience pill. */}
                {incomingMeta}
                {ownBubbleLine ? (
                    <div
                        className="happy2-message__bubble-line"
                        data-happy2-ui="message-bubble-line"
                    >
                        {/* A media-only automated message has no bubble to open, so
                            its marker rides the bubble line beside the hover time
                            instead. It stays visible either way. */}
                        {local.automated && bodyNode === null ? (
                            <span
                                className="happy2-message__automated happy2-message__automated--own"
                                data-happy2-ui="message-automated"
                            >
                                <AutomatedTag />
                            </span>
                        ) : null}
                        <span
                            className="happy2-message__aside-time"
                            data-happy2-ui="message-aside-time"
                        >
                            {local.gutterTime ?? local.time ?? ""}
                        </span>
                        {bodyNode}
                    </div>
                ) : (
                    (groupedIncomingLine ?? bodyNode)
                )}
                {local.images && local.images.length > 0 ? (
                    <div
                        className="happy2-message__media"
                        data-count={Math.min(local.images!.length, 4)}
                        data-happy2-ui="message-media"
                    >
                        {local.images!.slice(0, 4).map((image) => (
                            <MessageMediaItem
                                count={Math.min(local.images!.length, 4)}
                                image={image}
                                key={image.id}
                                onOpen={local.onImageOpen}
                            />
                        ))}
                    </div>
                ) : null}
                {hasAttachments() ? (
                    <div
                        className="happy2-message__attachments"
                        data-happy2-ui="message-attachments"
                    >
                        {attachments}
                    </div>
                ) : null}
                {local.reactions && local.reactions.length > 0 ? (
                    <div className="happy2-message__reactions" data-happy2-ui="message-reactions">
                        {local.reactions.map((reaction, index) => (
                            <ReactionChip
                                active={reaction.active}
                                count={reaction.count}
                                emoji={reaction.emoji}
                                onSelect={() => local.onReactionSelect?.(reaction.emoji)}
                                key={`${reaction.emoji}-${index}`}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
export type MessageListProps = {
    children: ReactNode;
    className?: string;
    /**
     * A row at the end of the list's content, below the last message. It is
     * part of the virtualized row collection with a reserved stable key, not an
     * overlay or sticky chrome, so it scrolls and reconciles like every other
     * transcript row.
     */
    footer?: ReactNode;
    /** Fixed height supplied to the virtualizer for the stable footer row. */
    footerHeight?: number;
    /**
     * Height of row `index` at the list's current content width, computed from
     * the caller's own data rather than from the DOM. Every row is still
     * measured once it mounts; this is what sizes the ones nobody has scrolled
     * to yet, so the scrollbar tells the truth and reaching a row is not a
     * correction. Return `undefined` for a row whose height genuinely needs
     * layout — it falls back to the list's average measured row.
     */
    estimateRowSize?: (index: number, width: number) => number | undefined;
    /** Restores a previously detached reader position on this list's first layout. */
    initialScrollPosition?: MessageListScrollPosition;
    /** Reports user scrolling and the final position before this list detaches. */
    onScrollPositionChange?: (position: MessageListScrollPosition) => void;
    style?: CSSProperties;
    /**
     * Enables TanStack Virtual for this list's entire mounted lifetime. Callers
     * that can grow into long histories must opt in from the first render so
     * crossing an arbitrary row-count threshold never reparents live rows.
     */
    virtualize?: boolean;
};
export interface MessageListScrollPosition {
    readonly scrollTop: number;
    readonly following: boolean;
    /** Measured virtual rows needed to interpret scrollTop after this list remounts. */
    readonly measurements?: readonly VirtualItem[];
}
/** A reader this close to the bottom (px) still follows appended content. */
const FOLLOW_BOTTOM_THRESHOLD = 8;
/** Transcript clearances represented inside the virtualizer's coordinate space. */
const MESSAGE_LIST_PADDING_START = 12;
const MESSAGE_LIST_PADDING_END = 8;
/** Row height assumed before anything has ever been measured. */
const ROW_SIZE_FALLBACK = 72;
/** Reserved stable entity key for the optional final footer row. */
const MESSAGE_LIST_FOOTER_KEY = "__happy2_message_list_footer__";
/**
 * Mean height of the rows a previous lifetime actually measured. Every mounted
 * row is measured for real, so this estimate only ever sizes rows the reader has
 * not reached yet — but it sets the scrollbar's proportions, so a restored
 * history whose bubbles run tall must not be re-estimated at the generic
 * fallback: that is what makes the thumb jump as the reader scrolls into
 * unmeasured territory.
 */
function averageMeasuredSize(measurements: readonly VirtualItem[] | undefined) {
    if (!measurements || measurements.length === 0) return ROW_SIZE_FALLBACK;
    let total = 0;
    for (const item of measurements) total += item.size;
    return total / measurements.length;
}
/**
 * Scrolling message column. A `margin-top: auto` spacer bottom-anchors sparse
 * histories while long histories scroll chronologically from the top.
 *
 * Follows the newest content: scrolls to the bottom instantly on mount and
 * whenever its content grows — unless the user has scrolled up, in which case
 * their position is preserved (standard chat behavior). The "was at/near the
 * bottom before the mutation" flag is tracked from scroll events, so it always
 * reflects the position prior to the DOM change.
 */
export function MessageList(props: MessageListProps) {
    const list = useRef<HTMLDivElement>(null);
    /* The restore payload is read once, at mount. This list reports its own
       position back out, and an owner that stores it where a later render can
       read it would otherwise feed it back in mid-session — re-anchoring a list
       the reader is actively scrolling. Restoring is a lifetime event, and the
       lifetime boundary is the caller's `key`. */
    const restore = useRef(props.initialScrollPosition);
    const following = useRef(restore.current?.following ?? true);
    const measurements = useRef(restore.current?.measurements);
    const positionChange = useRef(props.onScrollPositionChange);
    positionChange.current = props.onScrollPositionChange;
    const interactiveResize = useRef(false);
    const interactiveResizeIndex = useRef<number | undefined>(undefined);
    const scrollPositionSync = useRef<() => void>(() => undefined);
    const estimatedSize = useRef(averageMeasuredSize(restore.current?.measurements));
    const entryItems = Children.toArray(props.children);
    const footerIndex = props.footer === undefined ? undefined : entryItems.length;
    const items =
        footerIndex === undefined
            ? entryItems
            : [
                  ...entryItems,
                  <div
                      className="happy2-message-list__footer"
                      data-happy2-ui="message-list-footer"
                      data-item-id="working-status"
                      key={MESSAGE_LIST_FOOTER_KEY}
                  >
                      {props.footer}
                  </div>,
              ];
    const virtualized = props.virtualize === true;
    const estimateItemSize = (index: number, width: number) =>
        index === footerIndex
            ? (props.footerHeight ?? estimatedSize.current)
            : (props.estimateRowSize?.(index, width) ?? estimatedSize.current);
    /**
     * Total height of every row, asking the caller's estimator for each one and
     * falling back to the measured average only where it declines to answer.
     * This is the offset a list opens at when it has no position to restore.
     */
    const estimatedContentHeight = () => {
        const width = list.current?.clientWidth ?? 0;
        let total = MESSAGE_LIST_PADDING_START + MESSAGE_LIST_PADDING_END;
        for (let index = 0; index < items.length; index += 1)
            total += estimateItemSize(index, width);
        return total;
    };
    // TanStack Virtual deliberately owns mutable measurement functions; this leaf
    // remains outside compiler memoization while every rendered row stays eligible.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        /* Automatic growth uses the end anchor so a following reader stays at
           the newest content. An explicitly toggled row temporarily uses its
           start edge instead: its header stays put and its body opens downward. */
        anchorTo: interactiveResize.current ? "start" : "end",
        count: virtualized ? items.length : 0,
        estimateSize: (index) => estimateItemSize(index, list.current?.clientWidth ?? 0),
        followOnAppend: true,
        getItemKey: (index) => {
            const item = items[index];
            return isValidElement(item) && item.key !== null ? item.key : index;
        },
        getScrollElement: () => list.current,
        /* Opening a conversation lands on its newest content, which means the
           first offset has to be the height of everything above it. Counting
           every row at the generic fallback got that badly wrong whenever real
           rows were taller — the list opened part way up its own history and
           then had to correct as rows measured — so the caller's own estimator
           answers for each row, exactly as it does for every later layout. */
        initialOffset: virtualized ? (restore.current?.scrollTop ?? estimatedContentHeight()) : 0,
        initialMeasurementsCache: restore.current?.measurements
            ? [...restore.current.measurements]
            : [],
        overscan: 12,
        /*
         * These are the same visual clearances the non-virtual list owns in CSS.
         * Keeping them here makes row starts, total size, scrollTop, anchoring,
         * and restored measurements use one coordinate system.
         */
        paddingEnd: MESSAGE_LIST_PADDING_END,
        paddingStart: MESSAGE_LIST_PADDING_START,
        /* Same "still following" tolerance the scroll listener applies, so a
           reader parked one subpixel off the bottom is treated identically by
           the virtualizer's append-follow and by this component's reporting. */
        scrollEndThreshold: FOLLOW_BOTTOM_THRESHOLD,
        useFlushSync: false,
    });
    const beginInteractiveResize: HTMLAttributes<HTMLDivElement>["onClickCapture"] = (event) => {
        const target = event.target instanceof Element ? event.target : undefined;
        const toggle = target?.closest<HTMLElement>("button[aria-expanded]");
        const row = toggle?.closest<HTMLElement>(".happy2-message-list__virtual-row");
        const index = Number(row?.dataset.index);
        if (!toggle || !row || !list.current?.contains(toggle) || !Number.isInteger(index)) return;

        interactiveResize.current = true;
        interactiveResizeIndex.current = index;
        /*
         * A child-owned expansion can commit without re-rendering MessageList
         * first. Change the live instance synchronously in capture phase so its
         * ResizeObserver sees the interaction anchor, then restore the normal
         * automatic-growth policy after layout has settled.
         */
        virtualizer.options.anchorTo = "start";
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) =>
            item.index !== interactiveResizeIndex.current &&
            item.start < (list.current?.scrollTop ?? 0);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                interactiveResize.current = false;
                interactiveResizeIndex.current = undefined;
                virtualizer.options.anchorTo = "end";
                virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
            });
        });
    };
    const virtualContentSize = virtualized ? virtualizer.getTotalSize() : 0;
    const scrollToBottom = () => {
        const element = list.current;
        if (element) element.scrollTop = element.scrollHeight - element.clientHeight;
    };
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const savedScrollTop = restore.current?.scrollTop;
        if (following.current) scrollToBottom();
        else element.scrollTop = savedScrollTop ?? 0;
        // Virtual-row measurement can compensate the scroll offset after this
        // layout effect. Reapply a parked reader's exact pixel offset once those
        // initial measurements have landed.
        const restoreFrame =
            !following.current && savedScrollTop !== undefined
                ? requestAnimationFrame(() => {
                      element.scrollTop = savedScrollTop;
                  })
                : undefined;
        const positionReport = (captureMeasurements = false) => {
            if (captureMeasurements && virtualized)
                measurements.current = virtualizer.takeSnapshot();
            positionChange.current?.({
                scrollTop: element.scrollTop,
                following: following.current,
                measurements: measurements.current,
            });
        };
        let viewportHeight = element.clientHeight;
        let bottomOffset = Math.max(0, element.scrollHeight - element.scrollTop - viewportHeight);
        const onScroll = () => {
            /*
             * A growing viewport can clamp scrollTop before ResizeObserver runs.
             * Ignore that transient scroll event so it cannot replace the bottom
             * offset captured against the previous viewport height.
             */
            if (element.clientHeight !== viewportHeight) return;
            bottomOffset = Math.max(0, element.scrollHeight - element.scrollTop - viewportHeight);
            following.current = bottomOffset <= FOLLOW_BOTTOM_THRESHOLD;
            positionReport();
        };
        element.addEventListener("scroll", onScroll, { passive: true });
        scrollPositionSync.current = onScroll;
        /* Only the unmeasured path needs a DOM watcher to stay pinned. A
           virtualized list learns about the same growth as a measurement and
           compensates the offset itself; re-writing `scrollTop` on every
           mutation would undo that compensation and make a streaming reply
           stutter. */
        const observer = virtualized
            ? undefined
            : new MutationObserver(() => {
                  if (following.current) scrollToBottom();
              });
        observer?.observe(element, { characterData: true, childList: true, subtree: true });
        /*
         * The composer is a flex sibling of this scrollport. As its textarea
         * grows or shrinks, preserve the reader's exact distance from the
         * transcript bottom by restoring the offset captured before the resize.
         * Computing the final target avoids double-adjusting when the browser
         * has already clamped scrollTop as a growing viewport collapses the
         * composer. This applies equally to a following reader and someone
         * parked higher in history.
         */
        const viewportObserver = new ResizeObserver(() => {
            const nextHeight = element.clientHeight;
            if (nextHeight === viewportHeight) return;
            viewportHeight = nextHeight;
            element.scrollTop = Math.max(0, element.scrollHeight - nextHeight - bottomOffset);
            bottomOffset = Math.max(0, element.scrollHeight - element.scrollTop - nextHeight);
            positionReport();
        });
        viewportObserver.observe(element);
        return () => {
            if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
            positionReport(true);
            observer?.disconnect();
            viewportObserver.disconnect();
            scrollPositionSync.current = () => undefined;
            element.removeEventListener("scroll", onScroll);
        };
    }, [virtualized, virtualizer]);
    useLayoutEffect(() => {
        /*
         * A resized virtual row updates the virtualizer before React commits the
         * sizer's new height. Re-pin a following reader after that commit, when
         * the browser can accept the final scroll offset without clamping it to
         * the old maximum. Parked readers stay under the virtualizer's own
         * item-size compensation and are never moved here.
         */
        void virtualContentSize;
        if (interactiveResize.current) {
            scrollPositionSync.current();
            return;
        }
        if (!following.current) return;
        scrollToBottom();
    }, [items.length, virtualContentSize]);
    return (
        <div
            className={["happy2-message-list", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="message-list"
            onClickCapture={beginInteractiveResize}
            ref={list}
            style={props.style}
        >
            <div
                className="happy2-message-list__content"
                data-happy2-ui="message-list-content"
                data-virtualized={virtualized ? "" : undefined}
            >
                <div
                    aria-hidden="true"
                    className="happy2-message-list__spacer"
                    data-happy2-ui="message-list-spacer"
                />
                {virtualized ? (
                    <div
                        className="happy2-message-list__virtual"
                        data-happy2-ui="message-list-virtual"
                        style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                        {virtualizer.getVirtualItems().map((virtualItem) => (
                            <div
                                className="happy2-message-list__virtual-row"
                                data-index={virtualItem.index}
                                data-item-id={
                                    virtualItem.index === footerIndex ? "working-status" : undefined
                                }
                                key={virtualItem.key}
                                ref={virtualizer.measureElement}
                                style={{ transform: `translateY(${virtualItem.start}px)` }}
                            >
                                {items[virtualItem.index]}
                            </div>
                        ))}
                    </div>
                ) : (
                    items
                )}
            </div>
        </div>
    );
}
/** Centered plain-text date separating message days. */
export function DayDivider(props: { className?: string; label: string }) {
    return (
        <div
            aria-label={props.label}
            className={["happy2-day-divider", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="day-divider"
            role="separator"
        >
            <span className="happy2-day-divider__label" data-happy2-ui="day-divider-label">
                {props.label}
            </span>
        </div>
    );
}
export type SystemNoticeSegment =
    | {
          kind: "text";
          text: string;
      }
    | {
          kind: "ref";
          text: string;
      };
/* Split a service line into plain runs and highlighted @user / #channel refs.
   The regex keeps the delimiters so spacing and punctuation survive verbatim;
   a ref token is the sigil plus an unbroken run of word characters. */
const SYSTEM_NOTICE_REF = /([@#][\p{L}\p{N}_.-]+)/u;
function systemNoticeSegments(text: string): SystemNoticeSegment[] {
    return text
        .split(SYSTEM_NOTICE_REF)
        .filter((part) => part.length > 0)
        .map((part) =>
            SYSTEM_NOTICE_REF.test(part) && (part[0] === "@" || part[0] === "#")
                ? { kind: "ref", text: part }
                : { kind: "text", text: part },
        );
}
/**
 * Low-emphasis service line for durable chat events such as membership and
 * agent-setting changes. It is not a chat bubble: a small leading glyph sits
 * beside muted body text, with @user and #channel references color-lifted so
 * the affected entities read at a glance.
 *
 * `align` chooses between the two places a service line belongs. `center` is
 * the shared-channel default, where a notice separates two people's turns.
 * `start` is the assistant-turn hint: context a single agent emitted mid-turn,
 * which reads as part of that turn and therefore lines up with its text column
 * instead of interrupting the thread with a centered banner.
 */
export function SystemNotice(props: {
    align?: "center" | "start";
    className?: string;
    icon?: IconName;
    style?: CSSProperties;
    text: string;
}) {
    const segments = systemNoticeSegments(props.text);
    return (
        <div
            aria-label={props.text}
            className={["happy2-system-notice", props.className].filter(Boolean).join(" ")}
            data-align={props.align ?? "center"}
            data-happy2-ui="system-notice"
            role="note"
            style={props.style}
        >
            <span
                aria-hidden="true"
                className="happy2-system-notice__icon"
                data-happy2-ui="system-notice-icon"
            >
                <Icon name={props.icon ?? "users"} size={14} />
            </span>
            <span className="happy2-system-notice__text" data-happy2-ui="system-notice-text">
                {segments.map((segment, index) =>
                    segment.kind === "ref" ? (
                        <span
                            className="happy2-system-notice__ref"
                            data-happy2-ui="system-notice-ref"
                            key={`${segment.text}-${index}`}
                        >
                            {segment.text}
                        </span>
                    ) : (
                        <span key={index}>{segment.text}</span>
                    ),
                )}
            </span>
        </div>
    );
}
/**
 * The service line for a message the agent took while it was already working.
 * The message itself keeps its own place in the transcript — nothing a reader is
 * looking at moves — so this line is what says when the agent actually picked it
 * up, and it quotes that message so the moment reads on its own.
 */
export function SteeringNotice(props: {
    className?: string;
    quote: string;
    style?: CSSProperties;
    text: string;
}) {
    return (
        <div
            aria-label={`${props.text}: ${props.quote}`}
            className={["happy2-steering-notice", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="steering-notice"
            role="note"
            style={props.style}
        >
            <SystemNotice
                className="happy2-steering-notice__line"
                icon="arrow-right"
                text={props.text}
            />
            <blockquote
                className="happy2-steering-notice__quote"
                data-happy2-ui="steering-notice-quote"
            >
                {props.quote}
            </blockquote>
        </div>
    );
}
