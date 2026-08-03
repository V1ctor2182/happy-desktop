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
    desktopTopologyFromRequest,
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
    /** Pins this process to one automatically materialized local topology. */
    readonly localOnly?: boolean;
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

/** Owns the active local-Rig or remote-cloud topology and one immutable renderer snapshot. */
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
    private readonly localOnly: boolean;
    private readonly proxyStart: RigHttpProxyStart;

    private constructor(
        private readonly paths: DesktopRuntimePaths,
        settings: DesktopSettings | undefined,
        options: DesktopRuntimeOptions,
    ) {
        this.settings = settings;
        this.localOnly = options.localOnly ?? false;
        this.connector = options.localRigConnector ?? localRigConnectorCreate();
        this.proxyStart =
            options.rigHttpProxyStart ??
            ((connection, onConnectionError) =>
                rigHttpProxyCreate({
                    client: connection.client,
                    onConnectionError,
                    ...(options.rendererOrigin ? { allowedOrigin: options.rendererOrigin } : {}),
                    ...(options.htmlPreview ? { htmlPreview: options.htmlPreview } : {}),
                }));
        const configuredActive = settings?.topologies.find(
            ({ id }) => id === settings.activeTopologyId,
        );
        const active = this.localOnly
            ? configuredActive?.mode === "local"
                ? configuredActive
                : (settings?.topologies.find(({ mode }) => mode === "local") ?? {
                      id: desktopTopologyIdCreate(),
                      mode: "local" as const,
                  })
            : configuredActive;
        if (this.localOnly && !settings?.topologies.some(({ id }) => id === active?.id))
            this.persistOnSuccess = true;
        if (active) {
            this.activeTopology = active;
            this.snapshotValue = {
                phase: "starting",
                message:
                    active.mode === "local"
                        ? "Connecting to your local Rig daemon…"
                        : "Connecting to your cloud Happy workspace…",
                request: desktopTopologyRequest(active),
                targets: this.targets(),
                update: idleUpdate,
            };
        } else
            this.snapshotValue = {
                phase: "choosing",
                targets: [],
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

    /** Opens one authenticated browser-proxy tunnel through the active local Rig daemon. */
    openHttpProxy(sessionId: string): Promise<Duplex> {
        if (
            this.snapshotValue.phase !== "ready" ||
            this.snapshotValue.mode !== "local" ||
            !this.rigConnection
        )
            throw new Error("The local Rig daemon is unavailable.");
        return this.rigConnection.client.openHttpProxy(sessionId);
    }

    start(request: DesktopStartRequest): Promise<void> {
        return this.serial(async () => {
            const validated = desktopStartRequestValidate(request);
            if (this.localOnly && validated.mode !== "local")
                throw new Error("This Happy build supports local mode only.");
            if (this.localOnly) {
                const topology =
                    this.activeTopology?.mode === "local"
                        ? this.activeTopology
                        : { id: desktopTopologyIdCreate(), mode: "local" as const };
                await this.startValidated(topology, this.persistOnSuccess);
                return;
            }
            const topology = desktopTopologyFromRequest(desktopTopologyIdCreate(), validated);
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
        if (!topology || topology.mode !== "local" || this.closed) return Promise.resolve();
        const task = this.serial(async () => {
            if (this.closed || this.activeTopology?.id !== topology.id) return;
            await this.startValidated(topology, false);
        });
        const tracked = task.finally(() => {
            if (this.reconnectTask === tracked) this.reconnectTask = undefined;
        });
        this.reconnectTask = tracked;
        return tracked;
    }

    reset(): Promise<void> {
        return this.serial(async () => {
            if (this.localOnly) {
                const topology =
                    this.activeTopology?.mode === "local"
                        ? this.activeTopology
                        : { id: desktopTopologyIdCreate(), mode: "local" as const };
                await this.startValidated(topology, this.persistOnSuccess);
                return;
            }
            this.activationGeneration += 1;
            this.activeTopology = undefined;
            this.persistOnSuccess = false;
            this.localDispose();
            this.publish({
                phase: "choosing",
                targets: this.targets(),
                update: this.snapshotValue.update,
            });
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
            if (this.localOnly && topology.mode !== "local")
                throw new Error("This Happy build supports local mode only.");
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
            message:
                topology.mode === "local"
                    ? "Connecting to your local Rig daemon…"
                    : "Connecting to your cloud Happy workspace…",
            request,
            targets: this.targets(),
            update: this.snapshotValue.update,
        });
        try {
            let rigVersion: string | undefined;
            let rigHttpUrl: string | undefined;
            if (topology.mode === "local") {
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
                rigVersion = connection.version;
                rigHttpUrl = proxy.url;
            }
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
            if (topology.mode === "local" && error instanceof RigCommandMissingError) {
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
        const configured = (this.settings?.topologies ?? []).filter(
            (topology) => !this.localOnly || topology.mode === "local",
        );
        const active =
            this.localOnly &&
            this.activeTopology?.mode === "local" &&
            !configured.some(({ id }) => id === this.activeTopology?.id)
                ? [this.activeTopology]
                : [];
        return [...configured, ...active].map(desktopTopologyTarget);
    }
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export { rigDaemonConnectionUnavailable };
