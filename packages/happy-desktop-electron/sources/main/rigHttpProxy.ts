import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { HealthResponse } from "@slopus/rig/types";
import type { RigDaemonHealth } from "happy-desktop-state";
import type { HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigNodeRouteMatch } from "./rigNodeRoute";
import { rigProxyHandle, type RigProxyClient } from "./rigProxyHandle";
import { rigTerminalBridgeCreate, type RigTerminalClient } from "./rigTerminalBridge";

export interface RigHttpProxyHandle {
    /** Loopback base URL, for example `http://127.0.0.1:52344`. */
    readonly url: string;
    /**
     * Atomically replaces the daemon connection projected through this already
     * bound proxy. Its URL, capability, server, terminal bridge, and preview
     * registration stay alive; subsequent work resolves through this backing.
     */
    replace(backing: RigHttpProxyBacking): void;
    close(): void;
}

export interface RigHttpProxyBacking {
    /** The daemon client whose projected surface this proxy exposes. */
    readonly client: RigProxyClient & RigTerminalClient;
    /**
     * Builds the same projected surface over one machine the host Rig is peered
     * with, addressed by the identity the host published for it.
     *
     * The peer's work is reached through this one port, under `/nodes/<id>`, so
     * a connection to a node is the ordinary connection with a different base
     * URL rather than a second kind of client. A window whose host cannot peer
     * supplies nothing and those paths are simply not found.
     *
     * The host's peer route forwards whole daemon paths — ordinary requests, a
     * terminal's WebSocket upgrade, and the browser tunnel's CONNECT alike — so
     * what comes back is the far machine's own catalog, models, sessions, and
     * byte streams, and this projects them with the same code it projects its
     * own host's, because they are the same protocol. That holds exactly as far
     * as the two daemons agree on it: a machine running a Rig this build cannot
     * read is classified during the connector's handshake and reported as such
     * rather than projected into a surface that would be quietly wrong.
     */
    readonly peerClient?: (nodeId: string) => RigProxyClient & RigTerminalClient;
}

export interface RigHttpProxyOptions extends RigHttpProxyBacking {
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
 * which cannot be a request/response at all. It is answered for this window's host
 * and, under that node's own base, for each machine the host is peered with. That
 * is the only upgrade this server answers, so any other upgrade attempt is refused
 * rather than left hanging.
 */
export function rigHttpProxyCreate(options: RigHttpProxyOptions): Promise<RigHttpProxyHandle> {
    type Client = RigProxyClient & RigTerminalClient;
    interface CurrentBacking {
        readonly client: Client;
        readonly peerClient?: (nodeId: string) => Client;
        readonly peers: Map<string, Client>;
    }
    const backingCreate = (next: RigHttpProxyBacking): CurrentBacking => ({
        client: next.client,
        peers: new Map(),
        ...(next.peerClient === undefined ? {} : { peerClient: next.peerClient }),
    });
    let backing = backingCreate(options);
    // Preview sites outlive one daemon transport. Their stored client is this
    // stable facade, whose every method lookup binds to the current host client.
    const liveHostClient = new Proxy(options.client, {
        get(_target, property) {
            const client = backing.client;
            const value = Reflect.get(client, property, client) as unknown;
            return typeof value === "function" ? value.bind(client) : value;
        },
    });
    const preview = options.htmlPreview?.register(liveHostClient);
    // One client per node, kept for as long as this proxy lives. They are made
    // on first use for the current host connection rather than from a list of
    // nodes. Replacing the host installs a fresh cache with its peer factory, so
    // no route can retain a client made from the previous daemon transport.
    const peerClient = (current: CurrentBacking, nodeId: string): Client | undefined => {
        const create = current.peerClient;
        if (!create) return undefined;
        const existing = current.peers.get(nodeId);
        if (existing) return existing;
        const client = create(nodeId);
        current.peers.set(nodeId, client);
        return client;
    };
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
        const requestPath = url.pathname.slice(capabilityPrefix.length) || "/";
        // A node's own base URL sits under this same port, so everything above
        // — the renderer transport, the connector, the health probe — addresses
        // a peer with the paths it already knows and only the base differs.
        const node = rigNodeRouteMatch(requestPath);
        const requestBacking = backing;
        const client = node ? peerClient(requestBacking, node.nodeId) : requestBacking.client;
        if (!client) {
            response.writeHead(404, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "This Rig is not peered with that machine." }));
            return;
        }
        const bridgePath = node ? node.path : requestPath;
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
            client,
            method: request.method ?? "GET",
            path: bridgePath,
            query: url.searchParams,
            request,
            response,
            // A node that stops answering is that node's connection to notice
            // and retry; it is not this window's host going down, and reporting
            // it as one would tear down every other Rig in the window.
            ...(node
                ? {}
                : {
                      onConnectionError: (error: unknown) => {
                          // An old in-flight request may finish failing after a
                          // replacement is already live. It cannot invalidate
                          // the new connection or start another reconnect.
                          if (backing === requestBacking) options.onConnectionError?.(error);
                      },
                  }),
            // The preview server publishes documents out of this window's own
            // host checkouts. A node's file lives on the other machine, so
            // handing back a host preview URL would serve the wrong bytes under
            // a name that looks right; a node reports that it cannot preview.
            ...(preview && !node
                ? { htmlPreviewUrl: preview.workspace, webappPreviewUrl: preview.webapp }
                : {}),
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
        // The machine comes off the path the same way it does for every request
        // above. A node this host is not peered with is refused rather than
        // answered by the host's own client: the session ID in that path was
        // minted on the other machine, and one that happens to name a real
        // session here would open a shell on the wrong one.
        client: (nodeId) => {
            const current = backing;
            if (nodeId === undefined) return Promise.resolve(current.client);
            const client = peerClient(current, nodeId);
            return client
                ? Promise.resolve(client)
                : Promise.reject(new Error("This Rig is not peered with that machine."));
        },
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
            let closed = false;
            resolvePromise({
                url: `http://${expectedHost}${capabilityPrefix}`,
                replace: (next) => {
                    if (closed) throw new Error("The Rig HTTP proxy is closed.");
                    backing = backingCreate(next);
                },
                close: () => {
                    if (closed) return;
                    closed = true;
                    terminals.close();
                    server.close();
                },
            });
        });
    });
}
