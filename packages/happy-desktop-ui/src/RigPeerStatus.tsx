/**
 * Where one Rig's connection actually is, whatever the reader asked it to be.
 *
 * `restricted` is the odd one and the important one: the machine is reachable
 * and the link is up, and it is still not sharing its work. That is a setting on
 * that machine rather than a fault in the link, so it is a state of its own —
 * calling it an error would tell the reader to go looking for a problem that
 * does not exist.
 */
export type RigPeerState = "connecting" | "connected" | "restricted" | "disconnected" | "error";

const LABELS: Record<RigPeerState, string> = {
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    error: "Not reachable",
    restricted: "Connected, access not enabled",
};

/**
 * The one word this window uses for a peer's connection. It lives beside the
 * marker so a sidebar heading, a settings card, and anything said about a machine
 * elsewhere cannot drift into three different names for the same state.
 */
export function rigPeerStatusLabel(state: RigPeerState): string {
    return LABELS[state];
}

export interface RigPeerStatusProps {
    className?: string;
    /**
     * What the peer is called. A bare marker beside a name the surface already
     * shows is silent otherwise, so this is what it says when it is read aloud.
     */
    name?: string;
    state: RigPeerState;
    /**
     * `dot` is the marker a heading carries beside a name it already shows.
     * `inline` adds the word, for a surface that is about the connection itself.
     */
    variant?: "dot" | "inline";
}

/**
 * One Rig's connection, as the same small marker everywhere it is shown. It says
 * nothing about what is on the other end: this window's own host Rig and each
 * node that Rig is peered with report where their link stands in the same terms,
 * so the reader compares them by eye.
 *
 * The marker is static in every state. A connection that is still being made is a
 * colour rather than a motion, so a window with several machines in it does not
 * animate while it starts.
 */
export function RigPeerStatus(props: RigPeerStatusProps) {
    const label = rigPeerStatusLabel(props.state);
    const described = props.name ? `${props.name}: ${label}` : label;
    const variant = props.variant ?? "dot";
    return (
        <span
            className={["happy2-rig-peer-status", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-peer-status"
            data-state={props.state}
            data-variant={variant}
            title={described}
        >
            <span
                aria-label={variant === "dot" ? described : undefined}
                aria-hidden={variant === "dot" ? undefined : true}
                className="happy2-rig-peer-status__dot"
                data-happy-desktop-ui="rig-peer-status-dot"
                role={variant === "dot" ? "img" : undefined}
            />
            {variant === "inline" ? (
                <span
                    className="happy2-rig-peer-status__label"
                    data-happy-desktop-ui="rig-peer-status-label"
                >
                    {label}
                </span>
            ) : null}
        </span>
    );
}
