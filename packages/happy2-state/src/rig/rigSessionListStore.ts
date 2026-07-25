import { createStore } from "zustand/vanilla";
import type { ConversationListSnapshot } from "../conversation/conversationSummary.js";
import { rigConversationSummaryProject } from "./rigConversationProject.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigEventObserver, RigGlobalEvent, RigTransport } from "./rigTransport.js";
import type { RigSessionCreateInput, RigSessionId, RigSessionSummary } from "./rigTypes.js";

/**
 * The list surface of the local workspace, in the shared conversation
 * vocabulary: a `Loadable` of ordered rows plus the current selection. Local
 * sessions are conversations like any other; nothing here is Rig-shaped.
 */
export type RigSessionListSnapshot = ConversationListSnapshot;

export type RigSessionListOutput =
    | { readonly type: "sessionSelected"; readonly sessionId: RigSessionId }
    | { readonly type: "sessionCreated"; readonly sessionId: RigSessionId }
    | { readonly type: "sessionForked"; readonly sessionId: RigSessionId }
    | { readonly type: "sessionReset"; readonly sessionId: RigSessionId };

export interface RigSessionListStore {
    get(): RigSessionListSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Reconciles the durable list from the transport. Not a user-facing refresh
     * button: it runs on hydration and after mutations to converge on server truth.
     */
    sessionsRefresh(): Promise<void>;
    /** Selects a conversation locally; emits `sessionSelected`. */
    sessionSelect(sessionId: RigSessionId): void;
    sessionCreate(input: RigSessionCreateInput): Promise<void>;
    sessionFork(sessionId: RigSessionId): Promise<void>;
    sessionReset(sessionId: RigSessionId): Promise<void>;
    [Symbol.dispose](): void;
}

export interface RigSessionListDeps {
    readonly transport: RigTransport;
    readonly output?: (event: RigSessionListOutput) => void;
    readonly createId?: () => string;
}

function sortByCreatedAt(sessions: readonly RigSessionSummary[]): readonly RigSessionSummary[] {
    return [...sessions].sort((left, right) => right.createdAt - left.createdAt);
}

/**
 * Owns the flat, chronologically ordered local conversation catalog (no
 * directory grouping). The constructor opens nothing; the first subscriber
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
        conversations: { type: "loading" },
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

    const publish = (patch?: Partial<RigSessionListSnapshot>): void => {
        const previous = store.getState();
        const projected = sessions.map(rigConversationSummaryProject);
        const conversations =
            previous.conversations.type === "ready"
                ? referencesPreserve(previous.conversations.value, projected)
                : projected;
        const next: RigSessionListSnapshot = {
            ...previous,
            conversations: { type: "ready", value: conversations },
            ...patch,
        };
        if (
            previous.conversations.type === "ready" &&
            previous.conversations.value === conversations &&
            previous.selectedId === next.selectedId &&
            previous.mutationError === next.mutationError
        )
            return;
        store.setState(next);
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
            sessions = sortByCreatedAt(read);
            publish();
        } catch (error) {
            if (disposed || current !== generation) return;
            const previous = store.getState();
            // A failed refresh of an already loaded list keeps the rows on screen.
            if (previous.conversations.type !== "ready")
                store.setState({
                    ...previous,
                    conversations: { type: "error", error: rigUserError(error) },
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

    const mutate = async (run: () => Promise<void>): Promise<void> => {
        try {
            store.setState({ ...store.getState(), mutationError: undefined });
            await run();
        } catch (error) {
            if (!disposed) {
                store.setState({ ...store.getState(), mutationError: rigUserError(error) });
            }
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
        sessionSelect(sessionId) {
            const previous = store.getState();
            if (previous.selectedId === sessionId) return;
            store.setState({ ...previous, selectedId: sessionId });
            output({ type: "sessionSelected", sessionId });
        },
        sessionCreate: (input) =>
            mutate(async () => {
                void createId();
                const session = await deps.transport.sessionCreate(input);
                if (disposed) return;
                sessions = sortByCreatedAt([
                    ...sessions.filter((existing) => existing.id !== session.id),
                    sessionSummaryOf(session),
                ]);
                publish({ selectedId: session.id });
                output({ type: "sessionCreated", sessionId: session.id });
                await reconcile();
            }),
        sessionFork: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionFork(sessionId);
                if (disposed) return;
                sessions = sortByCreatedAt([
                    ...sessions.filter((existing) => existing.id !== session.id),
                    sessionSummaryOf(session),
                ]);
                publish({ selectedId: session.id });
                output({ type: "sessionForked", sessionId: session.id });
                await reconcile();
            }),
        sessionReset: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionReset(sessionId);
                if (disposed) return;
                output({ type: "sessionReset", sessionId: session.id });
                await reconcile();
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
