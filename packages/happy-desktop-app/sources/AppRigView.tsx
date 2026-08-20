import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type {
    AppearanceStore,
    ConversationEntry,
    ComposerSnapshot,
    ExperimentsStore,
    ConversationToolCall,
    RigClockStore,
    RigFileTabKind,
    RigFileTabSnapshot,
    RigConnectionStore,
    RigDebugLogStore,
    RigConversationSnapshot,
    RigFileLayout,
    RigWorkspaceFiles,
    RigFileScope,
    RigFileViewMode,
    RigHost,
    RigGroupId,
    RigMenusSnapshot,
    RigModelStore,
    RigModelSelection,
    RigNavigationOrderStore,
    RigSidebarCollapseStore,
    RigPanelSnapshot,
    RigProjectAddSnapshot,
    RigPanelStore,
    RigPanelTabId,
    RigPanelTabSnapshot,
    RigPermissionMode,
    RigProfileStore,
    RigInboxItem,
    RigInboxSnapshot,
    RigInboxStore,
    RigInstructionsStore,
    RigSecurityPolicyStore,
    RigAvailabilitySnapshot,
    RigProviderUsageStore,
    RigGroupLifecycle,
    RigProjectGroup,
    RigProjectId,
    RigServiceTier,
    RigSessionCreateInput,
    RigSessionId,
    RigTerminalStore,
    RigThinkingLevel,
    TitleShimmerStore,
    RigWindowStore,
    RigWorkspaceSnapshot,
    RigWorkspaceStore,
    RigWorkingWait,
    RigWorktreeId,
} from "happy-desktop-state";
import {
    RIG_PANEL_FILE_VIEW_ID,
    rigAgentAuthor,
    experimentsStoreNoop,
    rigInboxStoreNoop,
    rigNavigationOrderApply,
    rigAvailabilityProject,
    rigNavigationOrderStoreNoop,
    rigSidebarCollapseStoreNoop,
    rigHumanMessageAuthor,
    rigSessionGroupIdOf,
    rigOwnerAuthor,
    rigWindowStoreNoop,
    titleShimmerStoreNoop,
} from "happy-desktop-state";
import {
    type AgentWaitStatus,
    AppShell,
    APP_SHELL_PANEL_DEFAULT_WIDTH,
    Banner,
    BrowserPanel,
    DevBuildMenu,
    type BrowserContentRenderer,
    HtmlPreviewFrame,
    type HtmlPreviewRenderer,
    type MediaWindowOpener,
    Button,
    ChannelHeader,
    ContextMeter,
    ChangedFileDiff,
    ComposerFooterBar,
    ComposerModelControl,
    ComposerPanel,
    ConversationView,
    DeferredPane,
    EmptyState,
    FileBrowser,
    FileEditor,
    FilePreview,
    type FilePreviewKind,
    filePreviewKind,
    Lightbox,
    MarkdownDocument,
    Modal,
    ModalOverlay,
    RigActivityControl,
    RigActivityPanel,
    RigControlMenu,
    fileTreeBuild,
    fileTreeFlatten,
    type FileTreeExpansion,
    type FileTreeBuildEntry,
    RigCreateSessionDialog,
    RigProjectCloneDialog,
    RigProjectSettingsDialog,
    RigSessionControls,
    type RigUserInputAnswerMap,
    RigUsagePanel,
    PanelHeader,
    Sidebar,
    SidebarFooter,
    SidebarUpdateAction,
    RigInboxPage,
    TabbedPane,
    TextField,
    TerminalPanel,
    ToolCallPreview,
    TransferZone,
    type TabTransferTarget,
    WindowDragRegion,
    rigComposerModelControlProps,
    sidebarReorderMove,
    type MenuItem,
    type FileTreeNode,
    type KeyboardShortcut,
    type SidebarItem,
    type SidebarNumberShortcutTarget,
    type SidebarReorder,
    type SidebarSection,
    type TabItem,
    WindowShortcuts,
    WorkspaceLifecycleLane,
    WorkspaceLifecycleNotice,
    type WorkspaceLifecyclePhase,
    commandShortcut,
} from "happy-desktop-ui";
import { openExternalLink } from "./externalLink";
import { BlueprintView } from "./views/BlueprintView";

export interface AppRigUpdate {
    readonly action: "refresh" | "restart";
    readonly detail?: string;
    readonly status: "available" | "downloading" | "downloaded";
    readonly version?: string;
}

/** One Rig this window can address, with its own catalog and surface stores. */
export interface AppRigEntry {
    readonly id: string;
    readonly label: string;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly message?: string;
    readonly version?: string;
    readonly projects: readonly RigProjectGroup[];
    readonly projectsStatus: "loading" | "ready" | "error";
    /**
     * Where adding a folder to this Rig as a project stands. Absent on a host
     * that does not report it, which reads as nothing being added — the same way
     * a host with no live stores supplies no `session`.
     */
    readonly projectAdd?: RigProjectAddSnapshot;
    /** The live stores for this Rig, present once its connection is up. */
    readonly session?: AppRigSession;
}

export interface AppRigSession {
    readonly clock: RigClockStore;
    readonly connection: RigConnectionStore;
    /** This Rig's retained connection, reconciliation, and SSE diagnostics. */
    readonly debugLog?: RigDebugLogStore;
    readonly host: RigHost;
    /** This Rig's own model catalog, read by the settings window's pickers. */
    readonly models: RigModelStore;
    readonly workspace: RigWorkspaceStore;
    /**
     * Every question this Rig's agents are waiting on. Absent when the machine
     * offers no question feed, which is why the inbox row is absent too rather
     * than opening onto an empty queue that means nothing.
     */
    readonly inbox?: RigInboxStore;
    /**
     * How much of each provider account's plan this machine has spent, read by
     * the Usage settings category. Absent when the machine reports no usage,
     * which leaves that category saying so rather than listing accounts that
     * mean nothing.
     */
    readonly providerUsage?: RigProviderUsageStore;
    /** The identity this Rig authors work as, as its profile settings edit it. */
    readonly profile?: () => RigProfileStore | undefined;
    /** This Rig's machine-wide instructions, as the settings window edits them. */
    readonly instructions?: RigInstructionsStore;
    /** This Rig's machine-wide permission-review policy. */
    readonly securityPolicy?: RigSecurityPolicyStore;
}

export interface AppRigDirectorySnapshot {
    /**
     * The Rig this window is addressing, as `rigActivate` last recorded it. It
     * is the synchronous authority on which machine is on screen, for the
     * decisions that cannot be taken at render time — whether an agent's
     * contribution may still be performed when someone presses it. A host that
     * records no addressed Rig supplies nothing here, and such a press is inert
     * rather than aimed at a guess.
     */
    readonly activeRigId?: string;
    readonly rigs: readonly AppRigEntry[];
}

/** The Rigs this window can address. */
export interface AppRigDirectoryStore {
    get(): AppRigDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Records which Rig the window is addressing. The URL decides it; the store
     * is told so that window-level events with no Rig of their own — a URL handed
     * to the app to open — land in the workspace on screen.
     */
    rigActivate(id: string): void;
}

/**
 * What a development window calls itself: the worktree or branch it was built
 * from, and the checkout worth copying out of it. A packaged Happy supplies
 * none — the product has one identity and does not have to announce it.
 */
export interface AppBuildIdentity {
    readonly branch: string;
    readonly label: string;
    readonly path: string;
}

export interface AppRigViewProps {
    /** The host Rig this window is an interface onto, and what it currently holds. */
    rigs: AppRigDirectoryStore;
    /**
     * This build's development identity, shown in the sidebar footer menu.
     * Absent in the packaged product, where there is nothing to tell apart.
     */
    buildIdentity?: AppBuildIdentity;
    /** Which Rig the URL addresses; its projects and sessions fill the window. */
    rigId: string;
    /** Theme selection behind the sidebar footer's appearance toggle. */
    appearance: AppearanceStore;
    /**
     * Where this surface is running. In the Electron shell the window has no
     * native title bar, so the shell owns the traffic-light inset and the drag
     * lanes and the sidebar heading gives its space up to them; the browser
     * development mode keeps the ordinary branded heading.
     */
    platform?: "desktop" | "web";
    /**
     * The window's own chrome. Entering macOS full screen takes the traffic
     * lights away, so the lane reserved for them closes with them and the sidebar
     * toggle returns to the window's left edge. The browser shell supplies no
     * such store and stays windowed.
     */
    windowState?: RigWindowStore;
    /**
     * Where this window remembers the order the reader arranged its pinned rows
     * in. A host that keeps no such record supplies none, and the rows stay in
     * the order the window offers them rather than being arrangeable into an
     * order the next launch would forget.
     */
    navigationOrder?: RigNavigationOrderStore;
    /**
     * Where this window remembers which projects and folders the reader folded
     * shut. A host that keeps no such record supplies none, and every row stays
     * open rather than offering a fold the next launch would forget.
     */
    sidebarCollapse?: RigSidebarCollapseStore;
    /**
     * Whether this window offers the features that are not finished yet. A host
     * that remembers no such choice supplies none, and they stay withheld.
     */
    experiments?: ExperimentsStore;
    /**
     * Whether running session, project, and workspace titles shimmer. A host
     * without this preference uses the current product default.
     */
    titleShimmer?: TitleShimmerStore;
    /** Native or hosted-renderer update projected by the desktop host. */
    update?: AppRigUpdate;
    /** Applies the ready update. Absent in a plain browser surface. */
    onUpdateApply?: () => void;
    /** Native page renderer supplied only by the packaged Electron host. */
    browserContent?: BrowserContentRenderer;
    /**
     * Renders one HTML workspace file as a page. Supplied only by a host with an
     * engine to run it in; without one an HTML file opens as its source.
     */
    htmlPreview?: HtmlPreviewRenderer;
    /**
     * Shows one workspace picture or recording in a window of the host's own.
     * Supplied only by a host that has such a window; without one the file stays
     * in place.
     */
    mediaWindow?: MediaWindowOpener;
    /**
     * The addressed group — a project or one of its worktrees — and conversation,
     * read from the route by the caller. This surface never decides what is
     * shown; it renders the addressed group's sessions and asks for a different
     * address through `onChatSelect`.
     */
    groupId?: string;
    chatId?: string;
    /**
     * Addresses a Rig, a group in it, and optionally one of that group's
     * sessions; no group means that Rig's list.
     */
    onChatSelect(
        rigId: string,
        groupId: string | undefined,
        chatId?: string,
        replace?: boolean,
    ): void;
    /** Opens the local settings destination from the pinned sidebar footer. */
    onSettingsOpen(): void;
    /** Whether the URL addresses the addressed Rig's inbox of agent questions. */
    inboxOpen?: boolean;
    /** Addresses that inbox. */
    onInboxOpen?(): void;
    /** Whether the URL addresses the component workbench, in a development build. */
    blueprintOpen?: boolean;
    /** Addresses the workbench. */
    onBlueprintOpen?(): void;
}

/**
 * What the tab strip needs about the addressed group, flattened so a project and
 * a worktree open the same way. `create` is what a new session in it takes: the
 * project's root, or the worktree's checkout and its id.
 */
interface OpenGroup {
    readonly id: RigGroupId;
    readonly name: string;
    /**
     * The catch-all project for sessions started outside any repository. It is
     * addressed as a place rather than as a path, so the surface names it by its
     * house glyph and never spells its `~` out.
     */
    readonly home: boolean;
    readonly conversations: RigProjectGroup["conversations"];
    readonly changes: NonNullable<RigProjectGroup["changes"]>;
    readonly create?: RigSessionCreateInput;
    /**
     * Where the open group's checkout is in its own life, for a worktree. A
     * project has none: it is a directory Rig adopted rather than one it made,
     * so there is no moment at which it is being prepared.
     */
    readonly lifecycle?: RigGroupLifecycle;
    /** The checkout's path, so a notice about it can name the directory. */
    readonly path: string;
}

const APP_SHORTCUTS = {
    panelToggle: commandShortcut("j"),
    panelToggleAlternate: commandShortcut("b", { alt: true }),
    sessionCreate: commandShortcut("t"),
    tabClose: commandShortcut("w"),
    workspaceCreate: commandShortcut("n"),
} as const;
const PANEL_TOGGLE_HINT = {
    aria: `${APP_SHORTCUTS.panelToggle.aria} ${APP_SHORTCUTS.panelToggleAlternate.aria}`,
    caps: APP_SHORTCUTS.panelToggle.caps,
} as const;

/**
 * The rows one project contributes: the project itself, then a nested row per
 * worktree that has work in it. A row is the project's name and its picture,
 * both the daemon's — derived from the git remote — so a reader recognizes a
 * repository at a glance. Its path is deliberately not here: it is long enough
 * to crowd out the name it is supposed to disambiguate, and the heading over the
 * open project states it in full. The home project is the exception both ways:
 * it has no remote to derive a picture from, and an "H" plaque would read as one
 * more repository, so it wears a house instead.
 */
function sidebarItems(
    project: RigProjectGroup,
    titleShimmerEnabled: boolean,
    newWorkspaceShortcut: boolean,
): SidebarItem[] {
    const projectHasLineChanges = (project.addedLines ?? 0) > 0 || (project.deletedLines ?? 0) > 0;
    return [
        {
            id: project.id,
            kind: "project",
            label: project.name,
            labelShimmer: titleShimmerEnabled,
            initials: project.name.slice(0, 1).toUpperCase(),
            ...(project.kind === "home" ? { icon: "home" as const } : {}),
            ...(project.avatar ? { imageUrl: project.avatar.url } : {}),
            // The + always waits for hover, so a project at rest ends with its
            // delta on the same column as every other row and nothing is
            // holding a place open for a control the reader is not reaching for.
            action: {
                disabled: project.lifecycle.phase !== "ready",
                icon: "plus" as const,
                label: `New workspace in ${project.name}`,
                ...(newWorkspaceShortcut ? { shortcut: APP_SHORTCUTS.workspaceCreate } : {}),
                reveal: "hover" as const,
            },
            ...sidebarLifecycle(project.lifecycle),
            // Settings waits for hover beside the +, both laid over the lane
            // rather than placed in it. The home project is left out — its name
            // and its path are the machine's, so there is nothing there for the
            // reader to set.
            ...(project.kind === "home"
                ? {}
                : {
                      secondaryAction: {
                          icon: "settings" as const,
                          label: `Settings for ${project.name}`,
                          reveal: "hover" as const,
                      },
                  }),
            // A row only carries a status while one of its sessions is live.
            // Waiting is the low-priority modifier: any session doing real work
            // makes the row spin, and only an all-waiting row wears the clock.
            ...(project.activity === "running"
                ? { status: "working" as const }
                : project.activity === "waiting"
                  ? { status: "waiting" as const }
                  : {}),
            ...(project.conversations.some((conversation) => conversation.unread)
                ? { unread: true }
                : {}),
            ...(projectHasLineChanges
                ? {
                      changeStats: {
                          added: project.addedLines ?? 0,
                          deleted: project.deletedLines ?? 0,
                      },
                  }
                : {}),
        },
        ...project.worktrees.map((worktree) => ({
            id: worktree.id,
            kind: "workspace" as const,
            depth: 1,
            label: worktree.name,
            labelShimmer: titleShimmerEnabled,
            // Archiving throws away a checkout, so it stays out of sight until
            // the reader is actually on the row.
            action: {
                icon: "archive" as const,
                label: `Archive ${worktree.name}`,
                reveal: "hover" as const,
            },
            // A worktree whose checkout is still being made, could not be made,
            // or is no longer there says so on the row: the reader is looking at
            // a place they may be about to send work into.
            ...sidebarLifecycle(worktree.lifecycle),
            ...(worktree.activity === "running"
                ? { status: "working" as const }
                : worktree.activity === "waiting"
                  ? { status: "waiting" as const }
                  : {}),
            ...(worktree.conversations.some((conversation) => conversation.unread)
                ? { unread: true }
                : {}),
            ...((worktree.addedLines ?? 0) > 0 || (worktree.deletedLines ?? 0) > 0
                ? {
                      changeStats: {
                          added: worktree.addedLines ?? 0,
                          deleted: worktree.deletedLines ?? 0,
                      },
                  }
                : {}),
        })),
    ];
}

/**
 * The row treatment one worktree phase asks for, as `SidebarItem` names them.
 *
 * A ready worktree contributes nothing: it is an ordinary row, and the row is
 * then free to report the work happening inside it. The other three replace that
 * report, because a place that does not exist yet has nothing running in it and
 * a place that has gone is not somewhere to send work.
 */
function sidebarLifecycle(
    lifecycle: RigGroupLifecycle,
): Pick<SidebarItem, "lifecycle" | "lifecycleLabel"> {
    if (lifecycle.phase === "creating")
        return { lifecycle: "creating", lifecycleLabel: "creating" };
    if (lifecycle.phase === "failed") return { lifecycle: "failed", lifecycleLabel: "failed" };
    if (lifecycle.phase === "missing")
        return { lifecycle: "unavailable", lifecycleLabel: "missing" };
    return {};
}

/**
 * The phase a screen showing this worktree has to interrupt the reader with.
 *
 * A ready worktree and a project both answer `undefined`: the place is simply
 * there, and a notice saying so would sit permanently over every screen in the
 * application. The notice's own type leaves `ready` out for the same reason.
 */
function workspaceLifecyclePhase(
    lifecycle: RigGroupLifecycle | undefined,
): WorkspaceLifecyclePhase | undefined {
    if (lifecycle === undefined || lifecycle.phase === "ready") return undefined;
    return lifecycle.phase;
}

/** The row action ids the sidebar's context menu dispatches back to this surface. */
const ROW_MENU_ARCHIVE = "archive";
/**
 * Opens the row's naming surface: the settings dialog for a project, which is
 * where its name is set, and the rename field for a worktree, whose name is the
 * only thing there is to say about it.
 */
const ROW_MENU_RENAME = "rename";

/**
 * The context menu one sidebar row offers. Archiving is the only thing on it,
 * and it is a menu rather than a visible control because it throws work away:
 * archiving a project closes its conversations and removes every one of its
 * worktree checkouts. The home project is left out — it is the machine's default
 * place rather than a repository the reader adopted, so hiding it would only
 * bring it straight back the next time a session starts there.
 */
function rowMenuItems(projects: readonly RigProjectGroup[], item: SidebarItem): MenuItem[] {
    const owner = rowOwnerFind(projects, item.id);
    if (!owner) return [];
    if (owner.worktreeId)
        return [
            { kind: "item", id: ROW_MENU_RENAME, label: "Rename workspace", icon: "edit" },
            { kind: "separator" },
            {
                kind: "item",
                id: ROW_MENU_ARCHIVE,
                label: "Archive workspace",
                icon: "archive",
                danger: true,
            },
        ];
    // The home project's name is the machine's, not the reader's to set, so it
    // offers neither renaming nor archiving.
    if (owner.project.kind === "home") return [];
    return [
        { kind: "item", id: ROW_MENU_RENAME, label: "Project settings…", icon: "settings" },
        { kind: "separator" },
        {
            kind: "item",
            id: ROW_MENU_ARCHIVE,
            label: "Archive project",
            icon: "archive",
            danger: true,
        },
    ];
}

/**
 * The two regions a tab can be moved between, named once so the strip that
 * offers the move and the region that accepts it cannot drift apart.
 */
const TRANSFER_ZONE_MAIN = "rig-main";
const TRANSFER_ZONE_PANEL = "rig-panel";

/** Where a tab in the panel's strip can go: the main content, to its leading side. */
const PANEL_TRANSFER_TARGETS: readonly TabTransferTarget[] = [
    { zone: TRANSFER_ZONE_MAIN, label: "the main content", side: "leading" },
];

/** Where a tab in the main strip can go: the panel, to its trailing side. */
const MAIN_TRANSFER_TARGETS: readonly TabTransferTarget[] = [
    { zone: TRANSFER_ZONE_PANEL, label: "the side panel", side: "trailing" },
];

/** The live tool tabs currently drawn on one side of the workspace. */
function toolTabsPlaced(
    panel: RigPanelSnapshot,
    placement: "panel" | "main",
): readonly RigPanelTabSnapshot[] {
    return panel.tabs.filter((tab) => tab.placement === placement);
}

function panelCloseTargetFind(panel: RigPanelSnapshot): string | undefined {
    if (!panel.open || panel.activeViewId === "files") return undefined;
    if (panel.activeViewId === "activity") return "activity";
    if (panel.activeViewId === "preview") return panel.previewEntryId ? "preview" : undefined;
    if (panel.activeViewId === "file") return panel.fileViewOpen ? "file" : undefined;
    const tab = panel.tabs.find(
        (entry) => entry.id === panel.activeViewId && entry.placement === "panel",
    );
    return tab?.id;
}

/** One tab per tool, iconed by what it holds. */
function toolTabItems(tabs: readonly RigPanelTabSnapshot[]): TabItem[] {
    return tabs.map((tab) => ({
        closable: true,
        id: tab.id,
        label: tab.label,
        icon: tab.kind === "terminal" ? ("terminal" as const) : ("globe" as const),
    }));
}

/** The project a sidebar row belongs to, and whether the row is one of its worktrees. */
function rowOwnerFind(
    projects: readonly RigProjectGroup[],
    id: string,
): { readonly project: RigProjectGroup; readonly worktreeId?: RigWorktreeId } | undefined {
    for (const project of projects) {
        if (project.id === id) return { project };
        for (const worktree of project.worktrees)
            if (worktree.id === id) return { project, worktreeId: worktree.id };
    }
    return undefined;
}

/** A group with no conversation has no transcript; the constant keeps the prop stable. */
const NO_ENTRIES: readonly ConversationEntry[] = [];

/** Resolves the selected preview against the current immutable conversation snapshot. */
function previewToolFind(
    conversation: RigWorkspaceSnapshot["conversation"],
    entryId: string | undefined,
): ConversationToolCall | undefined {
    if (entryId === undefined || conversation.type !== "ready") return undefined;
    const entry = conversation.value.entries.find(
        (candidate) => candidate.kind === "agentActivity" && candidate.id === entryId,
    );
    return entry?.kind === "agentActivity" && entry.activity.kind === "tool"
        ? entry.activity.tool
        : undefined;
}

/** One tab per session in the open group, marked while the agent is working. */
function sessionTabs(group: OpenGroup, titleShimmerEnabled: boolean): TabItem[] {
    return group.conversations.map((summary) => ({
        id: summary.id,
        label: summary.title,
        labelShimmer: titleShimmerEnabled,
        // The session's own id, so the mark survives every rename of the title.
        avatarId: summary.id,
        // Both are stated even when false: a session tab holds its leading lane
        // open, so work starting or finishing makes the mark appear and go
        // without sliding the title sideways under the reader.
        busy: summary.activity === "running",
        waiting: summary.activity === "waiting",
        unread: summary.unread === true,
    }));
}

/**
 * The group's tabs in the order the workspace records. Tabs it has no position
 * for follow in the order they arrived, so one opened this instant lands at the
 * end of the strip instead of appearing somewhere in the middle of it.
 */
function tabsOrdered(items: readonly TabItem[], order: readonly string[]): TabItem[] {
    const remaining = new Map(items.map((item) => [item.id, item]));
    const placed = order.flatMap((id) => {
        const item = remaining.get(id);
        if (!item) return [];
        remaining.delete(id);
        return [item];
    });
    return [...placed, ...remaining.values()];
}

/** The tab action ids the strip's context menu dispatches back to this surface. */
const TAB_MENU_CLOSE = "close";
const TAB_MENU_CLOSE_OTHERS = "close-others";
const TAB_MENU_CLOSE_LEFT = "close-left";
const TAB_MENU_CLOSE_RIGHT = "close-right";
const TAB_MENU_CLOSE_ALL = "close-all";
const fileDocumentIdentities = new WeakMap<object, number>();
let fileDocumentIdentityNext = 0;

/**
 * The context menu one tab offers: the usual sweeps — this tab, the others,
 * everything to one side, the whole strip. Closing a session tab archives the
 * session, so a session tab's menu says "archive", while a file tab, whose
 * closing throws nothing away, says "close". A sweep still applies each tab's
 * own close semantics whatever the word on the item that started it. A sweep
 * with nothing to act on stays visible but disabled, so the menu keeps one
 * shape wherever it opens.
 */
function tabStripMenu(verb: "Archive" | "Close", left: number, right: number): MenuItem[] {
    return [
        { kind: "item", id: TAB_MENU_CLOSE, label: `${verb} tab` },
        { kind: "separator" },
        {
            kind: "item",
            id: TAB_MENU_CLOSE_OTHERS,
            label: `${verb} other tabs`,
            disabled: left + right === 0,
        },
        {
            kind: "item",
            id: TAB_MENU_CLOSE_LEFT,
            label: `${verb} tabs to the left`,
            disabled: left === 0,
        },
        {
            kind: "item",
            id: TAB_MENU_CLOSE_RIGHT,
            label: `${verb} tabs to the right`,
            disabled: right === 0,
        },
        { kind: "separator" },
        { kind: "item", id: TAB_MENU_CLOSE_ALL, label: `${verb} all tabs` },
    ];
}

function fileTabDirty(tab: RigFileTabSnapshot): boolean {
    if (tab.draft === undefined || tab.document.type !== "ready") return false;
    const document = tab.document.value;
    const saved =
        "newContent" in document
            ? document.newContent
            : "content" in document
              ? document.content
              : undefined;
    return saved !== undefined && tab.draft !== saved;
}

/**
 * Exact identity of the ready document a file tab is currently drawing.
 *
 * A Git revision can advance before its replacement read settles while the old
 * ready document deliberately stays visible. Keying the editor from the loaded
 * object keeps that old parsed state attached to the old content until the new
 * document actually arrives. Weak keys add no lifetime beyond the tab/cache.
 */
function fileDocumentKey(tabId: string, document: object): string {
    let identity = fileDocumentIdentities.get(document);
    if (identity === undefined) {
        fileDocumentIdentityNext += 1;
        identity = fileDocumentIdentityNext;
        fileDocumentIdentities.set(document, identity);
    }
    return `${tabId}\u0000${String(identity)}`;
}

function fileTabItem(tab: RigFileTabSnapshot): TabItem {
    // A tab of a picture says picture. Wearing the document glyph over every
    // open file made the strip a row of identical marks with only the name to
    // tell them apart.
    const kind = tab.kind === "media" ? filePreviewKind(tab.path) : undefined;
    return {
        id: tab.id,
        label: tab.path.split("/").at(-1) ?? tab.path,
        dirty: fileTabDirty(tab),
        icon:
            tab.kind === "document"
                ? "globe"
                : kind === "image"
                  ? "image"
                  : kind === "video" || kind === "audio"
                    ? "play"
                    : "doc",
        preview: tab.preview,
    };
}

/**
 * How opening one file should show it.
 *
 * A picture, a video, or an archive has no text view worth offering, and asking
 * for one only produced "Binary files cannot be opened in the editor." over the
 * thing the reader just clicked — so those open as media regardless of scope.
 * Everything else keeps the scope's answer: the whole checkout opens the file
 * itself, the changed list opens what changed in it.
 */
function fileTabKind(path: string, scope: RigFileScope): RigFileTabKind {
    const kind = filePreviewKind(path);
    if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") return "media";
    if (kind === "binary") return "media";
    // An HTML file is text that is also a page. It opens as the page, with its
    // source a toggle away, even out of the changed list: someone opening a
    // document wants to see the document.
    if (kind === "html") return "document";
    return scope === "all" ? "file" : "diff";
}

function fileHighlightLanguageKey(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    // Pierre resolves language from the complete basename. Keeping the
    // complete name avoids treating `component.d.ts` and `component.ts` as
    // interchangeable cache entries just because their final extension agrees.
    return name;
}

/** Compact identity shared by saved source previews with the same bytes/language. */
function fileHighlightCacheKey(path: string, hash: string): string {
    return `h:${hash}:${fileHighlightLanguageKey(path)}`;
}

function markdownHighlightCacheKey(path: string, hash: string): string {
    return `m:${hash}:${fileHighlightLanguageKey(path)}`;
}

/**
 * One path as the checkout addresses it. A transcript names files the way the
 * agent saw them, which is usually an absolute path on the machine running the
 * session; the host reads paths inside the checkout, so its root is stripped
 * when the path is under it and the path is otherwise passed through unchanged.
 * A leading `./` is the same file written the way a shell prompt writes it, and
 * the host addresses that file without it.
 */
function workspacePathRelative(path: string, root: string | undefined): string {
    const normalized = path.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "");
    if (root === undefined) return normalized;
    const base = root.replaceAll("\\", "/").replace(/\/+$/u, "");
    return base.length > 0 && normalized.startsWith(`${base}/`)
        ? normalized.slice(base.length + 1)
        : normalized;
}

/**
 * A link inside a rendered document, resolved against the document holding it.
 * `../DESIGN.md` in `docs/guide.md` is `DESIGN.md`, which is the file the reader
 * asked for; an absolute path names itself.
 */
function documentLinkResolve(from: string, href: string): string {
    if (href.startsWith("/")) return href;
    const segments = from.split("/").slice(0, -1);
    for (const segment of href.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") segments.pop();
        else segments.push(segment);
    }
    return segments.join("/");
}

/** Resolves an addressed group id against the list, matching projects and worktrees alike. */
function openGroupFind(
    projects: readonly RigProjectGroup[],
    groupId: string | undefined,
): OpenGroup | undefined {
    if (groupId === undefined) return undefined;
    for (const project of projects) {
        if (project.id === groupId)
            return {
                id: project.id,
                name: project.name,
                home: project.kind === "home",
                conversations: project.conversations,
                changes: project.changes ?? [],
                create: { cwd: project.path },
                lifecycle: project.lifecycle,
                path: project.displayPath,
            };
        for (const worktree of project.worktrees)
            if (worktree.id === groupId)
                return {
                    id: worktree.id,
                    name: worktree.name,
                    home: false,
                    conversations: worktree.conversations,
                    changes: worktree.changes ?? [],
                    create: { cwd: worktree.path, worktreeId: worktree.id },
                    lifecycle: worktree.lifecycle,
                    path: worktree.displayPath,
                };
    }
    return undefined;
}

/**
 * The composer prompt names where the message lands. A window holds several
 * projects and worktrees at once, and their names read as anything from `happy2`
 * to `Fix login redirect`, so the group is quoted rather than glued into a
 * sentence that only reads well for one kind of title.
 */
function composerPlaceholder(groupName: string | undefined): string {
    return groupName === undefined ? "Message Happy…" : `Message Happy in “${groupName}”…`;
}

/** A sidebar row's id: which Rig it belongs to, then the group inside it. */
function rigItemId(rigId: string, id: string): string {
    return `${rigId}/${id}`;
}

function rigItemParse(value: string): { readonly rigId: string; readonly id: string } {
    const boundary = value.indexOf("/");
    return boundary < 0
        ? { id: "", rigId: value }
        : { id: value.slice(boundary + 1), rigId: value.slice(0, boundary) };
}

/**
 * The window's Rigs, each with its own projects, as one sidebar. Every row is
 * addressed by its Rig and then by the group inside it, so a project on another
 * machine is selected, renamed, archived, and reordered through exactly the same
 * controls as one on this machine — against that machine's own workspace store.
 *
 * A machine that is not connected keeps the projects and work last confirmed
 * from it. Those rows remain navigation targets while their Rig-backed actions
 * are disabled; reachability changes the section's state, not its membership.
 */
/**
 * The pinned rows in the order this window keeps them. A row the reader has
 * never moved — a newly reachable machine, for example — stays where the window
 * offered it, so an arrangement is a decision about the rows it was made about
 * and nothing else.
 */
function pinnedArrange(rows: readonly SidebarItem[], order: readonly string[]): SidebarItem[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rigNavigationOrderApply(
        rows.map((row) => row.id),
        order,
    ).flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
    });
}

function rigSidebarItemAvailability(
    item: SidebarItem,
    rig: AppRigEntry,
): Pick<SidebarItem, "action" | "secondaryAction"> {
    const disconnected = rig.status !== "connected";
    return {
        ...(item.action && disconnected
            ? { action: { ...item.action, disabled: true } }
            : item.action
              ? { action: item.action }
              : {}),
        ...(item.secondaryAction && disconnected
            ? { secondaryAction: { ...item.secondaryAction, disabled: true } }
            : item.secondaryAction
              ? { secondaryAction: item.secondaryAction }
              : {}),
    };
}

/**
 * The sections with the reader's folding applied, marked on the rows that carry
 * something nested under them.
 *
 * Said once over the finished sections rather than inside each builder above:
 * every one of them states rows with a depth, the row ids are only their final
 * ones by the time they reach here, and folding is one fact about the sidebar
 * rather than something a project, a folder and a contact list should each have
 * to remember. A row nothing is nested under is left alone, so it never claims a
 * fold that would do nothing.
 */
function sectionsCollapsed(
    sections: readonly SidebarSection[],
    collapsed: ReadonlySet<string>,
): SidebarSection[] {
    if (collapsed.size === 0) return sections as SidebarSection[];
    return sections.map((section) => ({
        ...section,
        items: section.items.map((item, index) =>
            collapsed.has(item.id) && (section.items[index + 1]?.depth ?? 0) > (item.depth ?? 0)
                ? { ...item, collapsed: true }
                : item,
        ),
    }));
}

function rigSections(
    directory: AppRigDirectorySnapshot,
    titleShimmerEnabled: boolean,
    shortcutProject?: { readonly projectId: RigProjectId; readonly rigId: string },
): SidebarSection[] {
    return directory.rigs.map((rig) => ({
        id: `rig:${rig.id}`,
        label: rig.label,
        status: rigConnectionState(rig),
        items: rig.projects
            .flatMap((project) =>
                sidebarItems(
                    project,
                    titleShimmerEnabled,
                    shortcutProject?.rigId === rig.id && shortcutProject.projectId === project.id,
                ),
            )
            .map((item) => ({
                ...item,
                id: rigItemId(rig.id, item.id),
                ...rigSidebarItemAvailability(item, rig),
            })),
        // Project creation belongs to the Rig named by this section.
        ...(rig.status === "connected" && rig.session
            ? {
                  action: {
                      busy: rig.projectAdd?.pending === true,
                      icon: "plus" as const,
                      label: "Add project",
                      reveal: "always" as const,
                  },
                  ...(rig.projectAdd?.error !== undefined ? { error: rig.projectAdd.error } : {}),
              }
            : {}),
        // What a Rig said when it failed belongs under its own heading.
        ...(rig.status === "error" && rig.message !== undefined ? { error: rig.message } : {}),
        ...(rig.projects.length === 0
            ? {
                  empty:
                      rig.status === "connected"
                          ? {
                                actionLabel: "Add project",
                                description: "Choose a repository folder on this Mac.",
                                icon: "plus" as const,
                                title: "No projects yet",
                            }
                          : {
                                description: rigEmptyDescription(rig),
                                icon: "link" as const,
                                title: rigStatusLabel(rig),
                                actionLabel: "Open settings",
                            },
              }
            : {}),
    }));
}

/**
 * Command-number destinations prioritize the project somebody is working in:
 * its main checkout is always first, followed by its visible workspaces. Any
 * remaining digits focus other projects in the sidebar's ordinary top-to-bottom
 * Rig/project order. Sidebar intersects this order with the rows it actually
 * draws, so a folded workspace consumes no number.
 */
function projectShortcutTargets(
    directory: AppRigDirectorySnapshot,
    activeRigId: string | undefined,
    activeProjectId: RigProjectId | undefined,
): readonly SidebarNumberShortcutTarget[] {
    const activeRig = directory.rigs.find((rig) => rig.id === activeRigId);
    const activeProject = activeRig?.projects.find((project) => project.id === activeProjectId);
    const target = (
        rig: AppRigEntry,
        id: RigProjectId | RigWorktreeId,
    ): SidebarNumberShortcutTarget => ({
        itemId: rigItemId(rig.id, id),
        sectionId: `rig:${rig.id}`,
    });
    return [
        ...(activeRig && activeProject
            ? [
                  target(activeRig, activeProject.id),
                  ...activeProject.worktrees.map((worktree) => target(activeRig, worktree.id)),
              ]
            : []),
        ...directory.rigs.flatMap((rig) =>
            rig.projects.flatMap((project) =>
                rig.id === activeRig?.id && project.id === activeProject?.id
                    ? []
                    : [target(rig, project.id)],
            ),
        ),
    ];
}

/**
 * One Rig's heading marker, projected from its connection state.
 */
function rigConnectionState(rig: AppRigEntry) {
    return rig.status;
}

/** One directory entry's unified inner-health and outer-route availability. */
function rigEntryAvailability(rig: AppRigEntry): RigAvailabilitySnapshot | undefined {
    if (!rig.session) return undefined;
    return rigAvailabilityProject(rig.session.connection.get(), true, {
        status: rig.status,
        ...(rig.message === undefined ? {} : { message: rig.message }),
    });
}

/** The primary Rig backing window-wide settings and chrome. */
export function hostRig(directory: AppRigDirectorySnapshot): AppRigEntry | undefined {
    return directory.rigs[0];
}

/**
 * What a section says when it is standing empty because its machine has not
 * answered.
 *
 * It does not say there is nothing there. Whatever that machine holds is
 * unknown while the connection is down, and telling the reader their work is
 * gone would be a worse mistake than telling them nothing. So this says only
 * where the connection stands; the failure itself is already stated under the
 * heading, and is not repeated here.
 */
function rigEmptyDescription(rig: AppRigEntry): string {
    if (rig.status === "connecting") return "Connecting to this machine…";
    if (rig.status === "error") return "Its projects will appear once it answers again.";
    return "Connect this machine to see its projects.";
}

function rigStatusLabel(rig: AppRigEntry): string {
    if (rig.status === "connected") return "Connected";
    if (rig.status === "connecting") return "Connecting…";
    return rig.status === "error" ? "Not reachable" : "Disconnected";
}

/**
 * The pinned row that opens the addressed Rig's inbox. It belongs with the
 * pinned rows rather than under a project because the questions it collects come
 * from every session on that machine at once, and the person answering them is
 * working through a queue rather than visiting a repository.
 */
const INBOX_ITEM = "inbox";

/**
 * The workspace window. It owns no product state: it subscribes to the directory
 * of Rigs, renders their projects as one sidebar, and hands the addressed Rig's
 * own stores to the surface below. A Rig that is still connecting, or one the
 * reader has disconnected from, keeps the sidebar and states itself in the
 * content area instead of taking the window away.
 */
export function AppRigView(props: AppRigViewProps) {
    const directory = useSyncExternalStore(props.rigs.subscribe, props.rigs.get, props.rigs.get);
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    const titleShimmerStore = props.titleShimmer ?? titleShimmerStoreNoop;
    const titleShimmerEnabled = useSyncExternalStore(
        titleShimmerStore.subscribe,
        titleShimmerStore.get,
        titleShimmerStore.get,
    ).titleShimmerEnabled;
    // The order the reader arranged the pinned rows in belongs to the window
    // rather than to any one Rig, so a machine going away rearranges nothing.
    const experimentsStore = props.experiments ?? experimentsStoreNoop;
    // The inbox and folders are still being built, so they are offered only to
    // a reader who has asked for unfinished work in settings. The switch is
    // read here so their routes, sidebar rows, and dialogs cannot disagree
    // about whether the surfaces exist.
    const experimental = useSyncExternalStore(
        experimentsStore.subscribe,
        experimentsStore.get,
        experimentsStore.get,
    ).experimentalFeaturesEnabled;
    const navigationOrderStore = props.navigationOrder ?? rigNavigationOrderStoreNoop;
    const navigationOrder = useSyncExternalStore(
        navigationOrderStore.subscribe,
        navigationOrderStore.get,
        navigationOrderStore.get,
    );
    // Which projects and folders the reader folded shut. Like the order above it
    // this belongs to the window: a machine going away must not unfold the tree
    // somebody arranged, and coming back must not fold it again.
    const sidebarCollapseStore = props.sidebarCollapse ?? rigSidebarCollapseStoreNoop;
    const sidebarCollapse = useSyncExternalStore(
        sidebarCollapseStore.subscribe,
        sidebarCollapseStore.get,
        sidebarCollapseStore.get,
    );
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const active =
        directory.rigs.find((rig) => rig.id === props.rigId) ?? directory.rigs[0] ?? undefined;
    const viewerId = rigOwnerAuthor.id;
    const activeAvailability = active ? rigEntryAvailability(active) : undefined;
    const addressedProject =
        active && props.groupId ? rowOwnerFind(active.projects, props.groupId)?.project : undefined;
    const shortcutProject = activeAvailability?.online ? addressedProject : undefined;
    const workspaceCreateTarget =
        active && shortcutProject?.lifecycle.phase === "ready"
            ? { projectId: shortcutProject.id, rigId: active.id }
            : undefined;
    const activeRigOnline = (): boolean => {
        const current = props.rigs.get();
        const rig =
            current.rigs.find((entry) => entry.id === props.rigId) ?? current.rigs[0] ?? undefined;
        return rig ? (rigEntryAvailability(rig)?.online ?? false) : false;
    };
    const rigOf = (rigId: string) => directory.rigs.find((rig) => rig.id === rigId);
    // The pinned row carries a live count, so the window subscribes to the
    // addressed Rig's inbox whether or not the inbox itself is open: the point of
    // the count is to be seen while the reader is doing something else.
    const inboxStore = active?.session?.inbox ?? rigInboxStoreNoop;
    const inbox = useSyncExternalStore(inboxStore.subscribe, inboxStore.get, inboxStore.get);
    const inboxPending = inbox.pending.length;
    const desktop = props.platform === "desktop";
    const sidebarUpdate = props.update ? (
        <SidebarUpdateAction
            action={props.update.action}
            detail={props.update.detail}
            onAction={props.update.status === "downloaded" ? props.onUpdateApply : undefined}
            status={props.update.status}
            version={props.update.version}
        />
    ) : undefined;
    // The pinned rows as the window offers them. What the reader has made of
    // that order is applied below, so this list only ever states which rows this
    // window has and what each one is.
    // The inbox belongs to the addressed machine, so it appears only while that
    // machine is reachable: a queue of questions is meaningless from a Rig that
    // cannot say what it is waiting on.
    const pinnedOffered: SidebarItem[] =
        experimental && active?.session?.inbox
            ? [
                  {
                      badge: inboxPending,
                      icon: "bell",
                      id: INBOX_ITEM,
                      kind: "action",
                      label: "Inbox",
                  },
              ]
            : [];
    const pinned = pinnedArrange(pinnedOffered, navigationOrder.order);
    const sidebar = (
        <Sidebar
            actions={pinned}
            numberShortcuts="navigate"
            numberShortcutTargets={projectShortcutTargets(
                directory,
                active?.id,
                addressedProject?.id,
            )}
            activeItemId={
                experimental && props.inboxOpen
                    ? INBOX_ITEM
                    : props.groupId
                      ? rigItemId(props.rigId, props.groupId)
                      : ""
            }
            // The desktop window puts the traffic lights and the sidebar
            // toggle in this heading, so the product mark stands down and the
            // row becomes the window's drag lane. Full screen takes the lights
            // away, and the whole lockup heads the sidebar there — on the same
            // lane as the rows beneath it — rather than leaving the window's
            // top-left corner empty.
            brand={desktop ? windowState.fullScreen : true}
            composeLabel="Create"
            footer={
                <SidebarFooter
                    actions={sidebarUpdate}
                    appearance={appearance.appearance}
                    devMenu={
                        props.buildIdentity ? (
                            <DevBuildMenu
                                branch={props.buildIdentity.branch}
                                label={props.buildIdentity.label}
                                onBlueprintOpen={props.onBlueprintOpen}
                                onCopyPath={() =>
                                    void navigator.clipboard
                                        .writeText(props.buildIdentity!.path)
                                        .catch(() => undefined)
                                }
                                path={props.buildIdentity.path}
                            />
                        ) : undefined
                    }
                    onAppearanceToggle={() => props.appearance.appearanceToggle()}
                    onSettingsOpen={props.onSettingsOpen}
                />
            }
            headerAccessory={
                active && active.status !== "connected" ? (
                    <Banner tone={active.status === "error" ? "danger" : "neutral"}>
                        {active.message ??
                            (active.status === "connecting"
                                ? `Connecting to ${active.label}…`
                                : `${active.label} is disconnected.`)}
                    </Banner>
                ) : active?.projectsStatus === "error" ? (
                    <Banner
                        action={{
                            label: "Retry",
                            onClick: () => active.session?.workspace.conversationListRetry(),
                        }}
                        tone="danger"
                        title="Sessions unavailable"
                    >
                        {`${active.label} did not return its projects.`}
                    </Banner>
                ) : active?.projectsStatus === "loading" ? (
                    <Banner tone="neutral">Loading sessions…</Banner>
                ) : undefined
            }
            itemMenuItems={(item) => {
                const row = rigItemParse(item.id);
                const rig = rigOf(row.rigId);
                if (rig?.status !== "connected") return [];
                return rowMenuItems(rig.projects, { ...item, id: row.id });
            }}
            // Create is the window's, not a screen's: the dialog is mounted
            // beside whatever is showing, so this row answers from every route.
            // It is offered only while there is a machine to start a session on,
            // because a Create that opened nothing would be worse than no row.
            {...(activeAvailability?.online === true && active?.session?.workspace
                ? { onCompose: () => active.session?.workspace.createOpen() }
                : {})}
            // The section action adds a project to the Rig named by that section.
            onSectionAction={(sectionId) => {
                const rig = rigOf(sectionId.slice("rig:".length));
                if (rig?.status !== "connected") {
                    props.onSettingsOpen();
                    return;
                }
                const workspace = rig.session?.workspace;
                if (!workspace) return;
                workspace.projectAdd();
            }}
            onItemMenuSelect={(item, actionId) => {
                const row = rigItemParse(item.id);
                const rig = rigOf(row.rigId);
                if (!rig) return;
                if (rig.status !== "connected") return;
                const workspace = rig.session?.workspace;
                const owner = rowOwnerFind(rig.projects, row.id);
                if (!owner || !workspace) return;
                if (actionId === ROW_MENU_RENAME) {
                    workspace.renameOpen(owner.project.id, owner.worktreeId);
                    return;
                }
                if (actionId !== ROW_MENU_ARCHIVE) return;
                // Deliberately no navigation here. An archive that the host
                // refuses would have ejected the reader from a project that is
                // still there, and an archive performed from another window or
                // another machine would not have moved them at all. Leaving the
                // addressed group is one thing, driven by the host's own catalog
                // no longer holding it, and the workspace reports that.
                void (
                    owner.worktreeId
                        ? workspace.worktreeArchive(owner.project.id, owner.worktreeId)
                        : workspace.projectArchive(owner.project.id)
                ).catch(() => undefined);
            }}
            // Addressing a group opens the tab it was left on, so a list row
            // lands back where the reader was rather than on an empty screen.
            // Once every remembered tab is gone, its first session is what the
            // group still has to show.
            onItemSelect={(id) => {
                if (id === INBOX_ITEM) {
                    props.onInboxOpen?.();
                    return;
                }
                const row = rigItemParse(id);
                const rig = rigOf(row.rigId);
                if (!rig) return;
                const groupId = row.id as RigGroupId;
                props.onChatSelect(
                    rig.id,
                    row.id,
                    // A workspace that has not recorded where this project was
                    // left falls back to its most recent conversation, which is
                    // also what a workspace without the memory at all does.
                    rig.session?.workspace.get().groupResume?.get(groupId) ??
                        openGroupFind(rig.projects, row.id)?.conversations[0]?.id,
                );
            }}
            onItemAction={(id) => {
                const row = rigItemParse(id);
                const rig = rigOf(row.rigId);
                if (!rig) return;
                if (rig.status !== "connected") return;
                const workspace = rig.session?.workspace;
                const owner = rowOwnerFind(rig.projects, row.id);
                if (!owner || !workspace) return;
                // The plus on a project adds a worktree; the control on a
                // worktree archives it.
                void (
                    owner.worktreeId
                        ? workspace.worktreeArchive(owner.project.id, owner.worktreeId)
                        : workspace.worktreeCreate(owner.project.id)
                ).catch(() => undefined);
            }}
            // The cog on a project row. Only project rows carry one, and the
            // settings surface is the same one the row's menu opens.
            onItemSecondaryAction={(id) => {
                const row = rigItemParse(id);
                const rig = rigOf(row.rigId);
                if (!rig) return;
                if (rig.status !== "connected") return;
                const workspace = rig.session?.workspace;
                const owner = rowOwnerFind(rig.projects, row.id);
                if (!owner || owner.worktreeId || !workspace) return;
                workspace.renameOpen(owner.project.id, undefined);
            }}
            {...(props.navigationOrder
                ? {
                      onActionReorder: (move: SidebarReorder) => {
                          props.navigationOrder?.itemReorder(
                              move.id,
                              move.afterId,
                              pinned.map((row) => row.id),
                          );
                      },
                  }
                : {})}
            onItemReorder={(sectionId, move) => {
                const rig = rigOf(sectionId.slice("rig:".length));
                if (rig?.status !== "connected") return;
                const workspace = rig?.session?.workspace;
                if (!workspace) return;
                const moved = rigItemParse(move.id).id;
                const after = move.afterId === null ? null : rigItemParse(move.afterId).id;
                // A drag inside a project rearranges its worktrees; a drag
                // at the top level rearranges the projects themselves.
                void (
                    move.parentId
                        ? workspace.worktreeReorder(
                              rigItemParse(move.parentId).id as RigProjectId,
                              moved as RigWorktreeId,
                              after as RigWorktreeId | null,
                          )
                        : workspace.projectReorder(
                              moved as RigProjectId,
                              after as RigProjectId | null,
                          )
                ).catch(() => undefined);
            }}
            // A row is folded shut by this window's own record, so a project
            // whose checkouts are hidden stays hidden as its Rig comes and goes.
            {...(props.sidebarCollapse
                ? {
                      onItemCollapseToggle: (id: string) => {
                          sidebarCollapseStore.rowCollapseToggle(id);
                      },
                  }
                : {})}
            sections={sectionsCollapsed(
                rigSections(directory, titleShimmerEnabled, workspaceCreateTarget),
                sidebarCollapse.collapsed,
            )}
        />
    );

    // Which screen the window is showing. It is a value rather than a set of
    // early returns because the window's own dialogs are mounted beside it: a
    // surface that answers on one route and not another is not a window-level
    // surface at all.
    const routeContent = (): ReactNode => {
        // The workbench belongs to no machine and needs no connection: it renders the
        // component pages themselves, so it is independent of every Rig.
        if (props.blueprintOpen)
            return (
                <>
                    {desktop ? <WindowDragRegion /> : null}
                    <BlueprintView />
                </>
            );

        // The inbox belongs to the addressed machine, so it is shown only while that
        // machine has stores to answer through.
        if (experimental && props.inboxOpen && active?.session?.inbox)
            return (
                <>
                    {desktop ? <WindowDragRegion /> : null}
                    <RigInboxSurface
                        onOpenSession={(rigId, groupId, chatId) =>
                            props.onChatSelect(rigId, groupId, chatId)
                        }
                        projects={active.projects}
                        rigId={active.id}
                        rigOnline={activeRigOnline}
                        snapshot={inbox}
                        store={active.session.inbox}
                        {...(activeAvailability?.refusal === undefined
                            ? {}
                            : { unavailable: activeAvailability.refusal })}
                    />
                </>
            );

        if (active?.session)
            return (
                <RigWorkspaceSurface
                    availability={
                        activeAvailability ??
                        rigAvailabilityProject(active.session.connection.get(), true, {
                            status: active.status,
                            ...(active.message === undefined ? {} : { message: active.message }),
                        })
                    }
                    appearance={props.appearance}
                    browserContent={props.browserContent}
                    htmlPreview={props.htmlPreview}
                    mediaWindow={props.mediaWindow}
                    chatId={props.chatId}
                    clock={active.session.clock}
                    connection={active.session.connection}
                    groupId={props.groupId}
                    key={active.id}
                    onChatSelect={(groupId, chatId, replace) =>
                        props.onChatSelect(active.id, groupId, chatId, replace)
                    }
                    platform={props.platform}
                    projects={active.projects}
                    rigOnline={activeRigOnline}
                    titleShimmerEnabled={titleShimmerEnabled}
                    viewerId={viewerId}
                    workspace={active.session.workspace}
                    {...(workspaceCreateTarget
                        ? { workspaceCreateProjectId: workspaceCreateTarget.projectId }
                        : {})}
                />
            );
        // The host Rig has no live stores yet — it is still connecting, or it could
        // not be reached. The sidebar stays so the window keeps its shape while
        // that resolves; anything the reader can do about it is a settings act,
        // which is where the control points.
        return (
            <>
                {desktop ? <WindowDragRegion /> : null}
                <EmptyState
                    action={{
                        label: "Open settings",
                        icon: "settings",
                        onClick: props.onSettingsOpen,
                    }}
                    description={
                        active
                            ? (active.message ??
                              (active.status === "connecting"
                                  ? `Connecting to ${active.label}…`
                                  : `${active.label} is disconnected.`))
                            : "Waiting for this machine's Rig."
                    }
                    icon={active?.status === "error" ? "shield" : "link"}
                    size="panel"
                    title={active ? active.label : "No machine"}
                />
            </>
        );
    };

    return (
        <>
            {/* Window chrome has one lifetime. Rig workspaces keep their own
                keyed lifetimes inside its content region, so changing machines
                resets machine-owned UI without rebuilding this sidebar's DOM,
                focus, width, collapsed state, or scroll position. */}
            <AppShell
                sidebarCollapsible
                shortcutHints="interactive"
                windowControls={desktop}
                windowFullScreen={windowState.fullScreen}
                sidebar={sidebar}
            >
                {routeContent()}
            </AppShell>
            {/* The window's own dialogs, mounted once beside whatever screen is
                showing rather than inside one of them. Naming a row belongs to
                the sidebar, and Create belongs to the window: both are reached
                from chrome that is on every route, so a cog or a Create that
                answered on the workspace and did nothing on the inbox would not
                be a control. Being outside the screen is also what lets a task
                being written survive the route notifications underneath it. */}
            {active?.session?.workspace ? (
                <RigWindowDialogs
                    projects={active.projects}
                    rigOnline={activeRigOnline}
                    workspace={active.session.workspace}
                    {...(activeAvailability?.refusal === undefined
                        ? {}
                        : { unavailable: activeAvailability.refusal })}
                />
            ) : null}
        </>
    );
}

/**
 * One Rig's inbox inside the window's shell. It subscribes to nothing: the
 * window already reads this store for the sidebar count, so the queue and the
 * badge are one subscription and can never disagree about how many questions
 * are waiting.
 *
 * Naming an item's location and opening the session that asked are addressing
 * acts, which is why they live here rather than in the page: the page renders
 * questions, the window decides where they came from and where they lead.
 */
function RigInboxSurface(props: {
    onOpenSession(rigId: string, groupId: string, chatId: string): void;
    projects: readonly RigProjectGroup[];
    rigId: string;
    rigOnline: () => boolean;
    snapshot: RigInboxSnapshot;
    store: RigInboxStore;
    unavailable?: string;
}) {
    const locate = (item: RigInboxItem) => {
        const scope = item.scope;
        if (!scope) return undefined;
        const project = props.projects.find((candidate) => candidate.id === scope.projectId);
        if (!project) return undefined;
        if (scope.kind === "project") return project.name;
        const worktree = project.worktrees.find((candidate) => candidate.id === scope.worktreeId);
        return worktree ? `${project.name} · ${worktree.name}` : project.name;
    };
    return (
        <RigInboxPage
            answered={props.snapshot.answered}
            {...(props.snapshot.error ? { error: props.snapshot.error } : {})}
            itemLocation={locate}
            itemTime={(item) =>
                inboxItemTime(item.status === "answered" ? item.resolvedAt : item.createdAt)
            }
            loading={props.snapshot.loading}
            messages={props.snapshot.messages}
            onAnswer={(itemId, answers) => {
                if (props.rigOnline()) props.store.itemAnswer(itemId, answers);
            }}
            onMessageChange={(itemId, text) => props.store.itemMessageUpdate(itemId, text)}
            onMessageSubmit={(itemId) => {
                if (props.rigOnline()) props.store.itemMessageSubmit(itemId);
            }}
            onSelectionChange={(itemId, answers) =>
                props.store.itemSelectionUpdate(itemId, answers)
            }
            selections={props.snapshot.selections}
            onOpenSession={(item) => {
                if (!item.scope) return;
                props.onOpenSession(props.rigId, rigSessionGroupIdOf(item.scope), item.sessionId);
            }}
            pending={props.snapshot.pending}
            submissions={props.snapshot.submissions}
            {...(props.unavailable === undefined ? {} : { unavailable: props.unavailable })}
        />
    );
}

/** When a question was asked or settled, as an absolute local time. */
function inboxItemTime(value: number | undefined): string | undefined {
    if (value === undefined) return undefined;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
    );
}

interface RigWorkspaceSurfaceProps {
    /** Unified outer route and daemon health for this already materialized Rig. */
    availability: RigAvailabilitySnapshot;
    /** Daemon health owner; its retry action accelerates automatic recovery in place. */
    connection: RigConnectionStore;
    /** Re-reads unified availability when a retained network handler fires. */
    rigOnline: () => boolean;
    /** Joined conversation-list + active-conversation product store. */
    workspace: RigWorkspaceStore;
    /**
     * The Rig's projects, for the surfaces that address a project the window is
     * not currently open on — the settings dialog reached from any row.
     */
    projects: readonly RigProjectGroup[];
    /** Ticking clock feeding relative timestamps in the conversation list. */
    clock: RigClockStore;
    appearance: AppearanceStore;
    platform?: "desktop" | "web";
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    mediaWindow?: MediaWindowOpener;
    /** Whether active session titles shimmer in the tab strip. */
    titleShimmerEnabled: boolean;
    /** Identity of the human reading and writing this Rig. */
    viewerId: string;
    groupId?: string;
    chatId?: string;
    /** Ready online project that Cmd-N and its sidebar cap both address. */
    workspaceCreateProjectId?: RigProjectId;
    onChatSelect(groupId: string | undefined, chatId?: string, replace?: boolean): void;
}

/**
 * One Rig's workspace. It subscribes once each to that Rig's connection,
 * workspace, panel, clock, and appearance stores (no local React state) and
 * composes the shared `happy-desktop-ui` components, including `ConversationView`
 * for the selected conversation and the desktop affordances (the model and
 * effort pickers beneath the composer, the settings
 * dialog holding the view toggles and access pickers, and the usage and activity
 * panels) passed into that surface.
 *
 * The right panel is the workspace's tool column: terminals now, other kinds of
 * tab later. It is a second subscription rather than part of the workspace
 * snapshot because a live terminal repaints far faster than the conversation does
 * and must not drag this whole surface through a render to do it.
 *
 * Until this Rig's daemon connection is live it shows the connection status with
 * a retry. Which conversation is shown comes from the route through `chatId`, and
 * choosing another one is a navigation request; materialization and every draft
 * keystroke live in the workspace store outside React, so this component stays a
 * pure projection.
 */
function RigWorkspaceSurface(props: RigWorkspaceSurfaceProps) {
    const workspace = useSyncExternalStore(
        props.workspace.subscribe,
        props.workspace.get,
        props.workspace.get,
    );
    const panel = useSyncExternalStore(
        props.workspace.panel.subscribe,
        props.workspace.panel.get,
        props.workspace.panel.get,
    );
    const now = useSyncExternalStore(props.clock.subscribe, props.clock.get, props.clock.get);
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    // A materialized workspace is a Rig lifetime, not a connection lifetime.
    // Health only changes what this mounted surface may do and what it says
    // about the state already on screen.
    const availability = props.availability;
    const connectionRefusal = availability.refusal;
    const rigOnline = props.rigOnline;
    const terminalRigAvailability = availability.online
        ? undefined
        : availability.state === "reconnecting"
          ? ("reconnecting" as const)
          : ("unavailable" as const);

    // Inside an open project the directory is already decided, so every "new
    // session" affordance here starts one in it rather than asking again.
    const groupConversationCreate = (group: OpenGroup) => {
        if (!rigOnline() || !group.create) return;
        void props.workspace.conversationCreate(group.id, group.create).catch(() => undefined);
    };

    const projects = workspace.list.projects;
    const rows = projects.type === "ready" ? projects.value : [];
    // What may be done in the addressed checkout, as the state decided it.
    // Connection health stays separate: each control combines the relevant
    // durable refusal with connection state at the boundary where it acts.
    const access = workspace.groupAccess;
    // Why a chat cannot be started here or sent to. A workspace whose checkout
    // Rig is still preparing refuses the second and not the first, so the two
    // reasons are kept apart all the way down to the controls: a composer reads
    // this one, while file and terminal actions read the write refusal above it.
    const openGroupChatRefusal = access.conversationRefusal;
    const openGroup = openGroupFind(rows, props.groupId);
    const sessionCreateAvailable =
        openGroup?.create !== undefined &&
        connectionRefusal === undefined &&
        openGroupChatRefusal === undefined;
    const workspaceCreateProjectId = props.workspaceCreateProjectId;
    // The worktree phase this screen has to say something about. `ready` and a
    // project both leave it absent: there is nothing to interrupt the reader
    // with when the place they are looking at is simply there.
    const openGroupPhase = workspaceLifecyclePhase(openGroup?.lifecycle);
    // Whether that phase is the whole screen rather than a lane over it. It is,
    // and only is, when nothing has ever run here and nothing ever can: an empty
    // workspace that failed, was refused, or has lost its folder has no composer
    // worth drawing. One that is merely being prepared does — it takes chats
    // already — so the phase goes in the lane above it instead.
    const openGroupNotice =
        openGroup !== undefined &&
        openGroup.conversations.length === 0 &&
        openGroupPhase !== undefined &&
        !access.canConverse;
    // The one phase that takes the body of the first chat rather than a strip
    // above it. A workspace is addressed the instant it is asked for, so this is
    // the screen the reader lands on straight after clicking: the checkout being
    // prepared is the only thing happening here, so it is the only thing shown,
    // with the composer still live underneath it. Every control that would act
    // on a directory that is not there yet is withheld for the same reason —
    // there is nothing behind them to act on until the checkout arrives.
    const openGroupPreparing = openGroupPhase === "creating";
    const panelCloseTarget = openGroupPreparing ? undefined : panelCloseTargetFind(panel);
    // The address the reader was sent to when a creation was accepted locally
    // and then refused. There is no row at it any more — rig-connect withdrew
    // the one it had predicted — so the address answers for itself here rather
    // than falling through to "no project open".
    const refusedCreate =
        openGroup === undefined && props.groupId !== undefined
            ? workspace.list.worktreeCreateFailures.get(props.groupId as RigWorktreeId)
            : undefined;
    const groupFileTabs = openGroup
        ? workspace.fileTabs.filter(
              (tab) => tab.groupId === openGroup.id && tab.placement === "main",
          )
        : [];
    const activeFile = groupFileTabs.find((tab) => tab.id === workspace.activeMainViewId);
    const displayedFileTab = groupFileTabs.find((tab) => tab.id === workspace.displayedMainViewId);
    const displayedFile =
        displayedFileTab?.displayedDocument === undefined
            ? displayedFileTab
            : {
                  ...displayedFileTab,
                  kind: displayedFileTab.displayedKind ?? displayedFileTab.kind,
                  path: displayedFileTab.displayedPath ?? displayedFileTab.path,
                  document: {
                      type: "ready" as const,
                      value: displayedFileTab.displayedDocument,
                  },
              };
    const pendingFile =
        activeFile &&
        (workspace.displayedMainViewId !== activeFile.id ||
            (activeFile.displayedPresentationId !== activeFile.presentationId &&
                (activeFile.document.type !== "ready" ||
                    activeFile.document.value !== activeFile.displayedDocument)))
            ? activeFile
            : undefined;
    // Terminals and pages the reader moved out of the panel. They belong to the
    // addressed group the way the panel does, so they are listed and drawn here
    // only while that group is the one open.
    const mainTools = openGroup ? toolTabsPlaced(panel, "main") : [];
    const activeMainTool = mainTools.find((tab) => tab.id === workspace.activeMainViewId);
    const displayedMainTool = mainTools.find((tab) => tab.id === workspace.displayedMainViewId);
    const openInRecent = workspace.openInTargets.find(
        (target) => target.id === workspace.openInRecentId,
    );
    const conversation = workspace.conversation;
    const detachedConversationId =
        openGroup &&
        props.chatId &&
        !openGroup.conversations.some((summary) => summary.id === props.chatId)
            ? props.chatId
            : undefined;
    const detachedConversation =
        detachedConversationId && conversation.type === "ready" ? conversation.value : undefined;
    const detachedConversationTab: TabItem | undefined = detachedConversationId
        ? {
              id: detachedConversationId,
              icon: "agents",
              label: detachedConversation?.title ?? "Subagent",
              labelShimmer: props.titleShimmerEnabled,
              ...(detachedConversation?.running ? { busy: true } : {}),
          }
        : undefined;
    // Whether this group has anything to put in a tab strip at all. A group with
    // nothing open in it shows its composer alone; everywhere else the strip is
    // the frame, and a group that still has no session puts that same composer
    // underneath it rather than beside it.
    const groupTabbedPane =
        openGroup !== undefined &&
        (openGroup.conversations.length > 0 ||
            groupFileTabs.length > 0 ||
            mainTools.length > 0 ||
            detachedConversationTab !== undefined);
    // Sessions without a list position are delegated children. They remain
    // readable by id, but their runner owns their input and configuration.
    // A workspace that cannot take a chat cannot take a message into an old
    // conversation either: the session is pointed at a checkout that will never
    // be usable, so what it read before stays readable and its input closes with
    // the reason it closed for. A checkout merely still being prepared is not
    // that: Rig holds the message until the directory arrives, so the input
    // stays open and the reader can keep writing.
    const conversationReadOnly =
        detachedConversationId !== undefined || openGroupChatRefusal !== undefined;
    const conversationReadOnlyReason =
        detachedConversationId !== undefined
            ? "Subagent chats are read-only"
            : openGroupChatRefusal;
    // Stopping is not writing. An unusable checkout still has whatever was
    // already running in it, and leaving the reader unable to end that would be
    // work they can see, cannot write to, and cannot stop either.
    const conversationCanAbort =
        availability.online && detachedConversationId === undefined && access.canAbort;
    // One strip, holding the group's sessions and its open files together in
    // the single order the reader arranged. A detached subagent is addressed by
    // id rather than listed, so it is not part of that order and follows it.
    const groupTabs: TabItem[] = [
        ...tabsOrdered(
            openGroup
                ? [
                      ...sessionTabs(openGroup, props.titleShimmerEnabled).map((tab) =>
                          availability.online ? tab : { ...tab, closable: false },
                      ),
                      ...groupFileTabs.map(fileTabItem),
                      ...toolTabItems(mainTools),
                  ]
                : [],
            workspace.tabOrder,
        ),
        ...(detachedConversationTab ? [detachedConversationTab] : []),
    ];
    // Closing a tab archives the session behind it, while a file tab simply
    // closes. The close control and every context-menu sweep funnel through
    // this one routine, so a sweep behaves exactly like closing each tab by
    // hand. Navigation happens once, up front: when the addressed session is
    // among the closed, the surface addresses what will remain — preferring
    // the tab the sweep was asked to keep — before anything leaves the list,
    // so it never sits on a session that has just gone.
    const groupTabsClose = (tabIds: readonly string[], keepId?: string) => {
        const current = props.workspace.get();
        const currentRows =
            current.list.projects.type === "ready" ? current.list.projects.value : [];
        const currentGroup = openGroupFind(currentRows, current.address.groupId);
        if (!currentGroup) return;
        const panelNow = props.workspace.panel.get();
        const online = rigOnline();
        const sessionIds = new Set(currentGroup.conversations.map((summary) => summary.id));
        const fileIds = new Set(
            current.fileTabs
                .filter((tab) => tab.groupId === currentGroup.id && tab.placement === "main")
                .map((tab) => tab.id),
        );
        const toolIds = new Set<string>(
            panelNow.tabs.filter((tab) => tab.placement === "main").map((tab) => tab.id),
        );
        const closeableIds = tabIds.filter(
            (tabId) =>
                fileIds.has(tabId) ||
                toolIds.has(tabId) ||
                (online && sessionIds.has(tabId as RigSessionId)),
        );
        const targets = new Set(closeableIds);
        const rest = currentGroup.conversations.filter((summary) => !targets.has(summary.id));
        if (current.address.conversationId && targets.has(current.address.conversationId)) {
            const next =
                keepId !== undefined && rest.some((summary) => summary.id === keepId)
                    ? keepId
                    : rest[0]?.id;
            props.onChatSelect(rest.length > 0 ? currentGroup.id : undefined, next, true);
        }
        for (const tabId of closeableIds) {
            if (fileIds.has(tabId)) {
                props.workspace.fileClose(tabId);
                continue;
            }
            // A terminal or a page closes where it is drawn: it was moved here,
            // not copied, so this is the only tab it has and closing it ends
            // the shell or the page rather than sending it back.
            if (toolIds.has(tabId)) {
                props.workspace.panel.tabClose(tabId as RigPanelTabId);
                continue;
            }
            void props.workspace.conversationArchive(tabId as RigSessionId).catch(() => undefined);
        }
    };
    const groupTabClose = (tabId: string) => {
        // A detached subagent's tab is an address, not a member of the list:
        // closing it only steps back to the sessions that are listed.
        if (tabId === detachedConversationId) {
            props.onChatSelect(
                openGroup && openGroup.conversations.length > 0 ? openGroup.id : undefined,
                openGroup?.conversations[0]?.id,
                true,
            );
            return;
        }
        groupTabsClose([tabId]);
    };
    const panelViewClose = (viewId: string) => {
        if (viewId === "activity") props.workspace.activityPanelClose();
        else if (viewId === "preview") props.workspace.panel.previewClose();
        else if (viewId === "file") props.workspace.filePanelClose();
        else props.workspace.panel.tabClose(viewId as RigPanelTabId);
    };
    const activeTabClose = () => {
        const panelNow = props.workspace.panel.get();
        const panelTarget = openGroupPreparing ? undefined : panelCloseTargetFind(panelNow);
        if (panelTarget) {
            panelViewClose(panelTarget);
            return;
        }
        const current = props.workspace.get();
        const tabId = current.activeMainViewId ?? current.address.conversationId;
        if (tabId) groupTabClose(tabId);
    };
    // The strip in the order it is drawn, without the detached subagent: it is
    // addressed rather than listed, so a sweep over "the tabs beside this one"
    // never reaches it.
    const sweepableTabs = groupTabs.filter((entry) => entry.id !== detachedConversationId);
    const previewTool = previewToolFind(conversation, panel.previewEntryId);
    const desktop = props.platform === "desktop";

    // Whether the chat this workspace was made with is what is on screen. That
    // chat carries the checkout's phase itself, so the lane above the tab strip
    // does not: a file or a terminal open here is not that chat, and those keep
    // the lane. It is suppressed even when the chat says nothing at all — a new
    // workspace is an ordinary empty chat, and the sidebar row is already
    // showing that its checkout is being prepared.
    const preparingChatOnScreen =
        openGroupPreparing &&
        openGroup !== undefined &&
        activeMainTool === undefined &&
        activeFile === undefined;
    // A new workspace opens as a plain empty chat, with the ordinary placeholder
    // and a live composer. The checkout being prepared is only worth a word once
    // there is something in the chat waiting on it: a message sent before the
    // checkout arrives is an ordinary message, and this is the standing fact
    // above all of them that says why it has not run yet. Rig has already named
    // where the checkout is going and holds the work until it is there.
    const preparingNotice =
        openGroup &&
        preparingChatOnScreen &&
        conversation.type === "ready" &&
        conversation.value.entries.length > 0 ? (
            <WorkspaceLifecycleNotice
                name={openGroup.name}
                {...(openGroup.path ? { path: openGroup.path } : {})}
                phase="creating"
                size="compact"
            />
        ) : undefined;
    const mainFileBody = (file: RigFileTabSnapshot, onReady?: () => void): ReactNode => (
        <RigFileBody
            appearance={appearance.appearance}
            file={file}
            {...(props.htmlPreview ? { htmlPreview: props.htmlPreview } : {})}
            key={`${file.id}:${file.kind}`}
            {...(props.mediaWindow ? { mediaWindow: props.mediaWindow } : {})}
            mode={workspace.fileViewMode}
            {...(onReady === undefined ? {} : { onReady })}
            rigOnline={rigOnline}
            {...(access.writeRefusal === undefined ? {} : { writeRefusal: access.writeRefusal })}
            {...(connectionRefusal === undefined ? {} : { saveRefusal: connectionRefusal })}
            workspace={props.workspace}
        />
    );
    const mainConversationBody =
        openGroup === undefined ? undefined : openGroup.conversations.length === 0 &&
          workspace.groupComposer ? (
            // Files or tools are open here, but no session exists yet. The body
            // under the strip is the same composer that starts the first one.
            <RigGroupComposer
                composer={workspace.groupComposer}
                {...(workspace.groupSessionDraft
                    ? { draftMenus: workspace.groupSessionDraft.menus }
                    : {})}
                focusOnType
                groupId={openGroup.id}
                groupName={openGroup.name}
                rigOnline={rigOnline}
                {...(connectionRefusal === undefined ? {} : { unavailable: connectionRefusal })}
                workspace={props.workspace}
            />
        ) : (
            <RigConversationBody
                activitySelected={panel.open && panel.activeViewId === "activity"}
                conversation={conversation}
                focusOnType
                groupId={openGroup.id}
                groupName={openGroup.name}
                {...(preparingNotice ? { notice: preparingNotice } : {})}
                now={now}
                {...(connectionRefusal === undefined &&
                openGroupChatRefusal === undefined &&
                openGroup.create !== undefined
                    ? { onCreate: () => groupConversationCreate(openGroup) }
                    : {})}
                onChatSelect={props.onChatSelect}
                onFileOpen={(path) => {
                    if (!rigOnline() || !openGroup.create) return;
                    const target = workspacePathRelative(path, openGroup.create.cwd);
                    props.workspace.filePanelOpen(openGroup.id, target, fileTabKind(target, "all"));
                }}
                canAbort={conversationCanAbort}
                readOnly={conversationReadOnly}
                rigOnline={rigOnline}
                {...(connectionRefusal === undefined ? {} : { unavailable: connectionRefusal })}
                {...(conversationReadOnlyReason === undefined
                    ? {}
                    : { readOnlyReason: conversationReadOnlyReason })}
                {...(connectionRefusal === undefined && openGroupChatRefusal === undefined
                    ? {}
                    : { writeRefusal: connectionRefusal ?? openGroupChatRefusal })}
                viewerId={props.viewerId}
                workspace={props.workspace}
            />
        );

    return (
        <AppShell
            embedded
            panelResizable
            // The width this checkout was last left at, or the shell's own
            // default where nobody has sized it. Passed on every render rather
            // than seeded once, so moving to another project shows that
            // project's width instead of carrying this one's across.
            panelWidth={workspace.panelWidth ?? APP_SHELL_PANEL_DEFAULT_WIDTH}
            onPanelWidthChange={(width) => {
                if (openGroup) props.workspace.panelWidthUpdate(openGroup.id, width);
            }}
            panel={
                // The panel reads and writes the checkout: a file tree, a diff,
                // a terminal. None of them has anything to open until the
                // checkout is there, so while it is being prepared the panel is
                // not drawn at all rather than drawn empty. It comes back on its
                // own — the reader's choice to have it open is untouched here.
                panel.open && !openGroupPreparing ? (
                    <RigPanelBody
                        {...(panelCloseTarget ? { closeShortcut: APP_SHORTCUTS.tabClose } : {})}
                        activity={conversation.type === "ready" ? conversation.value : undefined}
                        canStartTerminal={availability.online && props.chatId !== undefined}
                        browserContent={props.browserContent}
                        htmlPreview={props.htmlPreview}
                        mediaWindow={props.mediaWindow}
                        sessionId={props.chatId}
                        changes={openGroup?.changes ?? []}
                        expanded={workspace.fileTreeExpanded}
                        collapsed={workspace.fileTreeCollapsed}
                        layout={workspace.fileLayout}
                        onFileSelect={(path) => {
                            if (openGroup && rigOnline())
                                props.workspace.filePreview(
                                    openGroup.id,
                                    path,
                                    fileTabKind(path, workspace.fileScope),
                                );
                        }}
                        onFileOpen={(path) => {
                            if (openGroup && rigOnline())
                                props.workspace.fileOpen(
                                    openGroup.id,
                                    path,
                                    fileTabKind(path, workspace.fileScope),
                                );
                        }}
                        onLayoutChange={(layout) => {
                            if (openGroup) props.workspace.fileLayoutUpdate(openGroup.id, layout);
                        }}
                        now={now}
                        {...(availability.online
                            ? {
                                  onActivityProcessStop: (processId: number) => {
                                      void props.workspace
                                          .backgroundProcessStop(processId)
                                          .catch(() => undefined);
                                  },
                              }
                            : {})}
                        onActivityOpen={() => props.workspace.activityPanelOpen()}
                        {...(openGroup
                            ? {
                                  onSubagentSelect: (sessionId: string) => {
                                      props.workspace.activityPanelClose();
                                      props.onChatSelect(openGroup.id, sessionId as RigSessionId);
                                  },
                              }
                            : {})}
                        onPanelClose={() => props.workspace.panel.panelToggle()}
                        {...(workspace.panelFile ? { panelFile: workspace.panelFile } : {})}
                        fileBody={mainFileBody}
                        onPanelFileClose={() => props.workspace.filePanelClose()}
                        onViewClose={panelViewClose}
                        onScopeChange={(scope) => {
                            if (
                                openGroup &&
                                (scope === "changed" ||
                                    workspace.workspaceFiles !== undefined ||
                                    rigOnline())
                            )
                                props.workspace.fileScopeUpdate(openGroup.id, scope);
                        }}
                        onToggle={(path, expanded) =>
                            props.workspace.fileTreeExpandedUpdate(path, expanded)
                        }
                        onViewTransfer={(viewId) =>
                            props.workspace.viewPlacementUpdate(viewId, "main")
                        }
                        panel={panel}
                        previewTool={previewTool}
                        {...(terminalRigAvailability === undefined
                            ? {}
                            : {
                                  rigAvailability: terminalRigAvailability,
                                  rigAvailabilityReason: availability.message,
                              })}
                        scope={workspace.fileScope}
                        selectedPath={activeFile?.path}
                        store={props.workspace.panel}
                        workspaceFiles={workspace.workspaceFiles}
                        workspaceFilesLoading={workspace.workspaceFilesLoading}
                    />
                ) : undefined
            }
        >
            {openGroup ? (
                <>
                    {/* The heading names the project, not the session: every tab
                        beneath it is another session in this one project, so it
                        stays put as they are switched. */}
                    <ChannelHeader
                        // The panel toggle is the mirror of the sidebar's: the same
                        // act at the other edge of the window, so it wears the same
                        // glyph flipped and sits in the header rather than down in
                        // the tab strip. It only appears once the project has a
                        // session, because a panel with no conversation behind it has
                        // nowhere to run a terminal and the control would do nothing.
                        //
                        // Both of them address the checkout, so a workspace
                        // still being prepared carries neither: handing a folder
                        // that does not exist to an editor, or opening a panel
                        // onto it, are the two things this header could offer
                        // that would fail on arrival.
                        actions={
                            openGroupPreparing ? undefined : (
                                <>
                                    {/* Hands this project's directory to another
                                    application, or puts its path on the
                                    clipboard. The path is no longer spelled out
                                    in the header — it said nothing the project's
                                    name did not — so copying it is how it is
                                    still reachable when it is genuinely needed. */}
                                    <RigControlMenu
                                        items={[
                                            ...workspace.openInTargets.map((target) => ({
                                                id: target.id,
                                                kind: "item" as const,
                                                label: target.label,
                                                disabled: !availability.online,
                                                ...(target.iconUrl
                                                    ? { iconUrl: target.iconUrl }
                                                    : {}),
                                            })),
                                            ...(workspace.openInTargets.length > 0
                                                ? [{ kind: "separator" as const }]
                                                : []),
                                            {
                                                id: "copy-path",
                                                kind: "item" as const,
                                                label: "Copy path",
                                                icon: "doc" as const,
                                            },
                                        ]}
                                        label="Open in"
                                        // The control wears whatever was opened last,
                                        // so the answer to "again, please" is already
                                        // on screen instead of one menu away — and
                                        // once it is worn, the label side hands the
                                        // project straight back to that application
                                        // while only the chevron opens the list.
                                        leadingIconUrl={openInRecent?.iconUrl}
                                        menuAlign="end"
                                        {...(openInRecent && availability.online && openGroup.create
                                            ? {
                                                  onPrimary: () => {
                                                      if (rigOnline())
                                                          void props.workspace.openIn(
                                                              openGroup.id,
                                                              openInRecent.id,
                                                          );
                                                  },
                                                  primaryLabel: `Open in ${openInRecent.label}`,
                                              }
                                            : {})}
                                        onSelect={(id: string) => {
                                            if (id === "copy-path") {
                                                if (openGroup.create)
                                                    void navigator.clipboard?.writeText(
                                                        openGroup.create.cwd,
                                                    );
                                                return;
                                            }
                                            if (rigOnline() && openGroup.create)
                                                void props.workspace.openIn(openGroup.id, id);
                                        }}
                                    />
                                    {!panel.open ? (
                                        <Button
                                            aria-label="Show panel"
                                            aria-pressed={false}
                                            icon="panel-expand"
                                            iconOnly
                                            onClick={() => props.workspace.panel.panelToggle()}
                                            shortcut={PANEL_TOGGLE_HINT}
                                            size="small"
                                            variant="ghost"
                                        />
                                    ) : null}
                                </>
                            )
                        }
                        icon={openGroup.home ? "home" : "inbox"}
                        title={openGroup.name}
                    />
                    {availability.online ? null : (
                        <Banner
                            action={{
                                label: "Retry now",
                                onClick: () => props.connection.retry(),
                            }}
                            icon="link"
                            tone={availability.state === "error" ? "danger" : "neutral"}
                            title={
                                availability.state === "error"
                                    ? "Rig needs attention"
                                    : "Rig reconnecting"
                            }
                        >
                            {availability.message}
                        </Banner>
                    )}
                    <WindowShortcuts
                        actions={[
                            // Cmd-W is consistently the workspace's close
                            // command. The live handler simply has nothing to
                            // do when Files or an offline session is the only
                            // current target.
                            { run: activeTabClose, shortcut: APP_SHORTCUTS.tabClose },
                            ...(openGroupPreparing
                                ? []
                                : [
                                      {
                                          run: () => props.workspace.panel.panelToggle(),
                                          shortcut: APP_SHORTCUTS.panelToggle,
                                      },
                                      {
                                          run: () => props.workspace.panel.panelToggle(),
                                          shortcut: APP_SHORTCUTS.panelToggleAlternate,
                                      },
                                  ]),
                            ...(sessionCreateAvailable
                                ? [
                                      {
                                          run: () => groupConversationCreate(openGroup),
                                          shortcut: APP_SHORTCUTS.sessionCreate,
                                      },
                                  ]
                                : []),
                            ...(workspaceCreateProjectId
                                ? [
                                      {
                                          run: () => {
                                              if (rigOnline())
                                                  void props.workspace
                                                      .worktreeCreate(workspaceCreateProjectId)
                                                      .catch(() => undefined);
                                          },
                                          shortcut: APP_SHORTCUTS.workspaceCreate,
                                      },
                                  ]
                                : []),
                        ]}
                    />
                    {/* A worktree with work already in it keeps its tab strip and
                        its transcripts, so its phase is stated in the lane above
                        them rather than in place of them: the reader can still
                        read what ran there before the checkout went away. The
                        lane is mounted in every phase, including the ready one,
                        so arriving at or leaving a phase never rebuilds the
                        strip and transcripts underneath it.

                        A checkout being prepared is the exception, whenever its
                        own chat is the thing on screen: that phase is stated
                        inside the chat instead, above its messages and where the
                        reader is already looking, so the lane stays empty rather
                        than saying the same thing twice. */}
                    <WorkspaceLifecycleLane
                        {...(openGroup.lifecycle?.phase === "failed" &&
                        openGroup.lifecycle.reason !== undefined
                            ? { detail: openGroup.lifecycle.reason }
                            : {})}
                        name={openGroup.name}
                        {...(openGroup.path ? { path: openGroup.path } : {})}
                        {...(openGroupPhase !== undefined &&
                        !openGroupNotice &&
                        !preparingChatOnScreen
                            ? { phase: openGroupPhase }
                            : {})}
                    />
                    {openGroupNotice ? (
                        // Nothing has run here and the place itself will never
                        // take one: a composer would collect a message for a
                        // checkout that is not coming. What happened to the
                        // workspace is the whole screen instead.
                        //
                        // A checkout Rig is still preparing is deliberately not
                        // this case. Rig has already said where it will be and
                        // holds a session's work until it is there, so an empty
                        // new workspace shows its composer immediately with the
                        // lane above saying what is happening to it.
                        <WorkspaceLifecycleNotice
                            {...(openGroup.lifecycle?.phase === "failed" &&
                            openGroup.lifecycle.reason !== undefined
                                ? { detail: openGroup.lifecycle.reason }
                                : {})}
                            name={openGroup.name}
                            {...(openGroup.path ? { path: openGroup.path } : {})}
                            phase={openGroupPhase}
                        />
                    ) : openGroup.conversations.length === 0 &&
                      workspace.groupComposer &&
                      !groupTabbedPane ? (
                        // A group with nothing in it gets no tab strip — an empty
                        // strip is a control that does nothing but take a row —
                        // and a live composer rather than a button: the first
                        // message is what starts the conversation, so opening a
                        // project or worktree to type into never leaves an empty
                        // session behind. Once there is a strip the same composer
                        // moves under it, so it is never drawn twice.
                        <RigGroupComposer
                            composer={workspace.groupComposer}
                            {...(workspace.groupSessionDraft
                                ? { draftMenus: workspace.groupSessionDraft.menus }
                                : {})}
                            focusOnType
                            groupId={openGroup.id}
                            groupName={openGroup.name}
                            rigOnline={rigOnline}
                            {...(connectionRefusal === undefined
                                ? {}
                                : { unavailable: connectionRefusal })}
                            workspace={props.workspace}
                        />
                    ) : null}
                    {groupTabbedPane ? (
                        <TabbedPane
                            actions={
                                // A tab is a session, so adding one creates it
                                // directly in the addressed project or worktree
                                // instead of opening the task form — and a
                                // workspace that cannot host a session offers no
                                // button, because the only thing it could do is
                                // fail.
                                sessionCreateAvailable ? (
                                    <Button
                                        aria-label="Create a session in this project"
                                        icon="plus"
                                        iconOnly
                                        onClick={() => groupConversationCreate(openGroup)}
                                        shortcut={APP_SHORTCUTS.sessionCreate}
                                        size="small"
                                        variant="ghost"
                                    />
                                ) : undefined
                            }
                            activeId={workspace.activeMainViewId ?? props.chatId ?? ""}
                            closeLabel="Close tab"
                            {...(panelCloseTarget ? {} : { closeShortcut: APP_SHORTCUTS.tabClose })}
                            onClose={groupTabClose}
                            onDoubleClick={(tabId) => {
                                const file = groupFileTabs.find((tab) => tab.id === tabId);
                                if (file)
                                    props.workspace.fileOpen(file.groupId, file.path, file.kind);
                            }}
                            onReorder={(tabIds: readonly string[]) => {
                                // A detached subagent has no place in the
                                // order, so it is taken out of both sides of
                                // the comparison rather than dragged into one.
                                const orderable = (ids: readonly string[]) =>
                                    ids.filter((id) => id !== detachedConversationId);
                                const move = sidebarReorderMove(
                                    orderable(groupTabs.map((tab) => tab.id)),
                                    orderable(tabIds),
                                );
                                if (!move) return;
                                props.workspace.tabReorder(move.id, move.afterId);
                            }}
                            onSelect={(tabId) => {
                                if (
                                    groupFileTabs.some((tab) => tab.id === tabId) ||
                                    mainTools.some((tab) => tab.id === tabId)
                                ) {
                                    props.workspace.mainViewSelect(tabId);
                                    return;
                                }
                                props.workspace.mainViewSelect(undefined);
                                props.onChatSelect(openGroup.id, tabId);
                            }}
                            onTransfer={(tabId) =>
                                props.workspace.viewPlacementUpdate(tabId, "panel")
                            }
                            // A session is what the address names, so it stays
                            // where the address points; a diff is two revisions
                            // read together and the panel's viewer reads one
                            // file, so it has nowhere over there to land; and a
                            // file with text that has not been written back
                            // keeps its edit rather than its place.
                            transferable={(tab) =>
                                mainTools.some((entry) => entry.id === tab.id) ||
                                groupFileTabs.some(
                                    (entry) =>
                                        entry.id === tab.id &&
                                        entry.kind !== "diff" &&
                                        entry.draft === undefined &&
                                        !entry.saving,
                                )
                            }
                            transferTargets={MAIN_TRANSFER_TARGETS}
                            tabMenuItems={(tab) => {
                                const index = sweepableTabs.findIndex(
                                    (entry) => entry.id === tab.id,
                                );
                                // The detached subagent's tab is not in the sweepable
                                // order, so it offers no menu — its runner owns it.
                                if (index < 0) return [];
                                // A session is archived; a file, a terminal, a
                                // page is closed. The verb has to be the true
                                // one for the tab it is offered on.
                                const verb =
                                    groupFileTabs.some((entry) => entry.id === tab.id) ||
                                    mainTools.some((entry) => entry.id === tab.id)
                                        ? "Close"
                                        : "Archive";
                                return tabStripMenu(verb, index, sweepableTabs.length - index - 1);
                            }}
                            onTabMenuSelect={(tab, actionId) => {
                                const ids = sweepableTabs.map((entry) => entry.id);
                                const index = ids.indexOf(tab.id);
                                if (index < 0) return;
                                if (actionId === TAB_MENU_CLOSE) {
                                    groupTabsClose([tab.id]);
                                } else if (actionId === TAB_MENU_CLOSE_OTHERS) {
                                    groupTabsClose(
                                        ids.filter((id) => id !== tab.id),
                                        tab.id,
                                    );
                                } else if (actionId === TAB_MENU_CLOSE_LEFT) {
                                    groupTabsClose(ids.slice(0, index), tab.id);
                                } else if (actionId === TAB_MENU_CLOSE_RIGHT) {
                                    groupTabsClose(ids.slice(index + 1), tab.id);
                                } else if (actionId === TAB_MENU_CLOSE_ALL) {
                                    groupTabsClose(ids);
                                }
                            }}
                            tabs={groupTabs}
                        >
                            {/* The whole content area accepts a tab dragged out
                                of the panel, so the reader aims at where the
                                thing will be rather than at a stripe. */}
                            <TransferZone
                                icon="panel-collapse"
                                id={TRANSFER_ZONE_MAIN}
                                label="Open in the main content"
                            >
                                <DeferredPane
                                    current={
                                        displayedMainTool
                                            ? undefined
                                            : displayedFile
                                              ? {
                                                    id:
                                                        displayedFile.displayedPresentationId ??
                                                        displayedFile.presentationId,
                                                    content: mainFileBody(displayedFile),
                                                }
                                              : {
                                                    id: `conversation:${openGroup.id}:${props.chatId ?? "empty"}`,
                                                    content: mainConversationBody,
                                                }
                                    }
                                    fallback={
                                        <EmptyState
                                            animation="snail"
                                            description="The selected file is taking a moment."
                                            icon="doc"
                                            size="panel"
                                            title="Opening file…"
                                        />
                                    }
                                    onReveal={props.workspace.mainViewDisplay}
                                    pending={
                                        pendingFile
                                            ? (() => {
                                                  const waitsForDiff =
                                                      pendingFile.kind === "diff" &&
                                                      pendingFile.document.type === "ready" &&
                                                      "oldContent" in pendingFile.document.value &&
                                                      (workspace.fileViewMode === "unified" ||
                                                          workspace.fileViewMode === "split");
                                                  const readyOnCommit =
                                                      connectionRefusal !== undefined ||
                                                      (pendingFile.document.type !== "loading" &&
                                                          !waitsForDiff);
                                                  return {
                                                      id: pendingFile.presentationId,
                                                      ready: readyOnCommit,
                                                      render: (ready: () => void) =>
                                                          mainFileBody(
                                                              pendingFile,
                                                              waitsForDiff ? ready : undefined,
                                                          ),
                                                      waitForReady: waitsForDiff,
                                                  };
                                              })()
                                            : undefined
                                    }
                                    // Every page moved to this side stays
                                    // mounted whichever tab is on screen.
                                    persistent={
                                        <RigToolBodies
                                            activeId={workspace.displayedMainViewId}
                                            {...(props.browserContent
                                                ? { browserContent: props.browserContent }
                                                : {})}
                                            {...(props.chatId ? { sessionId: props.chatId } : {})}
                                            store={props.workspace.panel}
                                            tabs={mainTools}
                                            {...(terminalRigAvailability === undefined
                                                ? {}
                                                : {
                                                      rigAvailability: terminalRigAvailability,
                                                      rigAvailabilityReason: availability.message,
                                                  })}
                                        />
                                    }
                                />
                            </TransferZone>
                        </TabbedPane>
                    ) : null}
                </>
            ) : (
                <>
                    {/* With no project open there is no tab strip, so this side of
                        the window would have no lane to drag it by. */}
                    {desktop ? <WindowDragRegion /> : null}
                    {availability.online ? null : (
                        <Banner
                            action={{
                                label: "Retry now",
                                onClick: () => props.connection.retry(),
                            }}
                            icon="link"
                            tone={availability.state === "error" ? "danger" : "neutral"}
                            title={
                                availability.state === "error"
                                    ? "Rig needs attention"
                                    : "Rig reconnecting"
                            }
                        >
                            {availability.message}
                        </Banner>
                    )}
                    {refusedCreate ? (
                        // This address was a workspace being made until Rig
                        // refused it. Saying "no project open" here would leave
                        // the reader to work out for themselves that the row they
                        // just watched appear and vanish was never created.
                        <WorkspaceLifecycleNotice
                            detail={refusedCreate.message}
                            // The name every worktree Happy asks for is created
                            // under. Rig never gave this one a record, so the
                            // name the request carried is the only one there is.
                            name="Workspace"
                            phase="refused"
                        />
                    ) : (
                        /* No project is open, so there is nowhere in front of the
                           reader for a session to be started — but Create asks
                           where, so it answers from here as readily as anywhere
                           else, and it is the only move this screen has. */
                        <EmptyState
                            {...(availability.online
                                ? {
                                      action: {
                                          label: "Create",
                                          icon: "plus" as const,
                                          onClick: () => props.workspace.createOpen(),
                                      },
                                  }
                                : {})}
                            description="Pick one in the sidebar, or start a session in any of them."
                            icon="files"
                            size="panel"
                            title="No project open"
                        />
                    )}
                </>
            )}
        </AppShell>
    );
}

function rigFileRevalidationBanner(error: { readonly message: string } | undefined): ReactNode {
    return error ? (
        <Banner tone="warning" title="File may be out of date">
            Showing the last loaded content. {error.message}
        </Banner>
    ) : null;
}

function RigFileBody(props: {
    appearance: "dark" | "light";
    file: RigFileTabSnapshot;
    htmlPreview?: HtmlPreviewRenderer;
    mediaWindow?: MediaWindowOpener;
    mode: RigFileViewMode;
    /** Reports that a pending worker-backed diff has committed its final DOM. */
    onReady?: () => void;
    /** Re-reads Rig availability when a retained file handler fires. */
    rigOnline: () => boolean;
    /** Why this file cannot be edited or saved, or absent when it can. */
    writeRefusal?: string;
    /** Why the current local draft cannot be persisted to the Rig. */
    saveRefusal?: string;
    workspace: RigWorkspaceStore;
}) {
    const { file, workspace } = props;
    /**
     * Opens a file a document links to, on the side the document is being read
     * on. A file followed in the main content lands beside it in the tab strip;
     * one followed in the panel stays in the panel, because the reader is
     * reading the conversation and the panel is where they are reading.
     */
    const linkedFileOpen = (target: string): void => {
        if (!props.rigOnline()) return;
        const kind = fileTabKind(target, "all");
        if (file.placement === "panel") workspace.filePanelOpen(file.groupId, target, kind);
        else workspace.fileOpen(file.groupId, target, kind);
    };
    // Typing into a document that could never be written back is worse than not
    // offering the editor at all: the reader loses what they typed and learns
    // why only when they try to save it.
    const writable = props.writeRefusal === undefined;
    const saveDisabled = !writable || props.saveRefusal !== undefined;
    if (file.kind === "media")
        return (
            <>
                {rigFileRevalidationBanner(file.revalidationError)}
                <RigFilePreview
                    document={file.document}
                    {...(props.mediaWindow ? { mediaWindow: props.mediaWindow } : {})}
                    key={file.id}
                    path={file.path}
                    revalidating={file.revalidating}
                />
            </>
        );
    if (
        (file.kind === "file" || file.kind === "document") &&
        file.document.type === "ready" &&
        "content" in file.document.value
    ) {
        const content = file.document.value.content;
        const dirty = file.draft !== undefined && file.draft !== content;
        const text = file.draft ?? content;
        const status =
            props.writeRefusal ?? props.saveRefusal ?? (file.saving ? "Saving…" : undefined);
        const markdownCacheKey =
            file.draft === undefined
                ? markdownHighlightCacheKey(file.path, file.document.value.hash)
                : undefined;
        return (
            <FileEditor
                banner={rigFileRevalidationBanner(file.revalidationError)}
                documentKey={fileDocumentKey(file.id, file.document.value)}
                dirty={dirty}
                {...(file.kind === "document" && props.htmlPreview
                    ? {
                          rendered: (
                              // The page is served from the file on disk, so the
                              // rendered face shows what was saved; the source
                              // face is where an unsaved edit lives until it is.
                              <HtmlPreviewFrame
                                  {...(file.previewError
                                      ? {
                                            failure: {
                                                kind: "address-unavailable" as const,
                                                path: file.path,
                                                detail: file.previewError,
                                            },
                                        }
                                      : {})}
                                  renderContent={props.htmlPreview}
                                  revision={file.revision}
                                  source={file.previewUrl}
                              />
                          ),
                      }
                    : {})}
                {...(filePreviewKind(file.path) === "markdown"
                    ? {
                          rendered: (
                              <MarkdownDocument
                                  /* Whatever the link names — another document,
                                     a picture — opens as the file itself, never
                                     as its diff. */
                                  onFileOpen={(href) =>
                                      linkedFileOpen(documentLinkResolve(file.path, href))
                                  }
                                  {...(markdownCacheKey === undefined
                                      ? {}
                                      : { cacheKey: markdownCacheKey })}
                                  text={text}
                              />
                          ),
                      }
                    : {})}
                onRevert={() => workspace.fileDraftRevert(file.id)}
                onSave={() => {
                    if (!saveDisabled && props.rigOnline())
                        void workspace.fileDraftSave(file.id).catch(() => undefined);
                }}
                onValueChange={(value) => workspace.fileDraftUpdate(file.id, value)}
                path={file.path}
                readOnly={file.saving || !writable}
                saveDisabled={saveDisabled}
                saving={file.saving}
                {...(status === undefined ? {} : { status })}
                value={text}
            />
        );
    }
    if (
        file.kind === "diff" &&
        file.document.type === "ready" &&
        "oldContent" in file.document.value
    ) {
        const change = file.document.value;
        // An untouched tab shows what was read; once edited it shows what was
        // typed, which is the only copy of it there is.
        const current = file.draft ?? change.newContent;
        const oldCacheKey =
            file.draft !== undefined || change.oldHash === undefined
                ? undefined
                : `d:old:${file.groupId}:${change.oldHash}:${fileHighlightLanguageKey(change.oldPath)}`;
        const newCacheKey =
            file.draft === undefined && change.hash !== undefined
                ? `d:new:${file.groupId}:${change.hash}:${fileHighlightLanguageKey(file.path)}`
                : undefined;
        return (
            <>
                {rigFileRevalidationBanner(file.revalidationError)}
                <ChangedFileDiff
                    appearance={props.appearance}
                    documentKey={fileDocumentKey(file.id, file.document.value)}
                    key={`${file.id}:${file.kind}`}
                    loading={file.revalidating}
                    mode={props.mode}
                    {...(newCacheKey === undefined ? {} : { newCacheKey })}
                    newContent={current}
                    {...(oldCacheKey === undefined ? {} : { oldCacheKey })}
                    oldContent={change.oldContent}
                    oldPath={change.oldPath}
                    {...(writable
                        ? {
                              onContentChange: (content: string) =>
                                  workspace.fileDraftUpdate(file.id, content),
                              onSave: () => {
                                  if (!saveDisabled && props.rigOnline())
                                      void workspace.fileDraftSave(file.id).catch(() => undefined);
                              },
                          }
                        : {})}
                    saveDisabled={saveDisabled}
                    onModeChange={(mode) => workspace.fileViewModeUpdate(mode)}
                    {...(props.onReady === undefined ? {} : { onReady: props.onReady })}
                    // A change that deleted the file left no copy to look at, which
                    // the read reports by having no working-tree identity for it.
                    // Preview is then not offered rather than offered over nothing.
                    {...(change.hash === undefined
                        ? {}
                        : {
                              preview: (
                                  <RigChangedFilePreview
                                      file={file}
                                      onFileOpen={linkedFileOpen}
                                      openDisabled={props.saveRefusal !== undefined}
                                      text={current}
                                  />
                              ),
                          })}
                    path={file.path}
                    saving={file.saving}
                />
            </>
        );
    }
    if (file.document.type === "error")
        return (
            <EmptyState
                {...(props.saveRefusal === undefined
                    ? {
                          action: {
                              label: "Retry",
                              icon: "arrow-right" as const,
                              onClick: () => {
                                  if (props.rigOnline()) workspace.fileRetry(file.id);
                              },
                          },
                      }
                    : {})}
                description={file.document.error.message}
                icon="doc"
                size="panel"
                title="File unavailable"
            />
        );
    if (props.saveRefusal)
        return (
            <EmptyState
                description={props.saveRefusal}
                icon="link"
                size="panel"
                title="File unavailable while Rig is offline"
            />
        );
    return (
        <EmptyState
            animation="snail"
            description={
                file.kind === "file"
                    ? "Reading the file from its workspace."
                    : "Reading the changed file from its workspace."
            }
            icon="doc"
            size="panel"
            title="Loading file…"
        />
    );
}

/**
 * A changed file as it now stands, in the same preview the product opens any
 * file into.
 *
 * The text is the copy already in hand: the changed-file read takes its
 * working-tree side from the same file read that opening an ordinary file uses,
 * so Preview and Edit are looking at one file rather than at two reads of it —
 * including an edit that has been typed and not yet saved. Nothing is fetched
 * here, so switching to Preview cannot land another file's bytes.
 */
function RigChangedFilePreview(props: {
    file: RigFileTabSnapshot;
    openDisabled: boolean;
    /** Opens a linked file on the side this one is being read on. */
    onFileOpen: (path: string) => void;
    text: string;
}) {
    const { file } = props;
    // A picture, a recording, or an archive opens as itself rather than as a
    // diff, so a tab of one is not a diff tab and this is reached only by a tab
    // restored from a session that sorted the file differently. Saying the file
    // has no preview beats rendering its bytes as characters.
    const kind = filePreviewKind(file.path);
    const readable = kind === "markdown" || kind === "text";
    const cacheKey =
        file.draft === undefined &&
        file.document.type === "ready" &&
        "hash" in file.document.value &&
        file.document.value.hash !== undefined
            ? fileHighlightCacheKey(file.path, file.document.value.hash)
            : undefined;
    return (
        <FilePreview
            content={readable ? { type: "text", text: props.text } : { type: "unavailable" }}
            {...(cacheKey === undefined ? {} : { cacheKey })}
            // A document followed out of the changed list lands beside it as the
            // file itself, the same way one followed out of a file tab does.
            onFileOpen={(href) => {
                if (props.openDisabled) return;
                props.onFileOpen(documentLinkResolve(file.path, href));
            }}
            path={file.path}
        />
    );
}

/**
 * One workspace file shown rather than edited.
 *
 * The document says where the bytes are rather than carrying them, so the
 * picture element fetches its own source over an ordinary URL. Nothing here
 * holds a browser resource with a lifetime to revoke, and a video's seeks become
 * range requests against the proxy instead of a whole file already in the DOM.
 */
function RigFilePreview(props: {
    document: RigFileTabSnapshot["document"];
    mediaWindow?: MediaWindowOpener;
    path: string;
    revalidating: boolean;
}) {
    const document = props.document;
    if (document.type === "error")
        return (
            <FilePreview
                content={{ type: "error", message: document.error.message }}
                path={props.path}
            />
        );
    // A background revalidation must not replace usable media with a loading
    // face. The request may still fail into the warning banner owned by the
    // surrounding file surface; only a true first load has no content to show.
    if (document.type !== "ready")
        return <FilePreview content={{ type: "loading" }} path={props.path} />;
    const value = document.value;
    if (!("contentType" in value))
        return <FilePreview content={{ type: "unavailable" }} path={props.path} />;
    // A format with no viewer is stated as such rather than rendered as an
    // <img> that will only ever show a broken-image glyph.
    const kind = filePreviewKind(props.path);
    const showable = value.contentType !== "application/octet-stream" && kind !== "binary";
    const mediaWindow = props.mediaWindow;
    return (
        <FilePreview
            content={showable ? { type: "url", url: value.url } : { type: "unavailable" }}
            {...(mediaWindow && showable && mediaWindowShowable(kind)
                ? {
                      onMediaWindowOpen: () => mediaWindow({ path: props.path, url: value.url }),
                  }
                : {})}
            path={props.path}
            size={fileSizeFormat(value.size)}
            updating={props.revalidating}
        />
    );
}

/** A byte count as a person reads it. */
function fileSizeFormat(size: number): string {
    if (size < 1024) return `${String(size)} B`;
    if (size < 1024 * 1024) return `${String(Math.round(size / 102.4) / 10)} KB`;
    return `${String(Math.round(size / (102.4 * 1024)) / 10)} MB`;
}

/**
 * The composer of a group that holds no conversation yet: a live input rather
 * than a button, so opening a project or worktree and typing is what starts its
 * first session. It is one surface wherever it stands — alone on a group with
 * nothing open in it at all, or as the body under the tab strip when the only
 * tabs are files and tools — because two of them on one screen would be two
 * places to type the same first message.
 */
function RigGroupComposer(props: {
    composer: ComposerSnapshot;
    /**
     * How that first conversation will be configured, and the options behind
     * those choices. Absent until the model catalog has been read, which is
     * what keeps the composer from waiting on it.
     */
    draftMenus?: RigMenusSnapshot;
    focusOnType: boolean;
    /** The group being written into. Arriving at another one takes the caret. */
    groupId: string;
    groupName: string;
    /** Reads current transport health when a Rig-backed action is invoked. */
    rigOnline: () => boolean;
    /** Why this Rig cannot accept network actions while the local draft remains editable. */
    unavailable?: string;
    workspace: RigWorkspaceStore;
}) {
    const workspace = props.workspace;
    const draftMenus = props.draftMenus;
    return (
        <ConversationView
            agentAuthor={rigAgentAuthor}
            composer={props.composer}
            composerFocusOnType={props.focusOnType}
            // Only the composer that claims stray typing takes the caret, so the
            // dock over an expanded panel cannot pull it out from under the one
            // the reader can see.
            {...(props.focusOnType ? { composerFocusKey: props.groupId } : {})}
            composerPlaceholder={composerPlaceholder(props.groupName)}
            composerSubmitDisabled={props.unavailable !== undefined}
            {...(props.unavailable === undefined ? {} : { composerUnavailable: props.unavailable })}
            entries={NO_ENTRIES}
            // The first message is what creates the session, so its model,
            // effort, and access mode have to be choosable before it is sent
            // rather than corrected afterwards. These are the same pickers an
            // open conversation carries, over the draft instead of a live
            // session.
            composerControls={
                draftMenus ? (
                    <ComposerModelControl
                        {...rigComposerModelControlProps(draftMenus, {
                            onEffortChange: (effort?: RigThinkingLevel) =>
                                workspace.sessionEffortUpdate(effort),
                            onModelChange: (selection: RigModelSelection) =>
                                workspace.sessionModelUpdate(selection),
                        })}
                    />
                ) : undefined
            }
            composerFooterControl={
                draftMenus ? (
                    <ComposerFooterBar
                        leading={
                            <RigSessionControls
                                fields={["permission", "tier"]}
                                menuPlacement="above"
                                variant="ghost"
                                menus={draftMenus}
                                onEffortChange={(effort?: RigThinkingLevel) =>
                                    workspace.sessionEffortUpdate(effort)
                                }
                                onModelChange={(selection: RigModelSelection) =>
                                    workspace.sessionModelUpdate(selection)
                                }
                                onPermissionModeChange={(mode: RigPermissionMode) =>
                                    workspace.sessionPermissionModeUpdate(mode)
                                }
                                onServiceTierChange={(tier?: RigServiceTier) =>
                                    workspace.sessionServiceTierUpdate(tier)
                                }
                            />
                        }
                    />
                ) : undefined
            }
            onComposerAttachmentRemove={(attachmentId) =>
                workspace.composerAttachmentRemove(attachmentId)
            }
            onComposerAttachmentsSelect={(files) => workspace.composerAttachmentsAdd(files)}
            onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
            onComposerSend={() => {
                if (props.rigOnline()) workspace.composerTextSubmit();
            }}
            onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
        />
    );
}

/** The open conversation's materialization states, inside the directory's tabs. */
function RigConversationBody(props: {
    activitySelected: boolean;
    conversation: RigWorkspaceSnapshot["conversation"];
    focusOnType: boolean;
    groupId: string;
    groupName: string;
    now: number;
    /**
     * Something to say about the place this conversation is happening in, held
     * above every message in it. A workspace's own first conversation exists
     * before its checkout does, so this is where the reader watches that
     * checkout being prepared — while the transcript, the empty state, and the
     * composer underneath all behave exactly as they otherwise would.
     */
    notice?: ReactNode;
    /** Starts a session here, when this workspace can host one. */
    onCreate?: () => void;
    onChatSelect: RigWorkspaceSurfaceProps["onChatSelect"];
    onFileOpen: (path: string) => void;
    readOnly: boolean;
    /** Reads current transport health when a Rig-backed action is invoked. */
    rigOnline: () => boolean;
    /** Why the input is closed, said in the words of whatever closed it. */
    readOnlyReason?: string;
    /** Why this Rig cannot currently accept network actions. */
    unavailable?: string;
    /**
     * Whether a run already going here may be stopped. Separate from `readOnly`
     * on purpose: a checkout that has gone away closes the input, but the run
     * inside it is a process the host owns and the reader must still be able to
     * end it. Only a subagent's own runner takes Stop away, because that run
     * belongs to the parent that started it.
     */
    canAbort: boolean;
    /** Why this conversation may not be written into, or absent when it may. */
    writeRefusal?: string;
    viewerId: string;
    workspace: RigWorkspaceStore;
}) {
    const conversation = props.conversation;
    if (conversation.type === "ready")
        return (
            <RigConversationSurface
                activitySelected={props.activitySelected}
                conversation={conversation.value}
                focusOnType={props.focusOnType}
                groupId={props.groupId}
                groupName={props.groupName}
                {...(props.notice === undefined ? {} : { notice: props.notice })}
                now={props.now}
                onChatSelect={props.onChatSelect}
                onFileOpen={props.onFileOpen}
                canAbort={props.canAbort}
                readOnly={props.readOnly}
                rigOnline={props.rigOnline}
                {...(props.unavailable === undefined ? {} : { unavailable: props.unavailable })}
                {...(props.readOnlyReason === undefined
                    ? {}
                    : { readOnlyReason: props.readOnlyReason })}
                {...(props.writeRefusal === undefined ? {} : { writeRefusal: props.writeRefusal })}
                viewerId={props.viewerId}
                workspace={props.workspace}
            />
        );
    if (conversation.type === "loading" && props.unavailable !== undefined)
        return (
            <EmptyState
                description={`${props.unavailable} The session will finish loading automatically after reconnect.`}
                icon="link"
                size="panel"
                title="Session waiting for the Rig"
            />
        );
    if (conversation.type === "loading")
        return (
            <EmptyState
                animation="snail"
                description="Loading the selected local session."
                icon="chat"
                size="panel"
                title="Loading session…"
            />
        );
    if (conversation.type === "error")
        return (
            <EmptyState
                {...(props.unavailable === undefined
                    ? {
                          action: {
                              label: "Retry",
                              icon: "arrow-right" as const,
                              onClick: () => {
                                  if (props.rigOnline()) props.workspace.conversationRetry();
                              },
                          },
                      }
                    : {})}
                description={conversation.error.message}
                icon="shield"
                size="panel"
                title="Session unavailable"
            />
        );
    return (
        <EmptyState
            {...(props.onCreate === undefined
                ? {}
                : {
                      action: {
                          label: "New session",
                          icon: "plus" as const,
                          onClick: props.onCreate,
                      },
                  })}
            // The main screen of the whole application when no work is open: an
            // agent standing by, waiting to be given something to do.
            animation="robot"
            description="Select a session tab or start a new one to begin."
            icon="chat"
            size="panel"
            title="No session selected"
        />
    );
}

/** Counts live agents and terminals for the compact transcript affordance. */
function rigActiveActivityCounts(
    conversation: Pick<
        RigConversationSnapshot,
        "subagents" | "backgroundProcesses" | "detachedBackgroundProcessIds"
    >,
): {
    readonly agents: number;
    readonly terminals: number;
} {
    const agents = conversation.subagents.filter(
        (subagent) => subagent.status === "queued" || subagent.status === "running",
    );
    return {
        agents: agents.length,
        terminals: conversation.backgroundProcesses.filter((process) =>
            conversation.detachedBackgroundProcessIds.has(process.id),
        ).length,
    };
}

function RigConversationSurface(props: {
    activitySelected: boolean;
    conversation: RigConversationSnapshot;
    focusOnType: boolean;
    groupId: string;
    groupName: string;
    /** What to say above every message here; see `RigConversationBody`. */
    notice?: ReactNode;
    now: number;
    onChatSelect: RigWorkspaceSurfaceProps["onChatSelect"];
    /** Opens a file the transcript names, in the panel beside it. */
    onFileOpen: (path: string) => void;
    readOnly: boolean;
    /** Reads current transport health when a Rig-backed action is invoked. */
    rigOnline: () => boolean;
    /** Why the input is closed, said in the words of whatever closed it. */
    readOnlyReason?: string;
    /** Why this Rig cannot currently accept network actions. */
    unavailable?: string;
    /**
     * Whether a run already going here may be stopped. Separate from `readOnly`
     * on purpose: a checkout that has gone away closes the input, but the run
     * inside it is a process the host owns and the reader must still be able to
     * end it. Only a subagent's own runner takes Stop away, because that run
     * belongs to the parent that started it.
     */
    canAbort: boolean;
    /** Why this conversation may not be written into, or absent when it may. */
    writeRefusal?: string;
    viewerId: string;
    workspace: RigWorkspaceStore;
}) {
    const { conversation, workspace } = props;
    // A session that is still being read is not a reason to unmount this
    // surface: the composer is already live, the header already carries the
    // title the list knew, and the transcript fills in underneath. Only a
    // session that failed replaces it.
    if (conversation.session.type === "error")
        return (
            <EmptyState
                {...(props.unavailable === undefined
                    ? {
                          action: {
                              label: "Retry",
                              icon: "arrow-right" as const,
                              onClick: () => {
                                  if (props.rigOnline()) workspace.conversationRetry();
                              },
                          },
                      }
                    : {})}
                description={conversation.session.error.message}
                icon="shield"
                size="panel"
                title="Session unavailable"
            />
        );
    const swallow = (operation: Promise<unknown>) => void operation.catch(() => undefined);
    const activeActivity = rigActiveActivityCounts(conversation);
    const activityTotal = activeActivity.agents + activeActivity.terminals;
    return (
        <ConversationView
            agentAuthor={rigAgentAuthor}
            activityControl={
                activityTotal > 0 ? (
                    <RigActivityControl
                        agents={activeActivity.agents}
                        backgroundTerminals={activeActivity.terminals}
                        onClick={() => workspace.activityPanelOpen()}
                    />
                ) : undefined
            }
            composer={conversation.composer}
            composerAboveControl={
                <>
                    {/* Usage is a compact reading carried by the write end. The
                        activity summary lives under the latest message in the
                        transcript, so it does not add another composer-adjacent
                        row here. */}
                    {conversation.usagePanelOpen ? (
                        <ComposerPanel
                            onClose={() => workspace.usagePanelClose()}
                            {...(conversation.usageLoading ? { status: "Updating…" } : {})}
                            title="Session usage"
                        >
                            <RigUsagePanel
                                error={conversation.usageError}
                                loading={conversation.usageLoading}
                                usage={conversation.usage}
                            />
                        </ComposerPanel>
                    ) : null}
                </>
            }
            composerDisabled={props.readOnly}
            composerSubmitDisabled={props.unavailable !== undefined}
            {...(props.unavailable === undefined ? {} : { composerUnavailable: props.unavailable })}
            composerFocusOnType={!props.readOnly && props.focusOnType}
            // The open conversation is what this composer writes into, so moving
            // to another one — or landing in the one a new workspace was made
            // with — puts the caret in the draft. A read-only chat has no draft
            // to put it in, and only the composer claiming stray typing takes it,
            // so the dock over an expanded panel cannot steal it.
            {...(!props.readOnly && props.focusOnType
                ? { composerFocusKey: conversation.conversationId }
                : {})}
            composerPlaceholder={
                props.readOnly
                    ? (props.readOnlyReason ?? "Subagent chats are read-only")
                    : composerPlaceholder(props.groupName)
            }
            conversationId={conversation.conversationId}
            entries={conversation.entries}
            loading={!conversation.ready}
            {...(props.notice === undefined ? {} : { notice: props.notice })}
            scrollPosition={conversation.scrollPosition}
            onScrollPositionChange={(position) => {
                if (
                    props.rigOnline() &&
                    position.scrollTop <= 64 &&
                    !conversation.transcriptComplete
                )
                    workspace.historyLoadMore();
                workspace.conversationScrollUpdate(
                    conversation.conversationId as RigSessionId,
                    position,
                );
            }}
            composerControls={
                <>
                    {conversation.menus ? (
                        <ComposerModelControl
                            {...rigComposerModelControlProps(conversation.menus, {
                                // The daemon refuses a model change while a run
                                // is active or queued behind it, so the control
                                // says so rather than accepting a choice the
                                // next message could not apply.
                                disabled:
                                    props.readOnly ||
                                    props.unavailable !== undefined ||
                                    conversation.modelLocked,
                                onEffortChange: (effort?: RigThinkingLevel) => {
                                    if (props.rigOnline()) workspace.sessionEffortUpdate(effort);
                                },
                                onModelChange: (selection: RigModelSelection) => {
                                    if (props.rigOnline()) workspace.sessionModelUpdate(selection);
                                },
                            })}
                        />
                    ) : null}
                </>
            }
            composerFooterControl={
                <ComposerFooterBar
                    leading={
                        <>
                            <RigSessionControls
                                disabled={props.readOnly || props.unavailable !== undefined}
                                fields={["permission", "tier"]}
                                menuPlacement="above"
                                variant="ghost"
                                menus={conversation.menus}
                                onEffortChange={(effort?: RigThinkingLevel) => {
                                    if (props.rigOnline()) workspace.sessionEffortUpdate(effort);
                                }}
                                onModelChange={(selection: RigModelSelection) => {
                                    if (props.rigOnline()) workspace.sessionModelUpdate(selection);
                                }}
                                onPermissionModeChange={(mode: RigPermissionMode) => {
                                    if (props.rigOnline())
                                        workspace.sessionPermissionModeUpdate(mode);
                                }}
                                onServiceTierChange={(tier?: RigServiceTier) => {
                                    if (props.rigOnline()) workspace.sessionServiceTierUpdate(tier);
                                }}
                            />
                        </>
                    }
                    /* How much of the window this session has spent, at the far
                       end of the same row as the access mode and the speed: the
                       reader is about to type one more message, and this is
                       where they find out whether it still fits and when to
                       compact. Before the provider's first measurement, the
                       declared window still appears with an empty-state count
                       so the context surface is discoverable. */
                    trailing={
                        conversation.contextGauge ? (
                            <ContextMeter
                                approximate={conversation.contextGauge.approximate}
                                measured={conversation.contextGauge.measured}
                                totalTokens={conversation.contextGauge.totalTokens}
                                usedTokens={conversation.contextGauge.usedTokens}
                            />
                        ) : undefined
                    }
                />
            }
            onAbort={
                props.canAbort
                    ? () => {
                          if (props.rigOnline()) swallow(workspace.runAbort());
                      }
                    : undefined
            }
            onCommandInvoke={
                props.unavailable === undefined
                    ? (commandId) => {
                          if (props.rigOnline()) workspace.composerCommandInvoke(commandId);
                      }
                    : undefined
            }
            onComposerAttachmentRemove={(attachmentId) =>
                workspace.composerAttachmentRemove(attachmentId)
            }
            onComposerAttachmentsSelect={(files) => workspace.composerAttachmentsAdd(files)}
            onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
            onComposerSend={() => {
                if (props.rigOnline()) workspace.composerTextSubmit();
            }}
            onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
            onFileOpen={(path) => {
                if (props.rigOnline()) props.onFileOpen(path);
            }}
            onImageOpen={(messageId, attachmentId) => {
                if (props.rigOnline()) workspace.imageOpen(messageId, attachmentId);
            }}
            onAttachmentOpen={(attachment) => {
                // An attached document is a page, not a file to save. When it
                // lives in a checkout this workspace reads, it opens the way a
                // document in the file list does — rendered, served from its own
                // folder so its stylesheet and scripts resolve, with the source
                // a toggle away. Only a document the workspace cannot reach
                // falls back to the download the host offered.
                if (
                    attachment.attachmentKind === "file" &&
                    filePreviewKind(attachment.source) === "html" &&
                    props.rigOnline() &&
                    workspace.attachmentFileOpen(attachment.source, "document")
                ) {
                    return;
                }
                if (attachment.openUrl) openExternalLink(attachment.openUrl);
            }}
            onToolSelect={(entryId) => workspace.panel.previewOpen(entryId)}
            onDelegationSelect={(sessionId) =>
                props.onChatSelect(props.groupId, sessionId as RigSessionId)
            }
            {...(props.writeRefusal === undefined && props.unavailable === undefined
                ? {
                      onRequestAnswer: (requestId: string, answers: RigUserInputAnswerMap) =>
                          props.rigOnline()
                              ? swallow(workspace.answerInput({ requestId, answers }))
                              : undefined,
                  }
                : {})}
            expandedTurnIds={conversation.expandedTurnIds}
            onTraceToggle={(turnId) => workspace.turnTraceToggle(turnId)}
            overlay={
                conversation.openImage ? (
                    <ModalOverlay onDismiss={() => workspace.imageClose()} placement="fill">
                        <Lightbox
                            alt={conversation.openImage.alt}
                            imageUrl={conversation.openImage.url}
                            onClose={() => workspace.imageClose()}
                            {...(conversation.openImage.total > 1
                                ? {
                                      position: {
                                          index: conversation.openImage.index,
                                          total: conversation.openImage.total,
                                      },
                                      onNext: () => workspace.imageNext(),
                                      onPrevious: () => workspace.imagePrevious(),
                                  }
                                : {})}
                        />
                    </ModalOverlay>
                ) : undefined
            }
            requestSubmissions={conversation.requestSubmissions}
            requestSelections={conversation.requestSelections}
            onRequestSelectionChange={(requestId, answers) =>
                workspace.requestSelectionUpdate(requestId, answers)
            }
            activityTreatment="focused"
            motion="calm-typed"
            running={conversation.running}
            elapsedMs={rigTurnElapsedMs(conversation, props.now)}
            now={props.now}
            workingPhase={conversation.workingPhase}
            workingLabel={conversation.workingLabel}
            workingWait={rigWaitStatus(conversation, props.now)}
            viewerId={props.viewerId}
        />
    );
}

/**
 * The scheduled wait the footer counts down, paired with the surface clock it
 * is measured against. The daemon's own label states an absolute deadline that
 * stops being useful the moment it is written; handing the status line both
 * ends and a ticking `now` is what turns it into something that keeps changing
 * while the reader watches it.
 */
function rigWaitStatus(
    conversation: { readonly running: boolean; readonly workingWait?: RigWorkingWait },
    now: number,
): AgentWaitStatus | undefined {
    if (!conversation.running || conversation.workingWait === undefined) return undefined;
    return { ...conversation.workingWait, now };
}

/**
 * Live elapsed for the open turn, counted from when the user sent the request
 * (before the first token). Prefers the store's request-send clock; falls back
 * to the last user message's createdAt when a reconnect leaves that unset.
 */
function rigTurnElapsedMs(
    conversation: {
        readonly running: boolean;
        readonly runStartedAt?: number;
        readonly turnElapsedMs?: number;
        readonly entries: readonly ConversationEntry[];
    },
    now: number,
): number | undefined {
    if (!conversation.running) return conversation.turnElapsedMs;
    if (conversation.runStartedAt !== undefined)
        return Math.max(0, now - conversation.runStartedAt);
    let earliestSentAt: number | undefined;
    for (let index = conversation.entries.length - 1; index >= 0; index -= 1) {
        const entry = conversation.entries[index];
        if (entry?.kind === "turnStatus" && entry.status !== "steered") break;
        if (entry?.kind !== "message") continue;
        if (!rigHumanMessageAuthor(entry.message.sender)) continue;
        const sentAt = Date.parse(entry.message.createdAt);
        if (Number.isFinite(sentAt)) earliestSentAt = sentAt;
    }
    return earliestSentAt === undefined ? undefined : Math.max(0, now - earliestSentAt);
}

/**
 * The right panel's header band and its two stacked regions. The upper one is
 * the addressed project/worktree's live changed-file list; the lower one is the
 * terminal section. The divider between them is the user's, so a shell can take
 * most of the column or none of it.
 *
 * Only the tab strip re-renders from this component's subscription; a terminal's
 * own output lands in `RigTerminalTab`, which subscribes to that terminal alone,
 * so a busy shell never re-renders its neighbours or the tab bar above it.
 *
 * The band is empty and still earns its place: it puts this column's tabs on the
 * same line as the session tabs beside them instead of a header's height higher,
 * and in the desktop window it gives that edge a lane to drag the window by.
 */
/**
 * The dialogs that belong to the window rather than to a screen: naming a row,
 * and Create. Both are reached from chrome that is on every route — the cog on a
 * sidebar row, the Create row above it — so they are mounted once beside the
 * screen instead of inside one of them, and they answer the same way wherever
 * the reader happens to be. Being outside the screen is also what keeps a task
 * being written alive while the surface behind it changes.
 *
 * One subscription serves both: this is a single window-level adapter onto one
 * materialized store, so the routes that render no workspace surface still see
 * a draft change as it is typed.
 */
function RigWindowDialogs(props: {
    projects: readonly RigProjectGroup[];
    rigOnline: () => boolean;
    unavailable?: string;
    workspace: RigWorkspaceStore;
}) {
    const workspace = useSyncExternalStore(
        props.workspace.subscribe,
        props.workspace.get,
        props.workspace.get,
    );
    return (
        <>
            {rigNamingDialog(
                workspace.rename,
                workspace.projectArchive,
                workspace.projectCompute,
                props.projects,
                props.workspace,
                props.rigOnline,
                props.unavailable,
            )}
            {rigCreateDialog(workspace.create, props.workspace, props.rigOnline, props.unavailable)}
            {workspace.projectClone ? (
                <RigProjectCloneDialog
                    repository={workspace.projectClone.repository}
                    submitting={workspace.projectClone.submitting}
                    onClose={() => props.workspace.projectCloneCancel()}
                    onRepositoryChange={(value) => props.workspace.projectRepositoryUpdate(value)}
                    onSubmit={() => props.workspace.projectCloneSubmit()}
                    {...(workspace.projectClone.error === undefined
                        ? {}
                        : { error: workspace.projectClone.error })}
                    {...(props.unavailable === undefined
                        ? {}
                        : { submitDisabledReason: props.unavailable })}
                />
            ) : null}
        </>
    );
}

/**
 * Where a row is named. A project opens its settings dialog rather than a bare
 * field: it has an identity and a checkout worth stating, and its name is the
 * one thing about it the daemon takes a new value for, so the name belongs
 * inside that surface. A worktree has nothing but its name, and gets the field.
 *
 * The project's settings are also where it ends: the archive lives in that same
 * dialog, so the confirmation, what it is waiting on, and why it failed are all
 * one projection of this store rather than a second surface over the first.
 */
function rigNamingDialog(
    rename: RigWorkspaceSnapshot["rename"],
    archive: RigWorkspaceSnapshot["projectArchive"],
    compute: RigWorkspaceSnapshot["projectCompute"],
    projects: readonly RigProjectGroup[],
    store: RigWorkspaceStore,
    rigOnline: () => boolean,
    unavailable?: string,
): ReactNode {
    if (!rename) return null;
    if (rename.worktreeId)
        return (
            <ModalOverlay onDismiss={() => store.renameCancel()}>
                <Modal
                    footer={
                        <>
                            <Button onClick={() => store.renameCancel()} variant="ghost">
                                Cancel
                            </Button>
                            <Button
                                disabled={rename.submitting || unavailable !== undefined}
                                onClick={() => {
                                    if (rigOnline())
                                        void store.renameSubmit().catch(() => undefined);
                                }}
                                variant="primary"
                            >
                                Rename
                            </Button>
                        </>
                    }
                    onClose={() => store.renameCancel()}
                    size="small"
                    title={`Rename ${rename.currentName}`}
                >
                    <TextField
                        disabled={rename.submitting}
                        fullWidth
                        label="Name"
                        onSubmit={() => {
                            if (rigOnline()) void store.renameSubmit().catch(() => undefined);
                        }}
                        onValueChange={(value) => store.renameDraftUpdate(value)}
                        value={rename.draft}
                    />
                </Modal>
            </ModalOverlay>
        );
    // The project may have been archived from another window while this was
    // open. The dialog stays up on what the rename itself carries — the reader
    // still has an edit in front of them, and dismissing it is what clears the
    // draft — and simply drops the section it can no longer state.
    const project = projects.find((candidate) => candidate.id === rename.projectId);
    // Only what this dialog's own project is doing: an archive confirmed on
    // another project — or one this dialog was opened over afterwards — is not
    // this reader's question.
    const archiving = archive?.projectId === rename.projectId ? archive : undefined;
    // The archive is shown whenever an intent for it exists, whether or not the
    // row is in the list this render happens to hold: an operation the reader
    // started is not a fact about the catalog, and dropping the block the moment
    // the row went would take the pending state, the button, and the reason a
    // failure gave with it. Only a project with nothing pending has to be listed
    // to be offered one.
    const archiveBlock =
        archiving || project
            ? {
                  archive: {
                      confirming: archiving !== undefined,
                      submitting: archiving?.submitting === true,
                      ...(archiving?.error !== undefined ? { error: archiving.error } : {}),
                  },
              }
            : {};
    // Only this dialog's own project again. The compute block is materialized
    // with the dialog and released with it, so a snapshot naming another project
    // can only be one this render has raced; dropping it is what stops one
    // project's setting — and the handler that would save it — from being shown
    // over another.
    const computeBlock =
        compute?.projectId === rename.projectId
            ? {
                  compute: {
                      status: compute.status,
                      mode: compute.mode,
                      image: compute.image,
                      ...(compute.current === undefined ? {} : { current: compute.current }),
                      submitting: compute.submitting,
                      ...(compute.error === undefined ? {} : { error: compute.error }),
                      ...(compute.readError === undefined ? {} : { readError: compute.readError }),
                  },
              }
            : {};
    return (
        <RigProjectSettingsDialog
            draft={rename.draft}
            {...(project?.avatar ? { imageUrl: project.avatar.url } : {})}
            {...archiveBlock}
            {...computeBlock}
            {...(project
                ? {
                      contents: {
                          sessions:
                              project.conversations.length +
                              project.worktrees.reduce(
                                  (total, worktree) => total + worktree.conversations.length,
                                  0,
                              ),
                          worktrees: project.worktrees.length,
                      },
                      location: { displayPath: project.displayPath, path: project.path },
                  }
                : {})}
            // While an archive is pending, the name is the one the intent
            // captured and the store keeps current against the host: what the
            // reader is being asked to destroy has to be the entity that is
            // about to be destroyed, not whatever this dialog was opened on.
            name={archiving?.name ?? rename.currentName}
            onArchiveCancel={() => store.projectArchiveCancel()}
            onArchiveConfirm={() => {
                if (rigOnline()) void store.projectArchiveSubmit().catch(() => undefined);
            }}
            onArchiveRequest={() => store.projectArchiveOpen(rename.projectId)}
            onClose={() => store.renameCancel()}
            onComputeImageChange={(value) => store.projectComputeImageUpdate(value)}
            onComputeModeChange={(mode) => store.projectComputeModeUpdate(mode)}
            onComputeSubmit={() => {
                if (rigOnline()) void store.projectComputeSubmit().catch(() => undefined);
            }}
            onDraftChange={(value) => store.renameDraftUpdate(value)}
            onSubmit={() => {
                if (rigOnline()) void store.renameSubmit().catch(() => undefined);
            }}
            submitting={rename.submitting}
            {...(unavailable === undefined ? {} : { submitDisabledReason: unavailable })}
        />
    );
}

/**
 * Create, as the window's own surface. The store owns what is being written, so
 * this is only a projection of `workspace.create` into the shared dialog and its
 * callbacks back into the same store — including the task, which lives there so
 * that closing the dialog puts it down rather than destroying it.
 */
function rigCreateDialog(
    create: RigWorkspaceSnapshot["create"],
    store: RigWorkspaceStore,
    rigOnline: () => boolean,
    unavailable?: string,
): ReactNode {
    if (!create) return null;
    return (
        <RigCreateSessionDialog
            destinations={create.groups.map((group) => ({
                displayPath: group.displayPath,
                id: group.id,
                label: group.label,
                ...(group.parentLabel === undefined ? {} : { parentLabel: group.parentLabel }),
            }))}
            destinationsLoading={create.groupsLoading}
            {...(create.groupId === undefined ? {} : { destinationId: create.groupId })}
            {...(create.draft ? { menus: create.draft.menus } : {})}
            {...(create.error === undefined ? {} : { error: create.error })}
            keepOpen={create.keepOpen}
            onClose={() => store.createCancel()}
            onDestinationSelect={(id) => store.createGroupUpdate(id as RigGroupId)}
            onEffortChange={(effort) => store.createEffortUpdate(effort)}
            onKeepOpenChange={(keepOpen) => store.createKeepOpenUpdate(keepOpen)}
            onModelChange={(selection) => store.createModelUpdate(selection)}
            onPermissionModeChange={(mode) => store.createPermissionModeUpdate(mode)}
            onServiceTierChange={(tier) => store.createServiceTierUpdate(tier)}
            onSubmit={() => {
                if (rigOnline()) void store.createSubmit().catch(() => undefined);
            }}
            onTextChange={(text) => store.createTextUpdate(text)}
            submitting={create.submitting}
            {...(unavailable === undefined ? {} : { submitDisabledReason: unavailable })}
            text={create.text}
        />
    );
}

/**
 * One changed file as a listing entry. Under "All files" the changed ones keep
 * their status marks, so the work in progress stays findable inside the whole
 * tree rather than becoming indistinguishable from everything around it.
 */
function changeEntry(change: OpenGroup["changes"][number]): FileTreeBuildEntry {
    return {
        path: change.path,
        gitStatus: change.status,
        ...(change.addedLines === undefined ? {} : { addedLines: change.addedLines }),
        ...(change.deletedLines === undefined ? {} : { deletedLines: change.deletedLines }),
    };
}

function RigPanelBody(props: {
    activity?: RigConversationSnapshot;
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    mediaWindow?: MediaWindowOpener;
    canStartTerminal: boolean;
    changes: OpenGroup["changes"];
    closeShortcut?: KeyboardShortcut;
    expanded: ReadonlySet<string>;
    collapsed: ReadonlySet<string>;
    layout: RigFileLayout;
    /** Reference clock for elapsed subagent activity. */
    now: number;
    /** Selects Activity through the workspace so Usage closes first. */
    onActivityOpen: () => void;
    /** Stops one background process from the Activity tab. */
    onActivityProcessStop?: (processId: number) => void;
    /** Opens one delegated child session from the Activity tab. */
    onSubagentSelect?: (sessionId: string) => void;
    onFileOpen: (path: string) => void;
    onFileSelect: (path: string) => void;
    onLayoutChange: (layout: RigFileLayout) => void;
    onPanelClose: () => void;
    /** The file the viewer tab is on, read out of the transcript beside it. */
    panelFile?: RigFileTabSnapshot;
    /**
     * Draws one open file. It is the workspace's own file body, so the file
     * beside a conversation is the identical surface to the file in a
     * main-content tab — same header, same Rendered / Source, same editor,
     * same Command-S.
     */
    fileBody: (file: RigFileTabSnapshot) => ReactNode;
    onPanelFileClose: () => void;
    onScopeChange: (scope: RigFileScope) => void;
    onToggle: (path: string, expanded: boolean) => void;
    /** Moves one view out of this panel and into the main content. */
    onViewTransfer: (viewId: string) => void;
    /** Closes one panel view through the same route used by Cmd-W. */
    onViewClose: (viewId: string) => void;
    panel: RigPanelSnapshot;
    previewTool?: ConversationToolCall;
    /** Owning Rig availability applied to every retained terminal tab. */
    rigAvailability?: "reconnecting" | "unavailable";
    rigAvailabilityReason?: string;
    scope: RigFileScope;
    sessionId?: string;
    selectedPath?: string;
    store: RigPanelStore;
    workspaceFiles?: RigWorkspaceFiles;
    workspaceFilesLoading: boolean;
}) {
    const all = props.scope === "all";
    // A checkout can hold twenty thousand paths, and putting them in reading
    // order costs a locale comparison per step. That is affordable once per
    // listing and not affordable once per keystroke elsewhere in the window, so
    // the entries are held against the two store values they are actually built
    // from. Everything downstream is then a walk rather than a sort.
    const workspacePaths = props.workspaceFiles?.paths;
    const entries: FileTreeBuildEntry[] = useMemo(() => {
        const changesByPath = new Map(props.changes.map((change) => [change.path, change]));
        return all
            ? (workspacePaths ?? []).map((path: string) => {
                  const change = changesByPath.get(path);
                  return change ? changeEntry(change) : { path };
              })
            : props.changes.map(changeEntry);
    }, [all, props.changes, workspacePaths]);
    // The whole checkout lands showing its top level and what is directly
    // inside it. A column of shut folders makes the reader open three of them
    // before the listing says anything a flat list would not have said sooner.
    const expansion: FileTreeExpansion = useMemo(
        () => ({ opened: props.expanded, closed: props.collapsed, defaultDepth: 1 }),
        [props.expanded, props.collapsed],
    );
    const nodes: FileTreeNode[] = useMemo(
        () =>
            props.layout === "tree" ? fileTreeBuild(entries, expansion) : fileTreeFlatten(entries),
        [entries, expansion, props.layout],
    );
    const loading = all && props.workspaceFilesLoading;
    // The listing's own total, summed from the rows it is about to draw, so the
    // number over the list and the numbers in it can never disagree.
    const addedLines = props.changes.reduce((sum, change) => sum + (change.addedLines ?? 0), 0);
    const deletedLines = props.changes.reduce((sum, change) => sum + (change.deletedLines ?? 0), 0);
    const count = entries.length;
    // Only the tabs this side is holding: one the reader moved into the main
    // content is drawn there, and the panel neither lists it nor renders it.
    const panelTools = toolTabsPlaced(props.panel, "panel");
    const activeToolTab = panelTools.find((tab) => tab.id === props.panel.activeViewId);
    const panelFile = props.panelFile;
    const activityTabShown =
        props.panel.activityViewOpen ||
        (props.activity?.activityAvailable === true && !props.panel.activityViewDismissed);
    const activityBackgroundProcesses = props.activity
        ? props.activity.backgroundProcesses.filter((process) =>
              props.activity?.detachedBackgroundProcessIds.has(process.id),
          )
        : [];
    const allFilesUnavailable =
        props.rigAvailability !== undefined && props.workspaceFiles === undefined
            ? (props.rigAvailabilityReason ?? "Rig must reconnect before loading all files.")
            : undefined;
    const baseTabs: TabItem[] = [
        { closable: false, icon: "files", id: "files", label: "Files" },
        ...(activityTabShown
            ? [{ closable: true, icon: "agents" as const, id: "activity", label: "Activity" }]
            : []),
        ...(props.panel.fileViewOpen && panelFile
            ? [
                  {
                      ...fileTabItem(panelFile),
                      closable: true,
                      id: RIG_PANEL_FILE_VIEW_ID,
                      // The viewer holds whatever the transcript last pointed
                      // at, so it is marked as the replaceable tab it is.
                      preview: true,
                  } satisfies TabItem,
              ]
            : []),
        ...(props.panel.previewEntryId
            ? [
                  {
                      closable: true,
                      icon:
                          props.previewTool?.presentation?.type === "fileDiff"
                              ? ("doc" as const)
                              : props.previewTool?.presentation?.type === "execCommand" ||
                                  props.previewTool?.presentation?.type ===
                                      "backgroundTerminalInteraction"
                                ? ("terminal" as const)
                                : ("zap" as const),
                      id: "preview",
                      label: "Preview",
                      preview: true,
                  },
              ]
            : []),
        ...toolTabItems(panelTools),
    ];
    const tabs = baseTabs;
    return (
        <>
            {/* The panel's own chrome control, at its leading edge. */}
            <PanelHeader edgeControl>
                <Button
                    aria-label="Hide panel"
                    aria-pressed
                    icon="panel-collapse"
                    iconOnly
                    onClick={props.onPanelClose}
                    shortcut={PANEL_TOGGLE_HINT}
                    size="small"
                    variant="ghost"
                />
            </PanelHeader>
            {/* The whole panel accepts a tab dragged out of the main strip,
                rather than a target inside it: the reader is aiming at this
                side of the window, not at a stripe within it. */}
            <TransferZone
                icon="panel-expand"
                id={TRANSFER_ZONE_PANEL}
                label="Open in the side panel"
            >
                <TabbedPane
                    actions={
                        props.canStartTerminal ? (
                            <>
                                {props.browserContent ? (
                                    <Button
                                        aria-label="New browser"
                                        icon="globe"
                                        iconOnly
                                        onClick={() => props.store.browserAdd()}
                                        size="small"
                                        variant="ghost"
                                    />
                                ) : null}
                                {/* A shell runs in the checkout, so a checkout
                                    that cannot take work cannot host one. The
                                    panel carries the reason with its scope. */}
                                <Button
                                    aria-label="New terminal"
                                    disabled={props.panel.terminalRefusal !== undefined}
                                    icon="terminal"
                                    iconOnly
                                    onClick={() => props.store.terminalAdd()}
                                    size="small"
                                    title={props.panel.terminalRefusal ?? "New terminal"}
                                    variant="ghost"
                                />
                            </>
                        ) : undefined
                    }
                    activeId={props.panel.activeViewId}
                    closeLabel="Close tab"
                    {...(props.closeShortcut ? { closeShortcut: props.closeShortcut } : {})}
                    onClose={props.onViewClose}
                    onSelect={(tabId) => {
                        if (tabId === "files") props.store.filesSelect();
                        else if (tabId === "activity") props.onActivityOpen();
                        else if (tabId === "preview" && props.panel.previewEntryId)
                            props.store.previewOpen(props.panel.previewEntryId);
                        else if (tabId === RIG_PANEL_FILE_VIEW_ID) props.store.fileViewOpen();
                        else props.store.tabSelect(tabId as RigPanelTabId);
                    }}
                    onTransfer={(tabId) => props.onViewTransfer(tabId)}
                    tabs={tabs}
                    // The listing opens content rather than being content, and a
                    // tool-call preview is bound to an entry of the conversation
                    // the main content is showing; neither has a form over there.
                    transferable={(tab) =>
                        tab.id !== "files" && tab.id !== "activity" && tab.id !== "preview"
                    }
                    transferTargets={PANEL_TRANSFER_TARGETS}
                >
                    <RigToolBodies
                        activeId={props.panel.activeViewId}
                        {...(props.browserContent ? { browserContent: props.browserContent } : {})}
                        {...(props.sessionId ? { sessionId: props.sessionId } : {})}
                        store={props.store}
                        tabs={panelTools}
                        {...(props.rigAvailability === undefined
                            ? {}
                            : {
                                  rigAvailability: props.rigAvailability,
                                  ...(props.rigAvailabilityReason === undefined
                                      ? {}
                                      : { rigAvailabilityReason: props.rigAvailabilityReason }),
                              })}
                    />
                    {props.panel.activeViewId === "files" ? (
                        <FileBrowser
                            // The whole-checkout listing is not a diff, so it states
                            // how many files it holds and nothing about lines.
                            {...(all ? {} : { addedLines, deletedLines })}
                            count={count}
                            emptyLabel={all ? "No files." : "No changed files."}
                            layout={props.layout}
                            loading={loading}
                            nodes={nodes}
                            {...(props.rigAvailabilityReason === undefined
                                ? {}
                                : { unavailable: props.rigAvailabilityReason })}
                            {...(props.rigAvailability !== undefined && all
                                ? {
                                      fileActionsUnavailable:
                                          props.rigAvailabilityReason ??
                                          "Rig must reconnect before opening files.",
                                  }
                                : {})}
                            // A truncated listing says so rather than passing off
                            // part of a repository as the whole of it.
                            {...(all && props.workspaceFiles?.truncated
                                ? { note: "Showing the first 20,000 files." }
                                : {})}
                            onLayoutChange={(layout: RigFileLayout) => props.onLayoutChange(layout)}
                            {...(props.rigAvailability === undefined
                                ? { onOpen: props.onFileOpen }
                                : {})}
                            onScopeChange={(scope: RigFileScope) => props.onScopeChange(scope)}
                            {...(allFilesUnavailable === undefined
                                ? {}
                                : {
                                      scopeUnavailable: {
                                          all: allFilesUnavailable,
                                      },
                                  })}
                            onSelect={(path: string) => props.onFileSelect(path)}
                            onToggle={props.onToggle}
                            scope={props.scope}
                            selectedId={props.selectedPath}
                        />
                    ) : props.panel.activeViewId === "activity" ? (
                        props.activity ? (
                            <RigActivityPanel
                                backgroundProcesses={activityBackgroundProcesses}
                                goal={props.activity.goal}
                                now={props.now}
                                onBackgroundProcessStop={props.onActivityProcessStop}
                                onSubagentSelect={props.onSubagentSelect}
                                placement="panel"
                                subagents={props.activity.subagents}
                                tasks={props.activity.tasks}
                            />
                        ) : (
                            <EmptyState
                                description="Open a session to see its goal, tasks, subagents, and background terminals."
                                icon="agents"
                                size="panel"
                                title="No session activity"
                            />
                        )
                    ) : props.panel.activeViewId === "preview" ? (
                        props.previewTool ? (
                            <ToolCallPreview tool={props.previewTool} />
                        ) : (
                            <EmptyState
                                description="The selected call is no longer in this conversation view."
                                icon="zap"
                                size="panel"
                                title="Preview unavailable"
                            />
                        )
                    ) : props.panel.activeViewId === RIG_PANEL_FILE_VIEW_ID ? (
                        panelFile ? (
                            props.fileBody(panelFile)
                        ) : (
                            <EmptyState
                                description="The file this conversation pointed at is no longer open."
                                icon="doc"
                                size="panel"
                                title="No file open"
                            />
                        )
                    ) : activeToolTab ? null : ( // Already drawn above, for every kind of tool.
                        <EmptyState
                            description="Select Files, a preview, or a live tool tab."
                            icon="files"
                            size="panel"
                            title="Nothing selected"
                        />
                    )}
                </TabbedPane>
            </TransferZone>
        </>
    );
}

/**
 * Whether a file is one the shell's separate window has a viewer for. Pictures
 * and recordings are; a document, a listing, or an archive is not, and offering
 * to open one in a window that could only say so again would be a control that
 * does nothing.
 */
function mediaWindowShowable(kind: FilePreviewKind): boolean {
    return kind === "image" || kind === "video";
}

/**
 * One terminal tab. It reads the terminal's own store, which is the only thing in
 * this surface that changes on every frame of output, and hands it to the shared
 * `TerminalPanel` with no height of its own so it fills the panel column. The tab
 * names it and closes it, so the panel draws no chrome of its own above the grid.
 */
/**
 * The bodies of the live tool tabs on one side of the workspace, written once
 * and rendered by whichever side is currently holding them: moving a tab across
 * the window changes which strip draws it and nothing about what it is.
 *
 * Browser pages are all mounted together and only one is shown, because a page that
 * stopped being looked at is still loaded and unmounting it would throw the
 * session away; a terminal is drawn only while it is on screen, and its process
 * outlives its view because the store, not this component, is what holds it.
 *
 * Moving a terminal across the window therefore costs it nothing: the view is
 * rebuilt on the other side and attaches to the same running shell. A page
 * cannot be given that promise. An iframe reloads whenever it is moved to a
 * different parent — that is the browser's rule, not this component's, and no
 * arrangement of React can move a node without moving it. So a page that
 * changes sides loads again, from the address the store kept for it, which is
 * why the address lives in the store and not in the frame.
 */
function RigToolBodies(props: {
    tabs: readonly RigPanelTabSnapshot[];
    activeId: string | undefined;
    store: RigPanelStore;
    browserContent?: BrowserContentRenderer;
    /** Owning Rig availability applied to retained terminal tabs. */
    rigAvailability?: "reconnecting" | "unavailable";
    rigAvailabilityReason?: string;
    sessionId?: string;
}) {
    const active = props.tabs.find((tab) => tab.id === props.activeId);
    return (
        <>
            {props.tabs
                .filter((tab) => tab.kind === "browser")
                .map((tab) => (
                    <BrowserPanel
                        active={props.activeId === tab.id}
                        initialUrl={tab.url}
                        key={tab.id}
                        onLocationChange={(url) => props.store.browserUpdate(tab.id, { url })}
                        onTitleChange={(title) => props.store.browserUpdate(tab.id, { title })}
                        {...(props.rigAvailability === undefined
                            ? {}
                            : {
                                  unavailable:
                                      props.rigAvailabilityReason ??
                                      "This Rig is reconnecting. Browser navigation is paused.",
                              })}
                        renderContent={
                            props.browserContent && props.sessionId
                                ? (browserProps) =>
                                      props.browserContent!({
                                          ...browserProps,
                                          sessionId: props.sessionId,
                                      })
                                : undefined
                        }
                    />
                ))}
            {active?.kind === "terminal" ? (
                <RigTerminalTab
                    key={active.id}
                    store={props.store}
                    tabId={active.id}
                    {...(props.rigAvailability === undefined
                        ? {}
                        : {
                              rigAvailability: props.rigAvailability,
                              ...(props.rigAvailabilityReason === undefined
                                  ? {}
                                  : { rigAvailabilityReason: props.rigAvailabilityReason }),
                          })}
                />
            ) : null}
        </>
    );
}

function RigTerminalTab(props: {
    store: RigPanelStore;
    tabId: RigPanelTabId;
    rigAvailability?: "reconnecting" | "unavailable";
    rigAvailabilityReason?: string;
}) {
    const terminal: RigTerminalStore | undefined = props.store.terminal(props.tabId);
    if (!terminal)
        return (
            <EmptyState
                description="This terminal is no longer available."
                icon="terminal"
                size="panel"
                title="Terminal closed"
            />
        );
    return (
        <RigTerminalScreen
            terminal={terminal}
            {...(props.rigAvailability === undefined
                ? {}
                : {
                      rigAvailability: props.rigAvailability,
                      ...(props.rigAvailabilityReason === undefined
                          ? {}
                          : { rigAvailabilityReason: props.rigAvailabilityReason }),
                  })}
        />
    );
}

/** The subscribed half of a terminal tab, split out so the store is non-optional. */
function RigTerminalScreen(props: {
    terminal: RigTerminalStore;
    rigAvailability?: "reconnecting" | "unavailable";
    rigAvailabilityReason?: string;
}) {
    const { terminal } = props;
    const snapshot = useSyncExternalStore(terminal.subscribe, terminal.get, terminal.get);
    return (
        <TerminalPanel
            exitCode={snapshot.exitCode}
            {...(snapshot.grid ? { grid: snapshot.grid } : {})}
            {...(snapshot.error ? { error: snapshot.error.message } : {})}
            onInput={(data) => terminal.terminalWrite(data)}
            onOpenLink={openExternalLink}
            onReconnect={() => terminal.terminalReconnect()}
            onResize={(cols, rows) => terminal.terminalResize(cols, rows)}
            {...(props.rigAvailability === undefined
                ? {}
                : {
                      rigAvailability: props.rigAvailability,
                      ...(props.rigAvailabilityReason === undefined
                          ? {}
                          : { rigAvailabilityReason: props.rigAvailabilityReason }),
                  })}
            status={snapshot.status}
        />
    );
}
