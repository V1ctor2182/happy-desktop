import { join } from "node:path";
import type {
    DesktopRuntimeSnapshot,
    DesktopStartRequest,
    DesktopTopology,
    DesktopTopologyTarget,
    DesktopUpdateSnapshot,
} from "../shared/desktopContract";
import {
    desktopSettingsActivate,
    desktopSettingsRead,
    desktopSettingsWrite,
    desktopTopologyIdCreate,
    type DesktopSettings,
} from "./desktopSettings";
import {
    desktopActiveTarget,
    desktopStartRequestValidate,
    desktopTopologyRequest,
    desktopTopologyTarget,
} from "./runtimeValidation";
import {
    localRigConnectorCreate,
    RigCommandMissingError,
    type LocalRigConnection,
    type LocalRigConnector,
} from "./localRig";
import {
    connectRig,
    DEFAULT_INSTALLATION_DISCOVERY_TIMEOUT_MS,
    discoverRigInstallation,
    RigInstallationDiscoveryUnsupportedError,
    rigInstallationCompatibility,
    type RigConnection,
    type RigOnboardingState,
    type RigProfile,
    type ServerCompatibility,
} from "@slopus/rig-connect";
import {
    rigDaemonConnectionUnavailable,
    type RigDaemonInspectorResponse,
    type RigDaemonInspectorStopResponse,
} from "./rigDaemonClient";
import type { HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigHttpProxyCreate, type RigHttpProxyHandle } from "./rigHttpProxy";
import { rigInstallCommand } from "./rigInstallTerminal";
import type { Duplex } from "node:stream";

export type RigHttpProxyStart = (
    connection: LocalRigConnection,
    onConnectionError: (error: unknown) => void,
) => Promise<RigHttpProxyHandle>;

const idleUpdate: DesktopUpdateSnapshot = { status: "idle" };
/**
 * How long to wait before each fresh attempt at reaching the daemon.
 *
 * A daemon Happy just asked to start is not listening the instant the command
 * returns, and a socket refused half a second into a cold boot is not a broken
 * machine — it is a machine that is still waking up. Reporting the first refusal
 * as a failure puts a "could not reach Rig" screen in front of someone whose Rig
 * was about to answer, so the first few refusals are simply waited out. The
 * delays grow so a genuinely dead daemon still gives up quickly.
 */
const connectAttemptDelaysMs: readonly number[] = [0, 400, 1_200, 2_500];

export interface DesktopRuntimePaths {
    readonly root: string;
}

export interface DesktopRuntimeOptions {
    readonly localRigConnector?: LocalRigConnector;
    readonly rigHttpProxyStart?: RigHttpProxyStart;
    /**
     * The exact hosted or development renderer origin. It is the only browser
     * origin the loopback Rig proxy answers cross-origin.
     */
    readonly rendererOrigin?: string;
    /** The window's HTML preview proxy, so a Rig's documents can be published. */
    readonly htmlPreview?: HtmlPreviewProxyHandle;
}

/** Owns the active local-Rig topology and one immutable renderer snapshot. */
export class DesktopRuntime implements AsyncDisposable {
    private activationGeneration = 0;
    /** Advances whenever the daemon backing the stable local proxy changes. */
    private connectionGeneration = 0;
    private activeTopology?: DesktopTopology;
    private closed = false;
    private closeTask?: Promise<void>;
    private readonly listeners = new Set<(snapshot: DesktopRuntimeSnapshot) => void>();
    private operation = Promise.resolve();
    private persistOnSuccess = false;
    private reconnectTask?: Promise<void>;
    private rigConnection?: LocalRigConnection;
    private rigConnectConnection?: {
        readonly generation: number;
        readonly connection: RigConnection;
    };
    private rigProxy?: RigHttpProxyHandle;
    private settings?: DesktopSettings;
    private snapshotValue: DesktopRuntimeSnapshot;
    private readonly connector: LocalRigConnector;
    private readonly proxyStart: RigHttpProxyStart;

    private constructor(
        private readonly paths: DesktopRuntimePaths,
        settings: DesktopSettings | undefined,
        options: DesktopRuntimeOptions,
    ) {
        this.settings = settings;
        this.connector = options.localRigConnector ?? localRigConnectorCreate();
        this.proxyStart =
            options.rigHttpProxyStart ??
            ((connection, onConnectionError) =>
                rigHttpProxyCreate({
                    client: connection.client,
                    // The same daemon connection, addressed at one machine it is
                    // peered with. Built here because this is where the real
                    // client lives; the proxy only needs to be able to ask for
                    // one by the identity the host published.
                    peerClient: (nodeId) => connection.client.peer(nodeId),
                    onConnectionError,
                    ...(options.rendererOrigin ? { allowedOrigin: options.rendererOrigin } : {}),
                    ...(options.htmlPreview ? { htmlPreview: options.htmlPreview } : {}),
                }));
        const configuredActive = settings?.topologies.find(
            ({ id }) => id === settings.activeTopologyId,
        );
        const active = configuredActive ??
            settings?.topologies[0] ?? {
                id: desktopTopologyIdCreate(),
                mode: "local" as const,
            };
        if (!settings?.topologies.some(({ id }) => id === active.id)) this.persistOnSuccess = true;
        this.activeTopology = active;
        this.snapshotValue = {
            phase: "starting",
            message: "Connecting to your local Rig daemon…",
            request: desktopTopologyRequest(active),
            targets: this.targets(),
            update: idleUpdate,
        };
    }

    static async create(
        paths: DesktopRuntimePaths,
        options: DesktopRuntimeOptions = {},
    ): Promise<DesktopRuntime> {
        const settings = await desktopSettingsRead(join(paths.root, "desktop-settings.json"));
        const runtime = new DesktopRuntime(paths, settings, options);
        if (runtime.activeTopology)
            void runtime
                .serial(() =>
                    runtime.startValidated(runtime.activeTopology!, runtime.persistOnSuccess),
                )
                .catch(() => undefined);
        return runtime;
    }

    get(): DesktopRuntimeSnapshot {
        return this.snapshotValue;
    }

    subscribe(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    localInspectorStart(expectedConnectionId: number): Promise<RigDaemonInspectorResponse> {
        return this.serial(async () => {
            const client = this.localConnectionRequire(expectedConnectionId).client;
            const result = await client.startInspector();
            this.localConnectionRequire(expectedConnectionId);
            return result;
        });
    }

    localInspectorStop(expectedConnectionId: number): Promise<RigDaemonInspectorStopResponse> {
        return this.serial(async () => {
            const client = this.localConnectionRequire(expectedConnectionId).client;
            const result = await client.stopInspector();
            this.localConnectionRequire(expectedConnectionId);
            return result;
        });
    }

    /** Resolves Rig's complete ordered onboarding contract for this daemon. */
    localOnboardingResolve(expectedConnectionId: number): Promise<RigOnboardingState> {
        return this.serial(() => this.localOnboardingResolveOnce(expectedConnectionId));
    }

    private async localOnboardingResolveOnce(
        expectedConnectionId: number,
    ): Promise<RigOnboardingState> {
        const endpoint = this.localRigEndpoint();
        if (!endpoint) throw new Error("The local Rig daemon is unavailable.");
        const connection = this.localConnectionRequire(expectedConnectionId);
        const rig = this.localRigConnect();
        if (!rig) throw new Error("The local Rig daemon is unavailable.");
        const state = await connectedRigOnboardingResolve(endpoint, rig);
        if (
            this.snapshotValue.phase !== "ready" ||
            this.snapshotValue.connectionId !== expectedConnectionId ||
            this.rigConnection !== connection
        )
            throw new Error("The local Rig changed while Happy was examining it.");
        return state;
    }

    async localOnboardingProfileCreate(
        expectedConnectionId: number,
        input: { readonly email: string; readonly name: string },
    ): Promise<RigProfile> {
        return this.serial(async () => {
            this.localConnectionRequire(expectedConnectionId);
            const rig = this.localRigConnect();
            if (!rig) throw new Error("The local Rig daemon is unavailable.");
            return rig.createProfile(input);
        });
    }

    async localOnboardingProfiles(expectedConnectionId: number): Promise<readonly RigProfile[]> {
        return this.serial(async () => {
            this.localConnectionRequire(expectedConnectionId);
            const rig = this.localRigConnect();
            if (!rig) throw new Error("The local Rig daemon is unavailable.");
            return rig.listProfiles();
        });
    }

    async localOnboardingMurmurChoose(
        expectedConnectionId: number,
        input: { readonly enabled: false } | { readonly enabled: true; readonly profileId: string },
    ): Promise<void> {
        await this.serial(async () => {
            this.localConnectionRequire(expectedConnectionId);
            const rig = this.localRigConnect();
            if (!rig) throw new Error("The local Rig daemon is unavailable.");
            await rig.onboardMurmur(input);
        });
    }

    localOnboardingFreshness(expectedConnectionId: number): Promise<"fresh" | "used"> {
        return this.serial(async () => {
            const client = this.localConnectionRequire(expectedConnectionId).client;
            const catalog = await client.listCatalog();
            this.localConnectionRequire(expectedConnectionId);
            return catalog.projects.some((project) => project.kind !== "home") ? "used" : "fresh";
        });
    }

    localOnboardingProjectAdd(
        expectedConnectionId: number,
        path: string,
    ): Promise<{ readonly path: string }> {
        return this.serial(async () => {
            this.localConnectionRequire(expectedConnectionId);
            const rig = this.localRigConnect();
            if (!rig) throw new Error("The local Rig daemon is unavailable.");
            return rig.projects.add(path);
        });
    }

    private localConnectionRequire(expectedConnectionId: number): LocalRigConnection {
        if (
            this.snapshotValue.phase !== "ready" ||
            this.snapshotValue.mode !== "local" ||
            this.snapshotValue.connectionId !== expectedConnectionId ||
            !this.rigConnection
        )
            throw new Error("The local Rig changed before Happy could finish.");
        return this.rigConnection;
    }

    /** The one shared rig-connect client for this local activation. */
    private localRigConnect(): RigConnection | undefined {
        const endpoint = this.localRigEndpoint();
        if (!endpoint) return undefined;
        const generation = this.connectionGeneration;
        if (this.rigConnectConnection?.generation !== generation) {
            this.rigConnectConnection?.connection.close();
            this.rigConnectConnection = {
                connection: connectRig({
                    endpoint,
                    token: "happy2-local-capability",
                }),
                generation,
            };
        }
        return this.rigConnectConnection.connection;
    }

    /** The capability-scoped proxy endpoint rig-connect owns for local mode. */
    private localRigEndpoint(): string | undefined {
        if (this.snapshotValue.phase !== "ready" || this.snapshotValue.mode !== "local")
            return undefined;
        const endpoint = this.rigProxy?.url;
        return endpoint ? `${endpoint.replace(/\/$/u, "")}/rig-connect` : undefined;
    }

    /**
     * Opens one authenticated browser-proxy tunnel for a session, on the Rig
     * that session belongs to: this machine's daemon, or the client addressing
     * the peered machine named here. The session is resolved on the same Rig
     * the tunnel is opened on, so a name that exists on both machines can never
     * be answered by the wrong one.
     */
    openHttpProxy(sessionId: string, nodeId?: string): Promise<Duplex> {
        if (
            this.snapshotValue.phase !== "ready" ||
            this.snapshotValue.mode !== "local" ||
            !this.rigConnection
        )
            throw new Error("The local Rig daemon is unavailable.");
        const client =
            nodeId === undefined
                ? this.rigConnection.client
                : this.rigConnection.client.peer(nodeId);
        return client.openHttpProxy(sessionId);
    }

    start(request: DesktopStartRequest): Promise<void> {
        return this.serial(async () => {
            desktopStartRequestValidate(request);
            const topology = this.activeTopology ?? {
                id: desktopTopologyIdCreate(),
                mode: "local" as const,
            };
            await this.startValidated(topology, true);
        });
    }

    retry(): Promise<void> {
        return this.serial(async () => {
            if (!this.activeTopology) throw new Error("There is no desktop topology to retry.");
            // A retry started from a failure keeps that failure on screen and
            // only marks itself as running, so the window can put the waiting on
            // the button the person pressed instead of replacing what they were
            // reading with a loading screen and then the same error again.
            const failure = this.snapshotValue.phase === "error" ? this.snapshotValue : undefined;
            if (failure) this.publish({ ...failure, retrying: true });
            await this.startValidated(this.activeTopology, this.persistOnSuccess, !!failure);
        });
    }

    /** Reconnects one failed normal-daemon transport and coalesces concurrent IPC failures. */
    reconnectLocal(error: unknown): Promise<void> {
        if (!rigDaemonConnectionUnavailable(error)) return Promise.resolve();
        if (this.reconnectTask) return this.reconnectTask;
        const topology = this.activeTopology;
        const generation = this.activationGeneration;
        const failedConnection = this.rigConnection;
        const proxy = this.rigProxy;
        if (
            !topology ||
            topology.mode !== "local" ||
            this.closed ||
            this.snapshotValue.phase !== "ready" ||
            this.snapshotValue.mode !== "local" ||
            !failedConnection ||
            !proxy
        )
            return Promise.resolve();
        const task = this.serial(async () => {
            if (
                this.closed ||
                this.activationGeneration !== generation ||
                this.activeTopology?.id !== topology.id ||
                this.snapshotValue.phase !== "ready" ||
                this.rigConnection !== failedConnection ||
                this.rigProxy !== proxy
            )
                return;
            const replacement = await this.connector.connect();
            if (
                this.closed ||
                this.activationGeneration !== generation ||
                this.activeTopology?.id !== topology.id ||
                this.snapshotValue.phase !== "ready" ||
                this.rigConnection !== failedConnection ||
                this.rigProxy !== proxy
            ) {
                replacement.close();
                return;
            }
            try {
                proxy.replace({
                    client: replacement.client,
                    peerClient: (nodeId) => replacement.client.peer(nodeId),
                });
            } catch (replaceError) {
                replacement.close();
                throw replaceError;
            }
            this.rigConnection = replacement;
            this.rigConnectConnection?.connection.close();
            this.rigConnectConnection = undefined;
            failedConnection.close();
            const snapshot = this.snapshotValue;
            if (snapshot.phase === "ready") {
                const connectionId = ++this.connectionGeneration;
                this.publish({
                    ...snapshot,
                    activeTarget: {
                        ...snapshot.activeTarget,
                        rigVersion: replacement.version,
                    },
                    connectionId,
                });
            }
        });
        const tracked = task.finally(() => {
            if (this.reconnectTask === tracked) this.reconnectTask = undefined;
        });
        this.reconnectTask = tracked;
        return tracked;
    }

    reset(): Promise<void> {
        return this.serial(async () => {
            const topology = this.activeTopology ?? {
                id: desktopTopologyIdCreate(),
                mode: "local" as const,
            };
            await this.startValidated(topology, this.persistOnSuccess);
        });
    }

    topologySelect(topologyId: string): Promise<void> {
        return this.serial(async () => {
            if (
                this.snapshotValue.phase === "ready" &&
                this.snapshotValue.activeTargetId === topologyId
            )
                return;
            const topology = this.settings?.topologies.find(({ id }) => id === topologyId);
            if (!topology) throw new Error("The selected Happy topology does not exist.");
            await this.startValidated(topology, true);
        });
    }

    updateSet(update: DesktopUpdateSnapshot): void {
        this.publish({ ...this.snapshotValue, update } as DesktopRuntimeSnapshot);
    }

    close(): Promise<void> {
        this.closeTask ??= this.closeOnce();
        return this.closeTask;
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    private async closeOnce(): Promise<void> {
        this.closed = true;
        this.activationGeneration += 1;
        await this.serial(async () => this.localDispose());
    }

    /**
     * Reaches the daemon, waiting out the refusals that a starting daemon gives.
     *
     * Only a connection that failed for a reason another attempt could change is
     * retried: a missing `rig` command and a daemon that refuses on its own terms
     * — no signed-in coding assistant, for instance — will answer exactly the
     * same way in two seconds, and waiting on them only makes the window feel
     * broken. Returns nothing when this activation was superseded while waiting.
     */
    private async connectAttempt(generation: number): Promise<LocalRigConnection | undefined> {
        let failure: unknown;
        for (const [index, delay] of connectAttemptDelaysMs.entries()) {
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            if (generation !== this.activationGeneration) return undefined;
            try {
                return await this.connector.connect();
            } catch (error) {
                failure = error;
                if (index === connectAttemptDelaysMs.length - 1) break;
                if (!connectAttemptRetryable(error)) break;
            }
        }
        throw failure;
    }

    private async startValidated(
        topology: DesktopTopology,
        persist: boolean,
        inPlace = false,
    ): Promise<void> {
        if (this.closed) throw new Error("The desktop runtime is closed.");
        const generation = ++this.activationGeneration;
        this.localDispose();
        this.activeTopology = topology;
        this.persistOnSuccess = persist;
        const request = desktopTopologyRequest(topology);
        if (!inPlace)
            this.publish({
                phase: "starting",
                message: "Connecting to your local Rig daemon…",
                request,
                targets: this.targets(),
                update: this.snapshotValue.update,
            });
        try {
            const connection = await this.connectAttempt(generation);
            if (connection === undefined) return;
            if (generation !== this.activationGeneration) {
                connection.close();
                return;
            }
            this.rigConnection = connection;
            const connectionId = ++this.connectionGeneration;
            const proxy = await this.proxyStart(connection, (error) => {
                void this.reconnectLocal(error).catch(() => undefined);
            });
            if (generation !== this.activationGeneration) {
                proxy.close();
                connection.close();
                this.rigConnection = undefined;
                return;
            }
            this.rigProxy = proxy;
            const rigVersion = connection.version;
            const rigHttpUrl = proxy.url;
            if (this.persistOnSuccess) {
                const settings = desktopSettingsActivate(this.settings, topology);
                await desktopSettingsWrite(
                    join(this.paths.root, "desktop-settings.json"),
                    settings,
                );
                this.settings = settings;
                this.persistOnSuccess = false;
            }
            if (generation !== this.activationGeneration) return;
            const activeTarget = desktopActiveTarget(topology, rigVersion, rigHttpUrl);
            this.publish({
                phase: "ready",
                activeTarget,
                activeTargetId: activeTarget.id,
                connectionId,
                mode: topology.mode,
                targets: this.targets(),
                update: this.snapshotValue.update,
            });
        } catch (error) {
            this.localDispose();
            if (generation !== this.activationGeneration) return;
            if (error instanceof RigCommandMissingError) {
                this.publish({
                    phase: "installRequired",
                    command: rigInstallCommand,
                    message: "Rig is required for local mode.",
                    request: { mode: "local" },
                    targets: this.targets(),
                    update: this.snapshotValue.update,
                });
                return;
            }
            this.publish({
                phase: "error",
                message: displayError(error),
                request,
                retryable: true,
                targets: this.targets(),
                update: this.snapshotValue.update,
            });
            throw error;
        }
    }

    private localDispose(): void {
        this.rigConnectConnection?.connection.close();
        this.rigConnectConnection = undefined;
        this.rigProxy?.close();
        this.rigProxy = undefined;
        this.rigConnection?.close();
        this.rigConnection = undefined;
    }

    private publish(snapshot: DesktopRuntimeSnapshot): void {
        this.snapshotValue = snapshot;
        for (const listener of this.listeners) listener(snapshot);
    }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.operation.then(work, work);
        this.operation = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }

    private targets(): readonly DesktopTopologyTarget[] {
        const configured = this.settings?.topologies ?? [];
        const active =
            this.activeTopology && !configured.some(({ id }) => id === this.activeTopology?.id)
                ? [this.activeTopology]
                : [];
        return [...configured, ...active].map(desktopTopologyTarget);
    }
}

/**
 * Whether waiting and asking again could plausibly answer differently.
 *
 * Only the transport's own refusals qualify — a socket that is not there yet, a
 * connection dropped mid-handshake, an attempt that timed out. Anything the
 * daemon said deliberately, and anything about this machine's setup, is a fact
 * rather than a moment, and repeating the question just delays saying so.
 */
function connectAttemptRetryable(error: unknown): boolean {
    if (error instanceof RigCommandMissingError) return false;
    return rigDaemonConnectionUnavailable(error);
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves onboarding from the daemon Happy has already authenticated.
 *
 * Offline `rig inspect` is for installation and repair while no daemon can
 * answer. Once a daemon is serving the shared endpoint, a separately resolved
 * CLI may be older, newer, or belong to another checkout; it must not veto that
 * live connection. Authenticated installation discovery retains the protocol
 * gate and validates the daemon's current initialized-data contract before its
 * onboarding status is accepted.
 */
async function connectedRigOnboardingResolve(
    endpoint: string,
    rig: RigConnection,
): Promise<RigOnboardingState> {
    try {
        const discovery = await discoverRigInstallation({
            endpoint,
            token: "happy2-local-capability",
        });
        const compatibility = rigInstallationCompatibility(discovery);
        if (compatibility.status === "checking")
            throw new Error("Rig daemon compatibility could not be determined.");
        if (compatibility.status !== "compatible")
            return daemonProtocolMismatchState(compatibility, discovery.daemonVersion);
        return await rig.getOnboardingStatus({
            signal: AbortSignal.timeout(DEFAULT_INSTALLATION_DISCOVERY_TIMEOUT_MS),
        });
    } catch (error) {
        if (error instanceof RigInstallationDiscoveryUnsupportedError)
            return daemonProtocolMismatchState(error.compatibility);
        return rigUnreachableState(error);
    }
}

function daemonProtocolMismatchState(
    compatibility: Exclude<ServerCompatibility, { status: "checking" } | { status: "compatible" }>,
    installedVersion?: string,
): RigOnboardingState {
    return {
        ...(installedVersion === undefined
            ? {}
            : { installedVersion: installedVersion.slice(0, 256) }),
        maximumSupportedProtocolVersion: compatibility.maximumSupportedProtocolVersion,
        minimumSupportedProtocolVersion: compatibility.minimumSupportedProtocolVersion,
        protocolVersion: compatibility.serverProtocolVersion,
        reason: "protocol",
        source: "daemon",
        state: "version_mismatch",
        upgrade: compatibility.status === "client_outdated" ? "happy" : "rig",
    };
}

function rigUnreachableState(error: unknown): RigOnboardingState {
    return {
        message: displayError(error).slice(0, 2_048) || "Rig could not be reached.",
        state: "rig_unreachable",
    };
}

export { rigDaemonConnectionUnavailable };
