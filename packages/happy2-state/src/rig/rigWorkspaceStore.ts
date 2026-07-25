import type { RigChatHandle, RigClient } from "./rigClient.js";
import type { RigChatSnapshot, RigChatStore } from "./rigChatStore.js";
import type { RigSessionListSnapshot, RigSessionListStore } from "./rigSessionListStore.js";
import type {
    RigFileSearchResult,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionUsage,
    RigThinkingLevel,
    RigUserInputAnswers,
} from "./rigTypes.js";

/**
 * Combined, immutable projection of the whole Rig workspace: the session list plus
 * the selected session's chat snapshot. A single subscription fans out both, so a
 * React surface can read the entire workspace through one `useSyncExternalStore`
 * without joining independent stores in the view.
 */
export interface RigWorkspaceSnapshot {
    readonly sessionList: RigSessionListSnapshot;
    /** The selected session's chat snapshot, or undefined when none is selected/materializing. */
    readonly chat?: RigChatSnapshot;
}

export interface RigWorkspaceStore {
    get(): RigWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;

    // Session-list actions (delegate to the list store).
    sessionSelect(sessionId: RigSessionId): void;
    sessionCreate(input: RigSessionCreateInput): Promise<void>;
    sessionFork(sessionId: RigSessionId): Promise<void>;

    // Chat actions (forwarded to the currently selected chat store).
    messageSend(text: string): Promise<void>;
    runAbort(): Promise<void>;
    answerInput(input: RigUserInputAnswers): Promise<void>;
    modelChange(input: RigModelSelection): Promise<void>;
    effortChange(effort?: RigThinkingLevel): Promise<void>;
    permissionModeChange(permissionMode: RigPermissionMode): Promise<void>;
    serviceTierChange(serviceTier?: RigServiceTier): Promise<void>;
    compact(): Promise<void>;
    rewind(messageId: string): Promise<void>;
    sessionReset(): Promise<void>;
    /** Runs a shell-mode command in the active session's workspace (`!cmd`). */
    shellRun(command: string): Promise<void>;
    /** Requests termination of one background terminal in the active session (`/stop`). */
    backgroundProcessStop(processId: number): Promise<void>;
    /** Searches the active session's workspace for `@`-mention candidates. */
    filesSearch(query: string, limit?: number): Promise<readonly RigFileSearchResult[]>;
    /** Reads the active session's token/cost usage snapshot for the `/usage` panel. */
    usageGet(): Promise<RigSessionUsage>;
    /** Opens the `/usage` panel for the active session and starts polling it. */
    usagePanelOpen(): void;
    /** Closes the `/usage` panel and stops polling. */
    usagePanelClose(): void;
    /** Toggles the activity panel (goal + tasks + subagents) for the active session. */
    activityPanelToggle(): void;
    /** Idempotently opens the activity panel (for `/tasks`, `/agents`, `/goal`). */
    activityPanelShow(): void;
    reasoningToggle(): void;
    turnCompactToggle(): void;
    /** View-only clear of the active session's visible transcript (TUI `/clear`). */
    viewClear(): void;

    [Symbol.dispose](): void;
}

function noSelection(): Promise<never> {
    return Promise.reject(new Error("No Rig session is selected."));
}

/**
 * Owns the join between the session-list selection and the active per-session chat
 * store for one connected `RigClient`. It subscribes to the list store, and each
 * time the selected session changes it acquires (ref-counted) the matching chat
 * handle from the client and disposes the previous one — all outside React, so the
 * app layer never manages this lifetime in an effect. It re-exposes a single
 * combined snapshot that changes only when the underlying list or chat snapshot
 * changes, giving `useSyncExternalStore` a stable reference between no-op updates.
 *
 * The connection/daemon health surface is deliberately not part of this store: it
 * is owned by the host (the desktop connection loader) and read separately, so
 * this framework-free product store depends only on the injected `RigClient`.
 */
export function rigWorkspaceStoreCreate(client: RigClient): RigWorkspaceStore {
    const sessionList: RigSessionListStore = client.sessionList();

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let unsubscribeList: (() => void) | undefined;

    // Active chat lease. `generation` invalidates an in-flight async acquisition
    // when the selection changes again or the store stops before it resolves.
    let selectedId: RigSessionId | undefined;
    let handle: RigChatHandle | undefined;
    let chatStore: RigChatStore | undefined;
    let unsubscribeChat: (() => void) | undefined;
    let generation = 0;

    let snapshot: RigWorkspaceSnapshot = { sessionList: sessionList.get() };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };

    // Rebuilds the combined snapshot only when a component snapshot reference
    // actually changed, so `get()` stays referentially stable across no-op ticks.
    const recompute = (): void => {
        const listSnap = sessionList.get();
        const chatSnap = chatStore?.get();
        if (snapshot.sessionList === listSnap && snapshot.chat === chatSnap) return;
        snapshot = { sessionList: listSnap, chat: chatSnap };
        notify();
    };

    const releaseChat = (): void => {
        unsubscribeChat?.();
        unsubscribeChat = undefined;
        chatStore = undefined;
        handle?.[Symbol.dispose]();
        handle = undefined;
    };

    const selectChat = (sessionId: RigSessionId | undefined): void => {
        selectedId = sessionId;
        releaseChat();
        const current = ++generation;
        if (!sessionId) {
            recompute();
            return;
        }
        void client.chat(sessionId).then(
            (acquired) => {
                if (disposed || !active || current !== generation) {
                    acquired[Symbol.dispose]();
                    return;
                }
                handle = acquired;
                chatStore = acquired.store;
                unsubscribeChat = acquired.store.subscribe(recompute);
                recompute();
            },
            () => {
                // A failed chat acquisition leaves the surface without a chat
                // snapshot; the list remains usable and reselection can retry.
                if (!disposed && current === generation) recompute();
            },
        );
        recompute();
    };

    const onListChange = (): void => {
        const nextSelected = sessionList.get().selectedSessionId;
        if (nextSelected !== selectedId) {
            selectChat(nextSelected);
            return;
        }
        recompute();
    };

    const start = (): void => {
        active = true;
        unsubscribeList = sessionList.subscribe(onListChange);
        selectChat(sessionList.get().selectedSessionId);
    };

    const stop = (): void => {
        active = false;
        generation += 1;
        unsubscribeList?.();
        unsubscribeList = undefined;
        releaseChat();
        selectedId = undefined;
    };

    const withChat = <T>(run: (store: RigChatStore) => Promise<T>): Promise<T> =>
        chatStore ? run(chatStore) : noSelection();

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },

        sessionSelect: (sessionId) => sessionList.sessionSelect(sessionId),
        sessionCreate: (input) => sessionList.sessionCreate(input),
        sessionFork: (sessionId) => sessionList.sessionFork(sessionId),

        messageSend: (text) => withChat((store) => store.messageSend(text)),
        runAbort: () => withChat((store) => store.runAbort()),
        answerInput: (input) => withChat((store) => store.answerInput(input)),
        modelChange: (input) => withChat((store) => store.modelChange(input)),
        effortChange: (effort) => withChat((store) => store.effortChange(effort)),
        permissionModeChange: (permissionMode) =>
            withChat((store) => store.permissionModeChange(permissionMode)),
        serviceTierChange: (serviceTier) =>
            withChat((store) => store.serviceTierChange(serviceTier)),
        compact: () => withChat((store) => store.compact()),
        rewind: (messageId) => withChat((store) => store.rewind(messageId)),
        sessionReset: () => withChat((store) => store.sessionReset()),
        shellRun: (command) => withChat((store) => store.shellRun(command)),
        backgroundProcessStop: (processId) =>
            withChat((store) => store.backgroundProcessStop(processId)),
        filesSearch: (query, limit) => withChat((store) => store.filesSearch(query, limit)),
        usageGet: () => withChat((store) => store.usageGet()),
        usagePanelOpen: () => chatStore?.usagePanelOpen(),
        usagePanelClose: () => chatStore?.usagePanelClose(),
        activityPanelToggle: () => chatStore?.activityPanelToggle(),
        activityPanelShow: () => chatStore?.activityPanelShow(),
        reasoningToggle: () => chatStore?.reasoningToggle(),
        turnCompactToggle: () => chatStore?.turnCompactToggle(),
        viewClear: () => chatStore?.viewClear(),

        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}
