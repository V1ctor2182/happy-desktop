import { partitionComponentProps } from "./componentProps";
import {
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type HTMLAttributes,
    type MouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { Avatar, type ToneName } from "./Avatar";
import { haptic } from "./haptics";
import { CountBadge } from "./Badge";
import { Button } from "./Button";
import { happyLogoUrl } from "./assets";
import { Icon, type IconName } from "./Icon";
import { PluginAssetGlyph } from "./PluginAssetGlyph";
import { Menu, type MenuItem } from "./Menu";
import { Spinner } from "./Spinner";
export type SidebarItem = {
    /** Marks a row as archived; the row keeps its position but paints muted. */
    archived?: boolean;
    badge?: number;
    /** Git line totals painted as a compact green/red diff pair. */
    changeStats?: {
        added: number;
        deleted: number;
    };
    /** Nesting level. `0`/absent is top level; each level adds `SIDEBAR_ROW_INDENT` of left inset. */
    depth?: number;
    /** The row's glyph. A `person`/`agent`/`project` row paints it inside the avatar tile. */
    icon?: IconName;
    id: string;
    imageUrl?: string;
    initials?: string;
    kind: "view" | "channel" | "workspace" | "project" | "person" | "agent" | "action" | "app";
    label: string;
    /**
     * A same-origin blob URL for an authenticated monochrome asset (e.g. a plugin
     * app's 40×40 PNG). When present, the leading slot paints it as a
     * `currentColor` mask instead of an `Icon`/`Avatar`. The caller owns the URL.
     */
    maskUrl?: string;
    meta?: string;
    /**
     * A control at the trailing edge of the row, reported through
     * `onItemAction`. `reveal: "hover"` keeps it out of the way until the row is
     * hovered or the control is focused, for something destructive; the default
     * keeps it visible, for something the row is offering.
     */
    action?: {
        icon: IconName;
        label: string;
        reveal?: "hover";
    };
    online?: boolean;
    /**
     * `working` spins in the leading slot; `waiting` shows a highlighted clock
     * there instead — the row's agent is inside a scheduled wait, deliberately
     * doing nothing. Waiting is the lower-priority state: a row whose sessions
     * do real work reports `working`.
     */
    status?: "ready" | "working" | "waiting";
    tone?: ToneName;
    unread?: boolean;
};
/** Left inset of the row content at depth 0 (matches the CSS `padding-left`). */
export const SIDEBAR_ROW_PADDING_X = 10;
/** Additional left inset applied per nesting level so children sit under their parent. */
export const SIDEBAR_ROW_INDENT = 16;
export type SidebarSection = {
    action?: {
        icon: IconName;
        label: string;
    };
    empty?: {
        actionLabel: string;
        description: string;
        icon?: IconName;
        title?: string;
    };
    id: string;
    /** Renders only the labeled action row, useful as a hierarchy heading. */
    headingOnly?: boolean;
    items: SidebarItem[];
    label?: string;
};
/**
 * The one move a reorder drag made: the row that travelled and the row it now
 * follows among the peers it was dragged between, `null` when it landed first.
 *
 * A move is reported rather than a rearranged list of ids because only the
 * sidebar knows which rows the drag was actually moving — the top-level blocks,
 * or one row's children — and a durable order is stated as one row relative to
 * one neighbour anyway. Recovering that from a restated arrangement means
 * guessing which list it belongs to, and guessing wrong silently drops the drop.
 */
export interface SidebarReorder {
    readonly id: string;
    readonly afterId: string | null;
    /** Set when the drag rearranged one row's children rather than the top level. */
    readonly parentId?: string;
}
export type SidebarProps = Omit<HTMLAttributes<HTMLElement>, "style"> & {
    activeItemId: string;
    /**
     * Pinned rows beneath the compose row, for the few acts that belong to the
     * window rather than to any one row in the list. They are reported through
     * `onItemSelect` like any other row and are never active.
     */
    actions?: SidebarItem[];
    /** Agent-authored menu content between the pinned actions and project sections. */
    bodyAccessory?: ReactNode;
    /**
     * Renders the product lockup — the logo and the word "Happy" — instead of a
     * custom title row.
     */
    brand?: boolean;
    composeLabel?: string;
    footer?: ReactNode;
    /** Stable product context rendered between the 56px heading and scrollport. */
    headerAccessory?: ReactNode;
    /**
     * Drill-down mode: replaces the brand/title heading with a back button to
     * the left of `title`, and animates the body in. Use for a pushed detail
     * level such as the administration sub-navigation.
     */
    onBack?: () => void;
    onCompose?: () => void;
    /** Returns the context-menu actions available for one row. Empty means no menu. */
    itemMenuItems?: (item: SidebarItem) => MenuItem[];
    onItemMenuSelect?: (item: SidebarItem, actionId: string) => void;
    onItemSelect: (id: string) => void;
    /** Invoked when a row's trailing `action` control is used. */
    onItemAction?: (id: string) => void;
    /**
     * Enables dragging rows into a different order and reports the one move a
     * drag made, on release. A top-level row carries its nested rows with it; a
     * nested row travels among its siblings inside its own parent and never
     * leaves it. Without this the rows are not draggable and nothing about them
     * changes.
     */
    onItemReorder?: (sectionId: string, move: SidebarReorder) => void;
    onSectionAction?: (sectionId: string) => void;
    sections: SidebarSection[];
    style?: CSSProperties;
    subtitle?: string;
    title?: string;
};
function leadingIcon(item: SidebarItem): IconName {
    if (item.kind === "workspace") return item.icon ?? "branch";
    if (item.kind === "channel") return item.icon ?? "hash";
    if (item.kind === "action") return item.icon ?? "plus";
    return item.icon ?? "inbox";
}
/**
 * Nested rows are introduced by an ASCII branch instead of repeating the parent's
 * glyph, so the hash only ever marks a top-level channel. A row keeps an explicitly
 * supplied icon (a private channel's lock, say) because that carries information the
 * branch cannot.
 */
function showsLeadingSlot(item: SidebarItem): boolean {
    if ((item.depth ?? 0) === 0) return true;
    if (item.kind === "workspace") return true;
    if (
        item.kind === "person" ||
        item.kind === "agent" ||
        item.kind === "project" ||
        item.kind === "app"
    )
        return true;
    return item.icon !== undefined;
}
/** `true` when no later sibling sits at this row's depth before the group closes. */
function isLastAtDepth(items: readonly SidebarItem[], index: number): boolean {
    const depth = items[index]!.depth ?? 0;
    for (let next = index + 1; next < items.length; next += 1) {
        const nextDepth = items[next]!.depth ?? 0;
        if (nextDepth < depth) return true;
        if (nextDepth === depth) return false;
    }
    return true;
}
/** `true` for the first row at its depth, whose stem rises to meet the parent glyph. */
function isFirstAtDepth(items: readonly SidebarItem[], index: number): boolean {
    return (items[index - 1]?.depth ?? 0) < (items[index]!.depth ?? 0);
}

/** Pointer travel, in px, before a press becomes a drag instead of a selection. */
const DRAG_THRESHOLD = 4;

/** True when the reader asked for no motion, so a drop lands instead of gliding. */
function reducedMotion(): boolean {
    return (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/** How long a dropped row takes to travel from where it was to where it now is. */
const SETTLE_MS = 160;
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/**
 * How long a drop holds the geometry it captured while it waits for the render
 * that rearranges the rows. Long enough for a reorder to come back through the
 * store, short enough that a move which never lands lets the row go rather than
 * leaving it lit and replaying it much later from coordinates that have expired.
 */
const SETTLE_WAIT_MS = 500;

interface SidebarDrag {
    readonly pointerId: number;
    readonly startY: number;
    readonly deltaY: number;
    /** Index into `units`, not into `items`. */
    readonly from: number;
    readonly to: number;
    /** The rows each unit holds, so a unit that spans several rows moves as one. */
    readonly units: readonly (readonly number[])[];
    /**
     * The id of each unit, in the order they stood in when the drag began. The
     * move is read from these rather than from the rows at the drop, because a
     * live workspace keeps adding and removing rows: an arrival mid-drag shifts
     * every index the drag captured, and reading the drop through those indices
     * would report a different row, or no move at all.
     */
    readonly peers: readonly string[];
    readonly heights: readonly number[];
    /** Set when the drag rearranges one row's children rather than the top level. */
    readonly parentId?: string;
    /** False until the pointer passes the threshold, so a click still selects. */
    readonly moved: boolean;
}

/**
 * The rows grouped into the units a drag moves: each top-level row followed by
 * the nested rows that belong to it. A project and the worktrees listed under it
 * are one thing on screen, so they travel together and a drag can never leave a
 * child stranded under a different parent.
 */
function blocksOf(items: readonly SidebarItem[]): readonly (readonly number[])[] {
    const blocks: number[][] = [];
    items.forEach((item, index) => {
        if ((item.depth ?? 0) === 0 || blocks.length === 0) blocks.push([index]);
        else blocks[blocks.length - 1]!.push(index);
    });
    return blocks;
}

/**
 * The single move that turns `before` into `after`: the row that travelled and
 * the row it now follows (null at the front). For a control that reports a whole
 * rearranged list, such as a tab strip, where a durable order is stated as one
 * row moving relative to one neighbour — so the move is recovered by finding the
 * row whose removal makes the two orders identical. Two rows swapping places
 * yields either of them, and placing either one produces the arrangement that
 * was dragged.
 */
export function sidebarReorderMove(
    before: readonly string[],
    after: readonly string[],
): { readonly id: string; readonly afterId: string | null } | undefined {
    for (const id of after) {
        const withoutBefore = before.filter((candidate) => candidate !== id);
        const withoutAfter = after.filter((candidate) => candidate !== id);
        if (withoutBefore.every((candidate, index) => candidate === withoutAfter[index])) {
            const index = after.indexOf(id);
            return { id, afterId: index === 0 ? null : after[index - 1]! };
        }
    }
    return undefined;
}

/**
 * What a drag starting on `index` rearranges, and among which peers. Dragging a
 * top-level row rearranges the top level, each row carrying its children;
 * dragging a nested row rearranges that row's siblings inside their own parent,
 * so a worktree can be ordered within its project but never dragged out of it.
 */
function dragUnitsOf(
    items: readonly SidebarItem[],
    index: number,
): { units: readonly (readonly number[])[]; parentId?: string } {
    const blocks = blocksOf(items);
    if ((items[index]?.depth ?? 0) === 0) return { units: blocks };
    const block = blocks.find((candidate) => candidate.includes(index)) ?? [];
    const parent = items[block[0]!];
    const depth = items[index]!.depth ?? 0;
    const siblings = block.filter((row) => row !== block[0] && (items[row]?.depth ?? 0) === depth);
    return {
        units: siblings.map((row) => [row]),
        ...(parent ? { parentId: parent.id } : {}),
    };
}

/** Where the dragged block lands: each neighbour it has passed by half that neighbour's height. */
function dragTargetIndex(drag: SidebarDrag, deltaY: number): number {
    let index = drag.from;
    let travel = deltaY;
    while (travel > 0 && index < drag.heights.length - 1) {
        const next = drag.heights[index + 1]!;
        if (travel <= next / 2) break;
        travel -= next;
        index += 1;
    }
    while (travel < 0 && index > 0) {
        const previous = drag.heights[index - 1]!;
        if (-travel <= previous / 2) break;
        travel += previous;
        index -= 1;
    }
    return index;
}

/**
 * How far a block slides while another is dragged across it: every block between
 * the drag's origin and its target steps aside by exactly the dragged block's
 * height, which is what makes the gap follow the pointer.
 */
function blockShift(drag: SidebarDrag, index: number): number {
    if (index === drag.from) return 0;
    const height = drag.heights[drag.from] ?? 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -height;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return height;
    return 0;
}

function SidebarItemAction(props: {
    action: NonNullable<SidebarItem["action"]>;
    onAction: () => void;
}) {
    return (
        /* A `span` because the row itself is the button: nesting one button
           inside another is invalid, and this control must sit inside the row
           so it tracks the row's hover. */
        <span
            aria-label={props.action.label}
            className="happy2-sidebar__item-action"
            data-happy2-ui="sidebar-item-action"
            data-reveal={props.action.reveal}
            onClick={(event) => {
                event.stopPropagation();
                props.onAction();
            }}
            onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                props.onAction();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            role="button"
            tabIndex={0}
        >
            <Icon name={props.action.icon} size={12} />
        </span>
    );
}

function SidebarRow({
    nodeRef,
    ...props
}: {
    active: boolean;
    /** Renders the ASCII tree connector that ties a nested row to its parent. */
    branch?: "tee" | "end";
    /** Extends this row's stem up into the parent row, under its glyph. */
    branchFirst?: boolean;
    className?: string;
    /** Set only while a reorder drag is live, so a static sidebar is untouched. */
    dragging?: boolean;
    item: SidebarItem;
    onContextMenu?: (item: SidebarItem, event: MouseEvent<HTMLButtonElement>) => void;
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    /** Registers the live node so a drop can measure and animate this row. */
    nodeRef?: (node: HTMLButtonElement | null) => void;
    /** Invoked by the row's trailing control; absent when the row offers none. */
    onAction?: () => void;
    onSelect: (id: string) => void;
    shift?: number;
}) {
    const item = () => props.item;
    const unread = () => item().unread === true;
    const unreadOnLeading = () =>
        unread() && (item().kind === "project" || item().kind === "workspace");
    const mentioned = () => (item().badge ?? 0) > 0;
    const hasChangeStats = () =>
        (item().changeStats?.added ?? 0) > 0 || (item().changeStats?.deleted ?? 0) > 0;
    const swapsTrailing = () =>
        hasChangeStats() && item().action?.reveal === "hover" && props.onAction !== undefined;
    const depth = () => Math.max(0, item().depth ?? 0);
    const showStatus = () =>
        item().kind === "agent" && item().status !== undefined && !unread() && !mentioned();
    const showMeta = () => item().meta !== undefined && !unread() && !mentioned() && !showStatus();
    return (
        <button
            aria-current={props.active ? "page" : undefined}
            className={["happy2-sidebar__item", props.className].filter(Boolean).join(" ")}
            data-active={props.active ? "" : undefined}
            data-archived={item().archived ? "" : undefined}
            data-depth={depth() > 0 ? String(depth()) : undefined}
            data-item-id={item().id}
            data-kind={item().kind}
            data-mentioned={mentioned() ? "" : undefined}
            data-happy2-ui="sidebar-item"
            data-status={item().status}
            data-unread={unread() ? "" : undefined}
            data-dragging={props.dragging ? "" : undefined}
            onClick={() => props.onSelect(item().id)}
            onContextMenu={(event) => props.onContextMenu?.(item(), event)}
            onPointerDown={props.onPointerDown}
            onPointerMove={props.onPointerMove}
            onPointerCancel={props.onPointerUp}
            onPointerUp={props.onPointerUp}
            ref={nodeRef}
            style={{
                ...(depth() > 0
                    ? { paddingLeft: SIDEBAR_ROW_PADDING_X + depth() * SIDEBAR_ROW_INDENT }
                    : {}),
                ...(props.shift ? { transform: `translateY(${String(props.shift)}px)` } : {}),
            }}
            type="button"
        >
            {props.branch ? (
                <span
                    aria-hidden="true"
                    className="happy2-sidebar__item-branch"
                    data-branch={props.branch}
                    data-branch-first={props.branchFirst ? "" : undefined}
                    data-happy2-ui="sidebar-item-branch"
                />
            ) : null}
            {showsLeadingSlot(item()) ? (
                <span
                    className="happy2-sidebar__item-leading"
                    data-happy2-ui="sidebar-item-leading"
                >
                    {(item().kind === "workspace" || item().kind === "project") &&
                    item().status === "working" ? (
                        <Spinner label={`${item().label} is working`} size={14} tone="muted" />
                    ) : (item().kind === "workspace" || item().kind === "project") &&
                      item().status === "waiting" ? (
                        <span
                            aria-label={`${item().label} is waiting`}
                            className="happy2-sidebar__item-waiting"
                            data-happy2-ui="sidebar-item-waiting"
                            role="img"
                        >
                            <Icon name="clock" size={14} />
                        </span>
                    ) : item().kind === "person" ||
                      item().kind === "agent" ||
                      item().kind === "project" ? (
                        <Avatar
                            icon={item().icon}
                            imageUrl={item().imageUrl}
                            initials={item().initials ?? item().label.slice(0, 1).toUpperCase()}
                            online={item().kind === "person" ? item().online : undefined}
                            size="xs"
                            tone={item().tone}
                            type={
                                item().kind === "agent" || item().kind === "project"
                                    ? "agent"
                                    : "human"
                            }
                        />
                    ) : item().kind === "app" ? (
                        <PluginAssetGlyph
                            fallbackIcon={item().icon ?? "spark"}
                            maskUrl={item().maskUrl}
                            size={16}
                        />
                    ) : (
                        <Icon name={leadingIcon(item())} size={16} />
                    )}
                    {unreadOnLeading() ? (
                        <span
                            aria-label="Unread activity"
                            className="happy2-sidebar__item-leading-unread"
                            data-happy2-ui="sidebar-item-leading-unread"
                        />
                    ) : null}
                </span>
            ) : null}
            <span className="happy2-sidebar__item-label" data-happy2-ui="sidebar-item-label">
                {item().label}
            </span>
            {unread() && !unreadOnLeading() && !mentioned() ? (
                <span
                    aria-label="Unread"
                    className="happy2-sidebar__item-unread"
                    data-happy2-ui="sidebar-item-unread"
                />
            ) : null}
            {mentioned() ? (
                <CountBadge className="happy2-sidebar__item-badge" count={item().badge!} />
            ) : null}
            {swapsTrailing()
                ? ((stats) => (
                      <span
                          className="happy2-sidebar__item-trailing-swap"
                          data-happy2-ui="sidebar-item-trailing-swap"
                      >
                          <span
                              aria-label={[
                                  stats.added > 0
                                      ? `${String(stats.added)} lines added`
                                      : undefined,
                                  stats.deleted > 0
                                      ? `${String(stats.deleted)} lines deleted`
                                      : undefined,
                              ]
                                  .filter(Boolean)
                                  .join(", ")}
                              className="happy2-sidebar__item-change-stats"
                              data-happy2-ui="sidebar-item-change-stats"
                          >
                              {stats.added > 0 ? (
                                  <span data-tone="added">+{stats.added}</span>
                              ) : null}
                              {stats.deleted > 0 ? (
                                  <span data-tone="deleted">−{stats.deleted}</span>
                              ) : null}
                          </span>
                          <SidebarItemAction action={item().action!} onAction={props.onAction!} />
                      </span>
                  ))(item().changeStats!)
                : hasChangeStats()
                  ? ((stats) => (
                        <span
                            aria-label={[
                                stats.added > 0 ? `${String(stats.added)} lines added` : undefined,
                                stats.deleted > 0
                                    ? `${String(stats.deleted)} lines deleted`
                                    : undefined,
                            ]
                                .filter(Boolean)
                                .join(", ")}
                            className="happy2-sidebar__item-change-stats"
                            data-happy2-ui="sidebar-item-change-stats"
                        >
                            {stats.added > 0 ? <span data-tone="added">+{stats.added}</span> : null}
                            {stats.deleted > 0 ? (
                                <span data-tone="deleted">−{stats.deleted}</span>
                            ) : null}
                        </span>
                    ))(item().changeStats!)
                  : null}
            {showStatus() ? (
                <>
                    {item().status === "working" ? (
                        <span
                            className="happy2-sidebar__item-working"
                            data-happy2-ui="sidebar-item-working"
                        >
                            working
                        </span>
                    ) : null}
                    <span
                        aria-hidden="true"
                        className="happy2-sidebar__item-status"
                        data-happy2-ui="sidebar-item-status"
                        data-status={item().status}
                    />
                </>
            ) : null}
            {showMeta() ? (
                <span className="happy2-sidebar__item-meta" data-happy2-ui="sidebar-item-meta">
                    {item().meta}
                </span>
            ) : null}
            {props.onAction && item().action && !swapsTrailing() ? (
                <SidebarItemAction action={item().action!} onAction={props.onAction} />
            ) : null}
        </button>
    );
}
/**
 * C-009 Sidebar — responsive native navigation column. Header with
 * workspace title, scrollable sectioned rows (views, channels, people, agents,
 * actions), actionable empty-section guidance, and an optional footer.
 */
export function Sidebar(props: SidebarProps) {
    const [local, rest] = partitionComponentProps(props, [
        "actions",
        "activeItemId",
        "brand",
        "bodyAccessory",
        "className",
        "composeLabel",
        "footer",
        "headerAccessory",
        "itemMenuItems",
        "onBack",
        "onCompose",
        "onItemSelect",
        "onItemAction",
        "onItemMenuSelect",
        "onItemReorder",
        "onSectionAction",
        "sections",
        "style",
        "subtitle",
        "title",
    ]);
    const menuRoot = useRef<HTMLDivElement>(null);
    const [itemMenu, setItemMenu] = useState<{
        item: SidebarItem;
        items: MenuItem[];
        x: number;
        y: number;
    }>();
    // eslint-disable-next-line happy2-react/no-layout-effect -- the context menu must measure its rendered height before clamping the fixed popover to the viewport, and global dismissal listeners require imperative cleanup
    useLayoutEffect(() => {
        if (!itemMenu) return;
        const bounds = menuRoot.current?.getBoundingClientRect();
        if (bounds) {
            const x = Math.max(8, Math.min(itemMenu.x, window.innerWidth - bounds.width - 8));
            const y = Math.max(8, Math.min(itemMenu.y, window.innerHeight - bounds.height - 8));
            if (x !== itemMenu.x || y !== itemMenu.y) {
                setItemMenu({ ...itemMenu, x, y });
                return;
            }
        }
        const close = (event: Event) => {
            if (!menuRoot.current?.contains(event.target as Node)) setItemMenu(undefined);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setItemMenu(undefined);
        };
        const dismiss = () => setItemMenu(undefined);
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", closeOnEscape);
        window.addEventListener("resize", dismiss);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", closeOnEscape);
            window.removeEventListener("resize", dismiss);
        };
    }, [itemMenu]);
    // Reorder drag. The live value is kept in a ref as well as in state because
    // the pointer handlers read it in the same gesture that schedules the paint.
    const dragRef = useRef<{ sectionId: string; drag: SidebarDrag } | undefined>(undefined);
    // Live row nodes, so a drop can read where each row was before the new order
    // is applied and animate it from there.
    const [rowNodes] = useState(() => new Map<string, HTMLButtonElement>());
    // Row tops captured at the drop, consumed by the layout effect below.
    const flipRef = useRef<Map<string, number> | undefined>(undefined);
    // Lets go of a capture the rearranging render never came for.
    const flipWait = useRef<number | undefined>(undefined);
    const flipWaitClear = (): void => {
        if (flipWait.current !== undefined) window.clearTimeout(flipWait.current);
        flipWait.current = undefined;
    };
    // The row that was just dropped, kept lit until it has finished travelling.
    const [dropped, setDropped] = useState<string>();
    // Set by a drag that actually moved, so the click the browser fires on
    // release rearranges rather than also opening what was dragged.
    const dragClick = useRef(false);
    const [dragPaint, setDragPaint] = useState<{ sectionId: string; drag: SidebarDrag }>();
    const dragSet = (next: { sectionId: string; drag: SidebarDrag } | undefined): void => {
        dragRef.current = next;
        setDragPaint(next);
    };
    const dragOf = (sectionId: string): SidebarDrag | undefined =>
        dragPaint?.sectionId === sectionId ? dragPaint.drag : undefined;

    const dragStart = (
        event: ReactPointerEvent<HTMLButtonElement>,
        section: SidebarSection,
        rowIndex: number,
    ): void => {
        const { units, parentId } = dragUnitsOf(section.items, rowIndex);
        const blocks = units;
        const blockIndex = units.findIndex((unit) => unit.includes(rowIndex));
        dragClick.current = false;
        if (!local.onItemReorder || event.button !== 0 || blocks.length < 2) return;
        // A pointer-down on the row's own control is that control's, not a drag.
        if ((event.target as HTMLElement).closest('[data-happy2-ui="sidebar-item-action"]')) return;
        // Heights are the distance a block actually displaces, measured from the
        // laid-out rows: the step from one block's top to the next block's top,
        // which counts the rows a block holds and the gap between them. Reading
        // the section's children directly would count its heading too, and
        // summing row heights alone would drop every gap — either way the block
        // travels a little less than it should and the drop lands off by that
        // much. The last block has no next top, so it takes its own extent plus
        // the same gap.
        const rows = [
            ...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                '[data-happy2-ui="sidebar-item"]',
            ) ?? []),
        ];
        const top = (blockIndex: number): number =>
            rows[blocks[blockIndex]?.[0] ?? -1]?.offsetTop ?? 0;
        const bottom = (block: readonly number[]): number => {
            const last = rows[block[block.length - 1] ?? -1];
            return last ? last.offsetTop + last.offsetHeight : 0;
        };
        const gap = blocks.length > 1 ? Math.max(0, top(1) - bottom(blocks[0]!)) : 0;
        const heights = blocks.map((block, index) =>
            index + 1 < blocks.length
                ? top(index + 1) - top(index)
                : bottom(block) - top(index) + gap,
        );
        event.currentTarget.setPointerCapture(event.pointerId);
        dragSet({
            sectionId: section.id,
            drag: {
                deltaY: 0,
                from: blockIndex,
                heights,
                moved: false,
                peers: units.map((unit) => section.items[unit[0]!]!.id),
                pointerId: event.pointerId,
                startY: event.clientY,
                to: blockIndex,
                units,
                ...(parentId !== undefined ? { parentId } : {}),
            },
        });
    };

    const dragMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.drag.pointerId) return;
        const deltaY = event.clientY - current.drag.startY;
        if (!current.drag.moved && Math.abs(deltaY) < DRAG_THRESHOLD) return;
        const to = dragTargetIndex(current.drag, deltaY);
        // A tick each time the row crosses into a new slot, so the arrangement
        // can be felt without watching it.
        if (to !== current.drag.to) haptic("selection");
        dragSet({
            ...current,
            drag: { ...current.drag, deltaY, moved: true, to },
        });
    };

    /** Reports the move, if the drag made one, and clears the drag. */
    const dragEnd = (
        event: ReactPointerEvent<HTMLButtonElement>,
        section: SidebarSection,
    ): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.drag.pointerId) return;
        const { drag } = current;
        if (!drag.moved) {
            dragSet(undefined);
            return;
        }
        dragClick.current = true;
        // Where every row is right now, while the drag still holds them: the
        // dragged row under the pointer and its neighbours pushed aside. The new
        // order is applied immediately after, and the rows animate from these
        // positions to wherever it puts them — so the one commit that moves DOM
        // nodes happens here, under the pointer, and never once the row is
        // supposed to be sitting still.
        const movedId = drag.peers[drag.from];
        if (!reducedMotion() && drag.from !== drag.to) {
            const firsts = new Map<string, number>();
            for (const item of section.items) {
                const node = rowNodes.get(item.id);
                if (node) firsts.set(item.id, node.getBoundingClientRect().top);
            }
            flipRef.current = firsts;
            // Released lit, not resting: the highlight is handed from the drag to
            // the travelling row and only let go once it has arrived.
            setDropped(movedId);
            // The capture waits for the render that applies the new order, but
            // it cannot wait forever: a move the caller declines to make, or one
            // the server rejects, never produces that render, and an unclaimed
            // capture would leave the row lit and then play it back from stale
            // coordinates on the next unrelated render.
            flipWaitClear();
            flipWait.current = window.setTimeout(() => {
                flipWait.current = undefined;
                flipRef.current = undefined;
                setDropped(undefined);
            }, SETTLE_WAIT_MS);
        }
        dragSet(undefined);
        if (drag.from === drag.to || movedId === undefined) return;
        haptic("impact");
        // Stated against the peers the drag started with: the row it now follows
        // is whichever peer precedes its landing slot once it has been lifted
        // out, and nothing at the front of the list.
        const remaining = drag.peers.filter((_, index) => index !== drag.from);
        local.onItemReorder?.(section.id, {
            afterId: drag.to === 0 ? null : (remaining[drag.to - 1] ?? null),
            id: movedId,
            ...(drag.parentId !== undefined ? { parentId: drag.parentId } : {}),
        });
    };

    /*
     * FLIP: the rows have already been rearranged by the render this runs after,
     * so each one is measured again and played back from where the drop left it.
     * It has to be a layout effect reading real geometry — the distance a row
     * travels is only known once the browser has laid the new order out — and it
     * animates through the Web Animations API rather than a CSS transition so
     * that moving a node between parents, which is what rearranging the list
     * does, cannot restart or strand it.
     */
    // eslint-disable-next-line happy2-react/no-layout-effect -- a drop animation must measure the laid-out result of the render it follows, which no declarative or event-driven boundary exposes
    useLayoutEffect(() => {
        const firsts = flipRef.current;
        if (!firsts) return;
        const played: Animation[] = [];
        for (const [id, first] of firsts) {
            const node = rowNodes.get(id);
            if (!node) continue;
            const delta = first - node.getBoundingClientRect().top;
            if (Math.abs(delta) < 0.5) continue;
            played.push(
                node.animate(
                    [
                        { transform: `translateY(${String(delta)}px)` },
                        { transform: "translateY(0)" },
                    ],
                    { duration: SETTLE_MS, easing: SETTLE_EASING },
                ),
            );
        }
        // Kept until something actually moved: the reorder may reach the list one
        // render later than the drop, and dropping the capture on the first empty
        // pass would lose the animation entirely.
        if (played.length === 0) return;
        flipRef.current = undefined;
        flipWaitClear();
        // The row stays lit until it stops moving. Rearranging the list moves its
        // node, which drops `:hover` until the pointer moves again — so releasing
        // straight into the resting style would blink the highlight out and let
        // it fade back in, which is the flicker itself.
        const last = played[played.length - 1]!;
        const rest = () => setDropped(undefined);
        last.addEventListener("finish", rest);
        // The animations are deliberately not cancelled here. This effect has no
        // dependency list — it has to run after whichever render applies the new
        // order — so cancelling on teardown would abort the drop animation on the
        // next unrelated render, and a live workspace renders constantly.
        return () => last.removeEventListener("finish", rest);
    });

    const openItemMenu = (item: SidebarItem, event: MouseEvent<HTMLButtonElement>) => {
        const items = local.itemMenuItems?.(item) ?? [];
        if (!items.some((entry) => entry.kind === "item")) {
            setItemMenu(undefined);
            return;
        }
        event.preventDefault();
        setItemMenu({
            item,
            items,
            x: event.clientX,
            y: event.clientY,
        });
    };
    return (
        <nav
            {...rest}
            className={["happy2-sidebar", local.className].filter(Boolean).join(" ")}
            data-back={local.onBack ? "" : undefined}
            data-happy2-ui="sidebar"
            style={local.style}
        >
            <header className="happy2-sidebar__header" data-happy2-ui="sidebar-header">
                {local.onBack ? (
                    <div className="happy2-sidebar__heading" data-happy2-ui="sidebar-heading">
                        <button
                            aria-label="Back"
                            className="happy2-sidebar__back"
                            data-happy2-ui="sidebar-back"
                            onClick={local.onBack}
                            type="button"
                        >
                            <Icon name="chevron-right" size={16} />
                        </button>
                        <span
                            className="happy2-sidebar__title happy2-sidebar__title--back"
                            data-happy2-ui="sidebar-title"
                        >
                            {local.title}
                        </span>
                    </div>
                ) : (
                    <div className="happy2-sidebar__heading" data-happy2-ui="sidebar-heading">
                        {local.brand ? (
                            <span className="happy2-sidebar__title-row happy2-sidebar__title-row--brand">
                                <img
                                    alt=""
                                    aria-hidden="true"
                                    className="happy2-sidebar__brand-logo"
                                    data-happy2-ui="sidebar-brand-logo"
                                    draggable={false}
                                    src={happyLogoUrl}
                                />
                                <span
                                    className="happy2-sidebar__title happy2-sidebar__title--brand"
                                    data-happy2-ui="sidebar-title"
                                >
                                    Happy
                                </span>
                            </span>
                        ) : local.title !== undefined ? (
                            <span className="happy2-sidebar__title-row">
                                <span
                                    className="happy2-sidebar__title"
                                    data-happy2-ui="sidebar-title"
                                >
                                    {local.title}
                                </span>
                                <span className="happy2-sidebar__title-chevron" aria-hidden="true">
                                    <Icon name="chevron-down" size={14} />
                                </span>
                            </span>
                        ) : null}
                        {local.subtitle ? (
                            <span
                                className="happy2-sidebar__subtitle"
                                data-happy2-ui="sidebar-subtitle"
                            >
                                {local.subtitle}
                            </span>
                        ) : null}
                    </div>
                )}
            </header>
            {local.headerAccessory ? (
                <div
                    className="happy2-sidebar__header-accessory"
                    data-happy2-ui="sidebar-header-accessory"
                >
                    {local.headerAccessory}
                </div>
            ) : null}
            <div className="happy2-sidebar__body" data-happy2-ui="sidebar-body">
                <div className="happy2-sidebar__body-content" data-happy2-ui="sidebar-body-content">
                    {local.onCompose ? (
                        <SidebarRow
                            active={false}
                            className="happy2-sidebar__compose"
                            item={{
                                icon: "plus",
                                id: "new-chat",
                                kind: "action",
                                label: local.composeLabel ?? "Create",
                            }}
                            onSelect={local.onCompose}
                        />
                    ) : null}
                    {local.actions?.map((action) => (
                        <SidebarRow
                            active={false}
                            className="happy2-sidebar__compose"
                            item={action}
                            key={action.id}
                            onSelect={() => local.onItemSelect(action.id)}
                        />
                    ))}
                    {local.bodyAccessory}
                    {local.sections.map((section) => (
                        <section
                            className="happy2-sidebar__section"
                            key={section.id}
                            data-happy2-ui="sidebar-section"
                            data-reordering={dragOf(section.id) ? "" : undefined}
                            data-section-id={section.id}
                        >
                            {section.label ? (
                                <div
                                    className="happy2-sidebar__section-head"
                                    data-happy2-ui="sidebar-section-head"
                                >
                                    <span
                                        className="happy2-sidebar__section-label"
                                        data-happy2-ui="sidebar-section-label"
                                    >
                                        {section.label}
                                    </span>
                                    {section.action
                                        ? ((action) => (
                                              <button
                                                  aria-label={action.label}
                                                  className="happy2-sidebar__section-action"
                                                  data-happy2-ui="sidebar-section-action"
                                                  onClick={() =>
                                                      local.onSectionAction?.(section.id)
                                                  }
                                                  type="button"
                                              >
                                                  <Icon name={action.icon} size={12} />
                                              </button>
                                          ))(section.action)
                                        : null}
                                </div>
                            ) : null}
                            {!section.headingOnly
                                ? section.items.map((item, index) => {
                                      const drag = dragOf(section.id);
                                      const dragging = drag?.moved === true;
                                      // While a drag is live the row's position
                                      // is read from that drag's own units, which
                                      // are the top-level blocks or one row's
                                      // children depending on where it started.
                                      const unitIndex = dragging
                                          ? drag.units.findIndex((unit) => unit.includes(index))
                                          : -1;
                                      const held = dragging && unitIndex === drag.from;
                                      return (
                                          <SidebarRow
                                              active={item.id === local.activeItemId}
                                              branch={
                                                  (item.depth ?? 0) > 0
                                                      ? isLastAtDepth(section.items, index)
                                                          ? "end"
                                                          : "tee"
                                                      : undefined
                                              }
                                              branchFirst={
                                                  (item.depth ?? 0) > 0 &&
                                                  isFirstAtDepth(section.items, index)
                                              }
                                              dragging={held || item.id === dropped}
                                              key={item.id}
                                              item={item}
                                              onContextMenu={openItemMenu}
                                              onPointerDown={
                                                  local.onItemReorder
                                                      ? (event) => dragStart(event, section, index)
                                                      : undefined
                                              }
                                              onPointerMove={
                                                  local.onItemReorder ? dragMove : undefined
                                              }
                                              onPointerUp={
                                                  local.onItemReorder
                                                      ? (event) => dragEnd(event, section)
                                                      : undefined
                                              }
                                              onAction={
                                                  local.onItemAction && item.action
                                                      ? () => local.onItemAction?.(item.id)
                                                      : undefined
                                              }
                                              nodeRef={(node) => {
                                                  if (node) rowNodes.set(item.id, node);
                                                  else rowNodes.delete(item.id);
                                              }}
                                              onSelect={(id) => {
                                                  if (dragClick.current) {
                                                      dragClick.current = false;
                                                      return;
                                                  }
                                                  local.onItemSelect(id);
                                              }}
                                              shift={
                                                  dragging && unitIndex >= 0
                                                      ? unitIndex === drag.from
                                                          ? drag.deltaY
                                                          : blockShift(drag, unitIndex)
                                                      : undefined
                                              }
                                          />
                                      );
                                  })
                                : null}
                            {!section.headingOnly &&
                            (section.items.length === 0 ? section.empty : undefined)
                                ? ((empty) => (
                                      <div
                                          className="happy2-sidebar__empty"
                                          data-happy2-ui="sidebar-section-empty"
                                      >
                                          <span
                                              className="happy2-sidebar__empty-description"
                                              data-happy2-ui="sidebar-section-empty-description"
                                          >
                                              {empty.description}
                                          </span>
                                          <Button
                                              className="happy2-sidebar__empty-action"
                                              onClick={() => local.onSectionAction?.(section.id)}
                                              size="small"
                                              variant="ghost"
                                          >
                                              {empty.actionLabel}
                                          </Button>
                                      </div>
                                  ))((section.items.length === 0 ? section.empty : undefined)!)
                                : null}
                        </section>
                    ))}
                </div>
            </div>
            {local.footer ? (
                <footer className="happy2-sidebar__footer" data-happy2-ui="sidebar-footer">
                    {local.footer}
                </footer>
            ) : null}
            {itemMenu ? (
                <div
                    className="happy2-sidebar__item-menu"
                    data-happy2-ui="sidebar-item-menu"
                    ref={menuRoot}
                    style={{ left: itemMenu.x, top: itemMenu.y }}
                >
                    <Menu
                        items={itemMenu.items}
                        onSelect={(actionId) => {
                            const item = itemMenu.item;
                            setItemMenu(undefined);
                            local.onItemMenuSelect?.(item, actionId);
                        }}
                        width={216}
                    />
                </div>
            ) : null}
        </nav>
    );
}
