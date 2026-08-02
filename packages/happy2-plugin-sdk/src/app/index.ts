import { useCallback, useEffect, useRef, useState } from "react";
import {
    useApp,
    useHostStyles,
    type App,
    type McpUiAppCapabilities,
    type McpUiHostContext,
    type UseAppOptions,
} from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod/v4";
import type { AppOpenPresentation, JsonObject } from "../types.js";

export {
    useApp,
    useHostFonts,
    useHostStyles,
    useHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/react";
export type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps/react";
export type { AppOpenPresentation, JsonObject, JsonValue } from "../types.js";

export const HAPPY_INSTANCE_HOST_CONTEXT_KEY = "happy2/instance";
export const HAPPY_STYLE_HOST_CONTEXT_KEY = "happy2/styles";
export const HAPPY_APP_OPEN_METHOD = "happy2/app-open";

/**
 * The Happy-specific appearance roles that the standard `styles.variables`
 * vocabulary has no key for. The standard record is a closed set of 76 names and
 * a View rejects an update carrying any other key, so these travel in their own
 * namespaced member of the host context and are applied by
 * {@link useHappyStyleVariables}. See `PLUGIN-DESIGN.md` for what each one means.
 */
export interface HappyStyleHostContext {
    readonly variables: Readonly<Record<string, string>>;
}

/** Durable instance data supplied by Happy in standard extensible host context. */
export interface HappyInstanceHostContext {
    readonly context: JsonObject;
    readonly dataRevision: number;
    readonly definitionRevision: number;
    readonly id: string;
    readonly key: string;
}

export type HappyHostContext = McpUiHostContext & {
    readonly [HAPPY_INSTANCE_HOST_CONTEXT_KEY]?: HappyInstanceHostContext;
    readonly [HAPPY_STYLE_HOST_CONTEXT_KEY]?: HappyStyleHostContext;
};

export interface UseHappyAppOptions extends Pick<
    UseAppOptions,
    "appInfo" | "autoResize" | "onAppCreated"
> {
    readonly capabilities?: McpUiAppCapabilities;
}

export interface HappyAppState<TInput extends JsonObject = JsonObject> {
    readonly app: App | null;
    readonly error: Error | null;
    readonly hostContext: HappyHostContext | undefined;
    readonly instance: HappyInstanceHostContext | undefined;
    readonly isConnected: boolean;
    readonly toolInput: TInput | undefined;
    readonly toolResult: CallToolResult | undefined;
}

/**
 * Connects through the official MCP Apps React hook and exposes Happy's durable instance context.
 * Tool notifications are registered before the handshake, so initial input/result cannot race mount.
 */
export function useHappyApp<TInput extends JsonObject = JsonObject>(
    options: UseHappyAppOptions,
): HappyAppState<TInput> {
    const [hostContext, setHostContext] = useState<HappyHostContext>();
    const [toolInput, setToolInput] = useState<TInput>();
    const [toolResult, setToolResult] = useState<CallToolResult>();
    const state = useApp({
        appInfo: options.appInfo,
        autoResize: options.autoResize,
        capabilities: options.capabilities ?? {},
        strict: true,
        onAppCreated(app) {
            app.addEventListener("hostcontextchanged", (update) =>
                setHostContext((current) => ({ ...current, ...update })),
            );
            app.addEventListener("toolinput", (input) => setToolInput(input.arguments as TInput));
            app.addEventListener("toolresult", setToolResult);
            options.onAppCreated?.(app);
        },
    });

    useEffect(() => {
        const initial = state.app?.getHostContext();
        if (initial) setHostContext(initial);
    }, [state.app]);
    useHostStyles(state.app, hostContext);
    useHappyStyleVariables(state.app, hostContext);

    return {
        ...state,
        hostContext,
        instance: happyInstanceHostContext(hostContext),
        toolInput,
        toolResult,
    };
}

export interface HappyAppOpenRequest {
    readonly instanceKey: string;
    readonly presentation: AppOpenPresentation;
}

export interface HappyAppOpenResult {
    readonly isError?: boolean;
}

const appOpenResultSchema = z
    .object({ isError: z.boolean().optional() })
    .loose() as z.ZodType<HappyAppOpenResult>;

/** Requests that Happy open a predeclared installation-local app instance. */
export function openHappyApp(
    app: App,
    request: HappyAppOpenRequest,
    options?: RequestOptions,
): Promise<HappyAppOpenResult> {
    if (!request.instanceKey.trim()) throw new TypeError("App instance key is required");
    return app.request(
        {
            method: HAPPY_APP_OPEN_METHOD,
            params: request,
        } as never,
        appOpenResultSchema,
        options,
    );
}

/** Stable React callback for the Happy app-open vendor request. */
export function useOpenHappyApp(app: App | null) {
    return useCallback(
        (request: HappyAppOpenRequest, options?: RequestOptions) => {
            if (!app) return Promise.reject(new Error("MCP App is not connected"));
            return openHappyApp(app, request, options);
        },
        [app],
    );
}

/** Parses Happy's namespaced extension while tolerating unrelated future host-context fields. */
export function happyInstanceHostContext(
    context: McpUiHostContext | undefined,
): HappyInstanceHostContext | undefined {
    const value = context?.[HAPPY_INSTANCE_HOST_CONTEXT_KEY];
    if (value === undefined) return undefined;
    const record = object(value, HAPPY_INSTANCE_HOST_CONTEXT_KEY);
    return {
        context: jsonObject(record.context, `${HAPPY_INSTANCE_HOST_CONTEXT_KEY}.context`),
        dataRevision: revision(
            record.dataRevision,
            `${HAPPY_INSTANCE_HOST_CONTEXT_KEY}.dataRevision`,
        ),
        definitionRevision: revision(
            record.definitionRevision,
            `${HAPPY_INSTANCE_HOST_CONTEXT_KEY}.definitionRevision`,
        ),
        id: string(record.id, `${HAPPY_INSTANCE_HOST_CONTEXT_KEY}.id`),
        key: string(record.key, `${HAPPY_INSTANCE_HOST_CONTEXT_KEY}.key`),
    };
}

/**
 * The closed set of Happy appearance variables, matching `PLUGIN-DESIGN.md` §5.3
 * and the host's own mapping. A name outside it is discarded rather than written
 * to the document, so what an app can be given stays exactly the documented set
 * even if a host is newer, older, or wrong. Adding a variable means adding it in
 * three places: the host mapping, this set, and §5.3.
 */
const HAPPY_STYLE_VARIABLE_NAMES: ReadonlySet<string> = new Set([
    "--happy-canvas",
    "--happy-code-background",
    "--happy-header-background",
    "--happy-header-text",
    "--happy-input-background",
    "--happy-input-placeholder",
    "--happy-input-text",
    "--happy-link",
    "--happy-scrim",
    "--happy-scrollbar-thumb",
    "--happy-selected-background",
    "--happy-shadow-color",
]);

/**
 * A conservative bound on one appearance value: long enough for any resolved
 * color, and free of the CSS block and at-rule punctuation a malformed payload
 * would carry. Applies before the color check below, and stands in for it on an
 * engine without `CSS.supports`.
 */
const HAPPY_STYLE_VARIABLE_VALUE = /^[^{}<>;@]{1,256}$/;

/**
 * Every Happy appearance variable is a resolved color, so a value is accepted
 * only if the engine agrees that it is one. That rejects `url()`, `image-set()`,
 * `attr()` and every other token stream a fetch-capable property could act on,
 * whatever a host sends.
 */
function isHappyStyleVariableValue(value: string): boolean {
    if (!HAPPY_STYLE_VARIABLE_VALUE.test(value)) return false;
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;
    return CSS.supports("color", value);
}

/**
 * Reads Happy's appearance extension out of a host context. Appearance must
 * never break a running View, so this is lenient by design: an absent, malformed,
 * or partially unrecognized payload yields whatever subset was valid, or
 * undefined, instead of throwing the way the durable instance parser does.
 */
export function happyStyleHostContext(
    context: McpUiHostContext | undefined,
): HappyStyleHostContext | undefined {
    const value = context?.[HAPPY_STYLE_HOST_CONTEXT_KEY];
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const source = (value as { variables?: unknown }).variables;
    if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
    const variables: Record<string, string> = {};
    for (const [name, entry] of Object.entries(source as Record<string, unknown>)) {
        if (typeof entry !== "string") continue;
        if (!HAPPY_STYLE_VARIABLE_NAMES.has(name)) continue;
        if (!isHappyStyleVariableValue(entry)) continue;
        variables[name] = entry;
    }
    return Object.keys(variables).length > 0 ? { variables } : undefined;
}

const NO_HAPPY_STYLE_VARIABLES: ReadonlySet<string> = new Set<string>();

/**
 * Applies Happy's appearance variables as CSS custom properties, mirroring what
 * the official `applyHostStyleVariables` does for the standard ones. The root
 * defaults to the document element so `var(--happy-canvas)` resolves anywhere in
 * the app.
 *
 * A host context member is replaced wholesale rather than patched, so a name in
 * `previous` that this payload no longer carries is removed instead of left
 * behind at its old value. Returns the names now set, to pass back as `previous`
 * on the next call.
 */
export function applyHappyStyleVariables(
    styles: HappyStyleHostContext,
    root: HTMLElement = document.documentElement,
    previous: ReadonlySet<string> = NO_HAPPY_STYLE_VARIABLES,
): ReadonlySet<string> {
    const applied = new Set<string>();
    for (const [name, value] of Object.entries(styles.variables)) {
        root.style.setProperty(name, value);
        applied.add(name);
    }
    for (const name of previous) if (!applied.has(name)) root.style.removeProperty(name);
    return applied;
}

/** Removes every appearance property an earlier apply left on `root`. */
export function clearHappyStyleVariables(
    previous: ReadonlySet<string>,
    root: HTMLElement = document.documentElement,
): void {
    for (const name of previous) root.style.removeProperty(name);
}

/**
 * Keeps Happy's appearance variables current for the lifetime of the app: the
 * context the app connected with is applied once per app, and every later
 * `hostcontextchanged` — which is how a system or in-app light/dark switch
 * reaches an isolated View — is applied as it arrives. Whichever payload lands,
 * variables the new one omits are removed, so a reconnect to a different app
 * cannot leave the previous one's appearance on the document.
 */
export function useHappyStyleVariables(
    app: App | null,
    initialContext?: McpUiHostContext | null,
): void {
    // `names: null` means nothing has been applied for this app yet, which is not
    // the same as having applied an empty set.
    const applied = useRef<
        { readonly app: App | null; readonly names: ReadonlySet<string> | null } | undefined
    >(undefined);
    useEffect(() => {
        const state = applied.current;
        // This app's appearance is already on the document, so the connect-time
        // context has nothing to add and must not undo a `hostcontextchanged`
        // that has already landed.
        if (state && state.app === app && state.names !== null) return;
        const previous = state?.names ?? NO_HAPPY_STYLE_VARIABLES;
        const styles = happyStyleHostContext(initialContext ?? undefined);
        if (!styles) {
            // Either the handshake has not produced a payload yet, or this is a
            // different app: drop whatever the previous one set and wait.
            clearHappyStyleVariables(previous);
            applied.current = { app, names: null };
            return;
        }
        applied.current = {
            app,
            names: applyHappyStyleVariables(styles, document.documentElement, previous),
        };
    }, [app, initialContext]);
    useEffect(() => {
        if (!app) return;
        const listener = (update: McpUiHostContext) => {
            const styles = happyStyleHostContext(update);
            if (!styles) return;
            applied.current = {
                app,
                names: applyHappyStyleVariables(
                    styles,
                    document.documentElement,
                    applied.current?.names ?? NO_HAPPY_STYLE_VARIABLES,
                ),
            };
        };
        app.addEventListener("hostcontextchanged", listener);
        return () => app.removeEventListener("hostcontextchanged", listener);
    }, [app]);
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError(`${label} must be an object`);
    return value as Readonly<Record<string, unknown>>;
}

function jsonObject(value: unknown, label: string): JsonObject {
    const record = object(value, label);
    assertJson(record, label);
    return record as JsonObject;
}

function assertJson(value: unknown, label: string): void {
    if (value === null || ["boolean", "string"].includes(typeof value)) return;
    if (typeof value === "number") {
        if (Number.isFinite(value)) return;
        throw new TypeError(`${label} must contain finite JSON numbers`);
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertJson(item, `${label}[${index}]`));
        return;
    }
    if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) assertJson(item, `${label}.${key}`);
        return;
    }
    throw new TypeError(`${label} must contain only JSON values`);
}

function revision(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
        throw new TypeError(`${label} must be a non-negative integer`);
    return value as number;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a string`);
    return value;
}
