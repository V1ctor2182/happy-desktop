import { randomBytes } from "node:crypto";
import type {
    LocalPlugin,
    PluginApp,
    PluginsState,
    RigPluginsConnection,
} from "@slopus/rig-connect";
import type {
    DesktopPluginApplication,
    DesktopPluginCatalog,
    DesktopPluginConnectionState,
    DesktopPluginInventory,
    DesktopPluginPackage,
    DesktopPluginPackageFailure,
} from "../shared/desktopContract";
import { happyPluginScheme } from "../shared/desktopContract";

/**
 * Opens the one plugin subscription this process keeps. It is a dependency so
 * the cache can be exercised against a scripted daemon; nothing about the real
 * connection is assumed beyond this contract.
 */
export type PluginApplicationConnect = (options: {
    onChange: (
        apps: readonly PluginApp[],
        plugins: readonly LocalPlugin[],
        state: PluginsState,
    ) => void;
    onError?: (error: unknown) => void;
}) => RigPluginsConnection;

/** One cached resource, already verified against the size and type it declared. */
interface CachedResource {
    readonly body: Uint8Array;
    readonly mediaType: string;
    /** The `ui://` URI the plugin declared this resource under. */
    readonly uri: string;
}

/**
 * One generation's bundle. The entry object's own identity is the guard against
 * a late prefetch or a late call landing on a generation that has since been
 * replaced: every asynchronous step re-reads the map and compares.
 */
interface BundleEntry {
    /** The daemon's newest description of this exact generation. */
    app: PluginApp;
    readonly controller: AbortController;
    readonly originHost: string;
    /** Cached bytes by normalized bundle path. */
    readonly resources: Map<string, CachedResource>;
    error?: string;
    status: "loading" | "ready" | "error";
}

export interface PluginApplicationCacheOptions {
    readonly connect: PluginApplicationConnect;
    /** Announces a new catalog projection. Called only when something changed. */
    readonly onChange: (catalog: DesktopPluginCatalog) => void;
    /**
     * Announces a new inventory projection. It is only ever called while someone
     * is following, which is what keeps a window that is not looking at the
     * catalog from paying to project, clone, and deliver it.
     */
    readonly onInventoryChange?: (inventory: DesktopPluginInventory) => void;
    /** Opaque per-generation host factory; overridden by tests for determinism. */
    readonly originHostCreate?: () => string;
}

export interface PluginApplicationResourceAnswer {
    readonly body: Uint8Array;
    readonly mediaType: string;
}

/** How the main process addresses a mounted view when it asks for something. */
export interface PluginApplicationOrigin {
    readonly applicationId: string;
    readonly generation: string;
}

const KEY_SEPARATOR = "\u0000";

function entryKey(applicationId: string, generation: string): string {
    return `${applicationId}${KEY_SEPARATOR}${generation}`;
}

/**
 * Normalizes a request path onto the exact path a plugin declared. Bundles are
 * addressed relatively, so `/app.js`, `app.js`, and `./app.js` are one resource;
 * anything that climbs out of the bundle is not a resource at all.
 */
export function pluginResourcePathNormalize(value: string): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(value);
    } catch {
        return undefined;
    }
    const segments: string[] = [];
    for (const segment of decoded.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") return undefined;
        segments.push(segment);
    }
    return segments.length === 0 ? undefined : segments.join("/");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A daemon refusal that means this generation no longer exists. Rig answers
 * stale resource and tool requests with its own message rather than a code, so
 * the retirement rule is expressed once here instead of at every call site.
 */
function staleGeneration(error: unknown): boolean {
    return /stale|no longer|not (the )?current|generation/iu.test(errorMessage(error));
}

/** Whether a declared media type is carried as text rather than base64 bytes. */
function textMediaType(mediaType: string): boolean {
    return (
        mediaType.startsWith("text/") ||
        mediaType === "application/json" ||
        mediaType === "image/svg+xml" ||
        mediaType.endsWith("+json") ||
        mediaType.endsWith("+xml")
    );
}

/**
 * Every local plugin application this machine offers, with each generation's
 * complete bundle already in memory.
 *
 * The daemon endpoint and its token stay on this side: the cache is the only
 * thing that reads the plugin catalog, prefetches bundles, calls app-visible
 * tools, and reaches an application's stored values. A generation becomes
 * navigable only once its whole declared bundle has been loaded and is still
 * current, which is what makes a click mount instantly without reading
 * anything. A replaced, removed, or uninstalled generation is retired
 * immediately — its prefetch and calls abort, its bytes are dropped, and its
 * origin stops resolving — and is never retried.
 *
 * The vocabulary here is the daemon's finalized one: an application declares a
 * page, a flat list of `ui://` resources, and the MCP tools it may call itself.
 * Nothing above this class sees any of it; the window receives an identity and,
 * once the bundle is whole, one opaque origin to point a view at.
 */
export class PluginApplicationCache implements Disposable {
    readonly #entries = new Map<string, BundleEntry>();
    readonly #origins = new Map<string, BundleEntry>();
    readonly #onChange: (catalog: DesktopPluginCatalog) => void;
    readonly #onInventoryChange?: (inventory: DesktopPluginInventory) => void;
    readonly #originHostCreate: () => string;
    #catalog: DesktopPluginCatalog = {
        applications: [],
        connection: "connecting",
        loading: true,
    };
    /**
     * The last inventory projected, kept so an unchanged reading is the same
     * object and an announcement is only made for a real change. While nobody is
     * following it is only refreshed when someone asks.
     */
    #inventory: DesktopPluginInventory = {
        packages: [],
        failures: [],
        connection: "connecting",
        loading: true,
    };
    /**
     * Whether anything is reading the inventory. Nothing is projected, compared,
     * or announced while this is false: the packages are held as the daemon's own
     * objects and only become a renderer-shaped reading when a screen wants one.
     */
    #inventoryFollowed = false;
    /**
     * Whether an authoritative reading has ever arrived. A subscription that is
     * merely connecting has said nothing about what is installed, so "none" is
     * not a fact yet and the inventory reports itself as still loading. It never
     * goes back: once a machine has been read, a later gap is a stale reading
     * rather than an unread one.
     */
    #inventoryRead = false;
    #closed = false;
    /** Catalog order, which is the daemon's navigation order rather than the map's. */
    #order: readonly PluginApp[] = [];
    /**
     * The packages the daemon last described. They are held rather than derived
     * from the bundle entries because a package exists whether or not it
     * contributes an application, and a stopped package that contributes nothing
     * is exactly what the catalog screen is for.
     */
    #packages: readonly LocalPlugin[] = [];
    /** Folders the daemon reported it could not read as packages. */
    #failures: readonly DesktopPluginPackageFailure[] = [];
    /**
     * Where the inventory's own subscription is. It is tracked separately from
     * the application catalog's because the inventory may be projected at any
     * moment by a screen that has just opened, including while nothing is being
     * published at all.
     */
    #inventoryConnection: DesktopPluginConnectionState = "connecting";
    /**
     * The feed's last failure, in the daemon's own words. It is kept rather than
     * dropped so the screen reading this inventory can say why what it is showing
     * has stopped changing, and it is cleared by the next live catalog rather
     * than by a reconnect attempt, because a reconnect is not yet an answer.
     */
    #feedError?: string;
    readonly #connection: RigPluginsConnection;

    constructor(options: PluginApplicationCacheOptions) {
        this.#onChange = options.onChange;
        this.#onInventoryChange = options.onInventoryChange;
        this.#originHostCreate =
            options.originHostCreate ?? (() => randomBytes(16).toString("hex"));
        this.#connection = options.connect({
            onChange: (apps, plugins, state) => this.#reconcile(apps, plugins, state),
            onError: (error) => {
                this.#feedError = errorMessage(error);
                // A feed that failed has answered, in its way. Whatever it is, it
                // is not "still asking", so a screen stops waiting and says what
                // went wrong instead of showing a reading that is never coming.
                this.#inventoryRead = true;
                this.#publish();
                this.#publishInventory();
            },
        });
    }

    get(): DesktopPluginCatalog {
        return this.#catalog;
    }

    /**
     * The inventory as it stands, projected from the raw reading being held. It
     * is projected here rather than remembered from the last announcement,
     * because nothing is announced while nobody follows: a follower's opening
     * frame has to be built from what the daemon last said, not from whatever was
     * last sent to somebody else.
     */
    inventoryGet(): DesktopPluginInventory {
        const next: DesktopPluginInventory = {
            packages: this.#packages.map(projectPackage),
            failures: this.#failures,
            connection: this.#inventoryConnection,
            loading: !this.#inventoryRead,
            ...(this.#feedError === undefined ? {} : { error: this.#feedError }),
        };
        if (sameInventory(this.#inventory, next)) return this.#inventory;
        this.#inventory = next;
        return next;
    }

    /**
     * Starts or stops projecting the inventory. Following is reference-counted
     * above this, so this is only told the answer; it publishes nothing on the
     * way in, because whoever started following takes its opening frame from
     * `inventoryGet` in the same turn and would otherwise be told twice.
     */
    inventoryFollowSet(following: boolean): void {
        this.#inventoryFollowed = following;
    }

    /** The application one isolated origin belongs to, or nothing once it is retired. */
    originResolve(host: string): PluginApplicationOrigin | undefined {
        const entry = this.#origins.get(host);
        return entry
            ? { applicationId: entry.app.id, generation: entry.app.generation }
            : undefined;
    }

    /** Answers one request on a generation's own origin, entirely from memory. */
    resourceRead(host: string, path: string): PluginApplicationResourceAnswer | undefined {
        const entry = this.#origins.get(host);
        if (!entry) return undefined;
        const normalized = pluginResourcePathNormalize(path);
        if (normalized === undefined) return undefined;
        const resource = entry.resources.get(normalized);
        return resource ? { body: resource.body, mediaType: resource.mediaType } : undefined;
    }

    /**
     * Calls one MCP tool on behalf of a mounted application. Only a tool the
     * application declared as visible to itself may be called, and the server it
     * belongs to is read from that declaration rather than from the page, so a
     * View cannot reach a tool its plugin kept for the model.
     *
     * An application may compose several MCP servers, and two of them may each
     * offer a tool under the same name. `tools/call` names a tool and nothing
     * else, so such a call has no answer: choosing either server would be
     * choosing arbitrarily, and running the wrong one is a side effect nobody
     * asked for. The call is refused, naming the servers, rather than resolved
     * by position.
     */
    async toolCall(
        applicationId: string,
        generation: string,
        name: string,
        args: unknown,
        options?: { readonly signal?: AbortSignal },
    ): Promise<unknown> {
        const key = entryKey(applicationId, generation);
        const entry = this.#entries.get(key);
        if (!entry) throw new Error("That plugin application is no longer available.");
        this.#describe(entry);
        const offered = entry.app.tools.filter(
            (candidate) => candidate.name === name && candidate._meta.ui.visibility.includes("app"),
        );
        if (offered.length === 0)
            throw new Error("That tool is not offered to this plugin application.");
        if (offered.length > 1) {
            const servers = [...new Set(offered.map((candidate) => candidate.server))].sort();
            throw new Error(
                `More than one server offers a tool named '${name}' to this application (${servers.join(", ")}), so the call is ambiguous.`,
            );
        }
        const tool = offered[0]!;
        return this.#guard(key, entry, () =>
            this.#connection.callTool(entry.app, tool.server, name, args, {
                signal: this.#signal(entry, options),
            }),
        );
    }

    /**
     * Reads one resource an application declared, by its `ui://` URI. A resource
     * whose bytes are already cached is answered from memory, because the whole
     * bundle was loaded before the application became navigable; anything else
     * goes to the daemon, which is the authority on what this generation
     * declared.
     */
    async resourceReadByUri(
        applicationId: string,
        generation: string,
        uri: string,
        options?: { readonly signal?: AbortSignal },
    ): Promise<unknown> {
        const key = entryKey(applicationId, generation);
        const entry = this.#entries.get(key);
        if (!entry) throw new Error("That plugin application is no longer available.");
        for (const resource of entry.resources.values())
            if (resource.uri === uri)
                return {
                    contents: [
                        {
                            uri,
                            mimeType: resource.mediaType,
                            ...(textMediaType(resource.mediaType)
                                ? { text: Buffer.from(resource.body).toString("utf8") }
                                : { blob: Buffer.from(resource.body).toString("base64") }),
                        },
                    ],
                };
        return this.#guard(key, entry, () =>
            this.#connection.readResource(entry.app, uri, { signal: this.#signal(entry, options) }),
        );
    }

    /**
     * Reads one value this application stored, or nothing when it stored none.
     *
     * The daemon's storage calls take no cancellation of their own, so a
     * withdrawn one is abandoned here: the answer is dropped and the caller is
     * told the request was cancelled. The write itself is not undone, which is
     * the honest outcome — a store that has already happened has happened.
     */
    async storageGet(
        applicationId: string,
        generation: string,
        key: string,
        options?: { readonly signal?: AbortSignal },
    ): Promise<unknown> {
        const entryReference = entryKey(applicationId, generation);
        const entry = this.#entryRequire(entryReference);
        return this.#abandonable(
            entry,
            options,
            this.#guard(entryReference, entry, () => this.#connection.storageGet(entry.app, key)),
        );
    }

    async storageSet(
        applicationId: string,
        generation: string,
        key: string,
        value: unknown,
        options?: { readonly signal?: AbortSignal },
    ): Promise<void> {
        const entryReference = entryKey(applicationId, generation);
        const entry = this.#entryRequire(entryReference);
        await this.#abandonable(
            entry,
            options,
            this.#guard(entryReference, entry, () =>
                this.#connection.storageSet(entry.app, key, value),
            ),
        );
    }

    async storageDelete(
        applicationId: string,
        generation: string,
        key: string,
        options?: { readonly signal?: AbortSignal },
    ): Promise<void> {
        const entryReference = entryKey(applicationId, generation);
        const entry = this.#entryRequire(entryReference);
        await this.#abandonable(
            entry,
            options,
            this.#guard(entryReference, entry, () =>
                this.#connection.storageDelete(entry.app, key),
            ),
        );
    }

    async storageList(
        applicationId: string,
        generation: string,
        options?: { readonly signal?: AbortSignal },
    ): Promise<readonly string[]> {
        const entryReference = entryKey(applicationId, generation);
        const entry = this.#entryRequire(entryReference);
        return this.#abandonable(
            entry,
            options,
            this.#guard(entryReference, entry, () => this.#connection.storageList(entry.app)),
        );
    }

    [Symbol.dispose](): void {
        if (this.#closed) return;
        this.#closed = true;
        for (const [key, entry] of this.#entries) this.#retire(key, entry, false);
        this.#connection.close();
        this.#catalog = { applications: [], connection: "closed", loading: false };
        this.#onChange(this.#catalog);
        this.#inventoryConnection = "closed";
        this.#inventoryRead = true;
        this.#inventory = { packages: [], failures: [], connection: "closed", loading: false };
        if (this.#inventoryFollowed) this.#onInventoryChange?.(this.#inventory);
    }

    /**
     * The signal one daemon call runs under: the caller's own, if it brought
     * one, together with this generation's. They are different lifetimes — a
     * View withdrawing one request says nothing about the rest, while retiring a
     * generation ends all of them — so both must be able to stop the call.
     */
    #signal(entry: BundleEntry, options?: { readonly signal?: AbortSignal }): AbortSignal {
        const caller = options?.signal;
        if (!caller) return entry.controller.signal;
        return AbortSignal.any([caller, entry.controller.signal]);
    }

    /**
     * Settles as soon as either the work finishes or the caller withdraws it,
     * for a daemon call that cannot itself be cancelled. The underlying call is
     * left to finish on its own; only the answer is dropped.
     */
    async #abandonable<Value>(
        entry: BundleEntry,
        options: { readonly signal?: AbortSignal } | undefined,
        work: Promise<Value>,
    ): Promise<Value> {
        const signal = this.#signal(entry, options);
        if (!signal.aborted && options?.signal === undefined) return work;
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                if (signal.aborted) {
                    reject(new Error("The request was cancelled."));
                    return;
                }
                signal.addEventListener(
                    "abort",
                    () => reject(new Error("The request was cancelled.")),
                    { once: true },
                );
            }),
        ]);
    }

    #entryRequire(key: string): BundleEntry {
        const entry = this.#entries.get(key);
        if (!entry) throw new Error("That plugin application is no longer available.");
        return entry;
    }

    /**
     * Runs one daemon call for a mounted generation. The daemon is the authority
     * on which generation is current, so being told this one is stale retires the
     * view rather than retrying it.
     */
    async #guard<Value>(
        key: string,
        entry: BundleEntry,
        run: () => Promise<Value>,
    ): Promise<Value> {
        try {
            return await run();
        } catch (error) {
            if (staleGeneration(error) && this.#entries.get(key) === entry)
                this.#retire(key, entry);
            throw error;
        }
    }

    /**
     * Re-reads the daemon's description of a generation already held. The bytes
     * of a generation never change, but what it says about itself does: the
     * catalog names a generation as soon as its bundle exists and only lists the
     * tools it may call once its plugin is up. A view that mounts in that gap
     * would otherwise be told a tool it owns is not offered to it.
     */
    #describe(entry: BundleEntry): void {
        const described = this.#connection
            .apps()
            .find((app) => app.id === entry.app.id && app.generation === entry.app.generation);
        if (described) entry.app = described;
    }

    #reconcile(
        apps: readonly PluginApp[],
        plugins: readonly LocalPlugin[],
        state: PluginsState,
    ): void {
        if (this.#closed) return;
        // A subscription that is not live has nothing to say about what is
        // installed, so a gap keeps every cached generation rather than retiring
        // views that the resumed catalog is about to confirm unchanged. Only how
        // the feed is doing is passed on while it is away.
        if (state.connection !== "live") {
            this.#inventoryConnection = state.connection;
            this.#publish(state.connection);
            this.#publishInventory();
            return;
        }
        this.#order = apps;
        this.#packages = plugins;
        this.#failures = state.failures.map((failure) => ({
            error: failure.error,
            folder: failure.pluginId,
        }));
        // A live catalog is the answer the last failure was waiting for, and the
        // first one is the moment this machine has actually been read.
        this.#feedError = undefined;
        this.#inventoryConnection = "live";
        this.#inventoryRead = true;
        const live = new Set(apps.map((app) => entryKey(app.id, app.generation)));
        // Anything the catalog stopped naming is gone: an uninstall, a stopped
        // plugin, or a replacement that arrived under a new generation.
        for (const [key, entry] of this.#entries)
            if (!live.has(key)) this.#retire(key, entry, false);
        for (const app of apps) {
            const key = entryKey(app.id, app.generation);
            const known = this.#entries.get(key);
            // A generation is fixed code, but the daemon keeps describing it
            // while the plugin comes up: the tools an application may call
            // itself arrive after the catalog first names the generation. The
            // newest description replaces the one the entry was created with,
            // and its cached bytes and its origin stay exactly as they are.
            if (known) {
                known.app = app;
                continue;
            }
            const entry: BundleEntry = {
                app,
                controller: new AbortController(),
                originHost: this.#originHostCreate(),
                resources: new Map(),
                status: "loading",
            };
            this.#entries.set(key, entry);
            this.#origins.set(entry.originHost, entry);
            void this.#prefetch(key, entry);
        }
        this.#publish(state.connection);
        this.#publishInventory();
    }

    /**
     * Loads the whole declared bundle before the application is offered. Every
     * resource is bounded by the daemon and the set is small, so they are read
     * together; one failure abandons the bundle rather than publishing a view
     * that would break on its first missing script.
     */
    async #prefetch(key: string, entry: BundleEntry): Promise<void> {
        try {
            const loaded = await Promise.all(
                entry.app.resources.map(async (resource) => {
                    const answer = await this.#connection.readResource(entry.app, resource.uri, {
                        signal: entry.controller.signal,
                    });
                    return { resource, body: resourceBody(answer, resource.uri) };
                }),
            );
            // The catalog may have replaced this generation while the bundle was
            // in flight; the bytes belong to whatever is in the map now.
            if (this.#entries.get(key) !== entry) return;
            for (const { resource, body } of loaded) {
                const normalized = pluginResourcePathNormalize(resource.path);
                if (normalized === undefined) continue;
                entry.resources.set(normalized, {
                    body,
                    mediaType: resource.mimeType,
                    uri: resource.uri,
                });
            }
            if (pluginApplicationEntryPath(entry.app) === undefined)
                throw new Error("This application declared no page to open.");
            entry.status = "ready";
        } catch (error) {
            if (entry.controller.signal.aborted) return;
            if (this.#entries.get(key) !== entry) return;
            entry.status = "error";
            entry.error = errorMessage(error);
        }
        this.#publish();
    }

    /**
     * Drops one generation completely: its prefetch and any call in flight are
     * aborted, its bytes are released, and its origin stops resolving, so a view
     * that is still on screen fails closed instead of showing replaced code.
     */
    #retire(key: string, entry: BundleEntry, publish = true): void {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        this.#origins.delete(entry.originHost);
        entry.resources.clear();
        entry.controller.abort();
        if (publish) this.#publish();
    }

    #publish(connection?: DesktopPluginConnectionState): void {
        if (this.#closed) return;
        const next: DesktopPluginCatalog = {
            applications: this.#order.flatMap((app) => {
                const entry = this.#entries.get(entryKey(app.id, app.generation));
                return entry ? [projectApplication(entry)] : [];
            }),
            connection: connection ?? this.#catalog.connection,
            loading: false,
        };
        if (sameCatalog(this.#catalog, next)) return;
        this.#catalog = next;
        this.#onChange(next);
    }

    /**
     * Publishes what is installed, which is a different reading from what is
     * navigable and changes on its own schedule. The packages held are published
     * whatever the connection is doing: a package does not stop being installed
     * because the subscription dropped, and a screen that replaced them with an
     * error would be claiming the machine had been emptied.
     */
    #publishInventory(): void {
        if (this.#closed || !this.#inventoryFollowed || !this.#onInventoryChange) return;
        const previous = this.#inventory;
        const next = this.inventoryGet();
        if (next === previous) return;
        this.#onInventoryChange(next);
    }
}

/**
 * The bundle path a generation opens at: the declared resource carrying the
 * application's page. It is resolved from the page's own URI rather than from
 * the page string, so an application is navigable only when the exact resource
 * it names was declared.
 */
export function pluginApplicationEntryPath(app: PluginApp): string | undefined {
    const declared =
        app.resources.find((resource) => resource.uri === app.resourceUri) ??
        app.resources.find((resource) => resource.path === app.page);
    return declared ? pluginResourcePathNormalize(declared.path) : undefined;
}

/** The bytes one `resources/read` answer carries, whichever way it carried them. */
function resourceBody(answer: { contents: readonly unknown[] }, uri: string): Uint8Array {
    for (const raw of answer.contents) {
        const content = raw as { blob?: string; text?: string; uri?: string };
        if (content.uri !== undefined && content.uri !== uri) continue;
        if (typeof content.text === "string")
            return new Uint8Array(Buffer.from(content.text, "utf8"));
        if (typeof content.blob === "string")
            return new Uint8Array(Buffer.from(content.blob, "base64"));
    }
    throw new Error(`Rig returned no contents for ${uri}.`);
}

function projectApplication(entry: BundleEntry): DesktopPluginApplication {
    const app = entry.app;
    const path = pluginApplicationEntryPath(app);
    return {
        generation: app.generation,
        id: app.id,
        label: app.sidebar.label,
        order: app.sidebar.order,
        pluginId: app.pluginId,
        status: entry.status,
        title: app.title,
        ...(entry.error === undefined ? {} : { error: entry.error }),
        ...(entry.status === "ready" && path !== undefined
            ? {
                  source: `${happyPluginScheme}://${entry.originHost}/${path
                      .split("/")
                      .map(encodeURIComponent)
                      .join("/")}`,
              }
            : {}),
    };
}

/**
 * One package as the renderer may see it: what the daemon said about it, minus
 * everything that belongs on this side of the boundary, plus the labels of the
 * applications it declared. Those labels are read from the package's own
 * description, so an inventory frame is complete on arrival and never has to be
 * joined against the application catalog.
 */
function projectPackage(plugin: LocalPlugin): DesktopPluginPackage {
    return {
        contributions: plugin.apps.map((app) => app.sidebar.label),
        dataDirectory: plugin.dataDirectory,
        description: plugin.description,
        directory: plugin.directory,
        id: plugin.id,
        logAvailable: plugin.logAvailable,
        name: plugin.name,
        status: plugin.status,
        version: plugin.version,
        ...(plugin.error === undefined ? {} : { error: plugin.error }),
        ...(plugin.statusMessage === undefined ? {} : { statusMessage: plugin.statusMessage }),
    };
}

function sameCatalog(left: DesktopPluginCatalog, right: DesktopPluginCatalog): boolean {
    return (
        left.connection === right.connection &&
        left.loading === right.loading &&
        left.applications.length === right.applications.length &&
        left.applications.every((application, index) =>
            sameApplication(application, right.applications[index]!),
        )
    );
}

function sameInventory(left: DesktopPluginInventory, right: DesktopPluginInventory): boolean {
    return (
        left.connection === right.connection &&
        left.loading === right.loading &&
        left.error === right.error &&
        left.packages.length === right.packages.length &&
        left.packages.every((entry, index) => samePackage(entry, right.packages[index]!)) &&
        left.failures.length === right.failures.length &&
        left.failures.every((failure, index) => sameFailure(failure, right.failures[index]!))
    );
}

function samePackage(left: DesktopPluginPackage, right: DesktopPluginPackage): boolean {
    return (
        left.id === right.id &&
        left.name === right.name &&
        left.version === right.version &&
        left.description === right.description &&
        left.status === right.status &&
        left.statusMessage === right.statusMessage &&
        left.error === right.error &&
        left.directory === right.directory &&
        left.dataDirectory === right.dataDirectory &&
        left.logAvailable === right.logAvailable &&
        left.contributions.length === right.contributions.length &&
        left.contributions.every((label, index) => label === right.contributions[index])
    );
}

function sameFailure(
    left: DesktopPluginPackageFailure,
    right: DesktopPluginPackageFailure,
): boolean {
    return left.folder === right.folder && left.error === right.error;
}

function sameApplication(left: DesktopPluginApplication, right: DesktopPluginApplication): boolean {
    return (
        left.id === right.id &&
        left.generation === right.generation &&
        left.label === right.label &&
        left.order === right.order &&
        left.pluginId === right.pluginId &&
        left.status === right.status &&
        left.title === right.title &&
        left.error === right.error &&
        left.source === right.source
    );
}
