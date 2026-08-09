import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebContents } from "electron";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const LOOPBACK_HOST = "127.0.0.1";
const MAXIMUM_MESSAGE_BYTES = 4 * 1024 * 1024;

export interface DesktopRendererDebugger {
    readonly url: string;
    close(): Promise<void>;
}

interface CdpRequest {
    readonly id: number;
    readonly method: string;
    readonly params?: Record<string, unknown>;
    readonly sessionId?: string;
}

/**
 * Exposes Electron's live in-process CDP client as one loopback WebSocket.
 *
 * Electron deliberately gives the main process an API rather than a public
 * listening address. This relay preserves raw CDP messages in both directions,
 * allowing an external agent to attach without restarting or reloading Happy.
 * One external client owns the debugger at a time because CDP request ids and
 * session events share one underlying Electron debugger connection.
 */
export async function desktopRendererDebuggerStart(
    webContents: WebContents,
    onDetached: (reason: string) => void,
): Promise<DesktopRendererDebugger> {
    if (webContents.isDestroyed()) throw new Error("The Happy renderer is not available.");

    webContents.debugger.attach("1.3");
    const token = randomBytes(24).toString("hex");
    const path = `/cdp/${token}`;
    const server = new WebSocketServer({
        host: LOOPBACK_HOST,
        maxPayload: MAXIMUM_MESSAGE_BYTES,
        path,
        perMessageDeflate: false,
        port: 0,
    });
    let client: WebSocket | undefined;
    let closed = false;
    let intentionalDetach = false;

    const send = (socket: WebSocket, message: object): void => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const debuggerMessage = (
        _event: Electron.Event,
        method: string,
        params: Record<string, unknown>,
        sessionId?: string,
    ): void => {
        if (!client) return;
        send(client, {
            method,
            params,
            ...(sessionId === undefined ? {} : { sessionId }),
        });
    };
    const closeServer = (): Promise<void> =>
        new Promise((resolve) => {
            for (const socket of server.clients) socket.terminate();
            try {
                server.close(() => resolve());
            } catch {
                resolve();
            }
        });
    const serverFailed = (error: Error): void => {
        if (closed) return;
        closed = true;
        client = undefined;
        webContents.debugger.removeListener("message", debuggerMessage);
        webContents.debugger.removeListener("detach", debuggerDetached);
        if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
            intentionalDetach = true;
            webContents.debugger.detach();
        }
        void closeServer().finally(() => onDetached(`relay failed: ${error.message}`));
    };
    const debuggerDetached = (_event: Electron.Event, reason: string): void => {
        if (closed || intentionalDetach) return;
        closed = true;
        client = undefined;
        webContents.debugger.removeListener("message", debuggerMessage);
        void closeServer().finally(() => {
            server.removeListener("error", serverFailed);
            onDetached(reason);
        });
    };
    webContents.debugger.on("message", debuggerMessage);
    webContents.debugger.once("detach", debuggerDetached);

    try {
        await serverListening(server);
    } catch (error) {
        webContents.debugger.removeListener("message", debuggerMessage);
        webContents.debugger.removeListener("detach", debuggerDetached);
        if (webContents.debugger.isAttached()) webContents.debugger.detach();
        throw error;
    }

    server.on("error", serverFailed);
    server.on("connection", (socket) => {
        if (client && client.readyState !== WebSocket.CLOSED) {
            socket.close(1013, "A debugger is already attached");
            return;
        }
        client = socket;
        socket.on("message", (data, binary) => {
            if (binary) {
                socket.close(1003, "CDP messages must be JSON text");
                return;
            }
            const request = cdpRequestParse(data);
            if (!request) {
                socket.close(1007, "Invalid CDP request");
                return;
            }
            void webContents.debugger
                .sendCommand(request.method, request.params, request.sessionId)
                .then(
                    (result) => send(socket, { id: request.id, result }),
                    (error: unknown) =>
                        send(socket, {
                            error: {
                                code: -32_000,
                                message:
                                    error instanceof Error
                                        ? error.message
                                        : "The CDP command failed.",
                            },
                            id: request.id,
                        }),
                );
        });
        socket.once("close", () => {
            if (client === socket) client = undefined;
        });
    });

    const address = server.address() as AddressInfo;
    return {
        url: `ws://${LOOPBACK_HOST}:${address.port}${path}`,
        async close() {
            if (closed) return;
            closed = true;
            client = undefined;
            webContents.debugger.removeListener("message", debuggerMessage);
            webContents.debugger.removeListener("detach", debuggerDetached);
            await closeServer();
            server.removeListener("error", serverFailed);
            if (!webContents.isDestroyed() && webContents.debugger.isAttached()) {
                intentionalDetach = true;
                webContents.debugger.detach();
            }
        },
    };
}

function serverListening(server: WebSocketServer): Promise<void> {
    return new Promise((resolve, reject) => {
        const listening = () => {
            server.removeListener("error", failed);
            resolve();
        };
        const failed = (error: Error) => {
            server.removeListener("listening", listening);
            reject(error);
        };
        server.once("listening", listening);
        server.once("error", failed);
    });
}

function cdpRequestParse(data: RawData): CdpRequest | undefined {
    let candidate: unknown;
    try {
        candidate = JSON.parse(data.toString());
    } catch {
        return undefined;
    }
    if (
        !isRecord(candidate) ||
        typeof candidate.id !== "number" ||
        !Number.isInteger(candidate.id) ||
        candidate.id < 0
    )
        return undefined;
    if (typeof candidate.method !== "string" || candidate.method.length === 0) return undefined;
    if (candidate.params !== undefined && !isRecord(candidate.params)) return undefined;
    if (candidate.sessionId !== undefined && typeof candidate.sessionId !== "string")
        return undefined;
    return {
        id: candidate.id as number,
        method: candidate.method,
        ...(candidate.params === undefined
            ? {}
            : { params: candidate.params as Record<string, unknown> }),
        ...(candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId }),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
