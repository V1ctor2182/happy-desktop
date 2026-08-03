import { protocol, session as electronSession } from "electron";
import { connectRig } from "@slopus/rig-connect";
import {
    happyPluginScheme,
    type DesktopPluginAppRequest,
    type DesktopPluginCatalog,
    type DesktopPluginInventory,
} from "../shared/desktopContract";
import { PluginApplicationCache } from "./pluginApplicationCache";

/**
 * The exact policy Rig serves its own plugin resources with. Bundles are cached
 * here and replayed from an isolated origin, so the boundary the daemon declared
 * has to be reasserted at that origin rather than inherited: no network, no
 * frames, no objects, no base rewriting, and no form submission, with the
 * bundle's own scripts, styles, fonts, inline styles, and data images allowed.
 */
const PLUGIN_CONTENT_SECURITY_POLICY =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const EMPTY_CATALOG: DesktopPluginCatalog = {
    applications: [],
    connection: "closed",
    loading: false,
};

const EMPTY_INVENTORY: DesktopPluginInventory = {
    packages: [],
    failures: [],
    connection: "closed",
    loading: false,
};

/**
 * Declares the bundle scheme before Chromium starts. It is a standard, secure
 * origin so relative paths inside a bundle resolve and the page is a secure
 * context; it is deliberately not CORS-enabled and does not bypass CSP, because
 * a plugin page is only ever allowed to load its own bytes.
 */
export function pluginApplicationSchemeRegister(): void {
    protocol.registerSchemesAsPrivileged([
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
}

export interface PluginApplicationHostOptions {
    /** Announces a new catalog so the window can be told without being asked. */
    readonly onChange: (catalog: DesktopPluginCatalog) => void;
    /**
     * Announces what is installed. It is called only while something is
     * following, so a host whose windows are all looking at something else does
     * no inventory work at all.
     */
    readonly onInventoryChange?: (inventory: DesktopPluginInventory) => void;
}

/**
 * Owns this process's single plugin-application subscription and the isolated
 * origin its bundles are served on.
 *
 * The daemon address and its credential never leave this object: the renderer
 * receives a catalog of identities and, for a generation whose bundle is already
 * cached, one opaque origin to point an isolated view at. Actions arrive from
 * that view by its own origin, are checked against the current generation's
 * declared names, and are then forwarded; nothing else about the daemon is
 * reachable from a plugin page or from the renderer.
 */
export class PluginApplicationHost implements Disposable {
    #cache?: PluginApplicationCache;
    #closed = false;
    #endpoint?: string;
    /**
     * Which subscription the host is currently listening to. A cache announces
     * its opening frame while it is still being constructed, so the check cannot
     * be against the cache object itself; this token is set first and replaced
     * whenever the endpoint changes, which is what silences a superseded one.
     */
    #generation = 0;
    readonly #onChange: (catalog: DesktopPluginCatalog) => void;
    readonly #onInventoryChange?: (inventory: DesktopPluginInventory) => void;
    /** Whether any window is reading the inventory right now. */
    #inventoryFollowed = false;
    /** Controllers for the requests still running, by origin and request id. */
    readonly #requests = new Map<string, AbortController>();

    constructor(options: PluginApplicationHostOptions) {
        this.#onChange = options.onChange;
        this.#onInventoryChange = options.onInventoryChange;
        // The window mounts an application in a frame of its own, so the bundle
        // scheme is answered in the window's session. It is answered from memory
        // and only for a currently mounted generation, and the scheme is not
        // CORS-enabled, so nothing else in that session — the renderer included —
        // can read a plugin's bytes.
        electronSession.defaultSession.protocol.handle(happyPluginScheme, (request) =>
            this.#serve(request),
        );
    }

    get(): DesktopPluginCatalog {
        return this.#cache?.get() ?? EMPTY_CATALOG;
    }

    inventoryGet(): DesktopPluginInventory {
        return this.#cache?.inventoryGet() ?? EMPTY_INVENTORY;
    }

    /**
     * Starts or stops projecting what is installed. The daemon subscription
     * itself is not affected: it is the one the pinned application rows need, and
     * it is followed for as long as an endpoint is set, whoever is looking. What
     * this releases is everything only the catalog screen wants — turning the
     * daemon's package objects into renderer-shaped ones, comparing them, and
     * cloning them across the IPC boundary.
     *
     * It is remembered on the host rather than only on the cache, because
     * changing endpoint builds a new cache and whoever is watching is still
     * watching.
     */
    inventoryFollowSet(following: boolean): void {
        if (this.#inventoryFollowed === following) return;
        this.#inventoryFollowed = following;
        this.#cache?.inventoryFollowSet(following);
    }

    /**
     * Follows the active local Rig. A new endpoint replaces the subscription and
     * every cached generation with it, because bundles belong to the daemon that
     * served them; no endpoint at all leaves the catalog empty and closed.
     */
    endpointSet(rigHttpUrl: string | undefined): void {
        if (this.#closed || this.#endpoint === rigHttpUrl) return;
        this.#endpoint = rigHttpUrl;
        this.#cache?.[Symbol.dispose]();
        this.#cache = undefined;
        const generation = ++this.#generation;
        if (rigHttpUrl === undefined) {
            this.#onChange(EMPTY_CATALOG);
            if (this.#inventoryFollowed) this.#onInventoryChange?.(EMPTY_INVENTORY);
            return;
        }
        const connection = connectRig({
            endpoint: `${rigHttpUrl.replace(/\/$/u, "")}/rig-connect`,
            token: "happy2-local-capability",
        });
        const cache = new PluginApplicationCache({
            connect: (options) => {
                const plugins = connection.connectPlugins(options);
                return {
                    ...plugins,
                    close: () => {
                        plugins.close();
                        connection.close();
                    },
                };
            },
            onChange: (catalog) => {
                if (this.#generation === generation) this.#onChange(catalog);
            },
            ...(this.#onInventoryChange
                ? {
                      onInventoryChange: (inventory: DesktopPluginInventory) => {
                          if (this.#generation === generation) this.#onInventoryChange?.(inventory);
                      },
                  }
                : {}),
        });
        cache.inventoryFollowSet(this.#inventoryFollowed);
        this.#cache = cache;
        this.#onChange(cache.get());
        // A new endpoint is a new machine, so whoever is watching is told at once
        // rather than waiting for that machine's first catalog.
        if (this.#inventoryFollowed) this.#onInventoryChange?.(cache.inventoryGet());
    }

    /**
     * Runs one host request for a mounted view.
     *
     * `origin` is the origin the window read from the message event the request
     * arrived in — a value the browser sets and an application's page cannot
     * choose — so which application and which generation is asking is decided
     * here rather than by anything the page said. An origin that is not a
     * currently mounted generation is refused before the daemon is touched.
     */
    async appRequest(
        origin: string,
        requestId: string,
        request: DesktopPluginAppRequest,
    ): Promise<unknown> {
        const cache = this.#cache;
        if (!cache) throw new Error("No local Rig is connected.");
        const identity = pluginOriginHost(origin);
        const application = identity === undefined ? undefined : cache.originResolve(identity);
        if (!application) throw new Error("That plugin application is no longer available.");
        const { applicationId, generation } = application;
        // One controller per request, keyed by the origin it came from so a
        // request id chosen by one application's View can never reach another's
        // work. It is separate from the generation's own controller, which
        // retires everything at once when the code behind the view is replaced.
        const key = `${origin}\u0000${requestId}`;
        const controller = new AbortController();
        this.#requests.get(key)?.abort();
        this.#requests.set(key, controller);
        const options = { signal: controller.signal };
        try {
            switch (request.kind) {
                case "toolCall":
                    return await cache.toolCall(
                        applicationId,
                        generation,
                        request.name,
                        request.arguments,
                        options,
                    );
                case "resourceRead":
                    return await cache.resourceReadByUri(
                        applicationId,
                        generation,
                        request.uri,
                        options,
                    );
                case "storageGet":
                    return await cache.storageGet(applicationId, generation, request.key, options);
                case "storageSet":
                    return await cache.storageSet(
                        applicationId,
                        generation,
                        request.key,
                        request.value,
                        options,
                    );
                case "storageDelete":
                    return await cache.storageDelete(
                        applicationId,
                        generation,
                        request.key,
                        options,
                    );
                case "storageList":
                    return await cache.storageList(applicationId, generation, options);
            }
        } finally {
            if (this.#requests.get(key) === controller) this.#requests.delete(key);
        }
    }

    /**
     * Withdraws one request the mounted View no longer wants. The id means
     * nothing on its own: it is only ever read together with the origin the
     * cancellation arrived on, so one application cannot withdraw another's
     * work. An id that names nothing is ignored — the request it referred to has
     * already settled.
     */
    appCancel(origin: string, requestId: string): void {
        const key = `${origin}\u0000${requestId}`;
        const controller = this.#requests.get(key);
        if (!controller) return;
        this.#requests.delete(key);
        controller.abort();
    }

    /** Whether an address is one of the currently mounted bundle origins. */
    originAllows(candidate: string): boolean {
        const cache = this.#cache;
        if (!cache) return false;
        const host = pluginOriginHost(candidate);
        return host !== undefined && cache.originResolve(host) !== undefined;
    }

    [Symbol.dispose](): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#generation += 1;
        for (const controller of this.#requests.values()) controller.abort();
        this.#requests.clear();
        this.#cache?.[Symbol.dispose]();
        this.#cache = undefined;
    }

    #serve(request: Request): Response {
        const cache = this.#cache;
        const url = new URL(request.url);
        const resource = cache?.resourceRead(url.hostname, url.pathname);
        // A retired generation stops answering rather than falling back to the
        // one that replaced it: a stale view must fail, not silently update.
        if (!resource) return new Response(null, { status: 404 });
        return new Response(resource.body as unknown as BodyInit, {
            headers: {
                "cache-control": "no-store",
                "content-security-policy": PLUGIN_CONTENT_SECURITY_POLICY,
                "content-type": resourceContentType(resource.mediaType),
                "x-content-type-options": "nosniff",
            },
            status: 200,
        });
    }
}

/** The opaque generation host inside a bundle address, when it is one at all. */
export function pluginOriginHost(candidate: string): string | undefined {
    try {
        const url = new URL(candidate);
        return url.protocol === `${happyPluginScheme}:` ? url.hostname : undefined;
    } catch {
        return undefined;
    }
}

function resourceContentType(mediaType: string): string {
    return mediaType.startsWith("text/") || mediaType === "application/json"
        ? `${mediaType}; charset=utf-8`
        : mediaType;
}

/**
 * Validates one cancellation the window forwarded from a mounted application.
 * It carries no operation of its own: only which View is speaking, by the origin
 * the browser stamped, and which of that View's requests it is withdrawing.
 */
export function pluginAppCancelParse(
    raw: unknown,
): { origin: string; requestId: string } | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as { origin?: unknown; requestId?: unknown };
    if (typeof value.origin !== "string" || pluginOriginHost(value.origin) === undefined)
        return undefined;
    if (typeof value.requestId !== "string" || !value.requestId) return undefined;
    return { origin: value.origin, requestId: value.requestId };
}

/**
 * Validates one request the window forwarded from a mounted application.
 *
 * The window relays what the page asked for, but nothing here trusts the page:
 * the origin is the one the browser stamped on the message, and every operation
 * is checked into a closed set with the exact arguments it takes. An unknown
 * operation, a missing key, or a missing origin is refused before any of it
 * reaches the daemon.
 */
export function pluginAppRequestParse(
    raw: unknown,
): { origin: string; requestId: string; request: DesktopPluginAppRequest } | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as { origin?: unknown; request?: unknown; requestId?: unknown };
    if (typeof value.origin !== "string" || pluginOriginHost(value.origin) === undefined)
        return undefined;
    if (typeof value.requestId !== "string" || !value.requestId) return undefined;
    if (!value.request || typeof value.request !== "object") return undefined;
    const request = value.request as Record<string, unknown>;
    const key = typeof request.key === "string" && request.key ? request.key : undefined;
    switch (request.kind) {
        case "toolCall":
            return typeof request.name === "string" && request.name
                ? {
                      origin: value.origin,
                      requestId: value.requestId,
                      request: {
                          kind: "toolCall",
                          name: request.name,
                          arguments: request.arguments,
                      },
                  }
                : undefined;
        case "resourceRead":
            return typeof request.uri === "string" && request.uri
                ? {
                      origin: value.origin,
                      requestId: value.requestId,
                      request: { kind: "resourceRead", uri: request.uri },
                  }
                : undefined;
        case "storageGet":
            return key
                ? {
                      origin: value.origin,
                      requestId: value.requestId,
                      request: { kind: "storageGet", key },
                  }
                : undefined;
        case "storageSet":
            return key
                ? {
                      origin: value.origin,
                      requestId: value.requestId,
                      request: { kind: "storageSet", key, value: request.value },
                  }
                : undefined;
        case "storageDelete":
            return key
                ? {
                      origin: value.origin,
                      requestId: value.requestId,
                      request: { kind: "storageDelete", key },
                  }
                : undefined;
        case "storageList":
            return {
                origin: value.origin,
                requestId: value.requestId,
                request: { kind: "storageList" },
            };
        default:
            return undefined;
    }
}
