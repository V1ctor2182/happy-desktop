import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";

/** How the host Rig's link to one node currently stands. */
export type RigNodeStatus = "connecting" | "connected" | "unreachable";

/**
 * Which transport the host Rig reaches its nodes over. The host runs whichever
 * of these it is configured for and reports each one separately, so a surface
 * names the transport rather than assuming there is only one.
 *
 * `ssh` here is one of the host's own routes to a machine it already trusts, not
 * a remote Rig someone configured: nothing in this app names a destination or
 * holds a credential for one.
 */
export type RigNodeTransport = "direct" | "iroh" | "ssh";

/**
 * One route the host has to a node: a single transport's view of that machine.
 *
 * The address is what the host actually dialled. It is deliberately kept on the
 * route rather than on the node, because a machine reached over two transports
 * has two addresses and neither of them is its identity.
 */
export interface RigNodeRoute {
    readonly transport: RigNodeTransport;
    /** Where this transport reaches the node. */
    readonly address: string;
    readonly status: RigNodeStatus;
    /** Round-trip time of the last exchange, in milliseconds. */
    readonly rttMs?: number;
    /** When the host last heard from the node over this route, in milliseconds. */
    readonly lastSeenAt?: number;
    /** Why this route is unreachable, when the host said why. */
    readonly error?: string;
}

/**
 * One machine the host Rig is peered with, gathered from every route to it.
 *
 * A node is a machine, not a link. The host may reach the same machine over more
 * than one transport, and the same machine must still be one row, one namespace,
 * and one connection — so routes are collected under the identity the machine
 * proved during its handshake rather than under whichever address answered.
 *
 * `peerId` is that identity and is the only thing a node's work is ever keyed
 * by. It is absent only while a route is still dialling and the machine on the
 * other end has not said who it is; such a node has nothing to open yet, and is
 * shown as a link being made rather than as a machine.
 */
export interface RigNode {
    /**
     * Stable identity for this row. It is the `peerId` for a machine that has
     * identified itself, and the still-dialling route's own address otherwise —
     * never a mix, so a row cannot change key when a second route appears.
     */
    readonly key: string;
    /** The machine's own instance identity, once it has identified itself. */
    readonly peerId?: string;
    /** What the machine calls itself, when it has told the host. */
    readonly name?: string;
    readonly publicKey?: string;
    /**
     * How this machine stands across all of its routes: connected when any route
     * is up, still connecting while any is trying, and unreachable only when
     * every route has failed.
     */
    readonly status: RigNodeStatus;
    /** Every route the host has to this machine, in the order the host reports them. */
    readonly routes: readonly RigNodeRoute[];
    /** The best round-trip time among connected routes, in milliseconds. */
    readonly rttMs?: number;
    /** The most recent time any route heard from this machine, in milliseconds. */
    readonly lastSeenAt?: number;
    /** Why this machine is unreachable, when every route failed and one said why. */
    readonly error?: string;
}

/**
 * What one transport of the host Rig is doing. A transport that could not start
 * carries the reason instead of a node list, so a surface reports that the host
 * cannot peer at all rather than showing an empty list that means the opposite.
 */
export type RigNodeTransportState =
    | {
          readonly transport: RigNodeTransport;
          readonly state: "unavailable";
          readonly error: string;
      }
    | {
          readonly transport: RigNodeTransport;
          readonly state: "ready";
          /**
           * Where this host itself listens, as the host reports it. Absent on a
           * transport that dials out without listening, which is a fact about
           * the transport rather than something still to arrive.
           */
          readonly localAddress?: string;
          /**
           * True when this host serves its own API to the machines it trusts.
           * It is a fact about this host, not about any peer: whether a given
           * node shares its API is answered by that node, on its own connection.
           */
          readonly apiExposed: boolean;
          readonly relayUrl?: string;
          readonly nodes: readonly RigNode[];
      };

/** One reading of the host Rig's P2P status, exactly as the host published it. */
export interface RigNodesReading {
    /** This host's own instance identity, once it has one. */
    readonly instanceId?: string;
    /** What this host calls itself, once it has a name. */
    readonly name?: string;
    readonly publicKey?: string;
    readonly transports: readonly RigNodeTransportState[];
}

/**
 * The host Rig's P2P status feed. The host streams this: a reading arrives when
 * the host first answers and again every time its status changes, so nothing
 * above ever asks for one.
 */
export interface RigNodesSource {
    subscribe(
        listener: (reading: RigNodesReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigNodesSnapshot {
    /** Every transport the host runs, in the order the host reports them. */
    readonly transports: readonly RigNodeTransportState[];
    /**
     * Every machine the host is peered with, once across all of its routes. This
     * is what a surface listing machines reads; `transports` is for a surface
     * that has to explain why there are none.
     */
    readonly nodes: readonly RigNode[];
    /** True until the host's first reading arrives, so "no nodes" is not claimed early. */
    readonly loading: boolean;
    /** This host's own identity in the network, once the host has published it. */
    readonly instanceId?: string;
    readonly name?: string;
    readonly publicKey?: string;
    /** Set when the feed itself failed; the last reading stays visible beneath it. */
    readonly error?: UserError;
}

export interface RigNodesStore {
    get(): RigNodesSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigNodesStoreDeps {
    readonly source: RigNodesSource;
}

/** Connected beats connecting beats unreachable when routes disagree. */
const STATUS_RANK: Record<RigNodeStatus, number> = {
    connected: 2,
    connecting: 1,
    unreachable: 0,
};

/**
 * Gathers every route into one row per machine.
 *
 * Two transports reporting the same `peerId` are two ways to the same machine,
 * so they become one node with two routes rather than two nodes that would each
 * claim the same namespace and open their own connection to the same place. A
 * route that has not learned a `peerId` yet cannot be merged with anything and
 * stands alone under its address, which is the only thing that distinguishes it.
 */
export function rigNodesCollect(transports: readonly RigNodeTransportState[]): readonly RigNode[] {
    const byKey = new Map<string, RigNode[]>();
    const order: string[] = [];
    for (const transport of transports) {
        if (transport.state !== "ready") continue;
        for (const node of transport.nodes) {
            const gathered = byKey.get(node.key);
            if (gathered === undefined) {
                byKey.set(node.key, [node]);
                order.push(node.key);
            } else {
                gathered.push(node);
            }
        }
    }
    // Every machine goes through the same fold, whether it was reported once or
    // several times, so a one-route node and a multi-route node describe their
    // status, timing, and failure by identical rules.
    return order.map((key) => nodeFold(key, byKey.get(key) ?? []));
}

/** Builds one machine from every reported view of it. */
function nodeFold(key: string, reported: readonly RigNode[]): RigNode {
    const routes = reported.flatMap((node) => node.routes);
    const status = routes.reduce<RigNodeStatus>(
        (best, route) => (STATUS_RANK[route.status] > STATUS_RANK[best] ? route.status : best),
        "unreachable",
    );
    return {
        key,
        routes,
        status,
        ...identityMerge(reported),
        ...rttMerge(routes),
        ...lastSeenMerge(routes),
        ...errorMerge(routes, status),
    };
}

/** The identity a machine gave over any route; a later route only fills gaps. */
function identityMerge(
    reported: readonly RigNode[],
): Pick<RigNode, "name" | "peerId" | "publicKey"> {
    const peerId = reported.find((node) => node.peerId !== undefined)?.peerId;
    const name = reported.find((node) => node.name !== undefined)?.name;
    const publicKey = reported.find((node) => node.publicKey !== undefined)?.publicKey;
    return {
        ...(peerId === undefined ? {} : { peerId }),
        ...(name === undefined ? {} : { name }),
        ...(publicKey === undefined ? {} : { publicKey }),
    };
}

/** The quickest connected route, because that is the one work would take. */
function rttMerge(routes: readonly RigNodeRoute[]): Pick<RigNode, "rttMs"> {
    let best: number | undefined;
    for (const route of routes) {
        if (route.status !== "connected" || route.rttMs === undefined) continue;
        if (best === undefined || route.rttMs < best) best = route.rttMs;
    }
    return best === undefined ? {} : { rttMs: best };
}

/** The most recent contact over any route; the machine was up at that moment. */
function lastSeenMerge(routes: readonly RigNodeRoute[]): Pick<RigNode, "lastSeenAt"> {
    let latest: number | undefined;
    for (const route of routes) {
        if (route.lastSeenAt === undefined) continue;
        if (latest === undefined || route.lastSeenAt > latest) latest = route.lastSeenAt;
    }
    return latest === undefined ? {} : { lastSeenAt: latest };
}

/**
 * Why a machine is unreachable. A route's failure is only worth reporting when
 * no other route worked: a machine reachable over Iroh is not broken because its
 * direct address stopped answering.
 */
function errorMerge(
    routes: readonly RigNodeRoute[],
    status: RigNodeStatus,
): Pick<RigNode, "error"> {
    if (status !== "unreachable") return {};
    const failed = routes.find((route) => route.error !== undefined);
    return failed?.error === undefined ? {} : { error: failed.error };
}

const EMPTY: RigNodesSnapshot = { loading: true, nodes: [], transports: [] };

/**
 * Which nodes the host Rig is peered with, and how each link is doing.
 *
 * The host owns the peering: it decides which machines it trusts, dials them,
 * and republishes its status whenever anything moves. This store only holds the
 * latest reading, so there is nothing here to act on — no connect, no
 * disconnect, no actions and no output events. Trusting a new machine is a
 * different surface with a different store, because it is a decision rather than
 * a reading. A node's projects and conversations never come through here either;
 * they arrive on that node's own connection.
 *
 * The first subscriber opens the feed and the last one to leave closes it, so a
 * window showing something else is not holding a stream open.
 */
export function rigNodesStoreCreate(deps: RigNodesStoreDeps): RigNodesStore {
    const store = createStore<RigNodesSnapshot>()(() => EMPTY);

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                store.setState(
                    {
                        loading: false,
                        nodes: rigNodesCollect(reading.transports),
                        transports: reading.transports,
                        ...(reading.instanceId === undefined
                            ? {}
                            : { instanceId: reading.instanceId }),
                        ...(reading.name === undefined ? {} : { name: reading.name }),
                        ...(reading.publicKey === undefined
                            ? {}
                            : { publicKey: reading.publicKey }),
                    },
                    true,
                );
            },
            (error) => {
                if (disposed) return;
                // The reading already held is not made untrue by a feed that
                // dropped, so only the error and the settled flag move.
                store.setState({ error: rigUserError(error), loading: false }, false);
            },
        );
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigNodesSnapshot = { loading: false, nodes: [], transports: [] };

/**
 * Nodes for a host that reports none. Permanently empty and settled rather than
 * loading, so a surface that must subscribe unconditionally reads "this host is
 * not peered with anything" instead of waiting for a reading that is not coming.
 */
export const rigNodesStoreNoop: RigNodesStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};
