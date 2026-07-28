import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
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
import type { EventId, GitChangedFile } from "./rigDaemonTypes";
import { openInRun, openInTargetsRead } from "./openIn";
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

interface GitExecOptions {
    readonly cwd: string;
    readonly maxBuffer: number;
    readonly timeout: number;
}

function gitExecText(args: string[], options: GitExecOptions): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        execFileCallback("git", args, { ...options, encoding: "utf8" }, (error, stdout) => {
            if (error) reject(error);
            else resolvePromise(stdout);
        });
    });
}

function gitExecBuffer(args: string[], options: GitExecOptions): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
        execFileCallback("git", args, { ...options, encoding: "buffer" }, (error, stdout) => {
            if (error) reject(error);
            else resolvePromise(stdout);
        });
    });
}

interface GitLineStats {
    readonly addedLines: number;
    readonly deletedLines: number;
    readonly changes: readonly GitChangedFile[];
}

function gitChangedFilesParse(output: string): readonly Omit<GitChangedFile, "revision">[] {
    const records = output.split("\0");
    const changes: Omit<GitChangedFile, "revision">[] = [];
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (!record || record.length < 4) continue;
        const code = record.slice(0, 2);
        const path = record.slice(3);
        const status: GitChangedFile["status"] =
            code === "??"
                ? "untracked"
                : code.includes("D")
                  ? "deleted"
                  : code.includes("R") || code.includes("C")
                    ? "renamed"
                    : code.includes("A")
                      ? "added"
                      : "modified";
        // Porcelain -z writes the original path as the next NUL record for a
        // rename/copy; the destination above is the path the panel should open.
        const renamed = code.includes("R") || code.includes("C");
        const previousPath = renamed ? records[index + 1] : undefined;
        changes.push({ path, status, ...(previousPath ? { previousPath } : {}) });
        if (renamed) index += 1;
    }
    return changes;
}

async function gitChangedFilesRevise(
    root: string,
    changes: readonly Omit<GitChangedFile, "revision">[],
): Promise<readonly GitChangedFile[]> {
    return Promise.all(
        changes.map(async (change) => {
            try {
                const details = await stat(resolve(root, change.path));
                return {
                    ...change,
                    revision: `${String(details.mtimeMs)}:${String(details.size)}`,
                };
            } catch {
                return { ...change, revision: change.status };
            }
        }),
    );
}

/**
 * Reads the checkout's aggregate textual diff against HEAD. A failed or
 * unavailable Git read leaves the stats absent so listing projects remains
 * available even while a checkout is being initialized or removed.
 */
async function gitLineStatsRead(path: string): Promise<GitLineStats | undefined> {
    try {
        const [stdout, statusOutput] = await Promise.all([
            gitExecText(["diff", "--numstat", "HEAD", "--"], {
                cwd: path,
                maxBuffer: 4 * 1024 * 1024,
                timeout: 5_000,
            }),
            gitExecText(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
                cwd: path,
                maxBuffer: 4 * 1024 * 1024,
                timeout: 5_000,
            }),
        ]);
        let addedLines = 0;
        let deletedLines = 0;
        for (const line of stdout.split("\n")) {
            const [added, deleted] = line.split("\t", 2);
            if (added !== undefined && added !== "-") addedLines += Number(added);
            if (deleted !== undefined && deleted !== "-") deletedLines += Number(deleted);
        }
        return {
            addedLines,
            deletedLines,
            changes: await gitChangedFilesRevise(path, gitChangedFilesParse(statusOutput)),
        };
    } catch {
        return undefined;
    }
}

/**
 * Cap on how many paths one workspace listing returns. A repository can hold far
 * more files than anyone can scan, and shipping all of them would cost more in
 * transfer and rendering than the tail is worth. The listing says when it was
 * truncated so the panel can admit it rather than quietly showing part of a
 * repository as if it were the whole one.
 */
const WORKSPACE_FILE_LIMIT = 20_000;

/**
 * Every file Git tracks in a checkout, plus the untracked ones it does not
 * ignore — which is what "all files" means to someone looking at a working
 * tree. Asking Git rather than walking the directory means .gitignore, nested
 * ignore files, and the exclusion of .git itself are all already handled, and
 * handled the same way the changed-file list handles them.
 */
async function workspaceFilesRead(
    client: RigProxyClient,
    groupId: string,
): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
    const catalog = await client.listCatalog();
    const project = catalog.projects.find((candidate) => candidate.id === groupId);
    const workspace = catalog.workspaces.find((candidate) => candidate.id === groupId);
    const root = project?.path ?? workspace?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    let stdout: string;
    try {
        stdout = await gitExecText(
            ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 10_000 },
        );
    } catch {
        // A directory that is not a repository has no listing to give, and that
        // is an ordinary state rather than a failure: the panel shows nothing
        // under "All files" and the changed list beside it is empty too.
        return { paths: [], truncated: false };
    }
    const all = stdout.split("\0").filter((entry) => entry.length > 0);
    all.sort((left, right) => left.localeCompare(right));
    return {
        paths: all.slice(0, WORKSPACE_FILE_LIMIT),
        truncated: all.length > WORKSPACE_FILE_LIMIT,
    };
}

const CHANGED_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Writes one changed file back to the checkout it came from.
 *
 * Validated exactly as reading it is, and for the same reason: the path is
 * relative, resolved against a root this process looks up from the daemon's
 * catalog, and the resolved real path must still be inside that root. A write
 * is the more consequential direction, so it additionally refuses a path that
 * does not already exist — this edits a file the reader was shown, and it is
 * not a way to create one.
 */
async function changedFileWrite(
    client: RigProxyClient,
    groupId: string,
    filePath: string,
    content: string,
): Promise<void> {
    if (!filePath || isAbsolute(filePath)) throw new Error("The changed file path is invalid.");
    if (content.length > CHANGED_FILE_MAX_BYTES)
        throw new Error("This file is too large to save from the editor.");
    const catalog = await client.listCatalog();
    const project = catalog.projects.find((candidate) => candidate.id === groupId);
    const workspace = catalog.workspaces.find((candidate) => candidate.id === groupId);
    const root = project?.path ?? workspace?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    const target = resolve(root, filePath);
    if (!pathInside(root, target)) throw new Error("The changed file path leaves its workspace.");
    const canonical = await realpath(target);
    if (!pathInside(await realpath(root), canonical))
        throw new Error("The changed file path leaves its workspace.");
    await writeFile(canonical, content, "utf8");
}

function changedFileText(bytes: Buffer): string {
    if (bytes.byteLength > CHANGED_FILE_MAX_BYTES)
        throw new Error("This file is too large to open in the editor.");
    if (bytes.includes(0)) throw new Error("Binary files cannot be opened in the editor.");
    return bytes.toString("utf8");
}

function pathInside(root: string, candidate: string): boolean {
    const fromRoot = relative(root, candidate);
    return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

async function changedFileRead(
    client: RigProxyClient,
    groupId: string,
    filePath: string,
): Promise<{
    readonly path: string;
    readonly oldPath: string;
    readonly oldContent: string;
    readonly newContent: string;
}> {
    if (!filePath || isAbsolute(filePath)) throw new Error("The changed file path is invalid.");
    const catalog = await client.listCatalog();
    const project = catalog.projects.find((candidate) => candidate.id === groupId);
    const workspace = catalog.workspaces.find((candidate) => candidate.id === groupId);
    const root = project?.path ?? workspace?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    const git = await gitLineStatsRead(root);
    const change = git?.changes.find((candidate) => candidate.path === filePath);
    if (!change) throw new Error("That file is no longer changed.");
    const target = resolve(root, filePath);
    if (!pathInside(root, target)) throw new Error("The changed file path leaves its workspace.");

    let newContent = "";
    if (change.status !== "deleted") {
        try {
            const canonical = await realpath(target);
            if (!pathInside(await realpath(root), canonical))
                throw new Error("The changed file path leaves its workspace.");
            newContent = changedFileText(await readFile(canonical));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }

    const oldPath = change.previousPath ?? filePath;
    let oldContent = "";
    if (change.status !== "added" && change.status !== "untracked") {
        const stdout = await gitExecBuffer(["show", `HEAD:${oldPath}`], {
            cwd: root,
            maxBuffer: CHANGED_FILE_MAX_BYTES,
            timeout: 5_000,
        });
        oldContent = changedFileText(stdout);
    }
    return { path: filePath, oldPath, oldContent, newContent };
}

/** The subset of the daemon client the projected loopback surface calls. */
export type RigProxyClient = Pick<
    RigDaemonClient,
    | "health"
    | "rawRequest"
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
    | "renameProject"
    | "renameWorkspace"
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
 * renderer transport's JSON/SSE routes onto the authenticated `ProtocolHttpClient`.
 * Ordinary routes return projected `happy2-state` shapes; the explicit
 * `rig-connect` routes preserve the connector's raw stream, JSON, conditional
 * request, and response contract. Returns `true` when it owned the request; a
 * `false` result lets the caller fall through (404 for the Node server, `next()`
 * for Vite middleware).
 */
export async function rigProxyHandle(options: RigProxyHandleOptions): Promise<boolean> {
    const { client, method, path, query, request, response } = options;
    const home = options.homeDir ?? homedir();
    const segments = path.split("/").filter((segment) => segment.length > 0);

    try {
        const rigConnectPath = rigConnectDaemonPath(path, query);
        if (rigConnectPath !== undefined) {
            await rigConnectForward(
                client,
                request,
                response,
                method,
                rigConnectPath,
                options.onConnectionError,
            );
            return true;
        }
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
                const [projectStats, workspaceStats] = await Promise.all([
                    Promise.all(projects.map((project) => gitLineStatsRead(project.path))),
                    Promise.all(workspaces.map((workspace) => gitLineStatsRead(workspace.path))),
                ]);
                writeJson(response, 200, {
                    projects: projects.map((project, index) =>
                        rigProjectProject(
                            {
                                ...project,
                                changedFiles: projectChanges.get(project.id),
                                ...projectStats[index],
                            },
                            home,
                        ),
                    ),
                    worktrees: workspaces.map((workspace, index) =>
                        rigWorktreeProject(
                            {
                                ...workspace,
                                changedFiles: workspaceChanges.get(workspace.id),
                                ...workspaceStats[index],
                            },
                            home,
                        ),
                    ),
                });
                return true;
            }
            if (path === "/workspace-files") {
                writeJson(
                    response,
                    200,
                    await workspaceFilesRead(client, query.get("group") ?? ""),
                );
                return true;
            }
            if (path === "/open-in-targets") {
                writeJson(response, 200, await openInTargetsRead());
                return true;
            }
            if (path === "/changed-file") {
                writeJson(
                    response,
                    200,
                    await changedFileRead(
                        client,
                        query.get("group") ?? "",
                        query.get("path") ?? "",
                    ),
                );
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

        if (method === "POST" && path === "/changed-file") {
            const body = await bodyReadJson(request);
            await changedFileWrite(
                client,
                String(body.group ?? ""),
                String(body.path ?? ""),
                typeof body.content === "string" ? body.content : "",
            );
            writeJson(response, 200, {});
            return true;
        }

        if (method === "POST" && path === "/open-in") {
            const body = await bodyReadJson(request);
            // The group id, not a path. A directory the renderer names is a
            // directory the renderer chose; resolving it from the catalog here
            // means the only thing that can be opened is something the daemon
            // already lists as a project or worktree root.
            const groupId = String(body.group ?? "");
            const catalog = await client.listCatalog();
            const root =
                catalog.projects.find((candidate) => candidate.id === groupId)?.path ??
                catalog.workspaces.find((candidate) => candidate.id === groupId)?.path;
            if (!root) throw new Error("That project or workspace is no longer available.");
            await openInRun(String(body.target ?? ""), root);
            writeJson(response, 200, {});
            return true;
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
            if (segments[2] === "rename" && segments.length === 3) {
                const body = await bodyReadJson(request);
                // A project rename is unguarded because the daemon asks for no
                // version: the name has nothing derived from it, so the worst a
                // lost race costs is the later of two names.
                await client.renameProject(projectId, nameRead(body));
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
                if (segments[4] === "rename") {
                    const body = await bodyReadJson(request);
                    const name = nameRead(body);
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.renameWorkspace(projectId, worktreeId, name, version),
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

function rigConnectDaemonPath(path: string, query: URLSearchParams): string | undefined {
    const prefix = "/rig-connect";
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return undefined;
    const daemonPath = path.slice(prefix.length) || "/";
    const suffix = query.toString();
    return `${daemonPath}${suffix.length > 0 ? `?${suffix}` : ""}`;
}

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

function omittedHeaderNames(
    connection: string | string[] | undefined,
    additional: readonly string[],
): Set<string> {
    const omitted = new Set([...HOP_BY_HOP_HEADERS, ...additional]);
    const values = Array.isArray(connection) ? connection : [connection];
    for (const value of values) {
        for (const name of value?.split(",") ?? []) omitted.add(name.trim().toLowerCase());
    }
    return omitted;
}

async function rigConnectForward(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", abort);
    try {
        const hasBody =
            Number(request.headers["content-length"] ?? 0) > 0 ||
            request.headers["transfer-encoding"] !== undefined;
        const body = hasBody ? await bodyReadBuffer(request, 64 * 1024 * 1024) : undefined;
        const omittedRequestHeaders = omittedHeaderNames(request.headers.connection, [
            "authorization",
            "content-length",
            "cookie",
            "host",
            "origin",
            "referer",
        ]);
        const forwardedHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers)) {
            if (value === undefined || omittedRequestHeaders.has(name)) continue;
            forwardedHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
        }
        const upstream = await client.rawRequest({
            method,
            path,
            ...(body ? { body } : {}),
            ...(Object.keys(forwardedHeaders).length > 0 ? { headers: forwardedHeaders } : {}),
            signal: controller.signal,
        });
        const omittedResponseHeaders = omittedHeaderNames(upstream.headers.connection, [
            "access-control-allow-credentials",
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-allow-origin",
            "access-control-expose-headers",
            "set-cookie",
        ]);
        for (const [name, value] of Object.entries(upstream.headers)) {
            if (value === undefined || omittedResponseHeaders.has(name)) continue;
            if (name === "vary" && response.hasHeader(name)) response.appendHeader(name, value);
            else response.setHeader(name, value);
        }
        response.writeHead(upstream.statusCode);
        await pipeline(upstream.body, response);
    } catch (error) {
        if (controller.signal.aborted) return;
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        throw error;
    } finally {
        request.off("aborted", abort);
        response.off("close", abort);
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
/**
 * Reads a name from a rename body. Blank is rejected here rather than passed on:
 * a row with no name is unaddressable in the sidebar, and the daemon would
 * accept the empty string.
 */
function nameRead(body: Record<string, unknown>): string {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) throw new Error("A name is required.");
    return name;
}

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

async function bodyReadBuffer(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maximumBytes) throw new Error("The request body is too large.");
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
