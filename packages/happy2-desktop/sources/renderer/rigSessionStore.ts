import {
    rigClientCreate,
    rigClockStoreCreate,
    rigConnectionLoaderCreate,
    rigWorkspaceStoreCreate,
    type RigClient,
    type RigClockStore,
    type RigConnectionStore,
    type RigDaemonHealth,
    type RigGlobalEvent,
    type RigHost,
    type RigModelStore,
    type RigSessionCatalogSnapshot,
    type RigSessionLocation,
    type RigWorkspaceStore,
} from "happy2-state";
import {
    connectRig,
    type MutationRejectedDelta,
    type RigConnection as RigConnectConnection,
} from "@slopus/rig-connect";
import { terminalDriverCreate } from "happy2-app";
import { rigConnectCatalogSourceCreate } from "./rigConnectCatalogSource";
import { rigConnectTranscriptConnectCreate } from "./rigConnectTranscriptSource";
import { rigRendererTransportCreate } from "./rigRendererTransport";
import type { DesktopRuntimeStore } from "./runtimeStore";
import type { HappyDesktopBridge } from "../shared/desktopContract";

export interface RigSession {
    readonly connectionId: number;
    readonly connection: RigConnectionStore;
    readonly host: RigHost;
    /** Daemon-global model capabilities/defaults and last-used selection. */
    readonly models: RigModelStore;
    /** The joined session-list + active-chat workspace store for this connection. */
    readonly workspace: RigWorkspaceStore;
    /** Ticking clock for relative timestamps, so surfaces never read `Date.now()` in render. */
    readonly clock: RigClockStore;
}

interface RigSessionInternal extends RigSession {
    readonly client: RigClient;
    readonly rigConnect: RigConnectConnection;
}

export interface RigSessionStore {
    get(): RigSession | undefined;
    subscribe(listener: () => void): () => void;
}

export interface RigSessionDeps {
    /**
     * Navigates to a conversation the workspace just created (compose or
     * `/fork`), addressed by its working directory and then itself. The store
     * never selects a conversation itself; the URL does.
     */
    readonly conversationOpen: (location: RigSessionLocation) => void;
    /** Navigates to a group that holds no conversation yet, such as a new worktree. */
    readonly groupOpen: (groupId: string) => void;
}

function healthProbe(rigHttpUrl: string): () => Promise<RigDaemonHealth> {
    return async () => {
        const response = await fetch(`${rigHttpUrl}/health`);
        // A non-OK response (the proxy could not reach the daemon) is a probe
        // failure so the loader disconnects and backs off rather than parsing an
        // error envelope as health.
        if (!response.ok) throw new Error(`The Rig daemon health responded ${response.status}.`);
        return (await response.json()) as RigDaemonHealth;
    };
}

function hostCreate(bridge: HappyDesktopBridge): RigHost {
    return {
        applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
        directoryPick: () => bridge.directoryPick(),
    };
}

/**
 * Owns the connection loader and host for the active local Rig connection outside
 * React. It follows the desktop runtime snapshot and rebuilds — disposing the
 * previous loader — whenever the committed process-connection identity changes,
 * so the renderer never manages this lifetime through a React effect. The loader
 * itself opens no transport until a subscriber (the mounted view) reads it.
 */
export function rigSessionStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    deps: RigSessionDeps,
): RigSessionStore {
    let session: RigSessionInternal | undefined;
    let pending:
        | {
              readonly connectionId: number;
              readonly client: RigClient;
              readonly rigConnect: RigConnectConnection;
              retry?: ReturnType<typeof setTimeout>;
          }
        | undefined;
    let generation = 0;
    let runtimeUnsubscribe: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const dispose = () => {
        generation += 1;
        if (pending) {
            if (pending.retry) clearTimeout(pending.retry);
            pending.client[Symbol.dispose]();
            pending.rigConnect.close();
            pending = undefined;
        }
        if (!session) return;
        // Dispose the workspace (releasing chat leases) before the client that
        // owns those stores, then the connection loader and clock.
        session.workspace[Symbol.dispose]();
        session.client[Symbol.dispose]();
        session.rigConnect.close();
        session.connection[Symbol.dispose]();
        session.clock[Symbol.dispose]();
        session = undefined;
    };
    const reconcile = (): void => {
        const snapshot = runtime.get();
        const target =
            snapshot && snapshot.phase === "ready" && snapshot.activeTarget.mode === "local"
                ? {
                      connectionId: snapshot.connectionId,
                      rigHttpUrl: snapshot.activeTarget.rigHttpUrl,
                  }
                : undefined;
        if (!target) {
            if (session || pending) {
                dispose();
                notify();
            }
            return;
        }
        if (
            session?.connectionId === target.connectionId ||
            pending?.connectionId === target.connectionId
        )
            return;
        dispose();
        const current = generation;
        const transport = rigRendererTransportCreate(target.rigHttpUrl);
        const mutationListeners = new Set<(rejection: MutationRejectedDelta) => void>();
        const rigConnect = connectRig({
            endpoint: `${target.rigHttpUrl.replace(/\/$/, "")}/rig-connect`,
            token: "happy2-local-capability",
            onMutationRejected: (rejection) => {
                for (const listener of mutationListeners) listener(rejection);
            },
        });
        const catalogSource = rigConnectCatalogSourceCreate(rigConnect, target.rigHttpUrl, {
            read: async (): Promise<RigSessionCatalogSnapshot> => {
                const [catalog, sessions] = await Promise.all([
                    transport.projectsRead(),
                    transport.sessionsRead(),
                ]);
                return { catalog, sessions };
            },
            subscribe: (listener, onError) =>
                transport.globalEventsSubscribe({
                    event: (_event: RigGlobalEvent) => listener(),
                    error: onError,
                    end: () => undefined,
                }),
        });
        const client = rigClientCreate({
            transport,
            catalogSource,
            transcriptConnect: rigConnectTranscriptConnectCreate(rigConnect),
            connectActions: rigConnect,
            connectMutationSubscribe: (listener) => {
                mutationListeners.add(listener);
                return () => mutationListeners.delete(listener);
            },
            // The Ghostty emulator and the terminal protocol client live in the app
            // layer, so the client is handed the factory rather than reaching for
            // them itself.
            terminalDriverCreate,
        });
        pending = {
            connectionId: target.connectionId,
            client,
            rigConnect,
        };
        const modelsLoad = (): void => {
            void client.models.load().then(
                () => {
                    if (current !== generation || pending?.client !== client) return;
                    pending = undefined;
                    session = {
                        connectionId: target.connectionId,
                        connection: rigConnectionLoaderCreate({
                            probe: healthProbe(target.rigHttpUrl),
                        }),
                        host: hostCreate(bridge),
                        client,
                        rigConnect,
                        models: client.models,
                        workspace: rigWorkspaceStoreCreate(client, {
                            output: (event) => {
                                if (event.type === "conversationOpenRequested")
                                    deps.conversationOpen(event.location);
                                else deps.groupOpen(event.groupId);
                            },
                        }),
                        clock: rigClockStoreCreate(),
                    };
                    notify();
                },
                () => {
                    if (current !== generation || pending?.client !== client) return;
                    pending.retry = setTimeout(modelsLoad, 1_000);
                },
            );
        };
        modelsLoad();
    };
    return {
        get: () => session,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(reconcile);
                reconcile();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    runtimeUnsubscribe?.();
                    runtimeUnsubscribe = undefined;
                    dispose();
                }
            };
        },
    };
}
