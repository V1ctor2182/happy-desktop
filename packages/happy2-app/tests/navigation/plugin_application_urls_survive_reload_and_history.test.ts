import { expect, it, onTestFinished } from "vitest";
import type {
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigModelStore,
    RigWorkspaceStore,
} from "happy2-state";
import { appearanceStoreCreate, rigHostNoop, rigSettingsStoreCreate } from "happy2-state";
import type { AppRigDirectorySnapshot, AppRigDirectoryStore } from "../../sources/AppRigView";
import { rigMemoryHistoryCreate, rigRouterCreate } from "../../sources/navigation/rigRouter";
import type { RigRouterContext } from "../../sources/navigation/rigRouter";

/**
 * A local plugin application is addressed the way a session is: by the Rig that
 * has the plugin installed and then by the application itself. The address names
 * the application, never the generation of code behind it, so reopening it after
 * the plugin restarts lands on the same place. These cases pin that the address
 * resolves on its own — as it must after a reload, when nothing clicked a rail
 * row — and that it takes part in history like any other screen.
 */

function workspaceStub(): RigWorkspaceStore {
    return {
        get: () => ({ list: { projects: { type: "loading" } }, conversation: {} }),
        subscribe: () => () => undefined,
        conversationOpen: () => undefined,
        conversationClose: () => undefined,
        groupOpen: () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigWorkspaceStore;
}

function directory(): AppRigDirectoryStore {
    const snapshot: AppRigDirectorySnapshot = {
        add: { destination: "", label: "", open: false },
        rigs: [
            {
                connected: true,
                id: "local",
                kind: "local",
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
                    workspace: workspaceStub(),
                },
                status: "connected",
            },
        ],
    };
    return {
        get: () => snapshot,
        subscribe: () => () => undefined,
        addOpen: () => undefined,
        addClose: () => undefined,
        destinationUpdate: () => undefined,
        labelUpdate: () => undefined,
        addSubmit: () => undefined,
        rigConnect: () => undefined,
        rigDisconnect: () => undefined,
        rigRemove: () => undefined,
        rigActivate: () => undefined,
    };
}

function routerAt(url: string) {
    const router = rigRouterCreate(rigMemoryHistoryCreate(url));
    onTestFinished(() => router.history.destroy());
    const context: RigRouterContext = {
        appearance: appearanceStoreCreate(),
        rigs: directory(),
        settings: rigSettingsStoreCreate(),
    };
    router.update({ context });
    return router;
}

function leafOf(router: ReturnType<typeof routerAt>) {
    return router.state.matches.at(-1)?.routeId ?? "";
}

it("addresses a plugin application by its Rig and then the application itself", async () => {
    const router = routerAt("/plugins/local/usage:main");
    await router.load();
    expect(leafOf(router)).toBe("/plugins/$rigId/$applicationId");
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "usage:main",
        rigId: "local",
    });
});

it("resolves the address on its own, as it must after a reload", async () => {
    // Nothing navigated here: this is the URL arriving cold, which is what a
    // reload does. It still resolves to the application's own screen.
    const router = routerAt("/plugins/local/inbox:main");
    await router.load();
    expect(router.state.location.href).toBe("/plugins/local/inbox:main");
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "inbox:main",
        rigId: "local",
    });
});

it("sits alongside the other machine-scoped screens rather than under a shell of its own", async () => {
    // The inbox is the reference: both are one machine's own surface, reached
    // from the rail, and both render the workspace window from the top level.
    const inbox = routerAt("/inbox/local");
    await inbox.load();
    const application = routerAt("/plugins/local/usage:main");
    await application.load();
    expect(application.state.matches).toHaveLength(inbox.state.matches.length);
    expect(application.state.matches.map((match) => match.routeId)).toEqual([
        "__root__",
        "/plugins/$rigId/$applicationId",
    ]);
});

it("decodes a percent-encoded application id rather than passing it through", async () => {
    const router = routerAt("/plugins/local/usage%3Amain");
    await router.load();
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "usage:main",
        rigId: "local",
    });
});

it("goes back to what was open before the application, and forward to it again", async () => {
    const router = routerAt("/chats/local");
    await router.load();
    expect(leafOf(router)).toBe("/_workspace/chats/$rigId");

    await router.navigate({ params: { rigId: "local" }, to: "/chats/$rigId" } as never);
    await router.navigate({
        params: { applicationId: "usage:main", rigId: "local" },
        to: "/plugins/$rigId/$applicationId",
    } as never);
    await router.load();
    expect(leafOf(router)).toBe("/plugins/$rigId/$applicationId");

    router.history.back();
    await router.load();
    expect(leafOf(router)).toBe("/_workspace/chats/$rigId");

    router.history.forward();
    await router.load();
    expect(leafOf(router)).toBe("/plugins/$rigId/$applicationId");
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "usage:main",
        rigId: "local",
    });
});

it("moves between two applications and back, keeping each address whole", async () => {
    const router = routerAt("/plugins/local/usage:main");
    await router.load();
    await router.navigate({
        params: { applicationId: "inbox:main", rigId: "local" },
        to: "/plugins/$rigId/$applicationId",
    } as never);
    await router.load();
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "inbox:main",
        rigId: "local",
    });

    router.history.back();
    await router.load();
    expect(router.state.matches.at(-1)?.params).toEqual({
        applicationId: "usage:main",
        rigId: "local",
    });
    expect(leafOf(router)).toBe("/plugins/$rigId/$applicationId");
});
