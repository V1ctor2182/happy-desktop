import { partitionComponentProps } from "./componentProps";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
    Children,
    isValidElement,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type HTMLAttributes,
    type Key,
    type ReactNode,
} from "react";
import { Avatar, type AvatarSize, type ToneName } from "./Avatar";
import { AvatarBrutalist } from "./AvatarBrutalist";
import { happyLogoUrl } from "./assets";
import { AutomatedTag } from "./AutomatedTag";
import { ReactionChip } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { APP_SHELL_RESIZE_LAYOUT_EVENT } from "./AppShell";
import { messageMediaSingleBox } from "./conversationRowHeight";
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
/**
 * Inline box for a lone photo: the exact pixel box `messageMediaSingleBox`
 * computes from the image's own dimensions, so the layout is reserved up front and
 * nothing reflows when the bytes arrive — and the transcript's virtualizer, which
 * reserves the row from the same function, agrees with it. Multi-image tiles are
 * square via CSS and need none.
 */
function mediaItemStyle(image: MessageImage, count: number): CSSProperties | undefined {
    if (count !== 1) return undefined;
    const box = messageMediaSingleBox(image);
    return { width: `${box.width}px`, height: `${box.height}px` };
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
            data-happy-desktop-ui="message-media-image"
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
            data-happy-desktop-ui="message-media-loading"
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
        "data-happy-desktop-ui": "message-media-item",
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
    /**
     * A short standing fact about this incoming message, printed as a quiet
     * second line under the author name — where another person's message stands
     * with respect to the agent's context, for example. It is display text chosen by
     * the producer, never a state name, and a message with nothing to say about
     * itself simply omits it. An own message has no author line, so it never
     * carries one.
     */
    contextNote?: string;
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
     * being produced. `streaming` marks a body still arriving; `failed` shows a
     * minimal marker. */
    generationStatus?: MessageGenerationStatus;
    /**
     * A caret riding the end of a `streaming` body, matching the typing caret
     * activity labels wear. Off by default: showing it is a surface-wide
     * choice the conversation surface makes, not a per-message one.
     */
    streamingCaret?: boolean;
    /** Consecutive message from the same author. Preferred over `compact`. */
    grouped?: boolean;
    /** Compact time for the grouped gutter (e.g. "12:55") so a wide 12-hour
     * "12:55 AM" — fine inline on the first message — still fits the 36px gutter.
     * Defaults to `time`. */
    gutterTime?: string;
    imageUrl?: string;
    /**
     * A session this message speaks for rather than a person: the avatar becomes
     * that session's generated mark instead of initials. It is what separates a
     * message that arrived from another session from one written here — and the
     * mark matches the one that session wears in the tab strip, so the two read
     * as the same thing. An `imageUrl` still wins over it.
     */
    avatarSessionId?: string;
    /** Inline photo attachments rendered as a clickable thumbnail grid. */
    images?: MessageImage[];
    /** Opens an image (by id) — wire to a web-modal lightbox, never a new tab. */
    onImageOpen?: (id: string) => void;
    /**
     * Opens a workspace file this message links to, in the product's own file
     * viewer. Absent leaves such links inert, which is what a surface with no
     * workspace behind it can honestly offer.
     */
    onFileOpen?: (path: string) => void;
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
                <span className="happy2-message__mention" data-happy-desktop-ui="message-mention">
                    @{segment.text}
                </span>
            );
        case "code":
            return (
                <code className="happy2-message__code" data-happy-desktop-ui="message-code">
                    {segment.text}
                </code>
            );
        case "link":
            return (
                <span className="happy2-message__link" data-happy-desktop-ui="message-link">
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
/**
 * Edge of the mark in the identity gutter. An `Avatar` is shrunk to this by
 * `.happy2-message__avatar-dangling` in `message.css`; a generated mark carries
 * its size inline, where a stylesheet cannot reach it, so it is stated here and
 * the two must stay equal or the gutter's marks will not match.
 */
const GUTTER_MARK_PIXELS = 12;

export function Message(props: MessageProps) {
    const [local, rest] = partitionComponentProps(props, [
        "agent",
        "audienceLabel",
        "automated",
        "author",
        "avatarSessionId",
        "body",
        "children",
        "className",
        "compact",
        "contextNote",
        "deliveryState",
        "emptyText",
        "generationStatus",
        "streamingCaret",
        "grouped",
        "gutterTime",
        "imageUrl",
        "images",
        "onImageOpen",
        "onFileOpen",
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
    const renderAvatar = (size: AvatarSize) =>
        local.avatarSessionId !== undefined && local.imageUrl === undefined && !happyAgent() ? (
            <AvatarBrutalist id={local.avatarSessionId} size={GUTTER_MARK_PIXELS} />
        ) : (
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
                data-happy-desktop-ui="message-identity"
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
    // eslint-disable-next-line happy2-react/no-layout-effect -- the failure marker must measure the committed final text range and write its absolute DOM position without changing message flow
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
                data-happy-desktop-ui="message-automated"
            >
                <AutomatedTag />
            </span>
        ) : null;
    const renderIncomingHoverMeta = (placement: "header" | "inline", leadingSeparator = false) =>
        !local.own && (local.metaAccessory || local.time) ? (
            <span
                className="happy2-message__hover-meta"
                data-happy-desktop-ui="message-hover-meta"
                data-has-accessory={local.metaAccessory ? "" : undefined}
                data-placement={placement}
            >
                {leadingSeparator ? (
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy-desktop-ui="message-meta-separator"
                    />
                ) : null}
                {local.metaAccessory ? (
                    <span
                        className="happy2-message__meta-accessory"
                        data-happy-desktop-ui="message-meta-accessory"
                    >
                        {local.metaAccessory}
                    </span>
                ) : null}
                {local.metaAccessory && local.time ? (
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy-desktop-ui="message-meta-separator"
                    />
                ) : null}
                {local.time ? (
                    <span className="happy2-message__time" data-happy-desktop-ui="message-time">
                        <span data-happy-desktop-ui="message-time-label">{local.time}</span>
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
                data-happy-desktop-ui="message-body"
                ref={body}
            >
                {ownAutomatedLine}
                {typeof local.body === "string"
                    ? renderMessageMarkdown(
                          local.body,
                          inlineIncomingHoverMeta ?? undefined,
                          local.onFileOpen,
                      )
                    : null}
                {/* An empty generated reply keeps a non-breaking-space line box
                    so generation-state changes cannot collapse the message row. */}
                {!local.body && local.emptyText !== undefined ? (
                    <p
                        className="happy2-message__empty-text"
                        data-happy-desktop-ui="message-empty-text"
                    >
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
                        data-happy-desktop-ui="message-generation-failed"
                        ref={generationMarker}
                        role="img"
                    />
                ) : null}
            </div>
        ) : (
            <div className="happy2-message__body" data-happy-desktop-ui="message-body">
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
            <div
                className="happy2-message__incoming-line"
                data-happy-desktop-ui="message-incoming-line"
            >
                {bodyNode}
            </div>
        ) : null;
    const incomingMeta = showIncomingMeta() ? (
        <div className="happy2-message__meta" data-happy-desktop-ui="message-meta">
            {!showIncomingIdentity() ? null : local.onAuthorSelect ? (
                <button
                    aria-label={authorActionLabel()}
                    className="happy2-message__author happy2-message__author--button"
                    data-happy-desktop-ui="message-author"
                    onClick={() => local.onAuthorSelect?.()}
                    type="button"
                >
                    <span data-happy-desktop-ui="message-author-label">{local.author}</span>
                </button>
            ) : (
                <span className="happy2-message__author" data-happy-desktop-ui="message-author">
                    <span data-happy-desktop-ui="message-author-label">{local.author}</span>
                </span>
            )}
            {local.automated && showIncomingIdentity() ? (
                <>
                    <span
                        aria-hidden="true"
                        className="happy2-message__meta-separator"
                        data-happy-desktop-ui="message-meta-separator"
                    />
                    <span
                        className="happy2-message__automated"
                        data-happy-desktop-ui="message-automated"
                    >
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
            data-streaming-caret={
                local.streamingCaret && local.generationStatus === "streaming" ? "" : undefined
            }
            data-grouped={grouped() ? "" : undefined}
            data-has-body={local.body || local.emptyText !== undefined ? "" : undefined}
            data-happy-desktop-ui="message"
            aria-busy={
                deliveryState() === "sending" ||
                deliveryState() === "pending_steering" ||
                local.generationStatus === "streaming"
                    ? "true"
                    : undefined
            }
            style={local.style}
        >
            <div className="happy2-message__gutter" data-happy-desktop-ui="message-gutter">
                {showIncomingIdentity() ? renderDanglingAvatar() : null}
            </div>
            <div className="happy2-message__content" data-happy-desktop-ui="message-content">
                {/* Own messages carry no meta row — the accent bubble on the
                    right is identity enough; no author, time, or audience pill. */}
                {incomingMeta}
                {/* A standing fact about the message belongs under the name it
                    is a fact about, not inside the hover metadata: it is read
                    before the body, once, and it does not appear and disappear
                    with the pointer. */}
                {showIncomingIdentity() && local.contextNote ? (
                    <span
                        className="happy2-message__context-note"
                        data-happy-desktop-ui="message-context-note"
                    >
                        {local.contextNote}
                    </span>
                ) : null}
                {ownBubbleLine ? (
                    <div
                        className="happy2-message__bubble-line"
                        data-happy-desktop-ui="message-bubble-line"
                    >
                        {/* A media-only automated message has no bubble to open, so
                            its marker rides the bubble line beside the hover time
                            instead. It stays visible either way. */}
                        {local.automated && bodyNode === null ? (
                            <span
                                className="happy2-message__automated happy2-message__automated--own"
                                data-happy-desktop-ui="message-automated"
                            >
                                <AutomatedTag />
                            </span>
                        ) : null}
                        <span
                            className="happy2-message__aside-time"
                            data-happy-desktop-ui="message-aside-time"
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
                        data-happy-desktop-ui="message-media"
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
                        data-happy-desktop-ui="message-attachments"
                    >
                        {attachments}
                    </div>
                ) : null}
                {local.reactions && local.reactions.length > 0 ? (
                    <div
                        className="happy2-message__reactions"
                        data-happy-desktop-ui="message-reactions"
                    >
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
    /** Bottom clearance represented inside the virtualizer's coordinate space. */
    paddingEnd?: number;
    /**
     * Height of row `index` at the list's current content width, computed from
     * the caller's own data rather than from the DOM. Every row is still
     * measured once it mounts; this is what sizes the ones nobody has scrolled
     * to yet, so the scrollbar tells the truth and reaching a row is not a
     * correction. Return `undefined` for a row whose height genuinely needs
     * layout — it falls back to the list's average measured row.
     */
    estimateRowSize?: (index: number, width: number) => number | undefined;
    /**
     * Converts the full scrollport width to the width rows actually occupy.
     * Centered, max-width content uses this so growing chrome beyond its readable
     * measure neither creates cache variants nor invalidates virtual estimates.
     */
    estimateRowWidth?: (scrollportWidth: number) => number;
    /** Rebuilds unmounted-row estimates when their non-width inputs change. */
    estimateVersion?: number;
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
    /** Effective row measure associated with `measurements`. */
    readonly rowWidth?: number;
    /** Measured virtual rows needed to interpret scrollTop after this list remounts. */
    readonly measurements?: readonly VirtualItem[];
}
/** A reader returning this close to the bottom (px) can resume following. */
const FOLLOW_BOTTOM_THRESHOLD = 8;
/** Transcript clearances represented inside the virtualizer's coordinate space. */
const MESSAGE_LIST_PADDING_START = 12;
const MESSAGE_LIST_PADDING_END_DEFAULT = 8;
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
function messageListRowWidth(
    scrollportWidth: number,
    estimate: MessageListProps["estimateRowWidth"],
): number {
    return estimate?.(scrollportWidth) ?? scrollportWidth;
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
    const estimateRowWidth = props.estimateRowWidth;
    /* The restore payload is read once, at mount. This list reports its own
       position back out, and an owner that stores it where a later render can
       read it would otherwise feed it back in mid-session — re-anchoring a list
       the reader is actively scrolling. Restoring is a lifetime event, and the
       lifetime boundary is the caller's `key`. */
    const restore = useRef(props.initialScrollPosition);
    const following = useRef(restore.current?.following ?? true);
    const escapedFromFollow = useRef(!(restore.current?.following ?? true));
    const measurements = useRef(restore.current?.measurements);
    const positionChange = useRef(props.onScrollPositionChange);
    positionChange.current = props.onScrollPositionChange;
    const estimateVersion = useRef(props.estimateVersion);
    const estimatedSize = useRef(averageMeasuredSize(restore.current?.measurements));
    const rowWidthModel = useRef(restore.current?.rowWidth ?? 0);
    const panelResizing = useRef(false);
    const panelResizePointerActive = useRef(false);
    const panelAnchor = useRef<
        | {
              readonly extent: number;
              readonly index: number;
              readonly key: Key;
              readonly node: Node;
              readonly offset: number;
              readonly row: HTMLElement;
              readonly viewportOffset: number;
          }
        | undefined
    >(undefined);
    const panelAnchorRestoring = useRef(false);
    const expectedScrollTop = useRef<number | undefined>(undefined);
    const scrollHeightBaseline = useRef(0);
    const scrollTopWrite = (element: HTMLElement, value: number) => {
        element.scrollTop = value;
        expectedScrollTop.current = element.scrollTop;
    };
    const entryItems = Children.toArray(props.children);
    const footerIndex = props.footer === undefined ? undefined : entryItems.length;
    const items =
        footerIndex === undefined
            ? entryItems
            : [
                  ...entryItems,
                  <div
                      className="happy2-message-list__footer"
                      data-happy-desktop-ui="message-list-footer"
                      data-item-id="working-status"
                      key={MESSAGE_LIST_FOOTER_KEY}
                  >
                      {props.footer}
                  </div>,
              ];
    const itemKeyAt = (index: number): Key => {
        const item = items[index];
        return isValidElement(item) && item.key !== null ? item.key : index;
    };
    const virtualized = props.virtualize === true;
    const paddingEnd = props.paddingEnd ?? MESSAGE_LIST_PADDING_END_DEFAULT;
    const panelAnchorCapture = () => {
        const element = list.current;
        panelAnchor.current = undefined;
        if (!element || following.current) return;
        const listRect = element.getBoundingClientRect();
        const x = listRect.left + listRect.width / 2;
        for (const inset of [8, 20, 32, 48, 72, 104]) {
            const position = document.caretPositionFromPoint?.(x, listRect.bottom - inset);
            if (!position || !element.contains(position.offsetNode)) continue;
            const owner =
                position.offsetNode instanceof Element
                    ? position.offsetNode
                    : position.offsetNode.parentElement;
            const row = owner?.closest<HTMLElement>(
                ".happy2-message-list__virtual-row[data-index]",
            );
            const index = Number.parseInt(row?.dataset.index ?? "", 10);
            if (!row || !Number.isFinite(index)) continue;
            const range = document.createRange();
            const textLength =
                position.offsetNode.nodeType === Node.TEXT_NODE
                    ? (position.offsetNode.textContent?.length ?? 0)
                    : 0;
            const offset =
                textLength > 0 ? Math.min(position.offset, textLength - 1) : position.offset;
            const extent = textLength > 0 ? 1 : 0;
            range.setStart(position.offsetNode, offset);
            if (extent > 0) range.setEnd(position.offsetNode, offset + extent);
            else range.collapse(true);
            const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
            if (!(rect.height > 0 || rect.width > 0)) continue;
            let key: Key = itemKeyAt(index);
            for (const [candidateKey, candidateRow] of virtualizer.elementsCache) {
                if (candidateRow !== row) continue;
                key = candidateKey;
                break;
            }
            panelAnchor.current = {
                extent,
                index,
                key,
                node: position.offsetNode,
                offset,
                row,
                viewportOffset: listRect.bottom - rect.top,
            };
            return;
        }
    };
    const panelAnchorRecapture = () => {
        const element = list.current;
        const anchor = panelAnchor.current;
        if (!element || !anchor?.row.isConnected) return false;
        const listRect = element.getBoundingClientRect();
        const position = document.caretPositionFromPoint?.(
            listRect.left + listRect.width / 2,
            listRect.bottom - anchor.viewportOffset,
        );
        if (!position || !anchor.row.contains(position.offsetNode)) return false;
        const range = document.createRange();
        const textLength =
            position.offsetNode.nodeType === Node.TEXT_NODE
                ? (position.offsetNode.textContent?.length ?? 0)
                : 0;
        const offset = textLength > 0 ? Math.min(position.offset, textLength - 1) : position.offset;
        const extent = textLength > 0 ? 1 : 0;
        range.setStart(position.offsetNode, offset);
        if (extent > 0) range.setEnd(position.offsetNode, offset + extent);
        else range.collapse(true);
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (!(rect.height > 0 || rect.width > 0)) return false;
        const rowIndex = Number.parseInt(anchor.row.dataset.index ?? "", 10);
        panelAnchor.current = {
            ...anchor,
            extent,
            index: Number.isFinite(rowIndex) ? rowIndex : anchor.index,
            node: position.offsetNode,
            offset,
        };
        return true;
    };
    const panelAnchorRestore = () => {
        const element = list.current;
        let anchor = panelAnchor.current;
        if (!element || !anchor || panelAnchorRestoring.current) return;
        if (!anchor.node.isConnected) {
            if (!panelAnchorRecapture()) {
                panelAnchor.current = undefined;
                return;
            }
            anchor = panelAnchor.current;
            if (!anchor) return;
        }
        const maximumOffset =
            anchor.node.nodeType === Node.TEXT_NODE
                ? (anchor.node.textContent?.length ?? 0)
                : anchor.node.childNodes.length;
        const range = document.createRange();
        const offset = Math.min(anchor.offset, Math.max(0, maximumOffset - anchor.extent));
        range.setStart(anchor.node, offset);
        if (anchor.extent > 0) range.setEnd(anchor.node, offset + anchor.extent);
        else range.collapse(true);
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (!(rect.height > 0 || rect.width > 0)) return;
        const target = element.getBoundingClientRect().bottom - anchor.viewportOffset;
        const delta = rect.top - target;
        if (Math.abs(delta) < 0.5) return;
        panelAnchorRestoring.current = true;
        scrollTopWrite(element, element.scrollTop + delta);
        panelAnchorRestoring.current = false;
    };
    const parkedItemSizeAdjustment = (item: VirtualItem) =>
        panelAnchor.current !== undefined &&
        !panelAnchor.current.node.isConnected &&
        item.end <= (list.current?.scrollTop ?? 0);
    const estimateItemSize = (index: number, rowWidth: number) =>
        index === footerIndex
            ? (props.footerHeight ?? estimatedSize.current)
            : (props.estimateRowSize?.(index, rowWidth) ?? estimatedSize.current);
    /**
     * Total height of every row, asking the caller's estimator for each one and
     * falling back to the measured average only where it declines to answer.
     * This is the offset a list opens at when it has no position to restore.
     */
    const estimatedContentHeight = () => {
        const rowWidth =
            list.current === null
                ? (restore.current?.rowWidth ?? 0)
                : messageListRowWidth(list.current.clientWidth, estimateRowWidth);
        let total = MESSAGE_LIST_PADDING_START + paddingEnd;
        for (let index = 0; index < items.length; index += 1)
            total += estimateItemSize(index, rowWidth);
        return total;
    };
    // TanStack Virtual deliberately owns mutable measurement functions; this leaf
    // remains outside compiler memoization while every rendered row stays eligible.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        /* Happy pins a true follower after TanStack publishes final geometry.
           Start anchoring keeps edge-key changes from independently moving a
           parked reader; the semantic bottom-edge anchor below owns that case. */
        anchorTo: "start",
        count: virtualized ? items.length : 0,
        /*
         * A measured row can change height without rendering MessageList.
         * Publish the new container height and row transforms synchronously
         * from TanStack's ResizeObserver, before the browser paints.
         */
        directDomUpdates: true,
        directDomUpdatesMode: "transform",
        /*
         * Offscreen estimates belong to one committed width generation. Reading
         * live clientWidth here would re-estimate every uncached row at every
         * pointer step when any mounted row reports its new height.
         */
        estimateSize: (index) => estimateItemSize(index, rowWidthModel.current),
        getItemKey: itemKeyAt,
        getScrollElement: () => list.current,
        /* Opening a conversation lands on its newest content, which means the
           first offset has to be the height of everything above it. Counting
           every row at the generic fallback got that badly wrong whenever real
           rows were taller — the list opened part way up its own history and
           then had to correct as rows measured — so the caller's own estimator
           answers for each row, exactly as it does for every later layout. */
        initialOffset: virtualized
            ? () => restore.current?.scrollTop ?? estimatedContentHeight()
            : 0,
        initialMeasurementsCache: restore.current?.measurements
            ? [...restore.current.measurements]
            : [],
        overscan: 12,
        /*
         * These are the same visual clearances the non-virtual list owns in CSS.
         * Keeping them here makes row starts, total size, scrollTop, anchoring,
         * and restored measurements use one coordinate system.
         */
        paddingEnd,
        paddingStart: MESSAGE_LIST_PADDING_START,
        onChange: (instance, sync) => {
            if (sync) return;
            if (following.current) {
                panelAnchor.current = undefined;
                instance.shouldAdjustScrollPositionOnItemSizeChange = undefined;
                const element = list.current;
                if (element) scrollTopWrite(element, element.scrollHeight - element.clientHeight);
                return;
            }
            if (panelAnchor.current) panelAnchorRestore();
            else panelAnchorCapture();
            instance.shouldAdjustScrollPositionOnItemSizeChange = parkedItemSizeAdjustment;
        },
        /*
         * Keep the parked glyph's stable item mounted even when history
         * prepends shift its numeric index outside TanStack's visible range.
         */
        rangeExtractor: (range) => {
            const drawn = defaultRangeExtractor(range);
            const anchor = panelAnchor.current;
            if (!anchor) return drawn;
            let index = itemKeyAt(anchor.index) === anchor.key ? anchor.index : undefined;
            if (index === undefined) {
                for (let candidate = 0; candidate < items.length; candidate += 1) {
                    if (itemKeyAt(candidate) !== anchor.key) continue;
                    index = candidate;
                    break;
                }
            }
            if (index === undefined || drawn.includes(index)) return drawn;
            return [...drawn, index].sort((left, right) => left - right);
        },
        useFlushSync: false,
    });
    // eslint-disable-next-line happy2-react/no-layout-effect -- streaming React commits change scrollHeight before the virtual row ResizeObserver; a follower must pin in this same pre-paint commit
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        if (following.current) scrollTopWrite(element, element.scrollHeight - element.clientHeight);
        else scrollHeightBaseline.current = element.scrollHeight;
    });
    // eslint-disable-next-line happy2-react/no-layout-effect -- the transcript owns live scroll position, ResizeObserver, and scroll listeners whose initial restoration and cleanup must align with the committed list DOM
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const scrollToBottom = () => {
            scrollTopWrite(element, element.scrollHeight - element.clientHeight);
        };
        const rowWidthCommit = (nextRowWidth: number) => {
            if (nextRowWidth === rowWidthModel.current) return;
            rowWidthModel.current = nextRowWidth;
            if (!virtualized) return;
            const mountedRows = [...virtualizer.elementsCache.values()].filter(
                (row) => row.isConnected,
            );
            virtualizer.measure();
            for (const row of mountedRows) {
                const index = virtualizer.indexFromElement(row);
                virtualizer.resizeItem(
                    index,
                    virtualizer.options.measureElement(row, undefined, virtualizer),
                );
            }
            panelAnchorRestore();
        };
        let resizeEndTimer: number | undefined;
        const resizeEndSchedule = () => {
            if (resizeEndTimer !== undefined) window.clearTimeout(resizeEndTimer);
            resizeEndTimer = window.setTimeout(onShellResizeEnd, 500);
        };
        const resizeTransactionBegin = () => {
            if (panelResizing.current) return;
            panelResizing.current = true;
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = parkedItemSizeAdjustment;
        };
        const onShellResizeStart = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : undefined;
            const handle = target?.closest('[data-happy-desktop-ui="app-shell-resize-handle"]');
            const shell = handle?.closest('[data-happy-desktop-ui="app-shell"]');
            if (!event.isPrimary || event.button !== 0 || !shell?.contains(element)) return;
            panelAnchorCapture();
            panelResizePointerActive.current = true;
            resizeTransactionBegin();
        };
        const onShellResizeEnd = () => {
            if (!panelResizing.current) return;
            if (resizeEndTimer !== undefined) window.clearTimeout(resizeEndTimer);
            resizeEndTimer = undefined;
            rowWidthCommit(messageListRowWidth(element.clientWidth, estimateRowWidth));
            panelAnchorRestore();
            panelResizePointerActive.current = false;
            panelResizing.current = false;
            if (!panelAnchor.current) panelAnchorCapture();
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = following.current
                ? undefined
                : parkedItemSizeAdjustment;
        };
        const onPointerResizeEnd = () => {
            if (panelResizePointerActive.current) onShellResizeEnd();
        };
        const onGeometryScrollIntent = () => {
            expectedScrollTop.current = undefined;
            if (!panelResizing.current || panelResizePointerActive.current) return;
            rowWidthCommit(messageListRowWidth(element.clientWidth, estimateRowWidth));
            if (resizeEndTimer !== undefined) window.clearTimeout(resizeEndTimer);
            resizeEndTimer = undefined;
            panelResizing.current = false;
            panelAnchor.current = undefined;
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
        };
        const onWheel = (event: WheelEvent) => {
            onGeometryScrollIntent();
            /*
             * The wheel precedes the browser's scroll event. Hand ownership to
             * the reader immediately so a streaming commit in the same frame
             * cannot pin them back to the tail before that scroll is reported.
             */
            if (event.deltaY < 0) {
                escapedFromFollow.current = true;
                following.current = false;
                virtualizer.shouldAdjustScrollPositionOnItemSizeChange = parkedItemSizeAdjustment;
            } else if (event.deltaY > 0) {
                const bottomOffset = Math.max(
                    0,
                    element.scrollHeight - element.scrollTop - element.clientHeight,
                );
                if (bottomOffset <= FOLLOW_BOTTOM_THRESHOLD) {
                    escapedFromFollow.current = false;
                    following.current = true;
                }
            }
        };
        const onScrollEnd = () => {
            if (!panelResizePointerActive.current) onShellResizeEnd();
        };
        const onVisibilityChange = () => {
            if (document.visibilityState !== "visible") onShellResizeEnd();
        };
        const onShellResizeLayout = (event: Event) => {
            const shell = event.target instanceof Element ? event.target : undefined;
            if (!shell?.contains(element)) return;
            resizeTransactionBegin();
            if (!panelResizePointerActive.current)
                rowWidthCommit(messageListRowWidth(element.clientWidth, estimateRowWidth));
            panelAnchorRestore();
            if (!panelResizePointerActive.current) resizeEndSchedule();
        };
        const onWindowResize = () => {
            resizeTransactionBegin();
            panelAnchorRestore();
            resizeEndSchedule();
        };
        window.addEventListener("lostpointercapture", onPointerResizeEnd);
        window.addEventListener("pointercancel", onPointerResizeEnd);
        window.addEventListener("pointerdown", onShellResizeStart);
        window.addEventListener("pointerup", onPointerResizeEnd);
        window.addEventListener("blur", onShellResizeEnd);
        window.addEventListener("resize", onWindowResize);
        window.addEventListener(APP_SHELL_RESIZE_LAYOUT_EVENT, onShellResizeLayout);
        document.addEventListener("visibilitychange", onVisibilityChange);
        let rowWidth = estimateRowWidth?.(element.clientWidth) ?? element.clientWidth;
        /* A first lifetime has no mounted ref or restored measure, so its virtual
           estimates begin at width zero. Rebuild them once at the committed
           width; later width changes take the same path through the observer. */
        if (virtualized && rowWidth !== rowWidthModel.current) rowWidthCommit(rowWidth);
        const savedScrollTop = restore.current?.scrollTop;
        if (following.current) scrollToBottom();
        else scrollTopWrite(element, savedScrollTop ?? 0);
        /*
         * TanStack can compensate newly measured rows after this layout effect.
         * A parked lifetime without a measurement cache still promises the
         * exact persisted pixel offset, so reapply it after those initial
         * measurements settle and before the next paint.
         */
        const restoreFrame =
            !following.current && savedScrollTop !== undefined
                ? requestAnimationFrame(() => {
                      scrollTopWrite(element, savedScrollTop);
                  })
                : undefined;
        panelAnchorCapture();
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = following.current
            ? undefined
            : parkedItemSizeAdjustment;
        const positionReport = (captureMeasurements = false) => {
            if (captureMeasurements && virtualized)
                measurements.current = virtualizer.takeSnapshot();
            positionChange.current?.({
                scrollTop: element.scrollTop,
                following: following.current,
                rowWidth: rowWidthModel.current,
                measurements: measurements.current,
            });
        };
        let viewportHeight = element.clientHeight;
        let previousScrollTop = element.scrollTop;
        scrollHeightBaseline.current = element.scrollHeight;
        const onScroll = () => {
            const currentScrollHeight = element.scrollHeight;
            const expected = expectedScrollTop.current;
            if (expected !== undefined && Math.abs(element.scrollTop - expected) <= 1) {
                expectedScrollTop.current = undefined;
                previousScrollTop = element.scrollTop;
                scrollHeightBaseline.current = currentScrollHeight;
                positionReport();
                return;
            }
            expectedScrollTop.current = undefined;
            /*
             * A growing viewport can clamp scrollTop before ResizeObserver runs.
             * Ignore that transient scroll event so it cannot replace the bottom
             * offset captured against the previous viewport height.
             */
            if (element.clientHeight !== viewportHeight) {
                previousScrollTop = element.scrollTop;
                scrollHeightBaseline.current = currentScrollHeight;
                return;
            }
            if (panelResizing.current) {
                panelAnchorRestore();
                previousScrollTop = element.scrollTop;
                scrollHeightBaseline.current = currentScrollHeight;
                positionReport();
                return;
            }
            const bottomOffset = Math.max(
                0,
                element.scrollHeight - element.scrollTop - viewportHeight,
            );
            const scrollDelta = element.scrollTop - previousScrollTop;
            const contentHeightChanged =
                Math.abs(currentScrollHeight - scrollHeightBaseline.current) > 1;
            previousScrollTop = element.scrollTop;
            scrollHeightBaseline.current = currentScrollHeight;
            if (scrollDelta < 0) escapedFromFollow.current = true;
            else if (
                scrollDelta > 0 &&
                !contentHeightChanged &&
                bottomOffset <= FOLLOW_BOTTOM_THRESHOLD
            )
                escapedFromFollow.current = false;
            following.current =
                !escapedFromFollow.current && bottomOffset <= FOLLOW_BOTTOM_THRESHOLD;
            if (following.current) {
                panelAnchor.current = undefined;
                virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
            } else {
                /*
                 * The scroll event is the user-ownership boundary. Capture the
                 * text now under their chosen bottom edge without writing
                 * scrollTop, so wheel, keyboard, and scrollbar movement always
                 * override an older geometry anchor immediately.
                 */
                panelAnchorCapture();
                virtualizer.shouldAdjustScrollPositionOnItemSizeChange = parkedItemSizeAdjustment;
            }
            positionReport();
        };
        element.addEventListener("scroll", onScroll, { passive: true });
        element.addEventListener("scrollend", onScrollEnd);
        element.addEventListener("pointerdown", onGeometryScrollIntent);
        element.addEventListener("touchstart", onGeometryScrollIntent, { passive: true });
        element.addEventListener("wheel", onWheel, { passive: true });
        /*
         * TanStack Virtual measures mounted rows through its own ResizeObserver
         * and owns their scroll compensation. A second mutation-driven measure
         * would create another geometry authority and visibly fight that
         * compensation while text streams. The unmeasured list alone needs a
         * DOM-growth watcher to remain pinned.
         */
        const observer = virtualized
            ? undefined
            : new MutationObserver(() => {
                  if (following.current) scrollToBottom();
              });
        observer?.observe(element, { characterData: true, childList: true, subtree: true });
        /*
         * The composer is a flex sibling of this scrollport. Once its committed
         * height changes, a reader who was following stays at the transcript
         * end; a reader parked in history keeps the same bottom-edge text
         * anchor. During a shell resize, that semantic anchor already owns the
         * correction; applying the ordinary height-delta write afterward would
         * compensate the same viewport change twice.
         */
        let viewportWindowWidth = window.innerWidth;
        let viewportWindowHeight = window.innerHeight;
        const viewportObserver =
            typeof ResizeObserver === "undefined"
                ? undefined
                : new ResizeObserver(() => {
                      const windowGeometryChanged =
                          window.innerWidth !== viewportWindowWidth ||
                          window.innerHeight !== viewportWindowHeight;
                      viewportWindowWidth = window.innerWidth;
                      viewportWindowHeight = window.innerHeight;
                      const nextRowWidth =
                          estimateRowWidth?.(element.clientWidth) ?? element.clientWidth;
                      const nextHeight = element.clientHeight;
                      if (nextRowWidth === rowWidth && nextHeight === viewportHeight) return;
                      const wasFollowing = following.current;
                      const previousHeight = viewportHeight;
                      const widthChanged = nextRowWidth !== rowWidth;
                      if (widthChanged) {
                          /*
                           * Mounted rows remeasure through TanStack's own
                           * ResizeObserver. Keep the measured offscreen rows
                           * intact until they enter the viewport: globally
                           * clearing that cache on every pointer step makes the
                           * whole transcript jump between estimates even though
                           * none of those rows is visible.
                           */
                          rowWidth = nextRowWidth;
                          if (!panelResizing.current) rowWidthCommit(nextRowWidth);
                      }
                      viewportHeight = nextHeight;
                      if (wasFollowing) scrollToBottom();
                      else if (
                          (panelResizing.current || windowGeometryChanged) &&
                          panelAnchor.current
                      )
                          panelAnchorRestore();
                      else if (nextHeight !== previousHeight)
                          scrollTopWrite(element, element.scrollTop + previousHeight - nextHeight);
                      positionReport();
                  });
        viewportObserver?.observe(element);
        return () => {
            if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
            positionReport(true);
            observer?.disconnect();
            viewportObserver?.disconnect();
            if (resizeEndTimer !== undefined) window.clearTimeout(resizeEndTimer);
            panelAnchor.current = undefined;
            expectedScrollTop.current = undefined;
            panelResizePointerActive.current = false;
            panelResizing.current = false;
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
            window.removeEventListener("lostpointercapture", onPointerResizeEnd);
            window.removeEventListener("pointercancel", onPointerResizeEnd);
            window.removeEventListener("pointerdown", onShellResizeStart);
            window.removeEventListener("pointerup", onPointerResizeEnd);
            window.removeEventListener("blur", onShellResizeEnd);
            window.removeEventListener("resize", onWindowResize);
            window.removeEventListener(APP_SHELL_RESIZE_LAYOUT_EVENT, onShellResizeLayout);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            element.removeEventListener("scroll", onScroll);
            element.removeEventListener("scrollend", onScrollEnd);
            element.removeEventListener("pointerdown", onGeometryScrollIntent);
            element.removeEventListener("touchstart", onGeometryScrollIntent);
            element.removeEventListener("wheel", onWheel);
        };
    }, [estimateRowWidth, virtualized, virtualizer]); // eslint-disable-line react-hooks/exhaustive-deps -- anchor helpers intentionally share this one imperative scrollport lifetime
    // eslint-disable-next-line happy2-react/no-layout-effect -- a new font generation changes offscreen row estimates without changing DOM geometry, so the virtualizer must discard its size cache after that generation commits
    useLayoutEffect(() => {
        if (estimateVersion.current === props.estimateVersion) return;
        estimateVersion.current = props.estimateVersion;
        if (virtualized) virtualizer.measure();
    }, [props.estimateVersion, virtualized, virtualizer]);
    return (
        <div
            className={["happy2-message-list", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="message-list"
            ref={list}
            style={props.style}
        >
            <div
                className="happy2-message-list__content"
                data-happy-desktop-ui="message-list-content"
                data-virtualized={virtualized ? "" : undefined}
            >
                <div
                    aria-hidden="true"
                    className="happy2-message-list__spacer"
                    data-happy-desktop-ui="message-list-spacer"
                />
                {virtualized ? (
                    <div
                        className="happy2-message-list__virtual"
                        data-happy-desktop-ui="message-list-virtual"
                        ref={virtualizer.containerRef}
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
            data-happy-desktop-ui="day-divider"
            role="separator"
        >
            <span className="happy2-day-divider__label" data-happy-desktop-ui="day-divider-label">
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
            data-happy-desktop-ui="system-notice"
            role="note"
            style={props.style}
        >
            <span
                aria-hidden="true"
                className="happy2-system-notice__icon"
                data-happy-desktop-ui="system-notice-icon"
            >
                <Icon name={props.icon ?? "users"} size={14} />
            </span>
            <span className="happy2-system-notice__text" data-happy-desktop-ui="system-notice-text">
                {segments.map((segment, index) =>
                    segment.kind === "ref" ? (
                        <span
                            className="happy2-system-notice__ref"
                            data-happy-desktop-ui="system-notice-ref"
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
            data-happy-desktop-ui="steering-notice"
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
                data-happy-desktop-ui="steering-notice-quote"
            >
                {props.quote}
            </blockquote>
        </div>
    );
}
