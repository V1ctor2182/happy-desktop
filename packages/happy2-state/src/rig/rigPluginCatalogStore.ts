import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";
import type { RigPluginCatalogConnection } from "./rigPluginApplicationStore.js";

/** Whether a package's own code is up, deliberately stopped, or failed to start. */
export type RigPluginPackageStatus = "running" | "stopped" | "failed";

/**
 * One plugin package installed on this machine.
 *
 * A package is a different reading from the applications it contributes: it
 * exists whether or not it contributes any, and a package that stopped
 * contributes nothing while remaining entirely installed. It carries the labels
 * of its own applications rather than their identities, so nothing above has to
 * join two feeds to draw one card.
 *
 * `directory` and `dataDirectory` are paths on the machine running the plugin.
 * They are here to be shown to a reader; nothing above may treat them as
 * addresses.
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
    /** What it adds to Happy, by the labels a reader will meet it under. */
    readonly contributions: readonly string[];
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
 * One reading of this machine's installed plugins, with how the feed itself is
 * doing. `loading` is true only before the first reading arrives, so a screen
 * never claims a machine has nothing before it has asked.
 */
export interface RigPluginCatalogSourceReading {
    readonly packages: readonly RigPluginPackage[];
    readonly failures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
    /** The feed's own last failure, when the host reported one in words. */
    readonly error?: string;
}

/**
 * This machine's plugin inventory. Subscribing starts following it and releasing
 * the last subscriber stops, so the catalog is read only while a screen is
 * actually showing it.
 */
export interface RigPluginCatalogSource {
    subscribe(
        listener: (reading: RigPluginCatalogSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigPluginCatalogSnapshot {
    readonly packages: readonly RigPluginPackage[];
    readonly failures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
    /** Set when the feed failed; the packages already read stay exactly as they are. */
    readonly error?: UserError;
}

export interface RigPluginCatalogStore {
    get(): RigPluginCatalogSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigPluginCatalogStoreDeps {
    readonly source: RigPluginCatalogSource;
}

const EMPTY: RigPluginCatalogSnapshot = {
    packages: [],
    failures: [],
    connection: "connecting",
    loading: true,
};

/**
 * The plugin packages installed on this machine, as one surface.
 *
 * It is deliberately separate from the application store. The applications a
 * plugin contributes are pinned navigation, followed for as long as a window is
 * open; what is installed is one screen's subject and is followed only while
 * that screen is up. Keeping them apart is what lets this one be started and
 * stopped with the screen instead of running for the lifetime of the window.
 *
 * A failure never empties the store. Whatever was last read stays readable and
 * the error is carried beside it, because a subscription dropping does not
 * uninstall anything; the surface says the reading is old rather than pretending
 * the machine was emptied.
 */
export function rigPluginCatalogStoreCreate(
    deps: RigPluginCatalogStoreDeps,
): RigPluginCatalogStore {
    const store = createStore<RigPluginCatalogSnapshot>()(() => EMPTY);
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
                        packages: reading.packages,
                        failures: reading.failures,
                        connection: reading.connection,
                        loading: reading.loading,
                        // The host's own words when it has any, so a reading that
                        // went stale says why in the same terms the host used.
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(new Error(reading.error)) }),
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

const INERT_SNAPSHOT: RigPluginCatalogSnapshot = {
    packages: [],
    failures: [],
    connection: "closed",
    loading: false,
};

/**
 * The inventory for a Rig whose host cannot read the machine's plugins at all —
 * a browser window rather than the desktop shell. It is settled and empty rather
 * than loading, so a screen that subscribes unconditionally reads "none here"
 * instead of waiting for a list that is not coming.
 */
export const rigPluginCatalogStoreNoop: RigPluginCatalogStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};
