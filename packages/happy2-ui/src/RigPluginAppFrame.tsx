import { useEffectEvent, useLayoutEffect, useRef } from "react";
import {
    McpAppErrorCode,
    McpAppMethod,
    MCP_APP_PROTOCOL_VERSION,
    SUPPORTED_MCP_APP_PROTOCOL_VERSIONS,
    isJsonRpcMessage,
    isJsonRpcRequest,
    jsonRpcError,
    jsonRpcNotification,
    jsonRpcResult,
    type JsonRpcRequest,
} from "./mcpAppProtocol";
import { localeContext, resolveStyleVariables, resolveTheme } from "./mcpAppHostContext";

/**
 * The vendor methods this host adds to the standard dialect: durable key/value
 * storage scoped to the calling application by the host. They are namespaced
 * under Happy's own reverse-DNS identifier exactly as the specification requires
 * of a host extension, so a View can feature-detect them and no standard method
 * name is redefined.
 */
export const RigPluginAppMethod = {
    storageDelete: "io.slopus.happy/storage/delete",
    storageGet: "io.slopus.happy/storage/get",
    storageList: "io.slopus.happy/storage/list",
    storageSet: "io.slopus.happy/storage/set",
} as const;

/**
 * The reverse-DNS name this host's storage extension is announced under.
 *
 * `hostCapabilities` is a closed shape in the published extension schema — it
 * validates no vendor key of its own — so a host that offers something beyond
 * the standard set says so with the schema's own `experimental` flag and names
 * what it is in the initialize result's `_meta`, which is exactly where MCP puts
 * namespaced metadata and which the schema leaves open. A View feature-detects
 * this extension by looking for this key in `_meta`.
 */
export const RIG_PLUGIN_APP_STORAGE_EXTENSION = "io.slopus.happy/storage";

/** Everything a host operation may need beyond its own arguments. */
export interface RigPluginAppRequestOptions {
    /**
     * Aborted when the View withdraws the request with
     * `notifications/cancelled`, or when this frame is torn down. The work
     * behind it should stop; nothing is sent back for a withdrawn request.
     */
    readonly signal: AbortSignal;
}

export interface RigPluginAppFrameProps {
    /**
     * Address of the isolated origin the host already filled with this
     * generation's whole bundle. Its origin is also the frame's authority: every
     * message is accepted only from this exact origin and answered only to it.
     */
    source: string;
    /** iframe `title` for assistive technology. */
    title: string;
    /** Runs one app-visible tool this application declared, by its MCP name. */
    toolCall(
        name: string,
        args: Readonly<Record<string, unknown>>,
        options: RigPluginAppRequestOptions,
    ): Promise<Record<string, unknown>>;
    /** Reads one resource this application declared, by its `ui://` URI. */
    resourceRead(
        uri: string,
        options: RigPluginAppRequestOptions,
    ): Promise<Record<string, unknown>>;
    /** Reads one value this application stored, or nothing when it stored none. */
    storageGet(key: string, options: RigPluginAppRequestOptions): Promise<unknown>;
    storageSet(key: string, value: unknown, options: RigPluginAppRequestOptions): Promise<void>;
    storageDelete(key: string, options: RigPluginAppRequestOptions): Promise<void>;
    storageList(options: RigPluginAppRequestOptions): Promise<readonly string[]>;
}

/**
 * The `ui/initialize` result this host answers with, built from one reading of
 * the surface the View was mounted in.
 *
 * It is a plain function of that context so the exact object a View receives can
 * be checked against the published extension schema rather than described twice.
 */
export function rigPluginAppInitializeResult(
    hostContext: Record<string, unknown>,
): Record<string, unknown> {
    return {
        protocolVersion: MCP_APP_PROTOCOL_VERSION,
        hostInfo: { name: "Happy plugin application host", version: "1.0.0" },
        hostCapabilities: {
            serverTools: {},
            serverResources: {},
            // The standard flag that this host offers something beyond the
            // published set; what that something is belongs in `_meta`, where a
            // reverse-DNS name is allowed to live.
            experimental: {},
        },
        hostContext,
        _meta: { [RIG_PLUGIN_APP_STORAGE_EXTENSION]: { version: 1 } },
    };
}

/** Everything about one mounted View that survives between messages. */
interface FrameState {
    disposed: boolean;
    /** A valid, supported `ui/initialize` request has been answered. */
    initializeAnswered: boolean;
    /** The View has completed the handshake with `ui/notifications/initialized`. */
    initializedByView: boolean;
    /**
     * One controller per request still in flight, by its JSON-RPC id.
     *
     * This is deliberately per request rather than per generation: a View that
     * withdraws one slow tool call is not saying anything about its other
     * requests, and retiring a generation is a separate lifetime that aborts
     * everything at once further down. An id is removed as soon as its request
     * settles, so nothing accumulates across a long-lived View.
     */
    readonly inFlight: Map<string | number, AbortController>;
    /** The last host context delivered, so an unchanged appearance is not resent. */
    sentContextKey: string;
}

/**
 * RigPluginAppFrame — the MCP Apps host half for a locally installed plugin's
 * own application.
 *
 * The View is a whole bundle served by the shell on one opaque, isolated origin,
 * so this frame speaks to it exactly as the specification says a host does: raw
 * JSON-RPC 2.0 objects over `postMessage`, with no injected global, no library
 * inside the guest, and nothing about Happy reachable from it. Which application
 * is talking is the frame's own committed origin — the browser sets it and a
 * page cannot choose it — so authority is never read from a message body.
 *
 * The handshake is the spec's: the View sends `ui/initialize`, receives the host
 * capabilities and the first host context, and only after its
 * `ui/notifications/initialized` may it call anything privileged. `tools/call`
 * and `resources/read` are the standard MCP methods, forwarded to the shell,
 * which is the only side that holds the daemon. Storage is a declared vendor
 * extension rather than a redefined standard method.
 *
 * A generation is a lifetime: the owner remounts this component when the code
 * behind an application is replaced, so a View is never navigated from one
 * generation onto another.
 */
export function RigPluginAppFrame(props: RigPluginAppFrameProps) {
    const frame = useRef<HTMLIFrameElement | null>(null);
    const state = useRef<FrameState>({
        disposed: false,
        inFlight: new Map<string | number, AbortController>(),
        initializeAnswered: false,
        initializedByView: false,
        sentContextKey: "",
    });

    const receive = useEffectEvent((event: MessageEvent) => {
        const element = frame.current;
        if (!element || state.current.disposed) return;
        // Both checks are required: the origin proves which application sent it,
        // and the source window proves it is this mounted View rather than
        // another frame that happens to run the same generation's code.
        if (event.source !== element.contentWindow) return;
        if (event.origin !== originOf(props.source)) return;
        const message: unknown = event.data;
        if (!isJsonRpcMessage(message)) return;
        if (isJsonRpcRequest(message)) {
            void handleRequest(props, element, state.current, message);
            return;
        }
        if (message.method === McpAppMethod.cancelled) {
            requestCancel(state.current, message.params);
            return;
        }
        if (message.method !== McpAppMethod.initialized) return;
        // Only a View that already received a valid initialize result may
        // complete the handshake, and only once.
        if (!state.current.initializeAnswered || state.current.initializedByView) return;
        state.current.initializedByView = true;
    });

    const contextPublish = useEffectEvent(() => {
        const element = frame.current;
        if (!element || state.current.disposed || !state.current.initializedByView) return;
        const context = hostContext(element);
        const key = JSON.stringify(context);
        if (key === state.current.sentContextKey) return;
        state.current.sentContextKey = key;
        post(element, props.source, jsonRpcNotification(McpAppMethod.hostContextChanged, context));
    });

    // Imperative browser integration: a View is a foreign document reached only
    // through window messages, and the theme it must be told about is observable
    // only from the committed frame's own ancestry. Both are attached here and
    // both are torn down completely.
    // eslint-disable-next-line happy2-react/no-layout-effect -- a cross-origin View can only be spoken to through the committed frame's window, and its host context follows a DOM theme change no render observes
    useLayoutEffect(() => {
        const current = state.current;
        current.disposed = false;
        const listener = (event: MessageEvent) => receive(event);
        window.addEventListener("message", listener);
        // A ThemeScope toggles its class on a single ancestor of the frame, so a
        // theme change is a mutation on that element rather than a new render.
        const scope =
            frame.current?.closest(
                ".happy2-theme-scope, .happy2-theme-dark, .happy2-theme-light",
            ) ?? undefined;
        const observer = scope ? new MutationObserver(() => contextPublish()) : undefined;
        observer?.observe(scope!, { attributeFilter: ["class"], attributes: true });
        const media = window.matchMedia?.("(prefers-color-scheme: dark)");
        const systemThemeChanged = () => contextPublish();
        media?.addEventListener("change", systemThemeChanged);
        return () => {
            current.disposed = true;
            current.initializeAnswered = false;
            current.initializedByView = false;
            current.sentContextKey = "";
            // The View this work was for is gone, so every request still in
            // flight is withdrawn rather than left running against a frame that
            // can no longer be answered.
            for (const controller of current.inFlight.values()) controller.abort();
            current.inFlight.clear();
            window.removeEventListener("message", listener);
            observer?.disconnect();
            media?.removeEventListener("change", systemThemeChanged);
        };
    }, []);

    return (
        <iframe
            className="happy2-rig-plugin-app-frame"
            data-happy2-ui="rig-plugin-app-frame"
            ref={frame}
            // The bundle already lives on an origin of its own, so the sandbox is
            // what takes away everything beyond running that code: no top-level
            // navigation, no popups, no downloads, and no form submission.
            sandbox="allow-scripts allow-same-origin"
            src={props.source}
            title={props.title}
        />
    );
}

/** The exact origin a bundle address belongs to, which is the frame's authority. */
function originOf(source: string): string {
    try {
        return new URL(source).origin;
    } catch {
        return "";
    }
}

function post(frame: HTMLIFrameElement, source: string, payload: object): void {
    frame.contentWindow?.postMessage(payload, originOf(source));
}

function respond(
    frame: HTMLIFrameElement,
    state: FrameState,
    source: string,
    id: string | number,
    result: unknown,
): void {
    if (state.disposed) return;
    post(frame, source, jsonRpcResult(id, result));
}

function fail(
    frame: HTMLIFrameElement,
    state: FrameState,
    source: string,
    id: string | number,
    code: number,
    message: string,
): void {
    if (state.disposed) return;
    post(frame, source, jsonRpcError(id, code, message));
}

/**
 * Handles one View request. `ui/initialize` and `ping` are always available;
 * everything else is refused until the View has completed its handshake, so a
 * page cannot reach the daemon by skipping it.
 */
async function handleRequest(
    props: RigPluginAppFrameProps,
    frame: HTMLIFrameElement,
    state: FrameState,
    request: JsonRpcRequest,
): Promise<void> {
    const { id, method, params } = request;
    const source = props.source;
    if (method === McpAppMethod.initialize) {
        const version = initializeVersion(params);
        if (version === undefined)
            return fail(
                frame,
                state,
                source,
                id,
                McpAppErrorCode.invalidParams,
                "Invalid ui/initialize params",
            );
        if (!SUPPORTED_MCP_APP_PROTOCOL_VERSIONS.includes(version))
            return fail(
                frame,
                state,
                source,
                id,
                McpAppErrorCode.unsupportedProtocol,
                `Unsupported MCP Apps protocol version ${version}`,
            );
        state.initializeAnswered = true;
        const context = hostContext(frame);
        state.sentContextKey = JSON.stringify(context);
        return respond(frame, state, source, id, rigPluginAppInitializeResult(context));
    }
    if (method === McpAppMethod.ping) return respond(frame, state, source, id, {});
    if (!state.initializedByView)
        return fail(
            frame,
            state,
            source,
            id,
            McpAppErrorCode.notInitialized,
            `'${method}' received before ui/notifications/initialized`,
        );
    if (method === McpAppMethod.toolsCall) {
        const call = toolCallParams(params);
        if (!call)
            return fail(
                frame,
                state,
                source,
                id,
                McpAppErrorCode.invalidParams,
                "Invalid tools/call params",
            );
        return proxy(frame, state, source, id, (options) =>
            props.toolCall(call.name, call.arguments, options),
        );
    }
    if (method === McpAppMethod.resourcesRead) {
        const uri = stringParam(params, "uri");
        if (uri === undefined)
            return fail(
                frame,
                state,
                source,
                id,
                McpAppErrorCode.invalidParams,
                "Invalid resources/read params",
            );
        return proxy(frame, state, source, id, (options) => props.resourceRead(uri, options));
    }
    if (method === RigPluginAppMethod.storageGet) {
        const key = stringParam(params, "key");
        if (key === undefined) return failStorageKey(frame, state, source, id);
        return proxy(frame, state, source, id, async (options) => ({
            value: await props.storageGet(key, options),
        }));
    }
    if (method === RigPluginAppMethod.storageSet) {
        const key = stringParam(params, "key");
        if (key === undefined) return failStorageKey(frame, state, source, id);
        const value = (params as { value?: unknown }).value;
        return proxy(frame, state, source, id, async (options) => {
            await props.storageSet(key, value, options);
            return {};
        });
    }
    if (method === RigPluginAppMethod.storageDelete) {
        const key = stringParam(params, "key");
        if (key === undefined) return failStorageKey(frame, state, source, id);
        return proxy(frame, state, source, id, async (options) => {
            await props.storageDelete(key, options);
            return {};
        });
    }
    if (method === RigPluginAppMethod.storageList)
        return proxy(frame, state, source, id, async (options) => ({
            keys: await props.storageList(options),
        }));
    fail(frame, state, source, id, McpAppErrorCode.methodNotFound, `Unknown method ${method}`);
}

function failStorageKey(
    frame: HTMLIFrameElement,
    state: FrameState,
    source: string,
    id: string | number,
): void {
    fail(frame, state, source, id, McpAppErrorCode.invalidParams, "A storage key is required");
}

/**
 * Runs one host operation on behalf of a View request and answers it exactly
 * once.
 *
 * The request owns an abort controller of its own for as long as it is in
 * flight. A withdrawn request is answered with nothing at all — the View has
 * said it is not listening, and JSON-RPC has no response for a request nobody
 * awaits — while a request that simply failed is answered with an error.
 */
async function proxy(
    frame: HTMLIFrameElement,
    state: FrameState,
    source: string,
    id: string | number,
    run: (options: RigPluginAppRequestOptions) => Promise<unknown>,
): Promise<void> {
    const controller = new AbortController();
    state.inFlight.set(id, controller);
    try {
        const result = await run({ signal: controller.signal });
        if (controller.signal.aborted) return;
        respond(frame, state, source, id, result);
    } catch (error) {
        if (controller.signal.aborted) return;
        fail(
            frame,
            state,
            source,
            id,
            McpAppErrorCode.upstreamFailed,
            error instanceof Error ? error.message : "The request failed.",
        );
    } finally {
        // Only if this request still owns the entry: an id the View reused after
        // withdrawing the first one belongs to the newer request.
        if (state.inFlight.get(id) === controller) state.inFlight.delete(id);
    }
}

/**
 * Withdraws one request the View no longer wants. An id that named nothing is
 * ignored, as the specification requires of a race between a cancellation and
 * the response it crossed.
 */
function requestCancel(state: FrameState, params: unknown): void {
    if (!params || typeof params !== "object") return;
    const requestId = (params as { requestId?: unknown }).requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") return;
    const controller = state.inFlight.get(requestId);
    if (!controller) return;
    state.inFlight.delete(requestId);
    controller.abort();
}

/**
 * The host context a plugin application sees. It fills the window rather than
 * sitting inside a message, so `fullscreen` is both the current mode and the
 * only one offered; the theme and the standard style variables come from the
 * live tokens the frame itself inherits.
 */
function hostContext(frame: HTMLIFrameElement): Record<string, unknown> {
    const theme = resolveTheme(frame);
    const styles = resolveStyleVariables(frame);
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    return {
        displayMode: "fullscreen",
        availableDisplayModes: ["fullscreen"],
        platform: "desktop",
        deviceCapabilities: { touch: false, hover: true },
        ...(width > 0 && height > 0 ? { containerDimensions: { width, height } } : {}),
        ...(theme ? { theme } : {}),
        ...(styles ? { styles: { variables: styles } } : {}),
        ...localeContext(),
    };
}

function initializeVersion(params: unknown): string | undefined {
    if (!params || typeof params !== "object") return undefined;
    const record = params as Record<string, unknown>;
    if (typeof record.protocolVersion !== "string" || !record.protocolVersion) return undefined;
    if (!record.appInfo || typeof record.appInfo !== "object") return undefined;
    if (!record.appCapabilities || typeof record.appCapabilities !== "object") return undefined;
    return record.protocolVersion;
}

function toolCallParams(
    params: unknown,
): { name: string; arguments: Readonly<Record<string, unknown>> } | undefined {
    const name = stringParam(params, "name");
    if (name === undefined) return undefined;
    const args = (params as Record<string, unknown>).arguments;
    return {
        name,
        arguments:
            args && typeof args === "object" && !Array.isArray(args)
                ? (args as Record<string, unknown>)
                : {},
    };
}

function stringParam(params: unknown, key: string): string | undefined {
    if (!params || typeof params !== "object") return undefined;
    const value = (params as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : undefined;
}
