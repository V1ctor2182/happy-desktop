import { createStore } from "zustand/vanilla";
import type { Loadable } from "../conversation/loadable.js";
import type { UserError } from "../types.js";
import {
    rigFolderIdOf,
    rigSessionFoldersProject,
    type RigFolderId,
    type RigSessionFolder,
} from "./rigSessionFolderProject.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigEventObserver, RigGlobalEvent, RigTransport } from "./rigTransport.js";
import type { RigSessionCreateInput, RigSessionId, RigSessionSummary } from "./rigTypes.js";

/**
 * The list surface of the local workspace: a `Loadable` of working directories,
 * each carrying its sessions as ordinary conversation rows. Local sessions are
 * conversations like any other; nothing here is Rig-shaped, and nothing here is
 * selected — the open directory and conversation are addressed by the URL.
 */
export interface RigSessionListSnapshot {
    readonly folders: Loadable<readonly RigSessionFolder[]>;
    /** Last failed create/fork/reset, surfaced without rejecting the action. */
    readonly mutationError?: UserError;
}

/**
 * Where a session lives: both halves of its address, since a local session is
 * addressed by its directory and then by itself.
 */
export interface RigSessionLocation {
    readonly sessionId: RigSessionId;
    readonly folderId: RigFolderId;
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
    /**
     * Rearranges one directory's sessions into the given order, which must name
     * exactly that directory's currently listed sessions. The rows move at once
     * and the arrangement is recorded durably by the host; a failure is recorded
     * in `mutationError` and the following reconcile restores the host's order.
     */
    folderReorder(folderId: RigFolderId, sessionIds: readonly RigSessionId[]): Promise<void>;
    [Symbol.dispose](): void;
}

export interface RigSessionListDeps {
    readonly transport: RigTransport;
    readonly output?: (event: RigSessionListOutput) => void;
    readonly createId?: () => string;
}

/**
 * Owns the local conversation catalog grouped by working directory: sessions
 * are read as one flat list already in the host's presentation order — the host
 * owns both that arrangement and leaving archived sessions out — and projected
 * into directory rows, keeping that order inside each directory and putting the
 * most recently active directory first. The constructor opens
 * nothing; the first subscriber
 * triggers hydration and one global-event subscription, and the last
 * unsubscribe tears both down.
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
        folders: { type: "loading" },
    }));

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let generation = 0;
    let reconciling = false;
    let reconcileAgain = false;
    let unsubscribeGlobal: (() => void) | undefined;
    // The durable rows this surface last reconciled, kept so a projection can be
    // rebuilt without refetching and so unchanged rows keep their references.
    let sessions: readonly RigSessionSummary[] = [];

    const publish = (): void => {
        const previous = store.getState();
        const projected = rigSessionFoldersProject(sessions);
        // An unchanged directory keeps its previous object — and with it the
        // identity of the conversation rows nested inside it — so a reconcile
        // that changed one session does not replace every folder row.
        const folders =
            previous.folders.type === "ready"
                ? referencesPreserve(previous.folders.value, projected)
                : projected;
        if (previous.folders.type === "ready" && previous.folders.value === folders) return;
        store.setState({ ...previous, folders: { type: "ready", value: folders } });
    };

    const reconcile = async (): Promise<void> => {
        if (reconciling) {
            reconcileAgain = true;
            return;
        }
        reconciling = true;
        const current = ++generation;
        try {
            const read = await deps.transport.sessionsRead();
            if (disposed || current !== generation) return;
            sessions = read;
            publish();
        } catch (error) {
            if (disposed || current !== generation) return;
            const previous = store.getState();
            // A failed refresh of an already loaded list keeps the rows on screen.
            if (previous.folders.type !== "ready")
                store.setState({
                    ...previous,
                    folders: { type: "error", error: rigUserError(error) },
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
        unsubscribeGlobal = deps.transport.globalEventsSubscribe(observer);
        void reconcile();
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        unsubscribeGlobal?.();
        unsubscribeGlobal = undefined;
    };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };
    const storeUnsub = store.subscribe(notify);

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
        folderReorder: (folderId, sessionIds) =>
            mutate(async () => {
                const folder = sessions.find(
                    (session) => rigFolderIdOf(session.cwd) === folderId,
                )?.cwd;
                if (folder === undefined) return;
                const ranked = new Map(sessionIds.map((id, index) => [id, index]));
                // Only the addressed directory moves; every other one keeps the
                // relative order the host listed it in.
                const reordered = [...sessions];
                const positions = reordered.flatMap((session, index) =>
                    session.cwd === folder ? [index] : [],
                );
                const arranged = positions
                    .map((index) => reordered[index]!)
                    .sort(
                        (left, right) =>
                            (ranked.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                            (ranked.get(right.id) ?? Number.MAX_SAFE_INTEGER),
                    );
                positions.forEach((index, slot) => {
                    reordered[index] = arranged[slot]!;
                });
                sessions = reordered;
                publish();
                try {
                    await deps.transport.sessionsReorder(folder, sessionIds);
                } finally {
                    if (!disposed) await reconcile();
                }
            }),
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            storeUnsub();
            listeners.clear();
        },
    };
}

/** The address of a session the caller just created: its directory, then itself. */
function sessionLocationOf(session: {
    readonly id: RigSessionId;
    readonly cwd: string;
}): RigSessionLocation {
    return { sessionId: session.id, folderId: rigFolderIdOf(session.cwd) };
}

function defaultCreateId(): string {
    return `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Projects a full session down to the summary the list renders. */
function sessionSummaryOf(session: {
    readonly id: RigSessionId;
    readonly cwd: string;
    readonly displayCwd: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly permissionMode: RigSessionSummary["permissionMode"];
    readonly effort?: RigSessionSummary["effort"];
    readonly serviceTier?: RigSessionSummary["serviceTier"];
    readonly status: RigSessionSummary["status"];
    readonly title?: string;
    readonly recap?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}): RigSessionSummary {
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
