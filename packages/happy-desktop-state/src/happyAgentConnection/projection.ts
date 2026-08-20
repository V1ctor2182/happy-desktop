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

export function projectElements(input: SessionProjectionInput): readonly ChatElement[] {
    const messagesByRun = new Map<string, TranscriptMessage[]>();
    const pending: TranscriptMessage[] = [];
    for (const entry of input.messages) {
        if (entry.runId === null) pending.push(entry);
        else {
            const entries = messagesByRun.get(entry.runId) ?? [];
            entries.push(entry);
            messagesByRun.set(entry.runId, entries);
        }
    }

    const elements: ChatElement[] = [];
    for (const run of input.runs) {
        const messages = messagesByRun.get(run.id) ?? [];
        messages.sort(compareMessages);
        for (const entry of messages) {
            elements.push(...projectMessage(entry, run.id, run.status));
        }
        if (
            run.status === "running" &&
            !elements.some(
                (element) =>
                    element.runId === run.id &&
                    element.kind !== "user_message" &&
                    element.kind !== "inference",
            )
        ) {
            elements.push({
                id: `inference:${run.id}`,
                groupId: run.id,
                runId: run.id,
                createdAt: run.startedAt,
                kind: "inference",
                state: "waiting",
            });
        }
        const end = projectRunEnd(run);
        if (end !== undefined) elements.push(end);
    }
    for (const entry of pending.sort(compareMessages)) {
        elements.push(...projectMessage(entry, `pending:${entry.message.id}`, "running"));
    }
    if (input.question?.status === "pending") {
        const runId = input.question.runId;
        elements.push({
            id: `question:${input.question.id}`,
            groupId: runId,
            runId,
            createdAt: input.question.createdAt,
            kind: "tool_call",
            toolCallId: input.question.id,
            name: "request_user_input",
            arguments: {
                questions: input.question.questions,
            },
            argumentsComplete: true,
            status: "running",
        });
    }
    return elements;
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

function projectMessage(
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
                toolCallId: id,
                name: block.name,
                arguments: block.arguments ?? {},
                argumentsComplete: true,
                status:
                    block.status === "completed"
                        ? "succeeded"
                        : block.status === "failed"
                          ? "failed"
                          : "running",
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
                    replacedMessages: block.replacedMessageIds.length,
                },
                argumentsComplete: true,
                status:
                    block.status === "completed"
                        ? "succeeded"
                        : block.status === "failed"
                          ? "failed"
                          : "running",
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

function projectRunEnd(run: Run): Extract<ChatElement, { kind: "group_end" }> | undefined {
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
    };
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
