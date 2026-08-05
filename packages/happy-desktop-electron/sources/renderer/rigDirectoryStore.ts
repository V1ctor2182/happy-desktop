import type {
    RigHost,
    RigNodesSnapshot,
    RigModelPreferencePersistence,
    RigProjectAddSnapshot,
    RigProjectGroup,
    RigSessionLocation,
} from "happy-desktop-state";
import type { HappyDesktopBridge } from "../shared/desktopContract";
import {
    rigConnectionOpen,
    rigPeerConnectEndpoint,
    type RigConnectionHandle,
    type RigSession,
} from "./rigConnection";
import type { DesktopRuntimeStore } from "./runtimeStore";

/** The identity of the Rig this window is hosted by, and the one it reaches the rest through. */
export const LOCAL_RIG_ID = "local";

/**
 * The prefix that tells a node's entry from the host's, and from any other id.
 *
 * A Rig's id travels in the URL as a path parameter, and a node's identity is
 * lower-case letters and digits, so this keeps the whole namespaced id inside
 * the characters a path segment carries unescaped. The host is `local`, which
 * cannot start with it, and two nodes cannot share one identity on one host.
 */
const NODE_RIG_PREFIX = "node-";

/** One node's identity in this window, namespaced so it can collide with nothing. */
export function rigNodeId(nodeId: string): string {
    return `${NODE_RIG_PREFIX}${nodeId}`;
}

export interface RigDirectoryEntry {
    /** The host Rig's identity, or one node's under `node:`. */
    readonly id: string;
    readonly label: string;
    /**
     * Set on a Rig reached through the host: the node identity the host itself
     * published for it. It is what the sidebar groups that machine's work under
     * and what the peer connection is addressed by.
     */
    readonly nodeId?: string;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    /**
     * True when this Rig is reachable but is not sharing its API.
     *
     * Only a node can be in this state, and it is not an error: the host and
     * that machine are peered and the link is up, but the machine has not been
     * asked to expose its work. It stays connected and simply has nothing to
     * show, which is what the surface says rather than calling it offline.
     */
    readonly accessRestricted?: boolean;
    readonly message?: string;
    readonly version?: string;
    /** This machine's projects, kept live while the Rig is connected. */
    readonly projects: readonly RigProjectGroup[];
    /** Where that project list is: still arriving, ready, or refused by the daemon. */
    readonly projectsStatus: "loading" | "ready" | "error";
    /**
     * Where adding a folder to this Rig as a project stands. Projected beside the
     * projects because the sidebar shows both in one place — the list, and the
     * control that adds to it — through this one subscription.
     */
    readonly projectAdd: RigProjectAddSnapshot;
    /** The product stores for this Rig, present once its connection is up. */
    readonly session?: RigSession;
}

export interface RigDirectorySnapshot {
    /**
     * The Rig the window is addressing, resolved against the ones that are
     * actually here. It is published because it is the only synchronous answer
     * to "which machine is this window on" — a surface deciding something at the
     * moment a person acts cannot ask the render that drew the control.
     *
     * It names a Rig in `rigs` or it is absent. A remembered machine the reader
     * removes hands the window back to this one, the same way the screens do;
     * with no Rig at all — before the directory is running, or after it has been
     * torn down — there is nothing to address and a press has nowhere to land.
     */
    readonly activeRigId?: string;
    readonly rigs: readonly RigDirectoryEntry[];
}

export interface RigDirectoryStore {
    get(): RigDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Records which Rig the window is addressing, so window-level host events —
     * a URL handed to the app to open — land in the workspace the reader is
     * actually looking at rather than always on this machine.
     */
    rigActivate(id: string): void;
}

interface LiveRig {
    connection?: RigConnectionHandle;
    /**
     * What the connector made of this daemon's protocol, while the two cannot
     * read each other. Held apart from the entry because it outlives the state
     * the entry is rebuilt from: a Rig whose stores come up anyway must not
     * publish itself as plainly connected and drop the reason its surfaces are
     * empty.
     */
    compatibilityMessage?: string;
    entry: RigDirectoryEntry;
    /** The proxy URL the current connection was opened on, or none while down. */
    url?: string;
    workspaceUnsubscribe?: () => void;
}

/**
 * The nodes a connection should be opened to, from one reading of the host's
 * peer status.
 *
 * Only a node that is connected and has identified itself qualifies. The
 * identity is the point: the host's route to a machine is addressed by the
 * identity that machine proved during its handshake, so a peer that is still
 * dialling has an address and nothing to address yet. A machine that is merely
 * unreachable is not one to open a connection to either — the host is already
 * retrying it, and its status is what the reader is shown meanwhile.
 */
function nodeTargets(nodes: RigNodesSnapshot): readonly string[] {
    const seen = new Set<string>();
    for (const node of nodes.nodes) {
        if (node.status !== "connected" || node.peerId === undefined) continue;
        seen.add(node.peerId);
    }
    return [...seen];
}

/** What a Rig with no connection reports about adding a project: nothing is happening. */
const PROJECT_ADD_IDLE: RigProjectAddSnapshot = { pending: false };

export interface RigDirectoryDeps {
    /** Navigates to a conversation the named Rig just created. */
    readonly conversationOpen: (rigId: string, location: RigSessionLocation) => void;
    /** Navigates to a group of the named Rig that holds no conversation yet. */
    readonly groupOpen: (rigId: string, groupId: string) => void;
    /**
     * Replaces the address with the named Rig's list because that Rig's group
     * stopped existing. Both identities travel: the window addresses one Rig at
     * a time and a background one reporting a removal must not move the reader.
     */
    readonly listOpen: (rigId: string, groupId: string) => void;
    /** Desktop-wide model memory for this window's Rig connection. */
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
}

/**
 * The Rigs this window works in: its host, and one for every machine that host
 * is peered with and has reached.
 *
 * The host is the only one Happy connects to directly; it owns the trust and
 * the transport, and every node is reached through its route to that machine. A
 * node is not a different kind of thing once it is reached, though — it is an
 * ordinary Rig connection with its own stores, its own projects, and its own
 * conversations, because a machine's work belongs to that machine and does not
 * travel to the host to be handed on. So this file keeps one connection per Rig
 * and everything above it is written against `RigSession` alone, whichever
 * machine that session is of.
 *
 * The store follows the desktop runtime for the host daemon's loopback proxy
 * URL and the host's own peer status for the rest. Projects are projected here
 * so one subscription feeds the whole sidebar; a screen still reads the
 * workspace store directly.
 */
export function rigDirectoryStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    deps: RigDirectoryDeps,
): RigDirectoryStore {
    const rigs = new Map<string, LiveRig>();
    const listeners = new Set<() => void>();
    let snapshot: RigDirectorySnapshot = { rigs: [] };
    let order: readonly string[] = [];
    /** The reader's standing choice of machine, which may name one that has gone. */
    let activeRigId = LOCAL_RIG_ID;
    let runtimeUnsubscribe: (() => void) | undefined;
    let browserOpenUnsubscribe: (() => void) | undefined;
    /** Follows the host's peer status while the host connection is up. */
    let nodesUnsubscribe: (() => void) | undefined;

    const host: RigHost = {
        applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
        directoryPick: () => bridge.directoryPick(),
    };

    /**
     * The Rig a press lands on: the host while it is here, and nothing at all
     * before the directory is running or after it has been torn down.
     */
    const activeResolve = (): string | undefined =>
        rigs.has(activeRigId) ? activeRigId : order.find((id) => rigs.has(id));

    const publish = () => {
        const resolved = activeResolve();
        snapshot = {
            ...(resolved === undefined ? {} : { activeRigId: resolved }),
            rigs: order.flatMap((id) => {
                const rig = rigs.get(id);
                return rig ? [rig.entry] : [];
            }),
        };
        for (const listener of listeners) listener();
    };

    const connectionClose = (rig: LiveRig): void => {
        rig.workspaceUnsubscribe?.();
        rig.workspaceUnsubscribe = undefined;
        rig.connection?.dispose();
        rig.connection = undefined;
        rig.url = undefined;
        rig.entry = {
            ...rig.entry,
            accessRestricted: false,
            projects: [],
            projectsStatus: "loading",
            projectAdd: PROJECT_ADD_IDLE,
            session: undefined,
        };
    };

    const projectsRead = (
        session: RigSession,
    ): Pick<RigDirectoryEntry, "projects" | "projectsStatus" | "projectAdd"> => {
        const workspace = session.workspace.get();
        const projects = workspace.list.projects;
        return {
            projects: projects.type === "ready" ? projects.value : [],
            projectsStatus:
                projects.type === "ready"
                    ? "ready"
                    : projects.type === "error"
                      ? "error"
                      : "loading",
            projectAdd: workspace.projectAdd,
        };
    };

    const connectionOpen = (id: string, rigHttpUrl: string, connectEndpoint: string): void => {
        const rig = rigs.get(id);
        if (!rig) return;
        connectionClose(rig);
        rig.url = rigHttpUrl;
        rig.connection = rigConnectionOpen({
            host,
            rigId: id,
            rigHttpUrl,
            connectEndpoint,
            // Trust is the host's to give. A node is here because the host
            // already decided to trust it, so its connection is never the one
            // asked to pair with anything.
            pairingOwner: id === LOCAL_RIG_ID,
            modelPreferencePersistence: deps.modelPreferencePersistence,
            deps: {
                conversationOpen: (location) => deps.conversationOpen(id, location),
                groupOpen: (groupId) => deps.groupOpen(id, groupId),
                listOpen: (groupId) => deps.listOpen(id, groupId),
                compatibility: (message) => {
                    const current = rigs.get(id);
                    if (!current || current.compatibilityMessage === message) return;
                    // Said whether or not the stores came up: a daemon this
                    // build cannot read may still answer enough to look alive,
                    // and the surfaces it leaves empty have no other
                    // explanation.
                    current.compatibilityMessage = message;
                    current.entry = { ...current.entry, message };
                    publish();
                },
                restricted: (value) => {
                    const current = rigs.get(id);
                    if (!current || (current.entry.accessRestricted ?? false) === value) return;
                    // Reachable and deliberately quiet. The status stays
                    // whatever the link is, because the link is genuinely up.
                    current.entry = { ...current.entry, accessRestricted: value };
                    publish();
                },
                unavailable: (error) => {
                    const current = rigs.get(id);
                    // A connection that has already come up and is reloading
                    // says nothing: the stores it published are still the truth
                    // on screen, and a transient read failure behind them is not
                    // news the reader can act on.
                    if (!current || current.connection?.get() || current.entry.session) return;
                    const message = error instanceof Error ? error.message : String(error);
                    if (current.entry.status === "error" && current.entry.message === message)
                        return;
                    current.entry = { ...current.entry, status: "error", message };
                    publish();
                },
                changed: () => {
                    const current = rigs.get(id);
                    const session = current?.connection?.get();
                    if (!current) return;
                    const failure = current.connection?.failure();
                    if (failure) {
                        /*
                         * A legacy endpoint can supply enough state to construct a
                         * partial session after rig-connect has refused the daemon.
                         * The refusal still wins: that session cannot produce the
                         * live workspace catalog, and accepting it as success is
                         * what leaves the list loading forever.
                         */
                        current.entry = {
                            ...current.entry,
                            status: "error",
                            message: failure,
                            // The projects are not merely late; there is nothing
                            // coming to fill them until the machine is readable.
                            projectsStatus: "error",
                        };
                        publish();
                        return;
                    }
                    if (!session) return;
                    current.workspaceUnsubscribe?.();
                    current.workspaceUnsubscribe = session.workspace.subscribe(() => {
                        const live = rigs.get(id);
                        if (!live || live.connection?.get() !== session) return;
                        live.entry = { ...live.entry, ...projectsRead(session) };
                        publish();
                    });
                    current.entry = {
                        ...current.entry,
                        ...projectsRead(session),
                        // Being up is what "connected" means for a Rig here,
                        // host or node alike: the connection has read the
                        // daemon and published its stores.
                        status: "connected" as const,
                        // Clears whatever the connection failed with on its way
                        // up, but not a protocol gap: that one is still true of
                        // a daemon whose stores came up regardless.
                        message: current.compatibilityMessage,
                        session,
                    };
                    publish();
                    // The host coming up is what makes its peering readable, so
                    // this is where a window learns which nodes it has.
                    if (id === LOCAL_RIG_ID) nodesFollow(session);
                },
            },
        });
    };

    /**
     * Follows the host's peer status and keeps one ordinary Rig connection per
     * connected node alongside it.
     *
     * The status feed is discovery, not work: it says which machines exist and
     * how each link is doing, and each machine's projects and conversations
     * arrive on that machine's own connection. So this reads the feed and does
     * exactly one thing with it — opens a connection to a node that has one to
     * open, and closes the one belonging to a node that has gone.
     *
     * A node keeps its connection while it stays connected. It is not
     * reconnected because a reading arrived, and its work is not torn down and
     * rebuilt because the host republished its status: the connection retries on
     * its own, the way the host's does.
     */
    const nodesFollow = (session: RigSession): void => {
        nodesUnsubscribe?.();
        nodesUnsubscribe = undefined;
        const nodes = session.nodes;
        if (!nodes) {
            nodesReconcile([]);
            return;
        }
        const read = (): void => {
            // A reading that arrives after this host connection was replaced
            // describes a machine this window is no longer on.
            if (rigs.get(LOCAL_RIG_ID)?.entry.session !== session) return;
            nodesReconcile(nodeTargets(nodes.get()));
        };
        nodesUnsubscribe = nodes.subscribe(read);
        read();
    };

    /** Opens what is newly here, closes what has gone, and leaves the rest alone. */
    const nodesReconcile = (nodeIds: readonly string[]): void => {
        const hostUrl = rigs.get(LOCAL_RIG_ID)?.url;
        const wanted = new Set(hostUrl === undefined ? [] : nodeIds);
        let changed = false;
        // Chosen before anything is removed: the map is what is being changed,
        // and deciding what goes while walking it is how a node survives its own
        // removal.
        const gone: string[] = [];
        for (const [id, rig] of rigs) {
            if (rig.entry.nodeId === undefined || wanted.has(rig.entry.nodeId)) continue;
            gone.push(id);
        }
        for (const id of gone) {
            const rig = rigs.get(id);
            if (rig) connectionClose(rig);
            rigs.delete(id);
            order = order.filter((entry) => entry !== id);
            changed = true;
        }
        for (const nodeId of wanted) {
            const id = rigNodeId(nodeId);
            if (rigs.has(id)) continue;
            rigs.set(id, {
                entry: {
                    id,
                    label: nodeId,
                    nodeId,
                    projects: [],
                    projectsStatus: "loading",
                    projectAdd: PROJECT_ADD_IDLE,
                    status: "connecting",
                },
            });
            order = [...order, id];
            changed = true;
            // The node's own base URL on this window's proxy. Everything above
            // is the ordinary connection: the same client, the same stores, the
            // same screens, addressed at a different machine.
            const base = hostUrl!.replace(/\/$/, "");
            connectionOpen(
                id,
                // The projected surface — health, files, Git — is served for
                // this node on this window's own proxy, which addresses the far
                // daemon through the same peer route underneath.
                `${base}/nodes/${encodeURIComponent(nodeId)}`,
                // The connector goes straight down that route, exactly as Rig
                // publishes it.
                rigPeerConnectEndpoint(base, nodeId),
            );
        }
        if (changed) publish();
    };

    const localReconcile = (): void => {
        const value = runtime.get();
        const target =
            value && value.phase === "ready" && value.activeTarget.mode === "local"
                ? value.activeTarget
                : undefined;
        const existing = rigs.get(LOCAL_RIG_ID);
        const rig: LiveRig = existing ?? {
            entry: {
                id: LOCAL_RIG_ID,
                label: "This Mac",
                projects: [],
                projectsStatus: "loading",
                projectAdd: PROJECT_ADD_IDLE,
                status: "connecting",
            },
        };
        if (!existing) {
            rigs.set(LOCAL_RIG_ID, rig);
            order = [LOCAL_RIG_ID, ...order.filter((id) => id !== LOCAL_RIG_ID)];
        }
        if (!target) {
            // The host going away takes its nodes with it: they are reached
            // through it, so without it there is no route to any of them.
            nodesUnsubscribe?.();
            nodesUnsubscribe = undefined;
            nodesReconcile([]);
            connectionClose(rig);
            rig.entry = {
                ...rig.entry,
                status: "connecting",
                message: undefined,
                version: undefined,
            };
            publish();
            return;
        }
        // A runtime reading says where the daemon is, not whether this build can
        // read it. Recomputing the status from the runtime alone would talk over
        // a connection that has already refused itself and put the row back to
        // "connecting", where it would wait out a daemon it can never read.
        const failure = rig.connection?.failure();
        rig.entry = {
            ...rig.entry,
            ...(failure
                ? { status: "error" as const, message: failure }
                : {
                      status: rig.entry.session ? ("connected" as const) : ("connecting" as const),
                      message: undefined,
                  }),
            version: target.rigVersion,
        };
        if (rig.url !== target.rigHttpUrl)
            connectionOpen(
                LOCAL_RIG_ID,
                target.rigHttpUrl,
                `${target.rigHttpUrl.replace(/\/$/, "")}/rig-connect`,
            );
        publish();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(localReconcile);
                // A URL the operating system hands this window opens where the
                // reader is: the tab is addressed by the Rig it is added to, so
                // it browses through that machine's network like any other.
                browserOpenUnsubscribe = bridge.browserOpenSubscribe((url) => {
                    const resolved = activeResolve();
                    const active = resolved === undefined ? undefined : rigs.get(resolved);
                    active?.entry.session?.workspace.panel.browserAdd(url);
                });
                localReconcile();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                runtimeUnsubscribe?.();
                runtimeUnsubscribe = undefined;
                browserOpenUnsubscribe?.();
                browserOpenUnsubscribe = undefined;
                nodesUnsubscribe?.();
                nodesUnsubscribe = undefined;
                for (const rig of rigs.values()) connectionClose(rig);
                rigs.clear();
                order = [];
                // Nobody is listening, so nobody is told — but `get` is still
                // answerable, and what it held names connections that have just
                // been disposed. The window is on no machine until it subscribes
                // again, and it says so rather than handing out the wreckage.
                snapshot = { rigs: [] };
            };
        },
        rigActivate(id) {
            if (activeRigId === id) return;
            const before = snapshot.activeRigId;
            activeRigId = id;
            // Picking a machine that is not here resolves to the same one the
            // window was already on, and nothing on screen has changed.
            if (activeResolve() !== before) publish();
        },
    };
}
