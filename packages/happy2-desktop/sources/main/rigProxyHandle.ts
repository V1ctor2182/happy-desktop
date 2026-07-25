import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import type {
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionCreateInput,
} from "happy2-state";
import { rigDaemonConnectionUnavailable, type RigDaemonClient } from "./rigDaemonClient";
import type { EventId } from "./rigDaemonTypes";
import { rigDaemonHealthProject } from "./rigHttpProxy";
import {
    rigCatalogProject,
    rigGlobalEventProject,
    rigSessionEventProject,
    rigSessionProject,
    rigSessionSummaryProject,
    rigSessionUsageProject,
    rigShellResultProject,
    rigSubagentProject,
} from "./rigProjection";

/** The subset of the daemon client the projected loopback surface calls. */
export type RigProxyClient = Pick<
    RigDaemonClient,
    | "health"
    | "models"
    | "listSessions"
    | "getSession"
    | "listSubagents"
    | "searchFiles"
    | "getSessionUsage"
    | "getEvents"
    | "createSession"
    | "forkSession"
    | "reset"
    | "submitMessage"
    | "steerMessage"
    | "abort"
    | "compact"
    | "rewind"
    | "runShellCommand"
    | "stopBackgroundProcess"
    | "answerUserInput"
    | "changeModel"
    | "changeEffort"
    | "changePermissionMode"
    | "changeServiceTier"
    | "watchSessionEvents"
    | "watchGlobalEvents"
>;

export interface RigProxyHandleOptions {
    readonly client: RigProxyClient;
    readonly method: string;
    /** Request path with any host prefix and query string already stripped. */
    readonly path: string;
    readonly query: URLSearchParams;
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    /**
     * Invoked when a route fails because this client can no longer reach or
     * authenticate to the daemon — an unreachable socket or a token the daemon
     * rejects after a restart — so the host can rebuild the connection. Errors
     * the daemon itself reports (a bad session id, a refused action) are answered
     * as ordinary error statuses and never trigger it.
     */
    readonly onConnectionError?: (error: unknown) => void;
    /** Home directory used to compute home-relative `displayCwd`s. Defaults to the OS home. */
    readonly homeDir?: string;
}

/**
 * The single request handler behind the loopback Rig proxy, shared by the packaged
 * Electron `node:http` server and the Vite dev-server middleware. It maps the
 * renderer transport's JSON/SSE routes onto the authenticated `ProtocolHttpClient`
 * and returns only already-projected `happy2-state` shapes, so no `@slopus` wire
 * type ever crosses to the renderer. Returns `true` when it owned the request; a
 * `false` result lets the caller fall through (404 for the Node server, `next()`
 * for the Vite middleware).
 */
export async function rigProxyHandle(options: RigProxyHandleOptions): Promise<boolean> {
    const { client, method, path, query, request, response } = options;
    const home = options.homeDir ?? homedir();
    const segments = path.split("/").filter((segment) => segment.length > 0);

    try {
        if (method === "GET") {
            if (path === "/health") {
                await handleHealth(client, response, options.onConnectionError);
                return true;
            }
            if (path === "/models") {
                writeJson(response, 200, rigCatalogProject((await client.models()).catalog));
                return true;
            }
            if (path === "/sessions") {
                const sessions = (await client.listSessions()).sessions.map((summary) =>
                    rigSessionSummaryProject(summary, home),
                );
                writeJson(response, 200, sessions);
                return true;
            }
            if (path === "/events/stream") {
                await streamGlobalEvents(
                    client,
                    request,
                    response,
                    query,
                    home,
                    options.onConnectionError,
                );
                return true;
            }
            if (segments[0] === "sessions" && segments[1]) {
                const sessionId = segments[1];
                if (segments.length === 2) {
                    writeJson(
                        response,
                        200,
                        rigSessionProject((await client.getSession(sessionId)).session, home),
                    );
                    return true;
                }
                if (segments[2] === "subagents" && segments.length === 3) {
                    const subagents = (await client.listSubagents(sessionId)).subagents.map(
                        rigSubagentProject,
                    );
                    writeJson(response, 200, subagents);
                    return true;
                }
                if (segments[2] === "files" && segments.length === 3) {
                    const search = query.get("q") ?? "";
                    const limitParam = query.get("limit");
                    const limit = limitParam ? Number(limitParam) : undefined;
                    const files = (
                        await client.searchFiles(
                            sessionId,
                            search,
                            Number.isFinite(limit) ? limit : undefined,
                        )
                    ).files.map((file) => ({ fileName: file.fileName, path: file.path }));
                    writeJson(response, 200, files);
                    return true;
                }
                if (segments[2] === "usage" && segments.length === 3) {
                    writeJson(
                        response,
                        200,
                        rigSessionUsageProject(await client.getSessionUsage(sessionId)),
                    );
                    return true;
                }
                if (segments[2] === "events" && segments.length === 3) {
                    const after = query.get("after") ?? undefined;
                    const events = (
                        await client.getEvents(sessionId, after as EventId | undefined)
                    ).events.flatMap((event) => {
                        const projected = rigSessionEventProject(event, home);
                        return projected ? [projected] : [];
                    });
                    writeJson(response, 200, events);
                    return true;
                }
                if (segments[2] === "events" && segments[3] === "stream" && segments.length === 4) {
                    await streamSessionEvents(
                        client,
                        request,
                        response,
                        sessionId,
                        query,
                        home,
                        options.onConnectionError,
                    );
                    return true;
                }
            }
            return false;
        }

        if (method === "POST" && segments[0] === "sessions") {
            const body = await bodyReadJson(request);
            if (segments.length === 1) {
                const session = await client.createSession(
                    createRequest(body as unknown as RigSessionCreateInput),
                );
                writeJson(response, 200, rigSessionProject(session.session, home));
                return true;
            }
            const sessionId = segments[1]!;
            const action = segments[2];
            if (segments.length !== 3) return false;
            const handled = await handleSessionPost(
                client,
                sessionId,
                action!,
                body,
                response,
                home,
            );
            return handled;
        }

        return false;
    } catch (error) {
        if (rigDaemonConnectionUnavailable(error)) options.onConnectionError?.(error);
        if (!response.headersSent) {
            writeJson(response, 502, { error: errorMessage(error) });
        } else {
            response.end();
        }
        return true;
    }
}

async function handleSessionPost(
    client: RigProxyClient,
    sessionId: string,
    action: string,
    body: Record<string, unknown>,
    response: ServerResponse,
    home: string,
): Promise<boolean> {
    switch (action) {
        case "fork":
            writeJson(
                response,
                200,
                rigSessionProject((await client.forkSession(sessionId)).session, home),
            );
            return true;
        case "reset":
            writeJson(
                response,
                200,
                rigSessionProject((await client.reset(sessionId)).session, home),
            );
            return true;
        case "messages":
            await client.submitMessage(sessionId, {
                text: String(body.text ?? ""),
                clientSubmissionId: String(body.idempotencyKey ?? ""),
            });
            writeJson(response, 200, {});
            return true;
        case "steer":
            await client.steerMessage(sessionId, {
                text: String(body.text ?? ""),
                clientSubmissionId: String(body.idempotencyKey ?? ""),
                ...(body.expectedRunId ? { expectedRunId: String(body.expectedRunId) } : {}),
            });
            writeJson(response, 200, {});
            return true;
        case "abort":
            await client.abort(
                sessionId,
                body.expectedRunId ? { expectedRunId: String(body.expectedRunId) } : {},
            );
            writeJson(response, 200, {});
            return true;
        case "compact":
            await client.compact(sessionId);
            writeJson(response, 200, {});
            return true;
        case "rewind":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (await client.rewind(sessionId, String(body.messageId ?? ""))).session,
                    home,
                ),
            );
            return true;
        case "shell": {
            const result = await client.runShellCommand(sessionId, {
                command: String(body.command ?? ""),
                commandId: String(body.commandId ?? ""),
            });
            writeJson(response, 200, rigShellResultProject(result));
            return true;
        }
        case "stopBackgroundProcess":
            await client.stopBackgroundProcess(sessionId, Number(body.processId));
            writeJson(response, 200, {});
            return true;
        case "answerInput":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.answerUserInput(sessionId, String(body.requestId ?? ""), {
                            answers: (body.answers ?? {}) as Record<string, readonly string[]>,
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        case "model": {
            const input = body as unknown as RigModelSelection;
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeModel(sessionId, {
                            modelId: input.modelId,
                            ...(input.providerId ? { providerId: input.providerId } : {}),
                            ...(input.effort ? { effort: input.effort } : {}),
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        }
        case "effort":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeEffort(
                            sessionId,
                            body.effort ? { effort: String(body.effort) } : {},
                        )
                    ).session,
                    home,
                ),
            );
            return true;
        case "permissionMode":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changePermissionMode(sessionId, {
                            permissionMode: body.permissionMode as RigPermissionMode,
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        case "serviceTier":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeServiceTier(
                            sessionId,
                            body.serviceTier
                                ? { serviceTier: body.serviceTier as RigServiceTier }
                                : {},
                        )
                    ).session,
                    home,
                ),
            );
            return true;
        default:
            return false;
    }
}

async function handleHealth(
    client: RigProxyClient,
    response: ServerResponse,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    try {
        writeJson(response, 200, rigDaemonHealthProject(await client.health()));
    } catch (error) {
        // A transport failure means the daemon is unreachable; ask the host to
        // restart it and answer 503 so the loader disconnects and backs off.
        onConnectionError?.(error);
        writeJson(response, 503, { error: errorMessage(error) });
    }
}

async function streamSessionEvents(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string,
    query: URLSearchParams,
    home: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    request.on("close", () => controller.abort());
    sseStart(response);
    const after = query.get("after") ?? undefined;
    try {
        await client.watchSessionEvents({
            sessionId,
            ...(after ? { after: after as EventId } : {}),
            signal: controller.signal,
            onEvent: (event) => {
                const projected = rigSessionEventProject(event, home);
                if (projected) sseSend(response, projected);
            },
        });
    } catch (error) {
        if (controller.signal.aborted) return;
        // A dropped stream is how a restarted daemon usually announces itself, so
        // report it before the reader sees the terminal error event.
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        sseSend(response, { error: errorMessage(error) }, "error");
    } finally {
        response.end();
    }
}

async function streamGlobalEvents(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    query: URLSearchParams,
    home: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    request.on("close", () => controller.abort());
    sseStart(response);
    const afterRaw = query.get("after");
    const after = afterRaw !== null ? Number(afterRaw) : undefined;
    try {
        await client.watchGlobalEvents({
            ...(after !== undefined && Number.isFinite(after) ? { after } : {}),
            signal: controller.signal,
            onEvent: (entry) => {
                const projected = rigGlobalEventProject(entry, home);
                if (projected) sseSend(response, projected);
            },
        });
    } catch (error) {
        if (controller.signal.aborted) return;
        // A dropped stream is how a restarted daemon usually announces itself, so
        // report it before the reader sees the terminal error event.
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        sseSend(response, { error: errorMessage(error) }, "error");
    } finally {
        response.end();
    }
}

function createRequest(input: RigSessionCreateInput) {
    return {
        cwd: input.cwd,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    };
}

function sseStart(response: ServerResponse): void {
    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
    });
    // An initial comment opens the stream so the client's EventSource fires open.
    response.write(":ok\n\n");
}

function sseSend(response: ServerResponse, data: unknown, event?: string): void {
    if (event) response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

async function bodyReadJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 512 * 1024) throw new Error("The request body is too large.");
    }
    if (body.trim().length === 0) return {};
    return JSON.parse(body) as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
