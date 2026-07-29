import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, createWebSocketStream } from "ws";
import { RIG_TERMINAL_MAX_WIRE_BYTES, type RigDaemonClient } from "./rigDaemonClient";

/**
 * The subprotocol a renderer must ask for to reach a terminal. It is the same
 * name the cloud gateway uses, so one renderer-side connection implementation
 * addresses either stack.
 */
export const RIG_TERMINAL_PROTOCOL = "happy2-terminal.v1";
export const RIG_TERMINAL_CAPABILITY_PROTOCOL_PREFIX = "happy2-capability.";

/** The subset of the daemon client a terminal attachment needs. */
export type RigTerminalClient = Pick<RigDaemonClient, "attachTerminal">;

export interface RigTerminalBridgeOptions {
    /** Resolves the daemon client to attach through, per upgrade. */
    readonly client: () => Promise<RigTerminalClient>;
    /** Opaque authority advertised only to the trusted renderer. */
    readonly capability?: string;
    /** Exact HTTP Host accepted by the separately-bound packaged proxy. */
    readonly expectedHost?: () => string | undefined;
    /**
     * Path prefix the renderer addresses this bridge under, matching the prefix
     * its HTTP routes are served at (`""` for the packaged app's own loopback
     * port, `/__happy2_local_rig` for the Vite development bridge).
     */
    readonly prefix?: string;
    /**
     * One extra browser origin allowed to attach: either the development Vite
     * origin or the local-web distribution's build-pinned hosted origin. The
     * standard packaged renderer's `file:` page is accepted through its opaque
     * origin; anything else is refused.
     */
    readonly allowedOrigin?: string;
}

export interface RigTerminalBridge {
    /**
     * Handles one HTTP upgrade. Returns `true` when the request addressed a
     * terminal — the socket is this bridge's from then on, answered or rejected —
     * and `false` when it did not, so the host can offer it to its other upgrade
     * listeners (Vite's HMR socket, for one).
     */
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
    close(): void;
}

interface TerminalRoute {
    readonly sessionId: string;
    readonly terminalId: string;
}

/**
 * The renderer's way onto a Rig terminal. The daemon publishes each terminal's
 * live bytes over a WebSocket on its Unix socket, which a sandboxed renderer
 * cannot open and whose bearer token it must never hold; this bridge accepts the
 * renderer's loopback WebSocket, opens the matching daemon attachment, and pipes
 * the two together frame for frame.
 *
 * It is deliberately a byte relay and nothing more: the terminal protocol's
 * epochs, input leases, and resume offsets are end-to-end between the renderer's
 * protocol client and the daemon, so a reconnect resumes against the daemon's own
 * state rather than against anything remembered here.
 */
export function rigTerminalBridgeCreate(options: RigTerminalBridgeOptions): RigTerminalBridge {
    const prefix = options.prefix ?? "";
    const sockets = new WebSocketServer({
        noServer: true,
        maxPayload: RIG_TERMINAL_MAX_WIRE_BYTES,
        perMessageDeflate: false,
        // The upgrade handler has already established the request asked for it.
        handleProtocols: () => RIG_TERMINAL_PROTOCOL,
    });
    return {
        upgrade(request, socket, head) {
            const route = terminalRoute(prefix, request.url);
            if (!route) return false;
            const protocols = protocolsOf(request.headers["sec-websocket-protocol"]);
            if (
                (options.expectedHost !== undefined &&
                    request.headers.host !== options.expectedHost()) ||
                !originAllowed(
                    request.headers.origin,
                    options.allowedOrigin,
                    options.capability !== undefined,
                ) ||
                (options.capability !== undefined &&
                    !protocols.includes(
                        `${RIG_TERMINAL_CAPABILITY_PROTOCOL_PREFIX}${options.capability}`,
                    ))
            ) {
                upgradeReject(socket, 403, "Forbidden");
                return true;
            }
            if (!protocols.includes(RIG_TERMINAL_PROTOCOL)) {
                upgradeReject(socket, 400, "Bad Request");
                return true;
            }
            void (async () => {
                const client = await options.client();
                const daemon = await client.attachTerminal(route.sessionId, route.terminalId);
                if (socket.destroyed) {
                    daemon.destroy();
                    return;
                }
                sockets.handleUpgrade(request, socket, head, (webSocket) => {
                    const renderer = createWebSocketStream(webSocket, { allowHalfOpen: false });
                    // Either end going away must tear the other down, or a closed
                    // renderer tab would leave its PTY attached to a stream nobody
                    // reads and the daemon would keep buffering for it.
                    webSocket.once("close", () => daemon.destroy());
                    webSocket.once("error", () => daemon.destroy());
                    renderer.once("error", () => daemon.destroy());
                    daemon.once("close", () => renderer.destroy());
                    daemon.once("error", () => renderer.destroy());
                    renderer.pipe(daemon);
                    daemon.pipe(renderer);
                });
            })().catch(() => upgradeReject(socket, 502, "Bad Gateway"));
            return true;
        },
        close() {
            for (const client of sockets.clients) client.terminate();
            sockets.close();
        },
    };
}

/**
 * Matches `<prefix>/sessions/:sessionId/terminals/:terminalId/attach` exactly. A
 * query string is refused rather than ignored: nothing in this route takes one,
 * so its presence means the caller expected behavior this bridge does not have.
 */
function terminalRoute(prefix: string, requestUrl: string | undefined): TerminalRoute | undefined {
    let path: string;
    try {
        const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
        if (url.search) return undefined;
        path = url.pathname;
    } catch {
        return undefined;
    }
    if (!path.startsWith(prefix)) return undefined;
    const parts = path
        .slice(prefix.length)
        .split("/")
        .filter((part) => part.length > 0);
    if (
        parts.length !== 5 ||
        parts[0] !== "sessions" ||
        parts[2] !== "terminals" ||
        parts[4] !== "attach"
    )
        return undefined;
    const sessionId = decodeURIComponent(parts[1]!);
    const terminalId = decodeURIComponent(parts[3]!);
    if (!sessionId || !terminalId) return undefined;
    return { sessionId, terminalId };
}

/**
 * Whether this origin may open a terminal. The packaged renderer's `file:` page
 * sends `null` or no origin at all, and the development renderer is served by the
 * very server this bridge is bound to, so it is same-origin. Anything else has to
 * be the origin the host explicitly allowed — a browser sends `Origin` on a
 * WebSocket handshake it cannot forge, so this is what keeps a random page the
 * user has open from opening a shell on their machine.
 */
function originAllowed(
    origin: string | undefined,
    allowed: string | undefined,
    allowOpaqueOrigin: boolean,
): boolean {
    if (origin === undefined || origin === "null" || origin.startsWith("file:"))
        return allowOpaqueOrigin;
    return allowed !== undefined && origin === allowed;
}

function protocolsOf(header: string | string[] | undefined): string[] {
    return (typeof header === "string" ? header : (header ?? []).join(","))
        .split(",")
        .map((protocol) => protocol.trim())
        .filter(Boolean);
}

function upgradeReject(socket: Duplex, status: number, text: string): void {
    if (!socket.writable) {
        socket.destroy();
        return;
    }
    socket.write(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\n\r\n`);
    socket.destroy();
}
