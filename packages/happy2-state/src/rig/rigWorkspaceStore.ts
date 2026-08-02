import type { ConversationEntry } from "../conversation/conversationEntry.js";
import type { Loadable } from "../conversation/loadable.js";
import {
    composerStoreCreate,
    type ComposerAttachment,
    type ComposerCommand,
    type ComposerSnapshot,
    type ComposerStore,
} from "../modules/composer/composerState.js";
import type { RigChatHandle, RigClient } from "./rigClient.js";
import type {
    RigChatSnapshot,
    RigChatStore,
    RigOpenImage,
    RigWorkingWait,
} from "./rigChatStore.js";
import {
    rigAttachmentTextAppend,
    rigComposerAttachmentRead,
    rigImageInputsOf,
} from "./rigComposerAttachment.js";
import { rigPanelStoreCreate, type RigPanelStore } from "./rigPanelStore.js";
import {
    rigSessionDraftStoreCreate,
    type RigSessionDraftSnapshot,
    type RigSessionDraftStore,
} from "./rigSessionDraftStore.js";
import { rigUserError } from "./rigSupport.js";
import { orderKeyAfter } from "../utils/orderKeyAfter.js";
import { orderKeySequence } from "../utils/orderKeySequence.js";
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
    RigWorkspaceFileBytes,
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
 * How far back one group's tab history is kept. It exists to answer "what was
 * behind the tab I just closed", which a few dozen entries answer completely.
 */
const TAB_HISTORY_LIMIT = 50;

/** One open file's tab id: the file itself, inside the group it was opened from. */
function fileTabIdOf(groupId: RigGroupId, path: string): string {
    return `${groupId}\u0000${path}`;
}

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
    /** Display-ready activity text from the agent, when it describes its work. */
    readonly workingLabel?: string;
    /** The scheduled wait the agent is inside, so a surface can count it down. */
    readonly workingWait?: RigWorkingWait;
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

/**
 * What a workspace tab shows: the file's text, its working-tree diff, or the
 * file itself rendered. `media` is what a picture, a video, or anything else
 * with no useful text opens as — its bytes reach the viewer whole rather than
 * being refused by a read that only knows how to return a string. `document` is
 * a file that is both: an HTML page is text one edits and a page one looks at,
 * so such a tab carries the file's text and an address the page loads from.
 */
export type RigFileTabKind = "file" | "diff" | "media" | "document";

/** One workspace text file opened as a main-content document tab. */
export interface RigFileTabSnapshot {
    readonly id: string;
    /**
     * The project or worktree the file lives in. That is the whole of its
     * address: a file belongs to a checkout, not to whichever conversation was
     * open when it was clicked, so a tab outlives every session in its group.
     */
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
    readonly document: Loadable<
        RigWorkspaceFileDocument | RigChangedFileDocument | RigWorkspaceFileBytes
    >;
    readonly loading: boolean;
    /**
     * Unsaved edit to this file's working-tree text. Present only once it has
     * been typed in, so an untouched tab shows what was read rather than a copy
     * of it that reloading would silently discard.
     */
    readonly draft?: string;
    /** True while this tab's edit is being written back. */
    readonly saving: boolean;
    /**
     * Where this file is served as a page, for a `document` tab whose address
     * has been resolved. Absent for every other kind, and until the host has
     * answered — a page has nowhere to load from until then.
     */
    readonly previewUrl?: string;
}

/**
 * How the panel's file viewer reads one file: `text` for a document it shows as
 * characters, `media` for one whose bytes are fetched over a URL, `document` for
 * an HTML file, which is read as text and additionally addressed as a page. The
 * caller decides, because what a file is worth showing as is a rendering
 * question.
 */
export type RigPanelFileKind = "text" | "media" | "document";

/**
 * One workspace file opened beside a conversation rather than into a tab: the
 * file a transcript named, read on its own so following a link out of the chat
 * does not disturb the files the reader has open in the main content.
 */
export interface RigPanelFileSnapshot {
    readonly groupId: RigGroupId;
    /** Path as the transcript named it, which is what the host is asked to read. */
    readonly path: string;
    readonly kind: RigPanelFileKind;
    readonly document: Loadable<RigWorkspaceFileDocument | RigWorkspaceFileBytes>;
    readonly loading: boolean;
    /** Where a `document` file is served as a page, once the host has said. */
    readonly previewUrl?: string;
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
    /**
     * The addressed group's tab strip, by tab id, in the order it is shown. It
     * covers everything the strip holds — sessions and files alike — because the
     * reader arranges one strip, not one order per kind of thing in it. Empty
     * while no group is addressed.
     */
    readonly tabOrder: readonly string[];
    readonly activeFileTabId?: string;
    /**
     * The file the panel's viewer is on, if any. It is separate from `fileTabs`
     * because it is a glance out of the transcript with the panel's lifetime,
     * not a document the reader put in the main content.
     */
    readonly panelFile?: RigPanelFileSnapshot;
    /**
     * The session focusing each project or worktree should land on: the tab it
     * was left on, or the one behind that in its tab history when the reader has
     * since closed it. A group whose remembered tabs are all gone is absent, and
     * the surface falls back to the group's first session.
     */
    readonly groupResume: ReadonlyMap<RigGroupId, RigSessionId>;
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
    /**
     * Directories the reader opened in the tree, by full path.
     *
     * What is recorded is the decision, not the shape it produced: the tree
     * stands part way open on its own, so "absent from this set" has to mean
     * "nothing was said about it" rather than "closed" — otherwise every
     * listing that redrew would reopen the directories the reader deliberately
     * shut.
     */
    readonly fileTreeExpanded: ReadonlySet<string>;
    /** Directories the reader closed, including ones that open on their own. */
    readonly fileTreeCollapsed: ReadonlySet<string>;
    /**
     * Changed files picked for one act on all of them at once. A listing is
     * where a reader decides that four of these eleven files were a mistake, so
     * the decision is held here rather than being re-made file by file.
     */
    readonly fileSelection: ReadonlySet<string>;
    /** The revert confirmation, while it is open. */
    readonly fileRevert?: RigFileRevertSnapshot;
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

/**
 * A revert the reader has asked for but not yet confirmed. Discarding work is
 * the one act in this panel that cannot be undone by doing it again, so the
 * paths are captured when the dialog opens: what is confirmed is what was read,
 * even if the selection or the checkout moves underneath it.
 */
export interface RigFileRevertSnapshot {
    /** The paths that will be returned to what HEAD holds. */
    readonly paths: readonly string[];
    /** True while the checkout is being changed; the dialog stays up and inert. */
    readonly submitting: boolean;
    /** A failed revert, said in the dialog rather than thrown away. */
    readonly error?: string;
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

export interface RigWorkspaceNewChatInput {
    readonly projectId?: RigProjectId;
    readonly workspaceId?: RigWorktreeId;
    readonly model?: string;
    readonly effort?: RigThinkingLevel;
    readonly prompt?: string;
}

export interface RigWorkspaceStore {
    get(): RigWorkspaceSnapshot;
    subscribe(listener: () => void): () => void;

    /**
     * The workspace's right-hand tool panel. It is a store of its own, not part of
     * the snapshot above, because a terminal in it repaints far faster than the
     * conversation does and must not drag the whole workspace through a render to
     * do it. The workspace keeps it pointed at the addressed group.
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
    /** Sends agent-authored slot text to the conversation currently addressed. */
    messageSendCurrent(message: string): Promise<void>;
    /** Sends agent-authored slot text to one explicitly addressed conversation. */
    messageSend(sessionId: RigSessionId, message: string): Promise<void>;
    /** Replaces one explicitly addressed conversation's composer draft. */
    draftUpdate(sessionId: RigSessionId, message: string): Promise<void>;
    /** Starts the new conversation described by a slot action and optionally submits its prompt. */
    chatStart(input: RigWorkspaceNewChatInput): Promise<void>;
    /** Opens one imported Rig webapp in the addressed group's isolated panel. */
    webappOpen(
        name: string,
        path?: string,
        query?: Readonly<Record<string, string>>,
    ): Promise<void>;
    conversationCreate(input: RigSessionCreateInput): Promise<void>;
    conversationFork(conversationId: RigSessionId): Promise<void>;
    /**
     * Closes a conversation: it leaves the list durably without ending the
     * session. The caller addresses somewhere else first when the closed
     * conversation is the open one; this store does not navigate.
     */
    conversationArchive(conversationId: RigSessionId): Promise<void>;
    /**
     * Moves one tab of the addressed group directly after `afterId`, or to the
     * front of the strip when null. The order is this client's own and takes
     * effect at once: nothing is asked of the daemon, which orders sessions but
     * cannot order a strip that also holds files.
     */
    tabReorder(tabId: string, afterId: string | null): void;
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
    filePreview(groupId: RigGroupId, path: string, kind: RigFileTabKind): void;
    /** Opens one workspace file permanently, promoting its preview when present. */
    fileOpen(groupId: RigGroupId, path: string, kind: RigFileTabKind): void;
    /**
     * Opens one workspace file in the panel's viewer, beside the conversation
     * that named it. This is what a link in a message and the file a tool call
     * worked on resolve to: the file is read for showing, the panel's viewer tab
     * appears immediately with that read's loading state, and the main content
     * — the transcript the reader is following — is left exactly as it was.
     */
    filePanelOpen(groupId: RigGroupId, path: string, kind: RigPanelFileKind): void;
    /** Closes the panel's file viewer and stops its pending read. */
    filePanelClose(): void;
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
    /**
     * Records that the reader wants one directory open or closed.
     *
     * The wanted state is passed rather than derived, because whether a
     * directory was open is a question about the drawn tree — where depth
     * decides what has not been spoken for — and the store does not build one.
     */
    fileTreeExpandedUpdate(path: string, expanded: boolean): void;
    /**
     * Picks one changed file, replacing whatever was picked before, and makes it
     * the row a later range extends from. This is the plain click, so a listing
     * with nothing chosen behaves exactly as it always did.
     */
    fileSelectionReplace(path: string): void;
    /** Adds or removes one changed file, leaving the rest of the selection alone. */
    fileSelectionToggle(path: string): void;
    /**
     * Extends the selection from the row it was anchored on through `path`.
     * `orderedPaths` is the listing in the order it is drawn, because which
     * files lie between two rows is a question only the visible arrangement can
     * answer — a tree and a flat list disagree about it.
     */
    fileSelectionExtend(path: string, orderedPaths: readonly string[]): void;
    /** Drops the whole selection. */
    fileSelectionClear(): void;
    /** Asks to discard the selected files' changes, opening the confirmation. */
    fileRevertPromptOpen(): void;
    /** Closes that confirmation without touching the checkout. */
    fileRevertPromptClose(): void;
    /**
     * Discards the confirmed files' working-tree changes. The listing is not
     * updated from here: the checkout's Git state is reported by the daemon, so
     * the panel learns what actually happened rather than what was asked for.
     */
    fileRevertConfirm(groupId: RigGroupId): Promise<void>;
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
        memoryRead: (groupId) => client.memory.groupRead(groupId)?.panel,
        memoryWrite: (groupId, memory) => client.memory.groupPanelWrite(groupId, memory),
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
    let fileTreeCollapsed: ReadonlySet<string> = new Set();
    let fileSelection: ReadonlySet<string> = new Set();
    /** The row a range extends from: the last one picked without extending. */
    let fileSelectionAnchor: string | undefined;
    let fileRevert: RigFileRevertSnapshot | undefined;
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
    /** The addressed group's tab strip, in the order the reader arranged it. */
    let tabOrder: readonly string[] = [];
    let panelFile: RigPanelFileSnapshot | undefined;
    let panelFileGeneration = 0;
    let panelFileController: AbortController | undefined;
    /**
     * The working-tree revision the viewer's file was read at, so an agent
     * editing the file the reader is looking at replaces what is on screen
     * rather than leaving them reading a stale copy.
     */
    let panelFileRevision: string | undefined;
    const fileLoadGenerations = new Map<string, number>();
    const fileLoadControllers = new Map<string, AbortController>();
    /** The group the URL currently names, so tab memory knows what it describes. */
    let addressedGroupId: RigGroupId | undefined;
    /** Groups whose remembered file tabs have already been reopened in this run. */
    const restoredGroupIds = new Set<RigGroupId>();
    /** True while reopening remembered tabs, so the reopening is not itself remembered. */
    let restoring = false;
    let groupResume: ReadonlyMap<RigGroupId, RigSessionId> = new Map();
    // What `groupResume` was last resolved against. A transcript frame does not
    // change where a group resumes, and resolving every group's history on every
    // one of them would spend the whole list's projection to learn nothing.
    let groupResumeList: RigSessionListSnapshot | undefined;
    let groupResumeRevision = -1;
    let memoryRevision = 0;
    let snapshot: RigWorkspaceSnapshot = {
        list: list.get(),
        conversation,
        fileTabs,
        tabOrder,
        groupResume,
        openInTargets,
        fileViewMode,
        fileScope,
        fileLayout,
        fileTreeExpanded,
        fileTreeCollapsed,
        fileSelection,
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
            ...(chat.workingLabel !== undefined ? { workingLabel: chat.workingLabel } : {}),
            ...(chat.workingWait !== undefined ? { workingWait: chat.workingWait } : {}),
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

    /** The sessions a group holds right now, in list order, or none while it is not ready. */
    const groupConversationIdList = (groupId: RigGroupId): readonly string[] => {
        const projects = list.get().projects;
        if (projects.type !== "ready") return [];
        for (const project of projects.value) {
            if (project.id === groupId) return project.conversations.map((summary) => summary.id);
            const worktree = project.worktrees.find((candidate) => candidate.id === groupId);
            if (worktree) return worktree.conversations.map((summary) => summary.id);
        }
        return [];
    };

    /** The sessions a group holds right now, or none while the list is not ready. */
    const groupConversationIds = (groupId: RigGroupId): ReadonlySet<string> =>
        new Set(groupConversationIdList(groupId));

    /**
     * One group's tab strip in the order it is shown. Tabs the reader has
     * dragged carry a fractional order key and sort by it; everything else
     * follows in the order it arrived, which is what puts a newly opened tab
     * last without anything having to be written down for it.
     *
     * The keys are this client's own. The daemon orders sessions, but the strip
     * holds sessions and files together and will hold more than that, so an
     * order it can only see part of could never be the one on screen.
     */
    const groupTabOrderCompute = (groupId: RigGroupId | undefined): readonly string[] => {
        if (groupId === undefined) return [];
        const arrival = [
            ...groupConversationIdList(groupId),
            ...fileTabs.filter((tab) => tab.groupId === groupId).map((tab) => tab.id),
        ];
        const order = client.memory.groupRead(groupId)?.order;
        if (!order) return arrival;
        const keyed = arrival.filter((id) => order[id] !== undefined);
        keyed.sort((left, right) => {
            const leftKey = order[left]!;
            const rightKey = order[right]!;
            if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
            return left < right ? -1 : 1;
        });
        return [...keyed, ...arrival.filter((id) => order[id] === undefined)];
    };

    /**
     * Resolves each group's remembered tabs against the sessions it still has,
     * answering with the session focusing that group should open. A file tab
     * resolves to the session it was read in, which is the session its content
     * belongs to; opening that group reopens the file over it.
     */
    const groupResumeCompute = (): ReadonlyMap<RigGroupId, RigSessionId> => {
        const listSnapshot = list.get();
        if (groupResumeList === listSnapshot && groupResumeRevision === memoryRevision)
            return groupResume;
        groupResumeList = listSnapshot;
        groupResumeRevision = memoryRevision;
        const projects = listSnapshot.projects;
        if (projects.type !== "ready") return groupResume;
        const next = new Map<RigGroupId, RigSessionId>();
        const resolve = (groupId: RigGroupId, conversationIds: ReadonlySet<string>): void => {
            const memory = client.memory.groupRead(groupId);
            if (!memory) return;
            // Only sessions answer this question. A file tab is reopened by
            // `groupRestore` and shown over whatever conversation the group
            // resumes on, so it is passed over here rather than standing in for
            // a session it no longer belongs to.
            for (const tabId of memory.history)
                if (conversationIds.has(tabId)) {
                    next.set(groupId, tabId as RigSessionId);
                    return;
                }
        };
        for (const project of projects.value) {
            resolve(project.id, new Set(project.conversations.map((summary) => summary.id)));
            for (const worktree of project.worktrees)
                resolve(worktree.id, new Set(worktree.conversations.map((summary) => summary.id)));
        }
        if (
            next.size === groupResume.size &&
            [...next].every(([groupId, sessionId]) => groupResume.get(groupId) === sessionId)
        )
            return groupResume;
        return next;
    };

    // Rebuilds the combined snapshot only when a component snapshot actually
    // changed, so `get()` stays referentially stable across no-op ticks.
    const recompute = (): void => {
        const listSnapshot = list.get();
        groupResume = groupResumeCompute();
        const nextTabOrder = groupTabOrderCompute(addressedGroupId);
        // The strip keeps its identity across ticks that did not move anything,
        // so a transcript frame does not re-render every tab in it.
        if (
            nextTabOrder.length !== tabOrder.length ||
            nextTabOrder.some((id, index) => tabOrder[index] !== id)
        )
            tabOrder = nextTabOrder;
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
            snapshot.tabOrder === tabOrder &&
            snapshot.activeFileTabId === activeFileTabId &&
            snapshot.panelFile === panelFile &&
            snapshot.groupResume === groupResume &&
            snapshot.openInTargets === openInTargets &&
            snapshot.openInRecentId === openInRecentId &&
            snapshot.rename === rename &&
            snapshot.fileViewMode === fileViewMode &&
            snapshot.fileScope === fileScope &&
            snapshot.fileLayout === fileLayout &&
            snapshot.fileTreeExpanded === fileTreeExpanded &&
            snapshot.fileTreeCollapsed === fileTreeCollapsed &&
            snapshot.fileSelection === fileSelection &&
            snapshot.fileRevert === fileRevert &&
            snapshot.workspaceFiles === workspaceFiles &&
            snapshot.workspaceFilesLoading === workspaceFilesLoading &&
            snapshot.create === create
        )
            return;
        snapshot = {
            list: listSnapshot,
            conversation,
            fileTabs,
            tabOrder,
            groupResume,
            openInTargets,
            fileViewMode,
            fileScope,
            fileLayout,
            fileTreeExpanded,
            fileTreeCollapsed,
            fileSelection,
            ...(fileRevert ? { fileRevert } : {}),
            ...(workspaceFiles ? { workspaceFiles } : {}),
            ...(openInRecentId ? { openInRecentId } : {}),
            workspaceFilesLoading,
            ...(create ? { create } : {}),
            ...(activeFileTabId ? { activeFileTabId } : {}),
            ...(panelFile ? { panelFile } : {}),
            ...(groupComposerDraft ? { groupComposer: groupComposerDraft } : {}),
            ...(groupSessionDraft ? { groupSessionDraft } : {}),
            ...(rename ? { rename } : {}),
        };
        notify();
    };

    /**
     * Forgets what was picked in the changed listing. A path only means anything
     * inside the checkout it came from, so leaving that checkout — or leaving the
     * listing itself — has to leave the selection behind rather than carry it
     * onto rows in another repository that happen to share a name.
     */
    const fileSelectionReset = (): void => {
        fileSelection = new Set();
        fileSelectionAnchor = undefined;
        fileRevert = undefined;
    };

    /**
     * Forgets which directories were opened and which were closed. These are
     * remembered by path for the same reason a selection is, and they stop
     * meaning anything at the same moment: `src` in one checkout is not `src`
     * in the next. Carrying them over would not merely open the wrong folders —
     * a directory closed here would arrive in another repository already
     * closed, and the listing there would open half shut for no stated reason.
     */
    const fileTreeExpansionReset = (): void => {
        fileTreeExpanded = new Set();
        fileTreeCollapsed = new Set();
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

    /**
     * Writes one group's tab memory: the tab now being read moves to the front
     * of its history, and the group's open files are recorded as they stand.
     * Entries for sessions the group no longer has are dropped once the list is
     * ready to say so, so a closed session falls out of the memory instead of
     * shadowing the tab behind it forever.
     */
    const groupTabRemember = (groupId: RigGroupId, tabId: string | undefined): void => {
        if (restoring) return;
        memoryRevision += 1;
        const previous = client.memory.groupRead(groupId);
        // A preview is remembered like any other tab: closing the window is not
        // a decision to throw the file away, and it comes back as the preview it
        // was rather than as a tab the reader never asked to keep.
        const files = fileTabs
            .filter((tab) => tab.groupId === groupId)
            .map((tab) => ({
                path: tab.path,
                kind: tab.kind,
                ...(tab.preview ? { preview: true } : {}),
            }));
        const conversationIds = groupConversationIds(groupId);
        const fileTabIds = new Set(files.map((file) => fileTabIdOf(groupId, file.path)));
        const known = (id: string): boolean =>
            conversationIds.size === 0 || conversationIds.has(id) || fileTabIds.has(id);
        const history = [
            ...(tabId === undefined ? [] : [tabId]),
            ...(previous?.history ?? []).filter((id) => id !== tabId && known(id)),
        ].slice(0, TAB_HISTORY_LIMIT);
        const activeTabId = tabId ?? previous?.activeTabId;
        // An unsent draft is remembered on its own account: a group with no tabs
        // and no files is still worth remembering when somebody has typed into
        // it and not sent it.
        client.memory.groupTabsWrite(groupId, {
            ...(activeTabId ? { activeTabId } : {}),
            history,
            files,
        });
    };

    /** Drops one tab from a group's memory, for a tab that has just been closed. */
    const groupTabForget = (groupId: RigGroupId, tabId: string): void => {
        memoryRevision += 1;
        const previous = client.memory.groupRead(groupId);
        if (!previous) return;
        const history = previous.history.filter((id) => id !== tabId);
        const files = previous.files.filter((file) => fileTabIdOf(groupId, file.path) !== tabId);
        client.memory.groupTabsWrite(groupId, {
            ...(previous.activeTabId && previous.activeTabId !== tabId
                ? { activeTabId: previous.activeTabId }
                : {}),
            history,
            files,
        });
    };

    /**
     * Reopens the files a group was left with, the first time that group is
     * addressed in this run, and selects the tab it was left on when that tab was
     * one of them. It waits for the session list, since a file belongs to a
     * session and a group whose sessions are unknown cannot say which of its
     * remembered files still have one.
     */
    const groupRestore = (groupId: RigGroupId): void => {
        if (restoredGroupIds.has(groupId)) return;
        const conversationIds = groupConversationIds(groupId);
        if (conversationIds.size === 0) return;
        restoredGroupIds.add(groupId);
        const memory = client.memory.groupRead(groupId);
        if (!memory || memory.files.length === 0) return;
        restoring = true;
        try {
            for (const file of memory.files) {
                if (fileTabs.some((tab) => tab.id === fileTabIdOf(groupId, file.path))) continue;
                fileTabOpen(groupId, file.path, file.kind, file.preview === true);
            }
        } finally {
            restoring = false;
        }
        // Reopening moved the selection through every restored file; the reader
        // left exactly one of them on screen, so the memory decides which.
        activeFileTabId =
            memory.activeTabId && fileTabs.some((tab) => tab.id === memory.activeTabId)
                ? memory.activeTabId
                : undefined;
    };

    /** Stops pending work for a file tab that is being closed or replaced. */
    const fileTabRelease = (tabId: string): void => {
        fileLoadGenerations.delete(tabId);
        fileLoadControllers.get(tabId)?.abort();
        fileLoadControllers.delete(tabId);
    };

    /**
     * Asks the host where one HTML file is served as a page and puts that
     * address on its tab.
     *
     * It is a separate request from reading the file because the two answer
     * different questions: the text is what the reader edits, the address is
     * where the rendered page loads from, and the source view must not wait on
     * the page. A failure leaves the tab without an address, which the surface
     * shows as a document it can only offer as source.
     */
    const filePreviewAddressResolve = (
        tabId: string,
        generation: number,
        tab: RigFileTabSnapshot,
    ): void => {
        void client.htmlPreviewOpen(tab.groupId, tab.path).then(
            (url) => {
                if (disposed || fileLoadGenerations.get(tabId) !== generation) return;
                fileTabs = fileTabs.map((candidate) =>
                    candidate.id === tabId ? { ...candidate, previewUrl: url } : candidate,
                );
                recompute();
            },
            () => {
                // The reader still has the file; only its rendered face is
                // unavailable, and the surface says so without a failed tab.
            },
        );
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
                      // A reload keeps showing what is already there only when
                      // it is the shape this tab reads: a media descriptor names
                      // where the bytes are, an editable file carries its text,
                      // and a diff carries both sides of one.
                      ...(tab.document.type === "ready" &&
                      (before.kind === "media"
                          ? "contentType" in tab.document.value
                          : before.kind === "file" || before.kind === "document"
                            ? "content" in tab.document.value
                            : "oldContent" in tab.document.value)
                          ? {}
                          : { document: { type: "loading" as const } }),
                  }
                : tab,
        );
        recompute();
        const read =
            before.kind === "file" || before.kind === "document"
                ? client.workspaceFileRead(before.groupId, before.path, controller.signal)
                : before.kind === "media"
                  ? client.workspaceFileBytesRead(before.groupId, before.path, controller.signal)
                  : client.changedFileRead(before.groupId, before.path, controller.signal);
        if (before.kind === "document") filePreviewAddressResolve(tabId, generation, before);
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
     * Reads the file the panel's viewer is on. One file is being looked at, so
     * one read is in flight: opening another aborts the previous one and its
     * answer is discarded by generation, which is what stops a slow first file
     * from landing on top of the second.
     */
    const panelFileLoad = (file: RigPanelFileSnapshot): void => {
        const generation = panelFileGeneration + 1;
        panelFileGeneration = generation;
        panelFileController?.abort();
        const controller = new AbortController();
        panelFileController = controller;
        panelFile = file;
        recompute();
        const read =
            file.kind === "text" || file.kind === "document"
                ? client.workspaceFileRead(file.groupId, file.path, controller.signal)
                : client.workspaceFileBytesRead(file.groupId, file.path, controller.signal);
        if (file.kind === "document")
            void client.htmlPreviewOpen(file.groupId, file.path).then(
                (url) => {
                    if (disposed || panelFileGeneration !== generation || !panelFile) return;
                    panelFile = { ...panelFile, previewUrl: url };
                    recompute();
                },
                () => {
                    // Only the rendered face is unavailable; the source remains.
                },
            );
        void read.then(
            (document) => {
                if (disposed || panelFileGeneration !== generation || !panelFile) return;
                panelFileController = undefined;
                panelFile = {
                    ...panelFile,
                    document: { type: "ready", value: document },
                    loading: false,
                };
                recompute();
            },
            (error: unknown) => {
                if (disposed || panelFileGeneration !== generation || !panelFile) return;
                panelFileController = undefined;
                panelFile = {
                    ...panelFile,
                    document: { type: "error", error: rigUserError(error) },
                    loading: false,
                };
                recompute();
            },
        );
    };

    /** Stops the panel viewer's pending read and forgets the file it was on. */
    const panelFileRelease = (): void => {
        panelFileGeneration += 1;
        panelFileController?.abort();
        panelFileController = undefined;
        panelFile = undefined;
        panelFileRevision = undefined;
    };

    /**
     * Opens a file with preview or permanent lifetime. Each group has at most
     * one preview; permanent tabs and previews in other groups keep their place.
     */
    const fileTabOpen = (
        groupId: RigGroupId,
        path: string,
        kind: RigFileTabKind,
        preview: boolean,
    ): void => {
        const id = fileTabIdOf(groupId, path);
        const existing = fileTabs.find((tab) => tab.id === id);
        activeFileTabId = id;
        if (existing) {
            const change = fileChangeFind(groupId, path);
            const revision = change?.revision ?? "";
            if (existing.kind !== kind) {
                fileTabs = fileTabs.map((tab) =>
                    tab.id === id
                        ? {
                              ...tab,
                              kind,
                              revision,
                              preview: preview && tab.preview,
                          }
                        : tab,
                );
                groupTabRemember(groupId, id);
                fileLoad(id, revision);
                return;
            }
            if (!preview && existing.preview)
                fileTabs = fileTabs.map((tab) =>
                    tab.id === id ? { ...tab, preview: false } : tab,
                );
            groupTabRemember(groupId, id);
            if (change && change.revision !== existing.revision) fileLoad(id, change.revision);
            else recompute();
            return;
        }

        const revision = fileChangeFind(groupId, path)?.revision ?? "";
        const tab: RigFileTabSnapshot = {
            id,
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
        groupTabRemember(groupId, id);
        recompute();
        fileLoad(id, revision);
    };

    const fileTabsReconcile = (): void => {
        for (const tab of fileTabs) {
            const change = fileChangeFind(tab.groupId, tab.path);
            if (change && change.revision !== tab.revision) fileLoad(tab.id, change.revision);
        }
        if (panelFile && addressedGroupId !== undefined) {
            const change = fileChangeFind(addressedGroupId, panelFile.path);
            if (change && change.revision !== panelFileRevision) {
                panelFileRevision = change.revision;
                panelFileLoad({ ...panelFile, loading: true });
            }
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

    /**
     * Places a draft's non-image attachments in the group's checkout and returns
     * the text the turn should carry, which names them. Copies are
     * written one at a time: their order in the draft is the order they take
     * names in, and two writes racing for the same name would settle it by luck.
     * A failed copy fails the send, which is the only place a reader is looking.
     */
    const attachmentsPlace = async (
        groupId: RigGroupId,
        text: string,
        attachments: readonly ComposerAttachment[],
    ): Promise<string> => {
        const paths: string[] = [];
        for (const attachment of attachments) {
            if (attachment.kind !== "workspaceFile") continue;
            const written = await client.attachmentWrite(groupId, attachment.name, attachment.data);
            paths.push(written.path);
        }
        return rigAttachmentTextAppend(text, paths);
    };

    /**
     * What is attached to each group's unsent draft. Unlike the text it is not
     * written to the host's storage: the bytes of a screenshot are not something
     * to keep on disk on the chance that somebody comes back to the sentence
     * they were writing. It outlives the composer rather than the window, so
     * looking at another project and returning finds the draft as it was left.
     */
    const groupAttachments = new Map<RigGroupId, readonly ComposerAttachment[]>();

    /** The same, for a conversation whose composer is rebuilt when it is reopened. */
    const conversationAttachments = new Map<RigSessionId, readonly ComposerAttachment[]>();

    const attachmentsRemember = <Key>(
        held: Map<Key, readonly ComposerAttachment[]>,
        key: Key,
        target: ComposerStore,
    ): void => {
        const attachments = target.getState().attachments;
        if (attachments.length === 0) held.delete(key);
        else held.set(key, attachments);
    };

    /**
     * The checkout one conversation runs in. Attachments land there and mentions
     * are searched there, and both are properties of the directory rather than
     * of the agent: a subagent addressed on its own still belongs to the project
     * it was delegated inside, which is the group the reader has open.
     */
    const conversationGroupId = (conversationId: RigSessionId): RigGroupId | undefined => {
        const projects = list.get().projects;
        if (projects.type === "ready")
            for (const project of projects.value) {
                if (project.conversations.some((summary) => summary.id === conversationId))
                    return project.id;
                for (const worktree of project.worktrees)
                    if (worktree.conversations.some((summary) => summary.id === conversationId))
                        return worktree.id;
            }
        return addressedGroupId;
    };

    const composerCreate = (conversationId: RigSessionId): ComposerStore => {
        const created: ComposerStore = composerStoreCreate(conversationId, {
            capabilities: { shellMode: true, commands: rigComposerCommands, mentions: true },
            attachments: conversationAttachments.get(conversationId) ?? [],
            output: (event) => {
                switch (event.type) {
                    case "attachmentAdded":
                    case "attachmentRemoved":
                        attachmentsRemember(conversationAttachments, conversationId, created);
                        return;
                    case "textUpdated":
                        void withChatStore((store) =>
                            store.draftSet(event.text, nextDraftUpdatedAt(), draftOrigin),
                        ).catch(() => undefined);
                        return;
                    case "textSubmitted":
                        void withChatStore((store) =>
                            store.draftSet("", nextDraftUpdatedAt(), draftOrigin),
                        ).catch(() => undefined);
                        submitting(created, event.revision, async () => {
                            const group = conversationGroupId(conversationId);
                            if (!group)
                                throw new Error("That conversation is no longer in a project.");
                            const text = await attachmentsPlace(
                                group,
                                event.text,
                                event.attachments,
                            );
                            await withChatStore((store) =>
                                store.messageSend(text, rigImageInputsOf(event.attachments)),
                            );
                            conversationAttachments.delete(conversationId);
                        });
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
                        const group = conversationGroupId(conversationId);
                        if (!group) return;
                        void client.filesSearch(group, query, MENTION_LIMIT).then(
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
                    // A send in flight has already cleared the stored draft, and
                    // that empty draft arrives back here while the message is
                    // still going out. Reconciling it would count as a new
                    // revision of the composer, and the confirmation that
                    // follows — the thing that drops the text and its
                    // attachments together — is refused for a revision that has
                    // moved on. The send clears this composer itself.
                    if (currentComposer.getState().submission.status === "pending") return;
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
        panel.scopeApply(addressedGroupId, conversationId);
        // The panel's viewer showed a file out of the conversation being left,
        // named by a path that only means anything in that session's checkout.
        if (conversationId !== openId) panelFileRelease();
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
        attachments: readonly ComposerAttachment[],
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
            const placed = await attachmentsPlace(location.groupId, text, attachments);
            const acquired = await client.chat(location.sessionId);
            try {
                await acquired.store.messageSend(placed, rigImageInputsOf(attachments));
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
            if (openId) list.sessionRead(openId);
            // A group addressed before its sessions arrived could not have its
            // remembered files reopened yet; the list saying which sessions it
            // has is what makes that possible.
            if (addressedGroupId !== undefined) groupRestore(addressedGroupId);
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
        panelFileRelease();
        releaseGroup();
        releaseConversation();
        conversation = { type: "unloaded" };
        snapshot = {
            list: list.get(),
            conversation,
            fileTabs,
            tabOrder,
            groupResume,
            openInTargets,
            fileViewMode,
            fileScope,
            fileLayout,
            fileTreeExpanded,
            fileTreeCollapsed,
            fileSelection,
            ...(fileRevert ? { fileRevert } : {}),
            ...(workspaceFiles ? { workspaceFiles } : {}),
            ...(openInRecentId ? { openInRecentId } : {}),
            workspaceFilesLoading,
            ...(create ? { create } : {}),
            ...(activeFileTabId ? { activeFileTabId } : {}),
        };
    };

    const withChat = <T>(run: (store: RigChatStore) => Promise<T>): Promise<T> =>
        chatStore ? run(chatStore) : noOpenConversation();

    const withAddressedChat = async <T>(
        sessionId: RigSessionId,
        run: (store: RigChatStore) => Promise<T>,
    ): Promise<T> => {
        if (sessionId === openId && chatStore) return run(chatStore);
        const acquired = await client.chat(sessionId);
        try {
            return await run(acquired.store);
        } finally {
            acquired[Symbol.dispose]();
        }
    };

    const slotGroupFind = (input: RigWorkspaceNewChatInput): RigGroupId | undefined => {
        const projects = list.get().projects;
        if (projects.type !== "ready")
            return (addressedGroupId ?? openGroupId) as RigGroupId | undefined;
        if (input.workspaceId) {
            for (const project of projects.value) {
                if (input.projectId && project.id !== input.projectId) continue;
                const worktree = project.worktrees.find(
                    (candidate) => candidate.id === input.workspaceId,
                );
                if (worktree) return worktree.id;
            }
            return undefined;
        }
        if (input.projectId) {
            return projects.value.some((project) => project.id === input.projectId)
                ? (input.projectId as RigProjectId)
                : undefined;
        }
        return addressedGroupId ?? openGroupId;
    };

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
            if (groupId !== addressedGroupId) {
                fileSelectionReset();
                fileTreeExpansionReset();
            }
            releaseGroup();
            if (groupId !== undefined && fileScope === "all") workspaceFilesEnsure(groupId);
            if (groupId !== undefined) {
                addressedGroupId = groupId;
                groupRestore(groupId);
                // A restored file tab is what this group was left showing, so it
                // stays on screen and stays the tab this group resumes on.
                const restoredFile = fileTabs.find(
                    (tab) => tab.id === activeFileTabId && tab.groupId === groupId,
                );
                groupTabRemember(groupId, restoredFile ? restoredFile.id : conversationId);
            }
            list.sessionRead(conversationId);
            openConversation(conversationId);
        },
        groupOpen: (groupId) => {
            if (groupId !== addressedGroupId) {
                fileSelectionReset();
                fileTreeExpansionReset();
            }
            // The panel belongs to this group, so it learns the address before
            // the conversation is released rather than after.
            addressedGroupId = groupId;
            openConversation(undefined);
            groupRestore(groupId);
            // The file scope belongs to the whole workspace, so "All files"
            // survives navigation. Apply it to the newly addressed checkout
            // even when this group already owns the empty-session composer.
            if (fileScope === "all") workspaceFilesEnsure(groupId);
            if (openGroupId === groupId) return;
            releaseGroup();
            openGroupId = groupId;
            const created: ComposerStore = composerStoreCreate(groupId, {
                capabilities: { shellMode: false, commands: [], mentions: false },
                text: client.memory.groupRead(groupId)?.draft ?? "",
                attachments: groupAttachments.get(groupId) ?? [],
                output: (event) => {
                    switch (event.type) {
                        case "textUpdated":
                            client.memory.groupDraftWrite(groupId, event.text);
                            return;
                        case "attachmentAdded":
                        case "attachmentRemoved":
                            attachmentsRemember(groupAttachments, groupId, created);
                            return;
                        case "textSubmitted": {
                            // The configuration is read now, not after the
                            // session has been created: creation navigates,
                            // which releases this group and its draft with it.
                            const selection = groupDraft?.get().selection;
                            submitting(created, event.revision, async () => {
                                await groupSubmit(
                                    groupId,
                                    event.text,
                                    event.attachments,
                                    selection,
                                );
                                // Sent, so there is nothing left to come back
                                // to. Navigation releases this composer before
                                // it can clear itself, which is why the group's
                                // own record of the draft is cleared here.
                                client.memory.groupDraftWrite(groupId, "");
                                groupAttachments.delete(groupId);
                            });
                            return;
                        }
                        default:
                            return;
                    }
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
        messageSendCurrent: (message) => withChat((store) => store.messageSend(message, [])),
        messageSend: (sessionId, message) =>
            withAddressedChat(sessionId, (store) => store.messageSend(message, [])),
        draftUpdate: (sessionId, message) =>
            withAddressedChat(sessionId, (store) =>
                store.draftSet(message, nextDraftUpdatedAt(), draftOrigin),
            ),
        async chatStart(input) {
            const groupId = slotGroupFind(input);
            if (!groupId) throw new Error("That project or workspace is no longer listed.");
            const start = groupStartFind(groupId);
            if (!start) throw new Error("That project or workspace is not ready.");
            const create: RigSessionCreateInput = {
                ...start.create,
                ...(input.model ? { modelId: input.model } : {}),
                ...(input.effort ? { effort: input.effort } : {}),
            };
            const location = start.worktreeId
                ? await list.worktreeSessionStart(start.worktreeId, create)
                : await list.sessionCreate(create);
            if (!location) throw new Error("The conversation could not be started.");
            output({ type: "conversationOpenRequested", location });
            if (input.prompt?.trim()) {
                await withAddressedChat(location.sessionId, (store) =>
                    store.messageSend(input.prompt!, []),
                );
            }
        },
        async webappOpen(name, path, query) {
            const previewUrl = await client.webappPreviewOpen(name);
            const url = new URL(previewUrl);
            if (path) {
                const basePath = url.pathname.endsWith("/")
                    ? url.pathname.slice(0, -1)
                    : url.pathname;
                url.pathname = `${basePath}/${path.replace(/^\/+/u, "")}`;
            }
            if (query)
                for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
            panel.webappOpen(name, url.href);
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
        tabReorder(tabId, afterId) {
            if (disposed || addressedGroupId === undefined) return;
            const groupId = addressedGroupId;
            if (!tabOrder.includes(tabId)) return;
            if (afterId !== null && !tabOrder.includes(afterId)) return;
            const stored = client.memory.groupRead(groupId)?.order ?? {};
            // A tab can only be placed between two keys, so the strip as it
            // stands is written down first: the tabs that already have keys keep
            // them, and the ones that arrived since sort after the last of them
            // exactly where they are already showing.
            const keyed = tabOrder.filter((id) => stored[id] !== undefined);
            const unkeyed = tabOrder.filter((id) => stored[id] === undefined);
            const minted = orderKeySequence(
                unkeyed.length,
                keyed.length > 0 ? stored[keyed[keyed.length - 1]!]! : null,
            );
            const order: Record<string, string> = {};
            for (const id of keyed) order[id] = stored[id]!;
            unkeyed.forEach((id, index) => {
                order[id] = minted[index]!;
            });
            order[tabId] = orderKeyAfter(
                tabOrder.map((id) => ({ id, orderKey: order[id]! })),
                tabId,
                afterId,
            );
            client.memory.groupOrderWrite(groupId, order);
            memoryRevision += 1;
            recompute();
        },
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

        filePanelOpen(groupId, path, kind) {
            if (disposed) return;
            panelFileRevision = fileChangeFind(groupId, path)?.revision;
            panel.fileViewOpen();
            panelFileLoad({
                groupId,
                path,
                kind,
                document: { type: "loading" },
                loading: true,
            });
        },
        filePanelClose() {
            if (disposed) return;
            panelFileRelease();
            panel.fileViewClose();
            recompute();
        },
        filePreview: (groupId, path, kind) => fileTabOpen(groupId, path, kind, true),
        fileOpen: (groupId, path, kind) => fileTabOpen(groupId, path, kind, false),
        fileSelect(tabId) {
            const selected =
                tabId !== undefined ? fileTabs.find((tab) => tab.id === tabId) : undefined;
            activeFileTabId = selected?.id;
            if (selected) groupTabRemember(selected.groupId, selected.id);
            // Clearing file selection puts the open conversation back on screen,
            // which is the tab this group is now being read on.
            else if (addressedGroupId !== undefined && openId !== undefined)
                groupTabRemember(addressedGroupId, openId);
            recompute();
        },
        fileClose(tabId) {
            const index = fileTabs.findIndex((tab) => tab.id === tabId);
            const closing = fileTabs[index];
            if (index < 0 || !closing) return;
            fileTabRelease(tabId);
            fileTabs = fileTabs.filter((tab) => tab.id !== tabId);
            if (activeFileTabId === tabId)
                activeFileTabId = fileTabs[Math.min(index, fileTabs.length - 1)]?.id;
            groupTabForget(closing.groupId, tabId);
            // What the closed tab uncovered in its own group: the next file
            // there, or the conversation behind it when the group is addressed.
            const uncovered =
                fileTabs.find(
                    (tab) => tab.id === activeFileTabId && tab.groupId === closing.groupId,
                )?.id ?? (closing.groupId === addressedGroupId ? openId : undefined);
            groupTabRemember(closing.groupId, uncovered);
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
            // Picking files to revert is something only the changed listing
            // offers, so leaving the listing drops what was picked in it.
            fileSelectionReset();
            recompute();
        },
        fileLayoutUpdate(layout) {
            if (fileLayout === layout) return;
            fileLayout = layout;
            recompute();
        },
        fileTreeExpandedUpdate(path, expanded) {
            // Asking for what has already been decided is not a change, and
            // publishing a snapshot for it redraws the workspace over nothing.
            if (expanded ? fileTreeExpanded.has(path) : fileTreeCollapsed.has(path)) return;
            // Both sets are rewritten, because a decision replaces the opposite
            // one: a directory the reader reopens is no longer one they closed.
            const opened = new Set(fileTreeExpanded);
            const closed = new Set(fileTreeCollapsed);
            if (expanded) {
                opened.add(path);
                closed.delete(path);
            } else {
                opened.delete(path);
                closed.add(path);
            }
            fileTreeExpanded = opened;
            fileTreeCollapsed = closed;
            recompute();
        },
        fileSelectionReplace(path) {
            fileSelection = new Set([path]);
            fileSelectionAnchor = path;
            recompute();
        },
        fileSelectionToggle(path) {
            const next = new Set(fileSelection);
            if (!next.delete(path)) next.add(path);
            fileSelection = next;
            // The row just acted on is where a range starts from next, whether
            // it was added or removed: it is the last place the reader pointed.
            fileSelectionAnchor = path;
            recompute();
        },
        fileSelectionExtend(path, orderedPaths) {
            const anchor = fileSelectionAnchor ?? path;
            const from = orderedPaths.indexOf(anchor);
            const to = orderedPaths.indexOf(path);
            // An anchor the listing no longer holds — the file was reverted, or
            // the scope changed under it — leaves the clicked row as the whole
            // selection rather than guessing at a range with one end missing.
            if (from === -1 || to === -1) {
                fileSelection = new Set([path]);
                fileSelectionAnchor = path;
                recompute();
                return;
            }
            const [start, end] = from <= to ? [from, to] : [to, from];
            fileSelection = new Set(orderedPaths.slice(start, end + 1));
            recompute();
        },
        fileSelectionClear() {
            if (fileSelection.size === 0) return;
            fileSelection = new Set();
            fileSelectionAnchor = undefined;
            recompute();
        },
        fileRevertPromptOpen() {
            if (fileSelection.size === 0 || fileRevert) return;
            fileRevert = { paths: [...fileSelection], submitting: false };
            recompute();
        },
        fileRevertPromptClose() {
            if (!fileRevert || fileRevert.submitting) return;
            fileRevert = undefined;
            recompute();
        },
        async fileRevertConfirm(groupId) {
            const pending = fileRevert;
            if (!pending || pending.submitting) return;
            fileRevert = { ...pending, submitting: true };
            recompute();
            try {
                await client.changedFilesRevert(groupId, pending.paths);
            } catch (error) {
                fileRevert = {
                    ...pending,
                    submitting: false,
                    error: error instanceof Error ? error.message : "That revert did not happen.",
                };
                recompute();
                return;
            }
            fileRevert = undefined;
            // The files are gone from the listing, so a selection naming them is
            // gone with them; anything else the reader had picked stays picked.
            const kept = new Set(
                [...fileSelection].filter((path) => !pending.paths.includes(path)),
            );
            fileSelection = kept;
            if (fileSelectionAnchor !== undefined && !kept.has(fileSelectionAnchor))
                fileSelectionAnchor = undefined;
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
                await client.workspaceFileWrite(tab.groupId, tab.path, draft, expectedHash);
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
                void rigComposerAttachmentRead(id, file).then(
                    (attachment) => {
                        // The draft may have been released (or replaced by
                        // addressing elsewhere) while the bytes were read; an
                        // attachment never lands in a composer other than its own.
                        if ((groupComposer ?? composer) !== target) return;
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
