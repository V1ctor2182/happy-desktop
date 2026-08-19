import type {
    RigConnectionSnapshot,
    RigHost,
    RigModelPreferencePersistence,
    RigProjectAddSnapshot,
    RigProjectGroup,
    RigSessionLocation,
} from "happy-desktop-state";
import type { HappyDesktopBridge } from "../shared/desktopContract";
import {
    rigConnectionOpen,
    type RigConnectionHandle,
    type RigProtocolMismatch,
    type RigSession,
} from "./rigConnection";
import type { DesktopRuntimeStore } from "./runtimeStore";

export const LOCAL_RIG_ID = "local";
const PROJECT_ADD_IDLE: RigProjectAddSnapshot = { pending: false };

export interface RigDirectoryEntry {
    readonly id: string;
    readonly label: string;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly protocolMismatch?: RigProtocolMismatch;
    readonly message?: string;
    readonly version?: string;
    readonly projects: readonly RigProjectGroup[];
    readonly projectsStatus: "loading" | "ready" | "error";
    readonly projectAdd: RigProjectAddSnapshot;
    readonly session?: RigSession;
}

export interface RigDirectorySnapshot {
    readonly activeRigId?: string;
    readonly rigs: readonly RigDirectoryEntry[];
}

export interface RigDirectoryStore {
    get(): RigDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    rigActivate(id: string): void;
}

export interface RigDirectoryDeps {
    readonly conversationOpen: (rigId: string, location: RigSessionLocation) => void;
    readonly groupOpen: (rigId: string, groupId: string) => void;
    readonly listOpen: (rigId: string, groupId: string) => void;
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
}

interface LocalRig {
    connection?: RigConnectionHandle;
    connectionUnsubscribe?: () => void;
    workspaceUnsubscribe?: () => void;
    protocolMismatch?: RigProtocolMismatch;
    url?: string;
    entry: RigDirectoryEntry;
}

function projectsRead(
    session: RigSession,
): Pick<RigDirectoryEntry, "projects" | "projectsStatus" | "projectAdd"> {
    const workspace = session.workspace.get();
    const projects = workspace.list.projects;
    return {
        projects: projects.type === "ready" ? projects.value : [],
        projectsStatus:
            projects.type === "ready" ? "ready" : projects.type === "error" ? "error" : "loading",
        projectAdd: workspace.projectAdd,
    };
}

function connectionRead(
    rig: LocalRig,
    connection: RigConnectionSnapshot,
): Pick<RigDirectoryEntry, "message" | "status" | "version"> {
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
}

/**
 * The renderer now owns exactly one daemon: the local host. Connectivity may
 * change, but no peer discovery or remote connection is materialized here.
 */
export function rigDirectoryStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    deps: RigDirectoryDeps,
): RigDirectoryStore {
    const listeners = new Set<() => void>();
    const rig: LocalRig = {
        entry: {
            id: LOCAL_RIG_ID,
            label: "This Mac",
            projects: [],
            projectsStatus: "loading",
            projectAdd: PROJECT_ADD_IDLE,
            status: "connecting",
        },
    };
    let snapshot: RigDirectorySnapshot = { rigs: [] };
    let runtimeUnsubscribe: (() => void) | undefined;
    let browserOpenUnsubscribe: (() => void) | undefined;

    const host: RigHost = {
        applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
        directoryPick: () => bridge.directoryPick(),
    };

    const publish = (): void => {
        snapshot = {
            activeRigId: LOCAL_RIG_ID,
            rigs: [rig.entry],
        };
        for (const listener of listeners) listener();
    };

    const connectionClose = (): void => {
        rig.connectionUnsubscribe?.();
        rig.connectionUnsubscribe = undefined;
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

    const connectionOpen = (rigHttpUrl: string): void => {
        connectionClose();
        rig.url = rigHttpUrl;
        rig.connection = rigConnectionOpen({
            host,
            rigId: LOCAL_RIG_ID,
            rigHttpUrl,
            connectEndpoint: `${rigHttpUrl.replace(/\/$/, "")}/rig-connect`,
            modelPreferencePersistence: deps.modelPreferencePersistence,
            deps: {
                conversationOpen: (location) => deps.conversationOpen(LOCAL_RIG_ID, location),
                groupOpen: (groupId) => deps.groupOpen(LOCAL_RIG_ID, groupId),
                listOpen: (groupId) => deps.listOpen(LOCAL_RIG_ID, groupId),
                compatibility: (mismatch) => {
                    if (rig.protocolMismatch?.message === mismatch?.message) return;
                    rig.protocolMismatch = mismatch;
                    const {
                        protocolMismatch: _protocolMismatch,
                        message: _message,
                        ...entry
                    } = rig.entry;
                    rig.entry = mismatch
                        ? {
                              ...entry,
                              protocolMismatch: mismatch,
                              message: mismatch.message,
                          }
                        : entry;
                    publish();
                },
                unavailable: (error) => {
                    if (rig.connection?.get() || rig.entry.session) return;
                    const message = error instanceof Error ? error.message : String(error);
                    if (rig.entry.status === "error" && rig.entry.message === message) return;
                    rig.entry = { ...rig.entry, status: "error", message };
                    publish();
                },
                changed: () => {
                    const session = rig.connection?.get();
                    const failure = rig.connection?.failure();
                    if (failure) {
                        rig.entry = {
                            ...rig.entry,
                            status: "error",
                            message: failure,
                            projectsStatus: "error",
                        };
                        publish();
                        return;
                    }
                    if (!session) return;
                    const sessionChanged = rig.entry.session !== session;
                    if (sessionChanged) {
                        rig.connectionUnsubscribe?.();
                        rig.workspaceUnsubscribe?.();
                        rig.workspaceUnsubscribe = session.workspace.subscribe(() => {
                            if (rig.entry.session !== session) return;
                            rig.entry = { ...rig.entry, ...projectsRead(session) };
                            publish();
                        });
                        rig.connectionUnsubscribe = session.connection.subscribe(() => {
                            if (rig.entry.session !== session) return;
                            rig.entry = {
                                ...rig.entry,
                                ...connectionRead(rig, session.connection.get()),
                            };
                            publish();
                        });
                    }
                    rig.entry = {
                        ...rig.entry,
                        ...projectsRead(session),
                        ...connectionRead(rig, session.connection.get()),
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
        if (!target) {
            const unavailable =
                value?.phase === "starting"
                    ? { status: "connecting" as const, message: value.message }
                    : value?.phase === "error"
                      ? { status: "error" as const, message: value.message }
                      : {
                            status: rig.entry.session
                                ? ("disconnected" as const)
                                : ("connecting" as const),
                            message: rig.entry.session
                                ? "The local Rig is disconnected."
                                : "Connecting to the local Rig.",
                        };
            rig.entry = { ...rig.entry, ...unavailable };
            publish();
            return;
        }
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
        if (rig.url !== target.rigHttpUrl) connectionOpen(target.rigHttpUrl);
        publish();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(localReconcile);
                browserOpenUnsubscribe = bridge.browserOpenSubscribe((url) => {
                    rig.entry.session?.workspace.panel.browserAdd(url);
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
                connectionClose();
                snapshot = { rigs: [] };
            };
        },
        rigActivate(_id) {
            // There is one addressable Rig, so every route resolves to it.
        },
    };
}
