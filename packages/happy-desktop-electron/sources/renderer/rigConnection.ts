import { terminalDriverCreate } from "happy-desktop-app";
import {
    connectHappyAgent,
    describeServerCompatibility,
    HappyAgentClient,
    rigClientCreate,
    rigClockStoreCreate,
    rigDebugLogStoreCreate,
    rigWorkspaceStoreCreate,
    type MutationRejectedDelta,
    type RigClient,
    type RigClockStore,
    type RigConnection,
    type RigConnectionSnapshot,
    type RigConnectionStore,
    type RigDebugLogInput,
    type RigDebugLogStore,
    type RigHost,
    type RigInstructionsStore,
    type RigModelPreferencePersistence,
    type RigModelStore,
    type RigProfileStore,
    type RigProviderUsageStore,
    type RigSecurityPolicyStore,
    type RigSessionLocation,
    type RigWorkspaceMemoryDocument,
    type RigWorkspaceMemoryPersistence,
    type RigWorkspaceStore,
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

export interface RigProtocolMismatch {
    readonly side: "app" | "rig";
    readonly serverProtocolVersion: number;
    readonly supportedMinimum: number;
    readonly supportedMaximum: number;
    readonly message: string;
}

function protocolMismatchOf(compatibility: ServerCompatibility): RigProtocolMismatch | undefined {
    if (compatibility.status === "checking" || compatibility.status === "compatible")
        return undefined;
    return {
        message: describeServerCompatibility(compatibility),
        serverProtocolVersion: compatibility.serverProtocolVersion,
        side: compatibility.status === "client_outdated" ? "app" : "rig",
        supportedMaximum: compatibility.maximumSupportedProtocolVersion,
        supportedMinimum: compatibility.minimumSupportedProtocolVersion,
    };
}

const WORKSPACE_MEMORY_PREFIX = "happy2.rig.workspace-memory.v1:";
const RETRY_MS = 1_000;

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
                // Storage-denied windows retain the in-memory store for this run.
            }
        },
    };
}

export interface RigSession {
    readonly connection: RigConnectionStore;
    readonly debugLog: RigDebugLogStore;
    readonly host: RigHost;
    readonly models: RigModelStore;
    readonly profile: () => RigProfileStore | undefined;
    readonly providerUsage: RigProviderUsageStore | undefined;
    readonly workspace: RigWorkspaceStore;
    readonly instructions: RigInstructionsStore;
    readonly securityPolicy: RigSecurityPolicyStore;
    readonly clock: RigClockStore;
}

export interface RigSessionDeps {
    readonly conversationOpen: (location: RigSessionLocation) => void;
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
    readonly compatibility?: (mismatch: RigProtocolMismatch | undefined) => void;
}

export interface RigConnectionHandle {
    get(): RigSession | undefined;
    failure(): string | undefined;
    dispose(): void;
}

function snapshotsEqual(left: RigConnectionSnapshot, right: RigConnectionSnapshot): boolean {
    return (
        left.connection === right.connection &&
        left.daemon === right.daemon &&
        left.message === right.message &&
        left.attempt === right.attempt
    );
}

/**
 * Projects the connection's existing SSE lifecycle into the host availability
 * store. It opens no transport of its own: `/health` remains the one startup
 * gate inside `connectHappyAgent`, and stream completion owns reconnect state.
 */
function streamConnectionStoreCreate(connection: RigConnection): RigConnectionStore {
    const listeners = new Set<() => void>();
    let snapshot: RigConnectionSnapshot = {
        attempt: 0,
        connection: "connecting",
        daemon: "unknown",
    };
    let sourceState: ReturnType<ReturnType<RigConnection["connectGroups"]>["state"]>["connection"] =
        "connecting";
    let disposed = false;

    const publish = (next: RigConnectionSnapshot): void => {
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
                message:
                    state.connection === "closed"
                        ? "This Rig connection is closed."
                        : "The SSE stream is reconnecting.",
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
export function rigConnectionOpen(input: {
    readonly host: RigHost;
    readonly deps: RigSessionDeps;
    readonly modelPreferencePersistence: RigModelPreferencePersistence;
    readonly rigId: string;
    readonly rigHttpUrl: string;
    readonly connectEndpoint: string;
    /**
     * The window's appearance right now, read again for every terminal this
     * connection opens. A terminal is started in it and keeps it afterwards.
     */
    readonly terminalColorScheme: () => TerminalColorScheme;
}): RigConnectionHandle {
    let disposed = false;
    let session: RigSession | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let compatibilityFailure: string | undefined;
    let catalogFailure: string | undefined;
    const { store: debugLog, writer: debugLogWriter } = rigDebugLogStoreCreate();
    const debugEntry = (entry: RigDebugLogInput): void => debugLogWriter.entryAppend(entry);
    debugEntry({
        detail: JSON.stringify(
            { connectEndpoint: input.connectEndpoint, rigHttpUrl: input.rigHttpUrl },
            null,
            2,
        ),
        level: "info",
        message: "Opening local Rig connection",
        source: "connection",
    });
    const directClient = new HappyAgentClient({
        endpoint: input.connectEndpoint,
        token: "happy2-local-capability",
    });
    const profile = happyAgentProfileSourceCreate(directClient);
    const mutationListeners = new Set<(rejection: MutationRejectedDelta) => void>();
    const agentConnection: RigConnection = connectHappyAgent({
        client: directClient,
        endpoint: input.connectEndpoint,
        token: "happy2-local-capability",
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
        onSessionFinished: () => completionChimePlay(),
    });
    const catalogSource = happyAgentCatalogSourceCreate(agentConnection, input.rigHttpUrl);
    const hostServices = happyAgentHostServicesCreate(input.rigHttpUrl);
    const client: RigClient = rigClientCreate({
        client: directClient,
        connection: agentConnection,
        hostServices,
        modelPreferencePersistence: input.modelPreferencePersistence,
        workspaceMemoryPersistence: workspaceMemoryPersistence(input.rigId),
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
                    workspace: rigWorkspaceStoreCreate(client, {
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
                    clock: rigClockStoreCreate(),
                };
                debugEntry({
                    level: "info",
                    message: "Rig product stores materialized",
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
                        : "Happy could not read this Rig's model catalog.";
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
                message: "Disposing local Rig connection",
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
