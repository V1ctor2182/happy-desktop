import type { TerminalDriverCreate } from "../modules/terminal/terminalState.js";
import type { UserError } from "../types.js";
import type { MutationRejectedDelta, RigConnection } from "@slopus/rig-connect";
import { rigTerminalOpen, type RigTerminalHandle } from "./rigTerminalStore.js";
import {
    rigChatStoreCreate,
    type RigChatDeps,
    type RigChatOutput,
    type RigChatStore,
    type RigChatTranscriptConnect,
} from "./rigChatStore.js";
import {
    rigSessionListStoreCreate,
    type RigSessionCatalogSource,
    type RigSessionListOutput,
    type RigSessionListStore,
} from "./rigSessionListStore.js";
import type { RigTransport } from "./rigTransport.js";
import type {
    RigChangedFileDocument,
    RigGroupId,
    RigOpenInTarget,
    RigWorkspaceFileDocument,
    RigWorkspaceFiles,
    RigModelCatalog,
    RigSessionId,
} from "./rigTypes.js";
import { rigModelStoreCreate, type RigModelStore } from "./rigModelStore.js";

/** A disposable view lease on one retained session chat store. */
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
    /** Reads one existing text file from a project/worktree checkout. */
    workspaceFileRead(
        sessionId: RigSessionId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileDocument>;
    /** Writes one existing text file back to its checkout. */
    workspaceFileWrite(
        sessionId: RigSessionId,
        path: string,
        content: string,
        expectedHash: string | null,
    ): Promise<void>;
    /** Applications this host can open a project or worktree directory in. */
    openInTargetsRead(): Promise<readonly RigOpenInTarget[]>;
    /** Opens one project or worktree root in one of those applications. */
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;
    /** Reads one changed text file from a project/worktree checkout. */
    changedFileRead(
        sessionId: RigSessionId,
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigChangedFileDocument>;
    /**
     * Acquires a retained chat store for one session. Concurrent and later
     * acquisitions share its messages and model state; releasing a view lease
     * never evicts it or stops its client-owned background synchronization.
     */
    chat(sessionId: RigSessionId): Promise<RigChatHandle>;
    /** Stops background synchronization for an archived chat without evicting its memory. */
    chatArchive(sessionId: RigSessionId): void;
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
    /** Stream-owned read authority for the project/workspace/session catalog. */
    readonly catalogSource?: RigSessionCatalogSource;
    /** Opens rig-connect's core transcript stream for one materialized chat. */
    readonly transcriptConnect?: RigChatTranscriptConnect;
    /** Shared rig-connect actions for session mutations. */
    readonly connectActions?: RigConnection;
    readonly connectMutationSubscribe?: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
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
    backgroundUnsubscribe?: () => void;
    archived: boolean;
}

/**
 * Composition root for a direct Rig client: it owns the injected transport, the
 * daemon-global model store, session list, and retained per-session chat stores.
 * Once opened, a non-archived chat stays synchronized for this client's lifetime;
 * archiving suspends its transport but leaves messages and model state in memory.
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
        changedFileRead: (sessionId, groupId, path, signal) =>
            transport.changedFileRead(sessionId, groupId, path, signal),
        workspaceFilesRead: (groupId) => transport.workspaceFilesRead(groupId),
        workspaceFileRead: (sessionId, path, signal) =>
            transport.workspaceFileRead(sessionId, path, signal),
        workspaceFileWrite: (sessionId, path, content, expectedHash) =>
            transport.workspaceFileWrite(sessionId, path, content, expectedHash),
        openInTargetsRead: () => transport.openInTargetsRead(),
        openIn: (groupId, targetId) => transport.openIn(groupId, targetId),
        sessionList() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!sessionListStore) {
                sessionListStore = rigSessionListStoreCreate({
                    transport,
                    catalogSource: deps.catalogSource,
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
                        ...(deps.transcriptConnect
                            ? { transcriptConnect: deps.transcriptConnect }
                            : {}),
                        ...(deps.connectActions ? { connectActions: deps.connectActions } : {}),
                        ...(deps.connectMutationSubscribe
                            ? { connectMutationSubscribe: deps.connectMutationSubscribe }
                            : {}),
                        selectionUsed: (selection) => models.selectionUsed(selection),
                        createId: deps.createId,
                        now: deps.now,
                        output: deps.chatOutput
                            ? (event) => deps.chatOutput?.(sessionId, event)
                            : undefined,
                    };
                    const store = rigChatStoreCreate(sessionId, chatDeps);
                    const current = chats.get(sessionId);
                    if (current) {
                        current.store = store;
                        if (!current.archived) {
                            current.backgroundUnsubscribe = store.subscribe(() => {
                                if (!store.get().archived) return;
                                current.archived = true;
                                current.backgroundUnsubscribe?.();
                                current.backgroundUnsubscribe = undefined;
                            });
                        }
                    }
                    return store;
                });
                binding = { count: 0, storePromise, archived: false };
                chats.set(sessionId, binding);
            }
            binding.count += 1;
            let store: RigChatStore;
            try {
                store = await binding.storePromise;
            } catch (error) {
                const current = chats.get(sessionId);
                if (current === binding) chats.delete(sessionId);
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
                        current.count = 0;
                        // A retained background subscriber keeps durable chat
                        // synchronization alive, but usage polling belongs only
                        // to a visible view lease.
                        current.store?.usagePanelClose();
                    }
                },
            };
        },
        chatArchive(sessionId) {
            const binding = chats.get(sessionId);
            if (!binding) return;
            binding.archived = true;
            binding.backgroundUnsubscribe?.();
            binding.backgroundUnsubscribe = undefined;
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
            deps.catalogSource?.[Symbol.dispose]();
            for (const binding of chats.values()) {
                binding.backgroundUnsubscribe?.();
                binding.store?.[Symbol.dispose]();
            }
            chats.clear();
        },
    };
}
