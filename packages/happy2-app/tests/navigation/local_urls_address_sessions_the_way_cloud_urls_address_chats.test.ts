import { expect, it, onTestFinished } from "vitest";
import type {
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigSessionId,
    RigWorkspaceStore,
} from "happy2-state";
import { appearanceStoreCreate, rigHostNoop } from "happy2-state";
import { rigMemoryHistoryCreate, rigRouterCreate } from "../../sources/navigation/rigRouter";
import type { RigRouterContext } from "../../sources/navigation/rigRouter";

/**
 * Local mode addresses its sessions with the same URLs the cloud workspace uses
 * for chats, and the URL is the only thing that says which conversation is open.
 * These cases resolve real addresses through the local route tree and pin what
 * each one applies to the workspace store.
 */

/** Records what navigation applied to the workspace, in order. */
function workspaceSpy() {
    const applied: string[] = [];
    const store = {
        get: () => ({ list: { folders: { type: "loading" } }, conversation: {} }),
        subscribe: () => () => undefined,
        conversationOpen: (conversationId: RigSessionId) => applied.push(`open:${conversationId}`),
        conversationClose: () => applied.push("close"),
        [Symbol.dispose]: () => undefined,
    } as unknown as RigWorkspaceStore;
    return { applied, store };
}

async function resolve(url: string) {
    const { applied, store } = workspaceSpy();
    const router = rigRouterCreate(rigMemoryHistoryCreate(url));
    onTestFinished(() => router.history.destroy());
    const context: RigRouterContext = {
        appearance: appearanceStoreCreate(),
        clock: { get: () => 0, subscribe: () => () => undefined } as unknown as RigClockStore,
        connection: {
            get: () => ({ connection: "connected", daemon: "ready", attempt: 0 }),
            subscribe: () => () => undefined,
        } as unknown as RigConnectionStore,
        host: rigHostNoop as RigHost,
        workspace: store,
    };
    router.update({ context });
    await router.load();
    const matches = router.state.matches;
    return {
        applied,
        href: router.state.location.href,
        leaf: matches.at(-1)?.routeId ?? "",
        params: matches.at(-1)?.params ?? {},
        routeIds: matches.map((match) => match.routeId),
    };
}

it("addresses a local session by its working directory and then itself", async () => {
    const result = await resolve("/chats/f01d3r/ses_one");
    expect(result.leaf).toBe("/_workspace/chats/$folderId/$chatId");
    expect(result.params).toEqual({ chatId: "ses_one", folderId: "f01d3r" });
});

it("addresses a working directory on its own, with no session open", async () => {
    const result = await resolve("/chats/f01d3r");
    expect(result.leaf).toBe("/_workspace/chats/$folderId");
    expect(result.params).toEqual({ folderId: "f01d3r" });
    expect(result.applied).toEqual(["close"]);
});

it("keeps the session list and one session under the same persistent workspace layout", async () => {
    expect((await resolve("/chats")).routeIds).toContain("/_workspace");
    expect((await resolve("/chats/f01d3r/ses_one")).routeIds).toContain("/_workspace");
});

it("sends the root to the session list, as the cloud root goes to the chat list", async () => {
    const result = await resolve("/");
    expect(result.href).toBe("/chats");
    expect(result.leaf).toBe("/_workspace/chats");
});

it("materializes exactly the addressed session, and nothing when none is addressed", async () => {
    expect((await resolve("/chats/f01d3r/ses_one")).applied).toEqual(["open:ses_one"]);
    expect((await resolve("/chats")).applied).toEqual(["close"]);
});

it("decodes a percent-encoded session id rather than passing it through", async () => {
    expect((await resolve("/chats/f01d3r/ses%2Fone")).params).toEqual({
        chatId: "ses/one",
        folderId: "f01d3r",
    });
});
