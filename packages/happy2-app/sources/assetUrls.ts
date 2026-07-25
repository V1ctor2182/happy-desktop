import { useSyncExternalStore } from "react";
import {
    assetUrlKey,
    type AssetUrlEntry,
    type AssetUrlRequest,
    type HappyState,
} from "happy2-state";

export interface AvatarImages {
    /**
     * Object URL for a user's avatar `photoFileId`, or `undefined` until the file
     * has downloaded — and permanently for one that fails.
     */
    imageUrl(fileId?: string): string | undefined;
}

export interface PluginAssetMasks {
    /**
     * Object URL for an installation's authenticated monochrome PNG, meant to be
     * painted as a `currentColor` mask by `PluginAssetGlyph`.
     */
    maskUrl(installationId?: string, assetId?: string): string | undefined;
}

export interface PluginIcons {
    /** Object URL for a catalog package icon, keyed by catalog short name. */
    iconUrl(shortName?: string): string | undefined;
    /**
     * Object URL for a persisted system plugin icon, keyed by plugin ID. Serves
     * externally installed packages that have no catalog entry.
     */
    systemImageUrl(pluginId?: string): string | undefined;
}

/**
 * Reads the cache of authenticated binary assets and asks for anything a surface
 * paints but has not downloaded yet.
 *
 * The cache itself lives in `happy2-state` for the lifetime of the state, not in
 * this component: the same avatar or plugin icon appears on many surfaces, and
 * caching per component meant one blob per mounting surface for identical bytes
 * plus a revoke tied to whichever unmounted first. Here a surface only reads a
 * snapshot, so this hook owns no state, no effect, and no object URL.
 *
 * The request is issued from a microtask rather than during render because
 * reading a URL happens while rendering a row, and a store write in that phase
 * would mutate state React is mid-render over.
 */
export function useAssetUrls(state: HappyState | undefined) {
    const store = state?.assetUrls();
    const entries = useSyncExternalStore(
        store ? store.subscribe : noopSubscribe,
        store ? () => store.getState().entries : emptyEntriesGet,
        store ? () => store.getState().entries : emptyEntriesGet,
    );
    function resolve(request: AssetUrlRequest): string | undefined {
        const model = state;
        if (!model) return undefined;
        const entry = entries.get(assetUrlKey(request));
        if (!entry) queueMicrotask(() => model.assetUrlRequest(request));
        return entry?.type === "ready" ? entry.url : undefined;
    }
    return {
        imageUrl(fileId?: string) {
            return fileId ? resolve({ kind: "avatar", fileId }) : undefined;
        },
        maskUrl(installationId?: string, assetId?: string) {
            return installationId && assetId
                ? resolve({ kind: "pluginUiAsset", installationId, assetId })
                : undefined;
        },
        iconUrl(shortName?: string) {
            return shortName ? resolve({ kind: "pluginCatalogIcon", shortName }) : undefined;
        },
        systemImageUrl(pluginId?: string) {
            return pluginId ? resolve({ kind: "pluginSystemIcon", pluginId }) : undefined;
        },
    };
}

/** Before a session exists there is nothing to subscribe to and nothing to paint. */
const emptyEntries: ReadonlyMap<string, AssetUrlEntry> = new Map();
const emptyEntriesGet = () => emptyEntries;
const noopSubscribe = () => () => undefined;
