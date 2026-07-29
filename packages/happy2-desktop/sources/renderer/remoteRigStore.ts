import { rigProjectGroupsProject, type RigGlobalEvent, type RigProjectGroup } from "happy2-state";
import type { HappyDesktopBridge, RemoteRigSnapshot } from "../shared/desktopContract";
import { rigRendererTransportCreate } from "./rigRendererTransport";

export interface RemoteRigCatalog {
    readonly destination: string;
    readonly id: string;
    readonly message?: string;
    readonly projects: readonly RigProjectGroup[];
    readonly status: RemoteRigSnapshot["status"];
    readonly version?: string;
}

export interface RemoteRigStoreSnapshot {
    readonly addOpen: boolean;
    readonly destination: string;
    readonly error?: string;
    readonly rigs: readonly RemoteRigCatalog[];
}

export interface RemoteRigStore {
    get(): RemoteRigStoreSnapshot;
    subscribe(listener: () => void): () => void;
    addOpen(): void;
    addClose(): void;
    destinationUpdate(value: string): void;
    addSubmit(): void;
    retry(id: string): void;
    remove(id: string): void;
}

interface MaterializedRemoteRig {
    catalog: RemoteRigCatalog;
    close?: () => void;
    generation: number;
    url?: string;
}

/** Owns additional Rig catalog projections and their bridge-managed SSH lifetimes. */
export function remoteRigStoreCreate(bridge: HappyDesktopBridge): RemoteRigStore {
    const rigs = new Map<string, MaterializedRemoteRig>();
    const listeners = new Set<() => void>();
    let bridgeUnsubscribe: (() => void) | undefined;
    let snapshot: RemoteRigStoreSnapshot = { addOpen: false, destination: "", rigs: [] };
    const notify = () => {
        snapshot = {
            ...snapshot,
            rigs: [...rigs.values()].map(({ catalog }) => catalog),
        };
        for (const listener of listeners) listener();
    };
    const catalogLoad = (rig: MaterializedRemoteRig, source: RemoteRigSnapshot): void => {
        if (!source.rigHttpUrl || source.status !== "connected") return;
        if (rig.url === source.rigHttpUrl && rig.close) return;
        rig.close?.();
        rig.url = source.rigHttpUrl;
        const generation = ++rig.generation;
        const transport = rigRendererTransportCreate(source.rigHttpUrl);
        const load = () => {
            void Promise.all([transport.projectsRead(), transport.sessionsRead()]).then(
                ([catalog, sessions]) => {
                    if (generation !== rig.generation) return;
                    rig.catalog = {
                        ...rig.catalog,
                        projects: rigProjectGroupsProject(catalog, sessions),
                    };
                    notify();
                },
                (error) => {
                    if (generation !== rig.generation) return;
                    rig.catalog = {
                        ...rig.catalog,
                        message: error instanceof Error ? error.message : String(error),
                        status: "disconnected",
                    };
                    notify();
                },
            );
        };
        const events = transport.globalEventsSubscribe({
            event: (_event: RigGlobalEvent) => load(),
            error: () => undefined,
            end: () => undefined,
        });
        rig.close = () => events();
        load();
    };
    const reconcile = (sources: readonly RemoteRigSnapshot[]) => {
        const present = new Set(sources.map(({ id }) => id));
        for (const [id, rig] of rigs)
            if (!present.has(id)) {
                rig.generation += 1;
                rig.close?.();
                rigs.delete(id);
            }
        for (const source of sources) {
            let rig = rigs.get(source.id);
            if (!rig) {
                rig = {
                    catalog: {
                        destination: source.destination,
                        id: source.id,
                        projects: [],
                        status: source.status,
                        ...(source.message ? { message: source.message } : {}),
                        ...(source.version ? { version: source.version } : {}),
                    },
                    generation: 0,
                };
                rigs.set(source.id, rig);
            } else
                rig.catalog = {
                    ...rig.catalog,
                    destination: source.destination,
                    status: source.status,
                    ...(source.message ? { message: source.message } : { message: undefined }),
                    ...(source.version ? { version: source.version } : { version: undefined }),
                };
            catalogLoad(rig, source);
        }
        notify();
    };
    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                bridgeUnsubscribe = bridge.remoteRigSubscribe(reconcile);
                void bridge.remoteRigGet().then(reconcile);
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                bridgeUnsubscribe?.();
                bridgeUnsubscribe = undefined;
                for (const rig of rigs.values()) {
                    rig.generation += 1;
                    rig.close?.();
                }
                rigs.clear();
            };
        },
        addOpen() {
            snapshot = { ...snapshot, addOpen: true, error: undefined };
            notify();
        },
        addClose() {
            snapshot = { ...snapshot, addOpen: false, destination: "", error: undefined };
            notify();
        },
        destinationUpdate(destination) {
            snapshot = { ...snapshot, destination, error: undefined };
            notify();
        },
        addSubmit() {
            const destination = snapshot.destination;
            void bridge.remoteRigAdd(destination).then(
                () => {
                    snapshot = { ...snapshot, addOpen: false, destination: "", error: undefined };
                    notify();
                },
                (error) => {
                    snapshot = {
                        ...snapshot,
                        error: error instanceof Error ? error.message : String(error),
                    };
                    notify();
                },
            );
        },
        retry: (id) => void bridge.remoteRigRetry(id).catch(() => undefined),
        remove: (id) => void bridge.remoteRigRemove(id).catch(() => undefined),
    };
}
