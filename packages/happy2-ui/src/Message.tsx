import { partitionComponentProps } from "./componentProps";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
    Children,
    isValidElement,
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type HTMLAttributes,
    type ReactNode,
} from "react";
import { Avatar, type AvatarSize, type ToneName } from "./Avatar";
import { happyLogoUrl } from "./assets";
import { AutomatedTag } from "./AutomatedTag";
import { ReactionChip } from "./Badge";
import { Button } from "./Button";
import { EmojiPicker, type EmojiItem } from "./EmojiPicker";
import { Icon, type IconName } from "./Icon";
import { renderMessageMarkdown, type MessageGenerationStatus } from "./MessageMarkdown";
import { Menu, type MenuItem } from "./Menu";
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
export type MessageDeliveryState = "failed" | "sending" | "sent";
export type MessageProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
    /** Keeps a backed toolbar visible without hover (controlled/blueprint state). */
    actionsVisible?: boolean;
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
    /** Real actions for the overflow menu. No menu button renders when empty. */
    menuItems?: MenuItem[];
    onMenuSelect?: (id: string) => void;
    /**
     * Native plugin message-menu contribution triggers rendered in the hover
     * action toolbar, supplied by the application (each owns its own invocation
     * state). Message-scoped, so the app binds each to this message's id.
     */
    contributions?: ReactNode;
    onReactionAdd?: () => void;
    onReactionSelect?: (emoji: string) => void;
    /**
     * The viewer's own outgoing message. Renders as a right-aligned accent
     * bubble with no avatar and no author name — only humans send, so an `own`
     * message is never also an `agent`. Incoming human messages (neither flag)
     * render as a left neutral bubble; agents render on the surface unbubbled.
     */
    own?: boolean;
    reactions?: MessageReaction[];
    /** Emoji available in the hover reaction picker. IDs are passed to `onReactionSelect`. */
    reactionOptions?: EmojiItem[];
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
        "actionsVisible",
        "audienceLabel",
        "automated",
        "author",
        "body",
        "children",
        "className",
        "compact",
        "contributions",
        "deliveryState",
        "generationStatus",
        "grouped",
        "gutterTime",
        "imageUrl",
        "images",
        "onImageOpen",
        "initials",
        "menuItems",
        "metaAccessory",
        "onAuthorSelect",
        "onMenuSelect",
        "onReactionAdd",
        "onReactionSelect",
        "own",
        "reactions",
        "reactionOptions",
        "style",
        "time",
        "tone",
    ]);
    const attachments = local.children;
    const [menuOpen, setMenuOpen] = useState(false);
    const [reactionOpen, setReactionOpen] = useState(false);
    const [reactionQuery, setReactionQuery] = useState("");
    const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
    const root = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const generationMarker = useRef<HTMLSpanElement>(null);
    const segments = (): MessageSegment[] =>
        typeof local.body === "string" ? [{ kind: "text", text: local.body }] : local.body;
    const isMarkdownBody = () => typeof local.body === "string";
    /* A string body renders as Markdown; recompiles only when the streamed text
       changes, so an in-place stream tick reuses the surrounding row and swaps
       just the body nodes. Generation status drives the caret/marker below, not
       the Markdown output. */
    const markdownBody = typeof local.body === "string" ? renderMessageMarkdown(local.body) : null;
    const hasAttachments = () => hasRenderableChild(attachments);
    const grouped = () => local.grouped || local.compact;
    const showIncomingIdentity = () => !local.own && !grouped();
    /* A grouped follow-up still needs its meta row when it carries an accessory —
       the trace control of a turn lives there — but the run's identity was
       already established by the message that opened it, so the row holds the
       accessory alone: no avatar, no repeated name, no second timestamp. */
    const showIncomingMeta = () => !local.own && (!grouped() || Boolean(local.metaAccessory));
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
    const hasReactionAction = () =>
        Boolean(local.onReactionAdd) ||
        Boolean(local.onReactionSelect && local.reactionOptions?.length);
    const hasMenuAction = () =>
        Boolean(local.onMenuSelect) &&
        Boolean(local.menuItems?.some((item) => item.kind === "item"));
    const hasContributions = () => hasRenderableChild(local.contributions);
    const hasActions = () =>
        deliveryState() !== "sending" &&
        (hasReactionAction() || hasMenuAction() || hasContributions());
    const filteredReactionOptions = () => {
        const query = reactionQuery.trim().toLocaleLowerCase();
        if (!query) return local.reactionOptions ?? [];
        return (local.reactionOptions ?? []).filter((emoji) =>
            emoji.name.toLocaleLowerCase().includes(query),
        );
    };
    const menuOpenSet = (open: boolean) => {
        setMenuOpen(open);
    };
    const reactionOpenSet = (open: boolean) => {
        setReactionOpen(open);
    };
    const closePopovers = useCallback(() => {
        menuOpenSet(false);
        reactionOpenSet(false);
    }, []);
    const menuHeight = () =>
        12 +
        (local.menuItems ?? []).reduce((height, item) => {
            if (item.kind === "item") return height + 32;
            if (item.kind === "label") return height + 24;
            return height + 11;
        }, 0);
    const placePopover = (width: number, height: number) => {
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds) return;
        const edge = 8;
        const left = Math.max(edge, Math.min(bounds.right - 20 - width, innerWidth - width - edge));
        const below = bounds.top + 40;
        const above = bounds.top - height - 4;
        const top =
            below + height <= innerHeight - edge
                ? below
                : above >= edge
                  ? above
                  : Math.max(edge, innerHeight - height - edge);
        setPopoverStyle({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    };
    const toggleReactionPicker = () => {
        menuOpenSet(false);
        if (local.reactionOptions?.length) {
            placePopover(234, 62 + Math.ceil(local.reactionOptions.length / 6) * 36);
            setReactionOpen((open) => !open);
            setReactionQuery("");
        }
        local.onReactionAdd?.();
    };
    useLayoutEffect(() => {
        if (!menuOpen && !reactionOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) {
                closePopovers();
            }
        };
        const onViewportChange = () => {
            closePopovers();
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("scroll", onViewportChange, true);
        window.addEventListener("resize", onViewportChange);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("scroll", onViewportChange, true);
            window.removeEventListener("resize", onViewportChange);
        };
    }, [closePopovers, menuOpen, reactionOpen]);
    /* The live cursor is painted at the end of the final rendered text run. It
       stays absolutely positioned so neither a generation-state update nor a
       streamed text tick can alter the message's flow geometry. */
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
    const bodyNode =
        !local.body && local.generationStatus === undefined ? null : isMarkdownBody() ? (
            <div
                className="happy2-message__body happy2-message__body--markdown"
                data-markdown=""
                data-happy2-ui="message-body"
                ref={body}
            >
                {ownAutomatedLine}
                {markdownBody}
                {/* An empty generated reply keeps a non-breaking-space line box
                    after completion. The visible stream cursor can therefore
                    disappear without collapsing the message row. */}
                {!local.body && local.generationStatus !== undefined ? (
                    <p aria-hidden="true" className="happy2-message__generation-anchor">
                        {"\u00a0"}
                    </p>
                ) : null}
                {local.generationStatus === "streaming" || local.generationStatus === "failed" ? (
                    <span
                        aria-hidden={local.generationStatus === "failed" ? undefined : true}
                        aria-label={
                            local.generationStatus === "failed" ? "Generation failed" : undefined
                        }
                        className="happy2-message__generation-marker"
                        data-empty={!local.body ? "" : undefined}
                        data-generation-marker={local.generationStatus}
                        data-happy2-ui={
                            local.generationStatus === "streaming"
                                ? "message-stream-caret"
                                : "message-generation-failed"
                        }
                        ref={generationMarker}
                        role={local.generationStatus === "failed" ? "img" : undefined}
                    />
                ) : null}
            </div>
        ) : (
            <div className="happy2-message__body" data-happy2-ui="message-body">
                {ownAutomatedLine}
                {segments().map((segment, index) => (
                    <span key={`${segment.kind}-${index}`}>{renderSegment(segment)}</span>
                ))}
            </div>
        );
    // An own attachment/image-only automated message still needs the durable
    // attribution marker. Normal media remains flush: this line exists only
    // when automation requires it, never for ordinary media-only messages.
    const ownBubbleLine =
        local.own &&
        (bodyNode !== null ||
            (local.automated && (Boolean(local.images?.length) || hasAttachments())));
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
                    {local.author}
                </button>
            ) : (
                <span className="happy2-message__author" data-happy2-ui="message-author">
                    {local.author}
                </span>
            )}
            {local.automated && showIncomingIdentity() ? (
                <span className="happy2-message__automated" data-happy2-ui="message-automated">
                    <AutomatedTag />
                </span>
            ) : null}
            {local.metaAccessory ? (
                <span
                    className="happy2-message__meta-accessory"
                    data-happy2-ui="message-meta-accessory"
                >
                    {local.metaAccessory}
                </span>
            ) : null}
            {showIncomingIdentity() ? (
                <span className="happy2-message__time" data-happy2-ui="message-time">
                    {local.time ?? ""}
                </span>
            ) : null}
        </div>
    ) : null;
    return (
        <div
            {...rest}
            className={["happy2-message", local.className].filter(Boolean).join(" ")}
            data-agent={local.agent ? "" : undefined}
            data-own={local.own ? "" : undefined}
            data-actions-visible={local.actionsVisible ? "" : undefined}
            data-compact={grouped() ? "" : undefined}
            data-delivery-state={deliveryState()}
            data-generation-status={local.generationStatus}
            data-grouped={grouped() ? "" : undefined}
            data-has-actions={hasActions() ? "" : undefined}
            data-has-body={local.body ? "" : undefined}
            data-happy2-ui="message"
            aria-busy={
                deliveryState() === "sending" || local.generationStatus === "streaming"
                    ? "true"
                    : undefined
            }
            onKeyDown={(event) => {
                if (event.key === "Escape") closePopovers();
            }}
            ref={root}
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
                    bodyNode
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
                        {hasReactionAction() ? (
                            <button
                                aria-expanded={reactionOpen}
                                aria-haspopup={local.reactionOptions?.length ? "dialog" : undefined}
                                aria-label="Add reaction"
                                className="happy2-message__react-add"
                                data-happy2-ui="message-react-add"
                                onClick={toggleReactionPicker}
                                type="button"
                            >
                                <Icon name="smile" size={14} />
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {hasActions() ? (
                <>
                    <div className="happy2-message__actions" data-happy2-ui="message-actions">
                        {hasReactionAction() ? (
                            <Button
                                aria-expanded={reactionOpen}
                                aria-haspopup={local.reactionOptions?.length ? "dialog" : undefined}
                                aria-label="Add reaction"
                                className="happy2-message__action"
                                icon="smile"
                                iconOnly
                                onClick={toggleReactionPicker}
                                size="small"
                                variant="ghost"
                            />
                        ) : null}
                        {hasMenuAction() ? (
                            <Button
                                aria-expanded={menuOpen}
                                aria-haspopup="menu"
                                aria-label="More message actions"
                                className="happy2-message__action"
                                icon="more"
                                iconOnly
                                onClick={() => {
                                    reactionOpenSet(false);
                                    placePopover(196, menuHeight());
                                    menuOpenSet(!menuOpen);
                                }}
                                size="small"
                                variant="ghost"
                            />
                        ) : null}
                        {hasContributions() ? (
                            <span
                                className="happy2-message__contributions"
                                data-happy2-ui="message-contributions"
                            >
                                {local.contributions}
                            </span>
                        ) : null}
                    </div>
                    {reactionOpen && local.reactionOptions?.length ? (
                        <div
                            className="happy2-message__popover happy2-message__popover--reaction"
                            data-happy2-ui="message-reaction-popover"
                            style={popoverStyle}
                        >
                            <EmojiPicker
                                columns={6}
                                emoji={filteredReactionOptions()}
                                onQueryChange={setReactionQuery}
                                onSelect={(id) => {
                                    local.onReactionSelect?.(id);
                                    closePopovers();
                                }}
                                query={reactionQuery}
                            />
                        </div>
                    ) : null}
                    {menuOpen && local.menuItems
                        ? ((items) => (
                              <div
                                  className="happy2-message__popover happy2-message__popover--menu"
                                  data-happy2-ui="message-menu-popover"
                                  style={popoverStyle}
                              >
                                  <Menu
                                      items={items}
                                      onSelect={(id) => {
                                          local.onMenuSelect?.(id);
                                          closePopovers();
                                      }}
                                      width={196}
                                  />
                              </div>
                          ))(menuOpen && local.menuItems)
                        : null}
                </>
            ) : null}
        </div>
    );
}
export type MessageListProps = {
    children: ReactNode;
    className?: string;
    /**
     * A row pinned to the end of the list's content, below the last message and
     * inside the clearance the surface reserves there. It is part of the
     * scrolled content, not an overlay, so it follows the newest message the way
     * the transcript does and adds no height of its own.
     */
    footer?: ReactNode;
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
/** Row height assumed before anything has ever been measured. */
const ROW_SIZE_FALLBACK = 72;
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
    const estimatedSize = useRef(averageMeasuredSize(restore.current?.measurements));
    const items = Children.toArray(props.children);
    const virtualized = props.virtualize === true;
    // TanStack Virtual deliberately owns mutable measurement functions; this leaf
    // remains outside compiler memoization while every rendered row stays eligible.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        /* Chat anchoring is the virtualizer's job, not the DOM's. `end` keeps the
           row under the reader pinned when a row above it settles to its real
           height — a bubble's Markdown, code block, or image resolving after
           mount no longer shoves the text they are reading. `followOnAppend`
           re-pins the bottom on a new message, but only for a reader who was
           already there. Both replace hand-written `scrollTop` writes, which ran
           after the virtualizer's own offset compensation and cancelled it. */
        anchorTo: "end",
        count: virtualized ? items.length : 0,
        estimateSize: (index) =>
            props.estimateRowSize?.(index, list.current?.clientWidth ?? 0) ?? estimatedSize.current,
        followOnAppend: true,
        getItemKey: (index) => {
            const item = items[index];
            return isValidElement(item) && item.key !== null ? item.key : index;
        },
        getScrollElement: () => list.current,
        initialOffset: virtualized
            ? (restore.current?.scrollTop ?? items.length * estimatedSize.current)
            : 0,
        initialMeasurementsCache: restore.current?.measurements
            ? [...restore.current.measurements]
            : [],
        overscan: 12,
        /* Same "still following" tolerance the scroll listener applies, so a
           reader parked one subpixel off the bottom is treated identically by
           the virtualizer's append-follow and by this component's reporting. */
        scrollEndThreshold: FOLLOW_BOTTOM_THRESHOLD,
        useFlushSync: false,
    });
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
        const onScroll = () => {
            following.current =
                element.scrollHeight - element.scrollTop - element.clientHeight <=
                FOLLOW_BOTTOM_THRESHOLD;
            positionReport();
        };
        element.addEventListener("scroll", onScroll, { passive: true });
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
        return () => {
            if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
            positionReport(true);
            observer?.disconnect();
            element.removeEventListener("scroll", onScroll);
        };
    }, [virtualized, virtualizer]);
    useLayoutEffect(() => {
        // A virtualized list follows appended rows through `followOnAppend`,
        // which anchors on the measured last row instead of an estimated one.
        if (virtualized || !following.current) return;
        scrollToBottom();
    }, [items.length, virtualized]);
    return (
        <div
            className={["happy2-message-list", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="message-list"
            ref={list}
            style={props.style}
        >
            <div className="happy2-message-list__content" data-happy2-ui="message-list-content">
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
                                key={virtualItem.key}
                                ref={virtualizer.measureElement}
                                style={{ transform: `translateY(${virtualItem.start}px)` }}
                            >
                                {items[virtualItem.index]}
                            </div>
                        ))}
                    </div>
                ) : (
                    props.children
                )}
                {props.footer !== undefined ? (
                    <div
                        className="happy2-message-list__footer"
                        data-happy2-ui="message-list-footer"
                    >
                        {props.footer}
                    </div>
                ) : null}
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
