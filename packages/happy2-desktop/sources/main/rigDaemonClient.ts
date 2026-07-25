import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
    EventId,
    GetSessionUsageResponse,
    GlobalEventQueueEntry,
    GlobalStateResponse,
    HealthResponse,
    ModelCatalog,
    Project,
    ProjectAssetResponse,
    ProtocolSession,
    RunShellCommandResponse,
    SessionEvent,
    SessionSummary,
    SubagentSummary,
} from "./rigDaemonTypes";

export interface RigDaemonClientOptions {
    readonly socketPath: string;
    readonly token: string;
}

export interface RigDaemonPaths {
    readonly socketPath: string;
    readonly tokenPath: string;
}

interface WatchSessionEventsOptions {
    readonly sessionId: string;
    readonly after?: EventId;
    readonly signal?: AbortSignal;
    readonly onEvent: (event: SessionEvent) => void | Promise<void>;
}

interface WatchGlobalEventsOptions {
    readonly after?: string;
    readonly signal?: AbortSignal;
    readonly onEvent: (entry: GlobalEventQueueEntry) => void | Promise<void>;
}

interface SessionResponse {
    readonly session: ProtocolSession;
}

/**
 * Narrow client for the local Rig daemon routes consumed by Happy's main-process
 * projection. Rig intentionally exposes these routes over an authenticated Unix
 * socket; keeping the adapter here avoids depending on its private client modules.
 */
export class RigDaemonClient {
    readonly socketPath: string;
    readonly #token: string;

    constructor(options: RigDaemonClientOptions) {
        this.socketPath = options.socketPath;
        this.#token = options.token;
    }

    health(): Promise<HealthResponse> {
        return this.#requestJson("GET", "/health");
    }

    models(): Promise<{ readonly catalog: ModelCatalog }> {
        return this.#requestJson("GET", "/models");
    }

    listSessions(): Promise<{ readonly sessions: readonly SessionSummary[] }> {
        return this.#requestJson("GET", "/sessions");
    }

    /**
     * The daemon's project/worktree catalog. It is read from `/state` rather than
     * from `/projects` because worktrees have no global listing route of their
     * own — only a per-project one — and one read of the whole catalog is both
     * cheaper and internally consistent compared with fanning out per project.
     */
    listCatalog(): Promise<GlobalStateResponse> {
        return this.#requestJson("GET", "/state");
    }

    /** Reads one project avatar's bytes so the loopback proxy can re-serve them. */
    getProjectAsset(assetHash: string): Promise<ProjectAssetResponse> {
        return this.#requestBuffer(`/project-assets/${encodeURIComponent(assetHash)}`);
    }

    getProject(projectId: string): Promise<{ readonly project: Project }> {
        return this.#requestJson("GET", `/projects/${encodeURIComponent(projectId)}`);
    }

    /**
     * Moves a project directly after `afterId`, or to the front when it is null.
     * The daemon guards the move with the project version it was read at, so a
     * caller that raced another writer is rejected rather than silently winning.
     */
    reorderProject(
        projectId: string,
        afterId: string | null,
        expectedVersion: number,
    ): Promise<{ readonly project: Project }> {
        return this.#requestJson(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/reorder`,
            { afterId },
            { "if-match": `"${String(expectedVersion)}"` },
        );
    }

    /**
     * Moves a session directly after `afterId` within its own project or
     * worktree, or to the front of that group when it is null. Sessions carry no
     * version, so the daemon resolves the move against its current order.
     */
    reorderSession(
        sessionId: string,
        afterId: string | null,
    ): Promise<{ readonly session: ProtocolSession }> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/reorder`, {
            afterId,
        });
    }

    getSession(sessionId: string): Promise<SessionResponse> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}`);
    }

    listSubagents(sessionId: string): Promise<{ readonly subagents: readonly SubagentSummary[] }> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/subagents`);
    }

    searchFiles(
        sessionId: string,
        query: string,
        limit = 20,
    ): Promise<{
        readonly files: readonly { readonly fileName: string; readonly path: string }[];
    }> {
        const parameters = new URLSearchParams({ limit: String(limit), query });
        return this.#requestJson(
            "GET",
            `/sessions/${encodeURIComponent(sessionId)}/files?${parameters.toString()}`,
        );
    }

    getSessionUsage(sessionId: string): Promise<GetSessionUsageResponse> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/usage`);
    }

    getEvents(
        sessionId: string,
        after?: EventId,
    ): Promise<{ readonly events: readonly SessionEvent[] }> {
        const suffix = after ? `?after=${encodeURIComponent(after)}` : "";
        return this.#requestJson(
            "GET",
            `/sessions/${encodeURIComponent(sessionId)}/events${suffix}`,
        );
    }

    createSession(request: Record<string, unknown>): Promise<SessionResponse> {
        return this.#requestJson("POST", "/sessions", request);
    }

    forkSession(sessionId: string): Promise<SessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/fork`);
    }

    archiveSession(sessionId: string): Promise<SessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/archive`);
    }

    reset(sessionId: string): Promise<SessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/reset`);
    }

    submitMessage(sessionId: string, request: Record<string, unknown>): Promise<unknown> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/messages`,
            request,
        );
    }

    steerMessage(sessionId: string, request: Record<string, unknown>): Promise<unknown> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/steer`,
            request,
        );
    }

    abort(sessionId: string, options: { readonly expectedRunId?: string } = {}): Promise<unknown> {
        const query = options.expectedRunId
            ? `?expectedRunId=${encodeURIComponent(options.expectedRunId)}`
            : "";
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/abort${query}`,
        );
    }

    compact(sessionId: string): Promise<unknown> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/compact`);
    }

    rewind(sessionId: string, messageId: string): Promise<SessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/rewind`, {
            messageId,
        });
    }

    runShellCommand(
        sessionId: string,
        request: { readonly command: string; readonly commandId: string },
    ): Promise<RunShellCommandResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/shell`,
            request,
        );
    }

    stopBackgroundProcess(sessionId: string, processId: number): Promise<unknown> {
        return this.#requestJson(
            "DELETE",
            `/sessions/${encodeURIComponent(sessionId)}/background-processes/${encodeURIComponent(String(processId))}`,
        );
    }

    answerUserInput(
        sessionId: string,
        requestId: string,
        request: { readonly answers: Record<string, readonly string[]> },
    ): Promise<SessionResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/user-input/${encodeURIComponent(requestId)}`,
            request,
        );
    }

    changeModel(sessionId: string, request: Record<string, unknown>): Promise<SessionResponse> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/model`,
            request,
        );
    }

    changeEffort(sessionId: string, request: Record<string, unknown>): Promise<SessionResponse> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/effort`,
            request,
        );
    }

    changePermissionMode(
        sessionId: string,
        request: Record<string, unknown>,
    ): Promise<SessionResponse> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/permissions`,
            request,
        );
    }

    changeServiceTier(
        sessionId: string,
        request: Record<string, unknown>,
    ): Promise<SessionResponse> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/service-tier`,
            request,
        );
    }

    async watchSessionEvents(options: WatchSessionEventsOptions): Promise<void> {
        let after = options.after;
        while (!options.signal?.aborted) {
            try {
                after = await this.#watchOnce({
                    path:
                        after === undefined
                            ? `/sessions/${encodeURIComponent(options.sessionId)}/stream`
                            : `/sessions/${encodeURIComponent(options.sessionId)}/stream?after=${encodeURIComponent(after)}`,
                    signal: options.signal,
                    parse: sessionEventParse,
                    cursor: (event) => event.id,
                    onEvent: options.onEvent,
                });
            } catch (error) {
                if (options.signal?.aborted) return;
                if (error instanceof RigDaemonHttpError && error.statusCode < 500) throw error;
                await retryDelay(options.signal);
            }
        }
    }

    async watchGlobalEvents(options: WatchGlobalEventsOptions): Promise<void> {
        let after = options.after;
        while (!options.signal?.aborted) {
            try {
                after = await this.#watchOnce({
                    path:
                        after === undefined
                            ? "/events/stream"
                            : `/events/stream?after=${encodeURIComponent(after)}`,
                    signal: options.signal,
                    parse: globalEventParse,
                    cursor: (entry) => entry.cursor,
                    onEvent: options.onEvent,
                });
            } catch (error) {
                if (options.signal?.aborted) return;
                if (error instanceof RigDaemonHttpError && error.statusCode < 500) throw error;
                await retryDelay(options.signal);
            }
        }
    }

    #requestJson<TResult>(
        method: string,
        path: string,
        body?: unknown,
        extraHeaders?: Record<string, string>,
    ): Promise<TResult> {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers: Record<string, string | number> = {
            accept: "application/json",
            authorization: `Bearer ${this.#token}`,
            ...extraHeaders,
        };
        if (payload !== undefined) {
            headers["content-length"] = Buffer.byteLength(payload);
            headers["content-type"] = "application/json; charset=utf-8";
        }
        return new Promise((resolvePromise, reject) => {
            const request = httpRequest(
                { headers, method, path, socketPath: this.socketPath },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk: Buffer | string) =>
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
                    );
                    response.on("end", () => {
                        const text = Buffer.concat(chunks).toString("utf8");
                        const statusCode = response.statusCode ?? 500;
                        if (statusCode >= 400) {
                            reject(
                                new RigDaemonHttpError(
                                    statusCode,
                                    text.length > 0 ? text : `Rig daemon HTTP ${statusCode}`,
                                ),
                            );
                            return;
                        }
                        try {
                            resolvePromise((text.length === 0 ? {} : JSON.parse(text)) as TResult);
                        } catch (error) {
                            reject(error);
                        }
                    });
                },
            );
            request.on("error", reject);
            if (payload !== undefined) request.write(payload);
            request.end();
        });
    }

    #requestBuffer(path: string): Promise<ProjectAssetResponse> {
        return new Promise((resolvePromise, reject) => {
            const request = httpRequest(
                {
                    headers: { authorization: `Bearer ${this.#token}` },
                    method: "GET",
                    path,
                    socketPath: this.socketPath,
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk: Buffer | string) =>
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
                    );
                    response.on("end", () => {
                        const statusCode = response.statusCode ?? 500;
                        const bytes = Buffer.concat(chunks);
                        if (statusCode >= 400) {
                            reject(
                                new RigDaemonHttpError(
                                    statusCode,
                                    bytes.length > 0
                                        ? bytes.toString("utf8")
                                        : `Rig daemon HTTP ${statusCode}`,
                                ),
                            );
                            return;
                        }
                        resolvePromise({
                            bytes,
                            mediaType:
                                response.headers["content-type"] ?? "application/octet-stream",
                        });
                    });
                },
            );
            request.on("error", reject);
            request.end();
        });
    }

    #watchOnce<TEvent, TCursor>(options: {
        readonly path: string;
        readonly signal?: AbortSignal;
        readonly parse: (raw: string) => TEvent | undefined;
        readonly cursor: (event: TEvent) => TCursor;
        readonly onEvent: (event: TEvent) => void | Promise<void>;
    }): Promise<TCursor | undefined> {
        return new Promise((resolvePromise, reject) => {
            let application = Promise.resolve();
            let cursor: TCursor | undefined;
            let settled = false;
            const settle = (error?: unknown) => {
                if (settled) return;
                settled = true;
                void application.then(
                    () => (error === undefined ? resolvePromise(cursor) : reject(error)),
                    reject,
                );
            };
            const request = httpRequest(
                {
                    headers: {
                        accept: "text/event-stream",
                        authorization: `Bearer ${this.#token}`,
                    },
                    method: "GET",
                    path: options.path,
                    socketPath: this.socketPath,
                },
                (response) => {
                    const statusCode = response.statusCode ?? 500;
                    if (statusCode >= 400) {
                        response.resume();
                        settle(
                            new RigDaemonHttpError(
                                statusCode,
                                `Rig daemon event stream returned HTTP ${statusCode}.`,
                            ),
                        );
                        return;
                    }
                    let buffer = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
                        if (settled) return;
                        buffer += chunk;
                        for (;;) {
                            const boundary = buffer.indexOf("\n\n");
                            if (boundary < 0) break;
                            const event = options.parse(buffer.slice(0, boundary));
                            buffer = buffer.slice(boundary + 2);
                            if (event === undefined) continue;
                            application = application.then(async () => {
                                await options.onEvent(event);
                                cursor = options.cursor(event);
                            });
                            void application.catch((error) => {
                                response.destroy();
                                settle(error);
                            });
                        }
                    });
                    response.on("end", () => settle());
                    response.on("error", settle);
                },
            );
            const abort = () => {
                request.destroy();
                settle();
            };
            options.signal?.addEventListener("abort", abort, { once: true });
            request.on("error", settle);
            request.end();
        });
    }
}

export function rigDaemonPathsResolve(
    environment: NodeJS.ProcessEnv = process.env,
    uid = process.getuid?.() ?? 0,
): RigDaemonPaths {
    const configuredDirectory = environment.RIG_SERVER_DIRECTORY?.trim();
    const directory = configuredDirectory
        ? isAbsolute(configuredDirectory)
            ? configuredDirectory
            : resolve(configuredDirectory)
        : join(tmpdir(), `rig-${uid}`);
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

/**
 * A daemon response the client could not use, carrying the HTTP status so callers
 * can tell a stale credential apart from a genuine daemon-side failure.
 */
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
 * True when the error means this client can no longer reach or authenticate to
 * the daemon it was created for, so the host must reconnect rather than retry.
 *
 * A restarted daemon is the common case and shows up two ways: the socket is
 * gone or was reset while a request was in flight, or the socket is back but the
 * token file was regenerated, so the daemon rejects this client's cached token
 * with 401/403. Both require a fresh connection that re-reads the token; only
 * the first is a transport error, which is why the status codes are included.
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

function sessionEventParse(raw: string): SessionEvent | undefined {
    return sseDataParse(raw) as SessionEvent | undefined;
}

function globalEventParse(raw: string): GlobalEventQueueEntry | undefined {
    if (raw.startsWith(":")) return undefined;
    const lines = raw.split("\n");
    const id = lines
        .find((line) => line.startsWith("id:"))
        ?.slice("id:".length)
        .trim();
    if (!id) return undefined;
    const event = sseDataParse(raw) as GlobalEventQueueEntry["event"] | undefined;
    return event ? { cursor: id, event } : undefined;
}

function sseDataParse(raw: string): unknown {
    if (raw.startsWith(":")) return undefined;
    const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart());
    return data.length === 0 ? undefined : JSON.parse(data.join("\n"));
}

function retryDelay(signal?: AbortSignal): Promise<void> {
    return new Promise((resolvePromise) => {
        if (signal?.aborted) {
            resolvePromise();
            return;
        }
        const timer = setTimeout(resolvePromise, 50);
        timer.unref();
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolvePromise();
            },
            { once: true },
        );
    });
}
