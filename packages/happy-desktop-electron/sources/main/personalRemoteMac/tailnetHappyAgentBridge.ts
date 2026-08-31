import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { HappyAgentDaemonClient } from "../happyAgentDaemonClient";
import { happyAgentProxyHandle } from "../happyAgentProxyHandle";
import {
    happyAgentTerminalBridgeCreate,
    type HappyAgentTerminalBridge,
} from "../happyAgentTerminalBridge";

export type TailnetHappyAgentBacking = Pick<
    HappyAgentDaemonClient,
    | "attachTerminal"
    | "getWorkspace"
    | "health"
    | "openWorkspaceHttpProxy"
    | "rawRequest"
    | "readWorkspaceFile"
    | "writeWorkspaceFile"
>;

export interface TailnetHappyAgentBridgeHandle {
    readonly address: string;
    readonly port: number;
    /** Begins accepting the persisted bearer credential. */
    activate(): void;
    /** Refuses new authenticated work without tearing down accepted streams. */
    deactivate(): void;
    replace(backing: TailnetHappyAgentBacking | undefined): void;
    close(): Promise<void>;
}

export interface TailnetHappyAgentBridgeOptions {
    readonly address: string;
    readonly port?: number;
    readonly tokenSha256: string;
    readonly backing?: TailnetHappyAgentBacking;
    /** Lets a replacement bind before its credential becomes authoritative. */
    readonly active?: boolean;
}

const MAX_CONNECTIONS = 64;
const ADMIN_ROUTE_PARTS = new Set(["drain", "shutdown", "inspector", "inspectors"]);

/** B's exact-interface, bearer-authenticated bridge onto its current local daemon. */
export function tailnetHappyAgentBridgeCreate(
    options: TailnetHappyAgentBridgeOptions,
): Promise<TailnetHappyAgentBridgeHandle> {
    let backing = options.backing;
    let expectedHost: string | undefined;
    let closed = false;
    let active = options.active !== false;
    const expectedDigest = Buffer.from(options.tokenSha256, "base64url");
    if (expectedDigest.byteLength !== 32)
        throw new Error("The remote Mac token digest is invalid.");
    const sockets = new Set<Socket>();
    const tunnels = new Set<Duplex>();
    const authorize = (request: IncomingMessage): boolean =>
        !closed &&
        active &&
        request.headers.host === expectedHost &&
        request.headers.origin === undefined &&
        authorizationMatches(request.headers.authorization, expectedDigest);
    const backingRequire = (): TailnetHappyAgentBacking => {
        if (!backing) throw new Error("The local Happy Agent daemon is unavailable.");
        return backing;
    };
    let terminals: HappyAgentTerminalBridge;
    const server = createServer((request, response) => {
        if (!authorize(request)) {
            unauthorized(response);
            return;
        }
        const parsed = requestUrl(request.url);
        if (!parsed || adminRoute(parsed.pathname)) {
            notFound(response);
            return;
        }
        if (
            !(
                (request.method === "GET" && parsed.pathname === "/health") ||
                parsed.pathname === "/v0" ||
                parsed.pathname.startsWith("/v0/")
            )
        ) {
            notFound(response);
            return;
        }
        const current = backing;
        if (!current) {
            unavailable(response);
            return;
        }
        void happyAgentProxyHandle({
            client: current,
            method: request.method ?? "GET",
            // A Tailnet caller is not the native host UI. In particular it may
            // not ask B to open applications or trust A-local attachment paths.
            nativeHost: false,
            path: parsed.pathname,
            query: parsed.searchParams,
            request,
            response,
        }).then(
            (handled) => {
                if (!handled && !response.headersSent) notFound(response);
            },
            () => {
                if (!response.headersSent) unavailable(response);
                else response.end();
            },
        );
    });
    server.maxConnections = MAX_CONNECTIONS;
    server.maxHeadersCount = 64;
    server.headersTimeout = 10_000;
    server.requestTimeout = 60_000;
    server.keepAliveTimeout = 5_000;
    terminals = happyAgentTerminalBridgeCreate({
        authorize,
        client: async () => backingRequire(),
        expectedHost: () => expectedHost,
    });
    server.on("upgrade", (request, socket, head) => {
        if (!terminals.upgrade(request, socket, head)) socket.destroy();
    });
    server.on("connect", (request, socket, head) => {
        socket.on("error", () => socket.destroy());
        if (!authorize(request)) {
            socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            return;
        }
        const workspaceId = proxyWorkspaceId(request.url);
        if (!workspaceId || !backing) {
            socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            return;
        }
        const current = backing;
        void current.openWorkspaceHttpProxy(workspaceId).then(
            (tunnel) => {
                if (closed || socket.destroyed || backing !== current) {
                    tunnel.destroy();
                    socket.destroy();
                    return;
                }
                tunnels.add(tunnel);
                tunnel.once("close", () => tunnels.delete(tunnel));
                tunnel.on("error", () => socket.destroy());
                socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                if (head.length > 0) tunnel.write(head);
                socket.pipe(tunnel);
                tunnel.pipe(socket);
            },
            () => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"),
        );
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    server.on("clientError", (_error, socket) => socket.destroy());

    return new Promise((resolvePromise, reject) => {
        const fail = (error: Error) => reject(error);
        server.once("error", fail);
        server.listen(options.port ?? 0, options.address, () => {
            server.off("error", fail);
            const address = server.address() as AddressInfo | null;
            if (!address) {
                server.close();
                reject(new Error("The remote Mac bridge did not bind."));
                return;
            }
            expectedHost = `${options.address}:${String(address.port)}`;
            resolvePromise({
                address: options.address,
                port: address.port,
                activate() {
                    if (closed) throw new Error("The remote Mac bridge is closed.");
                    active = true;
                },
                deactivate() {
                    active = false;
                },
                replace(next) {
                    if (closed) throw new Error("The remote Mac bridge is closed.");
                    backing = next;
                },
                close: () => {
                    if (closed) return Promise.resolve();
                    closed = true;
                    backing = undefined;
                    terminals.close();
                    for (const tunnel of tunnels) tunnel.destroy();
                    tunnels.clear();
                    for (const socket of sockets) socket.destroy();
                    sockets.clear();
                    return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
                },
            });
        });
    });
}

function authorizationMatches(value: string | undefined, expectedDigest: Buffer): boolean {
    if (!value?.startsWith("Bearer ")) return false;
    const token = value.slice("Bearer ".length);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return false;
    const digest = createHash("sha256").update(token).digest();
    return (
        digest.byteLength === expectedDigest.byteLength && timingSafeEqual(digest, expectedDigest)
    );
}

function requestUrl(value: string | undefined): URL | undefined {
    try {
        const parsed = new URL(value ?? "/", "http://tailnet");
        return parsed.origin === "http://tailnet" ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function adminRoute(path: string): boolean {
    try {
        const parts = decodeURIComponent(path)
            .split("/")
            .filter(Boolean)
            .map((part) => part.toLowerCase());
        return parts.some((part) => ADMIN_ROUTE_PARTS.has(part));
    } catch {
        // A malformed escape must never become a different route after another
        // proxy or the daemon parses it more leniently.
        return true;
    }
}

function proxyWorkspaceId(value: string | undefined): string | undefined {
    const parsed = requestUrl(value);
    if (!parsed || parsed.search) return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (
        parts.length !== 4 ||
        parts[0] !== "v0" ||
        parts[1] !== "workspaces" ||
        parts[3] !== "proxy"
    )
        return undefined;
    try {
        return decodeURIComponent(parts[2]!) || undefined;
    } catch {
        return undefined;
    }
}

function unauthorized(response: ServerResponse): void {
    response.writeHead(401, {
        connection: "close",
        "content-type": "application/json",
        "www-authenticate": "Bearer",
    });
    response.end(JSON.stringify({ error: "Unauthorized." }));
}

function unavailable(response: ServerResponse): void {
    response.writeHead(503, { connection: "close", "content-type": "application/json" });
    response.end(JSON.stringify({ error: "The local Happy Agent daemon is unavailable." }));
}

function notFound(response: ServerResponse): void {
    response.writeHead(404, { connection: "close", "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found." }));
}
