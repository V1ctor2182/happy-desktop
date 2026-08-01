import type { MutationRejectedDelta, RigConnection } from "@slopus/rig-connect";
import { createStore } from "zustand/vanilla";
import type { Loadable } from "../conversation/loadable.js";
import type { UserError } from "../types.js";
import {
    rigProjectGroupsProject,
    rigSessionGroupIdOf,
    type RigProjectGroup,
} from "./rigProjectGroupProject.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import { orderKeyAfter } from "../utils/orderKeyAfter.js";
import type { RigEventObserver, RigGlobalEvent, RigTransport } from "./rigTransport.js";
import type {
    RigGroupId,
    RigProjectCatalog,
    RigProjectId,
    RigSession,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionSummary,
    RigWorktree,
    RigWorktreeId,
} from "./rigTypes.js";

/** How many outstanding rig-connect mutations this surface can attribute a refusal to. */
const PENDING_MUTATION_LIMIT = 256;

/**
 * The list surface of the local workspace: a `Loadable` of projects, each
 * carrying its sessions — and its worktrees' sessions — as ordinary conversation
 * rows. Local sessions are conversations like any other; nothing here is
 * Rig-shaped, and nothing here is selected — the open group and conversation are
 * addressed by the URL.
 */
export interface RigSessionListSnapshot {
    readonly projects: Loadable<readonly RigProjectGroup[]>;
    /** Last failed create/fork/reset, surfaced without rejecting the action. */
    readonly mutationError?: UserError;
}

/**
 * Where a session lives: both halves of its address, since a local session is
 * addressed by its group — its project, or the worktree inside it — and then by
 * itself.
 */
export interface RigSessionLocation {
    readonly sessionId: RigSessionId;
    readonly groupId: RigGroupId;
}

export type RigSessionListOutput =
    | { readonly type: "sessionCreated"; readonly location: RigSessionLocation }
    | { readonly type: "sessionForked"; readonly location: RigSessionLocation }
    | { readonly type: "sessionReset"; readonly sessionId: RigSessionId };

export interface RigSessionListStore {
    get(): RigSessionListSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Reconciles the durable list from the transport. Not a user-facing refresh
     * button: it runs on hydration and after mutations to converge on server truth.
     */
    sessionsRefresh(): Promise<void>;
    /**
     * Marks the session's latest completed work as seen. The mark is durable:
     * a session read before the window closed is not unread when it opens again.
     */
    sessionRead(sessionId: RigSessionId): void;
    /**
     * Creates a session and resolves with its address, or with `undefined` when
     * the mutation failed and was recorded in `mutationError`. That address is
     * what lets the caller navigate to the new conversation; this store never
     * selects.
     */
    sessionCreate(input: RigSessionCreateInput): Promise<RigSessionLocation | undefined>;
    /** Forks a session, resolving with the new session's address as `sessionCreate` does. */
    sessionFork(sessionId: RigSessionId): Promise<RigSessionLocation | undefined>;
    sessionReset(sessionId: RigSessionId): Promise<void>;
    /**
     * Closes a session: it leaves this list immediately and stays out of it
     * durably, without ending the session itself. A failure is recorded in
     * `mutationError` and the row returns on the following reconcile.
     */
    sessionArchive(sessionId: RigSessionId): Promise<void>;

    /** Moves one project after `afterId`, or to the front of the list when null. */
    projectReorder(projectId: RigProjectId, afterId: RigProjectId | null): Promise<void>;

    /**
     * Archives a project: it leaves the list with its conversations and
     * worktrees, and the host removes those worktrees' checkouts. A failure is
     * recorded in `mutationError` and the following reconcile puts the project
     * back.
     */
    projectArchive(projectId: RigProjectId): Promise<void>;
    /** Renames a project; the new name shows before the host confirms it. */
    projectRename(projectId: RigProjectId, name: string): Promise<void>;

    /**
     * Reserves a worktree in the project and resolves as soon as it exists, with
     * its id, so the caller can list and address it while the host is still
     * preparing the checkout. Resolves with `undefined` when the reservation
     * failed, with the reason recorded in `mutationError`.
     */
    worktreeCreate(projectId: RigProjectId): Promise<RigWorktreeId | undefined>;

    /**
     * Starts the first conversation in a worktree once the host reports its
     * checkout usable, resolving with that conversation's address. Split from
     * `worktreeCreate` so addressing the worktree does not wait on a git
     * checkout — but a session pointed at a checkout that does not exist yet
     * would fail on its first run, so the wait itself is not optional.
     *
     * `create` configures that conversation. Its `cwd` and `worktreeId` are
     * supplied here from the prepared checkout, since only this call knows where
     * the checkout ended up.
     */
    worktreeSessionStart(
        worktreeId: RigWorktreeId,
        create?: Omit<RigSessionCreateInput, "cwd" | "worktreeId">,
    ): Promise<RigSessionLocation | undefined>;

    /** Archives a worktree: it leaves the list and the host removes its checkout. */
    worktreeArchive(projectId: RigProjectId, worktreeId: RigWorktreeId): Promise<void>;
    /** Renames a worktree; the new name shows before the host confirms it. */
    worktreeRename(projectId: RigProjectId, worktreeId: RigWorktreeId, name: string): Promise<void>;

    /** Moves one worktree after `afterId` within its project, or to the front when null. */
    worktreeReorder(
        projectId: RigProjectId,
        worktreeId: RigWorktreeId,
        afterId: RigWorktreeId | null,
    ): Promise<void>;
    [Symbol.dispose](): void;
}

export interface RigSessionListDeps {
    readonly transport: RigTransport;
    /**
     * A stream-owned catalog authority, when the host can provide one.
     *
     * Most mutations still travel through `transport`; this source replaces the
     * project/workspace/session reads and their delivery-hint subscription, and
     * backs the optimistic overlay of the mutations that go through
     * `connectActions`.
     */
    readonly catalogSource?: RigSessionCatalogSource;
    /**
     * Optimistic mutation authority paired with `catalogSource`. A mutation
     * issued here names the entity it creates, shows it in the catalog before
     * the host answers, and withdraws it if the host refuses — so this store
     * neither mints the identity nor keeps a second copy of the row. Absent,
     * every mutation falls back to the request/reconcile path on `transport`,
     * which is how the store runs standalone against a fake server.
     */
    readonly connectActions?: Pick<RigConnection, "createWorkspace" | "markSessionRead">;
    /**
     * Terminal failures for mutations issued through `connectActions`. They
     * arrive here rather than as a rejected promise, because such a mutation is
     * accepted locally and can only fail later.
     */
    readonly connectMutationSubscribe?: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
    readonly output?: (event: RigSessionListOutput) => void;
    readonly createId?: () => string;
}

export interface RigSessionCatalogSnapshot {
    readonly catalog: RigProjectCatalog;
    readonly sessions: readonly RigSessionSummary[];
}

export interface RigSessionCatalogSource {
    read(): Promise<RigSessionCatalogSnapshot>;
    subscribe(listener: () => void, onError: (error: unknown) => void): () => void;
    [Symbol.dispose](): void;
}

/**
 * Owns the local conversation catalog grouped by project: the host's projects
 * and worktrees are read together with the flat session list, already in the
 * host's presentation order — the host owns both that arrangement and leaving
 * archived sessions out — and projected into project rows, keeping that order
 * inside each group and putting the most recently active project first. The
 * constructor opens nothing; the first subscriber triggers hydration and one
 * global-event subscription, and the last unsubscribe tears both down.
 *
 * Daemon global events are delivery hints only: receiving one schedules a
 * reconcile of the durable list rather than trusting the payload it carried, so
 * a dropped, reordered, or partial event can never leave a row that the daemon
 * does not actually have.
 */
export function rigSessionListStoreCreate(deps: RigSessionListDeps): RigSessionListStore {
    const output = deps.output ?? (() => undefined);
    const createId = deps.createId ?? defaultCreateId;

    const store = createStore<RigSessionListSnapshot>()(() => ({
        projects: { type: "loading" },
    }));

    const EMPTY_CATALOG: RigProjectCatalog = { projects: [], worktrees: [] };

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let generation = 0;
    let reconciling = false;
    let reconcileAgain = false;
    let unsubscribeGlobal: (() => void) | undefined;
    let unsubscribeMutationRejections: (() => void) | undefined;
    // Mutations issued through `connectActions` and not yet refused, newest last.
    // The bound keeps a long-lived list from remembering every mutation it ever
    // made; a refusal that arrives after this many later ones is not worth the
    // memory to attribute.
    const pendingMutationIds = new Set<string>();
    const pendingMutationOrder: string[] = [];
    // The durable rows this surface last reconciled, kept so a projection can be
    // rebuilt without refetching and so unchanged rows keep their references.
    let sessions: readonly RigSessionSummary[] = [];
    let catalog: RigProjectCatalog = EMPTY_CATALOG;
    // Callers waiting for a freshly reserved worktree to finish initializing.
    // Settled from `publish`, which every reconcile runs through, so the wait is
    // driven by the host's own catalog rather than by polling it.
    const worktreeWaiters = new Map<RigWorktreeId, (worktree: RigWorktree) => void>();

    const publish = (): void => {
        const previous = store.getState();
        const projected = rigProjectGroupsProject(catalog, sessions);
        // An unchanged project keeps its previous object — and with it the
        // identity of the worktrees and conversation rows nested inside it — so a
        // reconcile that changed one session does not replace every project row.
        const projects =
            previous.projects.type === "ready"
                ? referencesPreserve(previous.projects.value, projected)
                : projected;
        if (previous.projects.type !== "ready" || previous.projects.value !== projects)
            store.setState({ ...previous, projects: { type: "ready", value: projects } });
    };

    /** Settles anyone waiting on a worktree that has stopped initializing. */
    const worktreesSettle = (): void => {
        if (worktreeWaiters.size === 0) return;
        for (const worktree of catalog.worktrees) {
            if (worktree.status === "initializing") continue;
            const settle = worktreeWaiters.get(worktree.id);
            if (settle) {
                worktreeWaiters.delete(worktree.id);
                settle(worktree);
            }
        }
    };

    /**
     * Resolves once the host reports the worktree usable, or rejects when it
     * failed to prepare. A worktree that never settles leaves this pending; the
     * caller is a user action, so it is cancelled by disposal rather than by a
     * timeout that would report a failure the host never had.
     */
    const worktreeReady = (worktreeId: RigWorktreeId): Promise<RigWorktree> => {
        const known = catalog.worktrees.find((candidate) => candidate.id === worktreeId);
        if (known && known.status !== "initializing") return Promise.resolve(known);
        return new Promise<RigWorktree>((resolve, reject) => {
            worktreeWaiters.set(worktreeId, (worktree) => {
                if (worktree.status === "ready") resolve(worktree);
                else reject(new Error("The worktree could not be prepared."));
            });
        });
    };

    const reconcile = async (): Promise<void> => {
        if (reconciling) {
            reconcileAgain = true;
            return;
        }
        reconciling = true;
        const current = ++generation;
        try {
            // Read together so a project and the sessions filed under it are
            // never one tick apart: a session whose project the catalog does not
            // yet describe would otherwise vanish from the list for a moment.
            const snapshot = deps.catalogSource
                ? await deps.catalogSource.read()
                : await Promise.all([
                      deps.transport.projectsRead(),
                      deps.transport.sessionsRead(),
                  ]).then(([readCatalog, read]) => ({ catalog: readCatalog, sessions: read }));
            if (disposed || current !== generation) return;
            catalog = snapshot.catalog;
            sessions = snapshot.sessions;
            publish();
            worktreesSettle();
        } catch (error) {
            if (disposed || current !== generation) return;
            const previous = store.getState();
            // A failed refresh of an already loaded list keeps the rows on screen.
            if (previous.projects.type !== "ready")
                store.setState({
                    ...previous,
                    projects: { type: "error", error: rigUserError(error) },
                });
        } finally {
            reconciling = false;
            if (reconcileAgain && !disposed && active) {
                reconcileAgain = false;
                void reconcile();
            }
        }
    };

    const observer: RigEventObserver<RigGlobalEvent> = {
        event: () => {
            // Delivery hint: reconcile the durable list, never upsert the payload.
            if (!disposed && active) void reconcile();
        },
        error: () => {
            if (!disposed && active) void reconcile();
        },
        end: () => undefined,
    };

    const start = (): void => {
        active = true;
        unsubscribeGlobal = deps.catalogSource
            ? deps.catalogSource.subscribe(
                  () => {
                      if (!disposed && active) void reconcile();
                  },
                  () => {
                      if (!disposed && active) void reconcile();
                  },
              )
            : deps.transport.globalEventsSubscribe(observer);
        unsubscribeMutationRejections = deps.connectMutationSubscribe?.((rejection) => {
            // Another surface's refusal is not this list's to report, and the
            // withdrawal of the optimistic row is rig-connect's own doing: what
            // is left for this store is saying why the row went away.
            if (disposed || !pendingMutationIds.delete(rejection.mutationId)) return;
            store.setState({
                ...store.getState(),
                mutationError: rigUserError(new Error(rejection.message)),
            });
        });
        void reconcile();
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        unsubscribeGlobal?.();
        unsubscribeGlobal = undefined;
        unsubscribeMutationRejections?.();
        unsubscribeMutationRejections = undefined;
    };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };
    const storeUnsub = store.subscribe(notify);

    /**
     * Remembers a mutation issued through `connectActions` so its later refusal
     * can be told apart from one belonging to another surface, and returns its
     * id, which for a create is also the identity of what it created.
     */
    const connectMutationTrack = (mutationId: string): string => {
        pendingMutationIds.add(mutationId);
        pendingMutationOrder.push(mutationId);
        while (pendingMutationOrder.length > PENDING_MUTATION_LIMIT) {
            const expired = pendingMutationOrder.shift();
            if (expired) pendingMutationIds.delete(expired);
        }
        return mutationId;
    };

    const mutate = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
        try {
            store.setState({ ...store.getState(), mutationError: undefined });
            return await run();
        } catch (error) {
            if (!disposed) {
                store.setState({ ...store.getState(), mutationError: rigUserError(error) });
            }
            return undefined;
        }
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        sessionsRefresh: () => reconcile(),
        sessionRead(sessionId) {
            const session = sessions.find((candidate) => candidate.id === sessionId);
            if (session?.unreadReason === undefined) return;
            sessions = sessions.map((candidate) =>
                candidate.id === sessionId ? { ...candidate, unreadReason: undefined } : candidate,
            );
            publish();
            deps.connectActions?.markSessionRead(sessionId);
        },
        sessionCreate: (input) =>
            mutate(async () => {
                void createId();
                const session = await deps.transport.sessionCreate(input);
                if (disposed) return undefined;
                // A session nobody has placed yet is newest-first for the host,
                // so the optimistic row goes where the reconcile will put it.
                sessions = [
                    sessionSummaryOf(session),
                    ...sessions.filter((existing) => existing.id !== session.id),
                ];
                publish();
                const location = sessionLocationOf(session);
                output({ type: "sessionCreated", location });
                await reconcile();
                return location;
            }),
        sessionFork: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionFork(sessionId);
                if (disposed) return undefined;
                // A session nobody has placed yet is newest-first for the host,
                // so the optimistic row goes where the reconcile will put it.
                sessions = [
                    sessionSummaryOf(session),
                    ...sessions.filter((existing) => existing.id !== session.id),
                ];
                publish();
                const location = sessionLocationOf(session);
                output({ type: "sessionForked", location });
                await reconcile();
                return location;
            }),
        sessionReset: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionReset(sessionId);
                if (disposed) return;
                output({ type: "sessionReset", sessionId: session.id });
                await reconcile();
            }),
        sessionArchive: (sessionId) =>
            mutate(async () => {
                // The row leaves the list before the host confirms, because
                // closing a tab must feel immediate. A failed archive is
                // recorded in `mutationError` and the reconcile below puts the
                // row back, so the list never keeps a session the host still
                // lists.
                sessions = sessions.filter((existing) => existing.id !== sessionId);
                publish();
                try {
                    await deps.transport.sessionArchive(sessionId);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        worktreeCreate: (projectId) =>
            mutate(async () => {
                // rig-connect names the worktree itself and returns that name
                // synchronously, so the row is in the catalog — through the same
                // stream that carries the authoritative one — before the request
                // is even sent, and the id can be addressed immediately. A
                // refusal withdraws the row and arrives as a rejection rather
                // than as a thrown error, which is why it is tracked below.
                if (deps.connectActions) {
                    const worktreeId = connectMutationTrack(
                        deps.connectActions.createWorkspace({
                            // No base is named: a ref given here is taken as a
                            // deliberate choice and forked verbatim, while
                            // leaving it out has Rig fetch the remote and fork
                            // the project's trunk there. "New worktree here"
                            // means current work, not whatever commit the
                            // project folder happens to be checked out on.
                            name: "Workspace",
                            projectId,
                        }),
                    ) as RigWorktreeId;
                    return worktreeId;
                }
                const reserved = await deps.transport.worktreeCreate(projectId, {
                    idempotencyKey: createId(),
                    name: "Workspace",
                });
                if (disposed) return undefined;
                // Listed the moment it exists, before its checkout is prepared:
                // the reader asked for this worktree, so it appears and can be
                // addressed now rather than after a git checkout finishes.
                catalog = { ...catalog, worktrees: [...catalog.worktrees, reserved] };
                publish();
                return reserved.id;
            }),
        worktreeSessionStart: (worktreeId, create) =>
            mutate(async () => {
                const ready = await worktreeReady(worktreeId);
                if (disposed) return undefined;
                const session = await deps.transport.sessionCreate({
                    ...create,
                    cwd: ready.path,
                    worktreeId: ready.id,
                });
                if (disposed) return undefined;
                sessions = [
                    sessionSummaryOf(session),
                    ...sessions.filter((existing) => existing.id !== session.id),
                ];
                publish();
                const location = sessionLocationOf(session);
                output({ type: "sessionCreated", location });
                await reconcile();
                return location;
            }),
        worktreeArchive: (projectId, worktreeId) =>
            mutate(async () => {
                // The worktree leaves the list before the host confirms, because
                // archiving is a deliberate act and must feel immediate. A failure
                // is recorded and the reconcile below puts it back.
                catalog = {
                    ...catalog,
                    worktrees: catalog.worktrees.filter((entry) => entry.id !== worktreeId),
                };
                publish();
                try {
                    await deps.transport.worktreeArchive(projectId, worktreeId);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        worktreeReorder: (projectId, worktreeId, afterId) =>
            mutate(async () => {
                const peers = catalog.worktrees.filter((entry) => entry.projectId === projectId);
                if (!peers.some((entry) => entry.id === worktreeId)) return;
                const orderKey = orderKeyAfter(
                    peers.map((entry) => ({ id: entry.id, orderKey: entry.orderKey })),
                    worktreeId,
                    afterId,
                );
                catalog = {
                    ...catalog,
                    worktrees: catalog.worktrees.map((entry) =>
                        entry.id === worktreeId ? { ...entry, orderKey } : entry,
                    ),
                };
                publish();
                try {
                    await deps.transport.worktreeReorder(projectId, worktreeId, afterId);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        projectReorder: (projectId, afterId) =>
            mutate(async () => {
                if (!catalog.projects.some((project) => project.id === projectId)) return;
                const orderKey = orderKeyAfter(
                    catalog.projects.map((project) => ({
                        id: project.id,
                        orderKey: project.orderKey,
                    })),
                    projectId,
                    afterId,
                );
                catalog = {
                    ...catalog,
                    projects: catalog.projects.map((project) =>
                        project.id === projectId ? { ...project, orderKey } : project,
                    ),
                };
                publish();
                try {
                    await deps.transport.projectReorder(projectId, afterId);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        projectRename: (projectId, name) =>
            mutate(async () => {
                // The new name shows immediately: renaming is a direct
                // manipulation of a label, and a name that lags behind the
                // typing that produced it reads as the rename having failed.
                // The reconcile below is what makes the host's answer final.
                catalog = {
                    ...catalog,
                    projects: catalog.projects.map((project) =>
                        project.id === projectId ? { ...project, name } : project,
                    ),
                };
                publish();
                try {
                    await deps.transport.projectRename(projectId, name);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        worktreeRename: (projectId, worktreeId, name) =>
            mutate(async () => {
                catalog = {
                    ...catalog,
                    worktrees: catalog.worktrees.map((worktree) =>
                        worktree.id === worktreeId ? { ...worktree, name } : worktree,
                    ),
                };
                publish();
                try {
                    await deps.transport.worktreeRename(projectId, worktreeId, name);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        projectArchive: (projectId) =>
            mutate(async () => {
                // The whole folder leaves the list before the host confirms —
                // archiving is deliberate and must feel immediate — and its
                // worktrees go with it so no orphaned row is left behind. Its
                // sessions need no filtering: the projection files sessions
                // under listed projects, so they leave with it.
                catalog = {
                    projects: catalog.projects.filter((project) => project.id !== projectId),
                    worktrees: catalog.worktrees.filter(
                        (worktree) => worktree.projectId !== projectId,
                    ),
                };
                publish();
                try {
                    await deps.transport.projectArchive(projectId);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            worktreeWaiters.clear();
            stop();
            storeUnsub();
            listeners.clear();
        },
    };
}

/** The address of a session the caller just created: its group, then itself. */
function sessionLocationOf(session: RigSessionSummary): RigSessionLocation {
    return { sessionId: session.id, groupId: rigSessionGroupIdOf(session) };
}

/**
 * A retry token for the request/reconcile fallback, and nothing more. Where a
 * host adopts the client's key as the created entity's own identity, that host
 * mints it: `connectActions` names what it creates, so this never has to satisfy
 * an identity format the transport contract does not state.
 */
function defaultCreateId(): string {
    return `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Projects a full session down to the summary the list renders. */
function sessionSummaryOf(session: RigSession): RigSessionSummary {
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
