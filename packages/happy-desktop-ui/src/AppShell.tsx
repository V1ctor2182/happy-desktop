import { partitionComponentProps } from "./componentProps";
import { useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";
export type AppShellProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
    children: ReactNode;
    panel?: ReactNode;
    panelWidth?: number;
    /** Optional 64px feature rail. When omitted the content spans the full body. */
    rail?: ReactNode;
    sidebar?: ReactNode;
    style?: CSSProperties;
    titleBar?: ReactNode;
    /** Enables native macOS traffic-light spacing and draggable desktop header chrome. */
    windowControls?: boolean;
    /**
     * The window is in macOS full screen, where the traffic lights are gone. The
     * chrome inset closes with them — the sidebar toggle returns to the window's
     * left edge and the headings beside it follow — while the drag lanes stay put.
     * No CSS media query reports this, so the desktop shell supplies it.
     */
    windowFullScreen?: boolean;
    /**
     * Enables the left sidebar show/hide toggle and pointer/keyboard resize. When
     * omitted the sidebar keeps its fixed `clamp(250px, 30vw, 360px)` contract and
     * renders no interaction chrome, so existing callers are unaffected.
     */
    sidebarCollapsible?: boolean;
    /** Initial sidebar width (clamped) once `sidebarCollapsible` is set. */
    sidebarDefaultWidth?: number;
    sidebarMinWidth?: number;
    sidebarMaxWidth?: number;
    /** Start collapsed. The sidebar DOM stays mounted; only its box is hidden. */
    sidebarDefaultCollapsed?: boolean;
    sidebarCollapseLabel?: string;
    sidebarExpandLabel?: string;
    sidebarResizeLabel?: string;
    /**
     * Enables pointer/keyboard resize of the right inspector panel. When omitted the
     * panel keeps its existing `panelWidth`/clamp contract and renders no handle.
     */
    panelResizable?: boolean;
    /** Initial panel width (clamped) once `panelResizable` is set; falls back to `panelWidth`. */
    panelDefaultWidth?: number;
    /**
     * Reports the width the reader has put the panel at, as they put it there.
     *
     * Supplying `panelWidth` alongside `panelResizable` hands the width to the
     * caller the same way `panelMaximized` hands over the maximize state: the
     * shell stops tracking it and only reports intent here. That is what lets a
     * host keep a width per checkout, because a width the shell owned could only
     * ever be seeded once and would then follow the reader from project to
     * project. Without `panelWidth` the shell keeps owning it and this is simply
     * a notification.
     */
    onPanelWidthChange?: (width: number) => void;
    panelMinWidth?: number;
    panelMaxWidth?: number;
    /** Enables the panel maximize/restore control that overlays the whole content region. */
    panelMaximizable?: boolean;
    panelDefaultMaximized?: boolean;
    /**
     * Controlled maximize state. When provided the caller owns whether the panel is
     * maximized (e.g. to swap in extra panel content while expanded); AppShell stops
     * tracking it internally and only reports intent through `onPanelMaximizedChange`.
     */
    panelMaximized?: boolean;
    onPanelMaximizedChange?: (maximized: boolean) => void;
    /**
     * Optional content pinned to the bottom of the panel column, below the panel
     * body. Used to keep a composer/input usable while the panel body (e.g. a live
     * trace) fills the expanded region. Rendering it does not affect the panel body's
     * identity, so the body stays mounted as the footer mounts/unmounts.
     */
    panelFooter?: ReactNode;
    /**
     * Lifts `panelFooter` out of the panel column's flow and floats it over the
     * bottom of the panel body. The body then keeps its full height as the footer
     * appears and disappears, so a scrolled position, a terminal's last lines, and
     * any measurement underneath survive it. The footer content owns its own
     * gradient and pointer-transparent regions.
     */
    panelFooterFloating?: boolean;
    panelMaximizeLabel?: string;
    panelRestoreLabel?: string;
    panelResizeLabel?: string;
};
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 340;
/**
 * The panel's width where nobody has chosen one. Exported so a host that
 * remembers the width per checkout can offer this for a checkout that has never
 * been sized, instead of restating the number and drifting from it.
 */
export const APP_SHELL_PANEL_DEFAULT_WIDTH = PANEL_DEFAULT_WIDTH;
const PANEL_MIN_WIDTH = 280;
/**
 * How much of the window the panel may take, and the cap where the window's
 * width cannot be read.
 *
 * The panel holds a terminal, a file, and a composer, so on a wide display it
 * is often the side being worked in — a fixed few hundred pixels made that
 * impossible. A fraction rather than a number keeps the workspace column a real
 * column at every size: the remaining 30% is what stops a panel dragged to the
 * end from swallowing the transcript beside it.
 *
 * It is read at render, and a drag re-renders on every step, so the bound
 * follows a window being resized without this component watching for it.
 */
const PANEL_MAX_FRACTION = 0.7;
const PANEL_MAX_WIDTH = 560;
function panelMaxWidthOf(): number {
    const viewport = typeof window === "undefined" ? 0 : window.innerWidth;
    if (!(viewport > 0)) return PANEL_MAX_WIDTH;
    return Math.max(PANEL_MIN_WIDTH, Math.round(viewport * PANEL_MAX_FRACTION));
}
const FIXED_SIDEBAR_MIN_WIDTH = 250;
const RESIZE_HANDLE_WIDTH = 8;
const REVEAL_WIDTH = 48;
const WORKSPACE_MIN_WIDTH = 140;
function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
/**
 * A vertical drag divider. It is the ARIA `separator` that owns the adjacent
 * region's width: pointer drags use pointer capture (no window listeners), and
 * Arrow/Home/End keys nudge the boundary. `edge` names which side of the region
 * the handle sits on, so the same math grows the sidebar (handle on its right)
 * and the panel (handle on its left). All resize state is local UI state; the
 * caller receives only clamped width values through `onResize`.
 */
function ResizeHandle(props: {
    edge: "left" | "right";
    label: string;
    max: number;
    min: number;
    onResize: (next: number) => void;
    step?: number;
    value: number;
}) {
    const drag = useRef<{ pointerX: number; width: number } | null>(null);
    const sign = props.edge === "right" ? 1 : -1;
    const step = props.step ?? 16;
    function apply(width: number) {
        props.onResize(clamp(Math.round(width), props.min, props.max));
    }
    return (
        <div
            aria-label={props.label}
            aria-orientation="vertical"
            aria-valuemax={props.max}
            aria-valuemin={props.min}
            aria-valuenow={Math.round(props.value)}
            className="happy-desktop-app-shell__resize-handle"
            data-edge={props.edge}
            data-happy-desktop-ui="app-shell-resize-handle"
            onKeyDown={(event) => {
                const keyDelta =
                    event.key === "ArrowRight"
                        ? step
                        : event.key === "ArrowLeft"
                          ? -step
                          : undefined;
                if (keyDelta !== undefined) {
                    event.preventDefault();
                    apply(props.value + sign * keyDelta);
                } else if (event.key === "Home") {
                    event.preventDefault();
                    apply(props.edge === "right" ? props.min : props.max);
                } else if (event.key === "End") {
                    event.preventDefault();
                    apply(props.edge === "right" ? props.max : props.min);
                }
            }}
            onLostPointerCapture={() => {
                drag.current = null;
            }}
            onPointerCancel={() => {
                drag.current = null;
            }}
            onPointerDown={(event) => {
                event.preventDefault();
                drag.current = { pointerX: event.clientX, width: props.value };
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                    // Synthetic or already-released pointers cannot be captured; the
                    // move handler still works when events target this element.
                }
            }}
            onPointerMove={(event) => {
                const start = drag.current;
                if (!start) return;
                apply(start.width + sign * (event.clientX - start.pointerX));
            }}
            onPointerUp={(event) => {
                drag.current = null;
                try {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                } catch {
                    // Capture may already be lost; clearing drag state above is enough.
                }
            }}
            role="separator"
            // A focusable window splitter is an intentionally interactive separator
            // (WAI-ARIA window-splitter pattern): it must take keyboard focus so the
            // Arrow/Home/End resize keys above are reachable without a pointer.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable resize separator
            tabIndex={0}
        >
            <span
                className="happy-desktop-app-shell__resize-line"
                data-happy-desktop-ui="app-shell-resize-line"
            />
        </div>
    );
}
/*
 * Window composition for the Happy desktop app. An optional title bar row,
 * then rail | navigation | workspace and an optional right inspector. Every
 * region meets on a hairline so the desktop feels like one native surface.
 *
 * The sidebar collapse/resize, the panel resize, and the panel maximize/restore
 * are narrowly scoped local UI interactions owned here so application code stays
 * props-only. Maximize overlays the workspace only, preserving the left sidebar's
 * visibility and interaction while keeping every region mounted so focus, scroll,
 * and any in-flight content survive the transition.
 */
export function AppShell(props: AppShellProps) {
    const [local, rest] = partitionComponentProps(props, [
        "children",
        "className",
        "panel",
        "panelWidth",
        "rail",
        "sidebar",
        "style",
        "titleBar",
        "windowControls",
        "windowFullScreen",
        "sidebarCollapsible",
        "sidebarDefaultWidth",
        "sidebarMinWidth",
        "sidebarMaxWidth",
        "sidebarDefaultCollapsed",
        "sidebarCollapseLabel",
        "sidebarExpandLabel",
        "sidebarResizeLabel",
        "panelResizable",
        "onPanelWidthChange",
        "panelDefaultWidth",
        "panelMinWidth",
        "panelMaxWidth",
        "panelMaximizable",
        "panelDefaultMaximized",
        "panelMaximized",
        "onPanelMaximizedChange",
        "panelFooter",
        "panelFooterFloating",
        "panelMaximizeLabel",
        "panelRestoreLabel",
        "panelResizeLabel",
    ]);
    const sidebarMin = local.sidebarMinWidth ?? SIDEBAR_MIN_WIDTH;
    const sidebarMax = local.sidebarMaxWidth ?? SIDEBAR_MAX_WIDTH;
    const panelMin = local.panelMinWidth ?? PANEL_MIN_WIDTH;
    const panelMax = local.panelMaxWidth ?? panelMaxWidthOf();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(
        local.sidebarDefaultCollapsed ?? false,
    );
    const [sidebarWidth, setSidebarWidth] = useState(() =>
        clamp(local.sidebarDefaultWidth ?? SIDEBAR_DEFAULT_WIDTH, sidebarMin, sidebarMax),
    );
    const [panelWidthState, setPanelWidthState] = useState(() =>
        clamp(
            local.panelDefaultWidth ?? local.panelWidth ?? PANEL_DEFAULT_WIDTH,
            panelMin,
            panelMax,
        ),
    );
    const [panelMaximizedState, setPanelMaximizedState] = useState(
        local.panelDefaultMaximized ?? false,
    );
    // Controlled when the caller supplies `panelMaximized`; otherwise AppShell owns it.
    const panelMaximizedControlled = local.panelMaximized !== undefined;
    const panelMaximized = panelMaximizedControlled ? local.panelMaximized! : panelMaximizedState;
    function togglePanelMaximized() {
        const next = !panelMaximized;
        if (!panelMaximizedControlled) setPanelMaximizedState(next);
        local.onPanelMaximizedChange?.(next);
    }
    const sidebarInteractive = local.sidebarCollapsible === true;
    const panelResizable = local.panelResizable === true;
    // Controlled when a resizable panel is given a width; otherwise AppShell owns
    // it, exactly as `panelMaximized` above.
    const panelWidthControlled = panelResizable && local.panelWidth !== undefined;
    const panelWidth = panelWidthControlled
        ? clamp(local.panelWidth!, panelMin, panelMax)
        : panelWidthState;
    function applyPanelWidth(next: number) {
        if (!panelWidthControlled) setPanelWidthState(next);
        local.onPanelWidthChange?.(next);
    }
    const panelMaximizable = local.panelMaximizable === true;
    const showSidebarHandle = sidebarInteractive && !sidebarCollapsed;
    const sidebarStyle: CSSProperties | undefined = sidebarInteractive
        ? {
              width: `${sidebarWidth}px`,
              minWidth: `${sidebarMin}px`,
              maxWidth: `${sidebarMax}px`,
          }
        : undefined;
    const panelStyle: CSSProperties | undefined = panelMaximized
        ? undefined
        : panelResizable
          ? {
                width: `${panelWidth}px`,
                minWidth: `${panelMin}px`,
                // Where the bound is this component's own it is also stated as
                // a fraction of the viewport, which the browser keeps current:
                // a window shrunk between renders narrows the panel with it
                // rather than waiting for the next one. A caller that named a
                // width means that width.
                maxWidth:
                    local.panelMaxWidth === undefined
                        ? `min(${panelMax}px, ${String(PANEL_MAX_FRACTION * 100)}vw)`
                        : `${panelMax}px`,
            }
          : local.panelWidth === undefined
            ? undefined
            : { width: `${local.panelWidth}px` };
    const sidebarHidden = sidebarInteractive && sidebarCollapsed;
    // Under native window controls a collapsed sidebar leaves no lane behind: the
    // reveal control floats beside the traffic lights, exactly where the collapse
    // control sat, and the workspace takes the whole width.
    const revealFloating = sidebarHidden && local.windowControls === true;
    const sidebarLayoutMin = !local.sidebar
        ? 0
        : revealFloating
          ? 0
          : sidebarHidden
            ? REVEAL_WIDTH
            : sidebarInteractive
              ? sidebarMin + RESIZE_HANDLE_WIDTH
              : FIXED_SIDEBAR_MIN_WIDTH;
    const sidebarFootprint = !local.sidebar
        ? "0px"
        : revealFloating
          ? "0px"
          : sidebarHidden
            ? `${REVEAL_WIDTH}px`
            : sidebarInteractive
              ? `${sidebarWidth + RESIZE_HANDLE_WIDTH}px`
              : "clamp(250px, 30vw, 360px)";
    const revealButton = sidebarHidden ? (
        <button
            aria-label={local.sidebarExpandLabel ?? "Show sidebar"}
            className="happy-desktop-app-shell__reveal-button"
            data-floating={revealFloating ? "" : undefined}
            data-happy-desktop-ui="app-shell-reveal-button"
            onClick={() => setSidebarCollapsed(false)}
            type="button"
        >
            <Icon name="sidebar-expand" size={14} />
        </button>
    ) : null;
    // Floating, the control is the bare button rather than a lane wrapping it:
    // a wrapper around a control docked over native window chrome is what stops
    // the pointer reaching it, so the collapsed toggle is structurally the same
    // element as the expanded one and only its position differs.
    const reveal = revealFloating ? (
        revealButton
    ) : sidebarHidden ? (
        <div
            className="happy-desktop-app-shell__reveal"
            data-happy-desktop-ui="app-shell-reveal"
            data-window-controls={local.windowControls ? "" : undefined}
        >
            {revealButton}
        </div>
    ) : null;
    const mainStyle: CSSProperties = {
        minWidth: `${sidebarLayoutMin + WORKSPACE_MIN_WIDTH}px`,
    };
    const contentStyle = {
        "--happy-desktop-app-shell-panel-expanded-left": sidebarFootprint,
    } as CSSProperties;
    return (
        <div
            {...rest}
            className={["happy-desktop-app-shell", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="app-shell"
            data-sidebar-collapsed={sidebarHidden ? "" : undefined}
            data-window-controls={local.windowControls ? "" : undefined}
            data-window-full-screen={local.windowFullScreen ? "" : undefined}
            style={local.style}
        >
            {local.windowControls ? (
                <div
                    aria-hidden="true"
                    className="happy-desktop-app-shell__window-controls"
                    data-happy-desktop-ui="app-shell-window-controls"
                >
                    <span
                        className="happy-desktop-app-shell__traffic-light-reservation"
                        data-happy-desktop-ui="title-bar-controls"
                    />
                </div>
            ) : null}
            {local.windowControls && !local.sidebar && !local.titleBar ? (
                <div
                    aria-hidden="true"
                    className="happy-desktop-app-shell__standalone-title-bar"
                    data-happy-desktop-ui="app-shell-standalone-title-bar"
                />
            ) : null}
            {local.titleBar ? (
                <div
                    className="happy-desktop-app-shell__title-bar"
                    data-happy-desktop-ui="app-shell-title-bar"
                >
                    {local.titleBar}
                </div>
            ) : null}
            <div className="happy-desktop-app-shell__body" data-happy-desktop-ui="app-shell-body">
                {local.rail ? (
                    <div
                        className="happy-desktop-app-shell__rail"
                        data-happy-desktop-ui="app-shell-rail"
                    >
                        {local.rail}
                    </div>
                ) : null}
                <div
                    className="happy-desktop-app-shell__content"
                    data-happy-desktop-ui="app-shell-content"
                    style={contentStyle}
                >
                    <main
                        className="happy-desktop-app-shell__main"
                        data-happy-desktop-ui="app-shell-main"
                        style={mainStyle}
                    >
                        {revealFloating ? null : reveal}
                        {local.sidebar ? (
                            <div
                                className="happy-desktop-app-shell__sidebar"
                                data-collapsed={
                                    sidebarInteractive && sidebarCollapsed ? "" : undefined
                                }
                                data-happy-desktop-ui="app-shell-sidebar"
                                data-resizable={sidebarInteractive ? "" : undefined}
                                style={sidebarStyle}
                            >
                                {local.sidebar}
                                {sidebarInteractive ? (
                                    <button
                                        aria-label={local.sidebarCollapseLabel ?? "Hide sidebar"}
                                        className="happy-desktop-app-shell__sidebar-collapse"
                                        data-happy-desktop-ui="app-shell-sidebar-collapse"
                                        onClick={() => setSidebarCollapsed(true)}
                                        type="button"
                                    >
                                        <Icon name="sidebar-collapse" size={14} />
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                        {showSidebarHandle ? (
                            <ResizeHandle
                                edge="right"
                                label={local.sidebarResizeLabel ?? "Resize sidebar"}
                                max={sidebarMax}
                                min={sidebarMin}
                                onResize={setSidebarWidth}
                                value={sidebarWidth}
                            />
                        ) : null}
                        <div
                            className="happy-desktop-app-shell__workspace"
                            data-happy-desktop-ui="app-shell-workspace"
                        >
                            {local.children}
                        </div>
                    </main>
                    {local.panel && panelResizable && !panelMaximized ? (
                        <ResizeHandle
                            edge="left"
                            label={local.panelResizeLabel ?? "Resize panel"}
                            max={panelMax}
                            min={panelMin}
                            onResize={applyPanelWidth}
                            value={panelWidth}
                        />
                    ) : null}
                    {local.panel ? (
                        <aside
                            className="happy-desktop-app-shell__panel"
                            data-happy-desktop-ui="app-shell-panel"
                            data-maximized={panelMaximized ? "" : undefined}
                            data-resizable={panelResizable ? "" : undefined}
                            style={panelStyle}
                        >
                            <div
                                className="happy-desktop-app-shell__panel-content"
                                data-happy-desktop-ui="app-shell-panel-content"
                            >
                                {local.panel}
                            </div>
                            {local.panelFooter ? (
                                <div
                                    className="happy-desktop-app-shell__panel-footer"
                                    data-floating={local.panelFooterFloating ? "" : undefined}
                                    data-happy-desktop-ui="app-shell-panel-footer"
                                >
                                    {local.panelFooter}
                                </div>
                            ) : null}
                            {panelMaximizable ? (
                                <button
                                    aria-label={
                                        panelMaximized
                                            ? (local.panelRestoreLabel ?? "Restore panel")
                                            : (local.panelMaximizeLabel ?? "Expand panel")
                                    }
                                    aria-pressed={panelMaximized}
                                    className="happy-desktop-app-shell__panel-toggle"
                                    data-happy-desktop-ui="app-shell-panel-toggle"
                                    onClick={togglePanelMaximized}
                                    type="button"
                                >
                                    <span
                                        className={
                                            panelMaximized
                                                ? undefined
                                                : "happy-desktop-app-shell__chevron-left"
                                        }
                                    >
                                        <Icon name="chevron-right" size={16} />
                                    </span>
                                </button>
                            ) : null}
                        </aside>
                    ) : null}
                </div>
            </div>
            {/* Last, after every drag surface in the body. Native draggable
                regions are collected in tree order and later rectangles win, so
                a control that punches a hole in one has to come after it — the
                same order the sidebar's own toggle already sits in. */}
            {revealFloating ? reveal : null}
        </div>
    );
}
