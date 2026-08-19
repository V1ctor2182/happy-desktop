import { readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import type { happyAgentProtocol } from "happy-desktop-state";
import { WebSocket, createWebSocketStream } from "ws";

/**
 * Largest terminal frame carried by either side of the desktop bridge.
 *
 * Happy Agent's terminal protocol uses bounded binary frames. This remains
 * deliberately larger than the protocol's own largest frame while refusing an
 * unbounded WebSocket payload before it can reach the renderer.
 */
export const RIG_TERMINAL_MAX_WIRE_BYTES = 4 * 1024 * 1024;

export interface RigDaemonClientOptions {
    readonly socketPath: string;
    readonly token: string;
}

export interface RigDaemonPaths {
    readonly socketPath: string;
    readonly tokenPath: string;
}

export interface RigDaemonRawResponse {
    readonly statusCode: number;
    readonly headers: IncomingHttpHeaders;
    readonly body: IncomingMessage;
}

/** Where a debugger attaches once Happy Agent's inspector is listening. */
export type RigDaemonInspectorResponse = happyAgentProtocol.InspectorStartedResponse;

/** Whether an inspector was listening before the stop request. */
export type RigDaemonInspectorStopResponse = happyAgentProtocol.InspectorStoppedResponse;

/**
 * Authenticated Unix-socket boundary for Happy Agent.
 *
 * It intentionally does not reproduce the browser-safe HappyAgentClient API.
 * The renderer already owns that client and reaches it through `rawRequest`.
 * Main only keeps the few transport operations a sandboxed browser cannot do:
 * health during bootstrap, terminal WebSockets, browser CONNECT tunnels, and
 * workspace file/path reads for native preview and Open In services.
 */
export class RigDaemonClient {
    readonly socketPath: string;
    readonly #token: string;

    constructor(options: RigDaemonClientOptions) {
        this.socketPath = options.socketPath;
        this.#token = options.token;
    }

    health(signal?: AbortSignal): Promise<happyAgentProtocol.HealthResponse> {
        return this.#requestJson("GET", "/v0/health", undefined, signal);
    }

    startInspector(signal?: AbortSignal): Promise<RigDaemonInspectorResponse> {
        return this.#requestJson("POST", "/v0/debug/inspector", undefined, signal);
    }

    stopInspector(signal?: AbortSignal): Promise<RigDaemonInspectorStopResponse> {
        return this.#requestJson("DELETE", "/v0/debug/inspector", undefined, signal);
    }

    getAgent(agentId: string, signal?: AbortSignal): Promise<happyAgentProtocol.AgentResponse> {
        return this.#requestJson(
            "GET",
            `/v0/agents/${encodeURIComponent(agentId)}`,
            undefined,
            signal,
        );
    }

    getWorkspace(
        workspaceId: string,
        signal?: AbortSignal,
    ): Promise<happyAgentProtocol.WorkspaceResponse> {
        return this.#requestJson(
            "GET",
            `/v0/workspaces/${encodeURIComponent(workspaceId)}`,
            undefined,
            signal,
        );
    }

    readWorkspaceFile(
        workspaceId: string,
        filePath: string,
        signal?: AbortSignal,
    ): Promise<happyAgentProtocol.FileContentResponse> {
        const query = new URLSearchParams({ path: filePath });
        return this.#requestJson(
            "GET",
            `/v0/workspaces/${encodeURIComponent(workspaceId)}/file?${query.toString()}`,
            undefined,
            signal,
        );
    }

    writeWorkspaceFile(
        workspaceId: string,
        request: happyAgentProtocol.WriteFileRequest,
        signal?: AbortSignal,
    ): Promise<happyAgentProtocol.WriteFileResponse> {
        return this.#requestJson(
            "PUT",
            `/v0/workspaces/${encodeURIComponent(workspaceId)}/file`,
            request,
            signal,
        );
    }

    /**
     * Opens one daemon request without interpreting its response.
     *
     * Only `/v0` is accepted. The renderer supplies ordinary HTTP headers, but
     * the daemon credential is always replaced here and never leaves main.
     */
    rawRequest(options: {
        readonly method: string;
        readonly path: string;
        readonly body?: Buffer;
        readonly headers?: Readonly<Record<string, string>>;
        readonly signal?: AbortSignal;
    }): Promise<RigDaemonRawResponse> {
        const path = happyAgentPath(options.path);
        return new Promise((resolvePromise, reject) => {
            if (options.signal?.aborted) {
                reject(abortedError());
                return;
            }
            const headers: Record<string, string | number> = {
                accept: "application/json",
                ...options.headers,
                authorization: `Bearer ${this.#token}`,
            };
            if (options.body !== undefined) headers["content-length"] = options.body.byteLength;
            const request = httpRequest(
                {
                    headers,
                    method: options.method,
                    path,
                    socketPath: this.socketPath,
                },
                (response) => {
                    response.once("close", cleanup);
                    resolvePromise({
                        statusCode: response.statusCode ?? 500,
                        headers: response.headers,
                        body: response,
                    });
                },
            );
            const abort = () => request.destroy(abortedError());
            const cleanup = () => options.signal?.removeEventListener("abort", abort);
            options.signal?.addEventListener("abort", abort, { once: true });
            request.once("close", cleanup);
            request.once("error", reject);
            request.end(options.body);
        });
    }

    /**
     * Resolves the product's agent identity through Happy Agent, then opens the
     * browser tunnel owned by that agent's workspace.
     */
    async openHttpProxy(agentId: string): Promise<Duplex> {
        const { agent } = await this.getAgent(agentId);
        return this.openWorkspaceHttpProxy(agent.workspaceId);
    }

    /** Opens `CONNECT /v0/workspaces/:workspaceId/proxy`. */
    openWorkspaceHttpProxy(workspaceId: string): Promise<Duplex> {
        const path = `/v0/workspaces/${encodeURIComponent(workspaceId)}/proxy`;
        return new Promise((resolvePromise, reject) => {
            const request = httpRequest({
                headers: { authorization: `Bearer ${this.#token}` },
                method: "CONNECT",
                path,
                socketPath: this.socketPath,
            });
            let settled = false;
            const fail = (statusCode: number | undefined): void => {
                if (settled) return;
                settled = true;
                const status = statusCode ?? 500;
                reject(
                    new RigDaemonHttpError(
                        status,
                        `Happy Agent browser proxy returned ${String(status)}.`,
                    ),
                );
            };
            request.once("connect", (response, socket, head) => {
                if (response.statusCode !== 200) {
                    socket.destroy();
                    fail(response.statusCode);
                    return;
                }
                if (settled) {
                    socket.destroy();
                    return;
                }
                settled = true;
                if (head.length > 0) socket.unshift(head);
                resolvePromise(socket);
            });
            request.once("response", (response) => {
                response.resume();
                fail(response.statusCode);
            });
            request.once("error", (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            });
            request.end();
        });
    }

    /**
     * Opens the binary Happy Agent terminal attachment as a byte stream.
     *
     * The workspace and terminal IDs are already authoritative `/v0`
     * identities; main performs no session lookup or legacy route projection.
     */
    attachTerminal(workspaceId: string, terminalId: string): Promise<Duplex> {
        const path = `/v0/workspaces/${encodeURIComponent(
            workspaceId,
        )}/terminals/${encodeURIComponent(terminalId)}/attach`;
        return new Promise((resolvePromise, reject) => {
            const socket = new WebSocket(`ws+unix://${this.socketPath}:${path}`, {
                handshakeTimeout: 10_000,
                headers: { authorization: `Bearer ${this.#token}` },
                maxPayload: RIG_TERMINAL_MAX_WIRE_BYTES,
                perMessageDeflate: false,
            });
            let settled = false;
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true;
                socket.terminate();
                reject(error);
            };
            const unexpected = (_request: unknown, response: { statusCode?: number }): void => {
                fail(
                    new RigDaemonHttpError(
                        response.statusCode ?? 500,
                        "The Happy Agent terminal attachment was refused.",
                    ),
                );
            };
            socket.once("error", fail);
            socket.once("unexpected-response", unexpected);
            socket.once("open", () => {
                if (settled) return;
                settled = true;
                socket.off("error", fail);
                socket.off("unexpected-response", unexpected);
                resolvePromise(createWebSocketStream(socket, { allowHalfOpen: false }));
            });
        });
    }

    async #requestJson<TResult>(
        method: string,
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<TResult> {
        const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const response = await this.rawRequest({
            method,
            path,
            ...(payload === undefined ? {} : { body: payload }),
            ...(payload === undefined
                ? {}
                : { headers: { "content-type": "application/json; charset=utf-8" } }),
            ...(signal === undefined ? {} : { signal }),
        });
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400)
            throw new RigDaemonHttpError(
                response.statusCode,
                failureMessage(text, response.statusCode),
            );
        try {
            return (text.length === 0 ? {} : JSON.parse(text)) as TResult;
        } catch (error) {
            throw new Error("Happy Agent returned invalid JSON.", { cause: error });
        }
    }
}

/** Resolves the standard Happy Agent daemon endpoint and optional exact overrides. */
export function rigDaemonPathsResolve(
    environment: NodeJS.ProcessEnv = process.env,
    homeDirectory = homedir(),
): RigDaemonPaths {
    const configuredHome = environment.HAPPY_HOME_DIR?.trim();
    const happyHome =
        configuredHome === undefined || configuredHome.length === 0
            ? join(homeDirectory, ".happy")
            : configuredHome.startsWith("~")
              ? join(homeDirectory, configuredHome.slice(1))
              : isAbsolute(configuredHome)
                ? configuredHome
                : resolve(homeDirectory, configuredHome);
    const directory = join(happyHome, "agent");
    return {
        socketPath: environment.RIG_SERVER_SOCKET_PATH?.trim() || join(directory, "server.sock"),
        tokenPath: environment.RIG_SERVER_TOKEN_PATH?.trim() || join(directory, "token"),
    };
}

export async function rigDaemonTokenRead(tokenPath: string): Promise<string | undefined> {
    try {
        return (await readFile(tokenPath, "utf8")).trim() || undefined;
    } catch {
        return undefined;
    }
}

/** A daemon response the caller could not use, preserving its HTTP status. */
export class RigDaemonHttpError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = "RigDaemonHttpError";
    }
}

/**
 * True when this immutable socket/token pair cannot be used again and the
 * desktop runtime must reconnect and reread the token.
 */
export function rigDaemonConnectionUnavailable(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; current && depth < 4; depth += 1) {
        if (typeof current !== "object") return false;
        if (current instanceof RigDaemonHttpError)
            return current.statusCode === 401 || current.statusCode === 403;
        const value = current as { readonly cause?: unknown; readonly code?: unknown };
        if (
            value.code === "ECONNREFUSED" ||
            value.code === "ECONNRESET" ||
            value.code === "EPIPE" ||
            value.code === "ENOENT"
        )
            return true;
        current = value.cause;
    }
    return false;
}

function happyAgentPath(path: string): string {
    let parsed: URL;
    try {
        parsed = new URL(path, "http://happy");
    } catch {
        throw new Error("The Happy Agent request path is invalid.");
    }
    if (
        parsed.origin !== "http://happy" ||
        (parsed.pathname !== "/v0" && !parsed.pathname.startsWith("/v0/"))
    )
        throw new Error("Only Happy Agent /v0 routes may cross the desktop bridge.");
    return `${parsed.pathname}${parsed.search}`;
}

function abortedError(): Error {
    return new Error("The Happy Agent request was aborted.");
}

function failureMessage(body: string, statusCode: number): string {
    if (body.length === 0) return `Happy Agent HTTP ${String(statusCode)}`;
    try {
        const parsed = JSON.parse(body) as {
            readonly error?: string | { readonly message?: unknown };
        };
        if (typeof parsed.error === "string" && parsed.error.length > 0) return parsed.error;
        if (
            parsed.error !== null &&
            typeof parsed.error === "object" &&
            typeof parsed.error.message === "string" &&
            parsed.error.message.length > 0
        )
            return parsed.error.message;
    } catch {
        // Non-JSON error bodies are already displayable.
    }
    return body;
}
