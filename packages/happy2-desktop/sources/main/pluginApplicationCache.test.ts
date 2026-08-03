import { describe, expect, it } from "vitest";
import type {
    LocalPlugin,
    PluginApp,
    PluginsState,
    RigPluginsConnection,
} from "@slopus/rig-connect";
import type { DesktopPluginCatalog } from "../shared/desktopContract";
import { PluginApplicationCache, pluginResourcePathNormalize } from "./pluginApplicationCache";

type CatalogListener = (
    apps: readonly PluginApp[],
    plugins: readonly LocalPlugin[],
    state: PluginsState,
) => void;

interface PendingLoad {
    readonly uri: string;
    readonly generation: string;
    readonly settle: (body: string) => void;
    readonly fail: (message: string) => void;
    aborted: boolean;
    done: boolean;
}

const RESOURCE_PREFIX = "ui://reporter/overview/";

/**
 * A scripted stand-in for the daemon's plugin subscription. Every resource read
 * stays pending until the test settles it, which is what makes the ordering the
 * cache promises — nothing navigable before its whole bundle is cached, and
 * nothing cached after its generation is gone — observable rather than assumed.
 */
class FakeConnection {
    announce: CatalogListener = () => undefined;
    closed = false;
    readonly loads: PendingLoad[] = [];
    readonly calls: {
        app: string;
        generation: string;
        server: string;
        name: string;
        args: unknown;
    }[] = [];
    readonly storage: { operation: string; app: string; key?: string; value?: unknown }[] = [];
    callAnswer: (name: string) => Promise<unknown> = () => Promise.resolve({ content: [] });
    /** What the daemon currently says is installed, as its own reader would see it. */
    latest: readonly PluginApp[] = [];
    /** The signal each call was made under, so cancellation can be observed. */
    readonly callSignals: (AbortSignal | undefined)[] = [];

    connect(options: { onChange: CatalogListener }): RigPluginsConnection {
        this.announce = (apps, plugins, state) => {
            this.latest = apps;
            options.onChange(apps, plugins, state);
        };
        options.onChange([], [], { connection: "connecting", failures: [] });
        return {
            apps: () => this.latest,
            plugins: () => [],
            state: () => ({ connection: "live", failures: [] }),
            readIcon: () => Promise.reject(new Error("This fake serves no plugin icons.")),
            readResource: (app, uri, load) =>
                new Promise((resolve, reject) => {
                    const pending: PendingLoad = {
                        aborted: false,
                        done: false,
                        fail: (message) => {
                            pending.done = true;
                            reject(new Error(message));
                        },
                        generation: app.generation,
                        settle: (body) => {
                            pending.done = true;
                            resolve({
                                contents: [
                                    {
                                        mimeType: uri.endsWith(".html")
                                            ? "text/html"
                                            : "text/javascript",
                                        text: body,
                                        uri,
                                    },
                                ],
                            });
                        },
                        uri,
                    };
                    this.loads.push(pending);
                    load?.signal?.addEventListener("abort", () => {
                        if (pending.done) return;
                        pending.aborted = true;
                        pending.done = true;
                        reject(new Error("aborted"));
                    });
                }),
            callTool: (app, server, name, args, options) => {
                this.calls.push({
                    app: app.id,
                    args,
                    generation: app.generation,
                    name,
                    server,
                });
                this.callSignals.push(options?.signal);
                return this.callAnswer(name);
            },
            storageDelete: async (app, key) => {
                this.storage.push({ app: app.id, key, operation: "delete" });
            },
            storageGet: async (app, key) => {
                this.storage.push({ app: app.id, key, operation: "get" });
                return { compact: true };
            },
            storageList: async (app) => {
                this.storage.push({ app: app.id, operation: "list" });
                return ["layout"];
            },
            storageSet: async (app, key, value) => {
                this.storage.push({ app: app.id, key, operation: "set", value });
            },
            close: () => {
                this.closed = true;
            },
        };
    }

    /** Settles every read that is still outstanding for one generation. */
    settleAll(generation: string): void {
        for (const load of this.loads)
            if (load.generation === generation && !load.done) load.settle(`// ${load.uri}`);
    }

    /** The pending read for one declared bundle path. */
    load(path: string): PendingLoad {
        return this.loads.find((pending) => pending.uri === `${RESOURCE_PREFIX}${path}`)!;
    }
}

function app(overrides: Partial<PluginApp> = {}): PluginApp {
    return {
        appId: "overview",
        generation: "g1",
        id: "reporter:overview",
        page: "index.html",
        pluginId: "reporter",
        resourceUri: `${RESOURCE_PREFIX}index.html`,
        resources: [
            {
                mimeType: "text/html",
                path: "index.html",
                size: 0,
                uri: `${RESOURCE_PREFIX}index.html`,
            },
            {
                mimeType: "text/javascript",
                path: "app.js",
                size: 0,
                uri: `${RESOURCE_PREFIX}app.js`,
            },
        ],
        sidebar: { label: "Accounts", order: 10 },
        title: "Account overview",
        tools: [
            {
                _meta: { ui: { resourceUri: `${RESOURCE_PREFIX}index.html`, visibility: ["app"] } },
                description: "Read the latest usage.",
                name: "refresh",
                server: "Usage",
            },
            {
                _meta: {
                    ui: { resourceUri: `${RESOURCE_PREFIX}index.html`, visibility: ["model"] },
                },
                description: "Erase the collected usage.",
                name: "wipe",
                server: "Usage",
            },
        ],
        ...overrides,
    };
}

function live(apps: readonly PluginApp[]): Parameters<CatalogListener> {
    return [apps, [], { connection: "live", failures: [] }];
}

function harness() {
    const connection = new FakeConnection();
    const catalogs: DesktopPluginCatalog[] = [];
    let host = 0;
    const cache = new PluginApplicationCache({
        connect: (options) => connection.connect(options),
        onChange: (catalog) => catalogs.push(catalog),
        originHostCreate: () => `host${(host += 1)}`,
    });
    return { cache, catalogs, connection };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PluginApplicationCache", () => {
    it("offers an application only once its whole bundle is cached", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();

        expect(cache.get().applications).toEqual([
            expect.objectContaining({ id: "reporter:overview", status: "loading" }),
        ]);
        expect(cache.get().applications[0]).not.toHaveProperty("source");

        // One resource is enough to keep the bundle incomplete.
        connection.load("index.html").settle("<!doctype html>");
        await settled();
        expect(cache.get().applications[0]?.status).toBe("loading");

        connection.load("app.js").settle("// app");
        await settled();
        expect(cache.get().applications[0]).toMatchObject({
            source: "happy-plugin://host1/index.html",
            status: "ready",
        });
        expect(cache.resourceRead("host1", "/app.js")).toMatchObject({
            mediaType: "text/javascript",
        });
    });

    it("keeps the announcement that follows the subscription's opening frame", async () => {
        const { cache, connection } = harness();
        // rig-connect hands its state over before it has read anything, so the
        // opening frame is an empty `connecting` catalog. A real catalog
        // announced straight afterwards must replace it rather than be lost
        // behind it, which is the race a view mounted at start-up would hit.
        expect(cache.get()).toMatchObject({ applications: [], connection: "connecting" });
        connection.announce(...live([app()]));
        await settled();
        expect(cache.get().connection).toBe("live");
        expect(cache.get().applications).toHaveLength(1);
    });

    it("replaces a generation rather than updating it, and abandons the old bundle", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();
        expect(cache.originResolve("host1")).toEqual({
            applicationId: "reporter:overview",
            generation: "g1",
        });

        connection.announce(...live([app({ generation: "g2" })]));
        await settled();
        // The old origin stops answering the instant it is replaced, so a view
        // still pointed at it fails rather than showing code that is gone.
        expect(cache.originResolve("host1")).toBeUndefined();
        expect(cache.resourceRead("host1", "/index.html")).toBeUndefined();
        expect(cache.get().applications[0]).toMatchObject({
            generation: "g2",
            status: "loading",
        });

        connection.settleAll("g2");
        await settled();
        expect(cache.get().applications[0]).toMatchObject({
            source: "happy-plugin://host2/index.html",
            status: "ready",
        });
    });

    it("cancels a prefetch that is still in flight when its generation goes", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.load("index.html").settle("<!doctype html>");

        connection.announce(...live([]));
        await settled();
        expect(connection.loads.filter((load) => load.aborted)).toHaveLength(1);
        expect(cache.get().applications).toEqual([]);
        expect(cache.originResolve("host1")).toBeUndefined();
    });

    it("drops an uninstalled application and everything it had cached", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();
        expect(cache.get().applications).toHaveLength(1);

        connection.announce([], [], { connection: "live", failures: [] });
        await settled();
        expect(cache.get().applications).toEqual([]);
        expect(cache.resourceRead("host1", "/index.html")).toBeUndefined();
        await expect(cache.toolCall("reporter:overview", "g1", "refresh", {})).rejects.toThrow(
            "no longer available",
        );
    });

    it("reports a bundle that could not be completed without offering it", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.loads[0]!.fail("Rig returned a different plugin resource size than declared.");
        await settled();
        expect(cache.get().applications[0]).toMatchObject({
            error: "Rig returned a different plugin resource size than declared.",
            status: "error",
        });
        expect(cache.get().applications[0]).not.toHaveProperty("source");
    });

    it("calls only a tool the application may call itself, on its declared server", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();

        // `wipe` exists, but the plugin declared it for the model rather than for
        // its own application, so it stops here without reaching the daemon.
        await expect(cache.toolCall("reporter:overview", "g1", "wipe", {})).rejects.toThrow(
            "not offered",
        );
        await expect(cache.toolCall("reporter:overview", "g1", "unknown", {})).rejects.toThrow(
            "not offered",
        );
        expect(connection.calls).toEqual([]);

        await expect(
            cache.toolCall("reporter:overview", "g1", "refresh", { a: 1 }),
        ).resolves.toEqual({ content: [] });
        expect(connection.calls).toEqual([
            {
                app: "reporter:overview",
                args: { a: 1 },
                generation: "g1",
                name: "refresh",
                server: "Usage",
            },
        ]);
    });

    it("calls a tool its plugin declared after the bundle was already cached", async () => {
        const { cache, connection } = harness();
        // The catalog names a generation as soon as its bundle exists, which is
        // before its plugin's server is up and has said what the application may
        // call. A view that mounts in that gap still owns its tools.
        connection.announce(...live([app({ tools: [] })]));
        await settled();
        connection.settleAll("g1");
        await settled();
        connection.latest = [app()];

        await expect(
            cache.toolCall("reporter:overview", "g1", "refresh", { a: 1 }),
        ).resolves.toEqual({ content: [] });
        expect(connection.calls).toMatchObject([{ name: "refresh", server: "Usage" }]);
    });

    it("refuses a tool name two of the application's servers both offer", async () => {
        const { cache, connection } = harness();
        // `tools/call` names a tool and nothing else, so a name two servers both
        // answer to has no unambiguous meaning. Picking one would run somebody's
        // side effect on a coin toss.
        connection.announce(
            ...live([
                app({
                    tools: [
                        {
                            _meta: {
                                ui: {
                                    resourceUri: `${RESOURCE_PREFIX}index.html`,
                                    visibility: ["app"],
                                },
                            },
                            description: "Read the latest usage.",
                            name: "refresh",
                            server: "Usage",
                        },
                        {
                            _meta: {
                                ui: {
                                    resourceUri: `${RESOURCE_PREFIX}index.html`,
                                    visibility: ["app"],
                                },
                            },
                            description: "Reload the accounts.",
                            name: "refresh",
                            server: "Accounts",
                        },
                    ],
                }),
            ]),
        );
        await settled();
        connection.settleAll("g1");
        await settled();

        await expect(cache.toolCall("reporter:overview", "g1", "refresh", {})).rejects.toThrow(
            /ambiguous/u,
        );
        // Both servers are named, so a plugin author can see what collided.
        await expect(cache.toolCall("reporter:overview", "g1", "refresh", {})).rejects.toThrow(
            /Accounts, Usage/u,
        );
        expect(connection.calls).toEqual([]);
    });

    it("withdraws one request without disturbing the generation or its siblings", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();

        const withdrawn = new AbortController();
        const other = new AbortController();
        await cache.toolCall(
            "reporter:overview",
            "g1",
            "refresh",
            {},
            {
                signal: withdrawn.signal,
            },
        );
        await cache.toolCall("reporter:overview", "g1", "refresh", {}, { signal: other.signal });
        const [first, second] = connection.callSignals;
        expect(first?.aborted).toBe(false);
        expect(second?.aborted).toBe(false);

        // Withdrawing one request aborts that call alone. The generation is
        // untouched, so its other work and its bytes carry on.
        withdrawn.abort();
        expect(first?.aborted).toBe(true);
        expect(second?.aborted).toBe(false);
        expect(cache.get().applications[0]?.status).toBe("ready");
        expect(cache.resourceRead("host1", "/app.js")).toBeDefined();

        // Retiring the generation aborts what is left, which is the other
        // lifetime the same call has to answer to.
        connection.announce(...live([]));
        await settled();
        expect(second?.aborted).toBe(true);
    });

    it("abandons a storage read the View withdrew", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();

        // The daemon's storage calls take no cancellation of their own, so the
        // host stops waiting rather than pretending the read was stopped.
        const controller = new AbortController();
        const reading = cache.storageGet("reporter:overview", "g1", "layout", {
            signal: controller.signal,
        });
        controller.abort();
        await expect(reading).rejects.toThrow(/cancelled/u);
    });

    it("answers a declared resource from the bundle it already cached", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.load("index.html").settle("<!doctype html>");
        connection.load("app.js").settle("// app");
        await settled();
        const reads = connection.loads.length;

        await expect(
            cache.resourceReadByUri("reporter:overview", "g1", `${RESOURCE_PREFIX}app.js`),
        ).resolves.toEqual({
            contents: [
                { mimeType: "text/javascript", text: "// app", uri: `${RESOURCE_PREFIX}app.js` },
            ],
        });
        expect(connection.loads).toHaveLength(reads);

        // Anything the bundle does not hold is the daemon's to answer, because it
        // is the authority on what this generation declared.
        const pending = cache.resourceReadByUri(
            "reporter:overview",
            "g1",
            `${RESOURCE_PREFIX}late.json`,
        );
        await settled();
        expect(connection.loads).toHaveLength(reads + 1);
        connection.load("late.json").settle("{}");
        await expect(pending).resolves.toMatchObject({ contents: expect.any(Array) });
    });

    it("scopes stored values to the application that asked for them", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();

        await expect(cache.storageGet("reporter:overview", "g1", "layout")).resolves.toEqual({
            compact: true,
        });
        await cache.storageSet("reporter:overview", "g1", "layout", { compact: false });
        await expect(cache.storageList("reporter:overview", "g1")).resolves.toEqual(["layout"]);
        await cache.storageDelete("reporter:overview", "g1", "layout");
        expect(connection.storage).toEqual([
            { app: "reporter:overview", key: "layout", operation: "get" },
            {
                app: "reporter:overview",
                key: "layout",
                operation: "set",
                value: { compact: false },
            },
            { app: "reporter:overview", operation: "list" },
            { app: "reporter:overview", key: "layout", operation: "delete" },
        ]);

        // A generation that is gone reaches nothing at all.
        connection.announce([], [], { connection: "live", failures: [] });
        await settled();
        await expect(cache.storageGet("reporter:overview", "g1", "layout")).rejects.toThrow(
            "no longer available",
        );
    });

    it("retires a generation the daemon calls stale, and never retries it", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();
        connection.callAnswer = () =>
            Promise.reject(new Error("That plugin application generation is no longer current."));

        await expect(cache.toolCall("reporter:overview", "g1", "refresh", {})).rejects.toThrow(
            "no longer current",
        );
        expect(cache.originResolve("host1")).toBeUndefined();
        expect(cache.get().applications).toEqual([]);

        // A second attempt on the retired generation stops here rather than
        // asking the daemon again.
        const before = connection.calls.length;
        await expect(cache.toolCall("reporter:overview", "g1", "refresh", {})).rejects.toThrow(
            "no longer available",
        );
        expect(connection.calls).toHaveLength(before);
    });

    it("closes its subscription and stops answering when the host disposes it", async () => {
        const { cache, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();

        cache[Symbol.dispose]();
        expect(connection.closed).toBe(true);
        expect(cache.get()).toEqual({ applications: [], connection: "closed", loading: false });
        expect(cache.resourceRead("host1", "/index.html")).toBeUndefined();
    });

    it("keeps every cached bundle across a clean reconnect", async () => {
        const { cache, catalogs, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();
        const reads = connection.loads.length;
        const offered = cache.get().applications[0];

        // The subscription drops and comes back with the same generations. The
        // code behind them did not change, so nothing is read again and the view
        // pointed at the origin keeps working through the gap.
        connection.announce([], [], { connection: "reconnecting", failures: [] });
        await settled();
        expect(cache.originResolve("host1")).toBeDefined();
        expect(cache.get().connection).toBe("reconnecting");
        expect(cache.get().applications).toEqual([offered]);

        connection.announce(...live([app()]));
        await settled();
        expect(connection.loads).toHaveLength(reads);
        expect(cache.get().applications).toEqual([offered]);
        expect(cache.resourceRead("host1", "/app.js")).toBeDefined();
        expect(catalogs.at(-1)?.connection).toBe("live");
    });

    it("keeps what survived a gap and lets go of what did not", async () => {
        const { cache, connection } = harness();
        const other = app({
            appId: "queue",
            id: "reporter:queue",
            resources: [
                {
                    mimeType: "text/html",
                    path: "index.html",
                    size: 0,
                    uri: `${RESOURCE_PREFIX}index.html`,
                },
            ],
        });
        const going = app({
            appId: "trends",
            id: "reporter:trends",
            resources: [
                {
                    mimeType: "text/html",
                    path: "index.html",
                    size: 0,
                    uri: `${RESOURCE_PREFIX}index.html`,
                },
            ],
        });
        connection.announce(...live([app(), other, going]));
        await settled();
        connection.settleAll("g1");
        await settled();
        const kept = cache.get().applications.find((entry) => entry.id === "reporter:overview");
        expect(cache.get().applications).toHaveLength(3);

        // The gap ends with one application untouched, one behind new code, and
        // one uninstalled while the window was not being told.
        connection.announce(...live([app(), { ...other, generation: "g2" }]));
        await settled();

        expect(cache.get().applications.find((entry) => entry.id === "reporter:overview")).toEqual(
            kept,
        );
        expect(cache.originResolve("host1")).toEqual({
            applicationId: "reporter:overview",
            generation: "g1",
        });
        // The replaced application's old bundle and the removed one both go.
        expect(cache.originResolve("host2")).toBeUndefined();
        expect(cache.originResolve("host3")).toBeUndefined();
        expect(cache.get().applications.map((entry) => entry.id)).toEqual([
            "reporter:overview",
            "reporter:queue",
        ]);
        expect(cache.get().applications[1]).toMatchObject({ generation: "g2", status: "loading" });
    });

    it("announces only when the catalog actually changed", async () => {
        const { catalogs, connection } = harness();
        connection.announce(...live([app()]));
        await settled();
        connection.settleAll("g1");
        await settled();
        const seen = catalogs.length;
        connection.announce(...live([app()]));
        await settled();
        expect(catalogs).toHaveLength(seen);
    });
});

describe("pluginResourcePathNormalize", () => {
    it("resolves the relative forms of one declared resource onto that resource", () => {
        expect(pluginResourcePathNormalize("/app.js")).toBe("app.js");
        expect(pluginResourcePathNormalize("./app.js")).toBe("app.js");
        expect(pluginResourcePathNormalize("assets//icon.png")).toBe("assets/icon.png");
        expect(pluginResourcePathNormalize("/%61pp.js")).toBe("app.js");
    });

    it("refuses anything that leaves the bundle", () => {
        expect(pluginResourcePathNormalize("../secret")).toBeUndefined();
        expect(pluginResourcePathNormalize("/assets/../../secret")).toBeUndefined();
        expect(pluginResourcePathNormalize("/")).toBeUndefined();
        expect(pluginResourcePathNormalize("/%")).toBeUndefined();
    });
});
