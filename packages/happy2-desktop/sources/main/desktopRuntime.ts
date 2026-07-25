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
import { rigDaemonConnectionUnavailable } from "./rigDaemonClient";
import { rigHttpProxyCreate, type RigHttpProxyHandle } from "./rigHttpProxy";
import { rigInstallCommand } from "./rigInstallTerminal";
import { rigSessionOrderCreate, type RigSessionOrder } from "./rigSessionOrder";

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
    private rigProxy?: RigHttpProxyHandle;
    private settings?: DesktopSettings;
    private snapshotValue: DesktopRuntimeSnapshot;
    private readonly connector: LocalRigConnector;
    private readonly proxyStart: RigHttpProxyStart;

    private constructor(
        private readonly paths: DesktopRuntimePaths,
        settings: DesktopSettings | undefined,
        order: RigSessionOrder,
        options: DesktopRuntimeOptions,
    ) {
        this.settings = settings;
        this.connector = options.localRigConnector ?? localRigConnectorCreate();
        this.proxyStart =
            options.rigHttpProxyStart ??
            ((connection, onConnectionError) =>
                rigHttpProxyCreate({
                    client: connection.client,
                    onConnectionError,
                    order,
                }));
        const active = settings?.topologies.find(({ id }) => id === settings.activeTopologyId);
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
        const order = await rigSessionOrderCreate(join(paths.root, "rig-session-order.json"));
        const runtime = new DesktopRuntime(paths, settings, order, options);
        if (runtime.activeTopology)
            void runtime
                .serial(() => runtime.startValidated(runtime.activeTopology!, false))
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

    start(request: DesktopStartRequest): Promise<void> {
        return this.serial(async () => {
            const validated = desktopStartRequestValidate(request);
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
        return (this.settings?.topologies ?? []).map(desktopTopologyTarget);
    }
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export { rigDaemonConnectionUnavailable };
