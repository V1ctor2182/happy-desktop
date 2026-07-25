import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigEventObserver, RigGlobalEvent, RigTransport } from "./rigTransport.js";
import type { RigSessionCreateInput, RigSessionId, RigSessionSummary } from "./rigTypes.js";

export interface RigSessionListSnapshot {
    readonly status: "loading" | "ready" | "error";
    readonly error?: UserError;
    /** Session summaries sorted chronologically, newest-created first (chat convention). */
    readonly sessions: readonly RigSessionSummary[];
    readonly selectedSessionId?: RigSessionId;
    /** Last failed create/fork/reset, surfaced without rejecting the optimistic action. */
    readonly mutationError?: UserError;
}

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
    /** Selects a session locally; emits `sessionSelected`. */
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
 * Owns the flat, chronologically ordered session catalog (no directory grouping).
 * The constructor opens nothing; the first subscriber triggers hydration and one
 * global-event subscription, and the last unsubscribe tears both down. Global
 * events are delivery hints — their carried summaries are upserted and the list
 * re-sorted; `sessionsRefresh` reconciles the full durable list.
 */
export function rigSessionListStoreCreate(deps: RigSessionListDeps): RigSessionListStore {
    const output = deps.output ?? (() => undefined);
    const createId = deps.createId ?? defaultCreateId;

    const store = createStore<RigSessionListSnapshot>()(() => ({
        status: "loading",
        sessions: [],
    }));

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let generation = 0;
    let unsubscribeGlobal: (() => void) | undefined;

    const upsert = (summary: RigSessionSummary): void => {
        const previous = store.getState();
        const next = previous.sessions.filter((session) => session.id !== summary.id);
        next.push(summary);
        store.setState({
            ...previous,
            sessions: referencesPreserve(previous.sessions, sortByCreatedAt(next)),
        });
    };

    const applyGlobal = (event: RigGlobalEvent): void => {
        const previous = store.getState();
        if (event.type === "session_created" || event.type === "session_updated") {
            upsert(event.session);
            return;
        }
        // session_title_changed: patch the existing summary title/recap in place.
        const existing = previous.sessions.find((session) => session.id === event.sessionId);
        if (!existing) return;
        upsert({ ...existing, title: event.title, recap: event.recap, status: event.status });
    };

    const reconcile = async (): Promise<void> => {
        const current = ++generation;
        try {
            const sessions = await deps.transport.sessionsRead();
            if (disposed || current !== generation) return;
            const previous = store.getState();
            store.setState({
                status: "ready",
                error: undefined,
                sessions: referencesPreserve(previous.sessions, sortByCreatedAt(sessions)),
                selectedSessionId: previous.selectedSessionId,
            });
        } catch (error) {
            if (disposed || current !== generation) return;
            const previous = store.getState();
            store.setState({
                ...previous,
                status: previous.status === "ready" ? "ready" : "error",
                error: rigUserError(error),
            });
        }
    };

    const observer: RigEventObserver<RigGlobalEvent> = {
        event: (value) => {
            if (!disposed && active) applyGlobal(value);
        },
        error: () => {
            // Reconcile on stream error: the SSE feed is only a hint.
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
            if (previous.selectedSessionId === sessionId) return;
            store.setState({ ...previous, selectedSessionId: sessionId });
            output({ type: "sessionSelected", sessionId });
        },
        sessionCreate: (input) =>
            mutate(async () => {
                void createId();
                const session = await deps.transport.sessionCreate(input);
                if (disposed) return;
                upsert(sessionSummaryOf(session));
                store.setState({ ...store.getState(), selectedSessionId: session.id });
                output({ type: "sessionCreated", sessionId: session.id });
            }),
        sessionFork: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionFork(sessionId);
                if (disposed) return;
                upsert(sessionSummaryOf(session));
                store.setState({ ...store.getState(), selectedSessionId: session.id });
                output({ type: "sessionForked", sessionId: session.id });
            }),
        sessionReset: (sessionId) =>
            mutate(async () => {
                const session = await deps.transport.sessionReset(sessionId);
                if (disposed) return;
                upsert(sessionSummaryOf(session));
                output({ type: "sessionReset", sessionId: session.id });
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
