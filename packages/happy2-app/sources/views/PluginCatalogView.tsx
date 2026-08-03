import { useMemo, useSyncExternalStore } from "react";
import type { RigPluginCatalogStore } from "happy2-state";
import { RigPluginCatalogPage } from "happy2-ui";
import { pluginCatalogProjectionCreate } from "../pluginCatalog";

export interface PluginCatalogViewProps {
    readonly store: RigPluginCatalogStore;
}

/**
 * The Plugins screen: this machine's packages, read only while it is open.
 *
 * The subscription lives here rather than beside the window's other stores
 * because the catalog is this screen's subject and nothing else's. Mounting the
 * screen is what starts the machine being read and unmounting it is what stops
 * it, so a window doing something else holds nothing open on the host's behalf —
 * unlike the application catalog, which is pinned navigation and is followed the
 * whole time the window is up.
 *
 * The projection is memoized against the store rather than left to render
 * memoization because it is stateful: it holds the previous reading's cards so an
 * unchanged package keeps the same `entry`, `contributions`, and `facts` objects
 * across an announcement about a different package. Its lifetime is exactly the
 * store's; a new store is a new machine's reading and starts with nothing held.
 * Losing the memo costs one catalog's worth of new objects and nothing else, so
 * this is an identity contract rather than a correctness one.
 */
export function PluginCatalogView(props: PluginCatalogViewProps) {
    const snapshot = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
    const project = useMemo(() => pluginCatalogProjectionCreate(props.store), [props.store]);
    return (
        <RigPluginCatalogPage
            connection={snapshot.connection}
            entries={project(snapshot)}
            failures={snapshot.failures}
            loading={snapshot.loading}
            {...(snapshot.error ? { error: snapshot.error.message } : {})}
        />
    );
}
