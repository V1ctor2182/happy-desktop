import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { LocalRigConnection } from "./localRig";
import { localRigConnectorCreate } from "./localRig";
import { rigDaemonConnectionUnavailable } from "./rigDaemonClient";
import { rigProxyHandle } from "./rigProxyHandle";
import { rigTerminalBridgeCreate } from "./rigTerminalBridge";

const endpoint = "/__happy2_local_rig";

interface DevRuntime {
    readonly connection: LocalRigConnection;
}

export interface BrowserLocalRigOptions {
    /** Opens one daemon connection; injectable so tests drive reconnection deterministically. */
    readonly connect?: () => Promise<LocalRigConnection>;
}

/**
 * Gives the loopback-only Vite renderer a development bridge to the user's normal
 * Rig daemon. It mirrors the packaged desktop's HTTP proxy: `GET /health` forwards
 * the daemon's projected health, and the renderer's connection loader probes it
 * exactly as it probes the Electron main process's proxy in production.
 *
 * The connection is memoized but never permanent: it is dropped as soon as a
 * route reports that the daemon has become unreachable or has stopped accepting
 * this connection's token, so restarting the daemon under a running `vite` heals
 * on the renderer's next health probe instead of serving 503 until a restart.
 */
export function browserLocalRigPlugin(options: BrowserLocalRigOptions = {}): Plugin {
    const connect = options.connect ?? (() => localRigConnectorCreate().connect());
    let runtimeTask: Promise<DevRuntime> | undefined;
    const runtime = (): Promise<DevRuntime> => {
        if (runtimeTask) return runtimeTask;
        const task = connect().then((connection) => ({ connection }));
        // A failed connect must not stay memoized, or one daemon outage at the
        // first request keeps this bridge dead for the whole Vite session.
        void task.catch(() => {
            if (runtimeTask === task) runtimeTask = undefined;
        });
        runtimeTask = task;
        return task;
    };
    // A restarted daemon regenerates its token file, so the memoized connection's
    // cached token stops authenticating and every proxied route fails until the
    // connection itself is rebuilt. Dropping the memo makes the next request
    // reconnect and re-read the token, which is how the dev bridge recovers
    // without the user reloading Vite.
    const runtimeInvalidate = (error: unknown, expected?: Promise<DevRuntime>): void => {
        if (!rigDaemonConnectionUnavailable(error)) return;
        if (expected !== undefined && runtimeTask !== expected) return;
        const stale = runtimeTask;
        runtimeTask = undefined;
        void stale?.then(
            ({ connection }) => connection.close(),
            () => undefined,
        );
    };
    return {
        name: "happy2-browser-local-rig",
        apply: "serve",
        transformIndexHtml() {
            // Signal browser-local mode to the renderer without import.meta.env, so
            // the shared renderer entry can pick the dev bridge over the web app. A
            // meta tag (not an inline script) carries the flag because the page CSP
            // forbids inline scripts, which would otherwise silently drop the signal.
            if (process.env.VITE_HAPPY2_BROWSER_LOCAL !== "1") return;
            return [
                {
                    tag: "meta",
                    attrs: { name: "happy2-browser-local", content: "1" },
                    injectTo: "head" as const,
                },
            ];
        },
        configureServer(server) {
            const configuredHost =
                typeof server.config.server.host === "string"
                    ? server.config.server.host
                    : "127.0.0.1";
            const configuredPort = server.config.server.port ?? 5173;
            const expectedHost = `${configuredHost}:${configuredPort}`;
            const rendererOrigin = `http://${expectedHost}`;
            // A terminal's bytes cannot ride the middleware stack, so the dev
            // bridge claims the one upgrade path it owns and leaves every other
            // upgrade — Vite's own HMR socket above all — to Vite's listeners.
            const terminals = rigTerminalBridgeCreate({
                allowedOrigin: rendererOrigin,
                client: () => runtime().then(({ connection }) => connection.client),
                expectedHost: () => expectedHost,
                prefix: endpoint,
            });
            server.httpServer?.on("upgrade", (request, socket, head) => {
                terminals.upgrade(request, socket, head);
            });
            server.middlewares.use(async (request, response, next) => {
                const url = new URL(request.url ?? "/", "http://127.0.0.1");
                const path = url.pathname;
                // The exact endpoint is the browser development bridge (runtimeGet);
                // everything under it is a projected Rig proxy route.
                if (path === endpoint && request.method === "POST") {
                    await handleRequest(request, response, runtime);
                    return;
                }
                if (path === endpoint || path.startsWith(`${endpoint}/`)) {
                    let pending: Promise<DevRuntime> | undefined;
                    try {
                        pending = runtime();
                        const active = await pending;
                        const handled = await rigProxyHandle({
                            client: active.connection.client,
                            method: request.method ?? "GET",
                            path: path.slice(endpoint.length) || "/",
                            query: url.searchParams,
                            request,
                            response,
                            onConnectionError: (error) => runtimeInvalidate(error, pending),
                        });
                        if (!handled && !response.headersSent) next();
                    } catch (error) {
                        runtimeInvalidate(error, pending);
                        if (!response.headersSent) json(response, 503, { error: message(error) });
                    }
                    return;
                }
                next();
            });
            server.httpServer?.once("close", () => {
                terminals.close();
                void runtimeTask?.then(({ connection }) => connection.close());
            });
        },
    };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    runtime: () => Promise<DevRuntime>,
): Promise<void> {
    try {
        const body = JSON.parse(await bodyRead(request)) as { action?: string };
        const active = await runtime();
        if (body.action !== "runtimeGet")
            throw new Error("The browser development bridge action is unsupported.");
        json(response, 200, {
            value: {
                activeTarget: {
                    authentication: "rig",
                    detail: "Normal local Rig daemon",
                    id: "browser-local",
                    kind: "local",
                    label: "Local browser",
                    mode: "local",
                    rigVersion: active.connection.version,
                    rigHttpUrl: endpoint,
                },
                activeTargetId: "browser-local",
                connectionId: 1,
                mode: "local",
                phase: "ready",
                targets: [],
                update: { status: "idle" },
            },
        });
    } catch (error) {
        json(response, 400, {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function bodyRead(request: IncomingMessage): Promise<string> {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 64 * 1024) throw new Error("The request body is too large.");
    }
    return body;
}

function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}
