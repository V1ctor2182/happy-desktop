import type { ReactNode } from "react";
import { Badge, type BadgeVariant } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { RigPeerStatus, rigPeerStatusLabel, type RigPeerState } from "../../RigPeerStatus";
import { Spinner } from "../../Spinner";
import { RigSettingsSection } from "./RigSettingsShell";

/** How the host Rig's link to one node stands, as the host reports it. */
export type RigNodeState = "connecting" | "connected" | "unreachable";

/**
 * One way the host reaches a node: a single transport's view of that machine.
 *
 * The address sits here rather than on the node because a machine reached over
 * two transports has two addresses and neither of them is its identity.
 */
export interface RigNodeRouteRow {
    /** What the host calls this route: `iroh`, `direct`, `ssh`. */
    readonly transport: string;
    /** Where this transport reaches the node. */
    readonly address: string;
    readonly state: RigNodeState;
}

/** One machine the host Rig is peered with, gathered from every route to it. */
export interface RigNodeRow {
    /** Stable identity for this row among the host's nodes. */
    readonly id: string;
    /** What to call the machine: its own name, its identity, or its address. */
    readonly name: string;
    /** How the machine stands across all of its routes. */
    readonly state: RigNodeState;
    /** The machine's own identity, once it has identified itself. */
    readonly peerId?: string;
    /** Every route the host has to this machine, in the order the host reports them. */
    readonly routes: readonly RigNodeRouteRow[];
    /** The best round-trip time among connected routes, in milliseconds. */
    readonly rttMs?: number;
    /** Why this node is unreachable, when the host said why. */
    readonly message?: string;
    /**
     * True when this window has this machine's work open — its own connection,
     * through the host, carrying its projects and conversations.
     *
     * A link the host reports as connected is not the same fact: it says the two
     * daemons can reach each other, not that this window read anything from the
     * far one. Saying both keeps this page and the sidebar from disagreeing
     * about what a connected node means.
     */
    readonly workOpen?: boolean;
    /**
     * True when the machine answered and declined to share its API.
     *
     * It is not a fault and is not shown as one: the two daemons are peered and
     * the link is up, and the machine has simply not been asked to expose its
     * work. Calling that unreachable would send the reader looking for a
     * problem on the wrong machine.
     */
    readonly accessRestricted?: boolean;
}

/** One transport the host peers over, and what it is currently doing. */
export interface RigNodeTransportRow {
    readonly transport: string;
    readonly state: "ready" | "unavailable";
    /** Where the host itself listens; present once the transport is ready. */
    readonly localAddress?: string;
    /** Why the transport could not start, when it did not. */
    readonly message?: string;
}

export type RigNodeSettingsProps = {
    /** Every node the host is peered with, once across all of its routes. */
    nodes: readonly RigNodeRow[];
    transports: readonly RigNodeTransportRow[];
    /** This host's own identity in the network, once it has published one. */
    hostId?: string;
    /** What this host calls itself, once it has a name. */
    hostName?: string;
    /**
     * The key this host proves itself with. Shown rather than asked for: it is
     * never copied into another machine's configuration — pairing is what
     * establishes trust — but it is the identity the far end will see, and a
     * person comparing two machines has a right to read it.
     */
    hostPublicKey?: string;
    /** True until the host's first status arrives, so "no nodes" is not claimed early. */
    loading?: boolean;
    /** Set when the status feed itself failed. */
    error?: string;
    /**
     * Trusting a new machine, given as a slot rather than as props of its own.
     *
     * Pairing is a decision and this page is a report, so the two are kept
     * apart: the list above answers "what is this Rig peered with", and this is
     * the one act that changes the answer. A surface with nothing to offer —
     * a window reading a Rig it does not own trust for — supplies none, and the
     * section is not drawn at all.
     */
    pairing?: ReactNode;
};

/** How a node's link reads as the shared peer marker, once access is folded in. */
function peerState(node: RigNodeRow): RigPeerState {
    // Restricted only means anything on a machine that answered, so a link that
    // is still being made or has failed keeps its own state: a node nobody can
    // reach has not declined anything.
    if (node.state === "connected" && node.accessRestricted === true) return "restricted";
    if (node.state === "connected") return "connected";
    if (node.state === "connecting") return "connecting";
    return "error";
}

const STATE_VARIANTS: Record<RigPeerState, BadgeVariant> = {
    connected: "success",
    connecting: "neutral",
    disconnected: "neutral",
    error: "warning",
    restricted: "neutral",
};

/**
 * The Nodes category: every machine the host Rig is peered with, how each link
 * is doing, and the one act that adds another.
 *
 * The host Rig owns its peering — when it dials a machine and when it gives up —
 * and this window only reads that. The exception is trust itself: a machine
 * becomes a node by being paired with, which is a decision a person takes here
 * and the host carries out. A node's projects and conversations still do not
 * arrive through this surface; they come over that node's own connection and
 * appear in the sidebar under its name.
 */
export function RigNodeSettings(props: RigNodeSettingsProps) {
    const settled = props.loading !== true;
    return (
        <>
            <RigSettingsSection
                description="Machines this Rig is peered with. It connects to them itself; their projects arrive on each machine's own connection."
                rows="cards"
                title="Nodes"
            >
                {props.error ? <Banner tone="danger">{props.error}</Banner> : null}
                {props.nodes.map((node) => (
                    <article
                        className="happy2-rig-node"
                        data-happy-desktop-ui="rig-node"
                        data-state={node.state}
                        key={node.id}
                    >
                        <header className="happy2-rig-node__header">
                            <Box className="happy2-rig-node__identity">
                                <span
                                    className="happy2-rig-node__glyph"
                                    data-happy-desktop-ui="rig-node-glyph"
                                >
                                    <Icon name="link" size={16} />
                                </span>
                                <Box className="happy2-rig-node__naming">
                                    <span
                                        className="happy2-rig-node__name"
                                        data-happy-desktop-ui="rig-node-name"
                                    >
                                        {node.name}
                                    </span>
                                    <span
                                        className="happy2-rig-node__meta"
                                        data-happy-desktop-ui="rig-node-meta"
                                    >
                                        {nodeMeta(node)}
                                    </span>
                                </Box>
                            </Box>
                            <Badge
                                label={rigPeerStatusLabel(peerState(node))}
                                variant={STATE_VARIANTS[peerState(node)]}
                            />
                        </header>
                        {node.workOpen === true ? (
                            <span
                                className="happy2-rig-node__work"
                                data-happy-desktop-ui="rig-node-work"
                            >
                                Projects and chats from this machine are open here.
                            </span>
                        ) : null}
                        {node.accessRestricted === true ? (
                            <p
                                className="happy2-rig-node__message"
                                data-happy-desktop-ui="rig-node-restricted"
                            >
                                This machine is not sharing its Rig API. Enable it there to open its
                                projects here.
                            </p>
                        ) : null}
                        {node.message ? (
                            <p
                                className="happy2-rig-node__message"
                                data-happy-desktop-ui="rig-node-message"
                            >
                                {node.message}
                            </p>
                        ) : null}
                    </article>
                ))}
                {!settled && props.nodes.length === 0 && !props.error ? (
                    <Box className="happy2-rig-settings__pending">
                        <Spinner size={16} />
                        <span>Reading this Rig&apos;s peers…</span>
                    </Box>
                ) : null}
                {settled && props.nodes.length === 0 && !props.error ? (
                    <EmptyState
                        description="This Rig is not peered with any other machine yet."
                        icon="link"
                        size="panel"
                        title="No nodes"
                    />
                ) : null}
            </RigSettingsSection>
            {props.pairing === undefined ? null : (
                <RigSettingsSection
                    description="Trust another machine by comparing four emojis on both ends. Nothing is copied by hand and no address is configured here."
                    rows="cards"
                    title="Pair a machine"
                >
                    {props.pairing}
                </RigSettingsSection>
            )}
            <RigSettingsSection
                description="How this Rig reaches other machines, and where it listens for them."
                rows="cards"
                title="Transports"
            >
                {props.hostId ? (
                    <Box className="happy2-rig-node__host" data-happy-desktop-ui="rig-node-host">
                        <span className="happy2-rig-node__host-label">This Rig</span>
                        <span
                            className="happy2-rig-node__host-value"
                            data-happy-desktop-ui="rig-node-host-value"
                        >
                            {props.hostName ? `${props.hostName} · ${props.hostId}` : props.hostId}
                        </span>
                    </Box>
                ) : null}
                {props.hostPublicKey ? (
                    <Box className="happy2-rig-node__host" data-happy-desktop-ui="rig-node-key">
                        <span className="happy2-rig-node__host-label">Public key</span>
                        <span
                            className="happy2-rig-node__host-value"
                            data-happy-desktop-ui="rig-node-key-value"
                        >
                            {props.hostPublicKey}
                        </span>
                    </Box>
                ) : null}
                {props.transports.map((transport) => (
                    <article
                        className="happy2-rig-node"
                        data-happy-desktop-ui="rig-node-transport"
                        data-state={transport.state}
                        key={transport.transport}
                    >
                        <header className="happy2-rig-node__header">
                            <Box className="happy2-rig-node__identity">
                                <RigPeerStatus
                                    name={transport.transport}
                                    state={transport.state === "ready" ? "connected" : "error"}
                                />
                                <Box className="happy2-rig-node__naming">
                                    <span
                                        className="happy2-rig-node__name"
                                        data-happy-desktop-ui="rig-node-transport-name"
                                    >
                                        {transport.transport}
                                    </span>
                                    <span
                                        className="happy2-rig-node__meta"
                                        data-happy-desktop-ui="rig-node-transport-meta"
                                    >
                                        {transport.state === "ready"
                                            ? (transport.localAddress ?? "Ready")
                                            : (transport.message ?? "Unavailable")}
                                    </span>
                                </Box>
                            </Box>
                        </header>
                    </article>
                ))}
                {!settled && props.transports.length === 0 ? (
                    <Box className="happy2-rig-settings__pending">
                        <Spinner size={16} />
                        <span>Reading this Rig&apos;s transports…</span>
                    </Box>
                ) : null}
                {settled && props.transports.length === 0 ? (
                    <EmptyState
                        description="This Rig runs no peer transport, so it reaches no other machines."
                        icon="unlink"
                        size="panel"
                        title="No transports"
                    />
                ) : null}
            </RigSettingsSection>
        </>
    );
}

/**
 * The second line of a node's card: how the host reaches it, and how quickly.
 *
 * Every route is named, because a machine reached two ways is one machine and
 * saying so is the only way the reader can tell that from two rows that happen
 * to share a name.
 */
function nodeMeta(node: RigNodeRow): string {
    const parts = node.routes.map((route) => `${route.transport} · ${route.address}`);
    if (node.rttMs !== undefined) parts.push(`${String(Math.round(node.rttMs))} ms`);
    return parts.length > 0 ? parts.join("  —  ") : (node.peerId ?? node.name);
}
