import { terminalDriverCreate } from "happy-desktop-app";
import {
    connectHappyAgent,
    describeServerCompatibility,
    HappyAgentClient,
    rigClientCreate,
    rigClockStoreCreate,
    rigConnectionLoaderCreate,
    rigDebugLogStoreCreate,
    rigWorkspaceStoreCreate,
    type MutationRejectedDelta,
    type RigClient,
    type RigClockStore,
    type RigConnection,
    type RigConnectionStore,
    type RigDaemonHealth,
    type RigDebugLogInput,
    type RigDebugLogStore,
    type RigHost,
    type RigInstructionsStore,
    type RigModelPreferencePersistence,
    type RigModelStore,
    type RigProfilesStore,
    type RigProviderUsageStore,
    type RigSecurityPolicyStore,
    type RigSessionLocation,
    type RigWorkspaceMemoryDocument,
    type RigWorkspaceMemoryPersistence,
    type RigWorkspaceStore,
    type ServerCompatibility,
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
    readonly profiles: () => RigProfilesStore | undefined;
    readonly providerUsage: RigProviderUsageStore | undefined;
    readonly workspace: RigWorkspaceStore;
    readonly instructions: RigInstructionsStore;
    readonly securityPolicy: RigSecurityPolicyStore;
    readonly clock: RigClockStore;
}

export interface RigSessionDeps {
    readonly conversationOpen: (location: RigSessionLocation) => void;
    readonly groupOpen: (groupId: string) => void;
    readonly listOpen: (groupId: string) => void;
    readonly changed: () => void;
    readonly unavailable?: (error: unknown) => void;
    readonly compatibility?: (mismatch: RigProtocolMismatch | undefined) => void;
}

export interface RigConnectionHandle {
    get(): RigSession | undefined;
    failure(): string | undefined;
    dispose(): void;
}

function healthProbe(client: HappyAgentClient): () => Promise<RigDaemonHealth> {
    return async () => {
        const health = await client.getHealth();
        return {
            status: health.status,
            version: health.version.daemon,
        };
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
    const profiles = happyAgentProfileSourceCreate(directClient, input.rigId);
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
        profilesActions: profiles.actions,
        profilesSource: profiles.source,
        providerUsageSource: happyAgentUsageSourceCreate(directClient),
        transcriptConnect: happyAgentTranscriptConnectCreate(agentConnection),
        connectMutationSubscribe: (listener) => {
            mutationListeners.add(listener);
            return () => mutationListeners.delete(listener);
        },
        terminalDriverCreate,
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
                    connection: rigConnectionLoaderCreate({
                        onDebugEntry: debugEntry,
                        probe: healthProbe(directClient),
                    }),
                    debugLog,
                    host: input.host,
                    models: client.models,
                    profiles: () => client.profiles(),
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
                                    input.deps.listOpen(event.groupId);
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
