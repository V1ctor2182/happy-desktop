import { terminalDriverCreate } from "happy-desktop-app";
import {
    connectHappyAgent,
    describeServerCompatibility,
    HappyAgentClient,
    happyAgentWorkspaceClientCreate,
    happyAgentClockStoreCreate,
    happyAgentDebugLogStoreCreate,
    happyAgentWorkspaceStoreCreate,
    type MutationRejectedDelta,
    type HappyAgentWorkspaceClient,
    type HappyAgentClockStore,
    type HappyAgentConnection,
    type HappyAgentConnectionSnapshot,
    type HappyAgentConnectionStore,
    type HappyAgentDebugLogInput,
    type HappyAgentDebugLogStore,
    type HappyAgentHost,
    type HappyAgentInstructionsStore,
    type HappyAgentModelPreferencePersistence,
    type HappyAgentModelStore,
    type HappyAgentProfileStore,
    type HappyAgentProviderUsageStore,
    type HappyAgentSecurityPolicyStore,
    type HappyAgentSessionLocation,
    type HappyAgentWorkspaceMemoryDocument,
    type HappyAgentWorkspaceMemoryPersistence,
    type HappyAgentWorkspaceStore,
    type ServerCompatibility,
    type TerminalColorScheme,
} from "happy-desktop-state";
import { completionChimePlay } from "./completionChime";
import { desktopViewPreferencesPersistence } from "./desktopViewPreferences";
import { happyAgentCatalogSourceCreate } from "./happyAgentCatalogSource";
import { happyAgentHostServicesCreate } from "./happyAgentHostServices";
import { happyAgentProfileSourceCreate } from "./happyAgentProfileSource";
import { happyAgentTranscriptConnectCreate } from "./happyAgentTranscriptSource";
import { happyAgentUsageSourceCreate } from "./happyAgentUsageSource";

export interface HappyAgentProtocolMismatch {
    readonly side: "app" | "agent";
    readonly serverProtocolVersion: number;
    readonly supportedMinimum: number;
    readonly supportedMaximum: number;
    readonly message: string;
}

function protocolMismatchOf(
    compatibility: ServerCompatibility,
): HappyAgentProtocolMismatch | undefined {
    if (compatibility.status === "checking" || compatibility.status === "compatible")
        return undefined;
    return {
        message: describeServerCompatibility(compatibility),
        serverProtocolVersion: compatibility.serverProtocolVersion,
        side: compatibility.status === "client_outdated" ? "app" : "agent",
        supportedMaximum: compatibility.maximumSupportedProtocolVersion,
        supportedMinimum: compatibility.minimumSupportedProtocolVersion,
    };
}

const WORKSPACE_MEMORY_PREFIX = "happy.happy-agent.workspace-memory.v1:";
const RETRY_MS = 1_000;

function workspaceMemoryPersistence(happyAgentId: string): HappyAgentWorkspaceMemoryPersistence {
    const key = `${WORKSPACE_MEMORY_PREFIX}${happyAgentId}`;
    return {
        read() {
            try {
                const value = localStorage.getItem(key);
                return value ? (JSON.parse(value) as HappyAgentWorkspaceMemoryDocument) : undefined;
            } catch {
                return undefined;
            }
        },
        write(document) {
            try {
                localStorage.setItem(key, JSON.stringify(document));
            } catch {
                // Storage-denied windows retain the in-memory store for this run.
            }
        },
    };
}

export interface HappyAgentSession {
    readonly connection: HappyAgentConnectionStore;
    readonly debugLog: HappyAgentDebugLogStore;
    readonly host: HappyAgentHost;
    readonly models: HappyAgentModelStore;
    readonly profile: () => HappyAgentProfileStore | undefined;
    readonly providerUsage: HappyAgentProviderUsageStore | undefined;
    readonly workspace: HappyAgentWorkspaceStore;
    readonly instructions: HappyAgentInstructionsStore;
    readonly securityPolicy: HappyAgentSecurityPolicyStore;
    readonly clock: HappyAgentClockStore;
}

export interface HappyAgentSessionDeps {
    readonly conversationOpen: (location: HappyAgentSessionLocation) => void;
    readonly groupOpen: (groupId: string) => void;
    /**
     * Takes a group gone from the host's catalog out of this window's
     * navigation. Every remembered place inside it goes too, so no Back returns
     * to a row that no longer exists.
     */
    readonly groupForget: (groupId: string) => void;
    /** Announces that this connection's session is ready or has been replaced. */
    readonly changed: () => void;
    readonly unavailable?: (error: unknown) => void;
    readonly compatibility?: (mismatch: HappyAgentProtocolMismatch | undefined) => void;
}

export interface HappyAgentConnectionHandle {
    get(): HappyAgentSession | undefined;
    failure(): string | undefined;
    dispose(): void;
}

function snapshotsEqual(
    left: HappyAgentConnectionSnapshot,
    right: HappyAgentConnectionSnapshot,
): boolean {
    return (
        left.connection === right.connection &&
        left.daemon === right.daemon &&
        left.message === right.message &&
        left.attempt === right.attempt
    );
}

/**
 * Projects the connection's managed update-feed lifecycle into the host
 * availability store. It opens no transport of its own: `/health` remains the
 * one startup gate inside `connectHappyAgent`, and the shared client owns
 * reconnect state.
 */
function streamConnectionStoreCreate(connection: HappyAgentConnection): HappyAgentConnectionStore {
    const listeners = new Set<() => void>();
    let snapshot: HappyAgentConnectionSnapshot = {
        attempt: 0,
        connection: "connecting",
        daemon: "unknown",
    };
    let sourceState: ReturnType<
        ReturnType<HappyAgentConnection["connectGroups"]>["state"]
    >["connection"] = "connecting";
    let disposed = false;

    const publish = (next: HappyAgentConnectionSnapshot): void => {
        if (snapshotsEqual(snapshot, next)) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const source = connection.connectGroups({
        onChange: (_projects, state) => {
            const previous = sourceState;
            sourceState = state.connection;
            if (state.connection === "live") {
                publish({ attempt: 0, connection: "connected", daemon: "ready" });
                return;
            }
            if (state.connection === "connecting") {
                publish({ attempt: 0, connection: "connecting", daemon: "unknown" });
                return;
            }
            const attempt =
                state.connection === "reconnecting" && previous !== "reconnecting"
                    ? snapshot.attempt + 1
                    : snapshot.attempt;
            publish({
                attempt,
                connection: "disconnected",
                daemon: "unknown",
                // A closed connection is a fact about this Happy Agent worth stating.
                // Reconnecting is not: the window's own header says the machine
                // is unreachable, and naming the transport that is retrying
                // tells a reader nothing they can act on.
                ...(state.connection === "closed"
                    ? { message: "This Happy Agent connection is closed." }
                    : {}),
            });
        },
        onError: (error) => {
            publish({
                attempt: Math.max(1, snapshot.attempt),
                connection: "disconnected",
                daemon: "unknown",
                message: error instanceof Error ? error.message : String(error),
            });
        },
    });

    return {
        get: () => snapshot,
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        retry: () => connection.retry(),
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            source.close();
            listeners.clear();
        },
    };
}

/**
 * Opens the local daemon's Happy Agent connection and composes its live product
 * state with the small set of services that remain owned by the desktop host.
 */
export function happyAgentConnectionOpen(input: {
    readonly host: HappyAgentHost;
    readonly deps: HappyAgentSessionDeps;
    readonly modelPreferencePersistence: HappyAgentModelPreferencePersistence;
    readonly happyAgentId: string;
    /**
     * Where the daemon answers. The proxy forwards the daemon's own `/v0`
     * namespace as it stands, so this one origin serves the protocol client,
     * the catalog, and the desktop-local host routes alike.
     */
    readonly happyAgentHttpUrl: string;
    /**
     * The window's appearance right now, read again for every terminal this
     * connection opens. A terminal is started in it and keeps it afterwards.
     */
    readonly terminalColorScheme: () => TerminalColorScheme;
}): HappyAgentConnectionHandle {
    let disposed = false;
    let session: HappyAgentSession | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let compatibilityFailure: string | undefined;
    let catalogFailure: string | undefined;
    const { store: debugLog, writer: debugLogWriter } = happyAgentDebugLogStoreCreate();
    const debugEntry = (entry: HappyAgentDebugLogInput): void => debugLogWriter.entryAppend(entry);
    debugEntry({
        detail: JSON.stringify({ happyAgentHttpUrl: input.happyAgentHttpUrl }, null, 2),
        level: "info",
        message: "Opening local Happy Agent connection",
        source: "connection",
    });
    const directClient = new HappyAgentClient({
        endpoint: input.happyAgentHttpUrl,
        token: "happy-local-capability",
    });
    const profile = happyAgentProfileSourceCreate(directClient);
    const mutationListeners = new Set<(rejection: MutationRejectedDelta) => void>();
    const agentConnection: HappyAgentConnection = connectHappyAgent({
        client: directClient,
        endpoint: input.happyAgentHttpUrl,
        token: "happy-local-capability",
        onDebugEntry: debugEntry,
        onMutationRejected: (rejection) => {
            for (const listener of mutationListeners) listener(rejection);
        },
        onCompatibilityChange: (compatibility) => {
            if (disposed) return;
            const mismatch = protocolMismatchOf(compatibility);
            compatibilityFailure = mismatch?.message;
            input.deps.compatibility?.(mismatch);
            input.deps.changed();
        },
        onTopLevelSessionFinished: () => completionChimePlay(),
    });
    const catalogSource = happyAgentCatalogSourceCreate(agentConnection, input.happyAgentHttpUrl);
    const hostServices = happyAgentHostServicesCreate(input.happyAgentHttpUrl);
    const client: HappyAgentWorkspaceClient = happyAgentWorkspaceClientCreate({
        client: directClient,
        connection: agentConnection,
        hostServices,
        modelPreferencePersistence: input.modelPreferencePersistence,
        workspaceMemoryPersistence: workspaceMemoryPersistence(input.happyAgentId),
        catalogSource,
        profileActions: profile.actions,
        profileSource: profile.source,
        providerUsageSource: happyAgentUsageSourceCreate(directClient),
        transcriptConnect: happyAgentTranscriptConnectCreate(agentConnection),
        connectMutationSubscribe: (listener) => {
            mutationListeners.add(listener);
            return () => mutationListeners.delete(listener);
        },
        terminalDriverCreate,
        terminalColorScheme: input.terminalColorScheme,
    });

    const modelsLoad = (): void => {
        debugEntry({
            level: "info",
            message: "Loading model catalog",
            source: "catalog",
        });
        void client.models.load().then(
            (modelSnapshot) => {
                if (disposed) return;
                debugEntry({
                    detail: JSON.stringify(
                        {
                            models: modelSnapshot.catalog.providers.reduce(
                                (count, provider) => count + provider.models.length,
                                0,
                            ),
                            providers: modelSnapshot.catalog.providers.length,
                        },
                        null,
                        2,
                    ),
                    level: "info",
                    message: "Model catalog loaded",
                    source: "catalog",
                });
                session = {
                    connection: streamConnectionStoreCreate(agentConnection),
                    debugLog,
                    host: input.host,
                    models: client.models,
                    profile: () => client.profile(),
                    providerUsage: client.providerUsage(),
                    workspace: happyAgentWorkspaceStoreCreate(client, {
                        host: input.host,
                        viewPreferences: desktopViewPreferencesPersistence(),
                        output: (event) => {
                            switch (event.type) {
                                case "conversationOpenRequested":
                                    input.deps.conversationOpen(event.location);
                                    return;
                                case "groupOpenRequested":
                                    input.deps.groupOpen(event.groupId);
                                    return;
                                case "addressedGroupRemoved":
                                    input.deps.groupForget(event.groupId);
                                    return;
                            }
                        },
                    }),
                    instructions: client.instructions(),
                    securityPolicy: client.securityPolicy(),
                    clock: happyAgentClockStoreCreate(),
                };
                debugEntry({
                    level: "info",
                    message: "Happy Agent product stores materialized",
                    source: "sync",
                });
                catalogFailure = undefined;
                input.deps.changed();
            },
            (error: unknown) => {
                if (disposed) return;
                debugEntry({
                    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
                    level: "error",
                    message: `Model catalog failed; retrying in ${RETRY_MS} ms`,
                    source: "catalog",
                });
                catalogFailure =
                    error instanceof Error && error.message
                        ? error.message
                        : "Happy could not read this Happy Agent's model catalog.";
                input.deps.unavailable?.(error);
                input.deps.changed();
                retry = setTimeout(modelsLoad, RETRY_MS);
            },
        );
    };
    modelsLoad();

    return {
        get: () => session,
        failure: () => compatibilityFailure ?? (session ? undefined : catalogFailure),
        dispose() {
            if (disposed) return;
            debugEntry({
                level: "info",
                message: "Disposing local Happy Agent connection",
                source: "connection",
            });
            disposed = true;
            if (retry) clearTimeout(retry);
            if (session) {
                session.workspace[Symbol.dispose]();
                session.connection[Symbol.dispose]();
                session.clock[Symbol.dispose]();
                session = undefined;
            }
            client[Symbol.dispose]();
            mutationListeners.clear();
            agentConnection.close();
        },
    };
}
