import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { HealthResponse } from "@slopus/rig/types";
import type { RigDaemonHealth } from "happy2-state";
import type { HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigProxyHandle, type RigProxyClient } from "./rigProxyHandle";
import { rigTerminalBridgeCreate, type RigTerminalClient } from "./rigTerminalBridge";

export interface RigHttpProxyHandle {
    /** Loopback base URL, for example `http://127.0.0.1:52344`. */
    readonly url: string;
    close(): void;
}

export interface RigHttpProxyOptions {
    /** The daemon client whose projected surface this proxy exposes. */
    readonly client: RigProxyClient & RigTerminalClient;
    /**
     * Invoked when a health request fails at the transport level (the daemon is
     * unreachable), so the runtime can restart the connection. Daemon-reported
     * `error`/`starting` states resolve normally and never trigger this.
     */
    readonly onConnectionError?: (error: unknown) => void;
    /**
     * The single browser origin allowed to call this proxy cross-origin. The
     * development shell supplies its Vite origin; the local-web distribution
     * supplies its immutable hosted renderer origin. The standard packaged app
     * loads `file:` and passes nothing.
     */
    readonly allowedOrigin?: string;
    /**
     * The window's HTML preview proxy, if it has one. Registering this Rig's
     * client with it is what lets a document of its checkouts be published as a
     * site; without one this proxy reports that it cannot render a document.
     */
    readonly htmlPreview?: HtmlPreviewProxyHandle;
}

/** Projects Rig's protocol health into the minimal liveness shape the renderer loader consumes. */
export function rigDaemonHealthProject(value: HealthResponse): RigDaemonHealth {
    if (value.status === "ready") return { status: "ready", version: value.identity.version };
    if (value.status === "error")
        return { status: "error", version: value.identity.version, message: value.error };
    return { status: "starting", version: value.identity.version };
}

/**
 * A loopback-only HTTP bridge from the sandboxed renderer to the daemon. The
 * renderer cannot open the daemon's Unix socket, so the main process listens on an
 * ephemeral 127.0.0.1 port and forwards the renderer transport's projected JSON/SSE
 * routes to the authenticated `ProtocolHttpClient` via `rigProxyHandle`. Everything
 * under `rig-connect` is a transparent protocol bridge for the application-state
 * client: the proxy strips that prefix and otherwise preserves the daemon request
 * and response contract. It binds to loopback only, requires the unguessable URL
 * capability, and 404s every unmatched path.
 * Resolves once the port is bound so the caller can advertise the URL.
 *
 * The same port also upgrades one route to a WebSocket: a terminal's byte channel,
 * which cannot be a request/response at all. That is the only upgrade this server
 * answers, so any other upgrade attempt is refused rather than left hanging.
 */
export function rigHttpProxyCreate(options: RigHttpProxyOptions): Promise<RigHttpProxyHandle> {
    const htmlPreviewUrl = options.htmlPreview?.register(options.client);
    const capability = randomBytes(32).toString("base64url");
    const capabilityPrefix = `/${capability}`;
    let expectedHost: string | undefined;
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        // Exact-match only: an echoed arbitrary origin would hand the whole daemon
        // surface to any page the user happens to have open.
        const crossOrigin =
            options.allowedOrigin !== undefined && request.headers.origin === options.allowedOrigin;
        if (
            request.headers.host !== expectedHost ||
            (request.headers.origin !== undefined &&
                request.headers.origin !== "null" &&
                !request.headers.origin.startsWith("file:") &&
                !crossOrigin) ||
            (url.pathname !== capabilityPrefix && !url.pathname.startsWith(`${capabilityPrefix}/`))
        ) {
            response.writeHead(403);
            response.end();
            return;
        }
        if (crossOrigin) {
            response.setHeader("access-control-allow-origin", options.allowedOrigin!);
            response.setHeader("access-control-expose-headers", "*");
            response.setHeader("vary", "origin");
        }
        if (request.method === "OPTIONS") {
            // The exact renderer origin may use the complete connector protocol.
            // Echoing its requested method and headers keeps this bridge transparent
            // when rig-connect adds an operation without weakening the origin gate.
            if (crossOrigin) {
                const requestedMethod = request.headers["access-control-request-method"]?.trim();
                const requestedHeaders = request.headers["access-control-request-headers"]?.trim();
                const privateNetwork =
                    request.headers["access-control-request-private-network"] === "true";
                response.writeHead(204, {
                    "access-control-allow-headers":
                        requestedHeaders ||
                        "authorization, content-type, if-match, x-rig-mutation-id",
                    "access-control-allow-methods": requestedMethod
                        ? `${requestedMethod}, OPTIONS`
                        : "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
                    ...(privateNetwork ? { "access-control-allow-private-network": "true" } : {}),
                    "access-control-max-age": "600",
                });
            } else {
                response.writeHead(403);
            }
            response.end();
            return;
        }
        const bridgePath = url.pathname.slice(capabilityPrefix.length) || "/";
        const rigConnectRequest =
            bridgePath === "/rig-connect" || bridgePath.startsWith("/rig-connect/");
        const hasBody =
            Number(request.headers["content-length"] ?? 0) > 0 ||
            request.headers["transfer-encoding"] !== undefined;
        if (
            hasBody &&
            !rigConnectRequest &&
            request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
                "application/json"
        ) {
            response.writeHead(415, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "JSON content type required." }));
            return;
        }
        void rigProxyHandle({
            client: options.client,
            method: request.method ?? "GET",
            path: bridgePath,
            query: url.searchParams,
            request,
            response,
            onConnectionError: options.onConnectionError,
            ...(htmlPreviewUrl ? { htmlPreviewUrl } : {}),
        }).then(
            (handled) => {
                if (!handled && !response.headersSent) {
                    response.writeHead(404, { "content-type": "application/json" });
                    response.end(JSON.stringify({ error: "Not found." }));
                }
            },
            (error: unknown) => {
                if (!response.headersSent) {
                    response.writeHead(500, { "content-type": "application/json" });
                    response.end(
                        JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        }),
                    );
                }
            },
        );
    });
    const terminals = rigTerminalBridgeCreate({
        client: () => Promise.resolve(options.client),
        capability,
        prefix: capabilityPrefix,
        expectedHost: () => expectedHost,
        ...(options.allowedOrigin === undefined ? {} : { allowedOrigin: options.allowedOrigin }),
    });
    server.on("upgrade", (request, socket, head) => {
        if (!terminals.upgrade(request, socket, head)) socket.destroy();
    });
    return new Promise<RigHttpProxyHandle>((resolvePromise, reject) => {
        const onError = (error: unknown) => reject(error as Error);
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", onError);
            const address = server.address() as AddressInfo | null;
            if (!address) {
                server.close();
                reject(new Error("The Rig HTTP proxy did not bind a loopback port."));
                return;
            }
            expectedHost = `127.0.0.1:${address.port}`;
            resolvePromise({
                url: `http://${expectedHost}${capabilityPrefix}`,
                close: () => {
                    terminals.close();
                    server.close();
                },
            });
        });
    });
}
