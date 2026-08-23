import type {
    Agent,
    AgentActivityResponse,
    AgentContextUsage,
    AgentDraftSnapshot,
    DaemonConfig,
    GitState,
    Message,
    MessageBlock,
    MessageMode,
    ModelUsage,
    Project,
    Question,
    Run,
    UsageBreakdown,
    Workspace,
} from "@slopus/happy-agent-client";
import type {
    ChatElement,
    GitChangeSnapshot,
    GroupSession,
    ProjectGroup,
    SessionState,
    SessionUsage,
    ToolPresentation,
    UserInputRequest,
    WorkspaceGroup,
} from "./types.js";

export interface TranscriptMessage {
    message: Message;
    runId: string | null;
    /** Present only until this client observes the durable message with the same ID. */
    pendingSend?: true;
}

export interface SessionProjectionInput {
    agent: Agent;
    config: DaemonConfig;
    connection: SessionState["connection"];
    endpoint: string;
    hasMore: boolean;
    messages: readonly TranscriptMessage[];
    intendedMode?: MessageMode;
    mode?: MessageMode | null;
    draft?: AgentDraftSnapshot;
    context?: AgentContextUsage | null;
    activity?: AgentActivityResponse;
    question?: Question | null;
    runs: readonly Run[];
    /** Final conversation-context measurements captured at exact run boundaries. */
    runFinalContextTokens?: ReadonlyMap<string, number>;
    usage?: UsageBreakdown;
    workspace?: Workspace;
}

export function defaultMode(config: DaemonConfig): MessageMode {
    return {
        effort: config.defaults.effort,
        modelId: config.defaults.modelId,
        permissionMode: config.defaults.permissionMode,
        providerId: config.defaults.providerId,
        serviceTier: null,
    };
}

export function modeOf(
    config: DaemonConfig,
    draft?: AgentDraftSnapshot,
    stored?: MessageMode | null,
    intended?: MessageMode,
): MessageMode {
    if (intended) return intended;
    if (draft?.value)
        return {
            effort: draft.value.effort,
            modelId: draft.value.modelId,
            permissionMode: draft.value.permissionMode,
            providerId: draft.value.providerId,
            serviceTier: draft.value.serviceTier,
        };
    return stored ?? defaultMode(config);
}

export function projectSession(input: SessionProjectionInput): SessionState {
    const { agent, config, workspace } = input;
    const mode = modeOf(config, input.draft, input.mode, input.intendedMode);
    const activeRun = newestRunningRun(input.runs);
    const projectId = workspace?.projectId;
    const scope =
        workspace === undefined || projectId === undefined
            ? ({ kind: "unsorted" } as const)
            : workspace.kind === "root"
              ? ({ kind: "project", projectId } as const)
              : ({ kind: "workspace", projectId, workspaceId: workspace.id } as const);
    const usage =
        input.usage === undefined
            ? undefined
            : projectUsage(input.usage, mode.providerId, input.context);
    const pendingUserInputs =
        input.question?.status === "pending" ? [projectQuestion(input.question)] : [];

    return {
        activity: activityOf(agent),
        ...(activeRun === undefined
            ? {}
            : {
                  activeGroup: {
                      groupId: activeRun.id,
                      runId: activeRun.id,
                      startedAt: activeRun.startedAt,
                  },
                  activeTurn: { runId: activeRun.id, startedAt: activeRun.startedAt },
              }),
        status: activeRun === undefined ? "idle" : "running",
        archived: agent.archivedAt !== null,
        sessionId: agent.id,
        ownerInstanceId: input.endpoint,
        scope,
        ...(projectId === undefined ? {} : { projectId }),
        ...(workspace?.kind === "root" ? {} : { workspaceId: workspace?.id }),
        ...(agent.orderKey === null ? {} : { orderKey: agent.orderKey }),
        cwd: workspacePath(workspace),
        ...(input.draft?.value == null
            ? {}
            : {
                  draft: input.draft.value.text,
                  ...(input.draft.updatedAt === null
                      ? {}
                      : { draftUpdatedAt: input.draft.updatedAt }),
              }),
        modelId: mode.modelId,
        providerId: mode.providerId,
        ...(agent.title === null ? {} : { title: agent.title }),
        titleStatus: agent.titleStatus,
        effort: mode.effort,
        ...(mode.serviceTier === null ? {} : { serviceTier: mode.serviceTier }),
        permissionMode: mode.permissionMode,
        modelLocked: false,
        modelCatalog: modelCatalog(config),
        models: Object.entries(config.models).map(([id, model]) => ({ id, ...model })),
        pendingUserInputs,
        pendingSteeringMessages: input.messages
            .filter(
                (
                    entry,
                ): entry is TranscriptMessage & {
                    message: Extract<Message, { role: "user" }>;
                } =>
                    entry.message.role === "user" &&
                    entry.message.status === "pending" &&
                    entry.message.delivery === "steer",
            )
            .map((entry) => ({
                message: { id: entry.message.id, blocks: entry.message.content },
            })),
        tasks: [],
        subagents: projectSubagents(agent, input.activity),
        backgroundProcesses: (input.activity?.processes ?? [])
            .filter((process) => process.status === "running")
            .map((process) => ({
                sessionId: projectNumericIdentity(process.id),
                command: process.command,
                cwd: workspacePath(workspace),
                status: "running" as const,
            })),
        ...(usage === undefined ? {} : { usage }),
        connection: input.connection,
        transcriptComplete: !input.hasMore,
        ...(input.hasMore && input.runs[0] !== undefined
            ? { loadMoreToken: input.runs[0].id }
            : {}),
        loadingMore: false,
        lastEventId: agent.lastCursor,
    };
}

/**
 * Reuses the previous element list when this projection produced the very same
 * rows. Every element below is kept against the durable object it was projected
 * from, so an event that changed nothing in the transcript — an activity tick, a
 * process update, a context measurement — rebuilds an array of identical
 * references and this hands the old one back instead. Downstream, one reference
 * comparison then replaces the whole conversation projection.
 */
export function elementsReuse(
    previous: readonly ChatElement[],
    next: readonly ChatElement[],
): readonly ChatElement[] {
    if (previous === next) return previous;
    if (previous.length !== next.length) return next;
    for (let index = 0; index < next.length; index += 1)
        if (previous[index] !== next[index]) return next;
    return previous;
}

/**
 * The waiting placeholder a running run shows before it has produced anything.
 * It is a function of the run alone, and a run object is replaced rather than
 * edited, so it is projected once per run.
 */
const inferenceElements = new WeakMap<Run, Extract<ChatElement, { kind: "inference" }>>();
function projectInference(run: Run): Extract<ChatElement, { kind: "inference" }> {
    const cached = inferenceElements.get(run);
    if (cached !== undefined) return cached;
    const element = {
        id: `inference:${run.id}`,
        groupId: run.id,
        runId: run.id,
        createdAt: run.startedAt,
        kind: "inference",
        state: "waiting",
    } as const;
    inferenceElements.set(run, element);
    return element;
}

/**
 * The pending question's stand-in row, projected once per question version.
 *
 * A question's identity is the provider call ID of the `request_user_input`
 * call that asked it, so the transcript's own row for that call *is* the
 * question's row once the daemon has recorded it. This stand-in only covers the
 * window before that happens — a question read from the agent's state ahead of
 * the message carrying its call — and is left out entirely as soon as the real
 * call arrives, because two rows with one identity are the same question asked
 * twice.
 */
const questionElements = new WeakMap<Question, Extract<ChatElement, { kind: "tool_call" }>>();
function projectQuestionElement(question: Question): Extract<ChatElement, { kind: "tool_call" }> {
    const cached = questionElements.get(question);
    if (cached !== undefined) return cached;
    const element = {
        id: `question:${question.id}`,
        groupId: question.runId,
        runId: question.runId,
        createdAt: question.createdAt,
        kind: "tool_call",
        toolCallId: question.id,
        name: "request_user_input",
        arguments: {
            questions: question.questions,
        },
        argumentsComplete: true,
        status: "running",
    } as const;
    questionElements.set(question, element);
    return element;
}

export function projectElements(input: SessionProjectionInput): readonly ChatElement[] {
    const messagesByRun = new Map<string, TranscriptMessage[]>();
    const pending: TranscriptMessage[] = [];
    for (const entry of input.messages) {
        if (entry.runId === null) pending.push(entry);
        else {
            const entries = messagesByRun.get(entry.runId);
            if (entries === undefined) messagesByRun.set(entry.runId, [entry]);
            else entries.push(entry);
        }
    }

    const elements: ChatElement[] = [];
    const question = input.question?.status === "pending" ? input.question : undefined;
    /* Whether the transcript already carries the call that asked the pending
       question, settled while the rows go by rather than by scanning them
       again afterwards. */
    let questionAsked = false;
    const push = (element: ChatElement): void => {
        if (
            question !== undefined &&
            !questionAsked &&
            element.kind === "tool_call" &&
            element.toolCallId === question.id
        )
            questionAsked = true;
        elements.push(element);
    };
    for (const run of input.runs) {
        const messages = messagesByRun.get(run.id);
        const before = elements.length;
        if (messages !== undefined) {
            // Messages arrive in order and a run holds a handful of them.
            // Confirming that order costs one comparison each; entering the sort
            // itself, once for every run in the transcript, cost more than
            // everything else this loop does.
            if (!messagesOrdered(messages)) messages.sort(compareMessages);
            for (const entry of messages)
                for (const element of projectMessage(entry, run.id, run.status)) push(element);
        }
        if (run.status === "running" && !runProduced(elements, before, run.id)) {
            elements.push(projectInference(run));
        }
        const end = projectRunEnd(run, input.runFinalContextTokens?.get(run.id));
        if (end !== undefined) elements.push(end);
    }
    if (!messagesOrdered(pending)) pending.sort(compareMessages);
    for (const entry of pending)
        for (const element of projectMessage(entry, `pending:${entry.message.id}`, "running"))
            push(element);
    if (question !== undefined && !questionAsked) elements.push(projectQuestionElement(question));
    return elements;
}

/**
 * Whether a run has already put something of its own in the transcript. Only
 * this run's own rows can answer that, and they are the ones just appended, so
 * the scan starts where they did rather than at the top of the transcript.
 */
function runProduced(elements: readonly ChatElement[], from: number, runId: string): boolean {
    for (let index = from; index < elements.length; index += 1) {
        const element = elements[index]!;
        if (
            element.runId === runId &&
            element.kind !== "user_message" &&
            element.kind !== "inference"
        )
            return true;
    }
    return false;
}

export function projectGroups(
    projects: readonly Project[],
    workspaces: readonly Workspace[],
    endpoint: string,
    config: DaemonConfig,
    gitStates: ReadonlyMap<string, GitState> = new Map(),
    drafts: ReadonlyMap<string, AgentDraftSnapshot> = new Map(),
    modes: ReadonlyMap<string, MessageMode | null> = new Map(),
): readonly ProjectGroup[] {
    const workspacesByProject = new Map<string, Workspace[]>();
    for (const workspace of workspaces) {
        if (workspace.archivedAt !== null || workspace.status !== "active") continue;
        const entries = workspacesByProject.get(workspace.projectId) ?? [];
        entries.push(workspace);
        workspacesByProject.set(workspace.projectId, entries);
    }

    return projects
        .filter((project) => project.archivedAt === null && project.status === "active")
        .sort(orderCompare)
        .map((project) => {
            const projectWorkspaces = workspacesByProject.get(project.id) ?? [];
            const root = projectWorkspaces.find((workspace) => workspace.id === project.id);
            const children = projectWorkspaces
                .filter((workspace) => workspace.id !== project.id)
                .sort(orderCompare)
                .map((workspace) =>
                    projectWorkspace(
                        workspace,
                        endpoint,
                        config,
                        gitStates.get(workspace.id),
                        drafts,
                        modes,
                    ),
                );
            const agents = (root?.agents ?? project.agents).filter(
                (agent) => agent.archivedAt === null,
            );
            const git = projectGit(gitStates.get(project.id));
            return {
                id: project.id,
                kind: project.avatar?.kind === "home" ? "home" : "regular",
                name: project.name,
                ...(project.git?.branch === undefined || project.git.branch === null
                    ? {}
                    : { branch: project.git.branch }),
                orderKey: project.orderKey,
                path: computePath(project.compute),
                presence: "present",
                ...(project.initialization.error === null
                    ? {}
                    : { initializationError: project.initialization.error }),
                initializationStatus: project.initialization.status,
                ...(project.remoteSource === null ? {} : { remoteSource: project.remoteSource }),
                ...(project.avatar?.kind === "image"
                    ? {
                          avatar: {
                              height: 512,
                              width: 512,
                              url: `${endpoint.replace(/\/$/u, "")}/v0/projects/${encodeURIComponent(project.id)}/avatar`,
                          },
                      }
                    : {}),
                ...(git === undefined ? {} : { git }),
                usage: { totalTokens: 0 },
                unread: unreadOf(agents),
                workspaces: children,
                sessions: agents
                    .sort(orderCompare)
                    .map((agent) =>
                        projectAgent(
                            agent,
                            root,
                            endpoint,
                            config,
                            drafts.get(agent.id),
                            modes.get(agent.id),
                        ),
                    ),
            };
        });
}

export function replaceResource<T extends { id: string }>(
    resources: readonly T[],
    resource: T,
): readonly T[] {
    const index = resources.findIndex((candidate) => candidate.id === resource.id);
    if (index < 0) return [...resources, resource];
    if (resources[index] === resource) return resources;
    const next = [...resources];
    next[index] = resource;
    return next;
}

export function applyChanges<T extends object>(resource: T, changes: Partial<T>): T {
    return { ...resource, ...changes };
}

function projectWorkspace(
    workspace: Workspace,
    endpoint: string,
    config: DaemonConfig,
    gitState: GitState | undefined,
    drafts: ReadonlyMap<string, AgentDraftSnapshot> = new Map(),
    modes: ReadonlyMap<string, MessageMode | null> = new Map(),
): WorkspaceGroup {
    const agents = workspace.agents.filter((agent) => agent.archivedAt === null);
    const git = workspaceGit(gitState);
    return {
        id: workspace.id,
        name: workspace.name,
        orderKey: workspace.orderKey,
        path: computePath(workspace.compute),
        presence: "present",
        projectId: workspace.projectId,
        status: workspace.initialization.status,
        ...(workspace.initialization.error === null
            ? {}
            : { error: workspace.initialization.error }),
        ...(git === undefined ? {} : { git }),
        sessions: agents
            .sort(orderCompare)
            .map((agent) =>
                projectAgent(
                    agent,
                    workspace,
                    endpoint,
                    config,
                    drafts.get(agent.id),
                    modes.get(agent.id),
                ),
            ),
        usage: { totalTokens: 0 },
        unread: unreadOf(agents),
    };
}

function projectAgent(
    agent: Agent,
    workspace: Workspace | undefined,
    endpoint: string,
    config: DaemonConfig,
    draft?: AgentDraftSnapshot,
    storedMode?: MessageMode | null,
): GroupSession {
    const mode = modeOf(config, draft, storedMode);
    const projectId = workspace?.projectId ?? agent.workspaceId;
    const scope =
        workspace?.kind === "root"
            ? ({ kind: "project", projectId } as const)
            : ({ kind: "workspace", projectId, workspaceId: agent.workspaceId } as const);
    return {
        archived: agent.archivedAt !== null,
        createdAt: agent.createdAt,
        cwd: workspacePath(workspace),
        ...(draft?.value == null
            ? {}
            : {
                  draft: draft.value.text,
                  ...(draft.updatedAt === null ? {} : { draftUpdatedAt: draft.updatedAt }),
              }),
        effort: mode.effort,
        id: agent.id,
        modelId: mode.modelId,
        ownerInstanceId: endpoint,
        ...(agent.orderKey === null ? {} : { orderKey: agent.orderKey }),
        // Who this chat belongs to, when it belongs to another chat rather than
        // to a list. The protocol says it plainly and says it from the start, so
        // it never has to be guessed at from where a session did or did not turn
        // up.
        ...(agent.parentAgentId === null ? {} : { parentSessionId: agent.parentAgentId }),
        permissionMode: mode.permissionMode,
        scope,
        providerId: mode.providerId,
        ...(mode.serviceTier === null ? {} : { serviceTier: mode.serviceTier }),
        status: agent.status === "idle" ? "idle" : "running",
        ...(agent.title === null ? {} : { title: agent.title }),
        trackUnread: true,
        ...(agent.unread === null
            ? {}
            : {
                  unread: {
                      reason: agent.unread.reason.includes("question")
                          ? ("attention_needed" as const)
                          : ("turn_finished" as const),
                      since: agent.unread.since,
                  },
              }),
        updatedAt: agent.updatedAt,
    };
}

function projectQuestion(question: Question): UserInputRequest {
    return {
        requestId: question.id,
        questions: question.questions.map((prompt) => ({
            id: prompt.id,
            header: prompt.header,
            question: prompt.question,
            multiSelect: prompt.multiSelect,
            required: true,
            options: prompt.options,
        })),
    };
}

function projectSubagents(
    parent: Agent,
    activity: AgentActivityResponse | undefined,
): SessionState["subagents"] {
    return (activity?.subagents ?? []).map((agent) => {
        return {
            id: agent.id,
            parentSessionId: parent.id,
            description: agent.title ?? "Subagent",
            modelId: "",
            status: agent.status === "idle" ? "completed" : "running",
            depth: 1,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
            ...(agent.status === "idle" ? {} : { activeSince: agent.updatedAt }),
        };
    });
}

/**
 * Rows a message projected into, kept against the message itself.
 *
 * A message is replaced rather than edited when anything about it changes, so a
 * message this client has already projected produces the identical rows and can
 * hand them back. This is what keeps a streamed update proportional to the one
 * message that moved: every other message in the transcript returns the very
 * objects the previous projection produced, and the conversation projection,
 * entry merge, and equality checks downstream all settle on reference identity
 * instead of walking the content again.
 *
 * The run is part of the key because the same message projects differently
 * inside a run that is still going: an agent's text is `complete` only once its
 * run has stopped.
 */
interface MessageElements {
    readonly runId: string;
    readonly runStatus: Run["status"];
    readonly elements: readonly ChatElement[];
}
const messageElements = new WeakMap<Message, MessageElements>();

function projectMessage(
    entry: TranscriptMessage,
    runId: string,
    runStatus: Run["status"],
): readonly ChatElement[] {
    const cached = messageElements.get(entry.message);
    if (cached !== undefined && cached.runId === runId && cached.runStatus === runStatus)
        return cached.elements;
    const elements = messageElementsProject(entry, runId, runStatus);
    messageElements.set(entry.message, { runId, runStatus, elements });
    return elements;
}

function messageElementsProject(
    entry: TranscriptMessage,
    runId: string,
    runStatus: Run["status"],
): readonly ChatElement[] {
    const { message } = entry;
    const elementId = message.id;
    const base = { groupId: runId, runId, createdAt: message.createdAt };
    if (message.role === "user") {
        return [
            {
                ...base,
                id: `message:${elementId}`,
                kind: "user_message",
                messageId: message.id,
                identity: null,
                delivery:
                    message.status === "pending" && message.delivery === "steer"
                        ? "pending_steering"
                        : "sent",
                text: message.content
                    .filter(
                        (block): block is Extract<MessageBlock, { type: "text" }> =>
                            block.type === "text",
                    )
                    .map((block) => block.text)
                    .join("\n"),
                attachments: message.content
                    .filter(
                        (block): block is Extract<MessageBlock, { type: "image" }> =>
                            block.type === "image",
                    )
                    .map((block) => ({ data: block.data, mediaType: block.mimeType })),
            },
        ];
    }

    const elements: ChatElement[] = [];
    for (let index = 0; index < message.content.length; index += 1) {
        const block = message.content[index];
        if (block === undefined) continue;
        const id = `message:${elementId}:${String(index)}`;
        if (block.type === "text") {
            if (message.role === "agent") {
                elements.push({
                    ...base,
                    id,
                    kind: "agent_text",
                    text: block.text,
                    complete: runStatus !== "running",
                });
            } else if (message.role === "service" && runStatus === "failed") {
                elements.push({
                    ...base,
                    id,
                    kind: "failure",
                    outcome: "failed",
                    reason: block.text,
                });
            } else {
                elements.push({ ...base, id, kind: "system_notice", text: block.text });
            }
        } else if (block.type === "reasoning") {
            elements.push({
                ...base,
                id,
                kind: "thinking",
                text: block.text,
                complete: runStatus !== "running",
            });
        } else if (block.type === "tool_call") {
            elements.push({
                ...base,
                id,
                kind: "tool_call",
                toolCallId: block.id,
                name: block.name,
                arguments: block.arguments ?? {},
                argumentsComplete: true,
                status: projectToolStatus(block.status, runStatus),
                ...(block.result === undefined ? {} : { result: stringify(block.result) }),
                ...(block.presentation === undefined
                    ? {}
                    : { presentation: projectToolPresentation(block.presentation) }),
                // Only a reviewed call carries elevation, and only the granted
                // one is worth carrying: "not elevated" is the ordinary case
                // every unreviewed call is already in.
                ...(block.elevated === true ? { elevated: true } : {}),
            });
        } else if (block.type === "compaction") {
            elements.push({
                ...base,
                id,
                kind: "tool_call",
                toolCallId: message.id,
                name: "compact",
                arguments: {
                    trigger: block.trigger,
                },
                argumentsComplete: true,
                status: projectToolStatus(block.status, runStatus),
                presentation: {
                    kind: "compaction",
                    trigger: block.trigger,
                    ...(block.tokensBefore === null ? {} : { tokensBefore: block.tokensBefore }),
                    ...(block.tokensAfter === null ? {} : { tokensAfter: block.tokensAfter }),
                    ...(block.status === "failed" ? { failureReason: block.failureReason } : {}),
                },
            });
        }
    }
    return elements;
}

function projectToolStatus(
    status: "running" | "completed" | "failed",
    runStatus: Run["status"],
): "running" | "succeeded" | "failed" | "interrupted" {
    if (status === "completed") return "succeeded";
    if (status === "failed") return "failed";
    if (runStatus === "running") return "running";
    return runStatus === "failed" ? "failed" : "interrupted";
}

/** A settled run's footer, projected once per complete set of footer facts. */
interface RunEndProjection {
    readonly finalContextTokens?: number;
    readonly element: Extract<ChatElement, { kind: "group_end" }>;
}
const runEndElements = new WeakMap<Run, RunEndProjection>();
function projectRunEnd(
    run: Run,
    finalContextTokens?: number,
): Extract<ChatElement, { kind: "group_end" }> | undefined {
    const cached = runEndElements.get(run);
    if (cached !== undefined && cached.finalContextTokens === finalContextTokens)
        return cached.element;
    const element = runEndProject(run, finalContextTokens);
    if (element !== undefined) runEndElements.set(run, { finalContextTokens, element });
    return element;
}

function runEndProject(
    run: Run,
    finalContextTokens?: number,
): Extract<ChatElement, { kind: "group_end" }> | undefined {
    if (run.status === "running" || run.endedAt === null) return undefined;
    const reason =
        run.reason === "abort"
            ? "abort"
            : run.reason === "error"
              ? "error"
              : run.reason === "steering"
                ? "steering"
                : "completed";
    return {
        id: `run:${run.id}:end`,
        groupId: run.id,
        runId: run.id,
        createdAt: run.endedAt,
        kind: "group_end",
        outcome:
            run.status === "completed" ? "success" : run.status === "aborted" ? "stopped" : "error",
        reason,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        elapsedMs: Math.max(0, run.endedAt - run.startedAt),
        turnStartedAt: run.startedAt,
        turnElapsedMs: Math.max(0, run.endedAt - run.startedAt),
        usedTokens: usageTotal(run.usage),
        ...(finalContextTokens === undefined ? {} : { finalContextTokens }),
    };
}

/** Exact token consumption represented by one provider/model usage tree. */
function usageTotal(usage: UsageBreakdown): number {
    let total = 0;
    for (const models of Object.values(usage))
        for (const counts of Object.values(models))
            total += counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
    return total;
}

function projectToolPresentation(
    presentation: NonNullable<Extract<MessageBlock, { type: "tool_call" }>["presentation"]>,
): ToolPresentation {
    switch (presentation.type) {
        case "exploration":
            return { kind: "exploration", steps: presentation.operations };
        case "exec_command":
            return {
                kind: "command",
                command: presentation.command,
                ...(presentation.output === undefined || presentation.output === null
                    ? {}
                    : { output: presentation.output }),
                ...(presentation.terminalId === undefined || presentation.terminalId === null
                    ? {}
                    : { terminalId: projectNumericIdentity(presentation.terminalId) }),
            };
        case "background_terminal_interaction":
            return {
                kind: "terminal_input",
                terminalId: projectNumericIdentity(presentation.terminalId),
                command: presentation.command,
                input: presentation.input,
            };
        case "file_diff":
            return {
                kind: "file_edit",
                files: presentation.files,
                ...(presentation.omittedFiles === undefined
                    ? {}
                    : { omittedFiles: presentation.omittedFiles }),
            };
        case "search":
            return {
                kind: "search",
                target: presentation.target,
                query: presentation.query,
                ...(presentation.sources === undefined ? {} : { sources: presentation.sources }),
            };
    }
}

function projectUsage(
    usage: UsageBreakdown,
    currentProviderId: string,
    context?: AgentContextUsage | null,
): SessionUsage {
    const groups: SessionUsage["groups"][number][] = [];
    let totalTokens = 0;
    for (const [providerId, models] of Object.entries(usage)) {
        for (const [modelId, counts] of Object.entries(models)) {
            const group = usageGroup(providerId, modelId, counts);
            groups.push(group);
            totalTokens += group.usage.totalTokens;
        }
    }
    return {
        currentProviderId,
        groups,
        totalTokens,
        totalCost: 0,
        ...(context === undefined || context === null
            ? {}
            : {
                  context: {
                      approximate: context.approximate,
                      contextWindow: context.contextWindow,
                      ...(context.modelId === null ? {} : { modelId: context.modelId }),
                      providerId: context.providerId,
                      totalTokens: context.contextTokens,
                  },
              }),
        quotas: [],
    };
}

function usageGroup(
    providerId: string,
    modelId: string,
    counts: ModelUsage,
): SessionUsage["groups"][number] {
    const totalTokens = counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
    return {
        providerId,
        modelId,
        usage: {
            input: counts.input,
            output: counts.output,
            cacheRead: counts.cacheRead,
            cacheWrite: counts.cacheWrite,
            totalTokens,
            cost: { total: 0 },
        },
    };
}

function modelCatalog(config: DaemonConfig): SessionState["modelCatalog"] {
    return {
        defaultModelId: config.defaults.modelId,
        defaultProviderId: config.defaults.providerId,
        models: Object.entries(config.models).map(([id, model]) => ({ id, ...model })),
        providers: Object.entries(config.providers).map(([id, provider]) => ({ id, ...provider })),
    };
}

function activityOf(agent: Agent): SessionState["activity"] {
    const since = agent.updatedAt;
    switch (agent.status) {
        case "thinking":
            return { kind: "thinking", label: "Thinking", since };
        case "generating_tools":
            return { kind: "generating_tool_call", label: "Preparing tools", since };
        case "running_tools":
            return { kind: "executing_tool_call", label: "Running tools", since };
        case "working":
            return { kind: "generating_message", label: "Working", since };
        default:
            return { kind: "idle", label: "Idle", since };
    }
}

function unreadOf(agents: readonly Agent[]): ProjectGroup["unread"] {
    const unread = agents.flatMap((agent) => (agent.unread === null ? [] : [agent.unread]));
    if (unread.length === 0) return { count: 0, attentionCount: 0 };
    const since = Math.min(...unread.map((entry) => entry.since));
    return {
        count: unread.length,
        attentionCount: unread.filter((entry) => entry.reason.includes("question")).length,
        reason: unread[0]?.reason,
        since,
    };
}

function projectGit(git: GitState | undefined): GitChangeSnapshot | undefined {
    return git === undefined ? undefined : gitSnapshot(git);
}

function workspaceGit(git: GitState | undefined): GitChangeSnapshot | undefined {
    return git === undefined ? undefined : gitSnapshot(git);
}

function gitSnapshot(git: GitState): GitChangeSnapshot {
    return {
        changedFiles: git.changedFiles,
        insertions: git.insertions,
        deletions: git.deletions,
        files: git.files,
        generation: `${git.facts.head}:${String(git.scannedAt)}`,
        version: git.scannedAt,
        revision: git.facts.head,
        ...(git.comparison === "ready" && git.base !== null ? { baseRevision: git.base } : {}),
    };
}

function workspacePath(workspace: Workspace | undefined): string {
    return workspace === undefined ? "" : computePath(workspace.compute);
}

function computePath(compute: Project["compute"]): string {
    return compute.type === "host" ? compute.path : `/docker/${compute.image}`;
}

function newestRunningRun(runs: readonly Run[]): Run | undefined {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        if (run?.status === "running") return run;
    }
    return undefined;
}

function orderCompare<T extends { id: string; orderKey: string | null }>(
    left: T,
    right: T,
): number {
    if (left.orderKey === null)
        return right.orderKey === null ? left.id.localeCompare(right.id) : 1;
    if (right.orderKey === null) return -1;
    return left.orderKey.localeCompare(right.orderKey);
}

function messagesOrdered(messages: readonly TranscriptMessage[]): boolean {
    for (let index = 1; index < messages.length; index += 1)
        if (compareMessages(messages[index - 1]!, messages[index]!) > 0) return false;
    return true;
}

function compareMessages(left: TranscriptMessage, right: TranscriptMessage): number {
    return (
        left.message.createdAt - right.message.createdAt ||
        left.message.id.localeCompare(right.message.id)
    );
}

/** Deterministically projects a daemon CUID2 into the UI's numeric process identity space. */
export function projectNumericIdentity(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}

function stringify(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
