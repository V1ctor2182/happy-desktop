import type {
    HappyAgentBot,
    HappyAgentConnectionSnapshot,
    HappyAgentHost,
    HappyAgentModelPreferencePersistence,
    HappyAgentProjectAddSnapshot,
    HappyAgentProjectGroup,
    HappyAgentSessionLocation,
    TerminalColorScheme,
} from "happy-desktop-state";
import { desktopLocalHappyAgentId, type HappyDesktopBridge } from "../shared/desktopContract";
import {
    happyAgentConnectionOpen,
    type HappyAgentConnectionHandle,
    type HappyAgentProtocolMismatch,
    type HappyAgentSession,
} from "./happyAgentConnection";
import type { PersonalRemoteMacStore } from "./personalRemoteMacStore";
import type { DesktopRuntimeStore } from "./runtimeStore";

export const LOCAL_HAPPY_AGENT_ID = desktopLocalHappyAgentId;
const PROJECT_ADD_IDLE: HappyAgentProjectAddSnapshot = { pending: false };

export interface HappyAgentDirectoryEntry {
    readonly id: string;
    readonly kind: "local" | "remote";
    readonly label: string;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly protocolMismatch?: HappyAgentProtocolMismatch;
    readonly message?: string;
    readonly version?: string;
    readonly projects: readonly HappyAgentProjectGroup[];
    /** This Happy Agent's bots, shown under their own heading above its projects. */
    readonly bots: readonly HappyAgentBot[];
    readonly projectsStatus: "loading" | "ready" | "error";
    readonly projectAdd: HappyAgentProjectAddSnapshot;
    /** Remote paths cannot be chosen by this Mac's native folder picker. */
    readonly projectAddSupported: boolean;
    readonly session?: HappyAgentSession;
}

export interface HappyAgentDirectorySnapshot {
    readonly activeHappyAgentId?: string;
    readonly happyAgents: readonly HappyAgentDirectoryEntry[];
}

export interface HappyAgentDirectoryStore {
    get(): HappyAgentDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    happyAgentActivate(id: string): void;
}

export interface HappyAgentDirectoryDeps {
    readonly conversationOpen: (happyAgentId: string, location: HappyAgentSessionLocation) => void;
    readonly groupOpen: (happyAgentId: string, groupId: string) => void;
    /** Removes a vanished group only from the navigation belonging to its Happy Agent. */
    readonly groupForget: (happyAgentId: string, groupId: string) => void;
    /** Removes every route owned by an explicitly removed remote mount. */
    readonly happyAgentForget: (happyAgentId: string) => void;
    /** Desktop-wide model memory for this window's Happy Agent connections. */
    readonly modelPreferencePersistence: HappyAgentModelPreferencePersistence;
    /** Appearance read once whenever a terminal is opened. */
    readonly terminalColorScheme: () => TerminalColorScheme;
}

interface ManagedHappyAgent {
    readonly id: string;
    readonly remote: boolean;
    connection?: HappyAgentConnectionHandle;
    connectionUnsubscribe?: () => void;
    workspaceUnsubscribe?: () => void;
    protocolMismatch?: HappyAgentProtocolMismatch;
    url?: string;
    entry: HappyAgentDirectoryEntry;
}

function projectsRead(
    session: HappyAgentSession,
): Pick<HappyAgentDirectoryEntry, "bots" | "projects" | "projectsStatus" | "projectAdd"> {
    const workspace = session.workspace.get();
    const projects = workspace.list.projects;
    return {
        bots: workspace.list.bots,
        projects: projects.type === "ready" ? projects.value : [],
        projectsStatus:
            projects.type === "ready" ? "ready" : projects.type === "error" ? "error" : "loading",
        projectAdd: workspace.projectAdd,
    };
}

function projectsMatch(
    entry: HappyAgentDirectoryEntry,
    next: Pick<HappyAgentDirectoryEntry, "bots" | "projects" | "projectsStatus" | "projectAdd">,
): boolean {
    return (
        entry.bots === next.bots &&
        entry.projects === next.projects &&
        entry.projectsStatus === next.projectsStatus &&
        entry.projectAdd === next.projectAdd
    );
}

function connectionRead(
    happyAgent: ManagedHappyAgent,
    connection: HappyAgentConnectionSnapshot,
): Pick<HappyAgentDirectoryEntry, "message" | "status" | "version"> {
    if (connection.connection === "connecting")
        return {
            status: "connecting",
            message: "Connecting to this Happy Agent.",
            version: connection.version ?? happyAgent.entry.version,
        };
    if (connection.connection === "disconnected")
        return {
            status: "disconnected",
            message: connection.message ?? "This Happy Agent is disconnected.",
            version: connection.version ?? happyAgent.entry.version,
        };
    if (connection.daemon === "starting")
        return {
            status: "connecting",
            message: "This Happy Agent is starting.",
            version: connection.version ?? happyAgent.entry.version,
        };
    if (connection.daemon === "error")
        return {
            status: "error",
            message: connection.message ?? "This Happy Agent reported an error.",
            version: connection.version ?? happyAgent.entry.version,
        };
    return {
        status: connection.daemon === "ready" ? "connected" : "connecting",
        message:
            connection.daemon === "ready"
                ? happyAgent.protocolMismatch?.message
                : "Waiting for this Happy Agent to become ready.",
        version: connection.version ?? happyAgent.entry.version,
    };
}

/**
 * Materializes the local daemon plus the one explicitly configured personal
 * Tailnet mount. Each connection retains its own complete product stores; a
 * remote outage therefore changes only that directory entry.
 */
export function happyAgentDirectoryStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    remoteMac: PersonalRemoteMacStore | undefined,
    deps: HappyAgentDirectoryDeps,
): HappyAgentDirectoryStore {
    const listeners = new Set<() => void>();
    const local: ManagedHappyAgent = {
        id: LOCAL_HAPPY_AGENT_ID,
        remote: false,
        entry: {
            id: LOCAL_HAPPY_AGENT_ID,
            kind: "local",
            label: "Projects",
            bots: [],
            projects: [],
            projectsStatus: "loading",
            projectAdd: PROJECT_ADD_IDLE,
            projectAddSupported: true,
            status: "connecting",
        },
    };
    const happyAgents = new Map<string, ManagedHappyAgent>([[local.id, local]]);
    let activeHappyAgentId = local.id;
    let snapshot: HappyAgentDirectorySnapshot = { happyAgents: [] };
    let runtimeUnsubscribe: (() => void) | undefined;
    let remoteMacUnsubscribe: (() => void) | undefined;
    let browserOpenUnsubscribe: (() => void) | undefined;

    const publish = (): void => {
        const ordered = [local, ...[...happyAgents.values()].filter((entry) => entry !== local)];
        snapshot = {
            activeHappyAgentId,
            happyAgents: ordered.map((entry) => entry.entry),
        };
        for (const listener of listeners) listener();
    };

    const connectionClose = (happyAgent: ManagedHappyAgent): void => {
        happyAgent.connectionUnsubscribe?.();
        happyAgent.connectionUnsubscribe = undefined;
        happyAgent.workspaceUnsubscribe?.();
        happyAgent.workspaceUnsubscribe = undefined;
        happyAgent.connection?.dispose();
        happyAgent.connection = undefined;
        happyAgent.url = undefined;
        happyAgent.entry = {
            ...happyAgent.entry,
            bots: [],
            projects: [],
            projectsStatus: "loading",
            projectAdd: PROJECT_ADD_IDLE,
            session: undefined,
        };
    };

    const connectionOpen = (happyAgent: ManagedHappyAgent, happyAgentHttpUrl: string): void => {
        connectionClose(happyAgent);
        happyAgent.url = happyAgentHttpUrl;
        const current = (): boolean => happyAgents.get(happyAgent.id) === happyAgent;
        const host: HappyAgentHost = {
            applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
            directoryPick: happyAgent.remote
                ? () => Promise.resolve(undefined)
                : () => bridge.directoryPick(),
        };
        happyAgent.connection = happyAgentConnectionOpen({
            cloudHost: {
                cloudAuthCallbackSubscribe: (listener) =>
                    bridge.cloudAuthCallbackSubscribe(listener),
                cloudAuthCallbackTake: () => bridge.cloudAuthCallbackTake(),
                cloudAuthConfigurationGet: () => bridge.cloudAuthConfigurationGet(),
                cloudAuthOpen: (url) => bridge.cloudAuthOpen(url),
            },
            host,
            happyAgentId: happyAgent.id,
            happyAgentHttpUrl,
            modelPreferencePersistence: deps.modelPreferencePersistence,
            terminalColorScheme: deps.terminalColorScheme,
            deps: {
                conversationOpen: (location) => deps.conversationOpen(happyAgent.id, location),
                groupOpen: (groupId) => deps.groupOpen(happyAgent.id, groupId),
                groupForget: (groupId) => deps.groupForget(happyAgent.id, groupId),
                compatibility: (mismatch) => {
                    if (!current() || happyAgent.protocolMismatch?.message === mismatch?.message)
                        return;
                    happyAgent.protocolMismatch = mismatch;
                    const {
                        protocolMismatch: _protocolMismatch,
                        message: _message,
                        ...entry
                    } = happyAgent.entry;
                    happyAgent.entry = mismatch
                        ? { ...entry, protocolMismatch: mismatch, message: mismatch.message }
                        : entry;
                    publish();
                },
                unavailable: (error) => {
                    if (!current() || happyAgent.connection?.get() || happyAgent.entry.session)
                        return;
                    const message = error instanceof Error ? error.message : String(error);
                    if (happyAgent.entry.status === "error" && happyAgent.entry.message === message)
                        return;
                    happyAgent.entry = { ...happyAgent.entry, status: "error", message };
                    publish();
                },
                changed: () => {
                    if (!current()) return;
                    const session = happyAgent.connection?.get();
                    if (happyAgent.connection?.starting() === true) {
                        happyAgent.entry = {
                            ...happyAgent.entry,
                            status: "connecting",
                            message: "Happy Agent is starting.",
                            projectsStatus: "loading",
                        };
                        publish();
                        return;
                    }
                    const failure = happyAgent.connection?.failure();
                    if (failure) {
                        happyAgent.entry = {
                            ...happyAgent.entry,
                            status: "error",
                            message: failure,
                            projectsStatus: "error",
                        };
                        publish();
                        return;
                    }
                    if (!session) return;
                    if (happyAgent.entry.session !== session) {
                        happyAgent.connectionUnsubscribe?.();
                        happyAgent.workspaceUnsubscribe?.();
                        happyAgent.workspaceUnsubscribe = session.workspace.subscribe(() => {
                            if (!current() || happyAgent.entry.session !== session) return;
                            const projects = projectsRead(session);
                            if (projectsMatch(happyAgent.entry, projects)) return;
                            happyAgent.entry = { ...happyAgent.entry, ...projects };
                            publish();
                        });
                        happyAgent.connectionUnsubscribe = session.connection.subscribe(() => {
                            if (!current() || happyAgent.entry.session !== session) return;
                            happyAgent.entry = {
                                ...happyAgent.entry,
                                ...connectionRead(happyAgent, session.connection.get()),
                            };
                            publish();
                        });
                    }
                    happyAgent.entry = {
                        ...happyAgent.entry,
                        ...projectsRead(session),
                        ...connectionRead(happyAgent, session.connection.get()),
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
                            status: local.entry.session
                                ? ("disconnected" as const)
                                : ("connecting" as const),
                            message: local.entry.session
                                ? "The local Happy Agent is disconnected."
                                : "Connecting to the local Happy Agent.",
                        };
            local.entry = { ...local.entry, ...unavailable };
            publish();
            return;
        }
        const starting = local.connection?.starting() === true;
        const failure = starting ? undefined : local.connection?.failure();
        local.entry = {
            ...local.entry,
            ...(failure
                ? { status: "error" as const, message: failure }
                : starting
                  ? { status: "connecting" as const, message: "Happy Agent is starting." }
                  : local.entry.session
                    ? connectionRead(local, local.entry.session.connection.get())
                    : {
                          status: "connecting" as const,
                          message: "Connecting to this Happy Agent.",
                      }),
            version: target.happyAgentVersion,
        };
        if (local.url !== target.happyAgentHttpUrl) connectionOpen(local, target.happyAgentHttpUrl);
        publish();
    };

    const remoteRemove = (happyAgent: ManagedHappyAgent): void => {
        connectionClose(happyAgent);
        happyAgents.delete(happyAgent.id);
        if (activeHappyAgentId === happyAgent.id) activeHappyAgentId = local.id;
        deps.happyAgentForget(happyAgent.id);
    };

    const remoteReconcile = (): void => {
        const mount = remoteMac?.get()?.mount;
        for (const happyAgent of happyAgents.values())
            if (happyAgent.remote && happyAgent.id !== mount?.id) remoteRemove(happyAgent);
        if (!mount) {
            publish();
            return;
        }
        let happyAgent = happyAgents.get(mount.id);
        if (!happyAgent) {
            happyAgent = {
                id: mount.id,
                remote: true,
                entry: {
                    id: mount.id,
                    kind: "remote",
                    label: mount.label,
                    bots: [],
                    projects: [],
                    projectsStatus: "loading",
                    projectAdd: PROJECT_ADD_IDLE,
                    projectAddSupported: false,
                    status: "connecting",
                    message: "Connecting over Tailscale.",
                },
            };
            happyAgents.set(happyAgent.id, happyAgent);
        }
        happyAgent.entry = { ...happyAgent.entry, label: mount.label };
        if (happyAgent.url !== mount.happyAgentHttpUrl) {
            happyAgent.entry = {
                ...happyAgent.entry,
                status: "connecting",
                message: "Connecting over Tailscale.",
            };
            connectionOpen(happyAgent, mount.happyAgentHttpUrl);
        }
        publish();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(localReconcile);
                remoteMacUnsubscribe = remoteMac?.subscribe(remoteReconcile);
                browserOpenUnsubscribe = bridge.browserOpenSubscribe((url) => {
                    happyAgents
                        .get(activeHappyAgentId)
                        ?.entry.session?.workspace.panel.browserAdd(url);
                });
                localReconcile();
                remoteReconcile();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                runtimeUnsubscribe?.();
                runtimeUnsubscribe = undefined;
                remoteMacUnsubscribe?.();
                remoteMacUnsubscribe = undefined;
                browserOpenUnsubscribe?.();
                browserOpenUnsubscribe = undefined;
                for (const happyAgent of happyAgents.values()) {
                    connectionClose(happyAgent);
                    if (happyAgent.remote) happyAgents.delete(happyAgent.id);
                }
                activeHappyAgentId = local.id;
                snapshot = { happyAgents: [] };
            };
        },
        happyAgentActivate(id) {
            if (!happyAgents.has(id) || activeHappyAgentId === id) return;
            activeHappyAgentId = id;
            publish();
        },
    };
}
