import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";

/** Where a plugin application's own code is, as the host reports it. */
export type RigPluginApplicationStatus = "loading" | "ready" | "error";

/** Where the host's catalog feed is, so an empty list can say why it is empty. */
export type RigPluginCatalogConnection = "connecting" | "live" | "reconnecting" | "closed";

/**
 * One application a locally installed plugin contributes.
 *
 * `id` is the durable navigation identity and `generation` is the exact code
 * behind it. They are separate because a plugin that restarts keeps its place in
 * the window while its code is replaced wholesale: navigation follows the id, and
 * everything loaded follows the pair.
 *
 * `source` is the address of an isolated origin the host has already filled with
 * this generation's bundle. It appears only once the whole bundle is cached, so
 * opening the application reads nothing.
 */
export interface RigPluginApplication {
    readonly id: string;
    readonly generation: string;
    readonly pluginId: string;
    /** Full name of the application, for its own surface heading. */
    readonly title: string;
    /** Short name for the navigation row. */
    readonly label: string;
    readonly order: number;
    readonly status: RigPluginApplicationStatus;
    /** Why this application's code could not be prepared, when it could not. */
    readonly error?: string;
    readonly source?: string;
}

/** Whether a package's own code is up, deliberately stopped, or failed to start. */
export type RigPluginPackageStatus = "running" | "stopped" | "failed";

/**
 * One plugin package installed on the machine, as the host reports it.
 *
 * A package is a different reading from the applications it contributes: it
 * exists whether or not it contributes any, and a package that stopped
 * contributes nothing while remaining entirely installed. `directory` and
 * `dataDirectory` are paths on the machine running the plugin — they are here to
 * be shown to a reader, and nothing above may treat them as addresses.
 */
export interface RigPluginPackage {
    /** The package's folder name, which is the machine's identity for it. */
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly status: RigPluginPackageStatus;
    /** The package's own words about the state it is in, when it offered any. */
    readonly statusMessage?: string;
    readonly error?: string;
    readonly directory: string;
    readonly dataDirectory: string;
    readonly logAvailable: boolean;
    /** The applications it contributes, by the identity navigation uses. */
    readonly applicationIds: readonly string[];
}

/**
 * A folder the machine found where a package should be and could not read as
 * one. It does not become a package until the reason is fixed, so it is carried
 * beside the catalog rather than inside it.
 */
export interface RigPluginPackageFailure {
    readonly folder: string;
    readonly error: string;
}

/**
 * One reading of this machine's plugins: the packages installed on it, the
 * folders it could not read, the applications those packages contribute, and how
 * the feed itself is doing. `loading` is true only before the first catalog
 * arrives, so a window never claims a machine has nothing before it has asked.
 */
export interface RigPluginApplicationSourceReading {
    readonly applications: readonly RigPluginApplication[];
    readonly packages: readonly RigPluginPackage[];
    readonly packageFailures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
}

/**
 * The local plugin catalog for one Rig. Subscribing starts following it and
 * releasing the last subscriber stops, so a window looking at something else
 * holds nothing open on the host's behalf.
 */
export interface RigPluginApplicationSource {
    subscribe(
        listener: (reading: RigPluginApplicationSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigPluginApplicationsSnapshot {
    readonly applications: readonly RigPluginApplication[];
    readonly packages: readonly RigPluginPackage[];
    readonly packageFailures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
    /** Set when the feed itself failed; what is already held stays visible. */
    readonly error?: UserError;
}

export interface RigPluginApplicationStore {
    get(): RigPluginApplicationsSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigPluginApplicationStoreDeps {
    readonly source: RigPluginApplicationSource;
}

const EMPTY: RigPluginApplicationsSnapshot = {
    applications: [],
    packages: [],
    packageFailures: [],
    connection: "connecting",
    loading: true,
};

/**
 * Every local plugin application this Rig offers, as one surface.
 *
 * The store owns no loading of its own. Preparing a plugin's code — reading its
 * bundle, keeping it, and deciding when it may be opened — belongs to the host
 * that can do it safely; this store holds the result so navigation and the
 * application's own surface read one list rather than two. Nothing here is
 * editable, so the store has no actions and emits no output.
 */
export function rigPluginApplicationStoreCreate(
    deps: RigPluginApplicationStoreDeps,
): RigPluginApplicationStore {
    const store = createStore<RigPluginApplicationsSnapshot>()(() => EMPTY);
    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                store.setState(
                    {
                        applications: reading.applications,
                        packages: reading.packages,
                        packageFailures: reading.packageFailures,
                        connection: reading.connection,
                        loading: reading.loading,
                    },
                    true,
                );
            },
            (error) => {
                if (disposed) return;
                store.setState({ error: rigUserError(error), loading: false }, false);
            },
        );
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigPluginApplicationsSnapshot = {
    applications: [],
    packages: [],
    packageFailures: [],
    connection: "closed",
    loading: false,
};

/**
 * The catalog for a Rig whose host cannot mount plugin applications at all — a
 * browser window rather than the desktop shell. It is settled and empty rather
 * than loading, so a surface that subscribes unconditionally reads "none here"
 * instead of waiting for a list that is not coming.
 */
export const rigPluginApplicationStoreNoop: RigPluginApplicationStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};
