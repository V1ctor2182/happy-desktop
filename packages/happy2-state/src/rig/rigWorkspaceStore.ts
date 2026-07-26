import type { ConversationEntry } from "../conversation/conversationEntry.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    composerStoreCreate,
    type ComposerCommand,
    type ComposerSnapshot,
    type ComposerStore,
} from "../modules/composer/composerState.js";
import type { RigChatHandle, RigClient } from "./rigClient.js";
import type { RigChatSnapshot, RigChatStore } from "./rigChatStore.js";
import { rigPanelStoreCreate, type RigPanelStore } from "./rigPanelStore.js";
import { rigUserError } from "./rigSupport.js";
import type {
    RigSessionListSnapshot,
    RigSessionListStore,
    RigSessionLocation,
} from "./rigSessionListStore.js";
import type {
    RigBackgroundProcess,
    RigFileSearchResult,
    RigGoal,
    RigGroupId,
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigProjectId,
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
    RigWorktreeId,
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
 * The open conversation: its shared entries plus the local-only concepts a
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
    /** Finished turns the reader expanded, so their trace entries stay listed. */
    readonly expandedTurnIds: ReadonlySet<string>;
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
 * list plus the open conversation. A single subscription fans out both, so a
 * React surface reads the entire workspace through one `useSyncExternalStore`
 * without joining independent stores in the view.
 */
export interface RigWorkspaceSnapshot {
    readonly list: RigSessionListSnapshot;
    /** Materialization state for the open conversation; unloaded means none is open. */
    readonly conversation: Loadable<RigConversationSnapshot>;
    /**
     * The composer of an addressed group that holds no conversation yet. Sending
     * into it is what starts the group's first conversation, so a project or a
     * worktree can be opened and typed into before anything exists in it.
     */
    readonly groupComposer?: ComposerSnapshot;
}

/**
 * What the workspace asks its owner to navigate to. The store never decides
 * which conversation is open — it reports that a conversation it just created
 * (through the compose action or `/fork`) is the one to address next, and the
 * router turns that into a URL.
 */
export type RigWorkspaceOutput =
    | {
          readonly type: "conversationOpenRequested";
          readonly location: RigSessionLocation;
      }
    /** A group to address before it holds a conversation, such as a new worktree. */
    | { readonly type: "groupOpenRequested"; readonly groupId: RigGroupId };

export interface RigWorkspaceDeps {
    readonly output?: (event: RigWorkspaceOutput) => void;
}

export interface RigWorkspaceStore {
    get(): RigWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;

    /**
     * The workspace's right-hand tool panel. It is a store of its own, not part of
     * the snapshot above, because a terminal in it repaints far faster than the
     * conversation does and must not drag the whole workspace through a render to
     * do it. The workspace keeps it pointed at the open conversation.
     */
    readonly panel: RigPanelStore;

    // Navigation-applied conversation lifetime. These are not user selection:
    // the router applies them from the addressed URL.
    /** Materializes the addressed conversation, releasing any previously open one. */
    conversationOpen(conversationId: RigSessionId): void;
    /**
     * Applies an addressed group that holds no conversation, giving it a composer
     * whose first submission starts one. Releases any open conversation, since
     * the URL now names a group rather than a conversation.
     */
    groupOpen(groupId: RigGroupId): void;
    /** Releases the open conversation; the workspace is addressing no conversation. */
    conversationClose(): void;
    /** Retries a failed authoritative conversation-list read. */
    conversationListRetry(): void;
    /** Retries a failed acquisition for the currently open conversation. */
    conversationRetry(): void;
    conversationCreate(input: RigSessionCreateInput): Promise<void>;
    conversationFork(conversationId: RigSessionId): Promise<void>;
    /**
     * Closes a conversation: it leaves the list durably without ending the
     * session. The caller addresses somewhere else first when the closed
     * conversation is the open one; this store does not navigate.
     */
    conversationArchive(conversationId: RigSessionId): Promise<void>;
    /**
     * Moves one conversation after `afterId` inside its own group, or to the
     * front of that group when null.
     */
    conversationReorder(conversationId: RigSessionId, afterId: RigSessionId | null): Promise<void>;
    /** Moves one project after `afterId`, or to the front of the list when null. */
    projectReorder(projectId: RigProjectId, afterId: RigProjectId | null): Promise<void>;
    /**
     * Adds a worktree to the project and opens a first conversation in it once
     * the host has prepared its checkout.
     */
    worktreeCreate(projectId: RigProjectId): Promise<void>;
    /** Archives a worktree, removing it and its checkout. */
    worktreeArchive(projectId: RigProjectId, worktreeId: RigWorktreeId): Promise<void>;
    /** Moves one worktree after `afterId` within its project, or to the front when null. */
    worktreeReorder(
        projectId: RigProjectId,
        worktreeId: RigWorktreeId,
        afterId: RigWorktreeId | null,
    ): Promise<void>;

    // Composer actions for the open conversation (no draft lives in React).
    composerTextUpdate(text: string): void;
    composerFocusUpdate(focused: boolean): void;
    composerTextSubmit(): void;
    composerCommandInvoke(commandId: string): void;

    // Conversation actions (forwarded to the currently open chat store).
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
    /** Opens the session settings dialog for the open conversation. */
    settingsOpen(): void;
    /** Closes the session settings dialog for the open conversation. */
    settingsClose(): void;
    reasoningToggle(): void;
    /** Shows or hides one finished turn's intermediate entries in the transcript. */
    turnTraceToggle(turnId: string): void;
    /** View-only clear of the active conversation's visible entries (TUI `/clear`). */
    viewClear(): void;

    [Symbol.dispose](): void;
}

function noOpenConversation(): Promise<never> {
    return Promise.reject(new Error("No local conversation is open."));
}

/**
 * Owns the join between the conversation list and the open conversation for one
 * connected `RigClient`. Which conversation is open is decided by the URL and
 * applied here through `conversationOpen`/`conversationClose`; each time it
 * changes this store acquires (ref-counted) the matching chat handle from the
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
export function rigWorkspaceStoreCreate(
    client: RigClient,
    deps: RigWorkspaceDeps = {},
): RigWorkspaceStore {
    const list: RigSessionListStore = client.sessionList();
    const output = deps.output ?? (() => undefined);
    const panel: RigPanelStore = rigPanelStoreCreate({
        terminalOpen: (sessionId) => client.terminalOpen(sessionId),
    });

    const listeners = new Set<() => void>();
    let active = false;
    let disposed = false;
    let unsubscribeList: (() => void) | undefined;

    // Open conversation lease. `acquisitionGeneration` invalidates an in-flight
    // acquisition when the addressed conversation changes or the store stops.
    // `mentionGeneration` rejects both ABA query responses and responses for a
    // composer whose conversation lease has already been released.
    let openId: RigSessionId | undefined;
    let acquiringId: RigSessionId | undefined;
    let handle: RigChatHandle | undefined;
    let chatStore: RigChatStore | undefined;
    let unsubscribeChat: (() => void) | undefined;
    let composer: ComposerStore | undefined;
    let unsubscribeComposer: (() => void) | undefined;
    // The chat store of the open conversation once it is acquired. Composer
    // output that lands before then waits on this rather than being dropped.
    let chatArrival: Promise<RigChatStore> | undefined;
    let acquisitionGeneration = 0;
    let mentionGeneration = 0;

    let conversation: Loadable<RigConversationSnapshot> = { type: "unloaded" };
    // An addressed group with nothing in it yet: its composer is live, and the
    // first thing sent into it is what creates the conversation.
    let openGroupId: RigGroupId | undefined;
    let groupComposer: ComposerStore | undefined;
    let unsubscribeGroupComposer: (() => void) | undefined;
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
            expandedTurnIds: chat.expandedTurnIds,
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
        // A failed acquisition stays failed until something retries it; the
        // composer must not paint over the error the reader has to act on.
        if (draft && openId && conversation.type !== "error") {
            const next = chat
                ? conversationProject(chat, draft)
                : conversationAcquiring(openId, draft, listSnapshot);
            if (conversation.type !== "ready" || !conversationEqual(conversation.value, next)) {
                conversation = { type: "ready", value: next };
            }
        }
        const groupDraft = groupComposer?.getState();
        if (
            snapshot.list === listSnapshot &&
            snapshot.conversation === conversation &&
            snapshot.groupComposer === groupDraft
        )
            return;
        snapshot = {
            list: listSnapshot,
            conversation,
            ...(groupDraft ? { groupComposer: groupDraft } : {}),
        };
        notify();
    };

    /**
     * Runs an action against the open conversation's chat store, waiting for
     * acquisition when the reader got there first. Only the composer needs this:
     * it is on screen before the handle exists.
     */
    const withChatStore = <T>(run: (store: RigChatStore) => Promise<T>): Promise<T> => {
        if (chatStore) return run(chatStore);
        return chatArrival ? chatArrival.then(run) : noOpenConversation();
    };

    const releaseConversation = (): void => {
        mentionGeneration += 1;
        unsubscribeComposer?.();
        unsubscribeComposer = undefined;
        composer = undefined;
        unsubscribeChat?.();
        unsubscribeChat = undefined;
        chatStore = undefined;
        chatArrival = undefined;
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
                if (openId) swallow(list.sessionFork(openId).then(openRequest));
                return;
        }
    };

    const composerCreate = (conversationId: RigSessionId): ComposerStore =>
        composerStoreCreate(conversationId, {
            capabilities: { shellMode: true, commands: rigComposerCommands, mentions: true },
            output: (event) => {
                switch (event.type) {
                    case "textSubmitted":
                        submitting(event.revision, () =>
                            withChatStore((store) => store.messageSend(event.text)),
                        );
                        return;
                    case "shellCommandSubmitted":
                        submitting(event.revision, () =>
                            withChatStore((store) => store.shellRun(event.command)),
                        );
                        return;
                    case "commandInvoked":
                        commandRun(event.commandId);
                        return;
                    case "mentionQueryUpdated": {
                        const requestGeneration = ++mentionGeneration;
                        const query = event.query;
                        if (query === undefined) return;
                        const target = composer;
                        void withChatStore((store) => store.filesSearch(query, MENTION_LIMIT)).then(
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

    /**
     * Acquires the chat handle behind an already visible conversation. The
     * composer exists before this runs, so nothing the reader can see waits on
     * it: only the transcript, header, and menus arrive here.
     */
    const acquireConversation = (conversationId: RigSessionId): void => {
        if (disposed || !active || openId !== conversationId || acquiringId === conversationId)
            return;
        const current = ++acquisitionGeneration;
        acquiringId = conversationId;
        // The composer is local: it is created and published in this same call
        // stack, so addressing a conversation puts a usable, focusable input on
        // screen immediately and the transcript fills in behind it. Anything
        // typed before the chat handle arrives is submitted once it does. A
        // retry after a failure starts from the same live composer.
        if (!composer) {
            composer = composerCreate(conversationId);
            unsubscribeComposer = composer.subscribe(recompute);
        }
        if (conversation.type === "error") conversation = { type: "loading" };
        recompute();
        const acquisition = client.chat(conversationId);
        // What a message typed before the handle arrives is sent through. It is
        // resolved with the store rather than the handle so a submission never
        // has to know whether acquisition is still in flight.
        chatArrival = acquisition.then((acquired) => acquired.store);
        void acquisition.then(
            (acquired) => {
                if (
                    disposed ||
                    !active ||
                    openId !== conversationId ||
                    current !== acquisitionGeneration
                ) {
                    acquired[Symbol.dispose]();
                    return;
                }
                acquiringId = undefined;
                handle = acquired;
                chatStore = acquired.store;
                unsubscribeChat = acquired.store.subscribe(recompute);
                recompute();
            },
            (error: unknown) => {
                if (
                    disposed ||
                    !active ||
                    openId !== conversationId ||
                    current !== acquisitionGeneration
                )
                    return;
                acquiringId = undefined;
                conversation = { type: "error", error: rigUserError(error) };
                recompute();
            },
        );
    };

    /** Applies the addressed conversation, releasing whichever one was open. */
    const openConversation = (conversationId: RigSessionId | undefined): void => {
        // The panel shows the addressed conversation's tabs, so it learns the new
        // address in this same call stack — before the chat handle is acquired, so
        // a terminal is never briefly attributed to the conversation just left.
        panel.conversationApply(conversationId);
        if (conversationId === openId) {
            // Re-addressing the same conversation is how a failed acquisition is
            // retried, which is what a repeated navigation to it should do.
            if (conversationId && conversation.type === "error")
                acquireConversation(conversationId);
            else recompute();
            return;
        }
        acquisitionGeneration += 1;
        acquiringId = undefined;
        openId = conversationId;
        releaseConversation();
        if (!conversationId) {
            conversation = { type: "unloaded" };
            recompute();
            return;
        }
        acquireConversation(conversationId);
    };

    /** What starting a conversation in an addressed group takes, from the list. */
    const groupStartFind = (
        groupId: RigGroupId,
    ):
        | { readonly create: RigSessionCreateInput; readonly worktreeId?: RigWorktreeId }
        | undefined => {
        const projects = list.get().projects;
        if (projects.type !== "ready") return undefined;
        for (const project of projects.value) {
            if (project.id === groupId) return { create: { cwd: project.path } };
            for (const worktree of project.worktrees)
                if (worktree.id === groupId)
                    return {
                        create: { cwd: worktree.path, worktreeId: worktree.id },
                        worktreeId: worktree.id,
                    };
        }
        return undefined;
    };

    /**
     * Starts the addressed group's first conversation and sends `text` into it.
     * A worktree may still be preparing its checkout, so that path waits for the
     * host to report it usable; a project is ready by definition. The address is
     * reported before the message is delivered, so the reader lands in the new
     * conversation while it is being sent rather than after.
     */
    const groupSubmit = (groupId: RigGroupId, text: string): Promise<void> => {
        const start = groupStartFind(groupId);
        if (!start) return Promise.reject(new Error("That group is no longer listed."));
        return (
            start.worktreeId
                ? list.worktreeSessionStart(start.worktreeId)
                : list.sessionCreate(start.create)
        ).then(async (location) => {
            if (!location) throw new Error("The conversation could not be started.");
            output({ type: "conversationOpenRequested", location });
            const acquired = await client.chat(location.sessionId);
            try {
                await acquired.store.messageSend(text);
            } finally {
                acquired[Symbol.dispose]();
            }
        });
    };

    const releaseGroup = (): void => {
        unsubscribeGroupComposer?.();
        unsubscribeGroupComposer = undefined;
        groupComposer = undefined;
        openGroupId = undefined;
    };

    /** Reports a newly created conversation so the router can address it. */
    const openRequest = (location: RigSessionLocation | undefined): void => {
        if (location) output({ type: "conversationOpenRequested", location });
    };

    const start = (): void => {
        active = true;
        unsubscribeList = list.subscribe(recompute);
        // The addressed conversation survives losing every subscriber (the URL
        // still names it), so remounting re-acquires it rather than opening
        // nothing.
        if (openId) acquireConversation(openId);
        recompute();
    };

    const stop = (): void => {
        active = false;
        acquisitionGeneration += 1;
        acquiringId = undefined;
        unsubscribeList?.();
        unsubscribeList = undefined;
        releaseGroup();
        releaseConversation();
        conversation = { type: "unloaded" };
        snapshot = { list: list.get(), conversation };
    };

    const withChat = <T>(run: (store: RigChatStore) => Promise<T>): Promise<T> =>
        chatStore ? run(chatStore) : noOpenConversation();

    return {
        get: () => snapshot,
        panel,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },

        conversationOpen: (conversationId) => {
            releaseGroup();
            openConversation(conversationId);
        },
        groupOpen: (groupId) => {
            openConversation(undefined);
            if (openGroupId === groupId) return;
            releaseGroup();
            openGroupId = groupId;
            groupComposer = composerStoreCreate(groupId, {
                capabilities: { shellMode: false, commands: [], mentions: false },
                output: (event) => {
                    if (event.type !== "textSubmitted") return;
                    submitting(event.revision, () => groupSubmit(groupId, event.text));
                },
            });
            unsubscribeGroupComposer = groupComposer.subscribe(recompute);
            recompute();
        },
        conversationClose: () => {
            releaseGroup();
            openConversation(undefined);
        },
        conversationListRetry: () => {
            void list.sessionsRefresh();
        },
        conversationRetry() {
            if (openId && conversation.type === "error") {
                acquireConversation(openId);
                return;
            }
            if (conversation.type === "ready" && conversation.value.session.type === "error")
                chatStore?.sessionRetry();
        },
        conversationCreate: (input) => list.sessionCreate(input).then(openRequest),
        conversationFork: (conversationId) => list.sessionFork(conversationId).then(openRequest),
        conversationArchive: (conversationId) => list.sessionArchive(conversationId),
        conversationReorder: (conversationId, afterId) =>
            list.conversationReorder(conversationId, afterId),
        projectReorder: (projectId, afterId) => list.projectReorder(projectId, afterId),
        async worktreeCreate(projectId) {
            const worktreeId = await list.worktreeCreate(projectId);
            if (worktreeId === undefined) return;
            // Addressed as soon as it exists, and left empty: the conversation is
            // started by the first message sent into it, so adding a worktree to
            // look around does not leave an empty session behind.
            output({ type: "groupOpenRequested", groupId: worktreeId });
        },
        worktreeArchive: (projectId, worktreeId) => list.worktreeArchive(projectId, worktreeId),
        worktreeReorder: (projectId, worktreeId, afterId) =>
            list.worktreeReorder(projectId, worktreeId, afterId),

        composerTextUpdate: (text) => (groupComposer ?? composer)?.getState().textUpdate(text),
        composerFocusUpdate: (focused) =>
            (groupComposer ?? composer)?.getState().focusUpdate(focused),
        composerTextSubmit: () => (groupComposer ?? composer)?.getState().textSubmit(),
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
        turnTraceToggle: (turnId) => chatStore?.turnTraceToggle(turnId),
        viewClear: () => chatStore?.viewClear(),

        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            // Disposing the panel stops every terminal it opened: this connection is
            // going away, and a shell nobody can reach again is an orphan.
            panel[Symbol.dispose]();
            listeners.clear();
        },
    };
}

/**
 * Whether a freshly projected conversation is indistinguishable from the current
 * one, so the existing object — and every React subtree bound to it — is kept.
 */
/* Stable empties, so an acquiring snapshot recomputed twice stays equal to
   itself and the surface is not notified for nothing. */
const NO_ENTRIES: readonly ConversationEntry[] = [];
const NO_QUEUED: readonly RigQueuedMessage[] = [];
const NO_SUBMISSIONS: RigChatSnapshot["requestSubmissions"] = [];
const NO_TASKS: readonly RigTask[] = [];
const NO_SUBAGENTS: readonly RigSubagentSummary[] = [];
const NO_PROCESSES: readonly RigBackgroundProcess[] = [];
const NO_TURNS: ReadonlySet<string> = new Set();

/**
 * The conversation as it reads between being addressed and its chat handle
 * arriving: a live composer, the header the list already knows, and a session
 * that states it is loading. It exists so addressing a conversation never
 * unmounts the input — the reader can type into the new conversation before its
 * transcript has been read.
 */
function conversationAcquiring(
    conversationId: RigSessionId,
    composer: ComposerSnapshot,
    list: RigSessionListSnapshot,
): RigConversationSnapshot {
    const summary =
        list.projects.type === "ready"
            ? list.projects.value
                  .flatMap((project) => [
                      ...project.conversations,
                      ...project.worktrees.flatMap((worktree) => worktree.conversations),
                  ])
                  .find((row) => row.id === conversationId)
            : undefined;
    return {
        conversationId,
        session: { type: "loading" },
        ...(summary?.title ? { title: summary.title } : {}),
        ...(summary?.subtitle ? { subtitle: summary.subtitle } : {}),
        entries: NO_ENTRIES,
        composer,
        running: false,
        queuedMessages: NO_QUEUED,
        requestSubmissions: NO_SUBMISSIONS,
        tasks: NO_TASKS,
        subagents: NO_SUBAGENTS,
        backgroundProcesses: NO_PROCESSES,
        showReasoning: false,
        expandedTurnIds: NO_TURNS,
        usagePanelOpen: false,
        usageLoading: false,
        activityPanelOpen: false,
        settingsOpen: false,
    };
}

function conversationEqual(left: RigConversationSnapshot, right: RigConversationSnapshot): boolean {
    const keys = Object.keys(left) as (keyof RigConversationSnapshot)[];
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => left[key] === right[key]);
}
