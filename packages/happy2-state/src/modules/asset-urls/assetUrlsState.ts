import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * One authenticated binary asset the UI paints by URL. Every variant names the
 * durable identifiers its download needs, so a caller never assembles a cache
 * key or a URL itself.
 */
export type AssetUrlRequest =
    | { readonly kind: "avatar"; readonly fileId: string }
    | {
          readonly kind: "pluginUiAsset";
          readonly installationId: string;
          readonly assetId: string;
      }
    | { readonly kind: "pluginCatalogIcon"; readonly shortName: string }
    | { readonly kind: "pluginSystemIcon"; readonly pluginId: string };

/**
 * A resolved asset. `failed` is terminal and deliberately remembered: a missing
 * avatar or icon must not be retried on every render of every list that shows it.
 */
export type AssetUrlEntry =
    | { readonly type: "loading" }
    | { readonly type: "ready"; readonly url: string }
    | { readonly type: "failed" };

export interface AssetUrlsSnapshot {
    readonly entries: ReadonlyMap<string, AssetUrlEntry>;
}

export interface AssetUrlsState extends AssetUrlsSnapshot {
    assetUrlInput(event: AssetUrlInput): void;
    /** Revokes every object URL this store created. Called when state is disposed. */
    assetUrlsDispose(): void;
}

export type AssetUrlInput =
    | { readonly key: string; readonly type: "assetUrlLoading" }
    | { readonly key: string; readonly type: "assetUrlLoaded"; readonly url: string }
    | { readonly key: string; readonly type: "assetUrlFailed" };

export type AssetUrlsStore = StoreApi<AssetUrlsState>;

/**
 * The stable cache key for one request. It is derived here rather than passed in
 * so no caller can invent a colliding key; the NUL separator cannot occur in an
 * id, which keeps composite keys unambiguous.
 */
export function assetUrlKey(request: AssetUrlRequest): string {
    switch (request.kind) {
        case "avatar":
            return `avatar\u0000${request.fileId}`;
        case "pluginUiAsset":
            return `pluginUiAsset\u0000${request.installationId}\u0000${request.assetId}`;
        case "pluginCatalogIcon":
            return `pluginCatalogIcon\u0000${request.shortName}`;
        case "pluginSystemIcon":
            return `pluginSystemIcon\u0000${request.pluginId}`;
    }
}

/**
 * Creates the process-wide cache of object URLs for authenticated binary assets:
 * user avatars, plugin UI assets, and plugin icons.
 *
 * This exists because the same avatar or icon appears on many independent
 * surfaces, and each download needs the authenticated transport. Caching per
 * React component previously meant three near-identical hooks, one blob per
 * mounting surface for the same bytes, and a revoke tied to whichever component
 * happened to unmount first. Owning it here means one download per asset for the
 * lifetime of the state, and one revoke when that state is disposed.
 *
 * The store only records results. Downloading is an action on `HappyState`,
 * which owns the transport, so this store opens no resources of its own.
 */
export function assetUrlsStoreCreate(): AssetUrlsStore {
    return createStore<AssetUrlsState>()((set, get) => ({
        entries: new Map(),
        assetUrlInput(event): void {
            set((snapshot) => {
                const entries = new Map(snapshot.entries);
                if (event.type === "assetUrlLoading") entries.set(event.key, { type: "loading" });
                else if (event.type === "assetUrlLoaded")
                    entries.set(event.key, { type: "ready", url: event.url });
                else entries.set(event.key, { type: "failed" });
                return { ...snapshot, entries };
            });
        },
        assetUrlsDispose(): void {
            for (const entry of get().entries.values())
                if (entry.type === "ready") URL.revokeObjectURL(entry.url);
            set((snapshot) => ({ ...snapshot, entries: new Map() }));
        },
    }));
}
