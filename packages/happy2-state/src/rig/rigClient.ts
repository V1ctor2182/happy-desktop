import type { TerminalDriverCreate } from "../modules/terminal/terminalState.js";
import type { UserError } from "../types.js";
import { rigTerminalOpen, type RigTerminalHandle } from "./rigTerminalStore.js";
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
import type {
    RigChangedFileDocument,
    RigGroupId,
    RigOpenInTarget,
    RigWorkspaceFiles,
    RigModelCatalog,
    RigSessionId,
} from "./rigTypes.js";
import { rigModelStoreCreate, type RigModelStore } from "./rigModelStore.js";

/** A reference-counted, disposable lease on one session's chat store. */
export interface RigChatHandle {
    readonly store: RigChatStore;
    [Symbol.dispose](): void;
}

export interface RigClient {
    /** One model/capability/default/last-used authority for this daemon connection. */
    readonly models: RigModelStore;
    /** Loads (once) and returns the model catalog; cached for the client's lifetime. */
    catalogRead(): Promise<RigModelCatalog>;
    /** The single session-list store; materialized on first access. */
    sessionList(): RigSessionListStore;
    /** Lists every file in a project or worktree checkout, changed or not. */
    workspaceFilesRead(groupId: RigGroupId): Promise<RigWorkspaceFiles>;
    /** Writes one changed text file back to its checkout. */
    changedFileWrite(groupId: RigGroupId, path: string, content: string): Promise<void>;
    /** Applications this host can open a project or worktree directory in. */
    openInTargetsRead(): Promise<readonly RigOpenInTarget[]>;
    /** Opens one project or worktree root in one of those applications. */
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;
    /** Reads one changed text file from a project/worktree checkout. */
    changedFileRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigChangedFileDocument>;
    /**
     * Acquires a chat store for one session. Concurrent acquisitions share one
     * store; the store is disposed (and its subscription torn down) only when the
     * last lease is released.
     */
    chat(sessionId: RigSessionId): Promise<RigChatHandle>;
    /**
     * Opens one interactive terminal in a session's working directory. Unlike a
     * chat store these are not shared or reference-counted: two terminals in the
     * same session are two separate shells, which is the whole point of being able
     * to open more than one. Disposing the handle stops the remote terminal.
     */
    terminalOpen(sessionId: RigSessionId): RigTerminalHandle;
    [Symbol.dispose](): void;
}

export interface RigClientDeps {
    readonly transport: RigTransport;
    readonly createId?: () => string;
    readonly now?: () => number;
    readonly sessionListOutput?: (event: RigSessionListOutput) => void;
    readonly chatOutput?: (sessionId: RigSessionId, event: RigChatOutput) => void;
    readonly backgroundError?: (error: UserError) => void;
    /**
     * Builds the driver behind a terminal: the app-layer machinery that owns the
     * terminal protocol client and the VT emulator. Omitting it leaves terminals
     * unavailable — they report that instead of failing silently — which is what an
     * app with no emulator to offer should do.
     */
    readonly terminalDriverCreate?: TerminalDriverCreate;
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
    const models = rigModelStoreCreate({ catalogRead: () => transport.modelsRead() });
    let sessionListStore: RigSessionListStore | undefined;
    const chats = new Map<RigSessionId, ChatBinding>();
    let disposed = false;

    return {
        models,
        catalogRead: () => models.load().then((snapshot) => snapshot.catalog),
        changedFileRead: (groupId, path, signal) =>
            transport.changedFileRead(groupId, path, signal),
        workspaceFilesRead: (groupId) => transport.workspaceFilesRead(groupId),
        changedFileWrite: (groupId, path, content) =>
            transport.changedFileWrite(groupId, path, content),
        openInTargetsRead: () => transport.openInTargetsRead(),
        openIn: (groupId, targetId) => transport.openIn(groupId, targetId),
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
                const storePromise = models.load().then(({ catalog }) => {
                    const chatDeps: RigChatDeps = {
                        transport,
                        catalog,
                        selectionUsed: (selection) => models.selectionUsed(selection),
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
        terminalOpen(sessionId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            return rigTerminalOpen(
                {
                    transport,
                    ...(deps.terminalDriverCreate
                        ? { driverCreate: deps.terminalDriverCreate }
                        : {}),
                },
                sessionId,
            );
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
