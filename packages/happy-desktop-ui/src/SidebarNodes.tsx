import { Icon } from "./Icon";
import { RigPeerStatus, rigPeerStatusLabel, type RigPeerState } from "./RigPeerStatus";

/** One machine this Rig is peered with, as the sidebar states it. */
export interface SidebarNode {
    /** What the row says beside the name, e.g. the address it was reached at. */
    detail?: string;
    id: string;
    label: string;
    state: RigPeerState;
}

export interface SidebarNodesProps {
    className?: string;
    /** The heading this list sits under, so the list is named when read aloud. */
    label?: string;
    nodes: readonly SidebarNode[];
}

/**
 * The machines this Rig is peered with that this window has no connection to,
 * listed in the sidebar as a report rather than as navigation.
 *
 * Nothing here is pressable, and that is the point: these are the machines with
 * nothing to open — still being dialled, unreachable, or not far enough through
 * their handshake to be addressed — so a row that looked like the rows above it
 * would be a button that goes nowhere. A machine the window did reach is not
 * here at all: it is a section of its own, carrying that machine's projects
 * under its own name, because there is a real connection behind it.
 *
 * The rows keep the sidebar's own rhythm — same height, same inset, same glyph
 * lane — so the block reads as part of the column instead of an insert into it.
 */
export function SidebarNodes(props: SidebarNodesProps) {
    return (
        <ul
            aria-label={props.label}
            className={["happy2-sidebar-nodes", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="sidebar-nodes"
        >
            {props.nodes.map((node) => (
                <li
                    className="happy2-sidebar-nodes__row"
                    data-happy-desktop-ui="sidebar-nodes-row"
                    data-state={node.state}
                    key={node.id}
                    title={`${node.label}: ${rigPeerStatusLabel(node.state)}`}
                >
                    <span
                        className="happy2-sidebar-nodes__glyph"
                        data-happy-desktop-ui="sidebar-nodes-glyph"
                    >
                        <Icon name="link" size={14} />
                    </span>
                    <span
                        className="happy2-sidebar-nodes__label"
                        data-happy-desktop-ui="sidebar-nodes-label"
                    >
                        {node.label}
                    </span>
                    {node.detail !== undefined ? (
                        <span
                            className="happy2-sidebar-nodes__detail"
                            data-happy-desktop-ui="sidebar-nodes-detail"
                        >
                            {node.detail}
                        </span>
                    ) : null}
                    <RigPeerStatus
                        className="happy2-sidebar-nodes__status"
                        name={node.label}
                        state={node.state}
                    />
                </li>
            ))}
        </ul>
    );
}
