import { partitionComponentProps } from "./componentProps";
import {
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type HTMLAttributes,
    type KeyboardEvent as ReactKeyboardEvent,
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
import { Menu, type MenuItem } from "./Menu";
import { RigPeerStatus, type RigPeerState } from "./RigPeerStatus";
import { ShimmerText } from "./ShimmerText";
import { SidebarNodes, type SidebarNode } from "./SidebarNodes";
import { Spinner } from "./Spinner";
/** One control in a row's trailing lane: its glyph, what it does, and when it shows. */
export type SidebarItemAction = {
    icon: IconName;
    label: string;
    /** Keeps the control visible in its lane while refusing an unavailable action. */
    disabled?: boolean;
    reveal?: "hover";
};
export type SidebarItem = {
    /** Marks a row as archived; the row keeps its position but paints muted. */
    archived?: boolean;
    badge?: number;
    /** Git line totals painted as a compact green/red diff pair. */
    changeStats?: {
        added: number;
        deleted: number;
    };
    /**
     * Whether the rows nested under this one are folded away, for a row that can
     * be folded at all. Absent means the row is not one of those: a row with no
     * children, or one whose caller keeps no record of what is folded, is stated
     * without it and offers no control.
     *
     * The rows themselves are still given in `items`; the sidebar draws only the
     * ones a fold leaves visible. A caller states the tree it has and says which
     * rows are shut, rather than working out which of its own rows to withhold.
     */
    collapsed?: boolean;
    /** Nesting level. `0`/absent is top level; each level adds `SIDEBAR_ROW_INDENT` of left inset. */
    depth?: number;
    /**
     * A single emoji in the row's leading slot instead of a house glyph, for a
     * row whose mark the reader chose themselves — a folder, say.
     *
     * It is content rather than an icon, so it is stated apart from `icon`: the
     * house vocabulary is a closed set this component resolves, and an arbitrary
     * character is not in it. A row carrying both shows the emoji, because a
     * mark the reader picked outranks the one the caller fell back to.
     */
    emoji?: string;
    /** The row's glyph. A `person`/`agent`/`project` row paints it inside the avatar tile. */
    icon?: IconName;
    id: string;
    imageUrl?: string;
    initials?: string;
    kind: "view" | "channel" | "workspace" | "project" | "person" | "agent" | "folder" | "action";
    label: string;
    /** Whether a busy or creating row shimmers its label. Defaults to true. */
    labelShimmer?: boolean;
    meta?: string;
    /**
     * A control at the trailing edge of the row, reported through
     * `onItemAction`. `reveal: "hover"` keeps it out of the way until the row is
     * hovered or the control is focused, for something destructive; the default
     * keeps it visible, for something the row is offering.
     */
    action?: SidebarItemAction;
    /**
     * A second control in the same trailing lane, immediately left of `action`
     * and reported through `onItemSecondaryAction`. It is for an act about the
     * row rather than the one the row is offering — configuring a project
     * beside starting work in it — and it shares the lane so the row's text
     * keeps its width whether or not the control is showing.
     */
    secondaryAction?: SidebarItemAction;
    /**
     * A folder-sharing group at this row: one durable trailing mark at rest,
     * with a spinner while its contents are crossing Murmur.
     */
    share?: {
        status: "syncing" | "synced" | "error";
        label: string;
    };
    online?: boolean;
    /**
     * `working` spins in the leading slot; `waiting` shows a highlighted clock
     * there instead — the row's agent is inside a scheduled wait, deliberately
     * doing nothing. Waiting is the lower-priority state: a row whose sessions
     * do real work reports `working`.
     */
    status?: "ready" | "working" | "waiting";
    /**
     * Where the thing behind this row is in its own life, as distinct from what
     * is happening inside it: `creating` while it is still being made,
     * `unavailable` once what it named is no longer there, and `failed` when it
     * could not be made at all.
     *
     * A row in one of these states is not a row doing work, so the lifecycle
     * takes the leading slot and the trailing label from `status` — the reader
     * needs to know the place does not exist yet before they are told nothing is
     * running in it. The label is named in `lifecycleLabel` so the row says what
     * happened in the caller's own words.
     */
    lifecycle?: "creating" | "unavailable" | "failed";
    /** What the row's `lifecycle` reads as, e.g. "Creating…", "Missing", "Failed". */
    lifecycleLabel?: string;
    tone?: ToneName;
    unread?: boolean;
};
/** Left inset of the row content at depth 0 (matches the CSS `padding-left`). */
export const SIDEBAR_ROW_PADDING_X = 10;
/** Additional left inset applied per nesting level so children sit under their parent. */
export const SIDEBAR_ROW_INDENT = 16;
/** The one control a section heading offers, beside the section's own label. */
export type SidebarSectionAction = {
    icon: IconName;
    label: string;
    /** Keeps the heading action visible while its owning surface is unavailable. */
    disabled?: boolean;
    /**
     * True while the act it starts is still running. The control shows a spinner
     * in place of its glyph and refuses to be pressed again, so an act that takes
     * long enough to be pressed twice cannot be started twice from here.
     */
    busy?: boolean;
    /**
     * `hover` keeps the control out of the way until the heading is hovered or the
     * control is focused, for a secondary act on a list someone is reading. `always`
     * keeps it visible, for a control the section exists to offer. Hover is the
     * default because that is what a heading control has always done here.
     */
    reveal?: "hover" | "always";
};

/** Which control in a section reported an act: its heading, or its empty state. */
export type SidebarSectionActionSource = "heading" | "empty";

export type SidebarSection = {
    action?: SidebarSectionAction;
    empty?: {
        /**
         * The one act an empty section offers, reported through
         * `onSectionAction`. Omit it when there is nothing the reader can do
         * about the state being described — a section waiting on a machine it
         * does not control states the wait and offers no button, rather than
         * one that would go nowhere.
         */
        actionLabel?: string;
        description: string;
        icon?: IconName;
        title?: string;
    };
    id: string;
    /** Renders only the labeled action row, useful as a hierarchy heading. */
    headingOnly?: boolean;
    items: SidebarItem[];
    label?: string;
    /**
     * Machines this Rig is peered with that there is nothing to open on,
     * reported under the heading instead of being listed as rows. They are
     * stated separately from `items` because they are not places to go — see
     * `SidebarNodes` — and a section that has them has no rows of its own.
     */
    nodes?: readonly SidebarNode[];
    /**
     * Where the machine this section's rows come from currently is, shown as the
     * shared peer marker beside the heading. A section that is not one machine's
     * list supplies none and its heading is only a name.
     */
    status?: RigPeerState;
    /**
     * What went wrong with this section, said under its heading until it
     * clears. It is the section's, not a row's, in both directions: an add that
     * is refused has no row to fail on, and a section whose whole source is
     * unreachable has no rows at all to carry the news.
     *
     * A section that lists one machine's work uses this for that machine's
     * connection. The failure belongs here rather than in `empty`, because a
     * source that cannot be reached is not the same as a source with nothing in
     * it, and a reader shown "nothing here" would believe the wrong thing.
     */
    error?: string;
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
    /** Compact context anchored at the trailing edge of the 56px top heading. */
    headerTrailing?: ReactNode;
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
    /** Invoked when a row's trailing `secondaryAction` control is used. */
    onItemSecondaryAction?: (id: string) => void;
    /**
     * Enables arranging the pinned `actions` and reports the one move a drag or
     * a keyboard move made. Without it the pinned rows are fixed, which is what
     * a window with nowhere to remember an order should offer.
     */
    onActionReorder?: (move: SidebarReorder) => void;
    /**
     * Enables dragging rows into a different order and reports the one move a
     * drag made, on release. A top-level row carries its nested rows with it; a
     * nested row travels among its siblings inside its own parent and never
     * leaves it. Without this the rows are not draggable and nothing about them
     * changes.
     */
    onItemReorder?: (sectionId: string, move: SidebarReorder) => void;
    /**
     * Invoked by a foldable row's disclosure control, with the row that was
     * folded or unfolded. Whether it is now open is the caller's to record and
     * to say back through `collapsed`, so the sidebar never holds an opinion
     * about the tree that outlives one render.
     *
     * Without it no row discloses, whatever it says about being collapsed: a
     * control that folds a row a caller cannot remember folding is a control
     * that undoes itself on the next update.
     */
    onItemCollapseToggle?: (id: string) => void;
    /**
     * Invoked by a section's heading control or by the button in its empty
     * state. The two are reported apart because they are different acts on the
     * same section — adding something to it, and the one act an empty section
     * offers instead — and a caller that conflated them would run the wrong one.
     */
    onSectionAction?: (sectionId: string, source: SidebarSectionActionSource) => void;
    sections: SidebarSection[];
    style?: CSSProperties;
    subtitle?: string;
    title?: string;
};
function leadingIcon(item: SidebarItem): IconName {
    if (item.kind === "workspace") return item.icon ?? "branch";
    if (item.kind === "channel") return item.icon ?? "hash";
    if (item.kind === "action") return item.icon ?? "plus";
    if (item.kind === "folder") return item.icon ?? "archive";
    return item.icon ?? "inbox";
}
/**
 * Nested rows are introduced by an ASCII branch instead of repeating the parent's
 * glyph, so the hash only ever marks a top-level channel and the worktree mark only a
 * top-level workspace: under a project the branch line already says the row is a
 * worktree, and a branch glyph beside a branch line says it twice. A row keeps an
 * explicitly supplied icon (a private channel's lock, say) because that carries
 * information the branch cannot — and an emoji is the strongest case of that, since
 * it is the mark the reader picked for this row and nothing else in the column
 * carries it.
 */
function showsLeadingSlot(item: SidebarItem): boolean {
    if ((item.depth ?? 0) === 0) return true;
    if (item.kind === "person" || item.kind === "agent" || item.kind === "project") return true;
    return item.icon !== undefined || item.emoji !== undefined;
}
/** One row as it is drawn: the row itself, and whether it has a tree to fold. */
interface SidebarVisibleRow {
    readonly item: SidebarItem;
    /** True when rows are nested under this one, whether or not they show now. */
    readonly foldable: boolean;
}

/**
 * The rows a section actually shows: every row, less the ones nested under a
 * row that is folded shut, each carrying whether it has anything to fold.
 *
 * Both answers come from one pass over the stated rows, because both are about
 * the same thing — what is nested under what — and a folded row's children have
 * to be counted before they are dropped. Asking the drawn list whether a row has
 * children would say no about every row that is shut, which is exactly the row
 * whose control has to be there.
 *
 * A fold takes the whole tree beneath it, not one level: a folder folded away
 * takes the folders inside it with it whatever those said about themselves, so a
 * row reopened later is found as it was left rather than having quietly unfolded
 * while nobody could see it.
 *
 * Everything downstream — the tree connectors, the drag units, the keyboard
 * moves — reads the rows this returns, so a fold is one filter at the top rather
 * than a condition each of them has to remember.
 */
function visibleRows(items: readonly SidebarItem[]): readonly SidebarVisibleRow[] {
    const rows: SidebarVisibleRow[] = [];
    // The depth a row must be shallower than to be shown again, once a folded
    // row has been passed. Nothing is hidden until one is.
    let hiddenBelow: number | undefined;
    for (const [index, item] of items.entries()) {
        const depth = item.depth ?? 0;
        if (hiddenBelow !== undefined) {
            if (depth >= hiddenBelow) continue;
            hiddenBelow = undefined;
        }
        rows.push({ foldable: (items[index + 1]?.depth ?? 0) > depth, item });
        if (item.collapsed === true) hiddenBelow = depth + 1;
    }
    return rows;
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

/**
 * The list the pinned `actions` are arranged in. They are not a section — they
 * carry no heading and belong to the window rather than to any list of entities
 * — but they are rearranged by exactly the same machinery, so they need a list
 * identity of their own. A symbol, so that no caller's section id can ever be
 * mistaken for it.
 */
const ACTIONS_LIST = Symbol("happy2-sidebar-actions");

/** Which list a reorder is happening in: one section, or the pinned actions. */
type SidebarListId = string | typeof ACTIONS_LIST;

/**
 * One row's identity across the whole sidebar: which list it is in, and which
 * row. The list is length-prefixed so that no id, however it is written, can
 * shift the boundary between the two and answer for another list's row.
 */
function rowKey(listId: SidebarListId, itemId: string): string {
    const list = typeof listId === "string" ? listId : "";
    return `${String(list.length)}:${list}${itemId}`;
}

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

/** The rows one row carries with it: itself, then the rows nested beneath it. */
function subtreeOf(items: readonly SidebarItem[], index: number): readonly number[] {
    const depth = items[index]?.depth ?? 0;
    const rows = [index];
    for (let row = index + 1; row < items.length && (items[row]!.depth ?? 0) > depth; row += 1)
        rows.push(row);
    return rows;
}

/**
 * What a drag starting on `index` rearranges, and among which peers. Dragging a
 * top-level row rearranges the top level, each row carrying its children;
 * dragging a nested row rearranges that row's siblings inside their own parent,
 * so a worktree can be ordered within its project but never dragged out of it.
 * The parent is the nearest row above that sits one level shallower, whatever
 * the depth: a folder tree nests as far as its owner nests it, and a folder
 * three levels down is ordered among the children of the folder holding it
 * rather than among everything under its top-level ancestor.
 */
function dragUnitsOf(
    items: readonly SidebarItem[],
    index: number,
): { units: readonly (readonly number[])[]; parentId?: string } {
    const depth = items[index]?.depth ?? 0;
    if (depth === 0) return { units: blocksOf(items) };
    let parent = index - 1;
    while (parent >= 0 && (items[parent]!.depth ?? 0) >= depth) parent -= 1;
    const siblings: number[] = [];
    for (let row = parent + 1; row < items.length && (items[row]!.depth ?? 0) >= depth; row += 1)
        if ((items[row]!.depth ?? 0) === depth) siblings.push(row);
    return {
        units: siblings.map((row) => subtreeOf(items, row)),
        ...(items[parent] ? { parentId: items[parent]!.id } : {}),
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

function SidebarRowAction(props: { action: SidebarItemAction; onAction: () => void }) {
    return (
        /* A `span` because the row itself is the button: nesting one button
           inside another is invalid, and this control must sit inside the row
           so it tracks the row's hover. */
        <span
            aria-disabled={props.action.disabled ? "true" : undefined}
            aria-label={props.action.label}
            className="happy2-sidebar__item-action"
            data-happy-desktop-ui="sidebar-item-action"
            data-reveal={props.action.reveal}
            data-disabled={props.action.disabled ? "" : undefined}
            onClick={(event) => {
                event.stopPropagation();
                if (props.action.disabled) return;
                props.onAction();
            }}
            onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                if (props.action.disabled) return;
                props.onAction();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            role="button"
            tabIndex={props.action.disabled ? -1 : 0}
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
    onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
    /** The gesture was taken away rather than finished; nothing is reported. */
    onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    /** Registers the live node so a drop can measure and animate this row. */
    nodeRef?: (node: HTMLButtonElement | null) => void;
    /** Invoked by the row's trailing control; absent when the row offers none. */
    onAction?: () => void;
    /** Invoked by the control left of it; absent when the row offers no second one. */
    onSecondaryAction?: () => void;
    /** Folds or unfolds this row; absent when the row has nothing to fold. */
    onCollapseToggle?: () => void;
    onSelect: (id: string) => void;
    /** The row can be arranged, which is what the keyboard shortcut is offered for. */
    reorderable?: boolean;
    shift?: number;
}) {
    const item = () => props.item;
    const unread = () => item().unread === true;
    const unreadOnLeading = () =>
        unread() && (item().kind === "project" || item().kind === "workspace");
    const mentioned = () => (item().badge ?? 0) > 0;
    const hasChangeStats = () =>
        (item().changeStats?.added ?? 0) > 0 || (item().changeStats?.deleted ?? 0) > 0;
    // The row's trailing controls in the order they are read, left to right: an
    // act about the row, then the act the row is offering.
    const trailingActions = (): {
        key: string;
        action: SidebarItemAction;
        onAction: () => void;
    }[] =>
        [
            item().secondaryAction && props.onSecondaryAction
                ? {
                      key: "secondary",
                      action: item().secondaryAction!,
                      onAction: props.onSecondaryAction,
                  }
                : undefined,
            item().action && props.onAction
                ? { key: "primary", action: item().action!, onAction: props.onAction }
                : undefined,
        ].filter((control) => control !== undefined);
    // Every control is waiting for hover anyway, so what the row reports at rest
    // may occupy the same lane and step aside when they arrive.
    const swapsTrailing = () =>
        trailingActions().length > 0 &&
        trailingActions().every((control) => control.action.reveal === "hover");
    const trailingLane = () => (
        <span className="happy2-sidebar__item-actions" data-happy-desktop-ui="sidebar-item-actions">
            {trailingActions().map((control) => (
                <SidebarRowAction
                    action={control.action}
                    key={control.key}
                    onAction={control.onAction}
                />
            ))}
        </span>
    );
    const depth = () => Math.max(0, item().depth ?? 0);
    const lifecycle = () => item().lifecycle;
    const showStatus = () =>
        item().kind === "agent" &&
        item().status !== undefined &&
        lifecycle() === undefined &&
        !unread() &&
        !mentioned();
    // A row whose place is still being made, or is gone, says so ahead of any
    // count of what is inside it: the reader is being told the row's own news.
    const showLifecycle = () => lifecycle() !== undefined && item().lifecycleLabel !== undefined;
    const showMeta = () =>
        item().meta !== undefined && !unread() && !mentioned() && !showStatus() && !showLifecycle();
    /*
     * A place that is being made, or has work running inside it, says so in its
     * own name: the name shimmers for as long as that lasts. It is the same
     * report the leading glyph already makes, but it survives the row being
     * skimmed — the eye is on the names when it goes down the list, and a 14px
     * spinner in the gutter is easy to pass over.
     *
     * Only a place: a channel or a person is not something that can be busy, and
     * an agent already spends most of its life running, so shimmering those
     * names would leave the sidebar permanently in motion and say nothing.
     */
    const shimmerLabel = () =>
        item().labelShimmer !== false &&
        (item().kind === "project" || item().kind === "workspace") &&
        (lifecycle() === "creating" || (lifecycle() === undefined && item().status === "working"));
    /*
     * What the row is doing, as one glyph at the trailing edge. It is the last
     * thing in the row so it lands in a column of its own down the right side,
     * where a spinner can start and stop without any of the row's own contents
     * moving.
     *
     * The row's own news comes before what is happening inside it: a place still
     * being made, or already gone, reports that rather than reporting that
     * nothing is running in it. `creating` spins in the accent colour where
     * `working` spins muted, because the same glyph would otherwise mean two
     * different things — this place is being made, against work happening inside
     * a place that already exists.
     */
    const activity = ():
        | { kind: "spinner"; tone: "accent" | "muted"; label: string }
        | { kind: "glyph"; icon: IconName; label: string; lifecycle: string }
        | undefined => {
        if (lifecycle() === "creating")
            return {
                kind: "spinner",
                tone: "accent",
                label: `${item().label} is being created`,
            };
        if (lifecycle() !== undefined)
            return {
                kind: "glyph",
                icon: lifecycle() === "failed" ? "alert" : "unlink",
                label: `${item().label}: ${item().lifecycleLabel ?? "unavailable"}`,
                lifecycle: lifecycle()!,
            };
        if (item().share?.status === "syncing")
            return {
                kind: "spinner",
                tone: "accent",
                label: item().share!.label,
            };
        if (item().share?.status === "error")
            return {
                kind: "glyph",
                icon: "alert",
                label: item().share!.label,
                lifecycle: "failed",
            };
        if (item().share?.status === "synced")
            return {
                kind: "glyph",
                icon: "link",
                label: item().share!.label,
                lifecycle: "shared",
            };
        if (item().kind !== "workspace" && item().kind !== "project") return undefined;
        if (item().status === "working")
            return { kind: "spinner", tone: "muted", label: `${item().label} is working` };
        if (item().status === "waiting")
            return {
                kind: "glyph",
                icon: "clock",
                label: `${item().label} is waiting`,
                lifecycle: "waiting",
            };
        return undefined;
    };
    return (
        <button
            aria-current={props.active ? "page" : undefined}
            aria-expanded={props.onCollapseToggle ? item().collapsed !== true : undefined}
            aria-keyshortcuts={props.reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            className={["happy2-sidebar__item", props.className].filter(Boolean).join(" ")}
            data-active={props.active ? "" : undefined}
            data-archived={item().archived ? "" : undefined}
            /* Both are needed and neither implies the other: a row that folds is
               styled as one whether it is open or shut, and a row still says it
               is shut while the pointer is elsewhere. */
            data-collapsed={props.onCollapseToggle && item().collapsed ? "" : undefined}
            data-foldable={props.onCollapseToggle ? "" : undefined}
            data-depth={depth() > 0 ? String(depth()) : undefined}
            data-item-id={item().id}
            data-kind={item().kind}
            data-mentioned={mentioned() ? "" : undefined}
            data-happy-desktop-ui="sidebar-item"
            data-lifecycle={lifecycle()}
            data-status={item().status}
            data-share={item().share?.status}
            data-unread={unread() ? "" : undefined}
            data-dragging={props.dragging ? "" : undefined}
            onClick={() => props.onSelect(item().id)}
            onContextMenu={(event) => props.onContextMenu?.(item(), event)}
            onKeyDown={props.onKeyDown}
            onPointerDown={props.onPointerDown}
            onPointerMove={props.onPointerMove}
            onPointerCancel={props.onPointerCancel}
            /* The capture is released by the drop itself, so this only fires
               first when something else took the pointer away — the row being
               removed under it, or the system claiming the gesture. */
            onLostPointerCapture={props.onPointerCancel}
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
                    data-happy-desktop-ui="sidebar-item-branch"
                />
            ) : null}
            {showsLeadingSlot(item()) || props.onCollapseToggle ? (
                <span
                    className="happy2-sidebar__item-leading"
                    data-happy-desktop-ui="sidebar-item-leading"
                >
                    {/* Identity only. What the row is doing is reported at the
                        trailing edge instead, so a busy row still shows the face
                        or glyph the reader picks it out by — a column of
                        spinners where the avatars were is a column with nothing
                        left to aim at.

                        A nested row that shows no mark of its own keeps showing
                        none when it folds: the branch line beside it already says
                        what it is, and opening the lane for the chevron must not
                        put back the glyph that line replaced. */}
                    {!showsLeadingSlot(item()) ? null : item().kind === "person" ||
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
                    ) : item().emoji !== undefined ? (
                        /* The character the reader chose, in a fixed square the
                           same size as the glyph lane beside it, so a row whose
                           emoji is wide or tall still occupies exactly one lane
                           and the column of names below it never shifts. */
                        <span
                            aria-hidden="true"
                            className="happy2-sidebar__item-emoji"
                            data-happy-desktop-ui="sidebar-item-emoji"
                        >
                            <span
                                className="happy2-sidebar__item-emoji-glyph"
                                data-happy-desktop-ui="sidebar-item-emoji-glyph"
                            >
                                {item().emoji}
                            </span>
                        </span>
                    ) : (
                        <Icon name={leadingIcon(item())} size={16} />
                    )}
                    {unreadOnLeading() ? (
                        <span
                            aria-label="Unread activity"
                            className="happy2-sidebar__item-leading-unread"
                            data-happy-desktop-ui="sidebar-item-leading-unread"
                        />
                    ) : null}
                    {/* The fold, in the lane the row's own mark occupies rather
                        than in one of its own: the sidebar's rows are already a
                        tree drawn hanging off that lane, and a column of twisties
                        beside it would indent every row in the window to make
                        room for a control most rows do not have.

                        It is stacked over the mark rather than replacing it, so
                        that reaching for the chevron never resizes or reflows the
                        row. A row that is shut keeps it showing: the reader has
                        to be able to find the work they folded away without
                        sweeping the column to see which rows answer. */}
                    {props.onCollapseToggle ? (
                        /* A `span`, because the row itself is the button and a
                           button inside a button is invalid. */
                        <span
                            aria-hidden="true"
                            className="happy2-sidebar__item-fold"
                            data-happy-desktop-ui="sidebar-item-fold"
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onCollapseToggle?.();
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                        >
                            <Icon
                                name={item().collapsed ? "chevron-right" : "chevron-down"}
                                size={12}
                            />
                        </span>
                    ) : null}
                </span>
            ) : null}
            <span className="happy2-sidebar__item-label" data-happy-desktop-ui="sidebar-item-label">
                {/* The row's own colour, with a near-white band wiping through
                    it. Busy is a passing state, so it may not restyle the name:
                    an unread row is already heavier and darker than its
                    neighbours, and painting the name again here would stack a
                    second emphasis on top of one the row had already earned.
                    Only the travelling band is new. */}
                {shimmerLabel() ? (
                    <ShimmerText sweep="sheen" tone="inherit">
                        {item().label}
                    </ShimmerText>
                ) : (
                    item().label
                )}
            </span>
            {unread() && !unreadOnLeading() && !mentioned() ? (
                <span
                    aria-label="Unread"
                    className="happy2-sidebar__item-unread"
                    data-happy-desktop-ui="sidebar-item-unread"
                />
            ) : null}
            {mentioned() ? (
                <CountBadge className="happy2-sidebar__item-badge" count={item().badge!} />
            ) : null}

            {showLifecycle() ? (
                <span
                    className="happy2-sidebar__item-lifecycle"
                    data-happy-desktop-ui="sidebar-item-lifecycle"
                    data-lifecycle={lifecycle()}
                >
                    {item().lifecycleLabel}
                </span>
            ) : null}
            {showStatus() ? (
                <>
                    {item().status === "working" ? (
                        <span
                            className="happy2-sidebar__item-working"
                            data-happy-desktop-ui="sidebar-item-working"
                        >
                            working
                        </span>
                    ) : null}
                    <span
                        aria-hidden="true"
                        className="happy2-sidebar__item-status"
                        data-happy-desktop-ui="sidebar-item-status"
                        data-status={item().status}
                    />
                </>
            ) : null}
            {showMeta() ? (
                <span
                    className="happy2-sidebar__item-meta"
                    data-happy-desktop-ui="sidebar-item-meta"
                >
                    {item().meta}
                </span>
            ) : null}
            {((state, controls, stats) =>
                /* One lane at the trailing edge, holding everything the row says
                   about itself on the right: the Git delta it reports at rest,
                   what it is doing, and the controls that act on it. They all
                   share one right-aligned column rather than queueing up beside
                   each other, so every row's delta ends at the same x whether or
                   not it also has controls, and hovering a row swaps the delta
                   and the spinner for the controls in place. */
                state || controls || stats ? (
                    <span
                        className="happy2-sidebar__item-trailing"
                        data-controls={controls ? String(trailingActions().length) : undefined}
                        data-happy-desktop-ui="sidebar-item-trailing"
                        data-swaps={controls && swapsTrailing() ? "" : undefined}
                    >
                        {/* The one child left in flow, so the lane is as wide as
                            the delta it has to show; everything else overlays
                            it. */}
                        {stats ? (
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
                                data-happy-desktop-ui="sidebar-item-change-stats"
                            >
                                {stats.added > 0 ? (
                                    <span data-tone="added">+{stats.added}</span>
                                ) : null}
                                {stats.deleted > 0 ? (
                                    <span data-tone="deleted">−{stats.deleted}</span>
                                ) : null}
                            </span>
                        ) : null}
                        {state ? (
                            <span
                                className="happy2-sidebar__item-activity"
                                data-activity={
                                    state.kind === "spinner" ? "spinner" : state.lifecycle
                                }
                                data-happy-desktop-ui="sidebar-item-activity"
                            >
                                {state.kind === "spinner" ? (
                                    <Spinner label={state.label} size={14} tone={state.tone} />
                                ) : (
                                    <span aria-label={state.label} role="img">
                                        <Icon name={state.icon} size={14} />
                                    </span>
                                )}
                            </span>
                        ) : null}
                        {controls ? trailingLane() : null}
                    </span>
                ) : null)(
                activity(),
                trailingActions().length > 0,
                hasChangeStats() ? item().changeStats! : undefined,
            )}
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
        "headerTrailing",
        "itemMenuItems",
        "onActionReorder",
        "onBack",
        "onCompose",
        "onItemSelect",
        "onItemAction",
        "onItemSecondaryAction",
        "onItemMenuSelect",
        "onItemCollapseToggle",
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
    const dragRef = useRef<{ listId: SidebarListId; drag: SidebarDrag } | undefined>(undefined);
    // Live row nodes, so a drop can read where each row was before the new order
    // is applied and animate it from there. Keyed by list as well as by row,
    // because nothing stops one caller's section from naming a row the same
    // thing another one does, and one list's registration must not delete
    // another's node out from under a drop.
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
    const [dragPaint, setDragPaint] = useState<{ listId: SidebarListId; drag: SidebarDrag }>();
    const dragSet = (next: { listId: SidebarListId; drag: SidebarDrag } | undefined): void => {
        dragRef.current = next;
        setDragPaint(next);
    };
    const dragOf = (listId: SidebarListId): SidebarDrag | undefined =>
        dragPaint?.listId === listId ? dragPaint.drag : undefined;
    const actions = local.actions ?? [];
    /**
     * Where one list's moves are reported, and whether it can be arranged at all.
     * The pinned actions and a section are told apart here and nowhere else, so
     * everything below arranges a list of rows without knowing which it has.
     */
    const reorderOf = (listId: SidebarListId): ((move: SidebarReorder) => void) | undefined => {
        if (listId === ACTIONS_LIST) return local.onActionReorder;
        const reorder = local.onItemReorder;
        return reorder ? (move) => reorder(listId, move) : undefined;
    };
    // What a keyboard move has just done, for a reader who cannot see the row
    // travel. It is written into two regions in turn: a region whose text is
    // replaced by the same words again has not changed, and a screen reader has
    // nothing to say about it, so each move speaks from the region the previous
    // one left silent.
    const [announcements, setAnnouncements] = useState<readonly [string, string]>(["", ""]);
    const [announceSlot, setAnnounceSlot] = useState(0);
    const moveAnnounce = (text: string): void => {
        const slot = announceSlot === 0 ? 1 : 0;
        setAnnounceSlot(slot);
        setAnnouncements(slot === 0 ? [text, ""] : ["", text]);
    };

    const dragStart = (
        event: ReactPointerEvent<HTMLButtonElement>,
        listId: SidebarListId,
        items: readonly SidebarItem[],
        rowIndex: number,
    ): void => {
        const { units, parentId } = dragUnitsOf(items, rowIndex);
        const blocks = units;
        const blockIndex = units.findIndex((unit) => unit.includes(rowIndex));
        dragClick.current = false;
        if (!reorderOf(listId) || event.button !== 0 || blocks.length < 2) return;
        // A pointer-down on the row's own control is that control's, not a drag.
        if ((event.target as HTMLElement).closest('[data-happy-desktop-ui="sidebar-item-action"]'))
            return;
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
                '[data-happy-desktop-ui="sidebar-item"]',
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
            listId,
            drag: {
                deltaY: 0,
                from: blockIndex,
                heights,
                moved: false,
                peers: units.map((unit) => items[unit[0]!]!.id),
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

    /**
     * Where every row is right now, held until the render that rearranges them:
     * the row that is moving where the reader left it and its neighbours where
     * they were pushed to. The rows animate from these positions to wherever the
     * new order puts them, so the one commit that moves DOM nodes happens while
     * the move is being made and never once the rows are sitting still.
     */
    const settleCapture = (
        listId: SidebarListId,
        items: readonly SidebarItem[],
        movedId: string,
    ): void => {
        const firsts = new Map<string, number>();
        for (const item of items) {
            const node = rowNodes.get(rowKey(listId, item.id));
            if (node) firsts.set(rowKey(listId, item.id), node.getBoundingClientRect().top);
        }
        flipRef.current = firsts;
        // Released lit, not resting: the highlight is handed from the drag to
        // the travelling row and only let go once it has arrived.
        setDropped(rowKey(listId, movedId));
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
    };

    const dragEnd = (
        event: ReactPointerEvent<HTMLButtonElement>,
        items: readonly SidebarItem[],
    ): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.drag.pointerId) return;
        const { drag } = current;
        if (!drag.moved) {
            dragSet(undefined);
            return;
        }
        dragClick.current = true;
        const movedId = drag.peers[drag.from];
        if (!reducedMotion() && drag.from !== drag.to && movedId !== undefined)
            settleCapture(current.listId, items, movedId);
        dragSet(undefined);
        if (drag.from === drag.to || movedId === undefined) return;
        haptic("impact");
        // Stated against the peers the drag started with: the row it now follows
        // is whichever peer precedes its landing slot once it has been lifted
        // out, and nothing at the front of the list.
        const remaining = drag.peers.filter((_, index) => index !== drag.from);
        reorderOf(current.listId)?.({
            afterId: drag.to === 0 ? null : (remaining[drag.to - 1] ?? null),
            id: movedId,
            ...(drag.parentId !== undefined ? { parentId: drag.parentId } : {}),
        });
    };

    /**
     * Lets a gesture go without moving anything. The pointer can be taken away
     * mid-drag — the system claims it, the row the reader is holding is removed
     * by something else in the workspace — and a drag that was interrupted is
     * not a drag anybody finished: the rows go back to where they were, and the
     * list must not be left holding a capture nobody will ever release.
     */
    const dragCancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.drag.pointerId) return;
        dragSet(undefined);
    };

    /*
     * The row being dragged can be taken out of the list by something else in a
     * live workspace — a machine disconnecting, a plugin unloading. Its node
     * still holds the pointer capture, and a capture released by a node that is
     * no longer in the document is announced to the document rather than to the
     * node, so the row's own handler is never called and the drag would be left
     * holding rows nobody can move any more.
     *
     * A drop that ends normally has already cleared the drag by the time its
     * capture is released, so this listener finds nothing to do and cannot take
     * a legitimate move away.
     */
    const dragLive = dragPaint !== undefined;
    // eslint-disable-next-line happy2-react/no-layout-effect -- a capture lost with its own element is announced only to the document, which no declarative boundary exposes; the listener lives for one gesture and must be removed imperatively
    useLayoutEffect(() => {
        if (!dragLive) return;
        const lost = (event: Event): void => {
            const current = dragRef.current;
            if (!current || (event as PointerEvent).pointerId !== current.drag.pointerId) return;
            dragSet(undefined);
        };
        document.addEventListener("lostpointercapture", lost);
        return () => {
            document.removeEventListener("lostpointercapture", lost);
        };
    }, [dragLive]);

    /**
     * Arranging by keyboard, for a reader who is not holding a pointer. Option
     * with an arrow rather than the arrow alone, because the bare arrows belong
     * to the reader's own way of moving through the rows, and a row that walked
     * out from under the caret would take that away.
     *
     * The row travels among exactly the peers a drag would give it — a project
     * carries its worktrees, a worktree stays inside its project — so the two
     * ways of arranging the list can never disagree about what moved.
     */
    const moveByKey = (
        event: ReactKeyboardEvent<HTMLButtonElement>,
        listId: SidebarListId,
        items: readonly SidebarItem[],
        rowIndex: number,
    ): void => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const reorder = reorderOf(listId);
        if (!reorder) return;
        // The row says it takes this shortcut, so it takes it: a list with
        // nowhere to move to, or a row already at the end of one, is not an
        // error and not a scroll either — it simply does nothing.
        event.preventDefault();
        // A hand already holds this list. Two arrangements of the same rows in
        // flight at once would each be stated against peers the other has
        // already moved, and the second would undo the first.
        if (dragRef.current) return;
        const { units, parentId } = dragUnitsOf(items, rowIndex);
        const from = units.findIndex((unit) => unit.includes(rowIndex));
        if (units.length < 2 || from < 0) return;
        const to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= units.length) return;
        const peers = units.map((unit) => items[unit[0]!]!.id);
        const movedId = peers[from]!;
        if (!reducedMotion()) settleCapture(listId, items, movedId);
        haptic("selection");
        const remaining = peers.filter((_, index) => index !== from);
        reorder({
            afterId: to === 0 ? null : (remaining[to - 1] ?? null),
            id: movedId,
            ...(parentId !== undefined ? { parentId } : {}),
        });
        moveAnnounce(
            `${items[rowIndex]!.label} moved to position ${String(to + 1)} of ${String(units.length)}`,
        );
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
        for (const [key, first] of firsts) {
            const node = rowNodes.get(key);
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
        //
        // Let go of through the animation's own promise rather than a `finish`
        // listener. This effect has no dependency list — it has to run after
        // whichever render applies the new order — so any teardown of its own
        // runs on the very next render, and a live workspace renders constantly:
        // a listener would be taken away long before the row arrived, and the
        // pass that removed it finds no capture left to re-register one, leaving
        // the row lit for good. The promise also settles when an animation is
        // cancelled with its node, which `finish` never reports.
        const last = played[played.length - 1]!;
        void last.finished.catch(() => undefined).then(() => setDropped(undefined));
        // The animations are deliberately not cancelled either: cancelling on
        // teardown would abort the drop animation on the next unrelated render.
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
            data-happy-desktop-ui="sidebar"
            style={local.style}
        >
            <header className="happy2-sidebar__header" data-happy-desktop-ui="sidebar-header">
                {local.onBack ? (
                    <div
                        className="happy2-sidebar__heading"
                        data-happy-desktop-ui="sidebar-heading"
                    >
                        <button
                            aria-label="Back"
                            className="happy2-sidebar__back"
                            data-happy-desktop-ui="sidebar-back"
                            onClick={local.onBack}
                            type="button"
                        >
                            <Icon name="chevron-right" size={16} />
                        </button>
                        <span
                            className="happy2-sidebar__title happy2-sidebar__title--back"
                            data-happy-desktop-ui="sidebar-title"
                        >
                            {local.title}
                        </span>
                    </div>
                ) : (
                    <div
                        className="happy2-sidebar__heading"
                        data-happy-desktop-ui="sidebar-heading"
                    >
                        {local.brand ? (
                            <span className="happy2-sidebar__title-row happy2-sidebar__title-row--brand">
                                <img
                                    alt=""
                                    aria-hidden="true"
                                    className="happy2-sidebar__brand-logo"
                                    data-happy-desktop-ui="sidebar-brand-logo"
                                    draggable={false}
                                    src={happyLogoUrl}
                                />
                                <span
                                    className="happy2-sidebar__title happy2-sidebar__title--brand"
                                    data-happy-desktop-ui="sidebar-title"
                                >
                                    Happy
                                </span>
                            </span>
                        ) : local.title !== undefined ? (
                            <span className="happy2-sidebar__title-row">
                                <span
                                    className="happy2-sidebar__title"
                                    data-happy-desktop-ui="sidebar-title"
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
                                data-happy-desktop-ui="sidebar-subtitle"
                            >
                                {local.subtitle}
                            </span>
                        ) : null}
                    </div>
                )}
                {local.headerTrailing ? (
                    <div
                        className="happy2-sidebar__header-trailing"
                        data-happy-desktop-ui="sidebar-header-trailing"
                    >
                        {local.headerTrailing}
                    </div>
                ) : null}
            </header>
            {local.headerAccessory ? (
                <div
                    className="happy2-sidebar__header-accessory"
                    data-happy-desktop-ui="sidebar-header-accessory"
                >
                    {local.headerAccessory}
                </div>
            ) : null}
            <div className="happy2-sidebar__body" data-happy-desktop-ui="sidebar-body">
                <div
                    className="happy2-sidebar__body-content"
                    data-happy-desktop-ui="sidebar-body-content"
                >
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
                    {actions.length > 0 ? (
                        /* The pinned rows are wrapped rather than left loose in
                           the body, because a drag measures the rows laid out
                           beside the one it started on: sharing a parent with the
                           compose row and every section would have it measuring
                           the whole sidebar. */
                        <div
                            className="happy2-sidebar__actions"
                            data-happy-desktop-ui="sidebar-actions"
                            data-reordering={dragOf(ACTIONS_LIST) ? "" : undefined}
                        >
                            {actions.map((action, index) => {
                                const drag = dragOf(ACTIONS_LIST);
                                const dragging = drag?.moved === true;
                                return (
                                    <SidebarRow
                                        active={false}
                                        className="happy2-sidebar__compose"
                                        dragging={
                                            (dragging && drag.from === index) ||
                                            rowKey(ACTIONS_LIST, action.id) === dropped
                                        }
                                        item={action}
                                        key={action.id}
                                        nodeRef={(node) => {
                                            const key = rowKey(ACTIONS_LIST, action.id);
                                            if (node) rowNodes.set(key, node);
                                            else rowNodes.delete(key);
                                        }}
                                        onKeyDown={
                                            local.onActionReorder
                                                ? (event) =>
                                                      moveByKey(event, ACTIONS_LIST, actions, index)
                                                : undefined
                                        }
                                        onPointerDown={
                                            local.onActionReorder
                                                ? (event) =>
                                                      dragStart(event, ACTIONS_LIST, actions, index)
                                                : undefined
                                        }
                                        onPointerCancel={
                                            local.onActionReorder ? dragCancel : undefined
                                        }
                                        onPointerMove={local.onActionReorder ? dragMove : undefined}
                                        onPointerUp={
                                            local.onActionReorder
                                                ? (event) => dragEnd(event, actions)
                                                : undefined
                                        }
                                        onSelect={(id) => {
                                            if (dragClick.current) {
                                                dragClick.current = false;
                                                return;
                                            }
                                            local.onItemSelect(id);
                                        }}
                                        reorderable={local.onActionReorder !== undefined}
                                        shift={
                                            dragging
                                                ? index === drag.from
                                                    ? drag.deltaY
                                                    : blockShift(drag, index)
                                                : undefined
                                        }
                                    />
                                );
                            })}
                        </div>
                    ) : null}
                    {local.bodyAccessory ? (
                        <div
                            className="happy2-sidebar__body-accessory"
                            data-happy-desktop-ui="sidebar-body-accessory"
                        >
                            {local.bodyAccessory}
                        </div>
                    ) : null}
                    {local.sections.map((section) => {
                        // The rows as they stand on screen. Everything below —
                        // the tree connectors, a drag's units, a keyboard move —
                        // is stated against these rather than against the rows
                        // the caller gave, so a row folded away can neither be
                        // dragged past nor counted as a neighbour of anything.
                        const shown = visibleRows(section.items);
                        const shownItems = shown.map((row) => row.item);
                        return (
                            <section
                                className="happy2-sidebar__section"
                                key={section.id}
                                data-happy-desktop-ui="sidebar-section"
                                data-reordering={dragOf(section.id) ? "" : undefined}
                                data-section-id={section.id}
                            >
                                {section.label ? (
                                    <div
                                        className="happy2-sidebar__section-head"
                                        data-happy-desktop-ui="sidebar-section-head"
                                    >
                                        <span
                                            className="happy2-sidebar__section-label"
                                            data-happy-desktop-ui="sidebar-section-label"
                                        >
                                            {section.label}
                                        </span>
                                        {section.status ? (
                                            <RigPeerStatus
                                                className="happy2-sidebar__section-status"
                                                name={section.label}
                                                state={section.status}
                                            />
                                        ) : null}
                                        {section.action
                                            ? ((action) => (
                                                  <button
                                                      aria-busy={action.busy ? true : undefined}
                                                      aria-label={action.label}
                                                      className="happy2-sidebar__section-action"
                                                      data-busy={action.busy ? "" : undefined}
                                                      data-happy-desktop-ui="sidebar-section-action"
                                                      data-reveal={action.reveal ?? "hover"}
                                                      disabled={action.busy || action.disabled}
                                                      onClick={() =>
                                                          local.onSectionAction?.(
                                                              section.id,
                                                              "heading",
                                                          )
                                                      }
                                                      type="button"
                                                  >
                                                      {action.busy ? (
                                                          <Spinner size={12} tone="muted" />
                                                      ) : (
                                                          <Icon name={action.icon} size={12} />
                                                      )}
                                                  </button>
                                              ))(section.action)
                                            : null}
                                    </div>
                                ) : null}
                                {section.error !== undefined ? (
                                    <p
                                        className="happy2-sidebar__section-error"
                                        data-happy-desktop-ui="sidebar-section-error"
                                        role="status"
                                    >
                                        {section.error}
                                    </p>
                                ) : null}
                                {!section.headingOnly &&
                                section.nodes &&
                                section.nodes.length > 0 ? (
                                    <SidebarNodes label={section.label} nodes={section.nodes} />
                                ) : null}
                                {!section.headingOnly
                                    ? shown.map(({ foldable, item }, index) => {
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
                                                          ? isLastAtDepth(shownItems, index)
                                                              ? "end"
                                                              : "tee"
                                                          : undefined
                                                  }
                                                  branchFirst={
                                                      (item.depth ?? 0) > 0 &&
                                                      isFirstAtDepth(shownItems, index)
                                                  }
                                                  dragging={
                                                      held ||
                                                      rowKey(section.id, item.id) === dropped
                                                  }
                                                  key={item.id}
                                                  item={item}
                                                  onContextMenu={openItemMenu}
                                                  onKeyDown={
                                                      local.onItemReorder
                                                          ? (event) =>
                                                                moveByKey(
                                                                    event,
                                                                    section.id,
                                                                    shownItems,
                                                                    index,
                                                                )
                                                          : undefined
                                                  }
                                                  onPointerDown={
                                                      local.onItemReorder
                                                          ? (event) =>
                                                                dragStart(
                                                                    event,
                                                                    section.id,
                                                                    shownItems,
                                                                    index,
                                                                )
                                                          : undefined
                                                  }
                                                  onPointerCancel={
                                                      local.onItemReorder ? dragCancel : undefined
                                                  }
                                                  onPointerMove={
                                                      local.onItemReorder ? dragMove : undefined
                                                  }
                                                  onPointerUp={
                                                      local.onItemReorder
                                                          ? (event) => dragEnd(event, shownItems)
                                                          : undefined
                                                  }
                                                  reorderable={local.onItemReorder !== undefined}
                                                  onCollapseToggle={
                                                      local.onItemCollapseToggle && foldable
                                                          ? () =>
                                                                local.onItemCollapseToggle?.(
                                                                    item.id,
                                                                )
                                                          : undefined
                                                  }
                                                  onAction={
                                                      local.onItemAction && item.action
                                                          ? () => local.onItemAction?.(item.id)
                                                          : undefined
                                                  }
                                                  onSecondaryAction={
                                                      local.onItemSecondaryAction &&
                                                      item.secondaryAction
                                                          ? () =>
                                                                local.onItemSecondaryAction?.(
                                                                    item.id,
                                                                )
                                                          : undefined
                                                  }
                                                  nodeRef={(node) => {
                                                      const key = rowKey(section.id, item.id);
                                                      if (node) rowNodes.set(key, node);
                                                      else rowNodes.delete(key);
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
                                              data-happy-desktop-ui="sidebar-section-empty"
                                          >
                                              <span
                                                  className="happy2-sidebar__empty-description"
                                                  data-happy-desktop-ui="sidebar-section-empty-description"
                                              >
                                                  {empty.description}
                                              </span>
                                              {empty.actionLabel === undefined ? null : (
                                                  <Button
                                                      className="happy2-sidebar__empty-action"
                                                      onClick={() =>
                                                          local.onSectionAction?.(
                                                              section.id,
                                                              "empty",
                                                          )
                                                      }
                                                      size="small"
                                                      variant="ghost"
                                                  >
                                                      {empty.actionLabel}
                                                  </Button>
                                              )}
                                          </div>
                                      ))((section.items.length === 0 ? section.empty : undefined)!)
                                    : null}
                            </section>
                        );
                    })}
                </div>
            </div>
            {/* A row moved by keyboard travels without the reader's caret leaving
                it, so where it has landed is said out loud here. Both regions
                are always mounted, because one that arrives with its own text is
                a region a screen reader may never have been watching. */}
            {announcements.map((text, slot) => (
                <span
                    aria-live="polite"
                    className="happy2-sidebar__announcement"
                    data-happy-desktop-ui="sidebar-announcement"
                    key={slot === 0 ? "first" : "second"}
                    role="status"
                >
                    {text}
                </span>
            ))}
            {local.footer ? (
                <footer className="happy2-sidebar__footer" data-happy-desktop-ui="sidebar-footer">
                    {local.footer}
                </footer>
            ) : null}
            {itemMenu ? (
                <div
                    className="happy2-sidebar__item-menu"
                    data-happy-desktop-ui="sidebar-item-menu"
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
