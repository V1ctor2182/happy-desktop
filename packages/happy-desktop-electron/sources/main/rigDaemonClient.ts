import { readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { isAbsolute, join, parse, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocket, createWebSocketStream } from "ws";
import type {
    CreateRemoteTerminalRequest,
    EventId,
    GetSessionUsageResponse,
    GitChangeSnapshot,
    GlobalEventQueueEntry,
    GlobalEventDelivery,
    GlobalCatalogResponse,
    GlobalInstructionsResponse,
    GlobalSecurityPolicyResponse,
    HealthResponse,
    ListSlotEntriesResponse,
    ListAppletsResponse,
    ListSecretsResponse,
    RegisterSecretRequest,
    RegisterSecretResponse,
    UnregisterSecretResponse,
    ModelCatalog,
    Project,
    ProjectAssetResponse,
    ProjectWorkspace,
    ProjectWorkspaceComputeInput,
    GitWatchResponse,
    ProtocolSession,
    RemoteTerminalResponse,
    RunShellCommandResponse,
    SessionEvent,
    SessionSummary,
    SubagentSummary,
} from "./rigDaemonTypes";

/**
 * Largest terminal protocol frame either direction of the attachment may carry.
 * The binary protocol caps a single input frame at 64 KiB, and an output or
 * scrollback-recovery frame is larger, so this bounds both the daemon
 * attachment and the renderer socket well above the protocol's own limits while
 * still refusing a frame no legitimate peer would send.
 */
export const RIG_TERMINAL_MAX_WIRE_BYTES = 4 * 1024 * 1024;

export interface RigDaemonClientOptions {
    readonly socketPath: string;
    readonly token: string;
    /**
     * Addresses a machine the host Rig is peered with rather than the host
     * itself, by prefixing every daemon path with the host's own peer route.
     *
     * The host authenticates the request locally with the token this client
     * already sends and then forwards the request alone: it does not pass that
     * token on, and the machine at the other end answers with its own daemon's
     * authority. Nothing else about the client changes, which is the point —
     * the same projected surface is built over a peer as over the host.
     */
    readonly pathPrefix?: string;
}

/** The prefix that addresses one peer's daemon API through its host. */
export function rigDaemonPeerPrefix(nodeId: string): string {
    return `/p2p/peers/${encodeURIComponent(nodeId)}/api`;
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
    readonly onEvent: (entry: GlobalEventDelivery) => void | Promise<void>;
}

interface SessionResponse {
    readonly session: ProtocolSession;
}

export interface RigDaemonRawResponse {
    readonly statusCode: number;
    readonly headers: IncomingHttpHeaders;
    readonly body: IncomingMessage;
}

export interface RigDaemonFileResponse {
    readonly content: string;
    readonly hash: string;
}

/** Where a debugger attaches to the daemon once its inspector is listening. */
export interface RigDaemonInspectorResponse {
    readonly inspectorUrl: string;
}

/** Whether an inspector was actively listening before the stop request. */
export interface RigDaemonInspectorStopResponse {
    readonly stopped: boolean;
}

export interface RigDaemonFileWriteRequest {
    readonly content: string;
    readonly expectedHash: string | null;
    readonly path: string;
}

/**
 * Which checkout a file operation addresses: a project, or one workspace inside
 * it. The daemon roots every file route in a checkout rather than in a session,
 * so a file can be read and written with no agent running at all — and a session
 * is never the thing that owns the bytes on disk.
 */
export interface RigFileScope {
    readonly projectId: string;
    readonly workspaceId?: string;
}

function fileScopePath(scope: RigFileScope): string {
    const project = `/projects/${encodeURIComponent(scope.projectId)}`;
    return scope.workspaceId === undefined
        ? project
        : `${project}/workspaces/${encodeURIComponent(scope.workspaceId)}`;
}

function sessionCheckoutScope(session: ProtocolSession): RigFileScope {
    if (session.scope.kind === "project") return { projectId: session.scope.projectId };
    if (session.scope.kind === "workspace")
        return {
            projectId: session.scope.projectId,
            workspaceId: session.scope.workspaceId,
        };
    throw new RigDaemonHttpError(409, "This operation requires a project or workspace session.");
}

/**
 * Narrow client for the local Rig daemon routes consumed by Happy's main-process
 * projection. Rig intentionally exposes these routes over an authenticated Unix
 * socket; keeping the adapter here avoids depending on its private client modules.
 */
export class RigDaemonClient {
    readonly socketPath: string;
    readonly #token: string;
    readonly #pathPrefix: string;

    constructor(options: RigDaemonClientOptions) {
        this.socketPath = options.socketPath;
        this.#token = options.token;
        this.#pathPrefix = options.pathPrefix ?? "";
    }

    /**
     * Where one daemon path is actually asked for: on the host, itself; on a
     * peer, the same path underneath the host's route to that machine.
     *
     * Everything that reaches the socket goes through here, so a client built
     * for a peer cannot accidentally address its own host through a route that
     * was written before peers existed.
     */
    #path(path: string): string {
        return `${this.#pathPrefix}${path}`;
    }

    /**
     * The same client, addressed at one machine this Rig is peered with.
     *
     * It reuses this connection whole — the same socket, the same token, the
     * same projected surface above it — because that is what the host's peer
     * route is: this daemon, answering for another one. Nothing about the peer
     * is configured here; `nodeId` is the identity the host itself published.
     */
    peer(nodeId: string): RigDaemonClient {
        return new RigDaemonClient({
            pathPrefix: rigDaemonPeerPrefix(nodeId),
            socketPath: this.socketPath,
            token: this.#token,
        });
    }

    health(): Promise<HealthResponse> {
        return this.#requestJson("GET", "/health");
    }

    models(): Promise<{ readonly catalog: ModelCatalog }> {
        return this.#requestJson("GET", "/models");
    }

    /**
     * The machine-wide instructions every agent this Rig starts is given: the
     * daemon's own `AGENTS.md`. A Rig that has never been given any answers with
     * empty text rather than failing, so there is nothing to create first.
     */
    globalInstructions(): Promise<GlobalInstructionsResponse> {
        return this.#requestJson("GET", "/config/instructions");
    }

    /** Replaces those instructions wholesale and answers with what was stored. */
    setGlobalInstructions(instructions: string): Promise<GlobalInstructionsResponse> {
        return this.#requestJson("PUT", "/config/instructions", { instructions });
    }

    /** Reads the policy this Rig's permission reviewer applies to agent actions. */
    globalSecurityPolicy(): Promise<GlobalSecurityPolicyResponse> {
        return this.#requestJson("GET", "/config/security");
    }

    /** Replaces that security policy wholesale and answers with what was stored. */
    setGlobalSecurityPolicy(policy: string): Promise<GlobalSecurityPolicyResponse> {
        return this.#requestJson("PUT", "/config/security", { policy });
    }

    /**
     * Opens this daemon's own Node inspector and answers with the address a
     * debugger attaches to. One daemon holds one inspector, so asking again
     * returns the one already listening rather than opening another.
     */
    startInspector(): Promise<RigDaemonInspectorResponse> {
        return this.#requestJson("POST", "/debug/inspector");
    }

    /** Stops this daemon's Node inspector without stopping the daemon itself. */
    stopInspector(): Promise<RigDaemonInspectorStopResponse> {
        return this.#requestJson("DELETE", "/debug/inspector");
    }

    /**
     * Opens one authenticated daemon request without interpreting its response.
     *
     * This is reserved for the capability-scoped `rig-connect` bridge, whose
     * browser-neutral client must see statuses, headers, JSON, and SSE unchanged.
     */
    rawRequest(options: {
        readonly method: string;
        readonly path: string;
        readonly body?: Buffer;
        readonly headers?: Readonly<Record<string, string>>;
        readonly signal?: AbortSignal;
    }): Promise<RigDaemonRawResponse> {
        return new Promise((resolvePromise, reject) => {
            if (options.signal?.aborted) {
                reject(new Error("The Rig daemon request was aborted."));
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
                    path: this.#path(options.path),
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
            const abort = () => request.destroy();
            const cleanup = () => options.signal?.removeEventListener("abort", abort);
            options.signal?.addEventListener("abort", abort, { once: true });
            request.once("close", cleanup);
            request.once("error", reject);
            if (options.body !== undefined) request.write(options.body);
            request.end();
        });
    }

    listSessions(): Promise<{ readonly sessions: readonly SessionSummary[] }> {
        return this.#requestJson("GET", "/sessions");
    }

    /**
     * The daemon's project/worktree catalog. It is read from `/catalog` rather
     * than from `/projects` because worktrees have no global listing route of
     * their own — only a per-project one — and one read of the whole catalog is
     * both cheaper and internally consistent compared with fanning out per
     * project.
     */
    listCatalog(): Promise<GlobalCatalogResponse> {
        return this.#requestJson("GET", "/catalog");
    }

    /**
     * Reads Rig's whole slot catalog. Scope is resolved against what the window
     * is addressing in the app, so this asks the daemon for everything rather
     * than for one context's answer.
     */
    listSlots(): Promise<ListSlotEntriesResponse> {
        return this.#requestJson("GET", "/slots");
    }

    /** Reads Rig's global catalog of imported, versioned applets. */
    listApplets(): Promise<ListAppletsResponse> {
        return this.#requestJson("GET", "/applets");
    }

    /** Every secret bundle this Rig holds, by id, description, and variable names. */
    listSecrets(): Promise<ListSecretsResponse> {
        return this.#requestJson("GET", "/secrets");
    }

    /**
     * Registers a secret bundle, or replaces the one already registered under
     * that id. The daemon validates the id, the description, and every variable
     * name, and refuses the whole registration in its own words.
     */
    registerSecret(secret: RegisterSecretRequest): Promise<RegisterSecretResponse> {
        return this.#requestJson("POST", "/secrets", secret);
    }

    /** Forgets one secret bundle, values included. */
    unregisterSecret(secretId: string): Promise<UnregisterSecretResponse> {
        return this.#requestJson("DELETE", `/secrets/${encodeURIComponent(secretId)}`);
    }

    /** Reads one static file from a applet's current version. */
    getAppletFile(name: string, filePath: string): Promise<ProjectAssetResponse> {
        const encodedPath = filePath
            .split("/")
            .filter(Boolean)
            .map((segment) => encodeURIComponent(segment))
            .join("/");
        return this.#requestBuffer(
            `/applets/${encodeURIComponent(name)}/files/${encodedPath || "index.html"}`,
        );
    }

    gitWatch(
        entities: readonly { readonly projectId: string; readonly workspaceId?: string }[],
    ): Promise<GitWatchResponse> {
        return this.#requestJson("POST", "/git/watch", { entities });
    }

    /**
     * One checkout's current Git comparison, waiting for a scan when the daemon
     * has not already made one. `gitWatch` only registers interest and returns
     * whatever has been scanned so far, so it answers a cold entity with
     * nothing at all; this route registers the same interest and then blocks on
     * the scan, which is what a caller that has to render the state now needs.
     */
    async readGitChanges(scope: RigFileScope, signal?: AbortSignal): Promise<GitChangeSnapshot> {
        const answer = await this.#requestJson<{ readonly git: GitChangeSnapshot }>(
            "GET",
            `${fileScopePath(scope)}/git`,
            undefined,
            undefined,
            signal,
        );
        return answer.git;
    }

    /** Reads one project avatar's bytes so the loopback proxy can re-serve them. */
    getProjectAsset(assetHash: string): Promise<ProjectAssetResponse> {
        return this.#requestBuffer(`/project-assets/${encodeURIComponent(assetHash)}`);
    }

    getProject(projectId: string): Promise<{ readonly project: Project }> {
        return this.#requestJson("GET", `/projects/${encodeURIComponent(projectId)}`);
    }

    listWorkspaces(
        projectId: string,
    ): Promise<{ readonly workspaces: readonly ProjectWorkspace[] }> {
        return this.#requestJson("GET", `/projects/${encodeURIComponent(projectId)}/workspaces`);
    }

    /**
     * Reserves a git worktree in the project. The daemon answers as soon as the
     * row exists, with the checkout still initializing, and reports it ready (or
     * failed) over the global event queue. `id` is the caller's own cuid2 for the
     * worktree, so repeating a request returns the worktree it already created
     * rather than reserving a second one. `baseRef` is optional because the
     * daemon forks a named ref verbatim and otherwise fetches the remote and
     * forks the project's trunk, which is what an unqualified request wants.
     */
    createWorkspace(
        projectId: string,
        request: {
            readonly baseRef?: string;
            readonly id: string;
            readonly name: string;
        },
    ): Promise<{ readonly workspace: ProjectWorkspace }> {
        return this.#requestJson(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/workspaces`,
            request,
        );
    }

    /** Renames a project; guarded by the version it was read at. */
    renameProject(
        projectId: string,
        name: string,
        expectedVersion: number,
    ): Promise<{ readonly project: Project }> {
        return this.#requestJson(
            "PATCH",
            `/projects/${encodeURIComponent(projectId)}`,
            { name },
            { "if-match": `"${String(expectedVersion)}"` },
        );
    }

    /**
     * Sets where sessions started in this project run by default, or clears the
     * choice by sending no compute at all, which puts the project back under
     * whatever the daemon itself is configured to do.
     *
     * Guarded by the version the project was read at. The daemon compares it
     * against the project's *user* mutation version rather than its row version,
     * so a git scan or an avatar arriving in between does not refuse the write
     * while another person changing this same setting does. `mutationId` is this
     * submission's identity: the daemon answers a repeat of one it has already
     * applied with the project that application produced, rather than applying
     * it a second time.
     */
    updateProjectSettings(
        projectId: string,
        request: {
            readonly defaultWorkspaceCompute?: ProjectWorkspaceComputeInput;
            readonly mutationId: string;
        },
        expectedVersion: number,
    ): Promise<{ readonly project: Project }> {
        return this.#requestJson(
            "PUT",
            `/projects/${encodeURIComponent(projectId)}/settings`,
            request,
            { "if-match": `"${String(expectedVersion)}"` },
        );
    }

    /** Renames a worktree; guarded by the version it was read at. */
    renameWorkspace(
        projectId: string,
        workspaceId: string,
        name: string,
        expectedVersion: number,
    ): Promise<{ readonly workspace: ProjectWorkspace }> {
        return this.#requestJson(
            "PATCH",
            `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}`,
            { name },
            { "if-match": `"${String(expectedVersion)}"` },
        );
    }

    /** Archives a worktree, which removes its checkout; guarded by the version it was read at. */
    archiveWorkspace(
        projectId: string,
        workspaceId: string,
        expectedVersion: number,
    ): Promise<{ readonly workspace: ProjectWorkspace }> {
        return this.#requestJson(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/archive`,
            {},
            { "if-match": `"${String(expectedVersion)}"` },
        );
    }

    /** Moves a worktree after `afterId` within its project, or to the front when null. */
    reorderWorkspace(
        projectId: string,
        workspaceId: string,
        afterId: string | null,
        expectedVersion: number,
    ): Promise<{ readonly workspace: ProjectWorkspace }> {
        return this.#requestJson(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/reorder`,
            { afterId },
            { "if-match": `"${String(expectedVersion)}"` },
        );
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
     * Archives a whole project: the daemon stamps it archived, archives the chats
     * in its root, and takes each of its managed worktrees through the worktree
     * archive above, so their checkouts are removed too. It answers before that
     * cleanup finishes and reports the rest over the global event queue. Repeating
     * the request on an already archived project is accepted unchanged.
     */
    archiveProject(
        projectId: string,
        expectedVersion: number,
    ): Promise<{ readonly project: Project }> {
        return this.#requestJson(
            "POST",
            `/projects/${encodeURIComponent(projectId)}/archive`,
            {},
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
        scope: RigFileScope,
        query: string,
        limit = 20,
    ): Promise<{
        readonly files: readonly { readonly fileName: string; readonly path: string }[];
    }> {
        const parameters = new URLSearchParams({ limit: String(limit), query });
        return this.#requestJson("GET", `${fileScopePath(scope)}/files?${parameters.toString()}`);
    }

    /**
     * Every file in a checkout, which is what the panel's "All files" is. The
     * daemon asks Git, so this is the same file set the changed list is drawn
     * from, resolved on the machine holding the checkout rather than here.
     */
    listFilePaths(
        scope: RigFileScope,
        signal?: AbortSignal,
    ): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
        return this.#requestJson(
            "GET",
            `${fileScopePath(scope)}/file-paths`,
            undefined,
            undefined,
            signal,
        );
    }

    readFile(
        scope: RigFileScope,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigDaemonFileResponse> {
        return this.#requestJson(
            "GET",
            `${fileScopePath(scope)}/file?path=${encodeURIComponent(path)}`,
            undefined,
            undefined,
            signal,
        );
    }

    /**
     * One file's bytes as they were at a revision, which is the old side of a
     * diff. A revision that never held the path answers with null content
     * rather than failing, because a file added since then legitimately has no
     * version there.
     */
    readFileAtRevision(
        scope: RigFileScope,
        path: string,
        revision: string,
        signal?: AbortSignal,
    ): Promise<{ readonly content: string | null; readonly hash: string | null }> {
        const parameters = new URLSearchParams({ path, revision });
        return this.#requestJson(
            "GET",
            `${fileScopePath(scope)}/file-revision?${parameters.toString()}`,
            undefined,
            undefined,
            signal,
        );
    }

    writeFile(
        scope: RigFileScope,
        request: RigDaemonFileWriteRequest,
    ): Promise<{ readonly hash: string }> {
        return this.#requestJson("PUT", `${fileScopePath(scope)}/file`, request);
    }

    /**
     * Opens the browser tunnel for one session, on whichever Rig this client
     * addresses. The session is read first on that same Rig, so the checkout
     * the tunnel is scoped to is the one that session actually runs in.
     *
     * A peer is addressed the same way everything else here is, by prefixing
     * the path: the host recognises a CONNECT under its own peer route, opens
     * the tunnel to that machine, and the far daemon answers it with its own
     * proxy and its own token. So a page loaded in a node's session resolves
     * and fetches on that machine's network, not on this one's.
     */
    async openHttpProxy(sessionId: string): Promise<Duplex> {
        const { session } = await this.getSession(sessionId);
        const path = this.#path(`${fileScopePath(sessionCheckoutScope(session))}/proxy`);
        return new Promise((resolvePromise, reject) => {
            const request = httpRequest({
                headers: { authorization: `Bearer ${this.#token}` },
                method: "CONNECT",
                path,
                socketPath: this.socketPath,
            });
            request.once("connect", (response, socket, head) => {
                if (response.statusCode !== 200) {
                    socket.destroy();
                    reject(this.#proxyRefused(response.statusCode));
                    return;
                }
                if (head.length > 0) socket.unshift(head);
                resolvePromise(socket);
            });
            request.once("response", (response) => {
                response.resume();
                reject(this.#proxyRefused(response.statusCode));
            });
            request.once("error", reject);
            request.end();
        });
    }

    /**
     * What a refused tunnel means. The status is carried through whichever
     * daemon refused it — this window's host, or the machine it forwarded to —
     * because either way it is the answer to the address that was asked for.
     */
    #proxyRefused(statusCode: number | undefined): RigDaemonHttpError {
        const status = statusCode ?? 500;
        return new RigDaemonHttpError(status, `Rig HTTP proxy returned ${String(status)}.`);
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

    /**
     * Starts one interactive PTY in the session's working directory. The shell is
     * deliberately unspecified so the daemon spawns the user's login shell: a
     * local terminal belongs to the person at the machine, not to a shell this
     * bridge picked for them.
     */
    createTerminal(
        sessionId: string,
        request: CreateRemoteTerminalRequest,
    ): Promise<RemoteTerminalResponse> {
        return this.#terminalScope(sessionId).then((scope) =>
            this.#requestJson("POST", this.#terminalCollectionPath(scope), request),
        );
    }

    /** Ends one terminal, killing its process; the terminal stops being attachable. */
    stopTerminal(sessionId: string, terminalId: string): Promise<RemoteTerminalResponse> {
        return this.#terminalScope(sessionId).then((scope) =>
            this.#requestJson(
                "DELETE",
                `${this.#terminalCollectionPath(scope)}/${encodeURIComponent(terminalId)}`,
            ),
        );
    }

    /**
     * Opens the daemon's binary attachment for one terminal as a byte stream. The
     * frames are opaque here: this bridge only carries them between the daemon's
     * Unix socket — which the sandboxed renderer cannot open — and the renderer's
     * own socket, so terminal emulation and the protocol state machine stay in the
     * one client that owns them.
     *
     * A peer's attachment is the same upgrade under the host's peer route: the
     * host recognises it, opens the tunnel, and the far daemon completes the
     * handshake with its own token, so the bytes on this stream come from that
     * machine's PTY. The scope is resolved on the same Rig for the usual reason
     * — a session identity means something only where it was minted.
     */
    async attachTerminal(sessionId: string, terminalId: string): Promise<Duplex> {
        const scope = await this.#terminalScope(sessionId);
        const path = this.#path(
            `${this.#terminalCollectionPath(scope)}/${encodeURIComponent(terminalId)}/attach`,
        );
        return new Promise((resolvePromise, reject) => {
            const socket = new WebSocket(`ws+unix://${this.socketPath}:${path}`, {
                handshakeTimeout: 10_000,
                headers: { authorization: `Bearer ${this.#token}` },
                maxPayload: RIG_TERMINAL_MAX_WIRE_BYTES,
                perMessageDeflate: false,
            });
            let settled = false;
            const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                socket.terminate();
                reject(error);
            };
            const unexpected = (_request: unknown, response: { statusCode?: number }) => {
                fail(
                    new RigDaemonHttpError(
                        response.statusCode ?? 500,
                        "The Rig terminal attachment was refused.",
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

    setSessionDraft(
        sessionId: string,
        request: {
            readonly draft: string | null;
            readonly origin: string;
            readonly updatedAt: number;
        },
    ): Promise<SessionResponse> {
        return this.#requestJson(
            "PUT",
            `/sessions/${encodeURIComponent(sessionId)}/draft`,
            request,
        );
    }

    async #terminalScope(
        sessionId: string,
    ): Promise<{ readonly projectId: string; readonly workspaceId?: string }> {
        const { session } = await this.getSession(sessionId);
        return sessionCheckoutScope(session);
    }

    #terminalCollectionPath(scope: {
        readonly projectId: string;
        readonly workspaceId?: string;
    }): string {
        const project = `/projects/${encodeURIComponent(scope.projectId)}`;
        return scope.workspaceId
            ? `${project}/workspaces/${encodeURIComponent(scope.workspaceId)}/terminals`
            : `${project}/terminals`;
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
                    cursor: (entry) => ("live" in entry ? undefined : entry.cursor),
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
        signal?: AbortSignal,
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
            if (signal?.aborted) {
                reject(new Error("The Rig daemon request was aborted."));
                return;
            }
            const request = httpRequest(
                { headers, method, path: this.#path(path), socketPath: this.socketPath },
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
                                    failureMessage(text, statusCode),
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
            const abort = () => request.destroy(new Error("The Rig daemon request was aborted."));
            const cleanup = () => signal?.removeEventListener("abort", abort);
            signal?.addEventListener("abort", abort, { once: true });
            request.once("close", cleanup);
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
                    path: this.#path(path),
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
                                    failureMessage(bytes.toString("utf8"), statusCode),
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
        readonly cursor: (event: TEvent) => TCursor | undefined;
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
                    path: this.#path(options.path),
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
                                const nextCursor = options.cursor(event);
                                if (nextCursor !== undefined) cursor = nextCursor;
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
        : join(nodeTemporaryDirectoryResolve(environment), `rig-${uid}`);
    return {
        socketPath: environment.RIG_SERVER_SOCKET_PATH?.trim() || join(directory, "server.sock"),
        tokenPath: environment.RIG_SERVER_TOKEN_PATH?.trim() || join(directory, "token"),
    };
}

/**
 * Reproduces `node:os.tmpdir()` for a process launched with this environment.
 * `os.tmpdir()` itself reads this process's environment, which is wrong while
 * Happy is predicting where a child started with its login-shell environment
 * will create the shared daemon.
 */
function nodeTemporaryDirectoryResolve(environment: NodeJS.ProcessEnv): string {
    const configuredDirectory =
        process.platform === "win32"
            ? environment.TEMP ||
              environment.TMP ||
              join(environment.SystemRoot || environment.windir || "C:\\Windows", "temp")
            : environment.TMPDIR || environment.TMP || environment.TEMP || "/tmp";
    return configuredDirectory.length > parse(configuredDirectory).root.length &&
        /[/\\]$/u.test(configuredDirectory)
        ? configuredDirectory.slice(0, -1)
        : configuredDirectory;
}

export async function rigDaemonTokenRead(tokenPath: string): Promise<string | undefined> {
    try {
        return (await readFile(tokenPath, "utf8")).trim() || undefined;
    } catch {
        return undefined;
    }
}

/**
 * What the daemon said went wrong, in the form a reader can be shown.
 *
 * A failing route answers `{"error": "…"}`, and that sentence is the whole point
 * of the response: keeping the JSON envelope around it only means the text
 * arrives at the UI quoted inside a string that has to be unwrapped again. A
 * body in any other shape is passed through verbatim, and an empty one leaves
 * the status as the only thing there is to say.
 */
function failureMessage(body: string, statusCode: number): string {
    if (body.length === 0) return `Rig daemon HTTP ${statusCode}`;
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null) {
            const { error } = parsed as { readonly error?: unknown };
            if (typeof error === "string" && error.length > 0) return error;
        }
    } catch {
        // Not JSON; the body is the message.
    }
    return body;
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

function globalEventParse(raw: string): GlobalEventDelivery | undefined {
    if (raw.startsWith(":")) return undefined;
    const lines = raw.split("\n");
    const id = lines
        .find((line) => line.startsWith("id:"))
        ?.slice("id:".length)
        .trim();
    const event = sseDataParse(raw) as GlobalEventQueueEntry["event"] | undefined;
    if (!event) return undefined;
    return id ? { cursor: id, event } : { live: true, event: event as never };
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
