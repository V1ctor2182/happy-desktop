import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import type {
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionCreateInput,
} from "happy2-state";
import {
    rigDaemonConnectionUnavailable,
    RigDaemonHttpError,
    type RigDaemonClient,
} from "./rigDaemonClient";
import type { EventId } from "./rigDaemonTypes";
import { rigDaemonHealthProject } from "./rigHttpProxy";
import {
    rigCatalogProject,
    rigGlobalEventProject,
    rigProjectProject,
    rigSessionEventProject,
    rigSessionProject,
    rigSessionSummaryProject,
    rigSessionUsageProject,
    rigShellResultProject,
    rigSubagentProject,
    rigTerminalProject,
    rigWorktreeProject,
} from "./rigProjection";

/** The subset of the daemon client the projected loopback surface calls. */
export type RigProxyClient = Pick<
    RigDaemonClient,
    | "health"
    | "models"
    | "listSessions"
    | "listCatalog"
    | "gitWatch"
    | "getProject"
    | "getProjectAsset"
    | "listWorkspaces"
    | "createWorkspace"
    | "archiveWorkspace"
    | "reorderWorkspace"
    | "reorderProject"
    | "archiveProject"
    | "reorderSession"
    | "getSession"
    | "listSubagents"
    | "searchFiles"
    | "getSessionUsage"
    | "getEvents"
    | "archiveSession"
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
    | "createTerminal"
    | "stopTerminal"
    | "answerUserInput"
    | "changeModel"
    | "changeEffort"
    | "changePermissionMode"
    | "changeServiceTier"
    | "setSessionDraft"
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
            if (path === "/projects") {
                const catalog = await client.listCatalog();
                // The daemon keeps archived projects in its catalog read — a
                // project is only a folder, and it comes back by being used
                // again — so leaving them out is this projection's job. Their
                // worktrees fall away with them, since the list is built by
                // walking projects.
                const projects = catalog.projects.filter(
                    (project) => project.archivedAt === undefined,
                );
                const listed = new Set(projects.map((project) => project.id));
                const workspaces = catalog.workspaces.filter((workspace) =>
                    listed.has(workspace.projectId),
                );
                const watched = await client.gitWatch([
                    ...projects.map((project) => ({ projectId: project.id })),
                    ...workspaces.map((workspace) => ({
                        projectId: workspace.projectId,
                        workspaceId: workspace.id,
                    })),
                ]);
                const projectChanges = new Map<string, number>();
                const workspaceChanges = new Map<string, number>();
                for (const event of watched.snapshots) {
                    if (event.type === "project_git_changed")
                        projectChanges.set(event.projectId, event.data.git.changedFiles);
                    else workspaceChanges.set(event.workspaceId, event.data.git.changedFiles);
                }
                writeJson(response, 200, {
                    projects: projects.map((project) =>
                        rigProjectProject(
                            {
                                ...project,
                                changedFiles: projectChanges.get(project.id),
                            },
                            home,
                        ),
                    ),
                    worktrees: workspaces.map((workspace) =>
                        rigWorktreeProject(
                            {
                                ...workspace,
                                changedFiles: workspaceChanges.get(workspace.id),
                            },
                            home,
                        ),
                    ),
                });
                return true;
            }
            if (segments[0] === "project-assets" && segments.length === 2) {
                // Re-served rather than linked so the renderer never needs the
                // daemon's socket or its bearer token to paint a project row.
                const asset = await client.getProjectAsset(segments[1]!);
                response.writeHead(200, {
                    "content-type": asset.mediaType,
                    "content-length": String(asset.bytes.byteLength),
                    "cache-control": "public, max-age=31536000, immutable",
                });
                response.end(asset.bytes);
                return true;
            }
            if (path === "/sessions") {
                // The daemon owns both the arrangement and leaving archived
                // sessions out, and already lists them in fractional-index
                // order, so this forwards its listing rather than re-sorting it.
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

        if (method === "POST" && segments[0] === "projects" && segments[1]) {
            const projectId = segments[1];
            if (segments[2] === "reorder" && segments.length === 3) {
                const body = await bodyReadJson(request);
                const afterId = afterIdOf(body);
                await projectGuarded(client, projectId, (version) =>
                    client.reorderProject(projectId, afterId, version),
                );
                writeJson(response, 200, {});
                return true;
            }
            if (segments[2] === "archive" && segments.length === 3) {
                await projectGuarded(client, projectId, (version) =>
                    client.archiveProject(projectId, version),
                );
                writeJson(response, 200, {});
                return true;
            }
            if (segments[2] === "worktrees" && segments.length === 3) {
                const body = await bodyReadJson(request);
                const created = await client.createWorkspace(projectId, {
                    // `HEAD` is what the reader is looking at: a worktree started
                    // from the project's current commit, which is what "new
                    // worktree here" means without asking for a branch first.
                    baseRef: typeof body.baseRef === "string" ? body.baseRef : "HEAD",
                    clientRequestId: String(body.idempotencyKey ?? ""),
                    name: typeof body.name === "string" ? body.name : "Workspace",
                });
                writeJson(response, 200, rigWorktreeProject(created.workspace, home));
                return true;
            }
            if (segments[2] === "worktrees" && segments[3] && segments.length === 5) {
                const worktreeId = segments[3];
                if (segments[4] === "archive") {
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.archiveWorkspace(projectId, worktreeId, version),
                    );
                    writeJson(response, 200, {});
                    return true;
                }
                if (segments[4] === "reorder") {
                    const body = await bodyReadJson(request);
                    const afterId = afterIdOf(body);
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.reorderWorkspace(projectId, worktreeId, afterId, version),
                    );
                    writeJson(response, 200, {});
                    return true;
                }
            }
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

/** The daemon's user-message content blocks, as this proxy composes them. */
type ContentBlock =
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly mediaType: string; readonly data: string };

/**
 * The daemon content blocks one submitted turn carries beyond its text. A local
 * turn has no upload step, so an attached image travels as base64 alongside the
 * text block; a turn with no images sends no `content` at all and the daemon
 * builds the message from `text` as before.
 */
function contentOf(body: Record<string, unknown>): {
    readonly content?: readonly ContentBlock[];
} {
    const images = Array.isArray(body.images) ? body.images : [];
    const blocks: ContentBlock[] = [];
    for (const image of images) {
        if (typeof image !== "object" || image === null) continue;
        const { mediaType, data } = image as { mediaType?: unknown; data?: unknown };
        if (typeof mediaType !== "string" || typeof data !== "string") continue;
        blocks.push({ type: "image", mediaType, data });
    }
    if (blocks.length === 0) return {};
    return { content: [{ type: "text", text: String(body.text ?? "") }, ...blocks] };
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
        case "archive":
            writeJson(
                response,
                200,
                rigSessionProject((await client.archiveSession(sessionId)).session, home),
            );
            return true;
        case "reorder":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (await client.reorderSession(sessionId, afterIdOf(body))).session,
                    home,
                ),
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
                ...contentOf(body),
            });
            writeJson(response, 200, {});
            return true;
        case "steer":
            await client.steerMessage(sessionId, {
                text: String(body.text ?? ""),
                clientSubmissionId: String(body.idempotencyKey ?? ""),
                ...(body.expectedRunId ? { expectedRunId: String(body.expectedRunId) } : {}),
                ...contentOf(body),
            });
            writeJson(response, 200, {});
            return true;
        case "draft":
            await client.setSessionDraft(sessionId, {
                draft: typeof body.draft === "string" && body.draft.length > 0 ? body.draft : null,
                origin: String(body.origin ?? ""),
                updatedAt: Number(body.updatedAt),
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
        case "createTerminal": {
            // The size is the only thing the renderer decides: the shell and the
            // working directory are the daemon's, so a terminal opened here is the
            // user's own shell in the session it belongs to.
            const created = await client.createTerminal(sessionId, {
                cols: Number(body.cols),
                rows: Number(body.rows),
            });
            writeJson(response, 200, rigTerminalProject(created.terminal));
            return true;
        }
        case "stopTerminal":
            await client.stopTerminal(sessionId, String(body.terminalId ?? ""));
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
    const after = query.get("after") ?? undefined;
    try {
        await client.watchGlobalEvents({
            ...(after !== undefined ? { after } : {}),
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

/** The `afterId` of a reorder request: a preceding id, or null for the front. */
function afterIdOf(body: Record<string, unknown>): string | null {
    return typeof body.afterId === "string" ? body.afterId : null;
}

/**
 * Runs one version-guarded worktree action, reading the version the same way the
 * project routes do and retrying once against whichever version won a race.
 */
async function worktreeGuarded(
    client: RigProxyClient,
    projectId: string,
    worktreeId: string,
    run: (version: number) => Promise<unknown>,
): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
        const { workspaces } = await client.listWorkspaces(projectId);
        const worktree = workspaces.find((candidate) => candidate.id === worktreeId);
        if (worktree === undefined) throw new Error("The worktree no longer exists.");
        try {
            await run(worktree.version);
            return;
        } catch (error) {
            if (attempt >= 1 || !(error instanceof RigDaemonHttpError) || error.statusCode !== 409)
                throw error;
        }
    }
}

/**
 * Runs one project mutation, supplying the version guard the daemon requires.
 * The version has to be read here rather than sent by the renderer: it is an
 * optimistic concurrency token of the wire protocol, and letting it reach
 * product state would make every project row carry a value only these calls can
 * use. A losing race answers 409, which is retried once against the version that
 * won.
 */
async function projectGuarded(
    client: RigProxyClient,
    projectId: string,
    run: (version: number) => Promise<unknown>,
): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
        const { project } = await client.getProject(projectId);
        try {
            await run(project.version);
            return;
        } catch (error) {
            if (attempt >= 1 || !(error instanceof RigDaemonHttpError) || error.statusCode !== 409)
                throw error;
        }
    }
}

function createRequest(input: RigSessionCreateInput) {
    return {
        cwd: input.cwd,
        // A session started from this app is one the user opened a window on, so
        // it stays listed after it settles. Only sessions started elsewhere (the
        // TUI asks for this) archive themselves once idle, and the workspace
        // list hides exactly those.
        archiveOnIdle: false,
        ...(input.worktreeId ? { workspaceId: input.worktreeId } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
        permissionMode: input.permissionMode ?? "auto",
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
