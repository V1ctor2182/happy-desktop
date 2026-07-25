import type {
    RigEventObserver,
    RigGlobalEvent,
    RigSessionEvent,
    RigTransport,
} from "../rig/rigTransport.js";
import type {
    RigFileSearchResult,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionSummary,
    RigSessionUsage,
    RigShellCommandResult,
    RigSubagentSummary,
    RigThinkingLevel,
    RigUserInputAnswers,
} from "../rig/rigTypes.js";

export type FakeRigOperation =
    | "modelsRead"
    | "sessionsRead"
    | "sessionRead"
    | "subagentsRead"
    | "sessionCreate"
    | "sessionArchive"
    | "sessionsReorder"
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
    | "sessionEventsBackfill";

export interface FakeRigCall {
    readonly operation: FakeRigOperation;
    readonly sessionId?: RigSessionId;
    /** Working directory of a directory-scoped call, such as a reorder. */
    readonly cwd?: string;
    /** The arrangement a reorder recorded, in order. */
    readonly sessionIds?: readonly RigSessionId[];
    readonly idempotencyKey?: string;
    readonly text?: string;
    readonly expectedRunId?: string;
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
}

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
    private readonly orders = new Map<string, readonly RigSessionId[]>();
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
    private recorded: FakeRigCall[] = [];
    private nextForkId = 1;

    get calls(): readonly FakeRigCall[] {
        return this.recorded;
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

    /** Sort position of a session in its directory's arrangement, unranked last. */
    private rank(session: RigSession): number {
        const index = this.orders.get(session.cwd)?.indexOf(session.id) ?? -1;
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    }

    readonly transport: RigTransport = {
        modelsRead: () => this.perform("modelsRead", {}, () => this.catalog),
        sessionsRead: () =>
            this.perform("sessionsRead", {}, () =>
                [...this.sessions.values()]
                    .filter((session) => !this.archived.has(session.id))
                    .sort((left, right) => this.rank(left) - this.rank(right))
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
        sessionsReorder: (cwd, sessionIds) =>
            this.perform("sessionsReorder", { cwd, sessionIds }, () => {
                this.orders.set(cwd, [...sessionIds]);
                return undefined;
            }),
        sessionArchive: (sessionId) =>
            this.perform("sessionArchive", { sessionId }, () => {
                this.archived.add(sessionId);
                return undefined;
            }),
        messageSubmit: (sessionId, text, idempotencyKey) =>
            this.perform("messageSubmit", { sessionId, text, idempotencyKey }, () => undefined),
        messageSteer: (sessionId, text, idempotencyKey, expectedRunId) =>
            this.perform(
                "messageSteer",
                { sessionId, text, idempotencyKey, expectedRunId },
                () => undefined,
            ),
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
