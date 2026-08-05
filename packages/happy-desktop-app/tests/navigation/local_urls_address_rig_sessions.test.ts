import { expect, it, onTestFinished } from "vitest";
import type {
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigModelStore,
    RigSessionId,
    RigWorkspaceStore,
} from "happy-desktop-state";
import { appearanceStoreCreate, rigHostNoop, rigSettingsStoreCreate } from "happy-desktop-state";
import type { AppRigDirectorySnapshot, AppRigDirectoryStore } from "../../sources/AppRigView";
import { rigMemoryHistoryCreate, rigRouterCreate } from "../../sources/navigation/rigRouter";
import type { RigRouterContext } from "../../sources/navigation/rigRouter";

/**
 * Local mode addresses sessions by Rig, project, and session. The URL is the
 * only thing that says which conversation is open.
 */

/** Records what navigation applied to the workspace, in order. */
function workspaceSpy() {
    const applied: string[] = [];
    const store = {
        get: () => ({ list: { projects: { type: "loading" } }, conversation: {} }),
        subscribe: () => () => undefined,
        conversationOpen: (conversationId: RigSessionId) => applied.push(`open:${conversationId}`),
        conversationClose: () => applied.push("close"),
        groupOpen: (groupId: string) => applied.push(`group:${groupId}`),
        [Symbol.dispose]: () => undefined,
    } as unknown as RigWorkspaceStore;
    return { applied, store };
}

/** One connected Rig named `local`, whose workspace is the spy above. */
function directory(store: RigWorkspaceStore): AppRigDirectoryStore {
    const snapshot: AppRigDirectorySnapshot = {
        rigs: [
            {
                id: "local",
                label: "This Mac",
                projects: [],
                projectsStatus: "ready",
                session: {
                    clock: {
                        get: () => 0,
                        subscribe: () => () => undefined,
                    } as unknown as RigClockStore,
                    connection: {
                        get: () => ({ connection: "connected", daemon: "ready", attempt: 0 }),
                        subscribe: () => () => undefined,
                    } as unknown as RigConnectionStore,
                    host: rigHostNoop as RigHost,
                    models: {
                        get: () => ({ type: "loading" }),
                        subscribe: () => () => undefined,
                    } as unknown as RigModelStore,
                    workspace: store,
                },
                status: "connected",
            },
        ],
    };
    return {
        get: () => snapshot,
        subscribe: () => () => undefined,
        rigActivate: () => undefined,
    };
}

async function resolve(url: string) {
    const { applied, store } = workspaceSpy();
    const router = rigRouterCreate(rigMemoryHistoryCreate(url));
    onTestFinished(() => router.history.destroy());
    const context: RigRouterContext = {
        appearance: appearanceStoreCreate(),
        rigs: directory(store),
        settings: rigSettingsStoreCreate(),
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

it("addresses a local session by its Rig, its project, and then itself", async () => {
    const result = await resolve("/chats/local/prj_one/ses_one");
    expect(result.leaf).toBe("/_workspace/chats/$rigId/$groupId/$chatId");
    expect(result.params).toEqual({ chatId: "ses_one", groupId: "prj_one", rigId: "local" });
});

it("addresses a project on its own, with no session open", async () => {
    const result = await resolve("/chats/local/prj_one");
    expect(result.leaf).toBe("/_workspace/chats/$rigId/$groupId");
    expect(result.params).toEqual({ groupId: "prj_one", rigId: "local" });
    // Addressing a group opens it rather than merely releasing what was open:
    // the group gets a composer, and sending into it starts its first session.
    expect(result.applied).toEqual(["group:prj_one"]);
});

it("keeps the session list and one session under the same persistent workspace layout", async () => {
    expect((await resolve("/chats/local")).routeIds).toContain("/_workspace");
    expect((await resolve("/chats/local/prj_one/ses_one")).routeIds).toContain("/_workspace");
});

it("sends the root to the local Rig session list", async () => {
    const result = await resolve("/");
    expect(result.href).toBe("/chats/local");
    expect(result.leaf).toBe("/_workspace/chats/$rigId");
});

it("materializes exactly the addressed session, and nothing when none is addressed", async () => {
    expect((await resolve("/chats/local/prj_one/ses_one")).applied).toEqual(["open:ses_one"]);
    expect((await resolve("/chats/local")).applied).toEqual(["close"]);
});

it("decodes a percent-encoded session id rather than passing it through", async () => {
    expect((await resolve("/chats/local/prj_one/ses%2Fone")).params).toEqual({
        chatId: "ses/one",
        groupId: "prj_one",
        rigId: "local",
    });
});
