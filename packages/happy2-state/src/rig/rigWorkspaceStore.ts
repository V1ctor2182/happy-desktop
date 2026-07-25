import type { ConversationEntry } from "../conversation/conversationEntry.js";
import type { ConversationListSnapshot } from "../conversation/conversationSummary.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    composerStoreCreate,
    type ComposerCommand,
    type ComposerSnapshot,
    type ComposerStore,
} from "../modules/composer/composerState.js";
import type { RigChatHandle, RigClient } from "./rigClient.js";
import type { RigChatSnapshot, RigChatStore } from "./rigChatStore.js";
import { rigUserError } from "./rigSupport.js";
import type { RigSessionListStore } from "./rigSessionListStore.js";
import type {
    RigBackgroundProcess,
    RigFileSearchResult,
    RigGoal,
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigQueuedMessage,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionUsage,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigUserInputAnswers,
} from "./rigTypes.js";

/**
 * Commands a local composer offers behind `/`. Only ids wired to a real action
 * appear, so an offered command always does something.
 */
export const rigComposerCommands: readonly ComposerCommand[] = [
    { id: "usage", label: "/usage", description: "Token usage for the session." },
    { id: "tasks", label: "/tasks", description: "Show the session task list." },
    { id: "agents", label: "/agents", description: "Monitor delegated subagents." },
    { id: "goal", label: "/goal", description: "Show the session goal." },
    { id: "ps", label: "/ps", description: "List background terminals." },
    { id: "new", label: "/new", description: "Start a fresh session context." },
    { id: "compact", label: "/compact", description: "Compact the conversation." },
    { id: "abort", label: "/abort", description: "Stop the current run." },
    { id: "fork", label: "/fork", description: "Fork this session." },
    { id: "clear", label: "/clear", description: "Clear the visible conversation." },
];

/** Number of `@`-mention candidates a local composer asks the workspace for. */
const MENTION_LIMIT = 8;

/**
 * The selected conversation: its shared entries plus the local-only concepts a
 * cloud chat has no counterpart for (run lifecycle, queued steering, tasks and
 * subagents, background processes, usage, and the model/effort/permission
 * pickers). Loading is stated in the shared `Loadable` vocabulary.
 */
export interface RigConversationSnapshot {
    readonly conversationId: RigSessionId;
    readonly session: Loadable<RigSession>;
    readonly title?: string;
    readonly subtitle?: string;
    readonly entries: readonly ConversationEntry[];
    readonly composer: ComposerSnapshot;
    readonly running: boolean;
    readonly runStartedAt?: number;
    readonly turnElapsedMs?: number;
    readonly queuedMessages: readonly RigQueuedMessage[];
    readonly requestSubmissions: RigChatSnapshot["requestSubmissions"];
    readonly tasks: readonly RigTask[];
    readonly goal?: RigGoal;
    readonly subagents: readonly RigSubagentSummary[];
    readonly backgroundProcesses: readonly RigBackgroundProcess[];
    readonly showReasoning: boolean;
    readonly compactTurns: boolean;
    readonly usagePanelOpen: boolean;
    readonly usage?: RigSessionUsage;
    readonly usageLoading: boolean;
    readonly usageError?: string;
    readonly activityPanelOpen: boolean;
    /** Whether the session settings dialog is open. */
    readonly settingsOpen: boolean;
    readonly menus?: RigMenusSnapshot;
}

/**
 * Combined, immutable projection of the whole local workspace: the conversation
 * list plus the selected conversation. A single subscription fans out both, so a
 * React surface reads the entire workspace through one `useSyncExternalStore`
 * without joining independent stores in the view.
 */
export interface RigWorkspaceSnapshot {
    readonly list: ConversationListSnapshot;
    /** Materialization state for the selected conversation; unloaded means no selection. */
    readonly conversation: Loadable<RigConversationSnapshot>;
}

export interface RigWorkspaceStore {
    get(): RigWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;

    // List actions.
    conversationSelect(conversationId: RigSessionId): void;
    /** Retries a failed authoritative conversation-list read. */
    conversationListRetry(): void;
    /** Retries a failed acquisition for the currently selected conversation. */
    conversationRetry(): void;
    conversationCreate(input: RigSessionCreateInput): Promise<void>;
    conversationFork(conversationId: RigSessionId): Promise<void>;

    // Composer actions for the selected conversation (no draft lives in React).
    composerTextUpdate(text: string): void;
    composerFocusUpdate(focused: boolean): void;
    composerTextSubmit(): void;
    composerCommandInvoke(commandId: string): void;

    // Conversation actions (forwarded to the currently selected chat store).
    runAbort(): Promise<void>;
    answerInput(input: RigUserInputAnswers): Promise<void>;
    modelChange(input: RigModelSelection): Promise<void>;
    effortChange(effort?: RigThinkingLevel): Promise<void>;
    permissionModeChange(permissionMode: RigPermissionMode): Promise<void>;
    serviceTierChange(serviceTier?: RigServiceTier): Promise<void>;
    compact(): Promise<void>;
    rewind(messageId: string): Promise<void>;
    conversationReset(): Promise<void>;
    /** Requests termination of one background terminal in the active session (`/stop`). */
    backgroundProcessStop(processId: number): Promise<void>;
    /** Reads the active session's token/cost usage snapshot for the `/usage` panel. */
    usageGet(): Promise<RigSessionUsage>;
    usagePanelOpen(): void;
    usagePanelClose(): void;
    activityPanelToggle(): void;
    /** Opens the session settings dialog for the selected conversation. */
    settingsOpen(): void;
    /** Closes the session settings dialog for the selected conversation. */
    settingsClose(): void;
    reasoningToggle(): void;
    turnCompactToggle(): void;
    /** View-only clear of the active conversation's visible entries (TUI `/clear`). */
    viewClear(): void;

    [Symbol.dispose](): void;
}

function noSelection(): Promise<never> {
    return Promise.reject(new Error("No local conversation is selected."));
}

/**
 * Owns the join between the list selection and the active conversation for one
 * connected `RigClient`. It subscribes to the list store, and each time the
 * selection changes it acquires (ref-counted) the matching chat handle from the
 * client, materializes a composer for it, and disposes the previous pair — all
 * outside React, so the app layer never manages this lifetime in an effect.
 *
 * The composer is the shared composer store: its `textSubmitted`,
 * `shellCommandSubmitted`, `commandInvoked`, and `mentionQueryUpdated` output is
 * what drives the daemon, so no draft, mention query, or command palette state
 * lives in a React component.
 *
 * The connection/daemon health surface is deliberately not part of this store: it
 * is owned by the host (the desktop connection loader) and read separately, so
 * this framework-free product store depends only on the injected `RigClient`.
 */
export function rigWorkspaceStoreCreate(client: RigClient): RigWorkspaceStore {
    const list: RigSessionListStore = client.sessionList();

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let unsubscribeList: (() => void) | undefined;

    // Active conversation lease. `acquisitionGeneration` invalidates an
    // in-flight acquisition when the selection changes or the store stops.
    // `mentionGeneration` rejects both ABA query responses and responses for a
    // composer whose conversation lease has already been released.
    let selectedId: RigSessionId | undefined;
    let acquiringId: RigSessionId | undefined;
    let handle: RigChatHandle | undefined;
    let chatStore: RigChatStore | undefined;
    let unsubscribeChat: (() => void) | undefined;
    let composer: ComposerStore | undefined;
    let unsubscribeComposer: (() => void) | undefined;
    let acquisitionGeneration = 0;
    let mentionGeneration = 0;

    let conversation: Loadable<RigConversationSnapshot> = { type: "unloaded" };
    let snapshot: RigWorkspaceSnapshot = { list: list.get(), conversation };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };

    const conversationProject = (
        chat: RigChatSnapshot,
        draft: ComposerSnapshot,
    ): RigConversationSnapshot => {
        const session = chat.session.type === "ready" ? chat.session.value : undefined;
        return {
            conversationId: chat.sessionId,
            session: chat.session,
            ...(session?.title ? { title: session.title } : {}),
            ...(session ? { subtitle: session.displayCwd || session.cwd } : {}),
            entries: chat.entries,
            composer: draft,
            running: chat.runStatus === "running",
            ...(chat.runStartedAt !== undefined ? { runStartedAt: chat.runStartedAt } : {}),
            ...(chat.turnElapsedMs !== undefined ? { turnElapsedMs: chat.turnElapsedMs } : {}),
            queuedMessages: chat.queuedMessages,
            requestSubmissions: chat.requestSubmissions,
            tasks: chat.tasks,
            ...(chat.goal ? { goal: chat.goal } : {}),
            subagents: chat.subagents,
            backgroundProcesses: chat.backgroundProcesses,
            showReasoning: chat.showReasoning,
            compactTurns: chat.compactTurns,
            usagePanelOpen: chat.usagePanelOpen,
            ...(chat.usage ? { usage: chat.usage } : {}),
            usageLoading: chat.usageLoading,
            ...(chat.usageError !== undefined ? { usageError: chat.usageError } : {}),
            activityPanelOpen: chat.activityPanelOpen,
            settingsOpen: chat.settingsOpen,
            ...(chat.menus ? { menus: chat.menus } : {}),
        };
    };

    // Rebuilds the combined snapshot only when a component snapshot actually
    // changed, so `get()` stays referentially stable across no-op ticks.
    const recompute = (): void => {
        const listSnapshot = list.get();
        const chat = chatStore?.get();
        const draft = composer?.getState();
        if (chat && draft) {
            const next = conversationProject(chat, draft);
            if (conversation.type !== "ready" || !conversationEqual(conversation.value, next)) {
                conversation = { type: "ready", value: next };
            }
        }
        if (snapshot.list === listSnapshot && snapshot.conversation === conversation) return;
        snapshot = { list: listSnapshot, conversation };
        notify();
    };

    const releaseConversation = (): void => {
        mentionGeneration += 1;
        unsubscribeComposer?.();
        unsubscribeComposer = undefined;
        composer = undefined;
        unsubscribeChat?.();
        unsubscribeChat = undefined;
        chatStore = undefined;
        handle?.[Symbol.dispose]();
        handle = undefined;
    };

    /** Runs one composer submission and reports its outcome back to the composer. */
    const submitting = (revision: number, run: () => Promise<void>): void => {
        const target = composer;
        void run().then(
            () => target?.getState().composerInput({ type: "submissionConfirmed", revision }),
            (error: unknown) =>
                target?.getState().composerInput({
                    type: "submissionFailed",
                    revision,
                    error: rigUserError(error),
                }),
        );
    };

    const commandRun = (commandId: string): void => {
        const store = chatStore;
        if (!store) return;
        const swallow = (operation: Promise<unknown>): void => {
            void operation.catch(() => undefined);
        };
        switch (commandId) {
            case "new":
                swallow(store.sessionReset());
                return;
            case "compact":
                swallow(store.compact());
                return;
            case "abort":
                swallow(store.runAbort());
                return;
            case "clear":
                store.viewClear();
                return;
            case "usage":
                store.usagePanelOpen();
                return;
            case "tasks":
            case "agents":
            case "goal":
            case "ps":
                store.activityPanelShow();
                return;
            case "fork":
                if (selectedId) swallow(list.sessionFork(selectedId));
                return;
        }
    };

    const composerCreate = (conversationId: RigSessionId, store: RigChatStore): ComposerStore =>
        composerStoreCreate(conversationId, {
            capabilities: { shellMode: true, commands: rigComposerCommands, mentions: true },
            output: (event) => {
                switch (event.type) {
                    case "textSubmitted":
                        submitting(event.revision, () => store.messageSend(event.text));
                        return;
                    case "shellCommandSubmitted":
                        submitting(event.revision, () => store.shellRun(event.command));
                        return;
                    case "commandInvoked":
                        commandRun(event.commandId);
                        return;
                    case "mentionQueryUpdated": {
                        const requestGeneration = ++mentionGeneration;
                        const query = event.query;
                        if (query === undefined) return;
                        const target = composer;
                        void store.filesSearch(query, MENTION_LIMIT).then(
                            (files: readonly RigFileSearchResult[]) => {
                                if (
                                    requestGeneration !== mentionGeneration ||
                                    target === undefined ||
                                    composer !== target
                                )
                                    return;
                                target.getState().composerInput({
                                    type: "mentionCandidatesReconciled",
                                    query,
                                    candidates: files.map((file) => ({
                                        id: file.path,
                                        label: file.path,
                                    })),
                                });
                            },
                            () => undefined,
                        );
                        return;
                    }
                    default:
                        return;
                }
            },
        });

    const acquireConversation = (conversationId: RigSessionId): void => {
        if (disposed || !active || selectedId !== conversationId || acquiringId === conversationId)
            return;
        const current = ++acquisitionGeneration;
        acquiringId = conversationId;
        conversation = { type: "loading" };
        recompute();
        void client.chat(conversationId).then(
            (acquired) => {
                if (
                    disposed ||
                    !active ||
                    selectedId !== conversationId ||
                    current !== acquisitionGeneration
                ) {
                    acquired[Symbol.dispose]();
                    return;
                }
                acquiringId = undefined;
                handle = acquired;
                chatStore = acquired.store;
                composer = composerCreate(conversationId, acquired.store);
                unsubscribeChat = acquired.store.subscribe(recompute);
                unsubscribeComposer = composer.subscribe(recompute);
                recompute();
            },
            (error: unknown) => {
                if (
                    disposed ||
                    !active ||
                    selectedId !== conversationId ||
                    current !== acquisitionGeneration
                )
                    return;
                acquiringId = undefined;
                conversation = { type: "error", error: rigUserError(error) };
                recompute();
            },
        );
    };

    const selectConversation = (conversationId: RigSessionId | undefined): void => {
        if (conversationId === selectedId) {
            if (conversationId && conversation.type === "error")
                acquireConversation(conversationId);
            else recompute();
            return;
        }
        acquisitionGeneration += 1;
        acquiringId = undefined;
        selectedId = conversationId;
        releaseConversation();
        if (!conversationId) {
            conversation = { type: "unloaded" };
            recompute();
            return;
        }
        acquireConversation(conversationId);
    };

    const onListChange = (): void => {
        const nextSelected = list.get().selectedId as RigSessionId | undefined;
        if (nextSelected !== selectedId) {
            selectConversation(nextSelected);
            return;
        }
        recompute();
    };

    const start = (): void => {
        active = true;
        unsubscribeList = list.subscribe(onListChange);
        selectConversation(list.get().selectedId as RigSessionId | undefined);
    };

    const stop = (): void => {
        active = false;
        acquisitionGeneration += 1;
        acquiringId = undefined;
        unsubscribeList?.();
        unsubscribeList = undefined;
        releaseConversation();
        selectedId = undefined;
        conversation = { type: "unloaded" };
        snapshot = { list: list.get(), conversation };
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

        conversationSelect(conversationId) {
            const failedSelection =
                list.get().selectedId === conversationId &&
                selectedId === conversationId &&
                conversation.type === "error";
            list.sessionSelect(conversationId);
            if (failedSelection) acquireConversation(conversationId);
        },
        conversationListRetry: () => {
            void list.sessionsRefresh();
        },
        conversationRetry() {
            if (selectedId && conversation.type === "error") {
                acquireConversation(selectedId);
                return;
            }
            if (conversation.type === "ready" && conversation.value.session.type === "error")
                chatStore?.sessionRetry();
        },
        conversationCreate: (input) => list.sessionCreate(input),
        conversationFork: (conversationId) => list.sessionFork(conversationId),

        composerTextUpdate: (text) => composer?.getState().textUpdate(text),
        composerFocusUpdate: (focused) => composer?.getState().focusUpdate(focused),
        composerTextSubmit: () => composer?.getState().textSubmit(),
        composerCommandInvoke: (commandId) => composer?.getState().commandInvoke(commandId),

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
        conversationReset: () => withChat((store) => store.sessionReset()),
        backgroundProcessStop: (processId) =>
            withChat((store) => store.backgroundProcessStop(processId)),
        usageGet: () => withChat((store) => store.usageGet()),
        usagePanelOpen: () => chatStore?.usagePanelOpen(),
        usagePanelClose: () => chatStore?.usagePanelClose(),
        activityPanelToggle: () => chatStore?.activityPanelToggle(),
        settingsOpen: () => chatStore?.settingsOpen(),
        settingsClose: () => chatStore?.settingsClose(),
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

/**
 * Whether a freshly projected conversation is indistinguishable from the current
 * one, so the existing object — and every React subtree bound to it — is kept.
 */
function conversationEqual(left: RigConversationSnapshot, right: RigConversationSnapshot): boolean {
    const keys = Object.keys(left) as (keyof RigConversationSnapshot)[];
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => left[key] === right[key]);
}
