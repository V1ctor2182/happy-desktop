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
    type RigModelPreferencePersistence,
    type RigModelPreferences,
    type RigModelStore,
    type RigSessionCatalogSnapshot,
    type RigSessionLocation,
    type RigWorkspaceMemoryDocument,
    type RigWorkspaceMemoryPersistence,
    type RigInboxStore,
    type RigWorkspaceStore,
} from "happy2-state";
import {
    connectRig,
    type MutationRejectedDelta,
    type RigConnection as RigConnectConnection,
} from "@slopus/rig-connect";
import { terminalDriverCreate } from "happy2-app";
import { rigConnectCatalogSourceCreate } from "./rigConnectCatalogSource";
import { rigConnectInboxSourceCreate } from "./rigConnectInboxSource";
import { rigConnectTranscriptConnectCreate } from "./rigConnectTranscriptSource";
import { rigRendererTransportCreate } from "./rigRendererTransport";
import { completionChimePlay } from "./completionChime";

const MODEL_PREFERENCES_KEY = "happy2.rig.model-preferences.v1";

const modelPreferencePersistence: RigModelPreferencePersistence = {
    read() {
        try {
            const value = localStorage.getItem(MODEL_PREFERENCES_KEY);
            return value ? (JSON.parse(value) as RigModelPreferences) : undefined;
        } catch {
            return undefined;
        }
    },
    write(preferences) {
        try {
            localStorage.setItem(MODEL_PREFERENCES_KEY, JSON.stringify(preferences));
        } catch {
            // A storage-denied renderer still keeps the choices for this client lifetime.
        }
    },
};

const WORKSPACE_MEMORY_PREFIX = "happy2.rig.workspace-memory.v1:";

/**
 * Where one Rig's tab and read memory is kept on this machine. Keyed by the Rig
 * so two machines' projects never share a document: their ids are minted
 * independently, and one machine's tabs must not decide another's.
 */
function workspaceMemoryPersistence(rigId: string): RigWorkspaceMemoryPersistence {
    const key = `${WORKSPACE_MEMORY_PREFIX}${rigId}`;
    return {
        read() {
            try {
                const value = localStorage.getItem(key);
                return value ? (JSON.parse(value) as RigWorkspaceMemoryDocument) : undefined;
            } catch {
                return undefined;
            }
        },
        write(document) {
            try {
                localStorage.setItem(key, JSON.stringify(document));
            } catch {
                // A storage-denied renderer still remembers where the reader is
                // for as long as the window stays open.
            }
        },
    };
}

export interface RigSession {
    readonly connection: RigConnectionStore;
    readonly host: RigHost;
    /** Daemon-global model capabilities/defaults and last-used selection. */
    readonly models: RigModelStore;
    /** The joined session-list + active-chat workspace store for this connection. */
    readonly workspace: RigWorkspaceStore;
    /** Every question this Rig's agents are waiting on, across all its sessions. */
    readonly inbox: RigInboxStore | undefined;
    /** Ticking clock for relative timestamps, so surfaces never read `Date.now()` in render. */
    readonly clock: RigClockStore;
}

export interface RigSessionDeps {
    /**
     * Navigates to a conversation this Rig just created (compose or `/fork`),
     * addressed by its working directory and then itself. The connection never
     * selects a conversation itself; the URL does.
     */
    readonly conversationOpen: (location: RigSessionLocation) => void;
    /** Navigates to a group that holds no conversation yet, such as a new worktree. */
    readonly groupOpen: (groupId: string) => void;
    /** Announces that this connection's session is ready or has been replaced. */
    readonly changed: () => void;
}

/**
 * One live connection to one Rig daemon, local or remote, reached through the
 * main process's loopback proxy for it. Everything above this object is written
 * against `RigSession` alone, which is what lets another machine's Rig render
 * through exactly the same stores and screens as this machine's.
 */
export interface RigConnectionHandle {
    get(): RigSession | undefined;
    dispose(): void;
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

/**
 * Opens the transports, protocol client, and product stores for one Rig and
 * reports the session once the daemon's model catalog has been read, retrying
 * that first read until it succeeds or the handle is disposed. Disposal releases
 * the workspace's leases before the client that owns them.
 */
export function rigConnectionOpen(input: {
    readonly host: RigHost;
    readonly deps: RigSessionDeps;
    /** Which Rig this is, so its tab and read memory is kept apart from the others'. */
    readonly rigId: string;
    readonly rigHttpUrl: string;
}): RigConnectionHandle {
    let disposed = false;
    let session: RigSession | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const transport = rigRendererTransportCreate(input.rigHttpUrl);
    const mutationListeners = new Set<(rejection: MutationRejectedDelta) => void>();
    const rigConnect: RigConnectConnection = connectRig({
        endpoint: `${input.rigHttpUrl.replace(/\/$/, "")}/rig-connect`,
        token: "happy2-local-capability",
        onMutationRejected: (rejection) => {
            for (const listener of mutationListeners) listener(rejection);
        },
    });
    // Opened before the catalog: the inbox is filled by the catalog handshake,
    // which happens once per connection, so it has to be watching before the
    // catalog loads rather than after a surface asks for it.
    const inboxSource = rigConnectInboxSourceCreate(rigConnect);
    const catalogSource = rigConnectCatalogSourceCreate(rigConnect, input.rigHttpUrl, {
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
    const client: RigClient = rigClientCreate({
        transport,
        sessionListOutput: (event) => {
            if (event.type === "sessionCompleted") completionChimePlay();
        },
        modelPreferencePersistence,
        workspaceMemoryPersistence: workspaceMemoryPersistence(input.rigId),
        catalogSource,
        inboxSource,
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
    const modelsLoad = (): void => {
        void client.models.load().then(
            () => {
                if (disposed) return;
                session = {
                    connection: rigConnectionLoaderCreate({
                        probe: healthProbe(input.rigHttpUrl),
                    }),
                    host: input.host,
                    models: client.models,
                    workspace: rigWorkspaceStoreCreate(client, {
                        output: (event) => {
                            if (event.type === "conversationOpenRequested")
                                input.deps.conversationOpen(event.location);
                            else input.deps.groupOpen(event.groupId);
                        },
                    }),
                    inbox: client.inbox(),
                    clock: rigClockStoreCreate(),
                };
                input.deps.changed();
            },
            () => {
                if (disposed) return;
                retry = setTimeout(modelsLoad, 1_000);
            },
        );
    };
    modelsLoad();
    return {
        get: () => session,
        dispose() {
            if (disposed) return;
            disposed = true;
            if (retry) clearTimeout(retry);
            if (session) {
                session.workspace[Symbol.dispose]();
                session.connection[Symbol.dispose]();
                session.clock[Symbol.dispose]();
                session = undefined;
            }
            client[Symbol.dispose]();
            inboxSource.close();
            rigConnect.close();
        },
    };
}
