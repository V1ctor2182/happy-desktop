import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { Duplex } from "node:stream";
import {
    HappyAgentClient,
    type AgentResponse,
    type Cuid2,
    type FileContentResponse,
    type HealthResponse,
    type WorkspaceResponse,
    type WriteFileRequest,
    type WriteFileResponse,
} from "@slopus/happy-agent-client";
import { WebSocket, createWebSocketStream } from "ws";
import {
    HAPPY_AGENT_TERMINAL_MAX_WIRE_BYTES,
    HappyAgentDaemonHttpError,
    type HappyAgentDaemonRawResponse,
} from "../happyAgentDaemonClient";
import { personalRemoteMacTailnetAddressRequireLocal } from "./personalRemoteMacSettings";

export interface RemoteHappyAgentClientOptions {
    readonly address: string;
    readonly port: number;
    readonly sourceAddress: string;
    readonly token: string;
}

interface Destroyable {
    destroy(error?: Error): void;
}

/** Direct main-process HTTP/WS/CONNECT client for B's authenticated Tailnet listener. */
export class RemoteHappyAgentClient {
    readonly #address: string;
    readonly #port: number;
    readonly #sourceAddress: string;
    readonly #token: string;
    readonly #client: HappyAgentClient;
    readonly #active = new Set<Destroyable>();
    #closed = false;

    constructor(options: RemoteHappyAgentClientOptions) {
        this.#address = options.address;
        this.#port = options.port;
        this.#sourceAddress = options.sourceAddress;
        this.#token = options.token;
        const endpoint = `http://${options.address}:${String(options.port)}/`;
        this.#client = new HappyAgentClient({
            endpoint,
            token: options.token,
            fetch: (input, init) => this.#fetch(input, init),
        });
    }

    health(signal?: AbortSignal): Promise<HealthResponse> {
        return this.#client.getHealth(signal ? { signal } : undefined);
    }

    getAgent(agentId: string, signal?: AbortSignal): Promise<AgentResponse> {
        return this.#client.getAgent(agentId as Cuid2, signal ? { signal } : undefined);
    }

    getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceResponse> {
        return this.#client.getWorkspace(workspaceId as Cuid2, signal ? { signal } : undefined);
    }

    readWorkspaceFile(
        workspaceId: string,
        filePath: string,
        signal?: AbortSignal,
    ): Promise<FileContentResponse> {
        return this.#client.readFile(
            workspaceId as Cuid2,
            filePath,
            signal ? { signal } : undefined,
        );
    }

    writeWorkspaceFile(
        workspaceId: string,
        request: WriteFileRequest,
        signal?: AbortSignal,
    ): Promise<WriteFileResponse> {
        return this.#client.writeFile(
            workspaceId as Cuid2,
            request,
            signal ? { signal } : undefined,
        );
    }

    rawRequest(options: {
        readonly method: string;
        readonly path: string;
        readonly body?: Buffer;
        readonly headers?: Readonly<Record<string, string>>;
        readonly signal?: AbortSignal;
    }): Promise<HappyAgentDaemonRawResponse> {
        this.#sourceRequire();
        const path = remotePath(options.path);
        return new Promise((resolvePromise, reject) => {
            if (options.signal?.aborted) {
                reject(abortedError());
                return;
            }
            const headers: Record<string, string | number> = {
                accept: "application/json",
                ...options.headers,
                authorization: `Bearer ${this.#token}`,
                host: `${this.#address}:${String(this.#port)}`,
            };
            if (options.body !== undefined) headers["content-length"] = options.body.byteLength;
            const request = httpRequest(
                {
                    host: this.#address,
                    port: this.#port,
                    localAddress: this.#sourceAddress,
                    headers,
                    method: options.method,
                    path,
                    agent: false,
                },
                (response) => {
                    this.#track(response);
                    resolvePromise({
                        statusCode: response.statusCode ?? 500,
                        headers: response.headers,
                        body: response,
                    });
                },
            );
            this.#track(request);
            const abort = () => request.destroy(abortedError());
            const cleanup = () => options.signal?.removeEventListener("abort", abort);
            options.signal?.addEventListener("abort", abort, { once: true });
            request.once("close", cleanup);
            request.once("error", reject);
            request.end(options.body);
        });
    }

    async openHttpProxy(agentId: string): Promise<Duplex> {
        const { agent } = await this.getAgent(agentId);
        return this.openWorkspaceHttpProxy(agent.workspaceId);
    }

    openWorkspaceHttpProxy(workspaceId: string): Promise<Duplex> {
        this.#sourceRequire();
        const path = `/v0/workspaces/${encodeURIComponent(workspaceId)}/proxy`;
        return new Promise((resolvePromise, reject) => {
            const request = httpRequest({
                host: this.#address,
                port: this.#port,
                localAddress: this.#sourceAddress,
                method: "CONNECT",
                path,
                agent: false,
                headers: {
                    authorization: `Bearer ${this.#token}`,
                    host: `${this.#address}:${String(this.#port)}`,
                },
            });
            this.#track(request);
            let settled = false;
            const fail = (statusCode: number | undefined, error?: Error): void => {
                if (settled) return;
                settled = true;
                reject(
                    error ??
                        new HappyAgentDaemonHttpError(
                            statusCode ?? 500,
                            `The remote Happy Agent browser proxy returned ${String(statusCode ?? 500)}.`,
                        ),
                );
            };
            request.once("connect", (response, socket, head) => {
                if (response.statusCode !== 200) {
                    socket.destroy();
                    fail(response.statusCode);
                    return;
                }
                if (settled || this.#closed) {
                    socket.destroy();
                    return;
                }
                settled = true;
                if (head.length > 0) socket.unshift(head);
                this.#track(socket);
                resolvePromise(socket);
            });
            request.once("response", (response) => {
                response.resume();
                fail(response.statusCode);
            });
            request.once("error", (error) => fail(undefined, error));
            request.end();
        });
    }

    attachTerminal(workspaceId: string, terminalId: string): Promise<Duplex> {
        this.#sourceRequire();
        const path = `/v0/workspaces/${encodeURIComponent(
            workspaceId,
        )}/terminals/${encodeURIComponent(terminalId)}/attach`;
        return new Promise((resolvePromise, reject) => {
            const socket = new WebSocket(
                `ws://${this.#address}:${String(this.#port)}${path}`,
                "happy2-terminal.v1",
                {
                    handshakeTimeout: 10_000,
                    headers: {
                        authorization: `Bearer ${this.#token}`,
                        host: `${this.#address}:${String(this.#port)}`,
                    },
                    localAddress: this.#sourceAddress,
                    maxPayload: HAPPY_AGENT_TERMINAL_MAX_WIRE_BYTES,
                    perMessageDeflate: false,
                },
            );
            const tracked: Destroyable = { destroy: () => socket.terminate() };
            this.#active.add(tracked);
            socket.once("close", () => this.#active.delete(tracked));
            let settled = false;
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true;
                socket.terminate();
                reject(error);
            };
            socket.once("error", fail);
            socket.once("unexpected-response", (_request, response) =>
                fail(
                    new HappyAgentDaemonHttpError(
                        response.statusCode ?? 500,
                        "The remote Happy Agent terminal attachment was refused.",
                    ),
                ),
            );
            socket.once("open", () => {
                if (settled || this.#closed) {
                    socket.terminate();
                    return;
                }
                settled = true;
                socket.removeListener("error", fail);
                resolvePromise(createWebSocketStream(socket, { allowHalfOpen: false }));
            });
        });
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        for (const active of this.#active) active.destroy(new Error("The remote Mac changed."));
        this.#active.clear();
    }

    async #fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const request = new Request(input, { ...init, redirect: "error" });
        const url = new URL(request.url);
        if (
            url.protocol !== "http:" ||
            url.hostname !== this.#address ||
            Number(url.port || 80) !== this.#port
        )
            throw new Error("The remote Happy Agent request changed destination.");
        const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
        const upstream = await this.rawRequest({
            method: request.method,
            path: `${url.pathname}${url.search}`,
            ...(body ? { body } : {}),
            headers: Object.fromEntries(request.headers.entries()),
            signal: request.signal,
        });
        const chunks: Buffer[] = [];
        await new Promise<void>((resolvePromise, reject) => {
            upstream.body.on("data", (chunk: Buffer | string) =>
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
            );
            upstream.body.once("error", reject);
            upstream.body.once("end", resolvePromise);
        });
        const headers = responseHeaders(upstream.headers);
        const payload = Buffer.concat(chunks);
        return new Response(payload.length === 0 ? null : new Uint8Array(payload), {
            headers,
            status: upstream.statusCode,
        });
    }

    #sourceRequire(): void {
        if (this.#closed) throw new Error("The remote Mac connection is closed.");
        personalRemoteMacTailnetAddressRequireLocal(this.#sourceAddress);
    }

    #track<T extends Destroyable>(value: T): T {
        if (this.#closed) {
            value.destroy(new Error("The remote Mac connection is closed."));
            return value;
        }
        this.#active.add(value);
        const evented = value as T & { once?: (event: string, listener: () => void) => void };
        evented.once?.("close", () => this.#active.delete(value));
        return value;
    }
}

function remotePath(path: string): string {
    const parsed = new URL(path, "http://remote");
    if (
        parsed.origin !== "http://remote" ||
        (parsed.pathname !== "/v0" && !parsed.pathname.startsWith("/v0/"))
    )
        throw new Error("Only Happy Agent /v0 routes may cross the remote bridge.");
    return `${parsed.pathname}${parsed.search}`;
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(input)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
    }
    return headers;
}

function abortedError(): Error {
    return new Error("The remote Happy Agent request was aborted.");
}
