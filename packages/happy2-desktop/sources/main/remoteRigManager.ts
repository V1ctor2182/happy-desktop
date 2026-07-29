import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RemoteRigSnapshot } from "../shared/desktopContract";
import { rigHttpProxyCreate, type RigHttpProxyHandle } from "./rigHttpProxy";
import {
    remoteRigConnectorCreate,
    sshDestinationValidate,
    type RemoteRigConnector,
} from "./remoteRig";
import type { LocalRigConnection } from "./localRig";

interface SavedRemoteRig {
    readonly destination: string;
    readonly id: string;
}

interface LiveRemoteRig {
    connection?: LocalRigConnection;
    generation: number;
    proxy?: RigHttpProxyHandle;
    snapshot: RemoteRigSnapshot;
}

/**
 * Owns the saved set of additional Rig daemons and their SSH/proxy lifetimes.
 * A failed Rig remains listed and retryable; no token or socket path leaves main.
 */
export class RemoteRigManager implements AsyncDisposable {
    private closed = false;
    private readonly listeners = new Set<(rigs: readonly RemoteRigSnapshot[]) => void>();
    private readonly rigs = new Map<string, LiveRemoteRig>();

    private constructor(
        private readonly path: string,
        private readonly connector: RemoteRigConnector,
        private readonly rendererOrigin?: string,
    ) {}

    static async create(
        path: string,
        options: { readonly connector?: RemoteRigConnector; readonly rendererOrigin?: string } = {},
    ): Promise<RemoteRigManager> {
        const manager = new RemoteRigManager(
            path,
            options.connector ?? remoteRigConnectorCreate(dirname(path)),
            options.rendererOrigin,
        );
        for (const saved of await savedRead(path))
            manager.rigs.set(saved.id, {
                generation: 0,
                snapshot: {
                    destination: saved.destination,
                    id: saved.id,
                    status: "connecting",
                },
            });
        for (const id of manager.rigs.keys()) void manager.connect(id);
        return manager;
    }

    get(): readonly RemoteRigSnapshot[] {
        return [...this.rigs.values()].map(({ snapshot }) => snapshot);
    }

    subscribe(listener: (rigs: readonly RemoteRigSnapshot[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async add(destinationValue: string): Promise<void> {
        const destination = sshDestinationValidate(destinationValue);
        if ([...this.rigs.values()].some(({ snapshot }) => snapshot.destination === destination))
            throw new Error("That remote Rig is already connected.");
        const id = `rig_${randomBytes(16).toString("hex")}`;
        this.rigs.set(id, {
            generation: 0,
            snapshot: { destination, id, status: "connecting" },
        });
        await this.persist();
        this.publish();
        void this.connect(id);
    }

    async remove(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig) throw new Error("The remote Rig does not exist.");
        rig.generation += 1;
        rig.proxy?.close();
        rig.connection?.close();
        this.rigs.delete(id);
        await this.persist();
        this.publish();
    }

    retry(id: string): void {
        if (!this.rigs.has(id)) throw new Error("The remote Rig does not exist.");
        void this.connect(id);
    }

    async [Symbol.asyncDispose](): Promise<void> {
        this.closed = true;
        for (const rig of this.rigs.values()) {
            rig.generation += 1;
            rig.proxy?.close();
            rig.connection?.close();
        }
        this.listeners.clear();
    }

    private async connect(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig || this.closed) return;
        const generation = ++rig.generation;
        rig.proxy?.close();
        rig.connection?.close();
        rig.proxy = undefined;
        rig.connection = undefined;
        rig.snapshot = { destination: rig.snapshot.destination, id, status: "connecting" };
        this.publish();
        try {
            const connection = await this.connector.connect(rig.snapshot.destination);
            if (this.closed || generation !== rig.generation) {
                connection.close();
                return;
            }
            const proxy = await rigHttpProxyCreate({
                client: connection.client,
                ...(this.rendererOrigin ? { allowedOrigin: this.rendererOrigin } : {}),
                onConnectionError: () => {
                    if (generation !== rig.generation) return;
                    void this.connect(id);
                },
            });
            if (this.closed || generation !== rig.generation) {
                proxy.close();
                connection.close();
                return;
            }
            rig.connection = connection;
            rig.proxy = proxy;
            rig.snapshot = {
                destination: rig.snapshot.destination,
                id,
                rigHttpUrl: proxy.url,
                status: "connected",
                version: connection.version,
            };
        } catch (error) {
            if (generation !== rig.generation) return;
            rig.snapshot = {
                destination: rig.snapshot.destination,
                id,
                message: error instanceof Error ? error.message : String(error),
                status: "disconnected",
            };
        }
        this.publish();
    }

    private persist(): Promise<void> {
        return savedWrite(
            this.path,
            this.get().map(({ destination, id }) => ({ destination, id })),
        );
    }

    private publish(): void {
        const snapshot = this.get();
        for (const listener of this.listeners) listener(snapshot);
    }
}

async function savedRead(path: string): Promise<readonly SavedRemoteRig[]> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (value): value is SavedRemoteRig =>
                !!value &&
                typeof value === "object" &&
                typeof (value as SavedRemoteRig).id === "string" &&
                typeof (value as SavedRemoteRig).destination === "string",
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
            return [];
        throw error;
    }
}

async function savedWrite(path: string, rigs: readonly SavedRemoteRig[]): Promise<void> {
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(rigs, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}
