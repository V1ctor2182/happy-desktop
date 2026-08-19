import {
    HappyAgentClient,
    type Agent,
    type AgentActivityResponse,
    type DaemonConfig,
    type GitState,
    type HappyAgentEvent,
    type Message,
    type MessageMode,
    type Project,
    type Question,
    type Run,
    type UsageBreakdown,
    type Workspace,
} from "@slopus/happy-agent-client";
import { ChatStore } from "./ChatStore.js";
import { CHECKING_SERVER_COMPATIBILITY, serverCompatibility } from "./compatibility.js";
import { projectRegistrationError } from "./errors.js";
import {
    applyChanges,
    defaultMode,
    modeOf,
    projectElements,
    projectGroups,
    projectNumericIdentity,
    projectSession,
    replaceResource,
    type SessionProjectionInput,
    type TranscriptMessage,
} from "./projection.js";
import type {
    ConnectHappyAgentOptions,
    CreateSessionInput,
    DraftUpdate,
    GroupDelta,
    GroupTarget,
    GroupsState,
    MutationAction,
    MutationRejectedDelta,
    RigConnection,
    RigGroupsSubscriptionOptions,
    RigSessionSubscriptionOptions,
    ServerCompatibility,
} from "./types.js";

const INITIAL_RECONNECT_MS = 250;
const MAXIMUM_RECONNECT_MS = 5_000;
const DEFAULT_HISTORY_LIMIT = 100;

interface SessionSubscriber extends RigSessionSubscriptionOptions {
    closed: boolean;
}

interface SessionEntry {
    id: string;
    store: ChatStore;
    subscribers: Set<SessionSubscriber>;
    messages: Map<string, TranscriptMessage>;
    runs: Map<string, Run>;
    hasMore: boolean;
    loading: Promise<void> | undefined;
    loadingMore: boolean;
    loadMoreError?: string;
    hydrating: boolean;
    bufferedEvents: HappyAgentEvent[];
    activityRevision: number;
    questionRecovery: Promise<void> | undefined;
    agent?: Agent;
    workspace?: Workspace;
    activity?: AgentActivityResponse;
    question?: Question | null;
    usage?: UsageBreakdown;
}

interface GroupsSubscriber extends RigGroupsSubscriptionOptions {
    closed: boolean;
}

export function connectHappyAgent(options: ConnectHappyAgentOptions): RigConnection {
    const client = options.client ?? new HappyAgentClient(options);
    const endpoint = options.endpoint.toString();
    const rootController = new AbortController();
    const wait = options.wait ?? abortableWait;
    const now = options.now ?? Date.now;
    const nextId = createCuid2(now);
    const sessions = new Map<string, SessionEntry>();
    const groupSubscribers = new Set<GroupsSubscriber>();
    const intendedModes = new Map<string, MessageMode>();
    const draftRevisions = new Map<string, number>();
    const mutationQueues = new Map<string, Promise<void>>();
    const sessionMutationCounts = new Map<string, number>();
    const gitStates = new Map<string, GitState>();
    const processOwners = new Map<string, string>();
    let projects: readonly Project[] = [];
    let workspaces: readonly Workspace[] = [];
    let config: DaemonConfig | undefined;
    let cursor: string | undefined;
    let resyncTask: Promise<void> | undefined;
    const resyncBufferedEvents: HappyAgentEvent[] = [];
    const hydrationBroadcastEvents: HappyAgentEvent[] = [];
    let connection: GroupsState["connection"] = "connecting";
    let compatibility: ServerCompatibility = CHECKING_SERVER_COMPATIBILITY;
    let groups = [] as ReturnType<typeof projectGroups>;
    let closed = false;

    const reportCompatibility = (next: ServerCompatibility): void => {
        compatibility = next;
        options.onCompatibilityChange?.(next);
    };

    const reportMutationFailure = (
        action: MutationAction,
        mutationId: string,
        error: unknown,
        sessionId?: string,
    ): void => {
        const rejection: MutationRejectedDelta = {
            action,
            message: error instanceof Error ? error.message : String(error),
            mutationId,
            type: "mutation_rejected",
        };
        options.onMutationRejected?.(rejection);
        for (const subscriber of groupSubscribers) subscriber.onDelta?.(rejection);
        const session = sessionId === undefined ? undefined : sessions.get(sessionId);
        if (session !== undefined) {
            for (const subscriber of session.subscribers) subscriber.onDelta?.(rejection);
        }
    };

    const reportBackgroundError = (error: unknown): void => {
        if (rootController.signal.aborted) return;
        for (const subscriber of groupSubscribers) subscriber.onError?.(error);
        for (const entry of sessions.values()) {
            for (const subscriber of entry.subscribers) subscriber.onError?.(error);
        }
    };

    const background = (task: Promise<unknown>): void => {
        void task.catch(reportBackgroundError);
    };

    const groupState = (): GroupsState => ({
        connection,
        sessionsComplete: config !== undefined,
    });

    const publishGroups = (deltas: readonly GroupDelta[] = []): void => {
        if (config !== undefined) {
            groups = projectGroups(projects, workspaces, endpoint, config, gitStates);
        }
        const state = groupState();
        for (const subscriber of groupSubscribers) {
            if (subscriber.closed) continue;
            subscriber.onChange(groups, state);
            for (const delta of deltas) subscriber.onDelta?.(delta);
        }
    };

    const projectionOf = (entry: SessionEntry): SessionProjectionInput | undefined => {
        if (entry.agent === undefined || config === undefined) return undefined;
        return {
            agent: entry.agent,
            config,
            connection,
            endpoint,
            hasMore: entry.hasMore,
            messages: [...entry.messages.values()],
            mode: intendedModes.get(entry.id),
            ...(entry.activity === undefined ? {} : { activity: entry.activity }),
            ...(entry.question === undefined ? {} : { question: entry.question }),
            runs: [...entry.runs.values()].sort(runCompare),
            ...(entry.usage === undefined ? {} : { usage: entry.usage }),
            workspace: entry.workspace ?? workspaceOf(entry.agent.workspaceId),
        };
    };

    const publishSession = (entry: SessionEntry): void => {
        const projection = projectionOf(entry);
        if (projection === undefined) return;
        let session = projectSession(projection);
        if (entry.loadingMore) session = { ...session, loadingMore: true };
        if (entry.loadMoreError !== undefined) {
            session = { ...session, loadMoreError: entry.loadMoreError };
        }
        const elements = projectElements(projection);
        const deltas = entry.store.replace(elements, session);
        for (const subscriber of entry.subscribers) {
            if (subscriber.closed) continue;
            subscriber.onChange(elements, session);
            for (const delta of deltas) subscriber.onDelta?.(delta);
        }
    };

    const publishConnection = (next: GroupsState["connection"]): void => {
        if (connection === next) return;
        connection = next;
        publishGroups([{ type: "groups_state_changed", state: groupState() }]);
        for (const entry of sessions.values()) publishSession(entry);
    };

    const workspaceOf = (workspaceId: string): Workspace | undefined =>
        workspaces.find((candidate) => candidate.id === workspaceId);

    const agentOf = (agentId: string): Agent | undefined => {
        for (const workspace of workspaces) {
            const agent = workspace.agents.find((candidate) => candidate.id === agentId);
            if (agent !== undefined) return agent;
        }
        for (const project of projects) {
            const agent = project.agents.find((candidate) => candidate.id === agentId);
            if (agent !== undefined) return agent;
        }
        return undefined;
    };

    const shouldAdoptVersion = (
        current: { id: string; version: string } | undefined,
        updated: { id: string; version: string },
    ): boolean =>
        current === undefined ||
        current.version === current.id ||
        current.version.localeCompare(updated.version) <= 0;

    const replaceAgent = (agent: Agent): void => {
        workspaces = workspaces.map((workspace) =>
            workspace.id === agent.workspaceId ||
            workspace.agents.some((candidate) => candidate.id === agent.id)
                ? { ...workspace, agents: replaceResource(workspace.agents, agent) as Agent[] }
                : workspace,
        );
        projects = projects.map((project) =>
            project.id === agent.workspaceId ||
            project.agents.some((candidate) => candidate.id === agent.id)
                ? { ...project, agents: replaceResource(project.agents, agent) as Agent[] }
                : project,
        );
        const entry = sessions.get(agent.id);
        if (entry !== undefined) {
            entry.agent = agent;
            entry.workspace = workspaceOf(agent.workspaceId);
            publishSession(entry);
        }
        publishGroups();
    };

    const adoptAgent = (agent: Agent): boolean => {
        if (!shouldAdoptVersion(agentOf(agent.id), agent)) return false;
        replaceAgent(agent);
        return true;
    };

    const adoptProject = (project: Project, deltas: readonly GroupDelta[] = []): boolean => {
        const current = projects.find((candidate) => candidate.id === project.id);
        if (!shouldAdoptVersion(current, project)) return false;
        projects = replaceResource(projects, project);
        publishGroups(deltas);
        return true;
    };

    const adoptWorkspace = (workspace: Workspace, deltas: readonly GroupDelta[] = []): boolean => {
        if (!shouldAdoptVersion(workspaceOf(workspace.id), workspace)) return false;
        workspaces = replaceResource(workspaces, workspace);
        publishGroups(deltas);
        return true;
    };

    const setActivity = (entry: SessionEntry, activity: AgentActivityResponse): void => {
        for (const [processId, agentId] of processOwners) {
            if (agentId === entry.id) processOwners.delete(processId);
        }
        for (const process of activity.processes) {
            if (process.status === "running") processOwners.set(process.id, entry.id);
        }
        entry.activity = activity;
    };

    const disposeSessionIfIdle = (entry: SessionEntry): void => {
        if (
            entry.subscribers.size > 0 ||
            entry.loading !== undefined ||
            entry.questionRecovery !== undefined ||
            (sessionMutationCounts.get(entry.id) ?? 0) > 0
        ) {
            return;
        }
        if (sessions.get(entry.id) !== entry) return;
        sessions.delete(entry.id);
        entry.bufferedEvents.length = 0;
        for (const [processId, agentId] of processOwners) {
            if (agentId === entry.id) processOwners.delete(processId);
        }
        draftRevisions.delete(entry.id);
        const intended = intendedModes.get(entry.id);
        const agent = agentOf(entry.id);
        if (
            intended !== undefined &&
            agent !== undefined &&
            config !== undefined &&
            modesEqual(modeOf(agent, config), intended)
        ) {
            intendedModes.delete(entry.id);
        }
    };

    const drainHydrationBroadcastEvents = (): void => {
        if ([...sessions.values()].some((entry) => entry.hydrating)) return;
        const buffered = hydrationBroadcastEvents.splice(0);
        for (const event of buffered) applyEvent(event);
    };

    const loadSession = (entry: SessionEntry): Promise<void> => {
        if (entry.loading !== undefined) return entry.loading;
        entry.hydrating = true;
        const loading = Promise.all([
            client.getMessages(
                entry.id,
                { limit: DEFAULT_HISTORY_LIMIT, omitToolData: false },
                { signal: rootController.signal },
            ),
            optional(() => client.getAgentActivity(entry.id, { signal: rootController.signal })),
            optional(() => client.getPendingQuestion(entry.id, { signal: rootController.signal })),
            optional(() => client.getAgentUsage(entry.id, { signal: rootController.signal })),
        ])
            .then(async ([history, activity, question, usage]) => {
                const agentResponse = await client.getAgent(entry.id, {
                    signal: rootController.signal,
                });
                if (closed) return;
                entry.agent = agentResponse.agent;
                entry.workspace = workspaceOf(agentResponse.agent.workspaceId);
                entry.messages.clear();
                entry.runs.clear();
                ingestHistory(entry, history.runs, history.pending);
                entry.hasMore = history.hasMore;
                if (activity !== undefined) setActivity(entry, activity);
                if (question !== undefined) entry.question = question.question;
                if (usage !== undefined) entry.usage = usage.usage;
                entry.hydrating = false;
                const buffered = entry.bufferedEvents.splice(0);
                replaceAgent(agentResponse.agent);
                publishSession(entry);
                for (const event of buffered) applyEvent(event);
                drainHydrationBroadcastEvents();
                if (
                    question === undefined &&
                    agentResponse.agent.pendingQuestionId !== null &&
                    entry.subscribers.size > 0
                ) {
                    recoverQuestion(entry);
                }
            })
            .catch((error: unknown) => {
                if (rootController.signal.aborted) return;
                entry.hydrating = false;
                const buffered = entry.bufferedEvents.splice(0);
                for (const event of buffered) applyEvent(event);
                drainHydrationBroadcastEvents();
                for (const subscriber of entry.subscribers) subscriber.onError?.(error);
            })
            .finally(() => {
                if (entry.loading === loading) entry.loading = undefined;
                disposeSessionIfIdle(entry);
            });
        entry.loading = loading;
        return loading;
    };

    const resync = (): Promise<void> => {
        if (resyncTask !== undefined) return resyncTask;
        const running = (async (): Promise<void> => {
            const bootstrap = await client.getDesktopBootstrap({
                signal: rootController.signal,
            });
            const watchedGit = await optional(() =>
                client.watchGit(
                    {
                        workspaceIds: [
                            ...new Set([
                                ...bootstrap.projects
                                    .filter(
                                        (project) =>
                                            project.archivedAt === null &&
                                            project.status === "active",
                                    )
                                    .map((project) => project.id),
                                ...bootstrap.workspaces
                                    .filter(
                                        (workspace) =>
                                            workspace.archivedAt === null &&
                                            workspace.status === "active",
                                    )
                                    .map((workspace) => workspace.id),
                            ]),
                        ],
                    },
                    { signal: rootController.signal },
                ),
            );
            config = bootstrap.config;
            projects = bootstrap.projects;
            workspaces = bootstrap.workspaces;
            gitStates.clear();
            for (const [workspaceId, git] of Object.entries(watchedGit?.snapshots ?? {})) {
                gitStates.set(workspaceId, git);
            }
            advanceCursor(bootstrap.cursor);
            for (const entry of sessions.values()) {
                const known = agentOf(entry.id);
                if (known !== undefined) {
                    entry.agent = known;
                    entry.workspace = workspaceOf(known.workspaceId);
                }
            }
            publishGroups([
                {
                    type: "projects_changed",
                    projects: projectGroups(projects, workspaces, endpoint, config, gitStates),
                },
            ]);
            await Promise.all([...sessions.values()].map((entry) => loadSession(entry)));
            const buffered = resyncBufferedEvents.splice(0);
            for (const event of buffered) {
                if (event.cursor.localeCompare(bootstrap.cursor) > 0) applyEventNow(event);
            }
        })();
        const tracked = running.finally(() => {
            if (resyncTask === tracked) resyncTask = undefined;
        });
        resyncTask = tracked;
        return tracked;
    };

    const applyEvent = (event: HappyAgentEvent): void => {
        advanceCursor(event.cursor);
        if (resyncTask !== undefined) {
            resyncBufferedEvents.push(event);
            return;
        }
        if (
            (event.type === "question.updated" ||
                event.type === "process.updated" ||
                event.type === "process.exited") &&
            [...sessions.values()].some((entry) => entry.hydrating)
        ) {
            hydrationBroadcastEvents.push(event);
            return;
        }
        applyEventNow(event);
    };

    const advanceCursor = (next: string): void => {
        if (cursor === undefined || cursor.localeCompare(next) < 0) cursor = next;
    };

    const refetchOrResync = (refetch: Promise<void>): void => {
        background(
            refetch.catch(async (error: unknown) => {
                if (rootController.signal.aborted) throw error;
                await resync();
            }),
        );
    };

    const applyEventNow = (event: HappyAgentEvent): void => {
        const eventAgentId = agentIdOfEvent(event);
        const hydratingEntry = eventAgentId === undefined ? undefined : sessions.get(eventAgentId);
        if (hydratingEntry?.hydrating === true) {
            hydratingEntry.bufferedEvents.push(event);
            return;
        }
        switch (event.type) {
            case "project.created":
                projects = replaceResource(projects, event.payload.project);
                publishGroups([{ type: "project_added", projectId: event.payload.project.id }]);
                return;
            case "project.updated": {
                const current = projects.find((project) => project.id === event.payload.projectId);
                if (current === undefined) {
                    background(resync());
                    return;
                }
                if (current.version !== event.payload.previousVersion) {
                    refetchOrResync(
                        client
                            .getProject(event.payload.projectId, {
                                signal: rootController.signal,
                            })
                            .then(({ project }) => {
                                const latest = projects.find(
                                    (candidate) => candidate.id === project.id,
                                );
                                if (
                                    latest === undefined ||
                                    latest.version.localeCompare(project.version) <= 0
                                ) {
                                    projects = replaceResource(projects, project);
                                    publishGroups();
                                }
                            }),
                    );
                    return;
                }
                projects = replaceResource(projects, {
                    ...applyChanges(current, event.payload.changes),
                    version: event.payload.version,
                });
                publishGroups();
                return;
            }
            case "workspace.created":
                workspaces = replaceResource(workspaces, event.payload.workspace);
                publishGroups([
                    {
                        type: "workspace_added",
                        projectId: event.payload.workspace.projectId,
                        workspaceId: event.payload.workspace.id,
                    },
                ]);
                return;
            case "workspace.updated": {
                const current = workspaceOf(event.payload.workspaceId);
                if (current === undefined) {
                    background(resync());
                    return;
                }
                if (current.version !== event.payload.previousVersion) {
                    refetchOrResync(
                        client
                            .getWorkspace(event.payload.workspaceId, {
                                signal: rootController.signal,
                            })
                            .then(({ workspace }) => {
                                const latest = workspaceOf(workspace.id);
                                if (
                                    latest === undefined ||
                                    latest.version.localeCompare(workspace.version) <= 0
                                ) {
                                    workspaces = replaceResource(workspaces, workspace);
                                    publishGroups();
                                }
                            }),
                    );
                    return;
                }
                workspaces = replaceResource(workspaces, {
                    ...applyChanges(current, event.payload.changes),
                    version: event.payload.version,
                });
                publishGroups();
                return;
            }
            case "agent.created":
                replaceAgent(event.payload.agent);
                publishGroups([{ type: "session_added", sessionId: event.payload.agent.id }]);
                return;
            case "agent.updated": {
                const current = agentOf(event.payload.agentId);
                if (current === undefined) {
                    refetchOrResync(
                        client
                            .getAgent(event.payload.agentId, { signal: rootController.signal })
                            .then(({ agent }) => {
                                const latest = agentOf(agent.id);
                                if (
                                    latest === undefined ||
                                    latest.version.localeCompare(agent.version) <= 0
                                ) {
                                    replaceAgent(agent);
                                }
                            }),
                    );
                    return;
                }
                if (current.version !== event.payload.previousVersion) {
                    refetchOrResync(
                        client
                            .getAgent(event.payload.agentId, { signal: rootController.signal })
                            .then(({ agent }) => {
                                const latest = agentOf(agent.id);
                                if (
                                    latest === undefined ||
                                    latest.version.localeCompare(agent.version) <= 0
                                ) {
                                    replaceAgent(agent);
                                }
                            }),
                    );
                    return;
                }
                replaceAgent({
                    ...applyChanges(current, event.payload.changes),
                    version: event.payload.version,
                });
                return;
            }
            case "run.started":
                acceptMessages(
                    event.payload.agentId,
                    event.payload.acceptedMessageIds,
                    event.payload.run.id,
                );
                updateRun(event.payload.agentId, event.payload.run);
                return;
            case "run.boundary":
                updateRun(event.payload.agentId, event.payload.finishedRun);
                acceptMessages(
                    event.payload.agentId,
                    event.payload.acceptedMessageIds,
                    event.payload.startedRun.id,
                );
                updateRun(event.payload.agentId, event.payload.startedRun);
                return;
            case "run.finished":
                updateRun(event.payload.agentId, event.payload.run);
                {
                    /*
                     * A run boundary is the point where durable history becomes
                     * authoritative. Besides recovering missed deltas, this
                     * supplies every completed tool block before the
                     * conversation folds the turn behind its trace control.
                     */
                    const entry = sessions.get(event.payload.agentId);
                    if (entry !== undefined) background(loadSession(entry));
                }
                options.onSessionFinished?.(event.payload.agentId);
                return;
            case "message.created":
                createMessage(
                    event.payload.agentId,
                    event.payload.message,
                    event.payload.runId,
                    event.payload.mutationId,
                );
                return;
            case "message.updated":
                updateMessage(event.payload.agentId, event.payload.message, event.payload.runId);
                return;
            case "message.delta":
                appendMessageDelta(event.payload);
                return;
            case "message.deleted": {
                const entry = sessions.get(event.payload.agentId);
                entry?.messages.delete(event.payload.messageId);
                if (entry !== undefined) publishSession(entry);
                return;
            }
            case "question.created":
                updateQuestion(event.payload.question.agentId, event.payload.question);
                return;
            case "question.updated":
                for (const entry of sessions.values()) {
                    if (
                        entry.question?.id === event.payload.questionId ||
                        entry.agent?.pendingQuestionId === event.payload.questionId
                    ) {
                        if (
                            entry.question === undefined ||
                            entry.question === null ||
                            entry.question.version !== event.payload.previousVersion
                        ) {
                            refetchOrResync(
                                client
                                    .getPendingQuestion(entry.id, {
                                        signal: rootController.signal,
                                    })
                                    .then(({ question }) => {
                                        if (
                                            question === null ||
                                            entry.question === undefined ||
                                            entry.question === null ||
                                            shouldAdoptVersion(entry.question, question)
                                        ) {
                                            entry.question = question;
                                            publishSession(entry);
                                        }
                                    }),
                            );
                            continue;
                        }
                        entry.question = {
                            ...applyChanges(entry.question, event.payload.changes),
                            version: event.payload.version,
                        };
                        publishSession(entry);
                    }
                }
                return;
            case "process.started":
                {
                    processOwners.set(event.payload.process.id, event.payload.process.agentId);
                    const entry = sessions.get(event.payload.process.agentId);
                    if (entry !== undefined) void loadActivity(entry);
                }
                return;
            case "process.updated":
            case "process.exited": {
                const agentId = processOwners.get(event.payload.processId);
                const entry = agentId === undefined ? undefined : sessions.get(agentId);
                if (entry !== undefined) void loadActivity(entry);
                if (event.type === "process.exited") {
                    processOwners.delete(event.payload.processId);
                }
                return;
            }
            case "config.updated":
                background(resync());
                return;
            case "git.updated": {
                const { git, workspaceId } = event.payload;
                gitStates.set(workspaceId, git);
                workspaces = workspaces.map((workspace) =>
                    workspace.id === workspaceId ? { ...workspace, git: git.facts } : workspace,
                );
                projects = projects.map((project) =>
                    project.id === workspaceId ? { ...project, git: git.facts } : project,
                );
                publishGroups();
                return;
            }
            case "profile.updated":
            case "terminal.created":
            case "terminal.updated":
                return;
        }
    };

    const updateRun = (agentId: string, run: Run): void => {
        const entry = sessions.get(agentId);
        if (entry === undefined) return;
        entry.runs.set(run.id, run);
        publishSession(entry);
    };

    const updateMessage = (
        agentId: string,
        message: Message,
        runId: string | null,
        optimisticId?: string,
    ): void => {
        const entry = sessions.get(agentId);
        if (entry === undefined) return;
        const current = entry.messages.get(message.id);
        const optimistic =
            optimisticId === undefined ? undefined : entry.messages.get(optimisticId);
        if (optimisticId !== undefined && optimisticId !== message.id) {
            entry.messages.delete(optimisticId);
        }
        entry.messages.set(message.id, {
            message,
            runId,
            ...(current?.elementId === undefined && optimistic === undefined
                ? {}
                : { elementId: current?.elementId ?? optimistic?.elementId ?? optimisticId }),
        });
        publishSession(entry);
    };

    const createMessage = (
        agentId: string,
        message: Message,
        runId: string | null,
        optimisticId?: string,
    ): void => {
        const entry = sessions.get(agentId);
        const current = entry?.messages.get(message.id);
        /*
         * Happy Agent announces the start of every assistant content block
         * with the same message identity and an empty body. Only the first
         * announcement creates the message; replacing an existing snapshot
         * here would erase all preceding reasoning and tool calls until a
         * later full update (and can erase them permanently when the block
         * finishes through deltas alone).
         */
        if (
            current?.message.role === "agent" &&
            message.role === "agent" &&
            message.content.length === 0
        ) {
            return;
        }
        updateMessage(agentId, message, runId, optimisticId);
    };

    const acceptMessages = (
        agentId: string,
        messageIds: readonly string[],
        runId: string,
    ): void => {
        const entry = sessions.get(agentId);
        if (entry === undefined || messageIds.length === 0) return;
        for (const messageId of messageIds) {
            const current = entry.messages.get(messageId);
            if (current?.message.role !== "user") continue;
            entry.messages.set(messageId, {
                elementId: current.elementId,
                message: {
                    ...current.message,
                    status: "accepted",
                    runId,
                },
                runId,
            });
        }
        publishSession(entry);
    };

    const appendMessageDelta = (
        payload: Extract<HappyAgentEvent, { type: "message.delta" }>["payload"],
    ): void => {
        const entry = sessions.get(payload.agentId);
        const current = entry?.messages.get(payload.messageId);
        if (entry === undefined || current === undefined) return;
        const block = current.message.content[payload.blockIndex];
        if (block === undefined || (block.type !== "text" && block.type !== "reasoning")) return;
        const content = [...current.message.content];
        content[payload.blockIndex] = { ...block, text: block.text + payload.append };
        entry.messages.set(payload.messageId, {
            ...current,
            message: { ...current.message, content } as Message,
        });
        publishSession(entry);
    };

    const updateQuestion = (agentId: string, question: Question): void => {
        const entry = sessions.get(agentId);
        if (entry === undefined) return;
        if (
            entry.question !== undefined &&
            entry.question !== null &&
            !shouldAdoptVersion(entry.question, question)
        ) {
            return;
        }
        entry.question = question;
        publishSession(entry);
    };

    const loadActivity = async (entry: SessionEntry): Promise<void> => {
        const revision = entry.activityRevision + 1;
        entry.activityRevision = revision;
        try {
            const activity = await client.getAgentActivity(entry.id, {
                signal: rootController.signal,
            });
            if (
                entry.activityRevision !== revision ||
                sessions.get(entry.id) !== entry ||
                entry.subscribers.size === 0
            ) {
                return;
            }
            setActivity(entry, activity);
            publishSession(entry);
        } catch (error) {
            if (!rootController.signal.aborted) {
                for (const subscriber of entry.subscribers) subscriber.onError?.(error);
            }
        }
    };

    const recoverQuestion = (entry: SessionEntry): void => {
        if (entry.questionRecovery !== undefined) return;
        const running = (async (): Promise<void> => {
            let retryMs = INITIAL_RECONNECT_MS;
            let lastError: unknown;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                if (
                    rootController.signal.aborted ||
                    sessions.get(entry.id) !== entry ||
                    entry.subscribers.size === 0 ||
                    entry.question !== undefined ||
                    entry.agent?.pendingQuestionId === null
                ) {
                    return;
                }
                try {
                    const response = await client.getPendingQuestion(entry.id, {
                        signal: rootController.signal,
                    });
                    if (sessions.get(entry.id) !== entry) return;
                    if (
                        (response.question === null &&
                            (entry.question === undefined || entry.question === null)) ||
                        (response.question !== null &&
                            (entry.question === undefined ||
                                entry.question === null ||
                                shouldAdoptVersion(entry.question, response.question)))
                    ) {
                        entry.question = response.question;
                        publishSession(entry);
                    }
                    return;
                } catch (error) {
                    if (rootController.signal.aborted) return;
                    lastError = error;
                }
                await wait(retryMs, rootController.signal).catch(() => undefined);
                retryMs = Math.min(retryMs * 2, MAXIMUM_RECONNECT_MS);
            }
            if (lastError !== undefined) {
                for (const subscriber of entry.subscribers) subscriber.onError?.(lastError);
            }
        })();
        const tracked = running.finally(() => {
            if (entry.questionRecovery === tracked) entry.questionRecovery = undefined;
            disposeSessionIfIdle(entry);
        });
        entry.questionRecovery = tracked;
    };

    const runStream = async (): Promise<void> => {
        let reconnectMs = INITIAL_RECONNECT_MS;
        while (!rootController.signal.aborted) {
            try {
                const health = await client.getHealth({ signal: rootController.signal });
                const nextCompatibility = serverCompatibility(health.version.protocol);
                reportCompatibility(nextCompatibility);
                if (nextCompatibility.status !== "compatible" || !health.ready) {
                    publishConnection(config === undefined ? "connecting" : "reconnecting");
                    await wait(reconnectMs, rootController.signal);
                    reconnectMs = Math.min(reconnectMs * 2, MAXIMUM_RECONNECT_MS);
                    continue;
                }
                if (config === undefined) await resync();
                let reopen = false;
                for await (const frame of client.streamEvents({
                    after: cursor,
                    signal: rootController.signal,
                })) {
                    if (frame.kind === "hello") {
                        if (frame.hello.gap) {
                            await resync();
                            reopen = true;
                            break;
                        }
                        advanceCursor(frame.hello.cursor);
                        publishConnection("live");
                        reconnectMs = INITIAL_RECONNECT_MS;
                    } else {
                        applyEvent(frame.event);
                    }
                }
                if (reopen) continue;
                if (!rootController.signal.aborted) publishConnection("reconnecting");
            } catch (error) {
                if (rootController.signal.aborted) break;
                publishConnection(config === undefined ? "connecting" : "reconnecting");
                for (const subscriber of groupSubscribers) subscriber.onError?.(error);
                for (const entry of sessions.values()) {
                    for (const subscriber of entry.subscribers) subscriber.onError?.(error);
                }
            }
            if (!rootController.signal.aborted) {
                await wait(reconnectMs, rootController.signal);
                reconnectMs = Math.min(reconnectMs * 2, MAXIMUM_RECONNECT_MS);
            }
        }
    };

    const mutation = <T>(
        action: MutationAction,
        mutationId: string,
        request: () => Promise<T>,
        applied?: (value: T) => void,
        rejected?: () => void,
        sessionId?: string,
        queueKey = mutationId,
    ): string => {
        const queued = (mutationQueues.get(queueKey) ?? Promise.resolve()).then(request);
        const settled = queued.then(
            () => undefined,
            () => undefined,
        );
        mutationQueues.set(queueKey, settled);
        if (sessionId !== undefined) {
            sessionMutationCounts.set(sessionId, (sessionMutationCounts.get(sessionId) ?? 0) + 1);
        }
        void queued
            .then((value) => {
                if (!closed) applied?.(value);
            })
            .catch((error: unknown) => {
                if (!rootController.signal.aborted) {
                    rejected?.();
                    reportMutationFailure(action, mutationId, error, sessionId);
                }
            })
            .finally(() => {
                if (mutationQueues.get(queueKey) === settled) mutationQueues.delete(queueKey);
                if (sessionId !== undefined) {
                    const pending = (sessionMutationCounts.get(sessionId) ?? 1) - 1;
                    if (pending === 0) sessionMutationCounts.delete(sessionId);
                    else sessionMutationCounts.set(sessionId, pending);
                    const entry = sessions.get(sessionId);
                    if (entry !== undefined) disposeSessionIfIdle(entry);
                }
            });
        return mutationId;
    };

    const saveMode = (
        sessionId: string,
        action: Extract<
            MutationAction,
            "switch_model" | "set_effort" | "set_service_tier" | "set_permission_mode"
        >,
        change: (mode: MessageMode) => MessageMode,
    ): string => {
        const mutationId = nextId();
        const agent = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
        if (agent === undefined || config === undefined) {
            reportMutationFailure(action, mutationId, new Error("The agent is not loaded."));
            return mutationId;
        }
        const previousMode = intendedModes.get(sessionId);
        const mode = change(modeOf(agent, config, previousMode));
        intendedModes.set(sessionId, mode);
        const revision = (draftRevisions.get(sessionId) ?? 0) + 1;
        draftRevisions.set(sessionId, revision);
        const entry = sessions.get(sessionId);
        if (entry !== undefined) publishSession(entry);
        return mutation(
            action,
            mutationId,
            () =>
                client.saveAgentDraft(
                    sessionId,
                    {
                        draft: { ...mode, text: agent.draft?.text ?? "" },
                        mutationId,
                        updatedAt: now(),
                    },
                    { signal: rootController.signal },
                ),
            ({ agent: updated }) => {
                if (draftRevisions.get(sessionId) !== revision) return;
                draftRevisions.delete(sessionId);
                intendedModes.delete(sessionId);
                adoptAgent(updated);
            },
            () => {
                if (draftRevisions.get(sessionId) !== revision) return;
                draftRevisions.delete(sessionId);
                if (previousMode === undefined) intendedModes.delete(sessionId);
                else intendedModes.set(sessionId, previousMode);
                if (entry !== undefined) publishSession(entry);
            },
            sessionId,
            `agent:${sessionId}`,
        );
    };

    background(runStream());

    return {
        compatibility: () => compatibility,
        connectGroups(subscription) {
            if (closed) throw new Error("This Happy Agent connection is closed.");
            const subscriber: GroupsSubscriber = { ...subscription, closed: false };
            groupSubscribers.add(subscriber);
            subscriber.onChange(groups, groupState());
            return {
                projects: () => groups,
                state: groupState,
                close: () => {
                    subscriber.closed = true;
                    groupSubscribers.delete(subscriber);
                },
            };
        },
        connectSession(subscription) {
            if (closed) throw new Error("This Happy Agent connection is closed.");
            let entry = sessions.get(subscription.sessionId);
            if (entry === undefined) {
                entry = {
                    id: subscription.sessionId,
                    store: new ChatStore(subscription.sessionId),
                    subscribers: new Set(),
                    messages: new Map(),
                    runs: new Map(),
                    hasMore: false,
                    loading: undefined,
                    loadingMore: false,
                    hydrating: false,
                    bufferedEvents: [],
                    activityRevision: 0,
                    questionRecovery: undefined,
                };
                const known = agentOf(subscription.sessionId);
                if (known !== undefined) {
                    entry.agent = known;
                    entry.workspace = workspaceOf(known.workspaceId);
                }
                sessions.set(subscription.sessionId, entry);
            }
            const subscriber: SessionSubscriber = { ...subscription, closed: false };
            entry.subscribers.add(subscriber);
            subscriber.onChange(entry.store.elements(), entry.store.session());
            void loadSession(entry);
            const connectedEntry = entry;
            return {
                elements: () => connectedEntry.store.elements(),
                session: () => connectedEntry.store.session(),
                loadMore: (token) => {
                    void loadEarlier(connectedEntry, token);
                },
                close: () => {
                    subscriber.closed = true;
                    connectedEntry.subscribers.delete(subscriber);
                    disposeSessionIfIdle(connectedEntry);
                },
            };
        },
        projects: {
            async add(path, addOptions = {}) {
                try {
                    const response = await client.registerProject(
                        {
                            path,
                            ...(addOptions.projectId === undefined
                                ? {}
                                : { projectId: addOptions.projectId }),
                        },
                        { signal: addOptions.signal ?? rootController.signal },
                    );
                    adoptProject(response.project, [
                        { type: "project_added", projectId: response.project.id },
                    ]);
                    return response.project;
                } catch (error) {
                    throw projectRegistrationError(error);
                }
            },
            archive(projectId) {
                const mutationId = nextId();
                const project = projects.find((candidate) => candidate.id === projectId);
                if (project === undefined) {
                    return mutation(
                        "archive_project",
                        mutationId,
                        () => Promise.reject(new Error("The project is not loaded.")),
                        undefined,
                        undefined,
                        undefined,
                        `project:${projectId}`,
                    );
                }
                return mutation(
                    "archive_project",
                    mutationId,
                    () =>
                        client.archiveProject(projectId, {
                            ifMatch:
                                projects.find((candidate) => candidate.id === projectId)?.version ??
                                project.version,
                            mutationId,
                            signal: rootController.signal,
                        }),
                    ({ project: updated }) => {
                        adoptProject(updated);
                    },
                    undefined,
                    undefined,
                    `project:${projectId}`,
                );
            },
            clone(input) {
                const projectId = input.projectId ?? nextId();
                return mutation(
                    "create_project",
                    projectId,
                    () =>
                        client.cloneProject(
                            {
                                name: input.name,
                                projectId,
                                ...(input.secret === undefined ? {} : { secret: input.secret }),
                                source: input.source,
                            },
                            { signal: rootController.signal },
                        ),
                    ({ project }) =>
                        adoptProject(project, [{ type: "project_added", projectId: project.id }]),
                );
            },
        },
        createWorkspace(input) {
            const workspaceId = nextId();
            const project = projects.find((candidate) => candidate.id === input.projectId);
            const parent = workspaceOf(input.projectId);
            const createdAt = now();
            if (project !== undefined && parent !== undefined) {
                const optimistic: Workspace = {
                    agents: [],
                    archivedAt: null,
                    base: {
                        commit: project.git?.head ?? "",
                        ref: input.baseRef ?? project.defaultBranch ?? "HEAD",
                    },
                    compute: parent.compute,
                    createdAt,
                    creatorAgentId: null,
                    git: project.git,
                    id: workspaceId,
                    initialization: { attempt: 0, error: null, status: "initializing" },
                    kind: project.worktreeSupport === "supported" ? "worktree" : "copy",
                    name: input.name,
                    nameSource: "user",
                    orderKey: workspaceId,
                    parentId: input.projectId,
                    projectId: input.projectId,
                    status: "active",
                    updatedAt: createdAt,
                    version: workspaceId,
                };
                workspaces = replaceResource(workspaces, optimistic);
                publishGroups([
                    {
                        type: "workspace_added",
                        projectId: optimistic.projectId,
                        workspaceId: optimistic.id,
                    },
                ]);
            }
            return mutation(
                "create_workspace",
                workspaceId,
                () =>
                    client.createWorkspace(
                        {
                            id: workspaceId,
                            mutationId: workspaceId,
                            name: input.name,
                            parentId: input.projectId,
                            ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
                        },
                        { signal: rootController.signal },
                    ),
                ({ workspace }) =>
                    adoptWorkspace(workspace, [
                        {
                            type: "workspace_added",
                            projectId: workspace.projectId,
                            workspaceId: workspace.id,
                        },
                    ]),
                () => {
                    workspaces = workspaces.filter(
                        (workspace) =>
                            workspace.id !== workspaceId || workspace.version !== workspaceId,
                    );
                    publishGroups();
                },
                undefined,
                `workspace:${workspaceId}`,
            );
        },
        archiveWorkspace(_projectId, workspaceId) {
            const mutationId = nextId();
            const workspace = workspaceOf(workspaceId);
            if (workspace === undefined) {
                return mutation(
                    "archive_workspace",
                    mutationId,
                    () => Promise.reject(new Error("The workspace is not loaded.")),
                    undefined,
                    undefined,
                    undefined,
                    `workspace:${workspaceId}`,
                );
            }
            return mutation(
                "archive_workspace",
                mutationId,
                () =>
                    client.archiveWorkspace(workspaceId, {
                        ifMatch: workspaceOf(workspaceId)?.version ?? workspace.version,
                        mutationId,
                        signal: rootController.signal,
                    }),
                ({ workspace: updated }) => adoptWorkspace(updated),
                undefined,
                undefined,
                `workspace:${workspaceId}`,
            );
        },
        createSession(input) {
            const sessionId = nextId();
            const workspaceId = resolveWorkspaceId(input, workspaces);
            if (workspaceId === undefined) {
                return mutation(
                    "create_session",
                    sessionId,
                    () => Promise.reject(new Error("No workspace matches this agent.")),
                    undefined,
                    undefined,
                    sessionId,
                    `agent:${sessionId}`,
                );
            }
            if (config !== undefined) intendedModes.set(sessionId, modeFromInput(input, config));
            const workspace = workspaceOf(workspaceId);
            const createdAt = now();
            if (workspace !== undefined) {
                const optimistic: Agent = {
                    id: sessionId,
                    workspaceId,
                    parentAgentId: null,
                    title: null,
                    titleStatus: "idle",
                    status: "idle",
                    subagents: { total: 0, running: 0 },
                    processes: { running: 0 },
                    pendingQuestionId: null,
                    lastMode: null,
                    unread: null,
                    draft: null,
                    orderKey: sessionId,
                    lastCursor: cursor ?? "",
                    version: sessionId,
                    createdAt,
                    updatedAt: createdAt,
                    archivedAt: null,
                };
                replaceAgent(optimistic);
                publishGroups([{ type: "session_added", sessionId }]);
            }
            return mutation(
                "create_session",
                sessionId,
                () =>
                    client.createAgent(
                        {
                            id: sessionId,
                            mutationId: sessionId,
                            workspaceId,
                        },
                        { signal: rootController.signal },
                    ),
                ({ agent }) => {
                    if (adoptAgent(agent)) {
                        publishGroups([{ type: "session_added", sessionId: agent.id }]);
                    }
                },
                () => {
                    intendedModes.delete(sessionId);
                    draftRevisions.delete(sessionId);
                    workspaces = workspaces.map((candidate) =>
                        candidate.id === workspaceId
                            ? {
                                  ...candidate,
                                  agents: candidate.agents.filter(
                                      (agent) =>
                                          agent.id !== sessionId || agent.version !== sessionId,
                                  ),
                              }
                            : candidate,
                    );
                    projects = projects.map((candidate) =>
                        candidate.id === workspaceId
                            ? {
                                  ...candidate,
                                  agents: candidate.agents.filter(
                                      (agent) =>
                                          agent.id !== sessionId || agent.version !== sessionId,
                                  ),
                              }
                            : candidate,
                    );
                    publishGroups([{ type: "session_removed", sessionId }]);
                },
                sessionId,
                `agent:${sessionId}`,
            );
        },
        markSessionRead(sessionId) {
            const mutationId = nextId();
            return mutation(
                "mark_session_read",
                mutationId,
                () =>
                    client.markAgentRead(
                        sessionId,
                        { mutationId },
                        { signal: rootController.signal },
                    ),
                ({ agent }) => adoptAgent(agent),
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        sendMessage(sessionId, message) {
            const mutationId = nextId();
            const agent = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
            if (agent === undefined || config === undefined) {
                reportMutationFailure(
                    "send_message",
                    mutationId,
                    new Error("The agent is not loaded."),
                );
                return mutationId;
            }
            const input = typeof message === "string" ? { text: message } : message;
            const mode = modeOf(agent, config, intendedModes.get(sessionId));
            const content = input.content?.map((block) =>
                block.type === "image"
                    ? {
                          type: "image" as const,
                          mimeType: block.mediaType,
                          data: block.data,
                      }
                    : block,
            ) ?? [{ type: "text" as const, text: input.text }];
            const richContent = content.filter((block) => block.type !== "text");
            const delivery = agent.status === "idle" ? "queue" : "steer";
            const entry = sessions.get(sessionId);
            if (entry !== undefined) {
                entry.messages.set(mutationId, {
                    message: {
                        id: mutationId,
                        role: "user",
                        createdAt: now(),
                        content,
                        status: "pending",
                        delivery,
                        mode,
                        runId: null,
                    },
                    runId: null,
                });
                publishSession(entry);
            }
            return mutation(
                "send_message",
                mutationId,
                () =>
                    client.sendMessage(
                        sessionId,
                        {
                            text: input.text,
                            ...(richContent.length === 0 ? {} : { content: richContent }),
                            delivery,
                            mode,
                            mutationId,
                        },
                        { signal: rootController.signal },
                    ),
                ({ message: sent }) => {
                    updateMessage(sessionId, sent, sent.runId, mutationId);
                    const intended = intendedModes.get(sessionId);
                    if (intended !== undefined && modesEqual(intended, sent.mode)) {
                        intendedModes.delete(sessionId);
                        const current = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
                        if (current !== undefined) {
                            replaceAgent({ ...current, lastMode: sent.mode });
                        }
                    }
                },
                () => {
                    const current = sessions.get(sessionId);
                    current?.messages.delete(mutationId);
                    if (current !== undefined) publishSession(current);
                },
                sessionId,
                `agent:${sessionId}`,
            );
        },
        stopBackgroundProcess(sessionId, projectedProcessId) {
            const mutationId = nextId();
            const entry = sessions.get(sessionId);
            const matches =
                entry?.activity?.processes.filter(
                    (process) =>
                        process.status === "running" &&
                        projectNumericIdentity(process.id) === projectedProcessId,
                ) ?? [];
            const process = matches.length === 1 ? matches[0] : undefined;
            if (process === undefined) {
                reportMutationFailure(
                    "stop_background_process",
                    mutationId,
                    new Error(
                        matches.length === 0
                            ? "The background process is not loaded or is no longer running."
                            : "The background process identity is ambiguous.",
                    ),
                    sessionId,
                );
                return mutationId;
            }
            return mutation(
                "stop_background_process",
                mutationId,
                () =>
                    client.stopProcess(sessionId, process.id, {
                        signal: rootController.signal,
                    }),
                ({ process: stopped }) => {
                    const current = sessions.get(sessionId);
                    if (current?.activity === undefined) return;
                    const existing = current.activity.processes.find(
                        (candidate) => candidate.id === stopped.id,
                    );
                    if (!shouldAdoptVersion(existing, stopped)) return;
                    current.activity = {
                        ...current.activity,
                        processes: [...replaceResource(current.activity.processes, stopped)],
                    };
                    processOwners.delete(stopped.id);
                    publishSession(current);
                },
                undefined,
                sessionId,
                `process:${process.id}`,
            );
        },
        stopRun(sessionId) {
            const mutationId = nextId();
            return mutation(
                "stop_run",
                mutationId,
                () =>
                    client.abortAgent(sessionId, { mutationId }, { signal: rootController.signal }),
                ({ agent }) => adoptAgent(agent),
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        compactSession(sessionId) {
            const mutationId = nextId();
            return mutation(
                "compact_session",
                mutationId,
                () =>
                    client.compactAgent(
                        sessionId,
                        { mutationId },
                        { signal: rootController.signal },
                    ),
                ({ agent }) => adoptAgent(agent),
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        setDraft(sessionId, update) {
            const mutationId = nextId();
            const agent = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
            if (agent === undefined || config === undefined) {
                reportMutationFailure(
                    "set_draft",
                    mutationId,
                    new Error("The agent is not loaded."),
                );
                return mutationId;
            }
            const value: DraftUpdate = typeof update === "string" ? { draft: update } : update;
            const mode = modeOf(agent, config, intendedModes.get(sessionId));
            const priorAgent = agent;
            const updatedAt = value.updatedAt ?? now();
            const revision = (draftRevisions.get(sessionId) ?? 0) + 1;
            draftRevisions.set(sessionId, revision);
            replaceAgent({
                ...agent,
                draft: value.draft === null ? null : { ...mode, text: value.draft },
                updatedAt,
            });
            return mutation(
                "set_draft",
                mutationId,
                () =>
                    client.saveAgentDraft(
                        sessionId,
                        {
                            draft: value.draft === null ? null : { ...mode, text: value.draft },
                            mutationId,
                            updatedAt,
                        },
                        { signal: rootController.signal },
                    ),
                ({ agent: updated }) => {
                    if (draftRevisions.get(sessionId) !== revision) return;
                    draftRevisions.delete(sessionId);
                    const current = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
                    if (
                        current === undefined ||
                        current.version === priorAgent.version ||
                        current.version.localeCompare(updated.version) <= 0
                    ) {
                        adoptAgent(updated);
                    }
                },
                () => {
                    if (draftRevisions.get(sessionId) !== revision) return;
                    draftRevisions.delete(sessionId);
                    const current = sessions.get(sessionId)?.agent ?? agentOf(sessionId);
                    if (current?.version === priorAgent.version) {
                        replaceAgent({ ...current, draft: priorAgent.draft });
                    }
                },
                sessionId,
                `agent:${sessionId}`,
            );
        },
        switchModel(sessionId, selection) {
            const value = typeof selection === "string" ? { modelId: selection } : selection;
            return saveMode(sessionId, "switch_model", (mode) => ({
                ...mode,
                modelId: value.modelId,
                ...(value.providerId === undefined ? {} : { providerId: value.providerId }),
            }));
        },
        setEffort(sessionId, effort) {
            return saveMode(sessionId, "set_effort", (mode) => ({
                ...mode,
                effort: effort ?? mode.effort,
            }));
        },
        setServiceTier(sessionId, serviceTier) {
            return saveMode(sessionId, "set_service_tier", (mode) => ({
                ...mode,
                serviceTier: serviceTier ?? null,
            }));
        },
        setPermissionMode(sessionId, permissionMode) {
            return saveMode(sessionId, "set_permission_mode", (mode) => ({
                ...mode,
                permissionMode: permissionMode as MessageMode["permissionMode"],
            }));
        },
        answerUserInput(sessionId, requestId, response) {
            const mutationId = nextId();
            return mutation(
                "answer_user_input",
                mutationId,
                () =>
                    client.answerQuestion(
                        sessionId,
                        requestId,
                        {
                            answers: Object.fromEntries(
                                Object.entries(response.answers).map(([key, values]) => [
                                    key,
                                    [...values],
                                ]),
                            ),
                            mutationId,
                        },
                        { signal: rootController.signal },
                    ),
                ({ question }) => updateQuestion(sessionId, question),
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        setSessionArchived(sessionId, archived) {
            const mutationId = nextId();
            const request = () =>
                archived
                    ? client.archiveAgent(
                          sessionId,
                          { mutationId },
                          { signal: rootController.signal },
                      )
                    : client.unarchiveAgent(
                          sessionId,
                          { mutationId },
                          { signal: rootController.signal },
                      );
            return mutation(
                "set_session_archived",
                mutationId,
                request,
                ({ agent }) => {
                    adoptAgent(agent);
                    if (archived) {
                        intendedModes.delete(sessionId);
                        draftRevisions.delete(sessionId);
                    }
                    publishGroups([
                        archived
                            ? { type: "session_removed", sessionId }
                            : { type: "session_added", sessionId },
                    ]);
                },
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        renameGroup(target, name) {
            return renameGroup(target, name);
        },
        reorderProject(projectId, afterId) {
            const mutationId = nextId();
            const project = projects.find((candidate) => candidate.id === projectId);
            if (project === undefined) {
                return mutation(
                    "reorder_group",
                    mutationId,
                    () => Promise.reject(new Error("The project is not loaded.")),
                    undefined,
                    undefined,
                    undefined,
                    `project:${projectId}`,
                );
            }
            return mutation(
                "reorder_group",
                mutationId,
                () =>
                    client.reorderProject(
                        projectId,
                        { afterId, mutationId },
                        {
                            ifMatch:
                                projects.find((candidate) => candidate.id === projectId)?.version ??
                                project.version,
                            signal: rootController.signal,
                        },
                    ),
                ({ project: updated }) => adoptProject(updated),
                undefined,
                undefined,
                `project:${projectId}`,
            );
        },
        reorderWorkspace(workspaceId, afterId) {
            const mutationId = nextId();
            const workspace = workspaceOf(workspaceId);
            if (workspace === undefined) {
                return mutation(
                    "reorder_group",
                    mutationId,
                    () => Promise.reject(new Error("The workspace is not loaded.")),
                    undefined,
                    undefined,
                    undefined,
                    `workspace:${workspaceId}`,
                );
            }
            return mutation(
                "reorder_group",
                mutationId,
                () =>
                    client.reorderWorkspace(
                        workspaceId,
                        { afterId, mutationId },
                        {
                            ifMatch: workspaceOf(workspaceId)?.version ?? workspace.version,
                            signal: rootController.signal,
                        },
                    ),
                ({ workspace: updated }) => adoptWorkspace(updated),
                undefined,
                undefined,
                `workspace:${workspaceId}`,
            );
        },
        reorderSession(sessionId, afterId) {
            const mutationId = nextId();
            return mutation(
                "reorder_session",
                mutationId,
                () =>
                    client.reorderAgent(
                        sessionId,
                        { afterId, mutationId },
                        { signal: rootController.signal },
                    ),
                ({ agent }) => adoptAgent(agent),
                undefined,
                sessionId,
                `agent:${sessionId}`,
            );
        },
        close() {
            if (closed) return;
            closed = true;
            rootController.abort();
            publishConnection("closed");
            groupSubscribers.clear();
            for (const entry of sessions.values()) entry.subscribers.clear();
            sessions.clear();
            intendedModes.clear();
            draftRevisions.clear();
            mutationQueues.clear();
            sessionMutationCounts.clear();
            processOwners.clear();
            hydrationBroadcastEvents.length = 0;
            resyncBufferedEvents.length = 0;
        },
    };

    async function loadEarlier(entry: SessionEntry, token: string): Promise<void> {
        if (entry.loadingMore || !entry.hasMore) return;
        const oldest = [...entry.runs.values()].sort(runCompare)[0];
        if (oldest === undefined || oldest.id !== token) return;
        entry.loadingMore = true;
        entry.loadMoreError = undefined;
        publishSession(entry);
        try {
            const page = await client.getMessages(
                entry.id,
                { before: token, limit: DEFAULT_HISTORY_LIMIT, omitToolData: false },
                { signal: rootController.signal },
            );
            ingestHistory(entry, page.runs, page.pending);
            entry.hasMore = page.hasMore;
        } catch (error) {
            entry.loadMoreError = error instanceof Error ? error.message : String(error);
        } finally {
            entry.loadingMore = false;
            publishSession(entry);
        }
    }

    function renameGroup(target: GroupTarget, name: string): string {
        const mutationId = nextId();
        if (target.kind === "project") {
            const project = projects.find((candidate) => candidate.id === target.projectId);
            if (project === undefined) {
                return mutation(
                    "rename_group",
                    mutationId,
                    () => Promise.reject(new Error("The project is not loaded.")),
                    undefined,
                    undefined,
                    undefined,
                    `project:${target.projectId}`,
                );
            }
            return mutation(
                "rename_group",
                mutationId,
                () =>
                    client.renameProject(
                        project.id,
                        { name, mutationId },
                        {
                            ifMatch:
                                projects.find((candidate) => candidate.id === project.id)
                                    ?.version ?? project.version,
                            signal: rootController.signal,
                        },
                    ),
                ({ project: updated }) => adoptProject(updated),
                undefined,
                undefined,
                `project:${project.id}`,
            );
        }
        const workspace = workspaceOf(target.workspaceId);
        if (workspace === undefined) {
            return mutation(
                "rename_group",
                mutationId,
                () => Promise.reject(new Error("The workspace is not loaded.")),
                undefined,
                undefined,
                undefined,
                `workspace:${target.workspaceId}`,
            );
        }
        return mutation(
            "rename_group",
            mutationId,
            () =>
                client.renameWorkspace(
                    workspace.id,
                    { name, mutationId },
                    {
                        ifMatch: workspaceOf(workspace.id)?.version ?? workspace.version,
                        signal: rootController.signal,
                    },
                ),
            ({ workspace: updated }) => adoptWorkspace(updated),
            undefined,
            undefined,
            `workspace:${workspace.id}`,
        );
    }
}

/** Mechanical migration name for the former package entry point. */

function ingestHistory(
    entry: SessionEntry,
    runs: readonly (Run & { messages: Message[] })[],
    pending: readonly Message[],
): void {
    for (const run of runs) {
        entry.runs.set(run.id, run);
        for (const message of run.messages)
            entry.messages.set(message.id, { message, runId: run.id });
    }
    for (const message of pending) entry.messages.set(message.id, { message, runId: null });
}

function resolveWorkspaceId(
    input: CreateSessionInput,
    workspaces: readonly Workspace[],
): string | undefined {
    if (input.workspaceId !== undefined) return input.workspaceId;
    if (input.projectId !== undefined) return input.projectId;
    return workspaces.find(
        (workspace) => workspace.compute.type === "host" && workspace.compute.path === input.cwd,
    )?.id;
}

function modeFromInput(input: CreateSessionInput, config: DaemonConfig): MessageMode {
    const defaults = defaultMode(config);
    return {
        effort: input.effort ?? defaults.effort,
        modelId: input.modelId ?? defaults.modelId,
        permissionMode:
            (input.permissionMode as MessageMode["permissionMode"] | undefined) ??
            defaults.permissionMode,
        providerId: input.providerId ?? defaults.providerId,
        serviceTier: input.serviceTier ?? defaults.serviceTier,
    };
}

function modesEqual(left: MessageMode, right: MessageMode): boolean {
    return (
        left.effort === right.effort &&
        left.modelId === right.modelId &&
        left.permissionMode === right.permissionMode &&
        left.providerId === right.providerId &&
        left.serviceTier === right.serviceTier
    );
}

function runCompare(left: Run, right: Run): number {
    return left.startedAt - right.startedAt || left.id.localeCompare(right.id);
}

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
    try {
        return await read();
    } catch {
        return undefined;
    }
}

function agentIdOfEvent(event: HappyAgentEvent): string | undefined {
    switch (event.type) {
        case "agent.created":
            return event.payload.agent.id;
        case "agent.updated":
        case "run.started":
        case "run.boundary":
        case "run.finished":
        case "message.created":
        case "message.updated":
        case "message.delta":
        case "message.deleted":
            return event.payload.agentId;
        case "question.created":
            return event.payload.question.agentId;
        case "process.started":
            return event.payload.process.agentId;
        default:
            return undefined;
    }
}

function createCuid2(now: () => number): () => string {
    const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let counter = 0;
    return () => {
        const random = globalThis.crypto.getRandomValues(new Uint8Array(13));
        counter = (counter + 1) % 46_656;
        const time = Math.max(0, Math.floor(now())).toString(36).slice(-8).padStart(8, "0");
        const count = counter.toString(36).padStart(3, "0");
        let tail = "";
        for (let index = 1; index < random.length; index += 1)
            tail += digits[(random[index] ?? 0) % digits.length];
        return `${letters[(random[0] ?? 0) % letters.length] ?? "a"}${time}${count}${tail}`;
    };
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener("abort", aborted, { once: true });
        function done(): void {
            signal.removeEventListener("abort", aborted);
            resolve();
        }
        function aborted(): void {
            clearTimeout(timer);
            reject(signal.reason);
        }
    });
}
