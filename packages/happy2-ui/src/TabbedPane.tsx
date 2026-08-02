import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { type MenuItem } from "./Menu";
import { Tabs, type TabItem, type TabsSize } from "./Tabs";
import type { TabTransferTarget } from "./tabTransfer";

export type TabbedPaneProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** The pane's body: the content of the active tab. */
    children: ReactNode;
    tabs: TabItem[];
    activeId: string;
    onSelect: (id: string) => void;
    /** Reports a tab activated with a double click, such as pinning a preview. */
    onDoubleClick?: (id: string) => void;
    /** Closes a tab; supplying it gives every tab a hover-revealed close control. */
    onClose?: (id: string) => void;
    /** Accessible name of the close control, for example `Close session`. */
    closeLabel?: string;
    /** Commits a drag with the tab ids in their new order; supplying it makes tabs draggable. */
    onReorder?: (ids: readonly string[]) => void;
    /** Returns the context-menu actions available for one tab. Empty means no menu. */
    tabMenuItems?: (tab: TabItem) => MenuItem[];
    onTabMenuSelect?: (tab: TabItem, actionId: string) => void;
    /** Where a tab from this pane may be moved to; see `Tabs`. */
    transferTargets?: readonly TabTransferTarget[];
    /** Whether one tab may leave this pane at all. Default: all may. */
    transferable?: (tab: TabItem) => boolean;
    /** Reports a tab moved into one of the targets. The owner performs the move. */
    onTransfer?: (tabId: string, zone: string) => void;
    size?: TabsSize;
    /**
     * Controls that ride directly after the last tab, such as an "add tab"
     * affordance. They sit inside the strip's scrollport so they read as the
     * next thing after the tabs, and stick to the trailing edge once the strip
     * overflows, so they stay reachable however many tabs there are.
     */
    actions?: ReactNode;
};

/**
 * C-160 TabbedPane — a tab bar over a body that fills the remaining height, for
 * a surface whose content region hosts several peer documents.
 *
 * The bar is the component's reason to exist: it is a fixed row that never
 * grows, so an unbounded number of tabs scrolls horizontally inside it instead
 * of wrapping into a second row that would move the body. Labels truncate at a
 * fixed tab width so the strip stays scannable, and the body owns its own
 * scrollports. The trailing actions scroll with the tabs while they fit and
 * stick to the trailing edge once they do not, so they are never scrolled off.
 *
 * It renders exactly one body — whatever the owner passes as `children` for the
 * active tab — so switching tabs is the owner's state change, not a hidden
 * mount of every tab at once.
 */
export function TabbedPane(props: TabbedPaneProps) {
    const [local, rest] = partitionComponentProps(props, [
        "actions",
        "activeId",
        "children",
        "className",
        "closeLabel",
        "onClose",
        "onDoubleClick",
        "onReorder",
        "onSelect",
        "onTabMenuSelect",
        "onTransfer",
        "size",
        "style",
        "tabMenuItems",
        "tabs",
        "transferTargets",
        "transferable",
    ]);
    return (
        <div
            {...rest}
            className={["happy2-tabbed-pane", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="tabbed-pane"
            style={local.style}
        >
            <div className="happy2-tabbed-pane__bar" data-happy2-ui="tabbed-pane-bar">
                <div className="happy2-tabbed-pane__scroller" data-happy2-ui="tabbed-pane-scroller">
                    {/* The strip is only as wide as the tabs and their actions,
                        which is what bounds the sticky actions: with room to
                        spare they stay beside the last tab instead of drifting
                        to the far edge of an empty scrollport. */}
                    <div className="happy2-tabbed-pane__strip" data-happy2-ui="tabbed-pane-strip">
                        <Tabs
                            activeId={local.activeId}
                            className="happy2-tabbed-pane__tabs"
                            closeLabel={local.closeLabel}
                            onClose={local.onClose}
                            onDoubleClick={local.onDoubleClick}
                            onReorder={local.onReorder}
                            onSelect={local.onSelect}
                            onTabMenuSelect={local.onTabMenuSelect}
                            onTransfer={local.onTransfer}
                            size={local.size ?? "small"}
                            tabMenuItems={local.tabMenuItems}
                            tabs={local.tabs}
                            transferTargets={local.transferTargets}
                            transferable={local.transferable}
                        />
                        {local.actions ? (
                            <div
                                className="happy2-tabbed-pane__actions"
                                data-happy2-ui="tabbed-pane-actions"
                            >
                                {local.actions}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="happy2-tabbed-pane__body" data-happy2-ui="tabbed-pane-body">
                {local.children}
            </div>
        </div>
    );
}
