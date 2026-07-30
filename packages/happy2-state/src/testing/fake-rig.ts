import { orderKeyAfter } from "../utils/orderKeyAfter.js";
import type {
    RigEventObserver,
    RigGlobalEvent,
    RigSessionEvent,
    RigTransport,
} from "../rig/rigTransport.js";
import { fakeTerminalChannelCreate, type FakeTerminalChannel } from "./fake-terminal-channel.js";
import type {
    RigFileSearchResult,
    RigImageInput,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigProject,
    RigProjectCatalog,
    RigProjectId,
    RigServiceTier,
    RigWorktree,
    RigWorktreeId,
    RigSession,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionSummary,
    RigSessionUsage,
    RigShellCommandResult,
    RigSubagentSummary,
    RigTerminal,
    RigTerminalId,
    RigThinkingLevel,
    RigUserInputAnswers,
} from "../rig/rigTypes.js";

export type FakeRigOperation =
    | "modelsRead"
    | "projectsRead"
    | "changedFileRead"
    | "workspaceFileRead"
    | "workspaceFileBytesRead"
    | "workspaceFileWrite"
    | "attachmentWrite"
    | "workspaceFilesRead"
    | "openInTargetsRead"
    | "openIn"
    | "sessionsRead"
    | "sessionRead"
    | "subagentsRead"
    | "sessionCreate"
    | "sessionArchive"
    | "sessionReorder"
    | "projectReorder"
    | "projectArchive"
    | "projectRename"
    | "worktreeRename"
    | "worktreeCreate"
    | "worktreeArchive"
    | "worktreeReorder"
    | "sessionFork"
    | "sessionReset"
    | "messageSubmit"
    | "messageSteer"
    | "runAbort"
    | "compact"
    | "rewind"
    | "shellRun"
    | "backgroundProcessStop"
    | "changeModel"
    | "changeEffort"
    | "changePermissionMode"
    | "changeServiceTier"
    | "answerUserInput"
    | "filesSearch"
    | "usageGet"
    | "terminalCreate"
    | "terminalStop"
    | "terminalConnect"
    | "sessionEventsBackfill";

export interface FakeRigCall {
    readonly operation: FakeRigOperation;
    readonly sessionId?: RigSessionId;
    /** The row a reorder moved and the row it was placed after (null for the front). */
    readonly afterId?: string | null;
    /** The arrangement a reorder recorded, in order. */
    readonly sessionIds?: readonly RigSessionId[];
    readonly idempotencyKey?: string;
    readonly text?: string;
    /** Images a submitted or steering turn carried inline. */
    readonly images?: readonly RigImageInput[];
    readonly expectedRunId?: string;
    /** The terminal a terminal-scoped call addressed. */
    readonly terminalId?: RigTerminalId;
    /** The size a terminal create asked for. */
    readonly cols?: number;
    readonly rows?: number;
}

export interface FakeRigTransport {
    readonly transport: RigTransport;
    readonly calls: readonly FakeRigCall[];
    readonly sessionSubscriberCount: number;
    readonly globalSubscriberCount: number;
    /** Overrides the catalog returned by `modelsRead`. */
    catalogSet(catalog: RigModelCatalog): void;
    /** Inserts/replaces a session in the fake's durable store. */
    sessionSet(session: RigSession): void;
    sessionRemove(sessionId: RigSessionId): void;
    subagentsSet(sessionId: RigSessionId, subagents: readonly RigSubagentSummary[]): void;
    /** Sets the file corpus `filesSearch` filters by substring for a session. */
    filesSet(sessionId: RigSessionId, files: readonly RigFileSearchResult[]): void;
    /** Sets the usage snapshot `usageGet` returns for a session. */
    usageSet(sessionId: RigSessionId, usage: RigSessionUsage): void;
    /** Overrides the result `shellRun` returns for a session (defaults to exit 0). */
    shellResultSet(sessionId: RigSessionId, result: Partial<RigShellCommandResult>): void;
    /** Emits one per-session realtime event (also recorded for backfill). */
    sessionEmit(sessionId: RigSessionId, event: RigSessionEvent): void;
    /** Appends an event to the backfill log without live delivery (simulates a gap). */
    sessionLogAppend(sessionId: RigSessionId, event: RigSessionEvent): void;
    sessionErrorEmit(sessionId: RigSessionId): void;
    globalEmit(event: RigGlobalEvent): void;
    globalErrorEmit(): void;
    /** Fails the next call to `operation` with `error`. */
    failNext(operation: FakeRigOperation, error?: unknown): void;
    /** Defers the next call to `operation`; call the returned release to resolve it. */
    deferNext(operation: FakeRigOperation): { release(): void };
    /**
     * The far end of each terminal byte channel opened so far, newest last. Every
     * attach — including a driver's reconnect — appends one, so a test drives the
     * exact channel the client is currently on.
     */
    readonly terminalChannels: readonly FakeTerminalChannel[];
}

/** The one project every fake session is filed under unless a test says otherwise. */
export const DEFAULT_PROJECT: RigProject = {
    id: "project-workspace" as RigProjectId,
    name: "workspace",
    orderKey: "a0",
    path: "/workspace",
    displayPath: "/workspace",
    kind: "regular",
    status: "ready",
};

const DEFAULT_CATALOG: RigModelCatalog = {
    defaultModelId: "gpt-default",
    defaultProviderId: "openai",
    models: [
        {
            id: "gpt-default",
            name: "GPT Default",
            thinkingLevels: ["low", "medium", "high"],
            defaultThinkingLevel: "medium",
        },
    ],
    providers: [
        {
            id: "openai",
            models: [
                {
                    id: "gpt-default",
                    name: "GPT Default",
                    thinkingLevels: ["low", "medium", "high"],
                    defaultThinkingLevel: "medium",
                },
                {
                    id: "gpt-fast",
                    name: "GPT Fast",
                    thinkingLevels: ["low", "medium"],
                    defaultThinkingLevel: "low",
                },
            ],
            serviceTiers: ["fast"],
        },
    ],
};

/** Builds a minimal, valid session projection for tests, overridable per field. */
export function fakeRigSession(id: string, overrides: Partial<RigSession> = {}): RigSession {
    return {
        id: id as RigSessionId,
        projectId: DEFAULT_PROJECT.id,
        orderKey: "a0",
        cwd: "/workspace",
        displayCwd: "/workspace",
        providerId: "openai",
        modelId: "gpt-default",
        models: DEFAULT_CATALOG.providers[0]!.models,
        permissionMode: "auto",
        modelLocked: false,
        status: "idle",
        messages: [],
        queuedMessages: [],
        pendingUserInputs: [],
        tasks: [],
        subagents: [],
        backgroundProcesses: [],
        createdAt: 1_000,
        updatedAt: 1_000,
        ...overrides,
    };
}

export function fakeRigSummary(
    id: string,
    overrides: Partial<RigSessionSummary> = {},
): RigSessionSummary {
    return {
        id: id as RigSessionId,
        projectId: DEFAULT_PROJECT.id,
        orderKey: "a0",
        cwd: "/workspace",
        displayCwd: "/workspace",
        providerId: "openai",
        modelId: "gpt-default",
        permissionMode: "auto",
        status: "idle",
        createdAt: 1_000,
        updatedAt: 1_000,
        ...overrides,
    };
}

/** Creates a programmable, resource-counted direct-Rig boundary for deterministic state tests. */
export function createFakeRigTransport(): FakeRigTransport {
    return new FakeRigTransportModel();
}

function summaryOf(session: RigSession): RigSessionSummary {
    return {
        id: session.id,
        projectId: session.projectId,
        ...(session.worktreeId ? { worktreeId: session.worktreeId } : {}),
        orderKey: session.orderKey,
        cwd: session.cwd,
        displayCwd: session.displayCwd,
        providerId: session.providerId,
        modelId: session.modelId,
        permissionMode: session.permissionMode,
        effort: session.effort,
        serviceTier: session.serviceTier,
        status: session.status,
        title: session.title,
        recap: session.recap,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    };
}

class FakeRigTransportModel implements FakeRigTransport {
    private catalog = DEFAULT_CATALOG;
    private readonly sessions = new Map<RigSessionId, RigSession>();
    /* Archived sessions stay readable by id and only drop out of the listing,
       which is exactly how the desktop host's durable archive behaves. */
    private readonly archived = new Set<RigSessionId>();
    /* Per-directory arrangement, applied to the listing exactly as the desktop
       host applies its durable one. */

    /** The project/worktree catalog this fake host reports; tests may replace it. */
    projects: RigProjectCatalog = { projects: [DEFAULT_PROJECT], worktrees: [] };
    private readonly subagents = new Map<RigSessionId, readonly RigSubagentSummary[]>();
    private readonly files = new Map<RigSessionId, readonly RigFileSearchResult[]>();
    private readonly usage = new Map<RigSessionId, RigSessionUsage>();
    private readonly shellResults = new Map<RigSessionId, Partial<RigShellCommandResult>>();
    private readonly eventLog = new Map<RigSessionId, RigSessionEvent[]>();
    private readonly sessionObservers = new Map<
        RigSessionId,
        Set<RigEventObserver<RigSessionEvent>>
    >();
    private readonly globalObservers = new Set<RigEventObserver<RigGlobalEvent>>();
    private readonly failures = new Map<FakeRigOperation, unknown[]>();
    private readonly deferGates = new Map<FakeRigOperation, Promise<void>[]>();
    private readonly terminals = new Map<RigTerminalId, RigTerminal>();
    private readonly channels: FakeTerminalChannel[] = [];
    private recorded: FakeRigCall[] = [];
    private nextForkId = 1;

    get calls(): readonly FakeRigCall[] {
        return this.recorded;
    }
    get terminalChannels(): readonly FakeTerminalChannel[] {
        return this.channels;
    }
    get sessionSubscriberCount(): number {
        let total = 0;
        for (const set of this.sessionObservers.values()) total += set.size;
        return total;
    }
    get globalSubscriberCount(): number {
        return this.globalObservers.size;
    }

    catalogSet(catalog: RigModelCatalog): void {
        this.catalog = catalog;
    }
    sessionSet(session: RigSession): void {
        this.sessions.set(session.id, session);
    }
    sessionRemove(sessionId: RigSessionId): void {
        this.sessions.delete(sessionId);
    }
    filesSet(sessionId: RigSessionId, files: readonly RigFileSearchResult[]): void {
        this.files.set(sessionId, files);
    }
    usageSet(sessionId: RigSessionId, usage: RigSessionUsage): void {
        this.usage.set(sessionId, usage);
    }
    shellResultSet(sessionId: RigSessionId, result: Partial<RigShellCommandResult>): void {
        this.shellResults.set(sessionId, result);
    }

    subagentsSet(sessionId: RigSessionId, subagents: readonly RigSubagentSummary[]): void {
        this.subagents.set(sessionId, subagents);
    }
    sessionEmit(sessionId: RigSessionId, event: RigSessionEvent): void {
        const log = this.eventLog.get(sessionId) ?? [];
        log.push(event);
        this.eventLog.set(sessionId, log);
        for (const observer of this.sessionObservers.get(sessionId) ?? []) observer.event(event);
    }
    sessionLogAppend(sessionId: RigSessionId, event: RigSessionEvent): void {
        const log = this.eventLog.get(sessionId) ?? [];
        log.push(event);
        this.eventLog.set(sessionId, log);
    }
    sessionErrorEmit(sessionId: RigSessionId): void {
        for (const observer of this.sessionObservers.get(sessionId) ?? [])
            observer.error(new Error("stream dropped"));
    }
    globalEmit(event: RigGlobalEvent): void {
        for (const observer of this.globalObservers) observer.event(event);
    }
    globalErrorEmit(): void {
        for (const observer of this.globalObservers) observer.error(new Error("stream dropped"));
    }
    failNext(operation: FakeRigOperation, error: unknown = new Error(`${operation} failed`)): void {
        const list = this.failures.get(operation) ?? [];
        list.push(error);
        this.failures.set(operation, list);
    }
    deferNext(operation: FakeRigOperation): { release(): void } {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const gates = this.deferGates.get(operation) ?? [];
        gates.push(gate);
        this.deferGates.set(operation, gates);
        return { release };
    }

    private async perform<T>(
        operation: FakeRigOperation,
        call: Omit<FakeRigCall, "operation">,
        run: () => T | Promise<T>,
    ): Promise<T> {
        this.recorded.push({ operation, ...call });
        const gate = this.deferGates.get(operation)?.shift();
        if (gate) await gate;
        const failure = this.failures.get(operation);
        if (failure && failure.length > 0) throw failure.shift();
        return run();
    }

    private required(sessionId: RigSessionId): RigSession {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session ${sessionId}`);
        return session;
    }

    /**
     * The order this host lists in: fractional index, then id, exactly as Rig
     * does. A session with no key has no place in the list, and sorts last so
     * the caller filtering it out never has to look past the keyed rows.
     */
    private static compare(left: RigSession, right: RigSession): number {
        if (left.orderKey !== right.orderKey) {
            if (left.orderKey === undefined) return 1;
            if (right.orderKey === undefined) return -1;
            return left.orderKey < right.orderKey ? -1 : 1;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    }

    readonly transport: RigTransport = {
        modelsRead: () => this.perform("modelsRead", {}, () => this.catalog),
        projectsRead: () => this.perform("projectsRead", {}, () => this.projects),
        workspaceFilesRead: () =>
            this.perform("workspaceFilesRead", {}, () => ({ paths: [], truncated: false })),
        workspaceFileRead: (_sessionId, path) =>
            this.perform("workspaceFileRead", {}, () => ({
                path,
                content: `Workspace file at ${path}`,
                hash: "workspace-file-hash",
            })),
        // One byte behind a real URL, so a preview under test has something its
        // elements can actually fetch without the fake standing up a server or
        // pretending to hold an actual image.
        workspaceFileBytesRead: (_sessionId, path) =>
            this.perform("workspaceFileBytesRead", {}, () => ({
                path,
                contentType: "application/octet-stream",
                url: "data:application/octet-stream;base64,AA==",
                size: 1,
                hash: "workspace-file-bytes-hash",
            })),
        workspaceFileWrite: () => this.perform("workspaceFileWrite", {}, () => undefined),
        // The fake has no working directory, so a copy lands under the name it
        // asked for; a surface under test cares that the path came back at all.
        attachmentWrite: (_sessionId, name) =>
            this.perform("attachmentWrite", {}, () => ({ path: name })),
        // No host to open anything in, so the fake offers nothing and opening
        // is a no-op rather than a failure: a surface under test should render
        // the same whether or not a shell is there.
        openInTargetsRead: () => this.perform("openInTargetsRead", {}, () => ({ targets: [] })),
        openIn: () => this.perform("openIn", {}, () => undefined),
        changedFileRead: (_sessionId, groupId, path) =>
            this.perform("changedFileRead", {}, () => ({
                path,
                oldPath: path,
                oldContent: `Original file in ${groupId}`,
                newContent: `Changed file in ${groupId}`,
                hash: "changed-file-hash",
            })),
        sessionsRead: () =>
            this.perform("sessionsRead", {}, () =>
                [...this.sessions.values()]
                    .filter((session) => !this.archived.has(session.id))
                    .sort(FakeRigTransportModel.compare)
                    .map(summaryOf),
            ),
        sessionRead: (sessionId) =>
            this.perform("sessionRead", { sessionId }, () =>
                structuredCloneSession(this.required(sessionId)),
            ),
        subagentsRead: (sessionId) =>
            this.perform("subagentsRead", { sessionId }, () => this.subagents.get(sessionId) ?? []),
        sessionCreate: (input: RigSessionCreateInput) =>
            this.perform("sessionCreate", {}, () => {
                const id = `session-${this.nextForkId++}` as RigSessionId;
                const session = fakeSessionFromInput(id, input, this.catalog);
                this.sessions.set(id, session);
                return session;
            }),
        sessionFork: (sessionId) =>
            this.perform("sessionFork", { sessionId }, () => {
                const id = `${sessionId}-fork-${this.nextForkId++}` as RigSessionId;
                const session = { ...this.required(sessionId), id };
                this.sessions.set(id, session);
                return session;
            }),
        sessionReset: (sessionId) =>
            this.perform("sessionReset", { sessionId }, () => {
                const session: RigSession = {
                    ...this.required(sessionId),
                    status: "idle",
                    messages: [],
                    pendingUserInputs: [],
                };
                this.sessions.set(sessionId, session);
                return session;
            }),
        sessionReorder: (sessionId, afterId) =>
            this.perform("sessionReorder", { sessionId, afterId }, () => {
                const session = this.required(sessionId);
                const group = session.worktreeId ?? session.projectId;
                const peers = [...this.sessions.values()].filter(
                    (candidate) => (candidate.worktreeId ?? candidate.projectId) === group,
                );
                const orderKey = orderKeyAfter(
                    peers.flatMap((peer) =>
                        peer.orderKey === undefined
                            ? []
                            : [{ id: peer.id, orderKey: peer.orderKey }],
                    ),
                    sessionId,
                    afterId,
                );
                this.sessions.set(sessionId, { ...session, orderKey });
                return undefined;
            }),
        worktreeCreate: (projectId, input) =>
            this.perform("worktreeCreate", {}, () => {
                const id = `worktree-${this.nextForkId++}` as RigWorktreeId;
                const worktree: RigWorktree = {
                    id,
                    projectId,
                    name: input.name,
                    orderKey: "a0",
                    path: `/worktrees/${id}`,
                    displayPath: `/worktrees/${id}`,
                    status: "ready",
                };
                this.projects = {
                    ...this.projects,
                    worktrees: [...this.projects.worktrees, worktree],
                };
                return worktree;
            }),
        worktreeArchive: (_projectId, worktreeId) =>
            this.perform("worktreeArchive", {}, () => {
                this.projects = {
                    ...this.projects,
                    worktrees: this.projects.worktrees.filter((entry) => entry.id !== worktreeId),
                };
                return undefined;
            }),
        worktreeReorder: (projectId, worktreeId, afterId) =>
            this.perform("worktreeReorder", { afterId }, () => {
                const peers = this.projects.worktrees.filter(
                    (entry) => entry.projectId === projectId,
                );
                const orderKey = orderKeyAfter(
                    peers.map((entry) => ({ id: entry.id, orderKey: entry.orderKey })),
                    worktreeId,
                    afterId,
                );
                this.projects = {
                    ...this.projects,
                    worktrees: this.projects.worktrees.map((entry) =>
                        entry.id === worktreeId ? { ...entry, orderKey } : entry,
                    ),
                };
                return undefined;
            }),
        projectReorder: (projectId, afterId) =>
            this.perform("projectReorder", { afterId }, () => {
                const orderKey = orderKeyAfter(
                    this.projects.projects.map((project) => ({
                        id: project.id,
                        orderKey: project.orderKey,
                    })),
                    projectId,
                    afterId,
                );
                this.projects = {
                    ...this.projects,
                    projects: this.projects.projects.map((project) =>
                        project.id === projectId ? { ...project, orderKey } : project,
                    ),
                };
                return undefined;
            }),
        projectRename: (projectId, name) =>
            this.perform("projectRename", {}, () => {
                this.projects = {
                    ...this.projects,
                    projects: this.projects.projects.map((project) =>
                        project.id === projectId ? { ...project, name } : project,
                    ),
                };
            }),
        worktreeRename: (projectId, worktreeId, name) =>
            this.perform("worktreeRename", {}, () => {
                this.projects = {
                    ...this.projects,
                    worktrees: this.projects.worktrees.map((worktree) =>
                        worktree.id === worktreeId && worktree.projectId === projectId
                            ? { ...worktree, name }
                            : worktree,
                    ),
                };
            }),
        projectArchive: (projectId) =>
            this.perform("projectArchive", {}, () => {
                // As the host does it: the project and its worktrees leave the
                // catalog, and the sessions filed under either are closed.
                const worktrees = new Set(
                    this.projects.worktrees
                        .filter((worktree) => worktree.projectId === projectId)
                        .map((worktree) => worktree.id),
                );
                for (const session of this.sessions.values())
                    if (
                        session.projectId === projectId ||
                        (session.worktreeId && worktrees.has(session.worktreeId))
                    )
                        this.archived.add(session.id);
                this.projects = {
                    projects: this.projects.projects.filter((project) => project.id !== projectId),
                    worktrees: this.projects.worktrees.filter(
                        (worktree) => worktree.projectId !== projectId,
                    ),
                };
                return undefined;
            }),
        sessionArchive: (sessionId) =>
            this.perform("sessionArchive", { sessionId }, () => {
                this.archived.add(sessionId);
                return undefined;
            }),
        messageSubmit: (sessionId, text, idempotencyKey, images) =>
            this.perform(
                "messageSubmit",
                { sessionId, text, idempotencyKey, images },
                () => undefined,
            ),
        messageSteer: (sessionId, text, idempotencyKey, expectedRunId, images) =>
            this.perform(
                "messageSteer",
                { sessionId, text, idempotencyKey, expectedRunId, images },
                () => undefined,
            ),
        draftSet: async () => undefined,
        runAbort: (sessionId, expectedRunId) =>
            this.perform("runAbort", { sessionId, expectedRunId }, () => undefined),
        compact: (sessionId) => this.perform("compact", { sessionId }, () => undefined),
        rewind: (sessionId, messageId) =>
            this.perform("rewind", { sessionId }, () => {
                const current = this.required(sessionId);
                const index = current.messages.findIndex((message) => message.id === messageId);
                const messages = index >= 0 ? current.messages.slice(0, index) : current.messages;
                const session = { ...current, messages };
                this.sessions.set(sessionId, session);
                return session;
            }),
        shellRun: (sessionId, command, commandId) =>
            this.perform("shellRun", { sessionId }, () => {
                const override = this.shellResults.get(sessionId) ?? {};
                return {
                    command,
                    commandId,
                    output: override.output ?? "",
                    exitCode: override.exitCode ?? 0,
                    timedOut: override.timedOut ?? false,
                    ...(override.errorMessage ? { errorMessage: override.errorMessage } : {}),
                    ...(override.backgroundProcessId !== undefined
                        ? { backgroundProcessId: override.backgroundProcessId }
                        : {}),
                };
            }),
        backgroundProcessStop: (sessionId) =>
            this.perform("backgroundProcessStop", { sessionId }, () => undefined),
        terminalCreate: (sessionId, cols, rows) =>
            this.perform("terminalCreate", { sessionId, cols, rows }, (): RigTerminal => {
                this.required(sessionId);
                const id = `terminal-${this.terminals.size + 1}` as RigTerminalId;
                const terminal: RigTerminal = { id, cols, rows, status: "running", exitCode: null };
                this.terminals.set(id, terminal);
                return terminal;
            }),
        terminalStop: (sessionId, terminalId) =>
            this.perform("terminalStop", { sessionId, terminalId }, () => {
                this.terminals.delete(terminalId);
            }),
        terminalConnect: (sessionId, terminalId) => {
            // Attaching is not a request, so it is recorded directly rather than
            // through `perform`: there is no promise here for a failure or a defer
            // gate to attach to.
            this.recorded.push({ operation: "terminalConnect", sessionId, terminalId });
            const { connection, channel } = fakeTerminalChannelCreate();
            this.channels.push(channel);
            return connection;
        },
        changeModel: (sessionId, input: RigModelSelection) =>
            this.perform("changeModel", { sessionId }, () =>
                this.patch(sessionId, {
                    modelId: input.modelId,
                    providerId: input.providerId ?? this.required(sessionId).providerId,
                    effort: input.effort,
                }),
            ),
        changeEffort: (sessionId, effort?: RigThinkingLevel) =>
            this.perform("changeEffort", { sessionId }, () => this.patch(sessionId, { effort })),
        changePermissionMode: (sessionId, permissionMode: RigPermissionMode) =>
            this.perform("changePermissionMode", { sessionId }, () =>
                this.patch(sessionId, { permissionMode }),
            ),
        changeServiceTier: (sessionId, serviceTier?: RigServiceTier) =>
            this.perform("changeServiceTier", { sessionId }, () =>
                this.patch(sessionId, { serviceTier }),
            ),
        answerUserInput: (sessionId, input: RigUserInputAnswers) =>
            this.perform("answerUserInput", { sessionId }, () => {
                const current = this.required(sessionId);
                return this.patch(sessionId, {
                    pendingUserInputs: current.pendingUserInputs.filter(
                        (request) => request.requestId !== input.requestId,
                    ),
                });
            }),
        filesSearch: (sessionId, query: string, limit?: number) =>
            this.perform("filesSearch", { sessionId, text: query }, () => {
                const corpus = this.files.get(sessionId) ?? [];
                const needle = query.trim().toLowerCase();
                const matched = needle
                    ? corpus.filter(
                          (file) =>
                              file.path.toLowerCase().includes(needle) ||
                              file.fileName.toLowerCase().includes(needle),
                      )
                    : corpus;
                return limit === undefined ? matched : matched.slice(0, limit);
            }),
        usageGet: (sessionId) =>
            this.perform("usageGet", { sessionId }, () => {
                const usage = this.usage.get(sessionId);
                if (!usage) throw new Error(`No usage set for session ${sessionId}`);
                return usage;
            }),
        sessionEventsSubscribe: (sessionId, observer) => {
            const set = this.sessionObservers.get(sessionId) ?? new Set();
            set.add(observer);
            this.sessionObservers.set(sessionId, set);
            return () => {
                set.delete(observer);
            };
        },
        globalEventsSubscribe: (observer) => {
            this.globalObservers.add(observer);
            return () => {
                this.globalObservers.delete(observer);
            };
        },
        sessionEventsBackfill: (sessionId, afterEventId) =>
            this.perform("sessionEventsBackfill", { sessionId }, () => {
                const log = this.eventLog.get(sessionId) ?? [];
                const index = log.findIndex((event) => event.eventId === afterEventId);
                return index >= 0 ? log.slice(index + 1) : [...log];
            }),
    };

    private patch(sessionId: RigSessionId, patch: Partial<RigSession>): RigSession {
        const session = { ...this.required(sessionId), ...patch };
        this.sessions.set(sessionId, session);
        return session;
    }
}

function structuredCloneSession(session: RigSession): RigSession {
    return { ...session, messages: [...session.messages] };
}

function fakeSessionFromInput(
    id: RigSessionId,
    input: RigSessionCreateInput,
    catalog: RigModelCatalog,
): RigSession {
    return fakeRigSession(id, {
        projectId: DEFAULT_PROJECT.id,
        ...(input.worktreeId ? { worktreeId: input.worktreeId } : {}),
        orderKey: "a0",
        cwd: input.cwd,
        displayCwd: input.cwd,
        providerId: input.providerId ?? catalog.defaultProviderId,
        modelId: input.modelId ?? catalog.defaultModelId,
        effort: input.effort,
        serviceTier: input.serviceTier,
        permissionMode: input.permissionMode ?? "auto",
        createdAt: 2_000,
        updatedAt: 2_000,
    });
}
