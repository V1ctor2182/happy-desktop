import { describe, expect, it, vi } from "vitest";
import { assetUrlKey, assetUrlsStoreCreate } from "./assetUrlsState.js";

describe("asset URL module", () => {
    it("gives each asset a distinct key and repeats the key for the same asset", () => {
        expect(assetUrlKey({ kind: "avatar", fileId: "f1" })).toBe(
            assetUrlKey({ kind: "avatar", fileId: "f1" }),
        );
        const keys = new Set([
            assetUrlKey({ kind: "avatar", fileId: "f1" }),
            assetUrlKey({ kind: "avatar", fileId: "f2" }),
            assetUrlKey({ kind: "pluginCatalogIcon", shortName: "f1" }),
            assetUrlKey({ kind: "pluginSystemIcon", pluginId: "f1" }),
            assetUrlKey({ kind: "pluginUiAsset", installationId: "i1", assetId: "a1" }),
        ]);
        expect(keys.size).toBe(5);
    });

    it("does not confuse two composite assets whose parts concatenate alike", () => {
        expect(assetUrlKey({ kind: "pluginUiAsset", installationId: "a", assetId: "bc" })).not.toBe(
            assetUrlKey({ kind: "pluginUiAsset", installationId: "ab", assetId: "c" }),
        );
    });

    it("records loading, then the resolved URL", () => {
        const store = assetUrlsStoreCreate();
        const key = assetUrlKey({ kind: "avatar", fileId: "f1" });
        store.getState().assetUrlInput({ key, type: "assetUrlLoading" });
        expect(store.getState().entries.get(key)).toEqual({ type: "loading" });
        store.getState().assetUrlInput({ key, type: "assetUrlLoaded", url: "blob:one" });
        expect(store.getState().entries.get(key)).toEqual({ type: "ready", url: "blob:one" });
    });

    it("remembers a failure so a missing asset is not retried on every render", () => {
        const store = assetUrlsStoreCreate();
        const key = assetUrlKey({ kind: "pluginCatalogIcon", shortName: "todos" });
        store.getState().assetUrlInput({ key, type: "assetUrlFailed" });
        expect(store.getState().entries.get(key)).toEqual({ type: "failed" });
        // A recorded entry is what suppresses a repeat request, so it must persist.
        expect(store.getState().entries.has(key)).toBe(true);
    });

    it("revokes every object URL it created when disposed", () => {
        const revoke = vi.fn();
        vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke });
        const store = assetUrlsStoreCreate();
        store.getState().assetUrlInput({ key: "a", type: "assetUrlLoaded", url: "blob:one" });
        store.getState().assetUrlInput({ key: "b", type: "assetUrlLoaded", url: "blob:two" });
        store.getState().assetUrlInput({ key: "c", type: "assetUrlFailed" });

        store.getState().assetUrlsDispose();
        expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:one", "blob:two"]);
        expect(store.getState().entries.size).toBe(0);
        vi.unstubAllGlobals();
    });

    it("keeps unrelated entries untouched when one asset resolves", () => {
        const store = assetUrlsStoreCreate();
        store.getState().assetUrlInput({ key: "a", type: "assetUrlLoaded", url: "blob:one" });
        const before = store.getState().entries.get("a");
        store.getState().assetUrlInput({ key: "b", type: "assetUrlLoaded", url: "blob:two" });
        expect(store.getState().entries.get("a")).toBe(before);
    });
});
