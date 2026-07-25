import { describe, expect, it, onTestFinished } from "vitest";
import { happyStateCreate, type PermissionsSnapshot } from "happy2-state";
import { appMemoryHistoryCreate, appRouterCreate } from "../../sources/navigation/appRouter";
import type { AppRouterContext } from "../../sources/navigation/appRouterContext";

/**
 * Resolves one URL through the real route tree and reports the leaf route and its
 * parameters. This is the router's own matching — there is no application-level URL
 * parser to test any more — so these cases pin the addresses the product promises.
 */
async function resolve(url: string, permissions?: PermissionsSnapshot) {
    const state = happyStateCreate();
    const router = appRouterCreate(appMemoryHistoryCreate(url));
    onTestFinished(() => {
        router.history.destroy();
        state[Symbol.dispose]();
    });
    const context: AppRouterContext = {
        appearance: "light",
        appearanceToggle: () => undefined,
        permissions: permissions ?? state.permissions().getState(),
        state,
        themeMode: "system",
    };
    router.update({ context });
    await router.load();
    const matches = router.state.matches;
    return {
        href: router.state.location.href,
        leaf: matches.at(-1)?.routeId ?? "",
        params: matches.at(-1)?.params ?? {},
        routeIds: matches.map((match) => match.routeId),
    };
}

function permissionsWith(allowed: readonly string[], owner = false): PermissionsSnapshot {
    return {
        permissions: {
            type: "ready",
            value: { allowed: allowed as never, owner },
        },
    } as unknown as PermissionsSnapshot;
}

describe("application URLs", () => {
    it.each([
        ["/chats", "/_workspace/chats/"],
        ["/chats/chat-1", "/_workspace/chats/$chatId"],
        ["/channels", "/_workspace/channels/"],
        ["/channels/product", "/_workspace/channels/$chatId"],
        ["/home", "/_workspace/home"],
        ["/activity", "/_workspace/activity"],
        ["/calls", "/_workspace/calls"],
        ["/files", "/_workspace/files"],
        ["/documents", "/_workspace/documents/"],
        ["/documents/doc-12", "/_workspace/documents/$documentId"],
        ["/apps", "/_workspace/apps/"],
        ["/apps/inst-1", "/_workspace/apps/$appId"],
        ["/settings/appearance", "/settings/$section"],
    ])("resolves %s to %s", async (url, leaf) => {
        await expect(resolve(url).then((result) => result.leaf)).resolves.toBe(leaf);
    });

    it("exposes the addressed entity as a typed path parameter", async () => {
        await expect(resolve("/chats/chat-1").then((r) => r.params)).resolves.toEqual({
            chatId: "chat-1",
        });
        await expect(resolve("/documents/doc-12").then((r) => r.params)).resolves.toEqual({
            documentId: "doc-12",
        });
        await expect(resolve("/apps/inst-1").then((r) => r.params)).resolves.toEqual({
            appId: "inst-1",
        });
    });

    it("keeps every workspace screen under the shared workspace layout", async () => {
        const home = await resolve("/home");
        expect(home.routeIds).toContain("/_workspace");
        const chat = await resolve("/chats/chat-1");
        expect(chat.routeIds).toContain("/_workspace");
    });

    it("keeps settings outside the workspace layout so it renders without the chat sidebar", async () => {
        const settings = await resolve("/settings/appearance");
        expect(settings.routeIds).not.toContain("/_workspace");
    });

    it("decodes a percent-encoded identifier rather than passing it through", async () => {
        await expect(resolve("/documents/a%2Fb").then((r) => r.params)).resolves.toEqual({
            documentId: "a/b",
        });
    });

    it("sends the root to the conversation list", async () => {
        const result = await resolve("/");
        expect(result.leaf).toBe("/_workspace/chats/");
        expect(result.href).toBe("/chats");
    });

    it("lands administration on the first section the session may open", async () => {
        const result = await resolve("/admin", permissionsWith(["managePlugins"]));
        expect(result.leaf).toBe("/_workspace/admin/$section");
        expect(result.params).toEqual({ section: "plugins" });
    });

    it("opens settings on the profile section when none is named", async () => {
        const result = await resolve("/settings");
        expect(result.params).toEqual({ section: "profile" });
    });

    it("defaults the files filter and query, and keeps a valid filter", async () => {
        const bare = await resolve("/files");
        expect(bare.routeIds).toContain("/_workspace/files");

        const router = appRouterCreate(appMemoryHistoryCreate("/files?filter=video&query=demo"));
        const state = happyStateCreate();
        onTestFinished(() => {
            router.history.destroy();
            state[Symbol.dispose]();
        });
        router.update({
            context: {
                appearance: "light",
                appearanceToggle: () => undefined,
                permissions: state.permissions().getState(),
                state,
                themeMode: "system",
            } satisfies AppRouterContext,
        });
        await router.load();
        const files = router.state.matches.at(-1);
        expect(files?.search).toEqual({ filter: "video", query: "demo" });
    });

    it("falls back to showing everything when the files filter is not one we render", async () => {
        const router = appRouterCreate(appMemoryHistoryCreate("/files?filter=nonsense"));
        const state = happyStateCreate();
        onTestFinished(() => {
            router.history.destroy();
            state[Symbol.dispose]();
        });
        router.update({
            context: {
                appearance: "light",
                appearanceToggle: () => undefined,
                permissions: state.permissions().getState(),
                state,
                themeMode: "system",
            } satisfies AppRouterContext,
        });
        await router.load();
        expect(router.state.matches.at(-1)?.search).toEqual({ filter: "all", query: "" });
    });
});
