import type { P2pStatus, RigConnection } from "@slopus/rig-connect";
import type {
    RigNode,
    RigNodesReading,
    RigNodesSource,
    RigNodeTransport,
    RigNodeTransportState,
} from "happy-desktop-state";

/**
 * Adapts `rig-connect`'s P2P reader to the nodes store's source contract.
 *
 * The host Rig streams this: `connectP2p` delivers the current status once the
 * daemon answers and again on every `p2p_status_changed` it publishes, so this
 * source only opens the stream when something subscribes and closes it when the
 * last subscriber leaves. Nothing here polls, and nothing here reaches another
 * machine — the host owns its peering and this is only its report of it.
 */
export function rigConnectNodesSourceCreate(rig: RigConnection): RigNodesSource {
    return {
        subscribe(listener, onError) {
            let closed = false;
            const connection = rig.connectP2p({
                onChange: (status) => {
                    if (closed) return;
                    listener(readingProject(status));
                },
                onError: (error) => {
                    if (closed) return;
                    onError(error);
                },
            });
            return () => {
                if (closed) return;
                closed = true;
                connection.close();
            };
        },
    };
}

function readingProject(status: P2pStatus): RigNodesReading {
    return {
        transports: status.transports.map(transportProject),
        ...(status.instanceId === undefined ? {} : { instanceId: status.instanceId }),
        ...(status.name === undefined ? {} : { name: status.name }),
        ...(status.publicKey === undefined ? {} : { publicKey: status.publicKey }),
    };
}

/**
 * One transport's reading, in the store's shape.
 *
 * A ready transport is reported differently by each kind the daemon runs: only
 * Iroh has a relay, and an outbound-only transport listens nowhere and serves
 * nothing. They are read here rather than assumed to be one shape, so a host
 * peering over anything other than Iroh is described accurately instead of
 * projecting fields it never published.
 */
function transportProject(transport: P2pStatus["transports"][number]): RigNodeTransportState {
    if (transport.state === "unavailable")
        return { error: transport.error, state: "unavailable", transport: transport.transport };
    const localAddress = transport.transport === "ssh" ? undefined : transport.localAddress;
    const relayUrl = transport.transport === "iroh" ? transport.relayUrl : undefined;
    return {
        // The daemon leaves this out on a transport that serves nothing, which
        // is the same thing as not exposing the API.
        apiExposed: transport.transport === "ssh" ? false : (transport.apiExposed ?? false),
        nodes: transport.peers.map((peer) => nodeProject(peer, transport.transport)),
        state: "ready",
        transport: transport.transport,
        ...(localAddress === undefined ? {} : { localAddress }),
        ...(relayUrl === undefined ? {} : { relayUrl }),
    };
}

/**
 * One peer as this transport sees it: a single route to a machine.
 *
 * The store gathers routes into machines afterwards, so this deliberately does
 * not decide what a node is. It only records which transport reported the peer
 * and under what address, and keys the row by the identity the machine proved —
 * falling back to the address only while the machine has not identified itself
 * and therefore has no work to key by anyway.
 */
function nodeProject(
    peer: {
        address: string;
        error?: string;
        lastSeenAt?: number;
        name?: string;
        peerId?: string;
        publicKey?: string;
        rttMs?: number;
        status: "connecting" | "connected" | "unreachable";
    },
    transport: RigNodeTransport,
): RigNode {
    return {
        key: peer.peerId ?? `${transport}:${peer.address}`,
        routes: [
            {
                address: peer.address,
                status: peer.status,
                transport,
                ...(peer.error === undefined ? {} : { error: peer.error }),
                ...(peer.lastSeenAt === undefined ? {} : { lastSeenAt: peer.lastSeenAt }),
                ...(peer.rttMs === undefined ? {} : { rttMs: peer.rttMs }),
            },
        ],
        // Timing and failure live on the route. The store folds every route into
        // the machine, so stating them twice here would only invite the two
        // copies to disagree.
        status: peer.status,
        ...(peer.name === undefined ? {} : { name: peer.name }),
        ...(peer.peerId === undefined ? {} : { peerId: peer.peerId }),
        ...(peer.publicKey === undefined ? {} : { publicKey: peer.publicKey }),
    };
}
