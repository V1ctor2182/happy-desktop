import type { UserError } from "../types.js";
import {
    rigChatStoreCreate,
    type RigChatDeps,
    type RigChatOutput,
    type RigChatStore,
} from "./rigChatStore.js";
import {
    rigSessionListStoreCreate,
    type RigSessionListOutput,
    type RigSessionListStore,
} from "./rigSessionListStore.js";
import type { RigTransport } from "./rigTransport.js";
import type { RigModelCatalog, RigSessionId } from "./rigTypes.js";

/** A reference-counted, disposable lease on one session's chat store. */
export interface RigChatHandle {
    readonly store: RigChatStore;
    [Symbol.dispose](): void;
}

export interface RigClient {
    /** Loads (once) and returns the model catalog; cached for the client's lifetime. */
    catalogRead(): Promise<RigModelCatalog>;
    /** The single session-list store; materialized on first access. */
    sessionList(): RigSessionListStore;
    /**
     * Acquires a chat store for one session. Concurrent acquisitions share one
     * store; the store is disposed (and its subscription torn down) only when the
     * last lease is released.
     */
    chat(sessionId: RigSessionId): Promise<RigChatHandle>;
    [Symbol.dispose](): void;
}

export interface RigClientDeps {
    readonly transport: RigTransport;
    readonly createId?: () => string;
    readonly now?: () => number;
    readonly sessionListOutput?: (event: RigSessionListOutput) => void;
    readonly chatOutput?: (sessionId: RigSessionId, event: RigChatOutput) => void;
    readonly backgroundError?: (error: UserError) => void;
}

interface ChatBinding {
    count: number;
    readonly storePromise: Promise<RigChatStore>;
    store?: RigChatStore;
}

/**
 * Composition root for a direct Rig client: it owns the injected transport, the
 * lazily loaded model catalog, the session-list store, and a reference-counted
 * factory of per-session chat stores. Intended to be constructed once by the app
 * layer. The constructor opens no transport work; catalog and stores materialize
 * on demand.
 */
export function rigClientCreate(deps: RigClientDeps): RigClient {
    const transport = deps.transport;
    let catalogPromise: Promise<RigModelCatalog> | undefined;
    let sessionListStore: RigSessionListStore | undefined;
    const chats = new Map<RigSessionId, ChatBinding>();
    let disposed = false;

    const catalogEnsure = (): Promise<RigModelCatalog> => {
        if (!catalogPromise)
            catalogPromise = transport.modelsRead().catch((error: unknown) => {
                catalogPromise = undefined;
                throw error;
            });
        return catalogPromise;
    };

    return {
        catalogRead: () => catalogEnsure(),
        sessionList() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!sessionListStore) {
                sessionListStore = rigSessionListStoreCreate({
                    transport,
                    output: deps.sessionListOutput,
                    createId: deps.createId,
                });
            }
            return sessionListStore;
        },
        async chat(sessionId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            let binding = chats.get(sessionId);
            if (!binding) {
                const storePromise = catalogEnsure().then((catalog) => {
                    const chatDeps: RigChatDeps = {
                        transport,
                        catalog,
                        createId: deps.createId,
                        now: deps.now,
                        output: deps.chatOutput
                            ? (event) => deps.chatOutput?.(sessionId, event)
                            : undefined,
                    };
                    const store = rigChatStoreCreate(sessionId, chatDeps);
                    const current = chats.get(sessionId);
                    if (current) current.store = store;
                    return store;
                });
                binding = { count: 0, storePromise };
                chats.set(sessionId, binding);
            }
            binding.count += 1;
            let store: RigChatStore;
            try {
                store = await binding.storePromise;
            } catch (error) {
                const current = chats.get(sessionId);
                if (current === binding) {
                    current.count -= 1;
                    if (current.count <= 0) chats.delete(sessionId);
                }
                throw error;
            }
            let released = false;
            return {
                store,
                [Symbol.dispose]() {
                    if (released) return;
                    released = true;
                    const current = chats.get(sessionId);
                    if (!current) return;
                    current.count -= 1;
                    if (current.count <= 0) {
                        chats.delete(sessionId);
                        current.store?.[Symbol.dispose]();
                    }
                },
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            sessionListStore?.[Symbol.dispose]();
            sessionListStore = undefined;
            for (const binding of chats.values()) binding.store?.[Symbol.dispose]();
            chats.clear();
        },
    };
}
