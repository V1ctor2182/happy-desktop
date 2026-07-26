import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { Tabs, type TabItem, type TabsSize } from "./Tabs";

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
    size?: TabsSize;
    /**
     * Controls pinned to the trailing end of the bar, outside the tab strip's
     * scrollport — an "add tab" affordance stays reachable however many tabs
     * there are.
     */
    actions?: ReactNode;
};

/**
 * C-160 TabbedPane — a tab bar over a body that fills the remaining height, for
 * a surface whose content region hosts several peer documents.
 *
 * The bar is the component's reason to exist: it is a fixed row that never
 * grows, so an unbounded number of tabs scrolls horizontally inside it instead
 * of squeezing the trailing actions off the surface or wrapping into a second
 * row that would move the body. Labels truncate at a fixed tab width so the
 * strip stays scannable, and the body owns its own scrollports.
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
        "size",
        "style",
        "tabs",
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
                    <Tabs
                        activeId={local.activeId}
                        className="happy2-tabbed-pane__tabs"
                        closeLabel={local.closeLabel}
                        onClose={local.onClose}
                        onDoubleClick={local.onDoubleClick}
                        onReorder={local.onReorder}
                        onSelect={local.onSelect}
                        size={local.size ?? "small"}
                        tabs={local.tabs}
                    />
                </div>
                {local.actions ? (
                    <div
                        className="happy2-tabbed-pane__actions"
                        data-happy2-ui="tabbed-pane-actions"
                    >
                        {local.actions}
                    </div>
                ) : null}
            </div>
            <div className="happy2-tabbed-pane__body" data-happy2-ui="tabbed-pane-body">
                {local.children}
            </div>
        </div>
    );
}
