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
    type RigNodesStore,
    type RigPairingStore,
    type RigProviderUsageStore,
    type RigSessionId,
    type RigSessionShareStore,
    type RigSharedSessionsStore,
    type RigWorkspaceStore,
} from "happy-desktop-state";
import {
    connectRig,
    describeServerCompatibility,
    type MutationRejectedDelta,
    type RigConnection as RigConnectConnection,
    type ServerCompatibility,
} from "@slopus/rig-connect";
import { terminalDriverCreate } from "happy-desktop-app";
import { rigConnectCatalogSourceCreate } from "./rigConnectCatalogSource";
import { rigConnectFriendsSourceCreate } from "./rigConnectFriendsSource";
import { rigConnectInboxSourceCreate } from "./rigConnectInboxSource";
import { rigConnectNodesSourceCreate } from "./rigConnectNodesSource";
import { rigConnectPairingSourceCreate } from "./rigConnectPairingSource";
import { rigConnectProviderUsageSourceCreate } from "./rigConnectProviderUsageSource";
import { rigConnectSessionShareSourceCreate } from "./rigConnectSessionShareSource";
import { rigConnectSharedSessionsSourceCreate } from "./rigConnectSharedSessionsSource";
import { rigConnectTranscriptConnectCreate } from "./rigConnectTranscriptSource";
import { rigRendererTransportCreate, RigTransportHttpError } from "./rigRendererTransport";
import { completionChimePlay } from "./completionChime";

const WORKSPACE_MEMORY_PREFIX = "happy2.rig.workspace-memory.v1:";

/** How soon to read a Rig again after a read that failed for an ordinary reason. */
const RETRY_MS = 1_000;

/**
 * How soon to read again a Rig that answered "not shared".
 *
 * This is not a failure being retried: the machine is up and has decided not to
 * expose its API, and it will keep deciding that until someone changes it there.
 * Asking every second would be a steady stream of refusals for as long as the
 * window is open. Asking occasionally still means the moment that setting is
 * turned on, the node's work appears on its own — nobody has to press anything.
 */
const RESTRICTED_RETRY_MS = 15_000;

/**
 * The connector endpoint for one machine the host Rig is peered with.
 *
 * This is the host's own peer route, composed exactly as Rig serves it. The
 * daemon matches `/p2p/peers/:peerId/api[/…]` at its root and rewrites the
 * remainder onto the far machine's root, so a connector rooted here resolves
 * `catalog`, `events/live`, and every mutation onto the peer's own daemon. The
 * loopback proxy in front of it strips `/rig-connect` and forwards the rest
 * verbatim, which is why that segment leads.
 *
 * No credential travels. The host authenticates the request locally with the
 * capability this window already holds, forwards only an allow-list of headers
 * that excludes `authorization`, and the far daemon injects its own token. The
 * peer identity is the instance id the host published for that machine, and it
 * is escaped here because it is the only part of this path that is not ours.
 */
export function rigPeerConnectEndpoint(hostRigHttpUrl: string, peerId: string): string {
    const host = hostRigHttpUrl.replace(/\/$/, "");
    return `${host}/rig-connect/p2p/peers/${encodeURIComponent(peerId)}/api`;
}

/**
 * Whether a failed read was the far machine declining to share its API rather
 * than failing to answer.
 *
 * Rig says this with 403 on every daemon route at once, so the status is the
 * whole signal and the wording is never parsed. The cause is followed one link
 * because the stores wrap what they were given into a sentence a person can be
 * shown; the refusal itself survives underneath it, which is where a decision
 * about the machine has to be taken.
 */
function rigAccessRefused(error: unknown): boolean {
    if (error instanceof RigTransportHttpError) return error.statusCode === 403;
    const cause = error instanceof Error ? error.cause : undefined;
    return cause instanceof RigTransportHttpError && cause.statusCode === 403;
}

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
     * The machines this host Rig is peered with, and how each link is doing.
     * Absent on a daemon that does not peer, which is why a surface can say so
     * rather than showing a list that is empty for the wrong reason.
     */
    readonly nodes: RigNodesStore | undefined;
    /**
     * Trusting a new machine, by comparing four emojis at both ends. Present
     * only on this window's host Rig, and only when its daemon's protocol
     * carries pairing: a node is reached because the host already trusts it, so
     * there is nothing to negotiate on a node's own connection.
     */
    readonly pairing: RigPairingStore | undefined;
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
    /**
     * Reports that the connection's first read of the daemon failed, with the
     * reason, while it keeps retrying.
     *
     * The host has somewhere else to say this — its own health probe — but a
     * machine reached through the host does not: a peer that answers nothing,
     * or refuses to share its API at all, would otherwise sit at "connecting"
     * for as long as the window is open. Retrying is still right; saying
     * nothing while retrying is not.
     */
    readonly unavailable?: (error: unknown) => void;
    /**
     * Reports what the connector made of the daemon's protocol handshake: a
     * sentence when the two cannot read each other, and nothing once they can.
     *
     * The host's daemon ships with this app and will normally agree with it. A
     * machine reached through the host will not always, and a version gap there
     * shows up as surfaces that stay empty for a reason nobody is told.
     */
    readonly compatibility?: (message: string | undefined) => void;
    /**
     * Reports whether this Rig is reachable but not sharing its API.
     *
     * A node is peered before it is opened: the two daemons trust each other and
     * the link is up, and yet the machine may still be keeping its work to
     * itself. That is a setting on that machine, not a failure of this one, so
     * it is reported apart from `unavailable` — the node stays connected, and
     * only its projects, sessions, terminals, and browsing are missing.
     */
    readonly restricted?: (restricted: boolean) => void;
}

/**
 * One live connection to a Rig daemon, reached through the main process's
 * loopback proxy: this window's host, or one machine the host is peered with,
 * addressed under that node's own base. Everything above this object is written
 * against `RigSession` alone and does not know which of the two it has.
 */
export interface RigConnectionHandle {
    get(): RigSession | undefined;
    /**
     * Why this Rig cannot be used, while that is the case. A connection that
     * cannot produce a session looks from the outside exactly like one that has
     * not produced a session yet; without somewhere to tell them apart, the
     * surface waits on an unreadable daemon forever.
     */
    failure(): string | undefined;
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
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
    /** Which Rig this is, so its tab and read memory is stored under its own key. */
    readonly rigId: string;
    /**
     * Where this Rig's projected surface is served: the daemon's health, the
     * renderer transport's routes, and the files and Git state behind them.
     */
    readonly rigHttpUrl: string;
    /**
     * Where the connector itself is rooted. Stated rather than derived from
     * `rigHttpUrl`, because the two are not the same place for a machine reached
     * through the host: the projection is served under that node on this
     * window's own proxy, while the connector speaks to the far daemon through
     * the host's peer route. See `rigPeerConnectEndpoint`.
     */
    readonly connectEndpoint: string;
    /**
     * True for the Rig this window is hosted by, which is the one that owns
     * trust. Only the host may be asked to pair with a new machine; a node is
     * reached through the host precisely because that decision was already made.
     */
    readonly pairingOwner: boolean;
}): RigConnectionHandle {
    let disposed = false;
    let session: RigSession | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** rig-connect's refusal of this daemon's protocol, in its own words. */
    let compatibilityFailure: string | undefined;
    /** The last thing to go wrong reading the catalog, while it keeps going wrong. */
    let catalogFailure: string | undefined;
    /**
     * The protocol the daemon on the other end actually negotiated, once the
     * handshake has classified it. Pairing is gated on it, so it is held here
     * rather than derived from anything a surface can see: an older daemon must
     * offer no pairing controls at all, not controls that fail when pressed.
     */
    let serverProtocolVersion: number | undefined;
    /**
     * Who wants to know when that answer arrives. The handshake settles after
     * this connection is built, so a surface gated on the protocol has to be
     * told rather than left holding whatever was known at the moment it opened.
     */
    const protocolListeners = new Set<(version: number | undefined) => void>();
    const transport = rigRendererTransportCreate(input.rigHttpUrl);
    const mutationListeners = new Set<(rejection: MutationRejectedDelta) => void>();
    const rigConnect: RigConnectConnection = connectRig({
        endpoint: input.connectEndpoint,
        token: "happy2-local-capability",
        // The daemon on the other end is not necessarily the one this build was
        // written against — a machine reached through the host runs its own Rig,
        // updated on its own schedule. rig-connect classifies it during the
        // handshake and reads nothing from a daemon it cannot read, so the only
        // thing left to do is say so rather than show a surface that is empty
        // because the protocols do not meet.
        onMutationRejected: (rejection) => {
            for (const listener of mutationListeners) listener(rejection);
        },
        // A daemon this build cannot read is a fact about the machine, not a
        // transient failure, so it is published as soon as the handshake says so
        // rather than inferred later from work that keeps not finishing. It
        // clears the same way: a replaced daemon announces itself here too.
        onCompatibilityChange: (compatibility: ServerCompatibility) => {
            if (disposed) return;
            const nextProtocolVersion =
                compatibility.status === "checking"
                    ? undefined
                    : compatibility.serverProtocolVersion;
            if (serverProtocolVersion !== nextProtocolVersion) {
                serverProtocolVersion = nextProtocolVersion;
                for (const listener of protocolListeners) listener(serverProtocolVersion);
            }
            compatibilityFailure =
                compatibility.status === "compatible" || compatibility.status === "checking"
                    ? undefined
                    : describeServerCompatibility(compatibility);
            input.deps.compatibility?.(compatibilityFailure);
            input.deps.changed();
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
    // The host's own peering, which it streams rather than answers about. Opened
    // lazily like usage: it is the host's report of the machines it is peered
    // with, and a window looking at something else need not hold that stream.
    const nodesSource = rigConnectNodesSourceCreate(rigConnect);
    // Trust, which only the host owns. The source follows the negotiated
    // protocol rather than capturing it: the handshake settles after this is
    // built, and a store that fixed the answer here would call every Rig too
    // old to pair. A daemon that genuinely cannot pair says so before any
    // control is drawn for it, and no pairing route is ever asked of it.
    const pairingSource = input.pairingOwner
        ? rigConnectPairingSourceCreate(rigConnect, {
              current: () => serverProtocolVersion,
              follow: (listener) => {
                  protocolListeners.add(listener);
                  listener(serverProtocolVersion);
                  return () => protocolListeners.delete(listener);
              },
          })
        : undefined;
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
        nodesSource,
        ...(pairingSource ? { pairingSource } : {}),
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
        // them itself. Every Rig this window opens gets one: a node's terminal
        // is attached over the host's peer route, so its bytes reach this
        // window the same way the host's own do.
        terminalDriverCreate,
    });
    const modelsLoad = (): void => {
        void client.models.load().then(
            () => {
                if (disposed) return;
                // Reading the catalog is the proof that the machine is sharing
                // its work, so this is where a node that was holding it back
                // stops being reported that way.
                input.deps.restricted?.(false);
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
                    nodes: client.nodes(),
                    pairing: client.pairing(),
                    friends: client.friends(),
                    sessionShare,
                    sharedSessions: client.sharedSessions(),
                    instructions: client.instructions(),
                    securityPolicy: client.securityPolicy(),
                    clock: rigClockStoreCreate(),
                };
                catalogFailure = undefined;
                input.deps.changed();
            },
            (error: unknown) => {
                if (disposed) return;
                // 403 is the daemon on the other end saying this route is not
                // shared over P2P, which is the whole answer: the machine is
                // there, and its work is not on offer.
                const restricted = rigAccessRefused(error);
                if (restricted) {
                    catalogFailure = undefined;
                    input.deps.restricted?.(true);
                } else {
                    // Kept rather than discarded: this read is the last step
                    // before a Rig has stores at all, so while it keeps failing
                    // the machine has nothing behind it. It still retries,
                    // because the usual reason is a daemon that is starting or
                    // being replaced.
                    catalogFailure =
                        error instanceof Error && error.message
                            ? error.message
                            : "Happy could not read this Rig's model catalog.";
                    input.deps.unavailable?.(error);
                }
                input.deps.changed();
                retry = setTimeout(modelsLoad, restricted ? RESTRICTED_RETRY_MS : RETRY_MS);
            },
        );
    };
    modelsLoad();
    return {
        get: () => session,
        // The handshake outranks a partial session built from legacy endpoints,
        // and outranks whatever failed afterwards: an unreadable daemon is the
        // cause, and the catalog error is only its symptom.
        failure: () => compatibilityFailure ?? (session ? undefined : catalogFailure),
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
            protocolListeners.clear();
            mutationListeners.clear();
            inboxSource.close();
            rigConnect.close();
        },
    };
}
