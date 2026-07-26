import { partitionComponentProps } from "./componentProps";
import {
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { CountBadge } from "./Badge";
import { haptic } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
export type TabsSize = "small" | "medium" | "large";
export type TabItem = {
    id: string;
    label: string;
    icon?: IconName;
    badge?: number;
    /** An italic, replaceable document preview rather than a permanent tab. */
    preview?: boolean;
    /**
     * Whether the work behind this tab is running. It takes the leading slot and
     * spins there, so a busy tab reads as busy at a glance instead of wearing a
     * static mark that says only "something about this one is different". It
     * takes precedence over `icon`: both want the same lane, and while work is
     * running that is the thing worth showing.
     */
    busy?: boolean;
};
export type TabsProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    activeId: string;
    onSelect: (id: string) => void;
    /** Reports a tab activated with a double click, such as pinning a preview. */
    onDoubleClick?: (id: string) => void;
    tabs: TabItem[];
    size?: TabsSize;
    /**
     * Closes a tab. Supplying it gives every tab a trailing close control that
     * appears on hover and on the active tab, and stays permanently visible for
     * keyboard users once focused. Omit it for a bar whose tabs are fixed
     * sections rather than documents the reader opens and closes.
     */
    onClose?: (id: string) => void;
    /** Accessible name of the close control, for example `Close session`. */
    closeLabel?: string;
    /**
     * Commits a drag with the tab ids in their new order. Supplying it makes the
     * tabs draggable; the component only reports the order it was dragged into
     * and never reorders `tabs` itself, so the owner stays the one source of
     * order.
     */
    onReorder?: (ids: readonly string[]) => void;
};
const iconSizes: Record<TabsSize, 14 | 16 | 18> = {
    small: 14,
    medium: 16,
    large: 18,
};

/** Pointer travel that separates a click on a tab from a drag of it. */
const DRAG_THRESHOLD = 4;

/**
 * One in-progress drag. `widths` is measured once at pointer-down so the
 * geometry the drag reasons about cannot change under it while neighbours slide
 * around; `to` is where the dragged tab would land if the pointer lifted now.
 */
interface TabDrag {
    readonly id: string;
    readonly pointerId: number;
    readonly startX: number;
    readonly from: number;
    readonly to: number;
    readonly deltaX: number;
    readonly widths: readonly number[];
    /** False until the pointer passes the threshold, so a click still selects. */
    readonly moved: boolean;
}

/** Where the dragged tab lands: each neighbour it has passed by half its width. */
function dragTargetIndex(drag: TabDrag, deltaX: number): number {
    let index = drag.from;
    let travel = deltaX;
    while (travel > 0 && index < drag.widths.length - 1) {
        const next = drag.widths[index + 1]!;
        if (travel <= next / 2) break;
        travel -= next;
        index += 1;
    }
    while (travel < 0 && index > 0) {
        const previous = drag.widths[index - 1]!;
        if (-travel <= previous / 2) break;
        travel += previous;
        index -= 1;
    }
    return index;
}

/** The dragged id moved from its old index to its new one. */
function orderAfterDrag(ids: readonly string[], from: number, to: number): readonly string[] {
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
}

/**
 * How far a tab slides while another one is dragged across it: every tab between
 * the drag's origin and its target steps aside by exactly the dragged tab's
 * width, which is what makes the gap follow the pointer.
 */
function tabShift(drag: TabDrag, index: number): number {
    if (index === drag.from) return 0;
    const width = drag.widths[drag.from] ?? 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -width;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return width;
    return 0;
}
/**
 * C-025 Tabs — horizontal tab bar on a bottom hairline. Each tab is a `role=tab`
 * button that optionally carries a leading Icon and a trailing CountBadge; the
 * active tab paints a 2px accent underline that overlaps the container hairline
 * and switches its label/icon to the primary text color. Sizes 32/40/48 high.
 * With `onClose` each tab also carries a close control that reveals on hover,
 * and with `onReorder` the tabs can be dragged into a different order: the
 * dragged tab follows the pointer while its neighbours slide aside, and the new
 * order is reported once on release. Dragging a tab never selects it — a drag
 * rearranges the bar, and only a press that stays put chooses a tab.
 */
export function Tabs(props: TabsProps) {
    const [local, rest] = partitionComponentProps(props, [
        "className",
        "closeLabel",
        "style",
        "activeId",
        "onClose",
        "onDoubleClick",
        "onReorder",
        "onSelect",
        "tabs",
        "size",
    ]);
    const size = () => local.size ?? "medium";
    // The drag is local UI state: it exists only between pointer-down and
    // pointer-up and never becomes the order, which the owner keeps owning. The
    // ref is what the handlers read, so a pointer event that arrives before
    // React has re-rendered still sees the drag that the previous one started;
    // the state exists only to paint it.
    const dragRef = useRef<TabDrag | undefined>(undefined);
    // A drag ends in a click on the tab that was dragged. Rearranging tabs is
    // not choosing one, so that click is swallowed; the flag is cleared by the
    // click it belongs to, or by the next press if the browser fires none.
    const dragClick = useRef(false);
    const [drag, dragPaint] = useState<TabDrag | undefined>(undefined);
    const list = useRef<HTMLDivElement>(null);
    const dragSet = (next: TabDrag | undefined): void => {
        dragRef.current = next;
        dragPaint(next);
    };

    const dragStart = (event: ReactPointerEvent<HTMLButtonElement>, index: number): void => {
        dragClick.current = false;
        if (!local.onReorder || event.button !== 0) return;
        // A pointer-down on the close control is that control's, not a drag.
        if ((event.target as HTMLElement).closest('[data-happy2-ui="tab-close"]')) return;
        const widths = [...(list.current?.children ?? [])].map(
            (child) => (child as HTMLElement).offsetWidth,
        );
        event.currentTarget.setPointerCapture(event.pointerId);
        dragSet({
            deltaX: 0,
            from: index,
            id: local.tabs[index]!.id,
            moved: false,
            pointerId: event.pointerId,
            startX: event.clientX,
            to: index,
            widths,
        });
    };

    const dragMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        const deltaX = event.clientX - current.startX;
        if (!current.moved && Math.abs(deltaX) < DRAG_THRESHOLD) return;
        const to = dragTargetIndex(current, deltaX);
        // A tick each time the tab crosses into a new slot, matching the sidebar.
        if (to !== current.to) haptic("selection");
        dragSet({ ...current, deltaX, moved: true, to });
    };

    const dragEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        const current = dragRef.current;
        if (!current || event.pointerId !== current.pointerId) return;
        dragSet(undefined);
        if (!current.moved) return;
        dragClick.current = true;
        if (current.to === current.from) return;
        haptic("impact");
        local.onReorder?.(
            orderAfterDrag(
                local.tabs.map((tab) => tab.id),
                current.from,
                current.to,
            ),
        );
    };

    return (
        <div
            {...rest}
            className={["happy2-tabs", local.className].filter(Boolean).join(" ")}
            data-dragging={drag?.moved ? "" : undefined}
            data-happy2-ui="tabs"
            data-size={size()}
            ref={list}
            role="tablist"
            style={local.style}
        >
            {local.tabs.map((tab, index) => {
                const active = () => tab.id === local.activeId;
                const dragged = () => drag?.moved === true && drag.from === index;
                const shift = () => (drag?.moved ? tabShift(drag, index) : 0);
                return (
                    <button
                        aria-selected={active() ? "true" : "false"}
                        key={tab.id}
                        className="happy2-tabs__tab"
                        data-active={active() ? "" : undefined}
                        data-dragged={dragged() ? "" : undefined}
                        data-happy2-ui="tab"
                        data-preview={tab.preview ? "" : undefined}
                        data-reorderable={local.onReorder ? "" : undefined}
                        data-tab-id={tab.id}
                        onClick={() => {
                            if (dragClick.current) {
                                dragClick.current = false;
                                return;
                            }
                            local.onSelect(tab.id);
                        }}
                        onDoubleClick={() => local.onDoubleClick?.(tab.id)}
                        onPointerCancel={dragEnd}
                        onPointerDown={(event) => dragStart(event, index)}
                        onPointerMove={dragMove}
                        onPointerUp={dragEnd}
                        role="tab"
                        style={
                            dragged()
                                ? { transform: `translateX(${drag!.deltaX}px)` }
                                : shift() !== 0
                                  ? { transform: `translateX(${shift()}px)` }
                                  : undefined
                        }
                        type="button"
                    >
                        {tab.busy ? (
                            <span className="happy2-tabs__tab-icon" data-happy2-ui="tab-icon">
                                <Spinner
                                    label={`${tab.label} is working`}
                                    size={iconSizes[size()]}
                                    tone="muted"
                                />
                            </span>
                        ) : tab.icon ? (
                            ((name) => (
                                <span className="happy2-tabs__tab-icon" data-happy2-ui="tab-icon">
                                    <Icon name={name} size={iconSizes[size()]} />
                                </span>
                            ))(tab.icon)
                        ) : null}
                        <span className="happy2-tabs__tab-label" data-happy2-ui="tab-label">
                            {tab.label}
                        </span>
                        {tab.badge !== undefined ? (
                            <CountBadge
                                className="happy2-tabs__tab-badge"
                                count={tab.badge!}
                                tone={active() ? "accent" : "neutral"}
                            />
                        ) : null}
                        {local.onClose
                            ? ((close) => (
                                  /* A `span` because the tab itself is the
                                     button: nesting one button inside another is
                                     invalid, and this control must sit inside
                                     the tab box so it tracks its hover. */
                                  <span
                                      aria-label={local.closeLabel ?? "Close tab"}
                                      className="happy2-tabs__tab-close"
                                      data-happy2-ui="tab-close"
                                      onClick={(event) => {
                                          event.stopPropagation();
                                          close(tab.id);
                                      }}
                                      onKeyDown={(event) => {
                                          if (event.key !== "Enter" && event.key !== " ") return;
                                          event.preventDefault();
                                          event.stopPropagation();
                                          close(tab.id);
                                      }}
                                      role="button"
                                      tabIndex={0}
                                  >
                                      <Icon name="close" size={12} />
                                  </span>
                              ))(local.onClose)
                            : null}
                        {active() ? (
                            <span
                                aria-hidden="true"
                                className="happy2-tabs__tab-underline"
                                data-happy2-ui="tab-underline"
                            />
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
