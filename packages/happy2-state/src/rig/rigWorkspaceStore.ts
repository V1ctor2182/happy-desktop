import type { ConversationEntry } from "../conversation/conversationEntry.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    composerStoreCreate,
    type ComposerCommand,
    type ComposerSnapshot,
    type ComposerStore,
} from "../modules/composer/composerState.js";
import type { RigChatHandle, RigClient } from "./rigClient.js";
import type { RigChatSnapshot, RigChatStore, RigOpenImage } from "./rigChatStore.js";
import { rigImageAttachmentRead, rigImageInputsOf } from "./rigImageAttachment.js";
import { rigPanelStoreCreate, type RigPanelStore } from "./rigPanelStore.js";
import {
    rigSessionDraftStoreCreate,
    type RigSessionDraftSnapshot,
    type RigSessionDraftStore,
} from "./rigSessionDraftStore.js";
import { rigUserError } from "./rigSupport.js";
import type {
    RigSessionListSnapshot,
    RigSessionListStore,
    RigSessionLocation,
} from "./rigSessionListStore.js";
import type {
    RigBackgroundProcess,
    RigChangedFileDocument,
    RigFileSearchResult,
    RigGitChangedFile,
    RigGoal,
    RigGroupId,
    RigImageInput,
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigProjectId,
    RigQueuedMessage,
    RigContextGauge,
    RigOpenInTarget,
    RigWorkspaceFiles,
    RigWorkspaceFileDocument,
    RigScrollPosition,
    RigSelection,
    RigServiceTier,
    RigSession,
    RigSessionCreateInput,
    RigSessionId,
    RigSessionUsage,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigUserInputAnswers,
    RigWorkingPhase,
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
    readonly ready: boolean;
    readonly session: Loadable<RigSession>;
    readonly title?: string;
    readonly subtitle?: string;
    readonly entries: readonly ConversationEntry[];
    readonly composer: ComposerSnapshot;
    readonly running: boolean;
    readonly workingPhase: RigWorkingPhase;
    readonly runStartedAt?: number;
    readonly turnElapsedMs?: number;
    readonly transcriptComplete: boolean;
    readonly loadingMore: boolean;
    readonly loadMoreError?: string;
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
    /** Room left in the context window, when the model declares one. */
    readonly contextGauge?: RigContextGauge;
    readonly activityPanelOpen: boolean;
    /** The transcript image opened full size, if any. */
    readonly openImage?: RigOpenImage;
    readonly menus?: RigMenusSnapshot;
    /**
     * Whether the model can still be changed. The daemon refuses one while a run
     * is active or work is queued behind it, so the picker says so rather than
     * letting a choice be made that the next message would fail to apply.
     */
    readonly modelLocked: boolean;
    /**
     * Where this conversation was last being read, when it has been read before.
     * Absent opens at the newest message.
     */
    readonly scrollPosition?: RigScrollPosition;
}

/** Whether a workspace tab shows the file itself or its working-tree diff. */
export type RigFileTabKind = "file" | "diff";

/** One workspace text file opened as a main-content document tab. */
export interface RigFileTabSnapshot {
    readonly id: string;
    readonly sessionId: RigSessionId;
    readonly groupId: RigGroupId;
    readonly path: string;
    /** `All files` opens the file itself; `Changed` opens its Git diff. */
    readonly kind: RigFileTabKind;
    /**
     * A single-click preview may be replaced by the next file previewed in this
     * group. Opening it permanently or editing it clears this flag.
     */
    readonly preview: boolean;
    readonly revision: string;
    readonly document: Loadable<RigWorkspaceFileDocument | RigChangedFileDocument>;
    readonly loading: boolean;
    /**
     * Unsaved edit to this file's working-tree text. Present only once it has
     * been typed in, so an untouched tab shows what was read rather than a copy
     * of it that reloading would silently discard.
     */
    readonly draft?: string;
    /** True while this tab's edit is being written back. */
    readonly saving: boolean;
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
    readonly fileTabs: readonly RigFileTabSnapshot[];
    readonly activeFileTabId?: string;
    /**
     * The composer of an addressed group that holds no conversation yet. Sending
     * into it is what starts the group's first conversation, so a project or a
     * worktree can be opened and typed into before anything exists in it.
     */
    readonly groupComposer?: ComposerSnapshot;
    /**
     * How that first conversation will be configured — model, effort, access
     * mode, tier — and the picker options behind those choices. Present only
     * once the model catalog has been read, so the composer never waits on it.
     */
    readonly groupSessionDraft?: RigSessionDraftSnapshot;
    /**
     * Applications the host can open the addressed group's directory in, read
     * once per workspace and empty until then. Empty is also the honest answer
     * on a host that offers none, and the surface shows no menu rather than an
     * empty one.
     */
    readonly openInTargets: readonly RigOpenInTarget[];
    /**
     * The application this machine opened a project in most recently, so the
     * control can offer it directly instead of making the reader find it in the
     * menu again. Undefined until something has been opened.
     */
    readonly openInRecentId?: string;
    /** The rename in progress, if any: what is being renamed and the draft name. */
    readonly rename?: RigRenameSnapshot;
    /**
     * How changed files are being read. One preference for the workspace rather
     * than one per tab: it is how this reader likes to look at diffs, and
     * having it reset on every file they open would make it not a preference.
     */
    readonly fileViewMode: RigFileViewMode;
    /** Whether the panel lists only changed files or every file in the checkout. */
    readonly fileScope: RigFileScope;
    /** Whether the panel nests paths into folders or lists them whole. */
    readonly fileLayout: RigFileLayout;
    /** Directories the reader has opened in the tree, by full path. */
    readonly fileTreeExpanded: ReadonlySet<string>;
    /**
     * Every file in the open group's checkout, once it has been asked for.
     * Absent until then, which is what "All files" is loading.
     */
    readonly workspaceFiles?: RigWorkspaceFiles;
    /** True while that listing is being read. */
    readonly workspaceFilesLoading: boolean;
    /** The create dialog, when it is open. */
    readonly create?: RigCreateSnapshot;
}

/**
 * A session being composed before it exists. Everything a first message needs —
 * where to run, how it is configured, and what to say — decided in one place
 * rather than by starting a session and then correcting it.
 */
export interface RigCreateSnapshot {
    /** The group it will start in; the last one used, until changed. */
    readonly groupId?: RigGroupId;
    /** Every project and worktree it could start in, in list order. */
    readonly groups: readonly RigCreateGroupOption[];
    /** The first message. An empty one is not a task, and cannot be submitted. */
    readonly text: string;
    /** Model, effort, access mode, tier, plus the menus behind them. */
    readonly draft?: RigSessionDraftSnapshot;
    /**
     * Whether the dialog stays open after starting a session, cleared and ready
     * for the next one. Someone filing several tasks at once should not have to
     * reopen it between them.
     */
    readonly keepOpen: boolean;
    /** True while a session is being started; the dialog stays up and inert. */
    readonly submitting: boolean;
    /** A failed start, said in the dialog rather than thrown away. */
    readonly error?: string;
}

export interface RigCreateGroupOption {
    readonly id: RigGroupId;
    readonly label: string;
    /** True for a worktree, which is listed under the project it belongs to. */
    readonly nested: boolean;
}

/** Which files the panel lists. */
export type RigFileScope = "changed" | "all";

/**
 * How the panel arranges them. Flat suits a handful of changed files, where a
 * folder per file is only indentation; tree suits a whole repository, where the
 * shape is the point.
 */
export type RigFileLayout = "tree" | "flat";

/** How a changed file is displayed. Mirrors the UI's `ChangedFileDiffMode`. */
export type RigFileViewMode = "preview" | "unified" | "split" | "edit";

/**
 * A rename the reader has opened but not committed. The draft lives here rather
 * than in the field so the surface stays a pure function of this snapshot, and
 * so an in-flight rename survives the row list being republished underneath it.
 */
export interface RigRenameSnapshot {
    readonly projectId: RigProjectId;
    /** Absent when the project itself is being renamed rather than one of its worktrees. */
    readonly worktreeId?: RigWorktreeId;
    /** What it is called now, for the dialog's title. */
    readonly currentName: string;
    readonly draft: string;
    /** True while the host is being told; the dialog stays up and inert. */
    readonly submitting: boolean;
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
    /**
     * Materializes the addressed conversation, releasing any previously open
     * one. The group comes from the URL when available so group-scoped surfaces
     * can follow navigation without deriving identity from an asynchronous
     * conversation read.
     */
    conversationOpen(conversationId: RigSessionId, groupId?: RigGroupId): void;
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
     * Archives a project, taking its conversations and its worktrees' checkouts
     * with it. The caller addresses somewhere else first when the archived
     * project holds the open conversation; this store does not navigate.
     */
    projectArchive(projectId: RigProjectId): Promise<void>;
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

    /**
     * Previews one workspace file in the main-content tab strip. A new preview
     * replaces this group's previous preview without disturbing permanent tabs.
     */
    filePreview(
        sessionId: RigSessionId,
        groupId: RigGroupId,
        path: string,
        kind: RigFileTabKind,
    ): void;
    /** Opens one workspace file permanently, promoting its preview when present. */
    fileOpen(
        sessionId: RigSessionId,
        groupId: RigGroupId,
        path: string,
        kind: RigFileTabKind,
    ): void;
    /** Selects one open file tab, or clears file selection when a session is selected. */
    fileSelect(tabId: string | undefined): void;
    fileClose(tabId: string): void;
    fileRetry(tabId: string): void;
    /** Chooses how changed files are displayed, for every tab. */
    fileViewModeUpdate(mode: RigFileViewMode): void;
    /**
     * Chooses whether the panel lists changed files or all of them. Asking for
     * all of them is what reads the checkout's listing, so it is never read for
     * a reader who only ever looks at their own changes.
     */
    fileScopeUpdate(groupId: RigGroupId, scope: RigFileScope): void;
    /** Chooses whether the panel nests paths into folders. */
    fileLayoutUpdate(layout: RigFileLayout): void;
    /** Opens or closes one directory in the tree. */
    fileTreeToggle(path: string): void;
    /** Records an unsaved edit to one file's working-tree text. */
    fileDraftUpdate(tabId: string, draft: string): void;
    /** Discards one file's unsaved edit and returns to its last loaded text. */
    fileDraftRevert(tabId: string): void;
    /** Writes one file's pending edit back to the checkout. */
    fileDraftSave(tabId: string): Promise<void>;

    // Composer actions for the open conversation (no draft lives in React).
    composerTextUpdate(text: string): void;
    composerFocusUpdate(focused: boolean): void;
    composerTextSubmit(): void;
    composerCommandInvoke(commandId: string): void;
    /**
     * Attaches picked or pasted images to the addressed draft. Reading the bytes
     * is asynchronous, so this returns immediately and each image appears in the
     * draft as it is read; a file that is not an image is ignored, since a local
     * turn can only carry images inline.
     */
    composerAttachmentsAdd(files: readonly File[]): void;
    /** Removes one attachment from the addressed draft. */
    composerAttachmentRemove(attachmentId: string): void;

    /*
     * How the next turn will be configured. Picking states an intent and sending
     * is what applies it, whether or not a session exists yet: for an addressed
     * group with nothing in it the choice configures the session the first
     * message creates, and for an open conversation it is applied to that
     * session just before the message it was chosen for. One act, one meaning,
     * either side of a session's existence.
     *
     * They are local and synchronous, so choosing is instant and cannot fail.
     */
    sessionModelUpdate(input: RigModelSelection): void;
    sessionEffortUpdate(effort?: RigThinkingLevel): void;
    sessionPermissionModeUpdate(permissionMode: RigPermissionMode): void;
    sessionServiceTierUpdate(serviceTier?: RigServiceTier): void;

    // Conversation actions (forwarded to the currently open chat store).
    runAbort(): Promise<void>;
    answerInput(input: RigUserInputAnswers): Promise<void>;
    compact(): Promise<void>;
    rewind(messageId: string): Promise<void>;
    conversationReset(): Promise<void>;
    /** Loads the next page before the active conversation's current window. */
    historyLoadMore(): void;
    /** Requests termination of one background terminal in the active session (`/stop`). */
    backgroundProcessStop(processId: number): Promise<void>;
    /** Reads the active session's token/cost usage snapshot for the `/usage` panel. */
    usageGet(): Promise<RigSessionUsage>;
    usagePanelOpen(): void;
    usagePanelClose(): void;
    activityPanelToggle(): void;
    reasoningToggle(): void;
    /** Opens one transcript image of the open conversation full size. */
    imageOpen(messageId: string, attachmentId: string): void;
    /** Closes the full-size image viewer. */
    imageClose(): void;
    /**
     * Opens one project or worktree root in a named application. The group is
     * named, not the directory: the host resolves the path from its own catalog.
     */
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;
    /**
     * Opens the create dialog, on the group last created in — or the one given,
     * when it is being opened from somewhere that already knows where.
     */
    createOpen(groupId?: RigGroupId): void;
    /** Chooses which project or worktree the session will start in. */
    createGroupUpdate(groupId: RigGroupId): void;
    /** Edits the first message. */
    createTextUpdate(text: string): void;
    /** Chooses how the session will be configured. */
    createModelUpdate(input: RigModelSelection): void;
    createEffortUpdate(effort?: RigThinkingLevel): void;
    createPermissionModeUpdate(permissionMode: RigPermissionMode): void;
    createServiceTierUpdate(serviceTier?: RigServiceTier): void;
    /** Chooses whether the dialog stays open for another task. */
    createKeepOpenUpdate(keepOpen: boolean): void;
    /** Closes the dialog, discarding what was typed. */
    createCancel(): void;
    /** Starts the session and sends the first message. */
    createSubmit(): Promise<void>;
    /** Starts renaming a project, or one of its worktrees, from its current name. */
    renameOpen(projectId: RigProjectId, worktreeId: RigWorktreeId | undefined): void;
    /** Edits the pending name. */
    renameDraftUpdate(draft: string): void;
    /** Abandons the rename. */
    renameCancel(): void;
    /** Commits the pending name; a blank one is not a rename and closes instead. */
    renameSubmit(): Promise<void>;
    /** Shows or hides one finished turn's intermediate entries in the transcript. */
    turnTraceToggle(turnId: string): void;
    /**
     * Records where one conversation is being read, so returning to it resumes
     * there rather than at the newest message. Kept for the workspace's lifetime
     * and never persisted: a reading position is worth restoring while switching
     * between sessions, not weeks later on another machine.
     */
    conversationScrollUpdate(conversationId: RigSessionId, position: RigScrollPosition): void;
    /** View-only clear of the active conversation's visible entries (TUI `/clear`). */
    viewClear(): void;

    [Symbol.dispose](): void;
}

function noOpenConversation(): Promise<never> {
    return Promise.reject(new Error("No local conversation is open."));
}

/**
 * The creation fields one selection names. Absent optionals are left out rather
 * than sent as undefined, so a create request carries only what was chosen and
 * the daemon still supplies its own default for the rest.
 */
function selectionCreateFields(selection: RigSelection): Partial<RigSessionCreateInput> {
    return {
        providerId: selection.providerId,
        modelId: selection.modelId,
        ...(selection.effort !== undefined ? { effort: selection.effort } : {}),
        ...(selection.serviceTier !== undefined ? { serviceTier: selection.serviceTier } : {}),
        permissionMode: selection.permissionMode,
    };
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
    const draftOrigin = `happy2_${Math.random().toString(36).slice(2)}`;
    let draftUpdatedAt = 0;
    const nextDraftUpdatedAt = (): number => {
        draftUpdatedAt = Math.max(Date.now(), draftUpdatedAt + 1);
        return draftUpdatedAt;
    };
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
    // Names one attached image within its draft; the daemon never sees this id.
    let attachmentSequence = 0;

    let conversation: Loadable<RigConversationSnapshot> = { type: "unloaded" };
    // An addressed group with nothing in it yet: its composer is live, and the
    // first thing sent into it is what creates the conversation.
    let openGroupId: RigGroupId | undefined;
    /* Read once, lazily, when a surface first asks. Detecting installed
       applications costs a process launch or several, and most sessions never
       open the menu. */
    let openInTargets: readonly RigOpenInTarget[] = [];
    let openInRecentId: string | undefined;
    let openInTargetsRequested = false;
    let rename: RigRenameSnapshot | undefined;
    let fileViewMode: RigFileViewMode = "unified";
    // Changed and flat by default: the panel opens on the work in progress,
    // which is short and reads better as a list than as a tree of one-file
    // folders. Asking for the whole repository is what switches both.
    let fileScope: RigFileScope = "changed";
    let fileLayout: RigFileLayout = "flat";
    let fileTreeExpanded: ReadonlySet<string> = new Set();
    let create: RigCreateSnapshot | undefined;
    let createDraft: RigSessionDraftStore | undefined;
    let unsubscribeCreateDraft: (() => void) | undefined;
    let createDraftGeneration = 0;
    /** The group the last created session started in, offered as the next default. */
    let lastCreateGroupId: RigGroupId | undefined;
    let workspaceFiles: RigWorkspaceFiles | undefined;
    let workspaceFilesLoading = false;
    let workspaceFilesGroupId: RigGroupId | undefined;
    let workspaceFilesGeneration = 0;
    let groupComposer: ComposerStore | undefined;
    let unsubscribeGroupComposer: (() => void) | undefined;
    /** How the addressed group's first session will be configured. */
    let groupDraft: RigSessionDraftStore | undefined;
    let unsubscribeGroupDraft: (() => void) | undefined;
    let groupDraftGeneration = 0;
    /**
     * Where each conversation was last being read, by conversation id. Switching
     * sessions disposes the transcript that held the position, so it is kept
     * here — outside any component's lifetime — and handed back when that
     * conversation is opened again.
     */
    let scrollPositions: ReadonlyMap<RigSessionId, RigScrollPosition> = new Map();
    let fileTabs: readonly RigFileTabSnapshot[] = [];
    let activeFileTabId: string | undefined;
    const fileLoadGenerations = new Map<string, number>();
    const fileLoadControllers = new Map<string, AbortController>();
    let snapshot: RigWorkspaceSnapshot = {
        list: list.get(),
        conversation,
        fileTabs,
        openInTargets,
        fileViewMode,
        fileScope,
        fileLayout,
        fileTreeExpanded,
        workspaceFilesLoading,
    };

    const notify = (): void => {
        for (const listener of listeners) listener();
    };

    const conversationProject = (
        chat: RigChatSnapshot,
        draft: ComposerSnapshot,
    ): RigConversationSnapshot => {
        const models = client.models.get();
        return {
            conversationId: chat.sessionId,
            ready: chat.ready,
            session: chat.session,
            ...(chat.title ? { title: chat.title } : {}),
            ...(chat.cwd ? { subtitle: chat.cwd } : {}),
            entries: chat.entries,
            composer: draft,
            running: chat.runStatus === "running",
            workingPhase: chat.workingPhase,
            ...(chat.runStartedAt !== undefined ? { runStartedAt: chat.runStartedAt } : {}),
            ...(chat.turnElapsedMs !== undefined ? { turnElapsedMs: chat.turnElapsedMs } : {}),
            transcriptComplete: chat.transcriptComplete,
            loadingMore: chat.loadingMore,
            ...(chat.loadMoreError ? { loadMoreError: chat.loadMoreError } : {}),
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
            ...(chat.contextGauge ? { contextGauge: chat.contextGauge } : {}),
            activityPanelOpen: chat.activityPanelOpen,
            ...(chat.openImage ? { openImage: chat.openImage } : {}),
            ...(chat.menus
                ? { menus: chat.menus }
                : models.type === "ready"
                  ? { menus: models.menus }
                  : {}),
            modelLocked: chat.modelLocked,
            ...(scrollPositions.has(chat.sessionId)
                ? { scrollPosition: scrollPositions.get(chat.sessionId)! }
                : {}),
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
            const models = client.models.get();
            const next = chat
                ? conversationProject(chat, draft)
                : conversationAcquiring(
                      openId,
                      draft,
                      listSnapshot,
                      models.type === "ready" ? models.menus : undefined,
                  );
            if (conversation.type !== "ready" || !conversationEqual(conversation.value, next)) {
                conversation = { type: "ready", value: next };
            }
        }
        const groupComposerDraft = groupComposer?.getState();
        const groupSessionDraft = groupDraft?.get();
        if (
            snapshot.list === listSnapshot &&
            snapshot.conversation === conversation &&
            snapshot.groupComposer === groupComposerDraft &&
            snapshot.groupSessionDraft === groupSessionDraft &&
            snapshot.fileTabs === fileTabs &&
            snapshot.activeFileTabId === activeFileTabId &&
            snapshot.openInTargets === openInTargets &&
            snapshot.openInRecentId === openInRecentId &&
            snapshot.rename === rename &&
            snapshot.fileViewMode === fileViewMode &&
            snapshot.fileScope === fileScope &&
            snapshot.fileLayout === fileLayout &&
            snapshot.fileTreeExpanded === fileTreeExpanded &&
            snapshot.workspaceFiles === workspaceFiles &&
            snapshot.workspaceFilesLoading === workspaceFilesLoading &&
            snapshot.create === create
        )
            return;
        snapshot = {
            list: listSnapshot,
            conversation,
            fileTabs,
            openInTargets,
            fileViewMode,
            fileScope,
            fileLayout,
            fileTreeExpanded,
            ...(workspaceFiles ? { workspaceFiles } : {}),
            ...(openInRecentId ? { openInRecentId } : {}),
            workspaceFilesLoading,
            ...(create ? { create } : {}),
            ...(activeFileTabId ? { activeFileTabId } : {}),
            ...(groupComposerDraft ? { groupComposer: groupComposerDraft } : {}),
            ...(groupSessionDraft ? { groupSessionDraft } : {}),
            ...(rename ? { rename } : {}),
        };
        notify();
    };

    const fileChangeFind = (groupId: RigGroupId, path: string): RigGitChangedFile | undefined => {
        const projects = list.get().projects;
        if (projects.type !== "ready") return undefined;
        for (const project of projects.value) {
            if (project.id === groupId)
                return project.changes?.find((change) => change.path === path);
            const worktree = project.worktrees.find((candidate) => candidate.id === groupId);
            if (worktree) return worktree.changes?.find((change) => change.path === path);
        }
        return undefined;
    };

    /** Stops pending work for a file tab that is being closed or replaced. */
    const fileTabRelease = (tabId: string): void => {
        fileLoadGenerations.delete(tabId);
        fileLoadControllers.get(tabId)?.abort();
        fileLoadControllers.delete(tabId);
    };

    const fileLoad = (tabId: string, revision: string): void => {
        const before = fileTabs.find((tab) => tab.id === tabId);
        if (!before) return;
        const generation = (fileLoadGenerations.get(tabId) ?? 0) + 1;
        fileLoadGenerations.set(tabId, generation);
        fileLoadControllers.get(tabId)?.abort();
        const controller = new AbortController();
        fileLoadControllers.set(tabId, controller);
        fileTabs = fileTabs.map((tab) =>
            tab.id === tabId
                ? {
                      ...tab,
                      revision,
                      loading: true,
                      ...(tab.document.type === "ready" &&
                      (before.kind === "file"
                          ? "content" in tab.document.value
                          : "oldContent" in tab.document.value)
                          ? {}
                          : { document: { type: "loading" as const } }),
                  }
                : tab,
        );
        recompute();
        const read =
            before.kind === "file"
                ? client.workspaceFileRead(before.sessionId, before.path, controller.signal)
                : client.changedFileRead(
                      before.sessionId,
                      before.groupId,
                      before.path,
                      controller.signal,
                  );
        void read.then(
            (document) => {
                if (
                    disposed ||
                    fileLoadGenerations.get(tabId) !== generation ||
                    !fileTabs.some((tab) => tab.id === tabId)
                )
                    return;
                fileLoadControllers.delete(tabId);
                fileTabs = fileTabs.map((tab) =>
                    tab.id === tabId
                        ? {
                              ...tab,
                              document: { type: "ready" as const, value: document },
                              loading: false,
                          }
                        : tab,
                );
                recompute();
            },
            (error: unknown) => {
                if (
                    disposed ||
                    fileLoadGenerations.get(tabId) !== generation ||
                    !fileTabs.some((tab) => tab.id === tabId)
                )
                    return;
                fileLoadControllers.delete(tabId);
                fileTabs = fileTabs.map((tab) =>
                    tab.id === tabId
                        ? tab.document.type === "ready"
                            ? { ...tab, loading: false }
                            : {
                                  ...tab,
                                  document: { type: "error" as const, error: rigUserError(error) },
                                  loading: false,
                              }
                        : tab,
                );
                recompute();
            },
        );
    };

    /**
     * Opens a file with preview or permanent lifetime. Each group has at most
     * one preview; permanent tabs and previews in other groups keep their place.
     */
    const fileTabOpen = (
        sessionId: RigSessionId,
        groupId: RigGroupId,
        path: string,
        kind: RigFileTabKind,
        preview: boolean,
    ): void => {
        const id = `${groupId}\u0000${path}`;
        const existing = fileTabs.find((tab) => tab.id === id);
        activeFileTabId = id;
        if (existing) {
            const change = fileChangeFind(groupId, path);
            const revision = change?.revision ?? "";
            if (existing.kind !== kind || existing.sessionId !== sessionId) {
                fileTabs = fileTabs.map((tab) =>
                    tab.id === id
                        ? {
                              ...tab,
                              sessionId,
                              kind,
                              revision,
                              preview: preview && tab.preview,
                          }
                        : tab,
                );
                fileLoad(id, revision);
                return;
            }
            if (!preview && existing.preview)
                fileTabs = fileTabs.map((tab) =>
                    tab.id === id ? { ...tab, preview: false } : tab,
                );
            if (change && change.revision !== existing.revision) fileLoad(id, change.revision);
            else recompute();
            return;
        }

        const revision = fileChangeFind(groupId, path)?.revision ?? "";
        const tab: RigFileTabSnapshot = {
            id,
            sessionId,
            groupId,
            path,
            kind,
            preview,
            revision,
            saving: false,
            document: { type: "loading" },
            loading: true,
        };
        const replacedIndex = preview
            ? fileTabs.findIndex((candidate) => candidate.groupId === groupId && candidate.preview)
            : -1;
        if (replacedIndex >= 0) {
            fileTabRelease(fileTabs[replacedIndex]!.id);
            fileTabs = fileTabs.map((candidate, index) =>
                index === replacedIndex ? tab : candidate,
            );
        } else {
            fileTabs = [...fileTabs, tab];
        }
        recompute();
        fileLoad(id, revision);
    };

    const fileTabsReconcile = (): void => {
        for (const tab of fileTabs) {
            const change = fileChangeFind(tab.groupId, tab.path);
            if (change && change.revision !== tab.revision) fileLoad(tab.id, change.revision);
        }
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

    /**
     * Runs one composer submission and reports its outcome back to the composer
     * that produced it. The target is passed in rather than read from the
     * current one: the group composer and the conversation composer both submit,
     * and the group's first message creates and opens a session, so by the time
     * it settles the composer it came from is no longer the current one.
     */
    const submitting = (
        target: ComposerStore | undefined,
        revision: number,
        run: () => Promise<void>,
    ): void => {
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

    const composerCreate = (conversationId: RigSessionId): ComposerStore => {
        const created: ComposerStore = composerStoreCreate(conversationId, {
            capabilities: { shellMode: true, commands: rigComposerCommands, mentions: true },
            output: (event) => {
                switch (event.type) {
                    case "textUpdated":
                        void withChatStore((store) =>
                            store.draftSet(event.text, nextDraftUpdatedAt(), draftOrigin),
                        ).catch(() => undefined);
                        return;
                    case "textSubmitted":
                        void withChatStore((store) =>
                            store.draftSet("", nextDraftUpdatedAt(), draftOrigin),
                        ).catch(() => undefined);
                        submitting(created, event.revision, () =>
                            withChatStore((store) =>
                                store.messageSend(event.text, rigImageInputsOf(event.attachments)),
                            ),
                        );
                        return;
                    case "shellCommandSubmitted":
                        submitting(created, event.revision, () =>
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
        return created;
    };

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
        // The transcript may fail to acquire before anything has tried to send
        // through this promise. Mark that rejection handled here while keeping
        // the rejected promise for a later submission to observe.
        void chatArrival.catch(() => undefined);
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
                const reconcileDraft = (): void => {
                    const state = acquired.store.get();
                    const currentComposer = composer;
                    if (!state.ready || !currentComposer) return;
                    const remoteUpdatedAt = state.draftUpdatedAt ?? 0;
                    const localUpdatedAt = currentComposer.getState().lastInteractionAt ?? 0;
                    if (remoteUpdatedAt < localUpdatedAt) return;
                    const remote = state.draft ?? "";
                    if (currentComposer.getState().text !== remote)
                        currentComposer
                            .getState()
                            .composerInput({ type: "textReconciled", text: remote });
                };
                reconcileDraft();
                unsubscribeChat = acquired.store.subscribe(() => {
                    reconcileDraft();
                    recompute();
                });
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
    const groupSubmit = (
        groupId: RigGroupId,
        text: string,
        images: readonly RigImageInput[],
        selection: RigSelection | undefined,
    ): Promise<void> => {
        const start = groupStartFind(groupId);
        if (!start) return Promise.reject(new Error("That group is no longer listed."));
        const create = selection
            ? { ...start.create, ...selectionCreateFields(selection) }
            : start.create;
        return (
            start.worktreeId
                ? list.worktreeSessionStart(start.worktreeId, create)
                : list.sessionCreate(create)
        ).then(async (location) => {
            if (!location) throw new Error("The conversation could not be started.");
            output({ type: "conversationOpenRequested", location });
            const acquired = await client.chat(location.sessionId);
            try {
                await acquired.store.messageSend(text, images);
            } finally {
                acquired[Symbol.dispose]();
            }
        });
    };

    /**
     * Every project and worktree a session could start in, in the order the
     * sidebar lists them, with worktrees under the project they belong to.
     */
    const createGroupsRead = (): readonly RigCreateGroupOption[] => {
        const projects = list.get().projects;
        if (projects.type !== "ready") return [];
        const options: RigCreateGroupOption[] = [];
        for (const project of projects.value) {
            options.push({ id: project.id, label: project.name, nested: false });
            for (const worktree of project.worktrees)
                options.push({ id: worktree.id, label: worktree.name, nested: true });
        }
        return options;
    };

    const createRelease = (): void => {
        unsubscribeCreateDraft?.();
        unsubscribeCreateDraft = undefined;
        createDraft = undefined;
        // Invalidates a catalog read still in flight, so its draft cannot attach
        // itself to a dialog that has since been closed.
        createDraftGeneration += 1;
    };

    /**
     * Attaches the model/effort/access draft to the open dialog from the one
     * daemon-lifetime model store.
     */
    const createDraftEnsure = (): void => {
        createRelease();
        const current = createDraftGeneration;
        void client.models.load().then(
            ({ catalog, lastUsedSelection }) => {
                if (disposed || current !== createDraftGeneration || !create) return;
                const store = rigSessionDraftStoreCreate({
                    catalog,
                    selection: lastUsedSelection,
                    modelSelect: (current, input) => client.models.modelSelect(current, input),
                });
                createDraft = store;
                unsubscribeCreateDraft = store.subscribe(() => {
                    if (!create) return;
                    client.models.selectionUsed(store.get().selection);
                    create = { ...create, draft: store.get() };
                    recompute();
                });
                create = { ...create, draft: store.get() };
                recompute();
            },
            () => undefined,
        );
    };

    const releaseGroup = (): void => {
        unsubscribeGroupComposer?.();
        unsubscribeGroupComposer = undefined;
        groupComposer = undefined;
        unsubscribeGroupDraft?.();
        unsubscribeGroupDraft = undefined;
        groupDraft = undefined;
        // Invalidates a catalog read still in flight, so its draft cannot attach
        // itself to a group that has since been left.
        groupDraftGeneration += 1;
        openGroupId = undefined;
    };

    /**
     * Materializes the addressed group's session draft from the global model
     * store, seeded from the daemon connection's most recent selection.
     */
    const groupDraftEnsure = (groupId: RigGroupId): void => {
        const current = ++groupDraftGeneration;
        void client.models.load().then(
            ({ catalog, lastUsedSelection }) => {
                if (disposed || groupDraftGeneration !== current || openGroupId !== groupId) return;
                groupDraft = rigSessionDraftStoreCreate({
                    catalog,
                    selection: lastUsedSelection,
                    modelSelect: (current, input) => client.models.modelSelect(current, input),
                });
                unsubscribeGroupDraft = groupDraft.subscribe(() => {
                    const selection = groupDraft?.get().selection;
                    if (selection) client.models.selectionUsed(selection);
                    recompute();
                });
                recompute();
            },
            () => undefined,
        );
    };

    /** Reports a newly created conversation so the router can address it. */
    const openRequest = (location: RigSessionLocation | undefined): void => {
        if (location) output({ type: "conversationOpenRequested", location });
    };

    /**
     * Reads which applications this host can open a project in, once. Detecting
     * them costs process launches, and the answer is a property of the machine
     * rather than of anything being opened, so a failure only clears the flag —
     * a host that arrives later can still be asked again.
     */
    const openInTargetsEnsure = (): void => {
        if (openInTargetsRequested) return;
        openInTargetsRequested = true;
        void client.openInTargetsRead().then(
            (result) => {
                if (disposed) return;
                openInTargets = result.targets;
                openInRecentId = openInRecentId ?? result.recentId;
                recompute();
            },
            () => {
                openInTargetsRequested = false;
            },
        );
    };

    /**
     * Reads the open group's full file listing, once per group. The listing is
     * a property of a checkout rather than of the session in it, so switching
     * sessions within a group reuses it and switching groups discards it.
     */
    const workspaceFilesEnsure = (groupId: RigGroupId): void => {
        if (workspaceFilesGroupId === groupId && (workspaceFiles || workspaceFilesLoading)) return;
        workspaceFilesGroupId = groupId;
        workspaceFiles = undefined;
        workspaceFilesLoading = true;
        const current = (workspaceFilesGeneration += 1);
        recompute();
        void client.workspaceFilesRead(groupId).then(
            (files) => {
                if (disposed || current !== workspaceFilesGeneration) return;
                workspaceFiles = files;
                workspaceFilesLoading = false;
                recompute();
            },
            () => {
                if (disposed || current !== workspaceFilesGeneration) return;
                // An unreadable checkout lists nothing. The panel says it is
                // empty, which is what the reader can act on; a failed `git
                // ls-files` is not something they can do anything about.
                workspaceFiles = { paths: [], truncated: false };
                workspaceFilesLoading = false;
                recompute();
            },
        );
    };

    const start = (): void => {
        active = true;
        unsubscribeList = list.subscribe(() => {
            fileTabsReconcile();
            recompute();
        });
        // The addressed conversation survives losing every subscriber (the URL
        // still names it), so remounting re-acquires it rather than opening
        // nothing.
        if (openId) acquireConversation(openId);
        for (const tab of fileTabs) if (tab.loading) fileLoad(tab.id, tab.revision);
        // Which applications exist is a property of the host, not of anything
        // being opened, so it is read once the workspace is actually on screen
        // rather than when it is constructed.
        openInTargetsEnsure();
        recompute();
    };

    const stop = (): void => {
        active = false;
        acquisitionGeneration += 1;
        acquiringId = undefined;
        unsubscribeList?.();
        unsubscribeList = undefined;
        for (const controller of fileLoadControllers.values()) controller.abort();
        fileLoadControllers.clear();
        for (const tab of fileTabs)
            fileLoadGenerations.set(tab.id, (fileLoadGenerations.get(tab.id) ?? 0) + 1);
        releaseGroup();
        releaseConversation();
        conversation = { type: "unloaded" };
        snapshot = {
            list: list.get(),
            conversation,
            fileTabs,
            openInTargets,
            fileViewMode,
            fileScope,
            fileLayout,
            fileTreeExpanded,
            ...(workspaceFiles ? { workspaceFiles } : {}),
            ...(openInRecentId ? { openInRecentId } : {}),
            workspaceFilesLoading,
            ...(create ? { create } : {}),
            ...(activeFileTabId ? { activeFileTabId } : {}),
        };
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

        conversationOpen: (conversationId, groupId) => {
            releaseGroup();
            if (groupId !== undefined && fileScope === "all") workspaceFilesEnsure(groupId);
            openConversation(conversationId);
        },
        groupOpen: (groupId) => {
            openConversation(undefined);
            // The file scope belongs to the whole workspace, so "All files"
            // survives navigation. Apply it to the newly addressed checkout
            // even when this group already owns the empty-session composer.
            if (fileScope === "all") workspaceFilesEnsure(groupId);
            if (openGroupId === groupId) return;
            releaseGroup();
            openGroupId = groupId;
            const created: ComposerStore = composerStoreCreate(groupId, {
                capabilities: { shellMode: false, commands: [], mentions: false },
                output: (event) => {
                    if (event.type !== "textSubmitted") return;
                    // The configuration is read now, not after the session has
                    // been created: creation navigates, which releases this
                    // group and its draft with it.
                    const selection = groupDraft?.get().selection;
                    submitting(created, event.revision, () =>
                        groupSubmit(
                            groupId,
                            event.text,
                            rigImageInputsOf(event.attachments),
                            selection,
                        ),
                    );
                },
            });
            groupComposer = created;
            unsubscribeGroupComposer = created.subscribe(recompute);
            groupDraftEnsure(groupId);
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
        // Anything the caller names wins over the connection's last selection.
        conversationCreate: (input) => {
            const models = client.models.get();
            const selection = models.type === "ready" ? models.lastUsedSelection : undefined;
            return list
                .sessionCreate(
                    selection ? { ...selectionCreateFields(selection), ...input } : input,
                )
                .then(openRequest);
        },
        conversationFork: (conversationId) => list.sessionFork(conversationId).then(openRequest),
        conversationArchive: async (conversationId) => {
            await list.sessionArchive(conversationId);
            client.chatArchive(conversationId);
        },
        conversationReorder: (conversationId, afterId) =>
            list.conversationReorder(conversationId, afterId),
        projectReorder: (projectId, afterId) => list.projectReorder(projectId, afterId),
        projectArchive: (projectId) => list.projectArchive(projectId),
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

        filePreview: (sessionId, groupId, path, kind) =>
            fileTabOpen(sessionId, groupId, path, kind, true),
        fileOpen: (sessionId, groupId, path, kind) =>
            fileTabOpen(sessionId, groupId, path, kind, false),
        fileSelect(tabId) {
            activeFileTabId =
                tabId !== undefined && fileTabs.some((tab) => tab.id === tabId) ? tabId : undefined;
            recompute();
        },
        fileClose(tabId) {
            const index = fileTabs.findIndex((tab) => tab.id === tabId);
            if (index < 0) return;
            fileTabRelease(tabId);
            fileTabs = fileTabs.filter((tab) => tab.id !== tabId);
            if (activeFileTabId === tabId)
                activeFileTabId = fileTabs[Math.min(index, fileTabs.length - 1)]?.id;
            recompute();
        },
        fileRetry(tabId) {
            const tab = fileTabs.find((candidate) => candidate.id === tabId);
            if (tab)
                fileLoad(tabId, fileChangeFind(tab.groupId, tab.path)?.revision ?? tab.revision);
        },
        fileViewModeUpdate(mode) {
            if (fileViewMode === mode) return;
            fileViewMode = mode;
            recompute();
        },
        fileScopeUpdate(groupId, scope) {
            // A whole-repository listing costs a Git invocation over a tree that
            // may be enormous, so it is read when it is first wanted rather than
            // kept current against a group nobody is listing files for.
            if (scope === "all") workspaceFilesEnsure(groupId);
            if (fileScope === scope) return;
            fileScope = scope;
            recompute();
        },
        fileLayoutUpdate(layout) {
            if (fileLayout === layout) return;
            fileLayout = layout;
            recompute();
        },
        fileTreeToggle(path) {
            const next = new Set(fileTreeExpanded);
            if (!next.delete(path)) next.add(path);
            fileTreeExpanded = next;
            recompute();
        },
        fileDraftUpdate(tabId, draft) {
            fileTabs = fileTabs.map((tab) =>
                tab.id === tabId && !tab.saving ? { ...tab, draft, preview: false } : tab,
            );
            recompute();
        },
        fileDraftRevert(tabId) {
            fileTabs = fileTabs.map((tab) =>
                tab.id === tabId && !tab.saving && tab.draft !== undefined
                    ? { ...tab, draft: undefined }
                    : tab,
            );
            recompute();
        },
        async fileDraftSave(tabId) {
            const tab = fileTabs.find((candidate) => candidate.id === tabId);
            if (!tab || tab.saving || tab.draft === undefined) return;
            const draft = tab.draft;
            fileTabs = fileTabs.map((candidate) =>
                candidate.id === tabId ? { ...candidate, saving: true } : candidate,
            );
            recompute();
            try {
                const expectedHash =
                    tab.document.type === "ready" ? (tab.document.value.hash ?? null) : null;
                await client.workspaceFileWrite(tab.sessionId, tab.path, draft, expectedHash);
                // The draft is dropped on success, not kept as the new content:
                // what the file now says is the checkout's answer, and the
                // reload below is what asks for it. Keeping the draft would
                // leave the tab showing text nothing had confirmed.
                fileTabs = fileTabs.map((candidate) =>
                    candidate.id === tabId
                        ? { ...candidate, draft: undefined, saving: false }
                        : candidate,
                );
                recompute();
                fileLoad(tabId, fileChangeFind(tab.groupId, tab.path)?.revision ?? tab.revision);
            } catch (error) {
                // The draft survives a failed write. It is the only copy of what
                // was typed, and throwing it away to report an error would cost
                // more than the error is worth.
                fileTabs = fileTabs.map((candidate) =>
                    candidate.id === tabId ? { ...candidate, saving: false } : candidate,
                );
                recompute();
                throw error;
            }
        },

        composerTextUpdate: (text) => (groupComposer ?? composer)?.getState().textUpdate(text),
        composerFocusUpdate: (focused) =>
            (groupComposer ?? composer)?.getState().focusUpdate(focused),
        composerTextSubmit: () => (groupComposer ?? composer)?.getState().textSubmit(),
        composerCommandInvoke: (commandId) => composer?.getState().commandInvoke(commandId),
        composerAttachmentsAdd(files) {
            const target = groupComposer ?? composer;
            if (!target) return;
            for (const file of files) {
                const id = `attachment:${++attachmentSequence}`;
                void rigImageAttachmentRead(id, file).then(
                    (attachment) => {
                        // The draft may have been released (or replaced by
                        // addressing elsewhere) while the bytes were read; an
                        // image never lands in a composer other than its own.
                        if (!attachment || (groupComposer ?? composer) !== target) return;
                        target.getState().attachmentAdd(attachment);
                    },
                    () => undefined,
                );
            }
        },
        composerAttachmentRemove: (attachmentId) =>
            (groupComposer ?? composer)?.getState().attachmentRemove(attachmentId),

        sessionModelUpdate(input) {
            if (groupDraft) groupDraft.modelUpdate(input);
            else chatStore?.modelUpdate(input);
        },
        sessionEffortUpdate(effort) {
            if (groupDraft) groupDraft.effortUpdate(effort);
            else chatStore?.effortUpdate(effort);
        },
        sessionPermissionModeUpdate(permissionMode) {
            if (groupDraft) groupDraft.permissionModeUpdate(permissionMode);
            else chatStore?.permissionModeUpdate(permissionMode);
        },
        sessionServiceTierUpdate(serviceTier) {
            if (groupDraft) groupDraft.serviceTierUpdate(serviceTier);
            else chatStore?.serviceTierUpdate(serviceTier);
        },

        runAbort: () => withChat((store) => store.runAbort()),
        answerInput: (input) => withChat((store) => store.answerInput(input)),
        compact: () => withChat((store) => store.compact()),
        rewind: (messageId) => withChat((store) => store.rewind(messageId)),
        conversationReset: () => withChat((store) => store.sessionReset()),
        historyLoadMore: () => chatStore?.historyLoadMore(),
        backgroundProcessStop: (processId) =>
            withChat((store) => store.backgroundProcessStop(processId)),
        usageGet: () => withChat((store) => store.usageGet()),
        usagePanelOpen: () => chatStore?.usagePanelOpen(),
        usagePanelClose: () => chatStore?.usagePanelClose(),
        activityPanelToggle: () => chatStore?.activityPanelToggle(),
        reasoningToggle: () => chatStore?.reasoningToggle(),
        imageOpen: (messageId, attachmentId) => chatStore?.imageOpen(messageId, attachmentId),
        imageClose: () => chatStore?.imageClose(),
        openIn: (groupId, targetId) => {
            // The choice is the reader's, so the control wears it immediately;
            // the host records the same thing durably for the next launch.
            if (openInRecentId !== targetId) {
                openInRecentId = targetId;
                recompute();
            }
            return client.openIn(groupId, targetId);
        },
        createOpen(groupId) {
            const groups = createGroupsRead();
            // The group last created in, then the one currently open, then
            // whatever is first: opening the dialog should not usually require
            // answering where, because usually it is where it was last time.
            const chosen =
                groupId ??
                (groups.some((group) => group.id === lastCreateGroupId)
                    ? lastCreateGroupId
                    : undefined) ??
                (groups.some((group) => group.id === openGroupId) ? openGroupId : undefined) ??
                groups[0]?.id;
            create = {
                ...(chosen ? { groupId: chosen } : {}),
                groups,
                text: "",
                keepOpen: false,
                submitting: false,
            };
            createDraftEnsure();
            recompute();
        },
        createGroupUpdate(groupId) {
            if (!create || create.submitting) return;
            create = { ...create, groupId };
            recompute();
        },
        createTextUpdate(text) {
            if (!create || create.submitting) return;
            create = { ...create, text };
            recompute();
        },
        createModelUpdate: (input) => createDraft?.modelUpdate(input),
        createEffortUpdate: (effort) => createDraft?.effortUpdate(effort),
        createPermissionModeUpdate: (mode) => createDraft?.permissionModeUpdate(mode),
        createServiceTierUpdate: (tier) => createDraft?.serviceTierUpdate(tier),
        createKeepOpenUpdate(keepOpen) {
            if (!create) return;
            create = { ...create, keepOpen };
            recompute();
        },
        createCancel() {
            if (!create) return;
            createRelease();
            create = undefined;
            recompute();
        },
        async createSubmit() {
            const pending = create;
            if (!pending || pending.submitting) return;
            const text = pending.text.trim();
            const groupId = pending.groupId;
            // A dialog with nothing to say and nowhere to run is not a session
            // waiting to be started; it is an unfinished form.
            if (text.length === 0 || groupId === undefined) return;
            create = { ...pending, submitting: true, error: undefined };
            recompute();
            try {
                await groupSubmit(groupId, text, [], createDraft?.get().selection);
                lastCreateGroupId = groupId;
                if (create?.keepOpen) {
                    // Cleared rather than reopened: the configuration and the
                    // group are what someone filing several tasks wants to keep,
                    // and only the task itself changes between them.
                    create = { ...create, text: "", submitting: false };
                } else {
                    createRelease();
                    create = undefined;
                }
            } catch (error) {
                // The dialog stays open holding what was typed. It is the only
                // copy of the task, and a session that failed to start is one
                // the reader will want to try again rather than retype.
                if (create)
                    create = {
                        ...create,
                        submitting: false,
                        error: rigUserError(error).message,
                    };
            }
            recompute();
        },
        renameOpen(projectId, worktreeId) {
            const projects = list.get().projects;
            if (projects.type !== "ready") return;
            const project = projects.value.find((candidate) => candidate.id === projectId);
            if (!project) return;
            const currentName = worktreeId
                ? project.worktrees.find((worktree) => worktree.id === worktreeId)?.name
                : project.name;
            if (currentName === undefined) return;
            // Seeded with the current name because renaming is usually editing
            // rather than replacing, and an empty field would throw away the
            // thing most renames start from.
            rename = {
                projectId,
                ...(worktreeId ? { worktreeId } : {}),
                currentName,
                draft: currentName,
                submitting: false,
            };
            recompute();
        },
        renameDraftUpdate(draft) {
            if (!rename || rename.submitting) return;
            rename = { ...rename, draft };
            recompute();
        },
        renameCancel() {
            if (!rename) return;
            rename = undefined;
            recompute();
        },
        async renameSubmit() {
            const pending = rename;
            if (!pending || pending.submitting) return;
            const name = pending.draft.trim();
            // A blank name is not a rename, and neither is the name it already
            // has; both just close, rather than making the host answer for it.
            if (name.length === 0 || name === pending.currentName) {
                rename = undefined;
                recompute();
                return;
            }
            rename = { ...pending, submitting: true };
            recompute();
            try {
                await (pending.worktreeId
                    ? list.worktreeRename(pending.projectId, pending.worktreeId, name)
                    : list.projectRename(pending.projectId, name));
            } finally {
                // Closed either way: the list store reports a failed rename by
                // reconciling the old name back, which says more than a dialog
                // stuck open over a row that already shows the answer.
                if (rename === undefined || rename.projectId === pending.projectId)
                    rename = undefined;
                recompute();
            }
        },
        turnTraceToggle: (turnId) => chatStore?.turnTraceToggle(turnId),
        conversationScrollUpdate(conversationId, position) {
            // Deliberately no `recompute()`. The transcript is the one thing
            // that already knows this position — it just reported it — and
            // feeding it back through the snapshot would re-anchor a list the
            // reader is in the middle of scrolling. It is read once, on mount.
            scrollPositions = new Map(scrollPositions).set(conversationId, position);
        },
        viewClear: () => chatStore?.viewClear(),

        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            createRelease();
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
    menus?: RigMenusSnapshot,
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
        ready: false,
        session: { type: "loading" },
        ...(summary?.title ? { title: summary.title } : {}),
        ...(summary?.subtitle ? { subtitle: summary.subtitle } : {}),
        entries: NO_ENTRIES,
        composer,
        running: false,
        workingPhase: "working",
        transcriptComplete: true,
        loadingMore: false,
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
        ...(menus ? { menus } : {}),
        modelLocked: false,
    };
}

function conversationEqual(left: RigConversationSnapshot, right: RigConversationSnapshot): boolean {
    const keys = Object.keys(left) as (keyof RigConversationSnapshot)[];
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => left[key] === right[key]);
}
