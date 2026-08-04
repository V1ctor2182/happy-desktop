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
    type RigModelStore,
    type RigSessionCatalogSnapshot,
    type RigSessionLocation,
    type RigSlotsStore,
    type RigWorkspaceMemoryDocument,
    type RigWorkspaceMemoryPersistence,
    type RigFriendsStore,
    type RigInboxStore,
    type RigInstructionsStore,
    type RigSecurityPolicyStore,
    type RigProviderUsageStore,
    type RigSessionId,
    type RigSessionShareStore,
    type RigSharedSessionsStore,
    type RigWorkspaceStore,
} from "happy-desktop-state";
import {
    connectRig,
    type MutationRejectedDelta,
    type RigConnection as RigConnectConnection,
} from "@slopus/rig-connect";
import { terminalDriverCreate } from "happy-desktop-app";
import { rigConnectCatalogSourceCreate } from "./rigConnectCatalogSource";
import { rigConnectFriendsSourceCreate } from "./rigConnectFriendsSource";
import { rigConnectInboxSourceCreate } from "./rigConnectInboxSource";
import { rigConnectProviderUsageSourceCreate } from "./rigConnectProviderUsageSource";
import { rigConnectSessionShareSourceCreate } from "./rigConnectSessionShareSource";
import { rigConnectSharedSessionsSourceCreate } from "./rigConnectSharedSessionsSource";
import { rigConnectTranscriptConnectCreate } from "./rigConnectTranscriptSource";
import { rigRendererTransportCreate } from "./rigRendererTransport";
import { completionChimePlay } from "./completionChime";

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
    /** This Rig's reactive slot and webapp catalogs, one surface per connection. */
    readonly slots: () => RigSlotsStore;
    /** Every question this Rig's agents are waiting on, across all its sessions. */
    readonly inbox: RigInboxStore | undefined;
    /** How much of each provider account's plan this machine's agents have spent. */
    readonly providerUsage: RigProviderUsageStore | undefined;
    /**
     * This machine's own profile in the network, who is asking to connect to it,
     * and who it already knows. Absent on a daemon that does not carry Murmur
     * yet, which is why the surface can say so instead of showing an empty list.
     */
    readonly friends: RigFriendsStore | undefined;
    /**
     * The share on the conversation the reader has open here: who can see it,
     * how well it is keeping up, and the decisions only its owner may make.
     * Absent on a daemon started without session sharing, which is why the
     * conversation can say so rather than offering a control that would fail.
     */
    readonly sessionShare: RigSessionShareStore | undefined;
    /**
     * The sessions other people are showing this machine, and the one being
     * read. Absent on a daemon that cannot receive them, which is why the
     * surface can say so instead of showing an empty list.
     */
    readonly sharedSessions: RigSharedSessionsStore | undefined;
    /** The machine-wide instructions every agent this Rig starts is given. */
    readonly instructions: RigInstructionsStore;
    /** The machine-wide policy its permission reviewer applies to agent actions. */
    readonly securityPolicy: RigSecurityPolicyStore;
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
    /**
     * Replaces the address with this Rig's own list, because the group the URL
     * named is gone from the host's catalog — its project was archived, here or
     * from somewhere else. The entry being replaced rather than pushed is the
     * point: a Back that returned to a row which no longer exists would be a
     * dead end the reader put there by accident.
     */
    readonly listOpen: (groupId: string) => void;
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
    /** Whether this is the Rig running on this machine. */
    readonly local: boolean;
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
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
        onSessionFinished: () => completionChimePlay(),
    });
    // Opened before the catalog: the inbox is filled by the catalog handshake,
    // which happens once per connection, so it has to be watching before the
    // catalog loads rather than after a surface asks for it.
    const inboxSource = rigConnectInboxSourceCreate(rigConnect);
    // Unlike the inbox this one is not opened here: usage is read on request
    // rather than streamed, so its reader starts when a surface subscribes and
    // stops when the last one leaves.
    const providerUsageSource = rigConnectProviderUsageSourceCreate(rigConnect);
    // Friends is read the same way usage is, and for the same reason: the daemon
    // answers about it rather than announcing it. A daemon that does not carry
    // Murmur offers no source at all, so the surface says the machine cannot do
    // this rather than showing an account that is missing for the wrong reason.
    const friendsSource = rigConnectFriendsSourceCreate(rigConnect);
    // Sharing is read the same way, and issued through rig-connect's own
    // mutation queue: a decision comes back as an identity, and its refusal
    // arrives on the same channel every other refused mutation does. A daemon
    // started without session sharing offers no source at all, so the
    // conversation says the machine cannot do this rather than showing a
    // session that merely happens not to be shared.
    const sessionShareSource = rigConnectSessionShareSourceCreate(
        rigConnect,
        input.rigHttpUrl,
        (listener) => {
            const forward = (rejection: MutationRejectedDelta): void => {
                listener({ mutationId: rejection.mutationId, message: rejection.message });
            };
            mutationListeners.add(forward);
            return () => mutationListeners.delete(forward);
        },
    );
    // The other side of the same feature: what other people are showing this
    // machine. It is read rather than announced for the same reason, and a
    // daemon that cannot receive replicas offers no source at all.
    const sharedSessionsSource = rigConnectSharedSessionsSourceCreate(rigConnect);
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
        modelPreferencePersistence: input.modelPreferencePersistence,
        workspaceMemoryPersistence: workspaceMemoryPersistence(input.rigId),
        catalogSource,
        inboxSource,
        providerUsageSource,
        ...(friendsSource ? { friendsSource } : {}),
        ...(sessionShareSource ? { sessionShareSource } : {}),
        ...(sharedSessionsSource ? { sharedSessionsSource } : {}),
        transcriptConnect: rigConnectTranscriptConnectCreate(rigConnect, input.rigHttpUrl),
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
                const sessionShare = client.sessionShare();
                session = {
                    connection: rigConnectionLoaderCreate({
                        probe: healthProbe(input.rigHttpUrl),
                    }),
                    host: input.host,
                    models: client.models,
                    workspace: rigWorkspaceStoreCreate(client, {
                        // Choosing a folder is the window's act to perform, so
                        // the workspace is handed the window rather than
                        // reaching for one. It is the same host every other
                        // window-level act already goes through.
                        host: input.host,
                        // The share belongs to the conversation the reader is
                        // in, so it follows the address the workspace applies
                        // rather than being pointed at a session by whichever
                        // view happened to render.
                        conversationFocus: (conversationId?: RigSessionId) => {
                            sessionShare?.sessionFocus(conversationId);
                        },
                        output: (event) => {
                            switch (event.type) {
                                case "conversationOpenRequested":
                                    input.deps.conversationOpen(event.location);
                                    return;
                                case "groupOpenRequested":
                                    input.deps.groupOpen(event.groupId);
                                    return;
                                case "addressedGroupRemoved":
                                    input.deps.listOpen(event.groupId);
                                    return;
                            }
                        },
                    }),
                    slots: () => client.slots(),
                    inbox: client.inbox(),
                    providerUsage: client.providerUsage(),
                    friends: client.friends(),
                    sessionShare,
                    sharedSessions: client.sharedSessions(),
                    instructions: client.instructions(),
                    securityPolicy: client.securityPolicy(),
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
