import type {
    RigConnectionSnapshot,
    RigHost,
    RigNodeStatus,
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
    type RigProtocolMismatch,
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
    /**
     * Set while this build and that daemon cannot read each other's protocol.
     *
     * It is published beside `status` rather than folded into it because it is
     * the one unavailability nothing recovers from on its own: every other
     * error here is worth waiting out, and this one is worth telling someone
     * about. The host's is what the window shows a page for; a node's stays
     * beside that node, since the rest of the app still works.
     */
    readonly protocolMismatch?: RigProtocolMismatch;
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
    connectionUnsubscribe?: () => void;
    /**
     * What the connector made of this daemon's protocol, while the two cannot
     * read each other. Held apart from the entry because it outlives the state
     * the entry is rebuilt from: a Rig whose stores come up anyway must not
     * publish itself as plainly connected and drop the reason its surfaces are
     * empty.
     */
    protocolMismatch?: RigProtocolMismatch;
    entry: RigDirectoryEntry;
    /** The host's current view of this node's route, kept apart from Rig health. */
    nodeLink?: {
        readonly status: RigNodeStatus;
        readonly message?: string;
    };
    /** What the host's pinned peer record calls this node, when it names it at all. */
    hostName?: string;
    /** What the node itself says it is called, once its own connection is up. */
    selfName?: string;
    /** Follows the node's own name while its connection lasts. */
    selfNameUnsubscribe?: () => void;
    /** The proxy URL the current connection was opened on, or none while down. */
    url?: string;
    workspaceUnsubscribe?: () => void;
}

/**
 * The stable peers from one reading of the host's node directory.
 *
 * A peer becomes a Rig as soon as it has proved its identity. Its current link
 * state only describes availability: connecting or unreachable peers still own
 * the same connection, session, workspace, and UI lifetime as connected ones.
 */
function nodeTargets(nodes: RigNodesSnapshot): readonly {
    readonly label?: string;
    readonly message?: string;
    readonly nodeId: string;
    readonly status: RigNodeStatus;
}[] {
    const seen = new Set<string>();
    const targets: {
        label?: string;
        message?: string;
        nodeId: string;
        status: RigNodeStatus;
    }[] = [];
    for (const node of nodes.nodes) {
        if (node.peerId === undefined || seen.has(node.peerId)) continue;
        seen.add(node.peerId);
        targets.push({
            nodeId: node.peerId,
            status: node.status,
            ...(node.name === undefined ? {} : { label: node.name }),
            ...(node.status === "connecting"
                ? { message: "The host is connecting to this Rig." }
                : node.status === "unreachable"
                  ? { message: node.error ?? "The host cannot reach this Rig." }
                  : {}),
        });
    }
    return targets;
}

/**
 * What to call a node.
 *
 * A machine is named by itself first. The host's peer record is a copy of that
 * name taken when the two were paired: it goes stale when the machine is
 * renamed, and a machine paired before it had a name is one the host can only
 * report by identity. So the node's own reading wins whenever it has arrived,
 * the pinned record stands in until then, and the identity is the last resort —
 * a row still has to be distinguishable from the other unnamed machines.
 */
function nodeLabel(rig: LiveRig): string {
    return rig.selfName ?? rig.hostName ?? rig.entry.nodeId ?? rig.entry.label;
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

    /**
     * Follows what a node calls itself, on that node's own connection.
     *
     * Only a node has a name to learn: this machine is "This Mac" because that
     * is what it is to the person reading, not because of anything it published.
     * The name outlives the reading it came from, so nothing clears it when the
     * link drops — a machine that has gone quiet is still the machine it said it
     * was, and falling back to its identity mid-outage would only make the row
     * unrecognisable exactly when someone is looking to see what happened.
     */
    const selfNameFollow = (id: string, session: RigSession): (() => void) | undefined => {
        const nodes = session.nodes;
        if (id === LOCAL_RIG_ID || !nodes) return undefined;
        // A follower left over from a replaced session must not rename the row
        // the current one is describing, and it cannot tell by comparing
        // sessions: the first reading happens while this session is still being
        // installed on the entry.
        let following = true;
        const read = (): void => {
            const rig = rigs.get(id);
            if (!following || !rig) return;
            const name = nodes.get().name;
            if (name === undefined || name === rig.selfName) return;
            rig.selfName = name;
            rig.entry = { ...rig.entry, label: nodeLabel(rig) };
            publish();
        };
        const unsubscribe = nodes.subscribe(read);
        read();
        return () => {
            following = false;
            unsubscribe();
        };
    };

    const connectionClose = (rig: LiveRig): void => {
        rig.connectionUnsubscribe?.();
        rig.connectionUnsubscribe = undefined;
        rig.workspaceUnsubscribe?.();
        rig.workspaceUnsubscribe = undefined;
        rig.selfNameUnsubscribe?.();
        rig.selfNameUnsubscribe = undefined;
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

    /**
     * Projects connection health onto a directory row without changing any of
     * the product stores the row already owns. For remote Rigs the host's route
     * is the outer connection, so its non-connected state wins immediately over
     * a health reading that may still describe the last successful probe.
     */
    const connectionRead = (
        rig: LiveRig,
        connection: RigConnectionSnapshot,
    ): Pick<RigDirectoryEntry, "message" | "status" | "version"> => {
        if (rig.nodeLink?.status === "connecting")
            return {
                status: "connecting",
                message: rig.nodeLink.message ?? "The host is connecting to this Rig.",
                version: connection.version ?? rig.entry.version,
            };
        if (rig.nodeLink?.status === "unreachable")
            return {
                status: "disconnected",
                message: rig.nodeLink.message ?? "The host cannot reach this Rig.",
                version: connection.version ?? rig.entry.version,
            };
        if (connection.connection === "connecting")
            return {
                status: "connecting",
                message: "Connecting to this Rig.",
                version: connection.version ?? rig.entry.version,
            };
        if (connection.connection === "disconnected")
            return {
                status: "disconnected",
                message: connection.message ?? "This Rig is disconnected.",
                version: connection.version ?? rig.entry.version,
            };
        if (connection.daemon === "starting")
            return {
                status: "connecting",
                message: "This Rig is starting.",
                version: connection.version ?? rig.entry.version,
            };
        if (connection.daemon === "error")
            return {
                status: "error",
                message: connection.message ?? "This Rig reported an error.",
                version: connection.version ?? rig.entry.version,
            };
        return {
            status: connection.daemon === "ready" ? "connected" : "connecting",
            message:
                connection.daemon === "ready"
                    ? rig.protocolMismatch?.message
                    : "Waiting for this Rig to become ready.",
            version: connection.version ?? rig.entry.version,
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
                compatibility: (mismatch) => {
                    const current = rigs.get(id);
                    if (!current || current.protocolMismatch?.message === mismatch?.message) return;
                    // Said whether or not the stores came up: a daemon this
                    // build cannot read may still answer enough to look alive,
                    // and the surfaces it leaves empty have no other
                    // explanation.
                    current.protocolMismatch = mismatch;
                    const message = mismatch?.message;
                    const availability =
                        current.nodeLink?.status === "connecting"
                            ? {
                                  status: "connecting" as const,
                                  message:
                                      current.nodeLink.message ??
                                      "The host is connecting to this Rig.",
                              }
                            : current.nodeLink?.status === "unreachable"
                              ? {
                                    status: "disconnected" as const,
                                    message:
                                        current.nodeLink.message ??
                                        "The host cannot reach this Rig.",
                                }
                              : { message };
                    // The gap itself travels on the entry whatever the link is
                    // doing: a node the host is still dialling has no version
                    // gap to report in its status line yet, and the gap does not
                    // stop being true while that link settles.
                    current.entry = {
                        ...current.entry,
                        ...availability,
                        protocolMismatch: mismatch,
                    };
                    publish();
                },
                restricted: (value) => {
                    const current = rigs.get(id);
                    if (!current || (current.entry.accessRestricted ?? false) === value) return;
                    // Reachable and deliberately quiet. The status stays
                    // whatever the link is, because the link is genuinely up.
                    current.entry = {
                        ...current.entry,
                        accessRestricted: value,
                        ...(value && current.nodeLink?.status === "connected"
                            ? { status: "connected" as const, message: undefined }
                            : {}),
                    };
                    publish();
                },
                unavailable: (error) => {
                    const current = rigs.get(id);
                    // A connection that has already come up and is reloading
                    // says nothing: the stores it published are still the truth
                    // on screen, and a transient read failure behind them is not
                    // news the reader can act on.
                    if (
                        !current ||
                        current.connection?.get() ||
                        current.entry.session ||
                        (current.nodeLink !== undefined && current.nodeLink.status !== "connected")
                    )
                        return;
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
                        const availability =
                            current.nodeLink?.status === "connecting"
                                ? {
                                      status: "connecting" as const,
                                      message:
                                          current.nodeLink.message ??
                                          "The host is connecting to this Rig.",
                                  }
                                : current.nodeLink?.status === "unreachable"
                                  ? {
                                        status: "disconnected" as const,
                                        message:
                                            current.nodeLink.message ??
                                            "The host cannot reach this Rig.",
                                    }
                                  : { status: "error" as const, message: failure };
                        current.entry = {
                            ...current.entry,
                            ...availability,
                            // The projects are not merely late; there is nothing
                            // coming to fill them until the machine is readable.
                            projectsStatus: "error",
                        };
                        publish();
                        return;
                    }
                    if (!session) return;
                    const sessionChanged = current.entry.session !== session;
                    if (sessionChanged) {
                        current.connectionUnsubscribe?.();
                        current.workspaceUnsubscribe?.();
                        current.selfNameUnsubscribe?.();
                        current.selfNameUnsubscribe = selfNameFollow(id, session);
                        current.workspaceUnsubscribe = session.workspace.subscribe(() => {
                            const live = rigs.get(id);
                            if (!live || live.entry.session !== session) return;
                            live.entry = { ...live.entry, ...projectsRead(session) };
                            publish();
                        });
                        current.connectionUnsubscribe = session.connection.subscribe(() => {
                            const live = rigs.get(id);
                            if (!live || live.entry.session !== session) return;
                            live.entry = {
                                ...live.entry,
                                ...connectionRead(live, session.connection.get()),
                            };
                            publish();
                        });
                    }
                    current.entry = {
                        ...current.entry,
                        ...projectsRead(session),
                        ...connectionRead(current, session.connection.get()),
                        label: nodeLabel(current),
                        session,
                    };
                    publish();
                    // The host coming up is what makes its peering readable, so
                    // this is where a window learns which nodes it has.
                    if (id === LOCAL_RIG_ID && sessionChanged) nodesFollow(session);
                },
            },
        });
    };

    /**
     * Follows the host's peer status and keeps one ordinary Rig connection per
     * identified node alongside it.
     *
     * The status feed is discovery, not work: it says which machines exist and
     * how each link is doing, and each machine's projects and conversations
     * arrive on that machine's own connection. So this reads the feed and does
     * exactly one thing with it — materializes every identified peer, retaining
     * it through link changes, and removes it only when a current successful
     * reading authoritatively stops publishing that peer.
     *
     * A node keeps its connection across every link status. It is not reconnected
     * because a reading arrived, and its work is not torn down and rebuilt
     * because the host republished its status: the connection retries on its own,
     * the way the host's does.
     */
    const nodesFollow = (session: RigSession): void => {
        nodesUnsubscribe?.();
        nodesUnsubscribe = undefined;
        const nodes = session.nodes;
        if (!nodes) return;
        const read = (): void => {
            // A reading that arrives after this host connection was replaced
            // describes a machine this window is no longer on.
            if (rigs.get(LOCAL_RIG_ID)?.entry.session !== session) return;
            nodesReconcile(nodes.get());
        };
        nodesUnsubscribe = nodes.subscribe(read);
        read();
    };

    /**
     * Opens what is newly published, removes only what a successful current
     * reading removed, and otherwise changes availability in place.
     */
    const nodesReconcile = (reading: RigNodesSnapshot): void => {
        const hostUrl = rigs.get(LOCAL_RIG_ID)?.url;
        const targets = nodeTargets(reading);
        const wanted = new Set(targets.map((target) => target.nodeId));
        let changed = false;
        // A loading store has not read membership yet, an errored feed retains
        // its last good reading, and an unavailable transport cannot report the
        // peers behind it. None of those is authority to unmount a machine.
        const membershipAuthoritative =
            !reading.loading &&
            reading.error === undefined &&
            reading.transports.every((transport) => transport.state === "ready") &&
            // A peer may temporarily lose its proved identity while its route
            // reconnects. Such a reading can update reachability, but cannot say
            // that the previously identified machine was unpaired.
            reading.nodes.every((node) => node.peerId !== undefined);
        if (membershipAuthoritative) {
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
        }
        for (const target of targets) {
            const id = rigNodeId(target.nodeId);
            let rig = rigs.get(id);
            if (!rig) {
                rig = {
                    entry: {
                        id,
                        label: target.label ?? target.nodeId,
                        nodeId: target.nodeId,
                        projects: [],
                        projectsStatus: "loading",
                        projectAdd: PROJECT_ADD_IDLE,
                        status: "connecting",
                    },
                };
                rigs.set(id, rig);
                order = [...order, id];
            }
            if (target.label !== undefined) rig.hostName = target.label;
            rig.nodeLink = {
                status: target.status,
                ...(target.message === undefined ? {} : { message: target.message }),
            };
            const failure = rig.connection?.failure();
            const availability =
                target.status === "connecting"
                    ? {
                          status: "connecting" as const,
                          message: target.message ?? "The host is connecting to this Rig.",
                      }
                    : target.status === "unreachable"
                      ? {
                            status: "disconnected" as const,
                            message: target.message ?? "The host cannot reach this Rig.",
                        }
                      : rig.entry.session
                        ? connectionRead(rig, rig.entry.session.connection.get())
                        : rig.entry.accessRestricted === true
                          ? { status: "connected" as const, message: undefined }
                          : failure
                            ? { status: "error" as const, message: failure }
                            : {
                                  status: "connecting" as const,
                                  message: "Connecting to this Rig.",
                              };
            rig.entry = {
                ...rig.entry,
                label: nodeLabel(rig),
                ...availability,
            };
            changed = true;
            if (rig.connection || hostUrl === undefined) continue;
            // The node's own base URL on this window's proxy. Everything above
            // is the ordinary connection: the same client, the same stores, the
            // same screens, addressed at a different machine.
            const base = hostUrl.replace(/\/$/, "");
            connectionOpen(
                id,
                // The projected surface — health, files, Git — is served for
                // this node on this window's own proxy, which addresses the far
                // daemon through the same peer route underneath.
                `${base}/nodes/${encodeURIComponent(target.nodeId)}`,
                // The connector goes straight down that route, exactly as Rig
                // publishes it.
                rigPeerConnectEndpoint(base, target.nodeId),
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
            // Runtime startup and failure are availability transitions, not
            // ownership transitions. The established host session and every
            // peer learned through it stay mounted while their transports retry.
            const unavailable =
                value?.phase === "starting"
                    ? { status: "connecting" as const, message: value.message }
                    : value?.phase === "error" || value?.phase === "installRequired"
                      ? { status: "error" as const, message: value.message }
                      : {
                            status: rig.entry.session
                                ? ("disconnected" as const)
                                : ("connecting" as const),
                            message: rig.entry.session
                                ? "The local Rig is disconnected."
                                : "Connecting to the local Rig.",
                        };
            rig.entry = {
                ...rig.entry,
                ...unavailable,
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
                : rig.entry.session
                  ? connectionRead(rig, rig.entry.session.connection.get())
                  : { status: "connecting" as const, message: "Connecting to this Rig." }),
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
