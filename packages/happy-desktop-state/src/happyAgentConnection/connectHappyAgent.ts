import {
    applyMessageDelta,
    HappyAgentClient,
    HappyAgentApiError,
    type Agent,
    type AgentActivityResponse,
    type AgentContextUsage,
    type AgentDraftSnapshot,
    type BackgroundProcess,
    type DaemonConfig,
    type GitState,
    type HappyAgentEvent,
    type Message,
    type MessageBlock,
    type MessageMode,
    type Project,
    type Question,
    type Run,
    type SendMessageRequest,
    type SendMessageResponse,
    type UsageBreakdown,
    type Workspace,
} from "@slopus/happy-agent-client";
import { createStore } from "zustand/vanilla";
import { ChatStore } from "./ChatStore.js";
import { CHECKING_SERVER_COMPATIBILITY, serverCompatibility } from "./compatibility.js";
import { projectRegistrationError } from "./errors.js";
import type { RigDebugLogInput } from "../rig/rigDebugLogStore.js";
import {
    applyChanges,
    defaultMode,
    elementsReuse,
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
const GIT_WATCH_RENEW_MS = 2 * 60 * 1000;
const RECENT_EVENT_RETENTION_MS = 60_000;
const SNAPSHOT_RESPONSE_TIMEOUT_MS = 60_000;
/*
 * Deadline for mutations the daemon answers without doing model work. A
 * create, send, or abort whose response never arrives would otherwise pend
 * forever: the optimistic user message stays beside the copy the event stream
 * delivers, and the per-agent mutation lane stays wedged behind the hung
 * request. Long operations such as compaction are exempt.
 */
const MUTATION_RESPONSE_TIMEOUT_MS = 60_000;
const SEND_ATTEMPTS = 3;
const INITIAL_SEND_RETRY_MS = 250;

function debugDetail(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

function errorDetail(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : debugDetail(error);
}

interface SessionSubscriber extends RigSessionSubscriptionOptions {
    closed: boolean;
}

interface SessionEntry {
    id: string;
    store: ChatStore;
    subscribers: Set<SessionSubscriber>;
    messages: Map<string, TranscriptMessage>;
    /** Cumulative block offset of the provider segment currently streaming per agent message. */
    messageBlockOffsets: Map<string, number>;
    runs: Map<string, Run>;
    /** `runs` in transcript order, rebuilt only when a run is added or replaced. */
    runsOrdered?: readonly Run[];
    hasMore: boolean;
    loading: Promise<void> | undefined;
    loadRequestedRevision: number;
    loadCompletedRevision: number;
    historyLoaded: boolean;
    loadRetry: Promise<void> | undefined;
    loadRetryMs: number;
    loadingMore: boolean;
    loadMoreError?: string;
    hydrating: boolean;
    bufferedEvents: HappyAgentEvent[];
    activityLoading: Promise<void> | undefined;
    activityRevision: number;
    /** A journal gap made this cached session incomplete; reconcile when it is next observed. */
    reconcileRequired: boolean;
    /** Deltas ignored until a complete message snapshot repairs their message. */
    corruptedMessageIds: Set<string>;
    questionRecovery: Promise<void> | undefined;
    agent?: Agent;
    workspace?: Workspace;
    activity?: AgentActivityResponse;
    question?: Question | null;
    usage?: UsageBreakdown;
    context?: AgentContextUsage | null;
    draft?: AgentDraftSnapshot;
    mode?: MessageMode | null;
}

interface GroupsSubscriber extends RigGroupsSubscriptionOptions {
    closed: boolean;
}

interface RecentEvent {
    event: HappyAgentEvent;
    receivedAt: number;
}

export function connectHappyAgent(options: ConnectHappyAgentOptions): RigConnection {
    const client = options.client ?? new HappyAgentClient(options);
    const endpoint = options.endpoint.toString();
    const rootController = new AbortController();
    const wait = options.wait ?? abortableWait;
    const now = options.now ?? Date.now;
    const reportDebug = (entry: RigDebugLogInput): void => options.onDebugEntry?.(entry);
    const nextId = createCuid2(now);
    const sessions = new Map<string, SessionEntry>();
    const groupSubscribers = new Set<GroupsSubscriber>();
    const intendedModes = new Map<string, MessageMode>();
    const agentDrafts = new Map<string, AgentDraftSnapshot>();
    const agentModes = new Map<string, MessageMode | null>();
    const draftRevisions = new Map<string, number>();
    /**
     * Agents named here and not yet created on the daemon. Opening one is an
     * ordinary thing to do — a workspace hands the reader its first session
     * before its checkout exists — and the daemon has nothing to answer about
     * it, so the transcript is served from what is already known here until the
     * creation lands.
     */
    const unannouncedAgents = new Set<string>();
    const sendConfirmations = new Map<string, () => void>();
    const mutationQueues = new Map<string, Promise<void>>();
    const sessionMutationCounts = new Map<string, number>();
    const gitStates = new Map<string, GitState>();
    const processOwners = new Map<string, string>();
    let config: DaemonConfig | undefined;
    let cursor: string | undefined;
    let resyncTask: Promise<void> | undefined;
    const resyncBufferedEvents: HappyAgentEvent[] = [];
    const hydrationBroadcastEvents: HappyAgentEvent[] = [];
    const recentEvents: RecentEvent[] = [];
    let compatibility: ServerCompatibility = CHECKING_SERVER_COMPATIBILITY;
    let closed = false;
    let updatesAttemptController: AbortController | undefined;
    let retryRequested = false;
    let retryWake: (() => void) | undefined;

    /** The group/catalog pipeline state this connection reconciles and publishes. */
    interface GroupsStoreState {
        readonly projects: readonly Project[];
        readonly workspaces: readonly Workspace[];
        readonly connection: GroupsState["connection"];
        /** The published group projection, rebuilt by `publishGroups`. */
        readonly groups: ReturnType<typeof projectGroups>;
    }

    const groupsStore = createStore<GroupsStoreState>()(() => ({
        connection: "connecting",
        groups: [],
        projects: [],
        workspaces: [],
    }));

    reportDebug({
        detail: debugDetail({ endpoint }),
        level: "info",
        message: "Happy Agent connection created",
        source: "connection",
    });

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
        reportDebug({
            detail: debugDetail({
                action,
                error: errorDetail(error),
                mutationId,
                ...(sessionId === undefined ? {} : { sessionId }),
            }),
            level: "error",
            message: `Mutation failed: ${action}`,
            source: "mutation",
        });
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
        reportDebug({
            detail: errorDetail(error),
            level: "error",
            message: "Background state task failed",
            source: "sync",
        });
        for (const subscriber of groupSubscribers) subscriber.onError?.(error);
        for (const entry of sessions.values()) {
            for (const subscriber of entry.subscribers) subscriber.onError?.(error);
        }
    };

    const background = (task: Promise<unknown>): void => {
        void task.catch(reportBackgroundError);
    };

    /** Created at each request so queued work receives its full response window. */
    const deadlineSignal = (timeoutMs = MUTATION_RESPONSE_TIMEOUT_MS): AbortSignal =>
        AbortSignal.any([rootController.signal, AbortSignal.timeout(timeoutMs)]);

    const groupState = (): GroupsState => ({
        connection: groupsStore.getState().connection,
        sessionsComplete: config !== undefined,
    });

    const publishGroups = (deltas: readonly GroupDelta[] = []): void => {
        if (config !== undefined) {
            const daemonConfig = config;
            groupsStore.setState((current) => ({
                groups: projectGroups(
                    current.projects,
                    current.workspaces,
                    endpoint,
                    daemonConfig,
                    gitStates,
                    agentDrafts,
                    agentModes,
                ),
            }));
        }
        const state = groupState();
        const { groups } = groupsStore.getState();
        for (const subscriber of groupSubscribers) {
            if (subscriber.closed) continue;
            subscriber.onChange(groups, state);
            for (const delta of deltas) subscriber.onDelta?.(delta);
        }
    };

    /**
     * The session's runs in transcript order. Ordering them is the one part of
     * building a projection input that is not a pointer copy, and a run only
     * changes when a turn starts or ends — never on the stream of updates inside
     * one — so the order is kept until something actually replaces a run.
     */
    const runsOrderedOf = (entry: SessionEntry): readonly Run[] => {
        const cached = entry.runsOrdered;
        if (cached !== undefined) return cached;
        const ordered = [...entry.runs.values()].sort(runCompare);
        entry.runsOrdered = ordered;
        return ordered;
    };

    const projectionOf = (entry: SessionEntry): SessionProjectionInput | undefined => {
        if (entry.agent === undefined || config === undefined) return undefined;
        return {
            agent: entry.agent,
            config,
            connection: groupsStore.getState().connection,
            endpoint,
            hasMore: entry.hasMore,
            messages: [...entry.messages.values()],
            intendedMode: intendedModes.get(entry.id),
            ...(entry.mode === undefined ? {} : { mode: entry.mode }),
            ...(entry.draft === undefined ? {} : { draft: entry.draft }),
            ...(entry.context === undefined ? {} : { context: entry.context }),
            ...(entry.activity === undefined ? {} : { activity: entry.activity }),
            ...(entry.question === undefined ? {} : { question: entry.question }),
            runs: runsOrderedOf(entry),
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
        // An event that changed nothing in the transcript still rebuilds this
        // array, out of the same row objects. Handing back the previous array
        // lets every reader downstream settle it with one comparison.
        const elements = elementsReuse(entry.store.elements(), projectElements(projection));
        const deltas = entry.store.replace(elements, session);
        for (const subscriber of entry.subscribers) {
            if (subscriber.closed) continue;
            subscriber.onChange(elements, session);
            for (const delta of deltas) subscriber.onDelta?.(delta);
        }
    };

    const publishConnection = (next: GroupsState["connection"]): void => {
        const previous = groupsStore.getState().connection;
        if (previous === next) return;
        groupsStore.setState({ connection: next });
        reportDebug({
            detail: debugDetail({ previous, next }),
            level: next === "reconnecting" ? "warning" : "info",
            message: `Connection state changed: ${previous} → ${next}`,
            source: "connection",
        });
        publishGroups([{ type: "groups_state_changed", state: groupState() }]);
        for (const entry of sessions.values()) publishSession(entry);
    };

    const workspaceOf = (workspaceId: string): Workspace | undefined =>
        groupsStore.getState().workspaces.find((candidate) => candidate.id === workspaceId);

    const agentOf = (agentId: string): Agent | undefined => {
        const { projects, workspaces } = groupsStore.getState();
        for (const workspace of workspaces) {
            const agent = workspace.agents.find((candidate) => candidate.id === agentId);
            if (agent !== undefined) return agent;
        }
        for (const project of projects) {
            const agent = project.agents.find((candidate) => candidate.id === agentId);
            if (agent !== undefined) return agent;
        }
        const materialized = sessions.get(agentId)?.agent;
        if (materialized !== undefined) return materialized;
        for (const entry of sessions.values()) {
            const agent = entry.activity?.subagents.find((candidate) => candidate.id === agentId);
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
        groupsStore.setState((current) => ({
            workspaces: current.workspaces.map((workspace) =>
                workspace.id === agent.workspaceId ||
                workspace.agents.some((candidate) => candidate.id === agent.id)
                    ? { ...workspace, agents: replaceResource(workspace.agents, agent) as Agent[] }
                    : workspace,
            ),
            projects: current.projects.map((project) =>
                project.id === agent.workspaceId ||
                project.agents.some((candidate) => candidate.id === agent.id)
                    ? { ...project, agents: replaceResource(project.agents, agent) as Agent[] }
                    : project,
            ),
        }));
        const entry = sessions.get(agent.id);
        if (entry !== undefined) {
            entry.agent = agent;
            entry.workspace = workspaceOf(agent.workspaceId);
            publishSession(entry);
        }
        // Activity is a one-time snapshot followed by the same versioned agent
        // events as the catalog. Keep parent views current from that stream
        // instead of re-reading the entire activity endpoint after child work.
        for (const parent of sessions.values()) {
            const activity = parent.activity;
            if (activity === undefined) continue;
            const known = activity.subagents.some((candidate) => candidate.id === agent.id);
            if (!known && agent.parentAgentId !== parent.id) continue;
            setActivity(parent, {
                ...activity,
                subagents: [...replaceResource(activity.subagents, agent)],
            });
            publishSession(parent);
        }
        publishGroups();
    };

    const adoptAgent = (agent: Agent): boolean => {
        if (!shouldAdoptVersion(agentOf(agent.id), agent)) return false;
        replaceAgent(agent);
        return true;
    };

    const replaceDraft = (agentId: string, draft: AgentDraftSnapshot): void => {
        agentDrafts.set(agentId, draft);
        const entry = sessions.get(agentId);
        if (entry !== undefined) {
            entry.draft = draft;
            publishSession(entry);
        }
        publishGroups();
    };

    const adoptDraft = (agentId: string, draft: AgentDraftSnapshot): boolean => {
        const current = agentDrafts.get(agentId);
        if (
            current?.updatedAt !== null &&
            current?.updatedAt !== undefined &&
            (draft.updatedAt === null || draft.updatedAt < current.updatedAt)
        ) {
            return false;
        }
        replaceDraft(agentId, draft);
        return true;
    };

    const adoptProject = (project: Project, deltas: readonly GroupDelta[] = []): boolean => {
        const current = groupsStore
            .getState()
            .projects.find((candidate) => candidate.id === project.id);
        if (!shouldAdoptVersion(current, project)) return false;
        groupsStore.setState((state) => ({ projects: replaceResource(state.projects, project) }));
        publishGroups(deltas);
        return true;
    };

    const adoptWorkspace = (workspace: Workspace, deltas: readonly GroupDelta[] = []): boolean => {
        if (!shouldAdoptVersion(workspaceOf(workspace.id), workspace)) return false;
        groupsStore.setState((state) => ({
            workspaces: replaceResource(state.workspaces, workspace),
        }));
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
        entry.activityRevision += 1;
    };

    /**
     * Releases transient mutation bookkeeping while retaining the hydrated
     * session itself. One Rig-wide managed update feed keeps that cached entry
     * current, so closing and reopening a view never needs another bootstrap
     * read.
     */
    const settleSessionIfIdle = (entry: SessionEntry): void => {
        if (
            entry.subscribers.size > 0 ||
            entry.loading !== undefined ||
            entry.questionRecovery !== undefined ||
            (sessionMutationCounts.get(entry.id) ?? 0) > 0
        ) {
            return;
        }
        if (sessions.get(entry.id) !== entry) return;
        draftRevisions.delete(entry.id);
        const intended = intendedModes.get(entry.id);
        const agent = agentOf(entry.id);
        if (
            intended !== undefined &&
            agent !== undefined &&
            config !== undefined &&
            modesEqual(
                modeOf(config, agentDrafts.get(entry.id), agentModes.get(entry.id)),
                intended,
            )
        ) {
            intendedModes.delete(entry.id);
        }
    };

    const drainHydrationBroadcastEvents = (): void => {
        if ([...sessions.values()].some((entry) => entry.hydrating)) return;
        const buffered = hydrationBroadcastEvents.splice(0);
        for (const event of buffered) applyEvent(event);
    };

    const rememberEvent = (event: HappyAgentEvent): void => {
        const receivedAt = now();
        recentEvents.push({ event, receivedAt });
        const cutoff = receivedAt - RECENT_EVENT_RETENTION_MS;
        let expired = 0;
        while (recentEvents[expired]?.receivedAt < cutoff) expired += 1;
        if (expired > 0) recentEvents.splice(0, expired);
    };

    const eventsForSessionAfter = (
        entry: SessionEntry,
        after: string,
        buffered: readonly HappyAgentEvent[],
    ): HappyAgentEvent[] => {
        const events = new Map<string, HappyAgentEvent>();
        if (resyncTask === undefined) {
            for (const candidate of recentEvents) {
                const event = candidate.event;
                if (event.cursor.localeCompare(after) > 0 && agentIdOfEvent(event) === entry.id) {
                    events.set(event.cursor, event);
                }
            }
        }
        // A connection-wide resync owns its journal replay after all session
        // snapshots land. Replaying the rolling window here as well would apply
        // the same non-idempotent message delta twice.
        // A hydration can outlive the rolling window. Its direct buffer keeps
        // every event needed by that in-flight read until the snapshot lands.
        for (const event of buffered) {
            if (event.cursor.localeCompare(after) > 0) events.set(event.cursor, event);
        }
        return [...events.values()].sort((left, right) => left.cursor.localeCompare(right.cursor));
    };

    const scheduleSessionLoadRetry = (entry: SessionEntry, error: unknown): void => {
        if (
            closed ||
            rootController.signal.aborted ||
            entry.loadCompletedRevision >= entry.loadRequestedRevision ||
            entry.subscribers.size === 0 ||
            entry.loadRetry !== undefined
        ) {
            return;
        }
        const delayMs = entry.loadRetryMs;
        entry.loadRetryMs = Math.min(delayMs * 2, MAXIMUM_RECONNECT_MS);
        reportDebug({
            detail: debugDetail({
                delayMs,
                error: errorDetail(error),
                sessionId: entry.id,
            }),
            level: "warning",
            message: "Session history load failed; retrying",
            source: "sync",
        });
        const retry: Promise<void> = wait(delayMs, rootController.signal)
            .then(() => {
                if (entry.loadRetry === retry) entry.loadRetry = undefined;
                if (
                    closed ||
                    rootController.signal.aborted ||
                    entry.loadCompletedRevision >= entry.loadRequestedRevision ||
                    entry.subscribers.size === 0 ||
                    sessions.get(entry.id) !== entry
                ) {
                    return;
                }
                void loadSession(entry);
            })
            .catch(() => undefined);
        entry.loadRetry = retry;
    };

    const loadSession = (entry: SessionEntry): Promise<void> => {
        if (entry.loading !== undefined) return entry.loading;
        // An agent this connection has named but not yet created has no history
        // anywhere to read, and asking the daemon for one would answer "no such
        // agent" and put a retrying error in front of a session the reader is
        // already writing into. It opens empty, which is exactly what it is; the
        // creation asks for the real thing the moment it lands.
        if (unannouncedAgents.has(entry.id)) {
            entry.hydrating = false;
            entry.historyLoaded = true;
            entry.reconcileRequired = false;
            entry.loadCompletedRevision = entry.loadRequestedRevision;
            publishSession(entry);
            return Promise.resolve();
        }
        entry.hydrating = true;
        const revision = entry.loadRequestedRevision;
        const signal = deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS);
        const loading = Promise.all([
            client.getMessages(
                entry.id,
                { limit: DEFAULT_HISTORY_LIMIT, omitToolData: false },
                { signal },
            ),
            client.getAgentBootstrap(entry.id, { signal }),
            optional(() => client.getAgentActivity(entry.id, { signal })),
            optional(() => client.getPendingQuestion(entry.id, { signal })),
        ])
            .then(([history, bootstrap, activity, question]) => {
                if (closed) return;
                entry.agent = bootstrap.agent;
                entry.workspace = workspaceOf(bootstrap.agent.workspaceId);
                entry.context = bootstrap.context;
                entry.draft = bootstrap.draft;
                entry.mode = bootstrap.mode;
                entry.usage = bootstrap.usage;
                agentDrafts.set(entry.id, bootstrap.draft);
                agentModes.set(entry.id, bootstrap.mode);
                const pendingSends = [...entry.messages.values()].filter(
                    (message) => message.pendingSend,
                );
                entry.messages.clear();
                entry.messageBlockOffsets.clear();
                entry.runs.clear();
                entry.runsOrdered = undefined;
                entry.corruptedMessageIds.clear();
                ingestHistory(entry, history.runs, bootstrap.pending);
                for (const message of pendingSends) {
                    if (entry.messages.has(message.message.id)) {
                        sendConfirmations.get(message.message.id)?.();
                    } else {
                        entry.messages.set(message.message.id, message);
                    }
                }
                entry.hasMore = history.hasMore;
                if (activity !== undefined) setActivity(entry, activity);
                if (question !== undefined) entry.question = question.question;
                entry.historyLoaded = true;
                entry.reconcileRequired = false;
                entry.loadCompletedRevision = Math.max(entry.loadCompletedRevision, revision);
                entry.loadRetryMs = INITIAL_RECONNECT_MS;
                entry.hydrating = false;
                // History and bootstrap are independent snapshots. Rebase from
                // the earlier boundary so neither accepted history nor pending
                // work can fall between its read and the global stream.
                const snapshotCursor =
                    history.cursor.localeCompare(bootstrap.cursor) <= 0
                        ? history.cursor
                        : bootstrap.cursor;
                const buffered = eventsForSessionAfter(
                    entry,
                    snapshotCursor,
                    entry.bufferedEvents.splice(0),
                );
                replaceAgent(bootstrap.agent);
                publishSession(entry);
                for (const event of buffered) applyEventNow(event);
                drainHydrationBroadcastEvents();
                if (
                    question === undefined &&
                    bootstrap.agent.pendingQuestionId !== null &&
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
                scheduleSessionLoadRetry(entry, error);
            })
            .finally(() => {
                if (entry.loading === loading) {
                    entry.loading = undefined;
                    if (
                        entry.loadRequestedRevision > revision &&
                        !closed &&
                        !rootController.signal.aborted &&
                        sessions.get(entry.id) === entry
                    ) {
                        background(loadSession(entry));
                    }
                }
                settleSessionIfIdle(entry);
            });
        entry.loading = loading;
        return loading;
    };

    const requestSessionLoad = (entry: SessionEntry): Promise<void> => {
        entry.loadRequestedRevision += 1;
        return loadSession(entry);
    };

    const ensureSessionLoaded = (entry: SessionEntry): Promise<void> => {
        if (entry.loading !== undefined) return entry.loading;
        if (entry.historyLoaded && !entry.reconcileRequired) return Promise.resolve();
        return requestSessionLoad(entry);
    };

    const resync = (reconcileSessions: boolean): Promise<void> => {
        if (resyncTask !== undefined) return resyncTask;
        reportDebug({
            detail: debugDetail({ after: cursor ?? null, reconcileSessions }),
            level: "info",
            message: "State reconciliation started",
            source: "sync",
        });
        const running = (async (): Promise<void> => {
            const bootstrap = await client.getDesktopBootstrap({
                signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS),
            });
            const watchedGit = await optional(() =>
                client.watchGit(
                    {
                        workspaceIds: activeGitWorkspaceIds(
                            bootstrap.projects,
                            bootstrap.workspaces,
                        ),
                    },
                    { signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS) },
                ),
            );
            config = bootstrap.config;
            groupsStore.setState({
                projects: bootstrap.projects,
                workspaces: bootstrap.workspaces,
            });
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
                    projects: projectGroups(
                        bootstrap.projects,
                        bootstrap.workspaces,
                        endpoint,
                        config,
                        gitStates,
                        agentDrafts,
                        agentModes,
                    ),
                },
            ]);
            // Startup has no missing journal interval: a session that was
            // materialized concurrently owns its own cursor-bounded snapshot.
            // Only a server-confirmed journal gap invalidates session caches.
            // Inactive caches are marked and reconciled lazily when reopened so
            // one lost cursor does not fan out across every chat ever viewed.
            const activeReconciliations: Promise<void>[] = [];
            for (const entry of sessions.values()) {
                publishSession(entry);
                if (!reconcileSessions) continue;
                entry.reconcileRequired = true;
                if (entry.subscribers.size > 0) {
                    activeReconciliations.push(requestSessionLoad(entry));
                }
            }
            await Promise.all(activeReconciliations);
            const buffered = resyncBufferedEvents.splice(0);
            // The bootstrap snapshot already contains every change at or before
            // its cursor, and the buffer may hold redeliveries; replay only
            // strictly newer events, each at most once.
            let replayed = bootstrap.cursor;
            for (const event of buffered) {
                if (event.cursor.localeCompare(replayed) <= 0) continue;
                replayed = event.cursor;
                // A session reloaded during this resync covers its own events
                // up to its agent's lastCursor, which may lie past the
                // bootstrap cursor; replaying one of those would duplicate a
                // streaming segment the reloaded history already contains.
                const agentId = agentIdOfEvent(event);
                const boundary =
                    agentId === undefined ? undefined : sessions.get(agentId)?.agent?.lastCursor;
                if (boundary !== undefined && event.cursor.localeCompare(boundary) <= 0) continue;
                applyEventNow(event);
            }
            reportDebug({
                detail: debugDetail({
                    cursor: bootstrap.cursor,
                    reconciledSessions: activeReconciliations.length,
                    projects: bootstrap.projects.length,
                    sessions: bootstrap.projects.reduce(
                        (count, project) => count + project.agents.length,
                        bootstrap.workspaces.reduce(
                            (count, workspace) => count + workspace.agents.length,
                            0,
                        ),
                    ),
                    watchedGit: Object.keys(watchedGit?.snapshots ?? {}).length,
                    workspaces: bootstrap.workspaces.length,
                }),
                level: "info",
                message: "State reconciliation completed",
                source: "sync",
            });
        })();
        const tracked = running.finally(() => {
            if (resyncTask === tracked) resyncTask = undefined;
        });
        resyncTask = tracked;
        return tracked;
    };

    const renewGitWatch = async (): Promise<void> => {
        if (config === undefined) return;
        const watched = groupsStore.getState();
        const watchedGit = await optional(() =>
            client.watchGit(
                { workspaceIds: activeGitWorkspaceIds(watched.projects, watched.workspaces) },
                {
                    signal: AbortSignal.any([
                        rootController.signal,
                        AbortSignal.timeout(MUTATION_RESPONSE_TIMEOUT_MS),
                    ]),
                },
            ),
        );
        if (watchedGit === undefined || rootController.signal.aborted) return;
        let changed = false;
        for (const [workspaceId, git] of Object.entries(watchedGit.snapshots)) {
            const current = gitStates.get(workspaceId);
            if (current !== undefined && current.scannedAt >= git.scannedAt) continue;
            gitStates.set(workspaceId, git);
            groupsStore.setState((state) => ({
                workspaces: state.workspaces.map((workspace) =>
                    workspace.id === workspaceId ? { ...workspace, git: git.facts } : workspace,
                ),
                projects: state.projects.map((project) =>
                    project.id === workspaceId ? { ...project, git: git.facts } : project,
                ),
            }));
            changed = true;
        }
        if (changed) publishGroups();
    };

    const runGitWatchRenewal = async (): Promise<void> => {
        while (!rootController.signal.aborted) {
            await abortableWait(GIT_WATCH_RENEW_MS, rootController.signal);
            await renewGitWatch();
        }
    };

    const applyEvent = (event: HappyAgentEvent): void => {
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

    // A broken resource version chain is local to that resource. Its focused
    // endpoint repairs it; a failed focused read must not amplify into desktop
    // bootstrap plus every materialized conversation snapshot.
    const refetchResource = (refetch: Promise<void>): void => background(refetch);

    const reloadConfig = async (): Promise<void> => {
        const response = await client.getConfig({
            signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS),
        });
        config = response.config;
        publishGroups();
        for (const entry of sessions.values()) publishSession(entry);
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
                groupsStore.setState((state) => ({
                    projects: replaceResource(state.projects, event.payload.project),
                }));
                publishGroups([{ type: "project_added", projectId: event.payload.project.id }]);
                background(renewGitWatch());
                return;
            case "project.updated": {
                const current = groupsStore
                    .getState()
                    .projects.find((project) => project.id === event.payload.projectId);
                if (current === undefined) {
                    refetchResource(
                        client
                            .getProject(event.payload.projectId, {
                                signal: rootController.signal,
                            })
                            .then(({ project }) => {
                                groupsStore.setState((state) => ({
                                    projects: replaceResource(state.projects, project),
                                }));
                                publishGroups();
                            }),
                    );
                    return;
                }
                if (current.version !== event.payload.previousVersion) {
                    refetchResource(
                        client
                            .getProject(event.payload.projectId, {
                                signal: rootController.signal,
                            })
                            .then(({ project }) => {
                                const latest = groupsStore
                                    .getState()
                                    .projects.find((candidate) => candidate.id === project.id);
                                if (
                                    latest === undefined ||
                                    latest.version.localeCompare(project.version) <= 0
                                ) {
                                    groupsStore.setState((state) => ({
                                        projects: replaceResource(state.projects, project),
                                    }));
                                    publishGroups();
                                }
                            }),
                    );
                    return;
                }
                groupsStore.setState((state) => ({
                    projects: replaceResource(state.projects, {
                        ...applyChanges(current, event.payload.changes),
                        version: event.payload.version,
                    }),
                }));
                publishGroups();
                return;
            }
            case "workspace.created":
                groupsStore.setState((state) => ({
                    workspaces: replaceResource(state.workspaces, event.payload.workspace),
                }));
                publishGroups([
                    {
                        type: "workspace_added",
                        projectId: event.payload.workspace.projectId,
                        workspaceId: event.payload.workspace.id,
                    },
                ]);
                background(renewGitWatch());
                return;
            case "workspace.updated": {
                const current = workspaceOf(event.payload.workspaceId);
                if (current === undefined) {
                    refetchResource(
                        client
                            .getWorkspace(event.payload.workspaceId, {
                                signal: rootController.signal,
                            })
                            .then(({ workspace }) => {
                                groupsStore.setState((state) => ({
                                    workspaces: replaceResource(state.workspaces, workspace),
                                }));
                                publishGroups();
                            }),
                    );
                    return;
                }
                if (current.version !== event.payload.previousVersion) {
                    refetchResource(
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
                                    groupsStore.setState((state) => ({
                                        workspaces: replaceResource(state.workspaces, workspace),
                                    }));
                                    publishGroups();
                                }
                            }),
                    );
                    return;
                }
                groupsStore.setState((state) => ({
                    workspaces: replaceResource(state.workspaces, {
                        ...applyChanges(current, event.payload.changes),
                        version: event.payload.version,
                    }),
                }));
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
                    refetchResource(
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
                    refetchResource(
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
            case "agent.context.updated": {
                const entry = sessions.get(event.payload.agentId);
                if (entry !== undefined) {
                    entry.context = event.payload.context;
                    publishSession(entry);
                }
                return;
            }
            case "agent.draft.updated":
                adoptDraft(event.payload.agentId, event.payload.draft);
                return;
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
                recoverCorruptedMessages(event.payload.agentId);
                return;
            case "run.finished":
                updateRun(event.payload.agentId, event.payload.run);
                recoverCorruptedMessages(event.payload.agentId);
                options.onSessionFinished?.(event.payload.agentId);
                return;
            case "message.created":
                createMessage(event.payload.agentId, event.payload.message, event.payload.runId);
                return;
            case "message.updated":
                updateMessageSnapshot(
                    event.payload.agentId,
                    event.payload.message,
                    event.payload.runId,
                );
                return;
            case "message.delta":
                appendMessageDelta(event.payload);
                return;
            case "message.deleted": {
                const entry = sessions.get(event.payload.agentId);
                entry?.messages.delete(event.payload.messageId);
                entry?.messageBlockOffsets.delete(event.payload.messageId);
                entry?.corruptedMessageIds.delete(event.payload.messageId);
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
                            refetchResource(
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
                    const entry = sessions.get(event.payload.process.agentId);
                    if (entry !== undefined) updateActivityProcess(entry, event.payload.process);
                }
                return;
            case "process.updated":
            case "process.exited": {
                const entry = sessionOwningProcess(event.payload.processId);
                if (entry !== undefined) patchActivityProcess(entry, event.payload);
                return;
            }
            case "config.updated":
                background(reloadConfig());
                return;
            case "git.updated": {
                const { git, workspaceId } = event.payload;
                gitStates.set(workspaceId, git);
                groupsStore.setState((state) => ({
                    workspaces: state.workspaces.map((workspace) =>
                        workspace.id === workspaceId ? { ...workspace, git: git.facts } : workspace,
                    ),
                    projects: state.projects.map((project) =>
                        project.id === workspaceId ? { ...project, git: git.facts } : project,
                    ),
                }));
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
        const current = entry.runs.get(run.id);
        if (current !== undefined && current.status !== "running" && run.status === "running") {
            return;
        }
        entry.runs.set(run.id, run);
        entry.runsOrdered = undefined;
        publishSession(entry);
    };

    const updateMessage = (agentId: string, message: Message, runId: string | null): void => {
        if (message.role === "user") sendConfirmations.get(message.id)?.();
        const entry = sessions.get(agentId);
        if (entry === undefined) return;
        entry.messages.set(message.id, { message, runId });
        if (message.role === "user") {
            entry.mode = message.mode;
            agentModes.set(agentId, message.mode);
            const intended = intendedModes.get(agentId);
            if (intended !== undefined && modesEqual(intended, message.mode)) {
                intendedModes.delete(agentId);
            }
            publishGroups();
        }
        publishSession(entry);
    };

    const updateMessageSnapshot = (agentId: string, message: Message, runId: string): void => {
        const entry = sessions.get(agentId);
        const current = entry?.messages.get(message.id);
        if (
            current?.message.role === "agent" &&
            message.role === "agent" &&
            message.content.length === 0
        ) {
            return;
        }
        if (entry === undefined || current?.message.role !== "agent" || message.role !== "agent") {
            if (entry !== undefined) {
                entry.messageBlockOffsets.delete(message.id);
                entry.corruptedMessageIds.delete(message.id);
            }
            updateMessage(agentId, message, runId);
            return;
        }
        /*
         * The API gives every provider segment in a run one assistant-message
         * identity. A live `message.updated` snapshot contains the current
         * segment, while history contains their cumulative content. Replace
         * the matching live suffix when this segment evolved; append it when
         * the model moved on to a new segment after a tool result.
         */
        const merged = liveMessageContentMerge(current.message.content, message.content);
        entry.messageBlockOffsets.set(message.id, merged.offset);
        entry.corruptedMessageIds.delete(message.id);
        updateMessage(agentId, { ...message, content: merged.content }, runId);
    };

    const createMessage = (agentId: string, message: Message, runId: string | null): void => {
        const entry = sessions.get(agentId);
        const current = entry?.messages.get(message.id);
        if (current !== undefined) {
            /*
             * Happy Agent reuses one assistant-message identity across its
             * provider segments, and hydration can replay a creation already
             * represented by newer history. Only a locally pending user send
             * needs the durable creation to replace it.
             */
            if (current.pendingSend && message.role === "user") {
                updateMessage(agentId, message, runId);
            } else if (message.role === "user") {
                sendConfirmations.get(message.id)?.();
            }
            return;
        }
        if (entry !== undefined) entry.messageBlockOffsets.set(message.id, 0);
        updateMessage(agentId, message, runId);
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
        if (entry === undefined) return;
        if (entry.corruptedMessageIds.has(payload.messageId)) return;
        const current = entry?.messages.get(payload.messageId);
        const blockIndex =
            (entry.messageBlockOffsets.get(payload.messageId) ?? 0) + payload.blockIndex;
        const applied = applyMessageDelta(current?.message, { ...payload, blockIndex });
        if (applied.kind === "replayed") return;
        if (applied.kind === "reconcile") {
            reportDebug({
                detail: debugDetail({
                    blockIndex,
                    messageId: payload.messageId,
                    offset: payload.offset,
                    sessionId: payload.agentId,
                }),
                level: "warning",
                message: "Message delta did not match local state; awaiting a complete snapshot",
                source: "sync",
            });
            // The protocol promises a complete `message.updated` snapshot after
            // streaming deltas. Ignore this message's remaining deltas until it
            // arrives; only a run boundary with no repair falls back to history.
            entry.corruptedMessageIds.add(payload.messageId);
            return;
        }
        if (current === undefined) return;
        entry.messages.set(payload.messageId, {
            ...current,
            message: applied.message,
        });
        publishSession(entry);
    };

    const recoverCorruptedMessages = (agentId: string): void => {
        const entry = sessions.get(agentId);
        if (entry === undefined || entry.corruptedMessageIds.size === 0) return;
        entry.reconcileRequired = true;
        background(requestSessionLoad(entry));
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

    const loadActivity = (entry: SessionEntry): Promise<void> => {
        if (entry.activityLoading !== undefined) return entry.activityLoading;
        const revision = entry.activityRevision;
        const running = client
            .getAgentActivity(entry.id, {
                signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS),
            })
            .then((activity) => {
                if (sessions.get(entry.id) !== entry || entry.activityRevision !== revision) return;
                setActivity(entry, activity);
                publishSession(entry);
            })
            .catch((error: unknown) => {
                if (!rootController.signal.aborted) {
                    for (const subscriber of entry.subscribers) subscriber.onError?.(error);
                }
            });
        const tracked = running.finally(() => {
            if (entry.activityLoading === tracked) entry.activityLoading = undefined;
        });
        entry.activityLoading = tracked;
        return tracked;
    };

    const recoverActivity = (entry: SessionEntry): void => {
        if (entry.subscribers.size > 0) background(loadActivity(entry));
        else entry.reconcileRequired = true;
    };

    const updateActivityProcess = (entry: SessionEntry, process: BackgroundProcess): void => {
        const activity = entry.activity;
        if (activity === undefined) {
            recoverActivity(entry);
            return;
        }
        const current = activity.processes.find((candidate) => candidate.id === process.id);
        if (!shouldAdoptVersion(current, process)) return;
        setActivity(entry, {
            ...activity,
            processes: [...replaceResource(activity.processes, process)],
        });
        publishSession(entry);
    };

    const sessionOwningProcess = (processId: string): SessionEntry | undefined => {
        const agentId = processOwners.get(processId);
        if (agentId !== undefined) {
            const entry = sessions.get(agentId);
            if (entry !== undefined) return entry;
        }
        for (const entry of sessions.values()) {
            if (entry.activity?.processes.some((process) => process.id === processId)) return entry;
        }
        return undefined;
    };

    const patchActivityProcess = (
        entry: SessionEntry,
        payload: Extract<HappyAgentEvent, { type: "process.updated" }>["payload"],
    ): void => {
        const current = entry.activity?.processes.find(
            (process) => process.id === payload.processId,
        );
        if (current === undefined || current.version !== payload.previousVersion) {
            recoverActivity(entry);
            return;
        }
        updateActivityProcess(entry, {
            ...applyChanges(current, payload.changes),
            version: payload.version,
        });
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
                        signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS),
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
            settleSessionIfIdle(entry);
        });
        entry.questionRecovery = tracked;
    };

    const retryUpdates = (): void => {
        if (closed || rootController.signal.aborted) return;
        retryRequested = true;
        updatesAttemptController?.abort();
        retryWake?.();
        retryWake = undefined;
    };

    const reconnectPause = async (milliseconds: number): Promise<void> => {
        if (retryRequested) {
            retryRequested = false;
            return;
        }
        let wake!: () => void;
        const requested = new Promise<void>((resolve) => {
            wake = resolve;
            retryWake = resolve;
        });
        try {
            await Promise.race([wait(milliseconds, rootController.signal), requested]);
        } finally {
            if (retryWake === wake) retryWake = undefined;
            retryRequested = false;
        }
    };

    const runUpdates = async (): Promise<void> => {
        let reconnectMs = INITIAL_RECONNECT_MS;
        while (!rootController.signal.aborted) {
            const attemptController = new AbortController();
            updatesAttemptController = attemptController;
            const attemptSignal = AbortSignal.any([
                rootController.signal,
                attemptController.signal,
            ]);
            try {
                // Health gates startup because it is the only route guaranteed
                // while the daemon is booting. Once the first bootstrap lands,
                // the client's managed update feed owns reachability and
                // reconnection.
                if (config === undefined) {
                    reportDebug({
                        level: "info",
                        message: "Checking Rig health before managed updates",
                        source: "connection",
                    });
                    const health = await client.getHealth({
                        signal: AbortSignal.any([
                            attemptSignal,
                            AbortSignal.timeout(SNAPSHOT_RESPONSE_TIMEOUT_MS),
                        ]),
                    });
                    reportDebug({
                        detail: debugDetail(health),
                        level: health.ready ? "info" : "warning",
                        message: health.ready ? "Rig health check passed" : "Rig is not ready",
                        source: "connection",
                    });
                    const nextCompatibility = serverCompatibility(health.version.protocol);
                    reportCompatibility(nextCompatibility);
                    if (nextCompatibility.status !== "compatible" || !health.ready) {
                        publishConnection("connecting");
                        reportDebug({
                            detail: debugDetail({ delayMs: reconnectMs }),
                            level: "warning",
                            message: "Waiting before the next connection attempt",
                            source: "connection",
                        });
                        await reconnectPause(reconnectMs);
                        reconnectMs = Math.min(reconnectMs * 2, MAXIMUM_RECONNECT_MS);
                        continue;
                    }
                }
                if (config === undefined) await resync(false);
                let reopen = false;
                reportDebug({
                    detail: debugDetail({ after: cursor ?? null }),
                    level: "info",
                    message: "Opening managed update feed",
                    source: "sse",
                });
                for await (const update of client.updates({
                    after: cursor,
                    signal: attemptSignal,
                })) {
                    if (update.kind === "connected") {
                        reportDebug({
                            detail: debugDetail({ cursor: update.cursor }),
                            level: "info",
                            message: "Managed update feed connected",
                            source: "sse",
                        });
                        publishConnection("live");
                        reconnectMs = INITIAL_RECONNECT_MS;
                    } else if (update.kind === "state_lost") {
                        reportDebug({
                            detail: debugDetail({ cursor: update.cursor }),
                            level: "warning",
                            message: "Managed update feed reported a journal gap",
                            source: "sse",
                        });
                        publishConnection("reconnecting");
                        await resync(true);
                        reopen = true;
                        break;
                    } else if (update.kind === "disconnected") {
                        reportDebug({
                            detail: debugDetail({ cursor: update.cursor ?? null }),
                            level: "warning",
                            message: "Managed update feed disconnected; client reconnecting",
                            source: "sse",
                        });
                        publishConnection("reconnecting");
                    } else {
                        reportDebug({
                            detail: debugDetail(update.event),
                            level: "info",
                            message: `SSE event arrived: ${update.event.type}`,
                            source: "sse",
                        });
                        // `updates()` has already rejected duplicate and older
                        // cursors. Keep Happy's cursor only as the durable
                        // snapshot boundary used by hydration and gap recovery.
                        rememberEvent(update.event);
                        applyEvent(update.event);
                        advanceCursor(update.cursor);
                    }
                }
                if (reopen) {
                    retryRequested = false;
                    continue;
                }
                if (!rootController.signal.aborted) {
                    reportDebug({
                        level: retryRequested ? "info" : "warning",
                        message: retryRequested
                            ? "Managed update feed restart requested"
                            : "Managed update feed ended",
                        source: "sse",
                    });
                    publishConnection("reconnecting");
                }
            } catch (error) {
                if (rootController.signal.aborted) break;
                publishConnection(config === undefined ? "connecting" : "reconnecting");
                if (!retryRequested) {
                    reportDebug({
                        detail: errorDetail(error),
                        level: "error",
                        message: "Connection or update reconciliation failed",
                        source: "connection",
                    });
                    for (const subscriber of groupSubscribers) subscriber.onError?.(error);
                    for (const entry of sessions.values()) {
                        for (const subscriber of entry.subscribers) subscriber.onError?.(error);
                    }
                }
            } finally {
                if (updatesAttemptController === attemptController) {
                    updatesAttemptController = undefined;
                }
            }
            if (!rootController.signal.aborted) {
                const immediate = retryRequested;
                if (!immediate) {
                    reportDebug({
                        detail: debugDetail({ delayMs: reconnectMs }),
                        level: "info",
                        message: "Reconnect scheduled",
                        source: "connection",
                    });
                }
                await reconnectPause(immediate ? 0 : reconnectMs);
                reconnectMs = immediate
                    ? INITIAL_RECONNECT_MS
                    : Math.min(reconnectMs * 2, MAXIMUM_RECONNECT_MS);
            }
        }
    };

    const sendMessageWithRetry = async (
        sessionId: string,
        request: SendMessageRequest,
        confirmed: Promise<void>,
    ): Promise<SendMessageResponse | undefined> => {
        let retryMs = INITIAL_SEND_RETRY_MS;
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await Promise.race([
                    client.sendMessage(sessionId, request, { signal: deadlineSignal() }),
                    confirmed.then(() => undefined),
                ]);
            } catch (error) {
                const retryable =
                    !(error instanceof HappyAgentApiError) ||
                    error.status === 408 ||
                    error.status === 429 ||
                    error.status >= 500;
                if (rootController.signal.aborted || !retryable || attempt >= SEND_ATTEMPTS) {
                    throw error;
                }
                await wait(retryMs, rootController.signal);
                retryMs = Math.min(retryMs * 2, MAXIMUM_RECONNECT_MS);
            }
        }
    };

    const mutation = <T>(
        action: MutationAction,
        mutationId: string,
        request: () => Promise<T>,
        applied?: (value: T) => void,
        rejected?: () => boolean | void,
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
                    const shouldReport = rejected?.() !== false;
                    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
                    if (shouldReport) {
                        reportMutationFailure(
                            action,
                            mutationId,
                            timedOut ? new Error("The agent did not answer in time.") : error,
                            sessionId,
                        );
                    }
                }
            })
            .finally(() => {
                if (mutationQueues.get(queueKey) === settled) mutationQueues.delete(queueKey);
                if (sessionId !== undefined) {
                    const pending = (sessionMutationCounts.get(sessionId) ?? 1) - 1;
                    if (pending === 0) sessionMutationCounts.delete(sessionId);
                    else sessionMutationCounts.set(sessionId, pending);
                    const entry = sessions.get(sessionId);
                    if (entry !== undefined) settleSessionIfIdle(entry);
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
        const previousDraft =
            agentDrafts.get(sessionId) ?? ({ value: null, updatedAt: null } as const);
        const mode = change(modeOf(config, previousDraft, agentModes.get(sessionId), previousMode));
        const updatedAt = now();
        const draft: AgentDraftSnapshot = {
            value: { ...mode, text: previousDraft.value?.text ?? "" },
            updatedAt,
        };
        intendedModes.set(sessionId, mode);
        const revision = (draftRevisions.get(sessionId) ?? 0) + 1;
        draftRevisions.set(sessionId, revision);
        replaceDraft(sessionId, draft);
        return mutation(
            action,
            mutationId,
            () =>
                client.saveAgentDraft(
                    sessionId,
                    {
                        draft: draft.value,
                        mutationId,
                        updatedAt,
                    },
                    { signal: rootController.signal },
                ),
            ({ draft: saved }) => {
                if (draftRevisions.get(sessionId) !== revision) return;
                draftRevisions.delete(sessionId);
                intendedModes.delete(sessionId);
                replaceDraft(sessionId, saved);
            },
            () => {
                if (draftRevisions.get(sessionId) !== revision) return;
                draftRevisions.delete(sessionId);
                if (previousMode === undefined) intendedModes.delete(sessionId);
                else intendedModes.set(sessionId, previousMode);
                replaceDraft(sessionId, previousDraft);
            },
            sessionId,
            `agent:${sessionId}`,
        );
    };

    background(runUpdates());
    background(runGitWatchRenewal());

    return {
        compatibility: () => compatibility,
        retry: retryUpdates,
        connectGroups(subscription) {
            if (closed) throw new Error("This Happy Agent connection is closed.");
            const subscriber: GroupsSubscriber = { ...subscription, closed: false };
            groupSubscribers.add(subscriber);
            subscriber.onChange(groupsStore.getState().groups, groupState());
            return {
                projects: () => groupsStore.getState().groups,
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
                    messageBlockOffsets: new Map(),
                    runs: new Map(),
                    hasMore: false,
                    loading: undefined,
                    historyLoaded: false,
                    loadRequestedRevision: 0,
                    loadCompletedRevision: 0,
                    loadRetry: undefined,
                    loadRetryMs: INITIAL_RECONNECT_MS,
                    loadingMore: false,
                    hydrating: false,
                    bufferedEvents: [],
                    activityLoading: undefined,
                    activityRevision: 0,
                    reconcileRequired: false,
                    corruptedMessageIds: new Set(),
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
            void ensureSessionLoaded(entry);
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
                    settleSessionIfIdle(connectedEntry);
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
                const project = groupsStore
                    .getState()
                    .projects.find((candidate) => candidate.id === projectId);
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
                                groupsStore
                                    .getState()
                                    .projects.find((candidate) => candidate.id === projectId)
                                    ?.version ?? project.version,
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
            const project = groupsStore
                .getState()
                .projects.find((candidate) => candidate.id === input.projectId);
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
                    nameSource: "generated",
                    orderKey: workspaceId,
                    parentId: input.projectId,
                    projectId: input.projectId,
                    status: "active",
                    updatedAt: createdAt,
                    version: workspaceId,
                };
                groupsStore.setState((state) => ({
                    workspaces: replaceResource(state.workspaces, optimistic),
                }));
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
                            // Desktop-created workspaces begin with a placeholder
                            // name so the first chat can give the workspace its
                            // durable generated name.
                            nameConfigured: false,
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
                    groupsStore.setState((state) => ({
                        workspaces: state.workspaces.filter(
                            (workspace) =>
                                workspace.id !== workspaceId || workspace.version !== workspaceId,
                        ),
                    }));
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
        createSession(input, checkoutReady) {
            const sessionId = nextId();
            const workspaceId = resolveWorkspaceId(input, groupsStore.getState().workspaces);
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
            if (config !== undefined) {
                const mode = modeFromInput(input, config);
                intendedModes.set(sessionId, mode);
                agentModes.set(sessionId, mode);
            }
            unannouncedAgents.add(sessionId);
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
                    unread: null,
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
                async () => {
                    // The name above is already out in the world; only the
                    // request waits. A workspace still being prepared settles
                    // this first, and its failure is this creation's failure.
                    if (checkoutReady !== undefined) await checkoutReady;
                    try {
                        return await client.createAgent(
                            {
                                id: sessionId,
                                mutationId: sessionId,
                                workspaceId,
                            },
                            { signal: deadlineSignal() },
                        );
                    } catch (error) {
                        if (
                            rootController.signal.aborted ||
                            (error instanceof HappyAgentApiError && error.status < 500)
                        ) {
                            throw error;
                        }
                        // The daemon may have committed the chosen agent ID and
                        // only lost the HTTP response. Read that exact resource
                        // back before declaring creation failed and releasing
                        // the first queued send.
                        try {
                            return await client.getAgent(sessionId, { signal: deadlineSignal() });
                        } catch {
                            throw error;
                        }
                    }
                },
                ({ agent }) => {
                    unannouncedAgents.delete(sessionId);
                    if (adoptAgent(agent)) {
                        publishGroups([{ type: "session_added", sessionId: agent.id }]);
                    }
                    // The daemon can answer for this agent now. A reader who has
                    // been sitting in it since before it existed gets its real
                    // transcript without having asked for one.
                    const entry = sessions.get(sessionId);
                    if (entry !== undefined) background(requestSessionLoad(entry));
                },
                () => {
                    unannouncedAgents.delete(sessionId);
                    const authoritative = agentOf(sessionId);
                    if (authoritative !== undefined && authoritative.version !== sessionId) {
                        return false;
                    }
                    intendedModes.delete(sessionId);
                    agentModes.delete(sessionId);
                    agentDrafts.delete(sessionId);
                    draftRevisions.delete(sessionId);
                    groupsStore.setState((state) => ({
                        workspaces: state.workspaces.map((candidate) =>
                            candidate.id === workspaceId
                                ? {
                                      ...candidate,
                                      agents: candidate.agents.filter(
                                          (agent) =>
                                              agent.id !== sessionId || agent.version !== sessionId,
                                      ),
                                  }
                                : candidate,
                        ),
                        projects: state.projects.map((candidate) =>
                            candidate.id === workspaceId
                                ? {
                                      ...candidate,
                                      agents: candidate.agents.filter(
                                          (agent) =>
                                              agent.id !== sessionId || agent.version !== sessionId,
                                      ),
                                  }
                                : candidate,
                        ),
                    }));
                    publishGroups([{ type: "session_removed", sessionId }]);
                    return true;
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
            const mode = modeOf(
                config,
                agentDrafts.get(sessionId),
                agentModes.get(sessionId),
                intendedModes.get(sessionId),
            );
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
            // The composer deliberately permits an image-only turn, while the
            // daemon's send contract requires non-empty display text. Rig uses
            // the image media types as the canonical display fallback.
            const requestText =
                input.text.trim().length > 0
                    ? input.text
                    : richContent.map((block) => `[image:${block.mimeType}]`).join("");
            // Always steer: a message sent mid-run interrupts the run rather
            // than waiting behind it, and on an idle agent the daemon treats
            // steer and queue identically.
            const delivery = "steer" as const;
            let confirmSend!: () => void;
            const confirmed = new Promise<void>((resolve) => {
                confirmSend = resolve;
            });
            sendConfirmations.set(mutationId, confirmSend);
            const entry = sessions.get(sessionId);
            if (entry !== undefined) {
                entry.messages.set(mutationId, {
                    message: {
                        id: mutationId,
                        role: "user",
                        createdAt: now(),
                        content,
                        metadata: {},
                        status: "pending",
                        delivery,
                        mode,
                        runId: null,
                    },
                    runId: null,
                    pendingSend: true,
                });
                publishSession(entry);
            }
            return mutation(
                "send_message",
                mutationId,
                () =>
                    sendMessageWithRetry(
                        sessionId,
                        {
                            id: mutationId,
                            text: requestText,
                            ...(richContent.length === 0 ? {} : { content: richContent }),
                            delivery,
                            mode,
                        },
                        confirmed,
                    ),
                (response) => {
                    sendConfirmations.delete(mutationId);
                    if (response !== undefined) {
                        updateMessage(sessionId, response.message, response.message.runId);
                    }
                },
                () => {
                    sendConfirmations.delete(mutationId);
                    const current = sessions.get(sessionId);
                    const message = current?.messages.get(mutationId);
                    if (current !== undefined && message?.pendingSend) {
                        current.messages.delete(mutationId);
                        publishSession(current);
                        return true;
                    }
                    // The event stream or bootstrap already confirmed this ID;
                    // a lost HTTP response must not turn a delivered message
                    // into a visible failure.
                    return message === undefined;
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
                    if (current !== undefined) updateActivityProcess(current, stopped);
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
                () => client.abortAgent(sessionId, { mutationId }, { signal: deadlineSignal() }),
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
                ({ agent, message, run }) => {
                    adoptAgent(agent);
                    const entry = sessions.get(sessionId);
                    if (entry === undefined) return;
                    if (!entry.runs.has(run.id)) updateRun(sessionId, run);
                    if (!entry.messages.has(message.id)) updateMessage(sessionId, message, run.id);
                },
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
            const mode = modeOf(
                config,
                agentDrafts.get(sessionId),
                agentModes.get(sessionId),
                intendedModes.get(sessionId),
            );
            const previousDraft =
                agentDrafts.get(sessionId) ?? ({ value: null, updatedAt: null } as const);
            const updatedAt = value.updatedAt ?? now();
            const draft: AgentDraftSnapshot = {
                value: value.draft === null ? null : { ...mode, text: value.draft },
                updatedAt,
            };
            const revision = (draftRevisions.get(sessionId) ?? 0) + 1;
            draftRevisions.set(sessionId, revision);
            replaceDraft(sessionId, draft);
            return mutation(
                "set_draft",
                mutationId,
                () =>
                    client.saveAgentDraft(
                        sessionId,
                        {
                            draft: draft.value,
                            mutationId,
                            updatedAt,
                        },
                        { signal: rootController.signal },
                    ),
                ({ draft: saved }) => {
                    if (draftRevisions.get(sessionId) !== revision) return;
                    draftRevisions.delete(sessionId);
                    replaceDraft(sessionId, saved);
                },
                () => {
                    if (draftRevisions.get(sessionId) !== revision) return;
                    draftRevisions.delete(sessionId);
                    replaceDraft(sessionId, previousDraft);
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
            const project = groupsStore
                .getState()
                .projects.find((candidate) => candidate.id === projectId);
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
                                groupsStore
                                    .getState()
                                    .projects.find((candidate) => candidate.id === projectId)
                                    ?.version ?? project.version,
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
            reportDebug({
                level: "info",
                message: "Happy Agent connection closed",
                source: "connection",
            });
            rootController.abort();
            updatesAttemptController?.abort();
            retryWake?.();
            retryWake = undefined;
            publishConnection("closed");
            groupSubscribers.clear();
            for (const entry of sessions.values()) entry.subscribers.clear();
            sessions.clear();
            intendedModes.clear();
            agentModes.clear();
            agentDrafts.clear();
            sendConfirmations.clear();
            draftRevisions.clear();
            mutationQueues.clear();
            sessionMutationCounts.clear();
            processOwners.clear();
            hydrationBroadcastEvents.length = 0;
            recentEvents.length = 0;
            resyncBufferedEvents.length = 0;
        },
    };

    async function loadEarlier(entry: SessionEntry, token: string): Promise<void> {
        if (entry.loadingMore || !entry.hasMore) return;
        const oldest = runsOrderedOf(entry)[0];
        if (oldest === undefined || oldest.id !== token) return;
        entry.loadingMore = true;
        entry.loadMoreError = undefined;
        publishSession(entry);
        try {
            const page = await client.getMessages(
                entry.id,
                { before: token, limit: DEFAULT_HISTORY_LIMIT, omitToolData: false },
                { signal: deadlineSignal(SNAPSHOT_RESPONSE_TIMEOUT_MS) },
            );
            ingestHistory(entry, page.runs, []);
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
            const project = groupsStore
                .getState()
                .projects.find((candidate) => candidate.id === target.projectId);
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
                                groupsStore
                                    .getState()
                                    .projects.find((candidate) => candidate.id === project.id)
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

function liveMessageContentMerge(
    current: readonly MessageBlock[],
    snapshot: readonly MessageBlock[],
): { content: MessageBlock[]; offset: number } {
    // Align the snapshot against the current tail by block identity, tolerant
    // in both directions: the snapshot may be ahead of the assembled content
    // (arguments and text still streaming) or behind it (a stale in-flight
    // snapshot, or one whose reasoning text the provider trimmed). Demanding
    // that the snapshot strictly extend the current blocks made every stale or
    // trimmed snapshot fail alignment and fall through to the append below,
    // which is what duplicated whole segments — the appended copies then never
    // finished, because later snapshots kept aligning with the newest copy.
    const maximumOverlap = Math.min(current.length, snapshot.length);
    for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
        const offset = current.length - overlap;
        let matches = true;
        for (let index = 0; index < overlap; index += 1) {
            if (!messageBlockSame(current[offset + index]!, snapshot[index]!)) {
                matches = false;
                break;
            }
        }
        if (!matches) continue;
        const content = current.slice(0, offset);
        for (let index = 0; index < overlap; index += 1) {
            content.push(messageBlockMerge(current[offset + index]!, snapshot[index]!));
        }
        content.push(...snapshot.slice(overlap));
        return { content, offset };
    }
    return { content: [...current, ...snapshot], offset: current.length };
}

/** Whether two live projections describe the same provider block. */
function messageBlockSame(previous: MessageBlock, next: MessageBlock): boolean {
    if (previous.type !== next.type) return false;
    switch (previous.type) {
        case "text":
            return (
                next.type === "text" &&
                (next.text.startsWith(previous.text) || previous.text.startsWith(next.text))
            );
        case "reasoning":
            return (
                next.type === "reasoning" &&
                (next.text.startsWith(previous.text) || previous.text.startsWith(next.text))
            );
        case "image":
            return (
                next.type === "image" &&
                previous.mimeType === next.mimeType &&
                previous.data === next.data
            );
        case "tool_call":
            return next.type === "tool_call" && previous.id === next.id;
        case "compaction":
            return (
                next.type === "compaction" &&
                previous.startedAt === next.startedAt &&
                previous.trigger === next.trigger &&
                JSON.stringify(previous.replacedMessageIds) ===
                    JSON.stringify(next.replacedMessageIds)
            );
    }
}

/** The richer of two projections of one block; a stale side never wins. */
function messageBlockMerge(previous: MessageBlock, next: MessageBlock): MessageBlock {
    if (previous.type === "text" && next.type === "text") {
        return next.text.startsWith(previous.text) ? next : previous;
    }
    if (previous.type === "reasoning" && next.type === "reasoning") {
        return next.text.startsWith(previous.text) ? next : previous;
    }
    if (previous.type === "tool_call" && next.type === "tool_call") {
        // A finished call never goes back to running, and a result already
        // received never disappears.
        if (previous.status !== "running" && next.status === "running") return previous;
        if (
            previous.status !== "running" &&
            next.status !== "running" &&
            next.result === undefined &&
            previous.result !== undefined
        ) {
            return previous;
        }
        return next;
    }
    return next;
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
    entry.runsOrdered = undefined;
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

function activeGitWorkspaceIds(
    projects: readonly Project[],
    workspaces: readonly Workspace[],
): string[] {
    return [
        ...new Set([
            ...projects
                .filter((project) => project.archivedAt === null && project.status === "active")
                .map((project) => project.id),
            ...workspaces
                .filter(
                    (workspace) => workspace.archivedAt === null && workspace.status === "active",
                )
                .map((workspace) => workspace.id),
        ]),
    ];
}

function agentIdOfEvent(event: HappyAgentEvent): string | undefined {
    switch (event.type) {
        case "agent.created":
            return event.payload.agent.id;
        case "agent.updated":
        case "agent.context.updated":
        case "agent.draft.updated":
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
