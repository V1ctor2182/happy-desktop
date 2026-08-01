import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    LocalPlugin,
    PluginApp,
    PluginsState,
    RigPluginsConnection,
} from "@slopus/rig-connect";
import type { DesktopPluginCatalog } from "../shared/desktopContract";
import { happyPluginScheme } from "../shared/desktopContract";

/**
 * What the window's session was asked to serve. An application is mounted in a
 * frame of the window, so its bundle is answered there — from memory, only for a
 * mounted generation, and on a scheme that is not CORS-enabled.
 */
const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
const privileged: unknown[] = [];

vi.mock("electron", () => ({
    protocol: {
        registerSchemesAsPrivileged: (schemes: unknown[]) => privileged.push(...schemes),
    },
    session: {
        defaultSession: {
            protocol: {
                handle: (scheme: string, handler: (request: Request) => Response) => {
                    handlers.set(scheme, handler);
                },
            },
        },
    },
}));

const connections: FakeRigConnection[] = [];
const endpoints: { endpoint: string; token: string }[] = [];

vi.mock("@slopus/rig-connect", () => ({
    connectRig: (options: { endpoint: string; token: string }) => {
        endpoints.push(options);
        const connection = new FakeRigConnection();
        connections.push(connection);
        return connection;
    },
}));

type CatalogListener = (
    apps: readonly PluginApp[],
    plugins: readonly LocalPlugin[],
    state: PluginsState,
) => void;

/** A daemon that answers every resource read at once, so bundles finish caching. */
class FakeRigConnection {
    announce: CatalogListener = () => undefined;
    closed = false;
    rigClosed = false;
    readonly calls: { app: string; generation: string; name: string; server: string }[] = [];
    readonly storage: { app: string; key?: string; operation: string }[] = [];

    connectPlugins(options: { onChange: CatalogListener }): RigPluginsConnection {
        this.announce = options.onChange;
        options.onChange([], [], { connection: "connecting", failures: [] });
        return {
            apps: () => [],
            plugins: () => [],
            state: () => ({ connection: "live", failures: [] }),
            readResource: (_app, uri) =>
                Promise.resolve({
                    contents: [
                        {
                            mimeType: uri.endsWith(".html") ? "text/html" : "text/javascript",
                            text: `bytes of ${uri.slice(uri.lastIndexOf("/") + 1)}`,
                            uri,
                        },
                    ],
                }),
            callTool: (app, server, name) => {
                this.calls.push({
                    app: app.id,
                    generation: app.generation,
                    name,
                    server,
                });
                return Promise.resolve({ content: [] });
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
            storageSet: async (app, key) => {
                this.storage.push({ app: app.id, key, operation: "set" });
            },
            close: () => {
                this.closed = true;
            },
        };
    }

    close(): void {
        this.rigClosed = true;
    }
}

const {
    PluginApplicationHost,
    pluginApplicationSchemeRegister,
    pluginAppCancelParse,
    pluginAppRequestParse,
    pluginOriginHost,
} = await import("./pluginApplicationHost");

const RESOURCE_PREFIX = "ui://reporter/overview/";

function application(overrides: Partial<PluginApp> = {}): PluginApp {
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
        ],
        ...overrides,
    } as PluginApp;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A host following one endpoint, with one ready application already cached. */
async function hostWithApplication(overrides: Partial<PluginApp> = {}) {
    let catalog: DesktopPluginCatalog = { applications: [], connection: "closed", loading: false };
    const host = new PluginApplicationHost({
        onChange: (next) => {
            catalog = next;
        },
    });
    host.endpointSet("http://127.0.0.1:4242");
    const connection = connections.at(-1);
    if (!connection) throw new Error("no connection was opened");
    connection.announce([application(overrides)], [], { connection: "live", failures: [] });
    await flush();
    await flush();
    return { catalog: () => catalog, connection, host };
}

/**
 * The bundle origin behind an address. Built by hand because a scheme Chromium
 * has not been told about has no origin in plain Node.
 */
function originOf(source: string): string {
    return `${happyPluginScheme}://${pluginOriginHost(source) ?? ""}`;
}

function serve(url: string): Promise<Response> {
    const handler = handlers.get(happyPluginScheme);
    if (!handler) throw new Error("the bundle scheme was never handled");
    return Promise.resolve(handler(new Request(url)));
}

beforeEach(() => {
    handlers.clear();
    privileged.length = 0;
    connections.length = 0;
    endpoints.length = 0;
});

describe("plugin bundle origin", () => {
    it("declares a secure, standard scheme that reaches nothing but its own bytes", () => {
        pluginApplicationSchemeRegister();
        expect(privileged).toEqual([
            {
                privileges: {
                    allowServiceWorkers: false,
                    bypassCSP: false,
                    corsEnabled: false,
                    secure: true,
                    standard: true,
                    stream: false,
                    supportFetchAPI: false,
                },
                scheme: happyPluginScheme,
            },
        ]);
    });

    it("serves bundles on the session the window mounts its frames in", () => {
        new PluginApplicationHost({ onChange: () => undefined });
        expect([...handlers.keys()]).toEqual([happyPluginScheme]);
    });

    it("answers a cached resource with the daemon's own policy reasserted", async () => {
        const { catalog } = await hostWithApplication();
        const source = catalog().applications[0]?.source ?? "";
        expect(source.startsWith(`${happyPluginScheme}://`)).toBe(true);

        const response = await serve(source);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("bytes of index.html");
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        const policy = response.headers.get("content-security-policy") ?? "";
        expect(policy).toContain("default-src 'none'");
        expect(policy).toContain("connect-src 'none'");
        expect(policy).toContain("frame-src 'none'");
        expect(policy).toContain("form-action 'none'");
        expect(policy).toContain("base-uri 'none'");
    });

    it("resolves a bundle's own relative paths and refuses anything above it", async () => {
        const { catalog } = await hostWithApplication();
        const origin = originOf(catalog().applications[0]?.source ?? "");

        expect((await serve(`${origin}/app.js`)).status).toBe(200);
        expect((await serve(`${origin}/./app.js`)).status).toBe(200);
        expect((await serve(`${origin}/nothing.js`)).status).toBe(404);
        expect((await serve(`${origin}/%2e%2e/secret`)).status).toBe(404);
    });

    it("stops answering for a generation that has been replaced", async () => {
        const { catalog, connection } = await hostWithApplication();
        const stale = originOf(catalog().applications[0]?.source ?? "");

        connection.announce([application({ generation: "g2" })], [], {
            connection: "live",
            failures: [],
        });
        await flush();
        await flush();
        const fresh = originOf(catalog().applications[0]?.source ?? "");

        expect(fresh).not.toBe(stale);
        // The replaced origin fails rather than quietly serving its successor.
        expect((await serve(`${stale}/index.html`)).status).toBe(404);
        expect((await serve(`${fresh}/index.html`)).status).toBe(200);
    });

    it("gives the window identities and an opaque origin, never the daemon's address", async () => {
        const { catalog } = await hostWithApplication();
        const projected = catalog().applications[0];
        expect(projected).toBeDefined();
        expect(Object.keys(projected ?? {}).sort()).toEqual([
            "generation",
            "id",
            "label",
            "order",
            "pluginId",
            "source",
            "status",
            "title",
        ]);
        const rendered = JSON.stringify(catalog());
        expect(rendered).not.toContain("127.0.0.1");
        expect(rendered).not.toContain("happy2-local-capability");
        expect(rendered).not.toContain("/rig-connect");
    });
});

describe("plugin host request boundary", () => {
    const toolCall = { arguments: { page: 1 }, kind: "toolCall", name: "refresh" } as const;

    it("accepts a request from the view's own committed origin", async () => {
        const { catalog, connection, host } = await hostWithApplication();
        const origin = catalog().applications[0]?.source ?? "";

        await expect(host.appRequest(origin, "r1", toolCall)).resolves.toEqual({ content: [] });
        expect(connection.calls).toEqual([
            { app: "reporter:overview", generation: "g1", name: "refresh", server: "Usage" },
        ]);

        await expect(
            host.appRequest(origin, "r2", { key: "layout", kind: "storageGet" }),
        ).resolves.toEqual({ compact: true });
        await expect(host.appRequest(origin, "r3", { kind: "storageList" })).resolves.toEqual([
            "layout",
        ]);
        expect(connection.storage).toEqual([
            { app: "reporter:overview", key: "layout", operation: "get" },
            { app: "reporter:overview", operation: "list" },
        ]);
    });

    it("answers a declared resource by its own uri", async () => {
        const { catalog, host } = await hostWithApplication();
        const origin = catalog().applications[0]?.source ?? "";

        await expect(
            host.appRequest(origin, "r1", {
                kind: "resourceRead",
                uri: `${RESOURCE_PREFIX}app.js`,
            }),
        ).resolves.toEqual({
            contents: [
                {
                    mimeType: "text/javascript",
                    text: "bytes of app.js",
                    uri: `${RESOURCE_PREFIX}app.js`,
                },
            ],
        });
    });

    it("refuses an origin that is not a mounted bundle, without asking the daemon", async () => {
        const { catalog, connection, host } = await hostWithApplication();
        const origin = originOf(catalog().applications[0]?.source ?? "");

        await expect(host.appRequest("http://localhost:3000", "r1", toolCall)).rejects.toThrow();
        await expect(host.appRequest("file:///etc/passwd", "r1", toolCall)).rejects.toThrow();
        await expect(
            host.appRequest(`${happyPluginScheme}://someone-else/index.html`, "r1", toolCall),
        ).rejects.toThrow();
        await expect(host.appRequest("not a url", "r1", toolCall)).rejects.toThrow();
        expect(connection.calls).toEqual([]);

        // The real origin still works, so the refusals were about the caller.
        await expect(host.appRequest(`${origin}/`, "r1", toolCall)).resolves.toEqual({
            content: [],
        });
    });

    it("refuses a tool the current generation did not offer its application", async () => {
        const { catalog, connection, host } = await hostWithApplication();
        const origin = catalog().applications[0]?.source ?? "";

        await expect(
            host.appRequest(origin, "r1", {
                arguments: 1,
                kind: "toolCall",
                name: "deleteEverything",
            }),
        ).rejects.toThrow();
        expect(connection.calls).toEqual([]);
    });

    it("recognizes only its own scheme as a bundle address", () => {
        expect(pluginOriginHost(`${happyPluginScheme}://abc123/index.html`)).toBe("abc123");
        expect(pluginOriginHost("https://abc123/index.html")).toBeUndefined();
        expect(pluginOriginHost("file:///tmp/index.html")).toBeUndefined();
        expect(pluginOriginHost("javascript:alert(1)")).toBeUndefined();
        expect(pluginOriginHost("")).toBeUndefined();
    });

    it("only lets a view be pointed at an origin it currently owns", async () => {
        const { catalog, host } = await hostWithApplication();
        const origin = originOf(catalog().applications[0]?.source ?? "");

        expect(host.originAllows(`${origin}/index.html`)).toBe(true);
        expect(host.originAllows(`${happyPluginScheme}://other/index.html`)).toBe(false);
        expect(host.originAllows("https://example.com/index.html")).toBe(false);
        expect(host.originAllows("about:blank")).toBe(false);
    });
});

describe("pluginAppRequestParse", () => {
    const origin = `${happyPluginScheme}://abc123`;

    it("accepts exactly the operations the host offers, with their own arguments", () => {
        expect(
            pluginAppRequestParse({
                origin,
                request: { arguments: { a: 1 }, kind: "toolCall", name: "refresh" },
                requestId: "7",
            }),
        ).toEqual({
            origin,
            request: { arguments: { a: 1 }, kind: "toolCall", name: "refresh" },
            requestId: "7",
        });
        expect(
            pluginAppRequestParse({
                origin,
                request: { kind: "resourceRead", uri: "ui://a/b" },
                requestId: "7",
            }),
        ).toEqual({ origin, request: { kind: "resourceRead", uri: "ui://a/b" }, requestId: "7" });
        expect(
            pluginAppRequestParse({
                origin,
                request: { key: "layout", kind: "storageSet", value: 1 },
                requestId: "7",
            }),
        ).toEqual({
            origin,
            request: { key: "layout", kind: "storageSet", value: 1 },
            requestId: "7",
        });
        expect(
            pluginAppRequestParse({ origin, request: { kind: "storageList" }, requestId: "7" }),
        ).toEqual({ origin, request: { kind: "storageList" }, requestId: "7" });
    });

    it("refuses a request that names no request of its own", () => {
        // The id is what a cancellation later refers to, so a request without
        // one could never be withdrawn and is not a request this host runs.
        expect(pluginAppRequestParse({ origin, request: { kind: "storageList" } })).toBeUndefined();
        expect(
            pluginAppRequestParse({ origin, request: { kind: "storageList" }, requestId: "" }),
        ).toBeUndefined();
        expect(
            pluginAppRequestParse({ origin, request: { kind: "storageList" }, requestId: 7 }),
        ).toBeUndefined();
    });

    it("reads a cancellation as a View and one of its own requests, and nothing else", () => {
        expect(pluginAppCancelParse({ origin, requestId: "7" })).toEqual({
            origin,
            requestId: "7",
        });
        expect(pluginAppCancelParse({ origin })).toBeUndefined();
        expect(pluginAppCancelParse({ origin: "https://example.com", requestId: "7" })).toBe(
            undefined,
        );
        expect(pluginAppCancelParse({ requestId: "7" })).toBeUndefined();
        expect(pluginAppCancelParse(undefined)).toBeUndefined();
    });

    it("refuses anything outside that set, and anything that is not a bundle origin", () => {
        expect(pluginAppRequestParse(undefined)).toBeUndefined();
        expect(pluginAppRequestParse({ origin, request: { kind: "wipe" } })).toBeUndefined();
        expect(pluginAppRequestParse({ origin, request: { kind: "toolCall" } })).toBeUndefined();
        expect(pluginAppRequestParse({ origin, request: { kind: "storageGet" } })).toBeUndefined();
        expect(
            pluginAppRequestParse({
                origin: "https://example.com",
                request: { kind: "storageList" },
            }),
        ).toBeUndefined();
    });
});

describe("plugin host lifetime", () => {
    it("drops every bundle when the machine it belongs to changes", async () => {
        const { catalog, connection, host } = await hostWithApplication();
        const origin = originOf(catalog().applications[0]?.source ?? "");

        host.endpointSet("http://127.0.0.1:5252");
        expect(connection.closed).toBe(true);
        expect(connection.rigClosed).toBe(true);
        expect(host.originAllows(`${origin}/index.html`)).toBe(false);
        expect((await serve(`${origin}/index.html`)).status).toBe(404);
        await expect(
            host.appRequest(`${origin}/`, "r1", {
                arguments: 1,
                kind: "toolCall",
                name: "refresh",
            }),
        ).rejects.toThrow();
    });

    it("empties the catalog when no local Rig is there at all", async () => {
        const { catalog, host } = await hostWithApplication();
        host.endpointSet(undefined);
        expect(catalog()).toEqual({ applications: [], connection: "closed", loading: false });
    });

    it("closes its subscription and stops serving once disposed", async () => {
        const { catalog, connection, host } = await hostWithApplication();
        const origin = originOf(catalog().applications[0]?.source ?? "");

        host[Symbol.dispose]();
        expect(connection.closed).toBe(true);
        expect((await serve(`${origin}/index.html`)).status).toBe(404);
        expect(host.originAllows(`${origin}/index.html`)).toBe(false);
    });
});
