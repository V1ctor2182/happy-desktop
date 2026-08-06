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
import { connectRig, type RigConnection, type RigProjects } from "@slopus/rig-connect";
import { rigDaemonConnectionUnavailable, type RigDaemonClient } from "./rigDaemonClient";
import type { HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigHttpProxyCreate, type RigHttpProxyHandle } from "./rigHttpProxy";
import { rigInstallCommand } from "./rigInstallTerminal";
import type { Duplex } from "node:stream";

export type RigHttpProxyStart = (
    connection: LocalRigConnection,
    onConnectionError: (error: unknown) => void,
) => Promise<RigHttpProxyHandle>;

const idleUpdate: DesktopUpdateSnapshot = { status: "idle" };

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
    private activeTopology?: DesktopTopology;
    private closed = false;
    private closeTask?: Promise<void>;
    private readonly listeners = new Set<(snapshot: DesktopRuntimeSnapshot) => void>();
    private operation = Promise.resolve();
    private persistOnSuccess = false;
    private reconnectTask?: Promise<void>;
    private rigConnection?: LocalRigConnection;
    private rigProjectsConnection?: {
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

    /**
     * The live local daemon client, or nothing while no local Rig is connected.
     * It is exposed so another main-process owner can ask the daemon a question
     * without opening a second connection to it; the renderer never sees this.
     */
    localClient(): RigDaemonClient | undefined {
        return this.snapshotValue.phase === "ready" && this.snapshotValue.mode === "local"
            ? this.rigConnection?.client
            : undefined;
    }

    /**
     * Rig's authoritative project registration for the connected local Rig, or
     * nothing while none is connected.
     *
     * It is `rig-connect`'s own `projects` surface rather than a hand-rolled
     * request, because registration's contract — validating the folder, minting
     * one project identity, and converging on that identity when a response is
     * lost after the daemon already committed — belongs to the released client.
     * The connector is made once per activation and closed with the connection
     * it belongs to, so a Rig that has been replaced cannot still be registered
     * against.
     */
    localProjects(): RigProjects | undefined {
        if (this.snapshotValue.phase !== "ready" || this.snapshotValue.mode !== "local")
            return undefined;
        const endpoint = this.rigProxy?.url;
        if (!endpoint) return undefined;
        const generation = this.activationGeneration;
        if (this.rigProjectsConnection?.generation !== generation) {
            this.rigProjectsConnection?.connection.close();
            this.rigProjectsConnection = {
                connection: connectRig({
                    endpoint: `${endpoint.replace(/\/$/u, "")}/rig-connect`,
                    token: "happy2-local-capability",
                }),
                generation,
            };
        }
        return this.rigProjectsConnection.connection.projects;
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
            await this.startValidated(this.activeTopology, this.persistOnSuccess);
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
            failedConnection.close();
            const snapshot = this.snapshotValue;
            if (snapshot.phase === "ready") {
                this.publish({
                    ...snapshot,
                    activeTarget: {
                        ...snapshot.activeTarget,
                        rigVersion: replacement.version,
                    },
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

    private async startValidated(topology: DesktopTopology, persist: boolean): Promise<void> {
        if (this.closed) throw new Error("The desktop runtime is closed.");
        const generation = ++this.activationGeneration;
        this.localDispose();
        this.activeTopology = topology;
        this.persistOnSuccess = persist;
        const request = desktopTopologyRequest(topology);
        this.publish({
            phase: "starting",
            message: "Connecting to your local Rig daemon…",
            request,
            targets: this.targets(),
            update: this.snapshotValue.update,
        });
        try {
            const connection = await this.connector.connect();
            if (generation !== this.activationGeneration) {
                connection.close();
                return;
            }
            this.rigConnection = connection;
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
                connectionId: generation,
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
        this.rigProjectsConnection?.connection.close();
        this.rigProjectsConnection = undefined;
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

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export { rigDaemonConnectionUnavailable };
