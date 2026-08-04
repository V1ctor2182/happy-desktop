import type {
    RigHost,
    RigModelPreferencePersistence,
    RigProjectAddSnapshot,
    RigProjectGroup,
    RigSessionLocation,
} from "happy-desktop-state";
import type {
    HappyDesktopBridge,
    RemoteRigAddRequest,
    RemoteRigSnapshot,
} from "../shared/desktopContract";
import { rigConnectionOpen, type RigConnectionHandle, type RigSession } from "./rigConnection";
import type { DesktopRuntimeStore } from "./runtimeStore";

/** The identity of the Rig running on the machine this window is on. */
export const LOCAL_RIG_ID = "local";

export interface RigDirectoryEntry {
    /** `local`, or the durable identity the main process gave a remembered machine. */
    readonly id: string;
    readonly kind: "local" | "remote";
    readonly label: string;
    /** The reader's standing intent for a remote machine; the local Rig is always wanted. */
    readonly connected: boolean;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly message?: string;
    readonly version?: string;
    /** The SSH destination a remote machine is reached at; absent for this machine. */
    readonly destination?: string;
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

export interface RigDirectoryAddSnapshot {
    readonly open: boolean;
    readonly destination: string;
    readonly label: string;
    readonly error?: string;
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
    readonly add: RigDirectoryAddSnapshot;
    readonly rigs: readonly RigDirectoryEntry[];
}

export interface RigDirectoryStore {
    get(): RigDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    addOpen(): void;
    addClose(): void;
    destinationUpdate(value: string): void;
    labelUpdate(value: string): void;
    addSubmit(): void;
    rigConnect(id: string): void;
    rigDisconnect(id: string): void;
    rigRemove(id: string): void;
    /**
     * Records which Rig the window is addressing, so window-level host events —
     * a URL handed to the app to open — land in the workspace the reader is
     * actually looking at rather than always on this machine.
     */
    rigActivate(id: string): void;
}

interface LiveRig {
    connection?: RigConnectionHandle;
    entry: RigDirectoryEntry;
    /** The proxy URL the current connection was opened on, or none while down. */
    url?: string;
    workspaceUnsubscribe?: () => void;
}

const ADD_EMPTY: RigDirectoryAddSnapshot = { destination: "", label: "", open: false };

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
    /** Desktop-wide model memory shared by local and remote Rig connections. */
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
}

/**
 * Every Rig this window can work in — the one on this machine and each remembered
 * remote one — as a single ordered list, each with its own live product stores.
 *
 * The store follows two sources it does not own: the desktop runtime for this
 * machine's daemon, and the main process's remote-Rig list for the others. Both
 * arrive as loopback proxy URLs, so a connection is opened the same way in both
 * cases and everything above this file is written against `RigSession` alone.
 * Projects are projected here so one subscription feeds the whole sidebar; a
 * screen still reads the addressed Rig's own workspace store directly.
 */
export function rigDirectoryStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    deps: RigDirectoryDeps,
): RigDirectoryStore {
    const rigs = new Map<string, LiveRig>();
    const listeners = new Set<() => void>();
    let add: RigDirectoryAddSnapshot = ADD_EMPTY;
    let snapshot: RigDirectorySnapshot = { add, rigs: [] };
    let order: readonly string[] = [];
    /** The reader's standing choice of machine, which may name one that has gone. */
    let activeRigId = LOCAL_RIG_ID;
    let runtimeUnsubscribe: (() => void) | undefined;
    let remoteUnsubscribe: (() => void) | undefined;
    let browserOpenUnsubscribe: (() => void) | undefined;

    const host: RigHost = {
        applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
        directoryPick: () => bridge.directoryPick(),
    };

    /**
     * The Rig a press lands on, which is the reader's choice while that machine
     * is still here and otherwise the one the screens fall back to: this one, or
     * whichever comes first when even it is missing. Resolving it here rather
     * than reassigning the reader's choice means a remote machine that drops out
     * and comes back is theirs again without them re-picking it.
     */
    const activeResolve = (): string | undefined =>
        rigs.has(activeRigId) ? activeRigId : order.find((id) => rigs.has(id));

    const publish = () => {
        const resolved = activeResolve();
        snapshot = {
            ...(resolved === undefined ? {} : { activeRigId: resolved }),
            add,
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

    const connectionOpen = (id: string, rigHttpUrl: string): void => {
        const rig = rigs.get(id);
        if (!rig) return;
        connectionClose(rig);
        rig.url = rigHttpUrl;
        rig.connection = rigConnectionOpen({
            host,
            local: rig.entry.kind === "local",
            rigId: id,
            rigHttpUrl,
            modelPreferencePersistence: deps.modelPreferencePersistence,
            deps: {
                conversationOpen: (location) => deps.conversationOpen(id, location),
                groupOpen: (groupId) => deps.groupOpen(id, groupId),
                listOpen: (groupId) => deps.listOpen(id, groupId),
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
                        // This machine's Rig has no separate status source: its
                        // connection being up is what "connected" means for it.
                        ...(current.entry.kind === "local" ? { status: "connected" as const } : {}),
                        // A session arriving is the answer to whatever this row
                        // was last refused for, so the refusal goes with it. Left
                        // behind, it would keep accusing a machine that is working.
                        message: undefined,
                        session,
                    };
                    publish();
                },
            },
        });
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
                connected: true,
                id: LOCAL_RIG_ID,
                kind: "local",
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
            connectionClose(rig);
            rig.entry = { ...rig.entry, status: "connecting", version: undefined };
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
        if (rig.url !== target.rigHttpUrl) connectionOpen(LOCAL_RIG_ID, target.rigHttpUrl);
        publish();
    };

    const remoteReconcile = (sources: readonly RemoteRigSnapshot[]): void => {
        const present = new Set(sources.map(({ id }) => id));
        for (const [id, rig] of rigs)
            if (rig.entry.kind === "remote" && !present.has(id)) {
                connectionClose(rig);
                rigs.delete(id);
            }
        order = [
            LOCAL_RIG_ID,
            ...sources.filter(({ id }) => id !== LOCAL_RIG_ID).map(({ id }) => id),
        ];
        for (const source of sources) {
            const rig: LiveRig = rigs.get(source.id) ?? {
                entry: {
                    connected: source.connected,
                    destination: source.destination,
                    id: source.id,
                    kind: "remote",
                    label: source.label,
                    projects: [],
                    projectsStatus: "loading",
                    projectAdd: PROJECT_ADD_IDLE,
                    status: source.status,
                },
            };
            rigs.set(source.id, rig);
            // The main process reports whether it can reach that machine, not
            // whether this build can read the daemon there. It republishes every
            // machine whenever any one of them changes, so letting it speak over
            // a refusal would erase the reason as soon as anything else happened.
            const failure = rig.connection?.failure();
            rig.entry = {
                ...rig.entry,
                connected: source.connected,
                destination: source.destination,
                label: source.label,
                ...(failure
                    ? { message: failure, status: "error" as const }
                    : { message: source.message, status: source.status }),
                version: source.version,
            };
            if (source.status === "connected" && source.rigHttpUrl) {
                if (rig.url !== source.rigHttpUrl) connectionOpen(source.id, source.rigHttpUrl);
            } else if (rig.url) connectionClose(rig);
        }
        publish();
    };

    const addFail = (error: unknown): void => {
        add = { ...add, error: error instanceof Error ? error.message : String(error) };
        publish();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(localReconcile);
                remoteUnsubscribe = bridge.remoteRigSubscribe(remoteReconcile);
                browserOpenUnsubscribe = bridge.browserOpenSubscribe((url) => {
                    const resolved = activeResolve();
                    const active = resolved === undefined ? undefined : rigs.get(resolved);
                    active?.entry.session?.workspace.panel.browserAdd(url);
                });
                localReconcile();
                void bridge.remoteRigGet().then(remoteReconcile, () => undefined);
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                runtimeUnsubscribe?.();
                runtimeUnsubscribe = undefined;
                remoteUnsubscribe?.();
                remoteUnsubscribe = undefined;
                browserOpenUnsubscribe?.();
                browserOpenUnsubscribe = undefined;
                for (const rig of rigs.values()) connectionClose(rig);
                rigs.clear();
                order = [];
                // Nobody is listening, so nobody is told — but `get` is still
                // answerable, and what it held names connections that have just
                // been disposed. The window is on no machine until it subscribes
                // again, and it says so rather than handing out the wreckage.
                snapshot = { add, rigs: [] };
            };
        },
        addOpen() {
            add = { ...ADD_EMPTY, open: true };
            publish();
        },
        addClose() {
            add = ADD_EMPTY;
            publish();
        },
        destinationUpdate(destination) {
            add = { ...add, destination, error: undefined };
            publish();
        },
        labelUpdate(label) {
            add = { ...add, error: undefined, label };
            publish();
        },
        addSubmit() {
            const request: RemoteRigAddRequest = {
                destination: add.destination,
                ...(add.label.trim() ? { label: add.label.trim() } : {}),
            };
            void bridge.remoteRigAdd(request).then(() => {
                add = ADD_EMPTY;
                publish();
            }, addFail);
        },
        rigConnect: (id) => void bridge.remoteRigConnect(id).catch(() => undefined),
        rigDisconnect: (id) => void bridge.remoteRigDisconnect(id).catch(() => undefined),
        rigRemove: (id) => void bridge.remoteRigRemove(id).catch(() => undefined),
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
