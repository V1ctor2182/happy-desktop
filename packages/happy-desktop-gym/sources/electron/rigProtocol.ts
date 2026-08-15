import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";

export const GYM_SESSION_PROVIDER_ID = "codex";
export const GYM_SESSION_MODEL_ID = "openai/gpt-5.6-sol";

export interface RigHealth {
    readonly identity?: { readonly version?: string };
    readonly [key: string]: unknown;
}

export interface RigProject {
    readonly id: string;
    readonly name?: string;
    readonly path: string;
    readonly archivedAt?: number;
    readonly [key: string]: unknown;
}

export interface RigWorkspace {
    readonly id: string;
    readonly projectId: string;
    readonly name?: string;
    readonly path: string;
    readonly status: string;
    readonly version?: number;
    readonly archivedAt?: number;
    readonly [key: string]: unknown;
}

export interface RigSessionSummary {
    readonly id: string;
    readonly cwd: string;
    readonly status?: string;
    readonly archived?: boolean;
    readonly sessionKind?: string;
    readonly scope?: unknown;
    readonly [key: string]: unknown;
}

export interface RigSession {
    readonly id: string;
    readonly status?: string;
    readonly [key: string]: unknown;
}

export interface RigCatalog {
    readonly projects?: readonly {
        readonly project?: RigProject;
        readonly workspaces?: readonly RigWorkspace[];
        readonly [key: string]: unknown;
    }[];
    readonly [key: string]: unknown;
}

export interface RigRawResponse {
    readonly statusCode: number;
    readonly headers: IncomingHttpHeaders;
    readonly body: string;
}

export interface RigSessionStreamEvent {
    readonly id?: string;
    readonly data: Record<string, unknown>;
    readonly receivedAt: string;
}

export interface RigSessionStreamHandle {
    /**
     * Resolves after the stream's hello frame has arrived. A caller can await
     * this before submitting work while still using `after` as the durable
     * recovery cursor.
     */
    readonly ready: Promise<void>;
    readonly done: Promise<void>;
    close(): void;
}

export class RigProtocolClient {
    readonly #socketPath: string;
    readonly #token: string;

    constructor(socketPath: string, token: string) {
        this.#socketPath = socketPath;
        this.#token = token;
    }

    health(): Promise<RigHealth> {
        return this.#jsonRequest("GET", "/health");
    }

    catalog(): Promise<RigCatalog> {
        return this.#jsonRequest("GET", "/catalog");
    }

    sessions(): Promise<{ readonly sessions: readonly RigSessionSummary[] }> {
        return this.#jsonRequest("GET", "/sessions?archived=all");
    }

    projects(): Promise<{ readonly projects: readonly RigProject[] }> {
        return this.#jsonRequest("GET", "/projects");
    }

    registerProject(path: string): Promise<{ readonly project: RigProject }> {
        return this.#jsonRequest("POST", "/projects", { path });
    }

    createWorkspace(
        projectId: string,
        name: string,
        baseRef = "HEAD",
    ): Promise<{ readonly workspace: RigWorkspace }> {
        return this.#jsonRequest("POST", `/projects/${encodeURIComponent(projectId)}/workspaces`, {
            name,
            baseRef,
        });
    }

    archiveWorkspace(
        projectId: string,
        workspace: RigWorkspace,
    ): Promise<{ readonly workspace: RigWorkspace }> {
        return this.#jsonRequest(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspace.id)}/archive`,
            {},
            workspace.version === undefined
                ? undefined
                : { "if-match": `"${String(workspace.version)}"` },
        );
    }

    listWorkspaces(projectId: string): Promise<{ readonly workspaces: readonly RigWorkspace[] }> {
        return this.#jsonRequest("GET", `/projects/${encodeURIComponent(projectId)}/workspaces`);
    }

    createSession(input: {
        readonly cwd: string;
        readonly workspaceId?: string;
    }): Promise<{ readonly session: RigSession }> {
        return this.#jsonRequest("POST", "/sessions", {
            cwd: input.cwd,
            ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
            modelId: GYM_SESSION_MODEL_ID,
            permissionMode: "full_access",
            providerId: GYM_SESSION_PROVIDER_ID,
            trackUnread: true,
        });
    }

    submitMessage(
        sessionId: string,
        text: string,
    ): Promise<{
        readonly eventId?: string;
        readonly runId?: string;
        readonly sessionId?: string;
    }> {
        return this.#jsonRequest("POST", `/sessions/${encodeURIComponent(sessionId)}/messages`, {
            clientSubmissionId: randomUUID(),
            text,
        });
    }

    compact(sessionId: string): Promise<Record<string, unknown>> {
        return this.#jsonRequest("POST", `/sessions/${encodeURIComponent(sessionId)}/compact`);
    }

    getSession(sessionId: string): Promise<{ readonly session: RigSession }> {
        return this.#jsonRequest("GET", `/sessions/${encodeURIComponent(sessionId)}`);
    }

    events(sessionId: string): Promise<{ readonly events: readonly Record<string, unknown>[] }> {
        return this.#jsonRequest("GET", `/sessions/${encodeURIComponent(sessionId)}/events`);
    }

    gitWatch(
        entities: readonly {
            readonly projectId: string;
            readonly workspaceId?: string;
        }[],
    ): Promise<Record<string, unknown>> {
        return this.#jsonRequest("POST", "/git/watch", { entities });
    }

    /**
     * Opens the daemon's actual per-session SSE stream. `rawRequest` buffers a
     * response and therefore cannot be used for this boundary. The caller owns
     * the connection and closes it after its run-specific barrier resolves.
     */
    sessionStream(
        sessionId: string,
        after: string | undefined,
        onEvent: (event: RigSessionStreamEvent) => void | Promise<void>,
    ): RigSessionStreamHandle {
        let settled = false;
        let readySettled = false;
        let request: ReturnType<typeof httpRequest> | undefined;
        let resolveReady!: () => void;
        let rejectReady!: (error: unknown) => void;
        let resolveDone!: () => void;
        let rejectDone!: (error: unknown) => void;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const done = new Promise<void>((resolve, reject) => {
            resolveDone = resolve;
            rejectDone = reject;
        });
        const markReady = (error?: unknown): void => {
            if (readySettled) return;
            readySettled = true;
            if (error === undefined) resolveReady();
            else rejectReady(error);
        };
        const settle = (error?: unknown): void => {
            if (settled) return;
            settled = true;
            if (error === undefined) {
                if (!readySettled) {
                    const readyError = new Error(
                        `Rig session stream ${sessionId} closed before its hello frame.`,
                    );
                    markReady(readyError);
                    rejectDone(readyError);
                    return;
                }
                resolveDone();
            } else {
                markReady(error);
                rejectDone(error);
            }
        };
        const path =
            after === undefined
                ? `/sessions/${encodeURIComponent(sessionId)}/stream`
                : `/sessions/${encodeURIComponent(sessionId)}/stream?after=${encodeURIComponent(after)}`;
        request = httpRequest(
            {
                headers: {
                    accept: "text/event-stream",
                    authorization: `Bearer ${this.#token}`,
                },
                method: "GET",
                path,
                socketPath: this.#socketPath,
            },
            (response) => {
                const statusCode = response.statusCode ?? 500;
                if (statusCode >= 400) {
                    response.resume();
                    settle(new Error(`Rig session stream returned HTTP ${statusCode}.`));
                    return;
                }
                response.setEncoding("utf8");
                let buffer = "";
                let application = Promise.resolve();
                response.on("data", (chunk: string) => {
                    if (settled) return;
                    buffer += chunk;
                    for (;;) {
                        const boundary = buffer.indexOf("\n\n");
                        if (boundary < 0) break;
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const parsed = sseFrameParse(frame);
                        if (parsed === undefined) continue;
                        if (parsed.eventName === "hello") {
                            markReady();
                            continue;
                        }
                        let payload: unknown;
                        try {
                            payload = JSON.parse(parsed.data);
                        } catch (error) {
                            request?.destroy();
                            settle(error);
                            return;
                        }
                        if (!isRecord(payload)) continue;
                        application = application
                            .then(() =>
                                onEvent({
                                    data: payload,
                                    id: parsed.id,
                                    receivedAt: new Date().toISOString(),
                                }),
                            )
                            .catch((error: unknown) => {
                                request?.destroy();
                                settle(error);
                            });
                    }
                });
                response.once("end", () => {
                    void application.then(() => settle(), settle);
                });
                response.once("error", settle);
            },
        );
        request.once("error", settle);
        request.end();
        return {
            ready,
            done,
            close: () => {
                request?.destroy();
                settle(
                    readySettled
                        ? undefined
                        : new Error(`Rig session stream ${sessionId} closed before it was ready.`),
                );
            },
        };
    }

    async waitForSessionIdle(
        sessionId: string,
        runId?: string,
        timeoutMs = 60_000,
    ): Promise<RigSession> {
        const deadline = Date.now() + timeoutMs;
        let last: RigSession | undefined;
        while (Date.now() < deadline) {
            last = (await this.getSession(sessionId)).session;
            if (runId === undefined) {
                if (
                    last.status === "completed" ||
                    last.status === "idle" ||
                    last.status === "error" ||
                    last.status === "aborted"
                ) {
                    return last;
                }
            } else {
                const events = await this.events(sessionId);
                const terminal =
                    events.events.some(
                        (event) =>
                            event.type === "run_finished" &&
                            isRecord(event.data) &&
                            event.data.runId === runId,
                    ) ||
                    events.events.some(
                        (event) =>
                            event.type === "run_error" &&
                            isRecord(event.data) &&
                            event.data.runId === runId,
                    );
                if (terminal) return last;
            }
            await delay(100);
        }
        throw new Error(
            `Timed out waiting for Rig session ${sessionId} to settle (last status ${String(last?.status)}).`,
        );
    }

    async waitForWorkspace(
        projectId: string,
        workspaceId: string,
        status: "ready" | "archived",
        timeoutMs = 60_000,
    ): Promise<RigWorkspace> {
        const deadline = Date.now() + timeoutMs;
        let last: RigWorkspace | undefined;
        while (Date.now() < deadline) {
            const result = await this.listWorkspaces(projectId);
            last = result.workspaces.find((candidate) => candidate.id === workspaceId);
            if (last?.status === status) return last;
            if (last?.status === "failed") {
                throw new Error(`Rig workspace ${workspaceId} failed: ${JSON.stringify(last)}`);
            }
            await delay(100);
        }
        throw new Error(
            `Timed out waiting for Rig workspace ${workspaceId} to become ${status}; last=${JSON.stringify(last)}`,
        );
    }

    async rawRequest(
        method: string,
        path: string,
        body?: unknown,
        headers?: Readonly<Record<string, string>>,
    ): Promise<RigRawResponse> {
        const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        return new Promise<RigRawResponse>((resolve, reject) => {
            const request = httpRequest(
                {
                    headers: {
                        accept: "application/json",
                        authorization: `Bearer ${this.#token}`,
                        ...(encoded === undefined ? {} : { "content-length": encoded.byteLength }),
                        ...headers,
                    },
                    method,
                    path,
                    socketPath: this.#socketPath,
                },
                async (response) => {
                    try {
                        resolve({
                            statusCode: response.statusCode ?? 500,
                            headers: response.headers,
                            body: await readBody(response),
                        });
                    } catch (error) {
                        reject(error);
                    }
                },
            );
            request.once("error", reject);
            if (encoded !== undefined) request.write(encoded);
            request.end();
        });
    }

    async #jsonRequest<T>(
        method: string,
        path: string,
        body?: unknown,
        headers?: Readonly<Record<string, string>>,
    ): Promise<T> {
        const response = await this.rawRequest(method, path, body, {
            "content-type": "application/json",
            ...headers,
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(
                `Rig ${method} ${path} failed with HTTP ${response.statusCode}: ${response.body.slice(0, 2_000)}`,
            );
        }
        return JSON.parse(response.body) as T;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function sseFrameParse(
    frame: string,
): { readonly data: string; readonly eventName?: string; readonly id?: string } | undefined {
    const data: string[] = [];
    let eventName: string | undefined;
    let id: string | undefined;
    for (const rawLine of frame.split("\n")) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
        else if (line.startsWith("id:")) id = line.slice("id:".length).trim();
        else if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
    }
    if (data.length === 0) return undefined;
    return { data: data.join("\n"), eventName, id };
}

async function readBody(response: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
