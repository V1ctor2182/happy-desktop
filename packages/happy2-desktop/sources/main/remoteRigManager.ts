import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RemoteRigAddRequest, RemoteRigSnapshot } from "../shared/desktopContract";
import { rigHttpProxyCreate, type RigHttpProxyHandle } from "./rigHttpProxy";
import {
    remoteRigConnectorCreate,
    remoteRigLabelDerive,
    remoteRigTokenValidate,
    remoteRigUrlValidate,
    type RemoteRigConnection,
    type RemoteRigConnector,
} from "./remoteRig";

/**
 * A remote Rig as it is remembered between runs. `connected` is the reader's
 * intent rather than an observation: a machine left connected is reached again at
 * the next start, and one the reader disconnected from stays quiet until they ask
 * for it. The token lives here because the endpoint is worthless without it; the
 * file is written 0600 and never leaves the main process.
 */
interface SavedRemoteRig {
    readonly connected: boolean;
    readonly endpoint: string;
    readonly id: string;
    readonly label: string;
    readonly token: string;
}

interface LiveRemoteRig {
    connection?: RemoteRigConnection;
    generation: number;
    proxy?: RigHttpProxyHandle;
    saved: SavedRemoteRig;
    snapshot: RemoteRigSnapshot;
}

/**
 * Owns the remembered set of remote Rigs, their connection lifetimes, and the
 * loopback proxy each connected one is reached through. Connecting and
 * disconnecting are deliberate acts by the reader, so a rig that fails stays
 * listed with its message and can be connected again; a rig the reader
 * disconnected is not retried behind their back. No token or endpoint credential
 * leaves this process: the renderer only ever learns the loopback proxy URL.
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
            options.connector ?? remoteRigConnectorCreate(),
            options.rendererOrigin,
        );
        for (const saved of await savedRead(path))
            manager.rigs.set(saved.id, {
                generation: 0,
                saved,
                snapshot: snapshotIdle(saved),
            });
        for (const rig of manager.rigs.values())
            if (rig.saved.connected) void manager.open(rig.saved.id);
        return manager;
    }

    get(): readonly RemoteRigSnapshot[] {
        return [...this.rigs.values()].map(({ snapshot }) => snapshot);
    }

    subscribe(listener: (rigs: readonly RemoteRigSnapshot[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Remembers a machine and connects to it straight away, as adding it implies. */
    async add(request: RemoteRigAddRequest): Promise<void> {
        const endpoint = remoteRigUrlValidate(request.endpoint);
        const token = remoteRigTokenValidate(request.token);
        if ([...this.rigs.values()].some(({ saved }) => saved.endpoint === endpoint))
            throw new Error("That Rig endpoint is already in this workspace.");
        const saved: SavedRemoteRig = {
            connected: true,
            endpoint,
            id: `rig_${randomBytes(16).toString("hex")}`,
            label: request.label?.trim() || remoteRigLabelDerive(endpoint),
            token,
        };
        this.rigs.set(saved.id, { generation: 0, saved, snapshot: snapshotIdle(saved) });
        await this.persist();
        this.publish();
        void this.open(saved.id);
    }

    async remove(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig) throw new Error("The remote Rig does not exist.");
        this.release(rig);
        this.rigs.delete(id);
        await this.persist();
        this.publish();
    }

    /** Connects on the reader's request, and remembers that this is how they left it. */
    async connect(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig) throw new Error("The remote Rig does not exist.");
        rig.saved = { ...rig.saved, connected: true };
        await this.persist();
        await this.open(id);
    }

    /** Drops the connection and stops reaching for the machine until asked again. */
    async disconnect(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig) throw new Error("The remote Rig does not exist.");
        rig.saved = { ...rig.saved, connected: false };
        this.release(rig);
        rig.snapshot = snapshotIdle(rig.saved);
        await this.persist();
        this.publish();
    }

    /**
     * Opens the daemon-side HTTP proxy for a session on whichever connected
     * machine actually owns it. A session id names one Rig, but the window's
     * browser only knows the session, so ownership is discovered by asking each
     * connected machine rather than guessed from what is on screen.
     */
    async openHttpProxy(sessionId: string): Promise<Duplex> {
        for (const rig of this.rigs.values()) {
            if (!rig.connection) continue;
            try {
                return await rig.connection.client.openHttpProxy(sessionId);
            } catch {
                // Another connected machine may own this session.
            }
        }
        throw new Error("No connected Rig owns that session.");
    }

    async [Symbol.asyncDispose](): Promise<void> {
        this.closed = true;
        for (const rig of this.rigs.values()) this.release(rig);
        this.listeners.clear();
    }

    private release(rig: LiveRemoteRig): void {
        rig.generation += 1;
        rig.proxy?.close();
        rig.connection?.close();
        rig.proxy = undefined;
        rig.connection = undefined;
    }

    private async open(id: string): Promise<void> {
        const rig = this.rigs.get(id);
        if (!rig || this.closed) return;
        this.release(rig);
        const generation = rig.generation;
        rig.snapshot = { ...snapshotIdle(rig.saved), status: "connecting" };
        this.publish();
        try {
            const connection = await this.connector.connect({
                token: rig.saved.token,
                url: rig.saved.endpoint,
            });
            if (this.closed || generation !== rig.generation) {
                connection.close();
                return;
            }
            const proxy = await rigHttpProxyCreate({
                client: connection.client,
                ...(this.rendererOrigin ? { allowedOrigin: this.rendererOrigin } : {}),
                // The renderer's own connection loader reconnects the surfaces; the
                // proxy only has to notice that this machine went away and reopen
                // the daemon connection behind it.
                onConnectionError: () => {
                    if (generation !== rig.generation || !rig.saved.connected) return;
                    void this.open(id);
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
                ...snapshotIdle(rig.saved),
                rigHttpUrl: proxy.url,
                status: "connected",
                version: connection.version,
            };
        } catch (error) {
            if (generation !== rig.generation) return;
            rig.snapshot = {
                ...snapshotIdle(rig.saved),
                message: error instanceof Error ? error.message : String(error),
                status: "error",
            };
        }
        this.publish();
    }

    private persist(): Promise<void> {
        return savedWrite(
            this.path,
            [...this.rigs.values()].map(({ saved }) => saved),
        );
    }

    private publish(): void {
        const snapshot = this.get();
        for (const listener of this.listeners) listener(snapshot);
    }
}

function snapshotIdle(saved: SavedRemoteRig): RemoteRigSnapshot {
    return {
        connected: saved.connected,
        endpoint: saved.endpoint,
        id: saved.id,
        label: saved.label,
        status: "disconnected",
    };
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
                typeof (value as SavedRemoteRig).endpoint === "string" &&
                typeof (value as SavedRemoteRig).label === "string" &&
                typeof (value as SavedRemoteRig).token === "string" &&
                typeof (value as SavedRemoteRig).connected === "boolean",
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
