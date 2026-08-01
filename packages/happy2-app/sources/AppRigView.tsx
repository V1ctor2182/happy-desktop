import { useSyncExternalStore, type ReactNode } from "react";
import type {
    AppearanceStore,
    ConversationEntry,
    ConversationSummary,
    ConversationToolCall,
    RigClockStore,
    RigFileTabKind,
    RigFileTabSnapshot,
    RigConnectionStore,
    RigConversationSnapshot,
    RigCreateSnapshot,
    RigFileLayout,
    RigWorkspaceFiles,
    RigFileScope,
    RigFileViewMode,
    RigHost,
    RigGroupId,
    RigModelStore,
    RigModelSelection,
    NotesSessionStore,
    NoteSummary,
    RigPanelSnapshot,
    RigPanelStore,
    RigPanelTabId,
    RigPermissionMode,
    RigInboxItem,
    RigInboxSnapshot,
    RigInboxStore,
    RigProviderUsageEntry,
    RigProviderUsageStore,
    RigProjectGroup,
    RigProjectId,
    RigServiceTier,
    RigSessionCreateInput,
    RigSessionId,
    RigSubagentSummary,
    RigTerminalStore,
    RigThinkingLevel,
    RigWindowStore,
    RigWorkspaceSnapshot,
    RigWorkspaceStore,
    RigWorktreeId,
    UserError,
} from "happy2-state";
import {
    rigAgentAuthor,
    rigInboxStoreNoop,
    rigProviderUsageStoreNoop,
    rigOwnerAuthor,
    rigWindowStoreNoop,
} from "happy2-state";
import {
    AppShell,
    Banner,
    BrowserPanel,
    type BrowserContentRenderer,
    Button,
    ChannelHeader,
    ContextMeter,
    ChangedFileDiff,
    ComposerFooterBar,
    ComposerModelControl,
    ConversationDock,
    ConversationView,
    EmptyState,
    FileBrowser,
    FileEditor,
    FilePreview,
    filePreviewKind,
    FloatingConversationDock,
    Lightbox,
    Checkbox,
    Modal,
    ModalOverlay,
    FriendsPage,
    NotesPage,
    RigActivityPanel,
    RigConnectionStatus,
    RigControlMenu,
    fileTreeBuild,
    fileTreeFlatten,
    fileTreeVisibleFiles,
    type FileTreeBuildEntry,
    RigSessionControls,
    RigUsagePanel,
    PanelHeader,
    Sidebar,
    SidebarFooter,
    SidebarUpdateAction,
    RigInboxPage,
    RigProviderUsagePage,
    TabbedPane,
    TextField,
    TerminalPanel,
    ToolCallPreview,
    WindowDragRegion,
    rigComposerModelControlProps,
    sidebarReorderMove,
    type MenuItem,
    type FileTreeNode,
    type FileTreeSelectModifiers,
    type SidebarItem,
    type SidebarSection,
    type TabItem,
} from "happy2-ui";
import { openExternalLink } from "./externalLink";
import { NewSessionShortcut } from "./components/NewSessionShortcut";

export interface AppRigUpdate {
    readonly action: "refresh" | "restart";
    readonly detail?: string;
    readonly status: "available" | "downloading" | "downloaded";
    readonly version?: string;
}

/**
 * One Rig this window can work in: the daemon on this machine, or a remembered
 * machine reached over SSH. Both carry the same product stores, which is what lets
 * another machine's projects open the same screens as this one's.
 */
export interface AppRigEntry {
    readonly id: string;
    readonly kind: "local" | "remote";
    readonly label: string;
    /** The reader's standing intent for a remote machine; this machine is always wanted. */
    readonly connected: boolean;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly message?: string;
    readonly version?: string;
    /** The SSH destination a remote machine is reached at; absent for this machine. */
    readonly destination?: string;
    readonly projects: readonly RigProjectGroup[];
    readonly projectsStatus: "loading" | "ready" | "error";
    /** The live stores for this Rig, present once its connection is up. */
    readonly session?: AppRigSession;
}

export interface AppRigSession {
    readonly clock: RigClockStore;
    readonly connection: RigConnectionStore;
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
     * How much of each provider account's plan this machine has spent. Absent
     * when the machine reports no usage, which is why the Usage row is absent
     * too rather than opening onto an account list that means nothing.
     */
    readonly providerUsage?: RigProviderUsageStore;
}

export interface AppRigAddSnapshot {
    readonly open: boolean;
    readonly destination: string;
    readonly label: string;
    readonly error?: string;
}

export interface AppRigDirectorySnapshot {
    readonly add: AppRigAddSnapshot;
    readonly rigs: readonly AppRigEntry[];
}

/**
 * Every Rig in the window, plus the draft state of the form that adds one. The
 * surface holds no local state of its own: adding a machine is typed into this
 * store, and connecting or disconnecting one is a call on it.
 */
export interface AppRigDirectoryStore {
    get(): AppRigDirectorySnapshot;
    subscribe(listener: () => void): () => void;
    addOpen(): void;
    addClose(): void;
    destinationUpdate(value: string): void;
    labelUpdate(value: string): void;
    addSubmit(): void;
    rigConnect(id: string): void;
    rigDisconnect(id: string): void;
    rigRemove(id: string): void;
    /**
     * Records which Rig the window is addressing. The URL decides it; the store
     * is told so that window-level events with no Rig of their own — a URL handed
     * to the app to open — land in the workspace on screen.
     */
    rigActivate(id: string): void;
}

export interface AppRigViewProps {
    /** Every Rig in this window, and the form that adds another machine. */
    rigs: AppRigDirectoryStore;
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
    /** Native or hosted-renderer update projected by the desktop host. */
    update?: AppRigUpdate;
    /** Applies the ready update. Absent in a plain browser surface. */
    onUpdateApply?: () => void;
    /** Native page renderer supplied only by the packaged Electron host. */
    browserContent?: BrowserContentRenderer;
    /**
     * The addressed group — a project or one of its worktrees — and conversation,
     * read from the route by the caller. This surface never decides what is
     * shown; it renders the addressed group's sessions and asks for a different
     * address through `onChatSelect`, exactly as the cloud workspace does.
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
    /**
     * This machine's notes. They belong to the window rather than to any Rig —
     * they are files in the reader's own home directory — so they arrive here as
     * one store beside the directory of Rigs instead of inside a Rig's session.
     */
    notes?: NotesSessionStore;
    /** Whether the URL addresses the notes surface, and which note in it. */
    notesOpen?: boolean;
    noteId?: string;
    /** Addresses the notes surface, with a note or without one. */
    onNotesOpen?(noteId?: string): void;
    /** Whether the URL addresses the addressed Rig's inbox of agent questions. */
    inboxOpen?: boolean;
    /** Addresses that inbox. */
    onInboxOpen?(): void;
    /** Whether the URL addresses the addressed Rig's provider usage. */
    usageOpen?: boolean;
    /** Addresses that usage. */
    onUsageOpen?(): void;
    /** Whether the URL addresses the account's friends. */
    friendsOpen?: boolean;
    /** Addresses friends. */
    onFriendsOpen?(): void;
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
    readonly create: RigSessionCreateInput;
}

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
function sidebarItems(project: RigProjectGroup): SidebarItem[] {
    const projectHasLineChanges = (project.addedLines ?? 0) > 0 || (project.deletedLines ?? 0) > 0;
    return [
        {
            id: project.id,
            kind: "project",
            label: project.name,
            initials: project.name.slice(0, 1).toUpperCase(),
            ...(project.kind === "home" ? { icon: "home" as const } : {}),
            ...(project.avatar ? { imageUrl: project.avatar.url } : {}),
            // With changes, the delta occupies the trailing lane until hover
            // reveals the add-workspace control. A clean project offers + directly.
            action: {
                icon: "plus" as const,
                label: `New workspace in ${project.name}`,
                ...(projectHasLineChanges ? { reveal: "hover" as const } : {}),
            },
            // A row only carries a status while one of its sessions is live.
            ...(project.activity === "running" ? { status: "working" as const } : {}),
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
            // Archiving throws away a checkout, so it stays out of sight until
            // the reader is actually on the row.
            action: {
                icon: "archive" as const,
                label: `Archive ${worktree.name}`,
                reveal: "hover" as const,
            },
            ...(worktree.activity === "running" ? { status: "working" as const } : {}),
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

/** The row action ids the sidebar's context menu dispatches back to this surface. */
const ROW_MENU_ARCHIVE = "archive";
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
        { kind: "item", id: ROW_MENU_RENAME, label: "Rename project", icon: "edit" },
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

/** One tab per tool open in the right panel, iconed by what it holds. */
function panelTabs(panel: RigPanelSnapshot): TabItem[] {
    return panel.tabs.map((tab) => ({
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

/** Agent tools which address one delegated session rather than only reporting a list. */
const SUBAGENT_TOOL_NAMES = new Set([
    "Agent",
    "TaskOutput",
    "agent_info",
    "agent_send",
    "followup_task",
    "interrupt_agent",
    "send_message",
    "spawn_agent",
    "spawn_workspace_agent",
    "wait_agent",
]);

/** Collects the strings in a closed tool-argument tree for target matching. */
function toolArgumentStrings(
    value: ConversationToolCall["arguments"],
    strings: string[] = [],
): string[] {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) for (const item of value) toolArgumentStrings(item, strings);
    else if (value !== null && typeof value === "object")
        for (const item of Object.values(value)) toolArgumentStrings(item, strings);
    return strings;
}

/**
 * Resolves an agent-oriented tool call against the parent session's authoritative
 * subagent list. Arguments cover spawn/follow-up/send/interrupt calls, while the
 * result text covers a completed wait. An unqualified wait can only name a chat
 * when exactly one child exists; otherwise the ordinary tool preview remains the
 * honest destination.
 */
function subagentForTool(
    tool: ConversationToolCall,
    subagents: readonly RigSubagentSummary[],
): RigSubagentSummary | undefined {
    const spawned = subagents.filter((subagent) => subagent.parentToolCallId === tool.toolCallId);
    if (spawned.length === 1) return spawned[0];

    const toolName = tool.toolName.split(/[.:/]/).at(-1) ?? tool.toolName;
    if (!SUBAGENT_TOOL_NAMES.has(toolName)) return undefined;
    const strings = toolArgumentStrings(tool.arguments);
    if (tool.display) strings.push(tool.display);

    const exact = subagents.filter((subagent) =>
        strings.some(
            (value) =>
                value === subagent.id ||
                value === subagent.taskName ||
                value === subagent.description ||
                (subagent.taskName !== undefined && value.endsWith(`/${subagent.taskName}`)),
        ),
    );
    if (exact.length === 1) return exact[0];

    const mentioned = subagents.filter((subagent) =>
        strings.some(
            (value) =>
                value.includes(subagent.id) ||
                (subagent.taskName !== undefined && value.includes(subagent.taskName)),
        ),
    );
    if (mentioned.length === 1) return mentioned[0];
    return toolName === "wait_agent" && subagents.length === 1 ? subagents[0] : undefined;
}

/** One tab per session in the open group, marked while the agent is working. */
function sessionTabs(group: OpenGroup): TabItem[] {
    return group.conversations.map((summary) => ({
        id: summary.id,
        label: summary.title,
        // The session's own id, so the mark survives every rename of the title.
        avatarId: summary.id,
        // Both are stated even when false: a session tab holds its leading lane
        // open, so work starting or finishing makes the mark appear and go
        // without sliding the title sideways under the reader.
        busy: summary.activity === "running",
        unread: summary.unread === true,
    }));
}

function fileTabItem(tab: RigFileTabSnapshot): TabItem {
    // A tab of a picture says picture. Wearing the document glyph over every
    // open file made the strip a row of identical marks with only the name to
    // tell them apart.
    const kind = tab.kind === "media" ? filePreviewKind(tab.path) : undefined;
    return {
        id: tab.id,
        label: tab.path.split("/").at(-1) ?? tab.path,
        icon: kind === "image" ? "image" : kind === "video" || kind === "audio" ? "play" : "doc",
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
    return scope === "all" ? "file" : "diff";
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
                };
    }
    return undefined;
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
 * A machine that is not connected contributes only its heading: what it holds is
 * unknown while it is away, and connecting it is a settings act rather than
 * something to reach for from a project list.
 */
function rigSections(directory: AppRigDirectorySnapshot): SidebarSection[] {
    return directory.rigs.map((rig) => ({
        id: `rig:${rig.id}`,
        label: rig.label,
        items: rig.projects.flatMap(sidebarItems).map((item) => ({
            ...item,
            id: rigItemId(rig.id, item.id),
        })),
        ...(rig.projects.length === 0
            ? {
                  empty:
                      rig.status === "connected"
                          ? {
                                actionLabel: "Create",
                                description: "Start a session to begin working here.",
                                icon: "chat" as const,
                                title: "No projects yet",
                            }
                          : {
                                actionLabel: "Open settings",
                                description:
                                    rig.message ??
                                    (rig.status === "connecting"
                                        ? "Connecting to this machine…"
                                        : "Connect this machine to see its projects."),
                                icon: "link" as const,
                                title: rigStatusLabel(rig),
                            },
              }
            : {}),
    }));
}

function rigStatusLabel(rig: AppRigEntry): string {
    if (rig.status === "connected") return "Connected";
    if (rig.status === "connecting") return "Connecting…";
    return rig.status === "error" ? "Not reachable" : "Disconnected";
}

/**
 * The pinned row that opens this machine's notes. It sits with the other pinned
 * rows rather than under a project because a note belongs to the reader, not to
 * one repository or one machine's daemon.
 */
const NOTES_ITEM = "notes";

/**
 * The pinned row that opens the addressed Rig's inbox. It belongs with the
 * pinned rows rather than under a project because the questions it collects come
 * from every session on that machine at once, and the person answering them is
 * working through a queue rather than visiting a repository.
 */
const INBOX_ITEM = "inbox";

/**
 * The pinned row that opens the addressed Rig's provider usage. It sits after
 * the inbox because both are about this machine: the inbox is what its agents
 * are waiting on, and usage is what they have spent to get there.
 */
const USAGE_ITEM = "usage";

/**
 * The pinned row that opens the people this account is connected to. It comes
 * last of the pinned rows because it is the only one that is not about this
 * machine's work: notes and the inbox are what there is to do here, and friends
 * are who is beyond it.
 */
const FRIENDS_ITEM = "friends";

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
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const active =
        directory.rigs.find((rig) => rig.id === props.rigId) ?? directory.rigs[0] ?? undefined;
    const rigOf = (rigId: string) => directory.rigs.find((rig) => rig.id === rigId);
    // The pinned row carries a live count, so the window subscribes to the
    // addressed Rig's inbox whether or not the inbox itself is open: the point of
    // the count is to be seen while the reader is doing something else.
    const inboxStore = active?.session?.inbox ?? rigInboxStoreNoop;
    const inbox = useSyncExternalStore(inboxStore.subscribe, inboxStore.get, inboxStore.get);
    const inboxPending = inbox.pending.length;
    // The usage surface is the only thing that reads this store, so it is
    // subscribed here rather than inside the page for one reason: the
    // subscription is what starts the daemon reading, and it has to stop when
    // the reader looks at something else.
    const usageStore =
        (props.usageOpen ? active?.session?.providerUsage : undefined) ?? rigProviderUsageStoreNoop;
    const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get, usageStore.get);
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
    const sidebar = (
        <Sidebar
            actions={[
                // Notes follow the two rows that give the window somewhere to
                // work, because they are the third thing this window holds that
                // is not a session: the reader's own writing on this machine.
                ...(props.notes
                    ? [
                          {
                              icon: "doc" as const,
                              id: NOTES_ITEM,
                              kind: "action" as const,
                              label: "Notes",
                          },
                      ]
                    : []),
                // The inbox belongs to the addressed machine, so it appears only
                // while that machine is reachable: a queue of questions is
                // meaningless from a Rig that cannot say what it is waiting on.
                ...(active?.session?.inbox
                    ? [
                          {
                              badge: inboxPending,
                              icon: "bell" as const,
                              id: INBOX_ITEM,
                              kind: "action" as const,
                              label: "Inbox",
                          },
                      ]
                    : []),
                // Usage belongs to the addressed machine for the same reason
                // the inbox does: it is that machine's accounts that are being
                // spent, so the row is absent while it cannot say.
                ...(active?.session?.providerUsage
                    ? [
                          {
                              icon: "zap" as const,
                              id: USAGE_ITEM,
                              kind: "action" as const,
                              label: "Usage",
                          },
                      ]
                    : []),
                // Friends belong to the account rather than to a machine, so
                // this row is always here: it opens whether or not any Rig is
                // reachable.
                {
                    icon: "users" as const,
                    id: FRIENDS_ITEM,
                    kind: "action" as const,
                    label: "Friends",
                },
            ]}
            activeItemId={
                props.notesOpen
                    ? NOTES_ITEM
                    : props.inboxOpen
                      ? INBOX_ITEM
                      : props.usageOpen
                        ? USAGE_ITEM
                        : props.friendsOpen
                          ? FRIENDS_ITEM
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
                return rig ? rowMenuItems(rig.projects, { ...item, id: row.id }) : [];
            }}
            onCompose={() => active?.session?.workspace.createOpen()}
            // A section with nothing in it offers the one act that would fill
            // it: starting work here, or connecting the machine that holds it.
            onSectionAction={(sectionId) => {
                const rig = rigOf(sectionId.slice("rig:".length));
                if (rig?.status === "connected") rig.session?.workspace.createOpen();
                else props.onSettingsOpen();
            }}
            onItemMenuSelect={(item, actionId) => {
                const row = rigItemParse(item.id);
                const rig = rigOf(row.rigId);
                if (!rig) return;
                const workspace = rig.session?.workspace;
                const owner = rowOwnerFind(rig.projects, row.id);
                if (!owner || !workspace) return;
                if (actionId === ROW_MENU_RENAME) {
                    workspace.renameOpen(owner.project.id, owner.worktreeId);
                    return;
                }
                if (actionId !== ROW_MENU_ARCHIVE) return;
                // The archived row is about to stop existing, so the URL
                // stops naming it: addressing the list is this surface's
                // job, since the store never navigates. Archiving a
                // project takes its worktrees with it, so an open one of
                // those has to be left as well.
                const closing = owner.worktreeId
                    ? [owner.worktreeId as string]
                    : [
                          owner.project.id as string,
                          ...owner.project.worktrees.map((worktree) => worktree.id as string),
                      ];
                if (
                    props.rigId === rig.id &&
                    props.groupId !== undefined &&
                    closing.includes(props.groupId)
                )
                    props.onChatSelect(rig.id, undefined);
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
                if (id === NOTES_ITEM) {
                    props.onNotesOpen?.();
                    return;
                }
                if (id === INBOX_ITEM) {
                    props.onInboxOpen?.();
                    return;
                }
                if (id === USAGE_ITEM) {
                    props.onUsageOpen?.();
                    return;
                }
                if (id === FRIENDS_ITEM) {
                    props.onFriendsOpen?.();
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
            onItemReorder={(sectionId, move) => {
                const rig = rigOf(sectionId.slice("rig:".length));
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
            sections={rigSections(directory)}
        />
    );

    // The notes surface is the window's, not a Rig's, so it is shown whatever the
    // addressed machine is doing — including while none of them is reachable.
    if (props.notesOpen && props.notes)
        return (
            <AppShell
                sidebarCollapsible
                windowControls={desktop}
                windowFullScreen={windowState.fullScreen}
                sidebar={sidebar}
            >
                {desktop ? <WindowDragRegion /> : null}
                <RigNotesSurface
                    noteId={props.noteId}
                    notes={props.notes}
                    onOpen={(id) => props.onNotesOpen?.(id)}
                    theme={appearance.appearance}
                />
            </AppShell>
        );

    // Friends belong to the account rather than to a machine, so like notes the
    // surface is shown whatever the addressed machine is doing.
    if (props.friendsOpen)
        return (
            <AppShell
                sidebarCollapsible
                windowControls={desktop}
                windowFullScreen={windowState.fullScreen}
                sidebar={sidebar}
            >
                {desktop ? <WindowDragRegion /> : null}
                {/* No connection model exists yet, so the gallery is handed
                    nobody. The surface is the same one it will render a real
                    list into. */}
                <FriendsPage friends={[]} />
            </AppShell>
        );

    // The inbox belongs to the addressed machine, so it is shown only while that
    // machine has stores to answer through.
    if (props.inboxOpen && active?.session?.inbox)
        return (
            <AppShell
                sidebarCollapsible
                windowControls={desktop}
                windowFullScreen={windowState.fullScreen}
                sidebar={sidebar}
            >
                {desktop ? <WindowDragRegion /> : null}
                <RigInboxSurface
                    onOpenSession={(rigId, groupId, chatId) =>
                        props.onChatSelect(rigId, groupId, chatId)
                    }
                    projects={active.projects}
                    rigId={active.id}
                    snapshot={inbox}
                    store={active.session.inbox}
                />
            </AppShell>
        );

    // Usage belongs to the addressed machine, so it is shown only while that
    // machine has readings to give.
    if (props.usageOpen && active?.session?.providerUsage)
        return (
            <AppShell
                sidebarCollapsible
                windowControls={desktop}
                windowFullScreen={windowState.fullScreen}
                sidebar={sidebar}
            >
                {desktop ? <WindowDragRegion /> : null}
                <RigProviderUsageSurface
                    clock={active.session.clock}
                    {...(usage.error ? { error: usage.error } : {})}
                    loading={usage.loading}
                    providers={usage.providers}
                />
            </AppShell>
        );

    if (active?.session)
        return (
            <RigWorkspaceSurface
                appearance={props.appearance}
                browserContent={props.browserContent}
                chatId={props.chatId}
                clock={active.session.clock}
                connection={active.session.connection}
                groupId={props.groupId}
                key={active.id}
                onChatSelect={(groupId, chatId, replace) =>
                    props.onChatSelect(active.id, groupId, chatId, replace)
                }
                platform={props.platform}
                sidebar={sidebar}
                windowState={props.windowState}
                workspace={active.session.workspace}
            />
        );
    // The addressed machine has no live stores yet — it is still connecting, the
    // reader disconnected it, or it could not be reached. The sidebar stays, so
    // the other machines' work is one click away; connecting this one is a
    // settings act, which is where the control points.
    return (
        <AppShell
            sidebarCollapsible
            windowControls={desktop}
            windowFullScreen={windowState.fullScreen}
            sidebar={sidebar}
        >
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
                          (active.connected
                              ? `Connecting to ${active.label}…`
                              : `${active.label} is disconnected.`))
                        : "Connect a machine to start working."
                }
                icon={active?.status === "error" ? "shield" : "link"}
                size="panel"
                title={active ? active.label : "No machine"}
            />
        </AppShell>
    );
}

/**
 * This machine's notes inside the window's shell. It subscribes to the notes
 * session alone — never to a Rig — because a note is a file in the reader's home
 * directory and outlives every daemon connection in this window. Creating a note
 * addresses it as soon as it exists, so writing starts in the editor rather than
 * in the list.
 */
function RigNotesSurface(props: {
    noteId?: string;
    notes: NotesSessionStore;
    onOpen(noteId?: string): void;
    theme: "dark" | "light";
}) {
    const session = useSyncExternalStore(props.notes.subscribe, props.notes.get, props.notes.get);
    return (
        <NotesPage
            note={session.note}
            notes={session.notes}
            onCreate={() => {
                void props.notes
                    .noteCreate()
                    .then((note: NoteSummary) => props.onOpen(note.id))
                    .catch(() => undefined);
            }}
            onDelete={(note) => {
                // The deleted note may be the addressed one, so the URL stops
                // naming it: only this surface addresses, never the store.
                if (note.id === props.noteId) props.onOpen(undefined);
                void props.notes.noteRemove(note.id).catch(() => undefined);
            }}
            onOpen={(id) => props.onOpen(id)}
            selectedId={session.noteId}
            theme={props.theme}
        />
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
    snapshot: RigInboxSnapshot;
    store: RigInboxStore;
}) {
    const locate = (item: RigInboxItem) => {
        const project = props.projects.find((candidate) => candidate.id === item.projectId);
        if (!project) return undefined;
        const worktree = item.worktreeId
            ? project.worktrees.find((candidate) => candidate.id === item.worktreeId)
            : undefined;
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
            onAnswer={(itemId, answers) => props.store.itemAnswer(itemId, answers)}
            onOpenSession={(item) => {
                // A question is answered here, but its argument lives in the
                // conversation that raised it; the worktree is the group when
                // the asking session is filed under one.
                props.onOpenSession(props.rigId, item.worktreeId ?? item.projectId, item.sessionId);
            }}
            pending={props.snapshot.pending}
            submissions={props.snapshot.submissions}
        />
    );
}

/**
 * When a usage reading was taken, as an absolute local time. A reading is only
 * as good as its age — a plan can be spent in the minutes since — so the card
 * says when it was taken rather than implying it is live.
 */
function usageReadingTime(capturedAt: number): string {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(capturedAt));
}

function RigProviderUsageSurface(props: {
    clock: RigClockStore;
    error?: UserError;
    loading: boolean;
    providers: readonly RigProviderUsageEntry[];
}) {
    const currentTime = useSyncExternalStore(
        props.clock.subscribe,
        props.clock.get,
        props.clock.get,
    );
    return (
        <RigProviderUsagePage
            currentTime={currentTime}
            {...(props.error ? { error: props.error } : {})}
            loading={props.loading}
            providers={props.providers}
            readingTime={usageReadingTime}
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
    /** Daemon connection/health surface, used only to gate the workspace. */
    connection: RigConnectionStore;
    /** Joined conversation-list + active-conversation product store. */
    workspace: RigWorkspaceStore;
    /** Ticking clock feeding relative timestamps in the conversation list. */
    clock: RigClockStore;
    appearance: AppearanceStore;
    platform?: "desktop" | "web";
    windowState?: RigWindowStore;
    browserContent?: BrowserContentRenderer;
    /** The window's sidebar, composed once for every Rig by `AppRigView`. */
    sidebar: ReactNode;
    groupId?: string;
    chatId?: string;
    onChatSelect(groupId: string | undefined, chatId?: string, replace?: boolean): void;
}

/**
 * One Rig's workspace. It subscribes once each to that Rig's connection,
 * workspace, panel, clock, and appearance stores (no local React state) and
 * composes the shared `happy2-ui` components: the same `ConversationView` the
 * cloud stack uses for the selected conversation, with the local-only
 * affordances (the model and effort pickers beneath the composer, the settings
 * dialog holding the view toggles and access pickers, and the usage and activity
 * panels) passed into that surface's slots.
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
    const status = useSyncExternalStore(
        props.connection.subscribe,
        props.connection.get,
        props.connection.get,
    );
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
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const now = useSyncExternalStore(props.clock.subscribe, props.clock.get, props.clock.get);
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );

    const ready = status.connection === "connected" && status.daemon === "ready";
    if (!ready) {
        return (
            <RigConnectionStatus
                attempt={status.attempt}
                connection={status.connection}
                daemon={status.daemon}
                message={status.message}
                onRetry={() => props.connection.retry()}
                version={status.version}
            />
        );
    }

    // Inside an open project the directory is already decided, so every "new
    // session" affordance here starts one in it rather than asking again.
    const groupConversationCreate = (group: OpenGroup) => {
        void props.workspace.conversationCreate(group.create).catch(() => undefined);
    };

    const projects = workspace.list.projects;
    const rows = projects.type === "ready" ? projects.value : [];
    const openGroup = openGroupFind(rows, props.groupId);
    const groupFileTabs = openGroup
        ? workspace.fileTabs.filter((tab) => tab.groupId === openGroup.id)
        : [];
    const activeFile = groupFileTabs.find((tab) => tab.id === workspace.activeFileTabId);
    // Workspace files belong to the project/worktree, not to the lifetime of a
    // chat. The desktop transport accepts the group id as the file-addressing
    // scope when there is no session to carry that scope.
    const fileSessionId = (props.chatId ?? openGroup?.id) as RigSessionId | undefined;
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
              ...(detachedConversation?.running ? { busy: true } : {}),
          }
        : undefined;
    // Sessions without a list position are delegated children. They remain
    // readable by id, but their runner owns their input and configuration.
    const conversationReadOnly = detachedConversationId !== undefined;
    const previewTool = previewToolFind(conversation, panel.previewEntryId);
    const desktop = props.platform === "desktop";

    // Expanded, the panel covers the workspace column — the tab strip, the
    // transcript, and with them the composer. The write end of the open session
    // comes along as a floating dock so reading a diff or watching a terminal at
    // full width never means losing the ability to answer.
    const panelComposer =
        panel.open && panel.maximized && conversation.type === "ready" ? (
            <RigPanelComposer
                conversation={conversation.value}
                onChatSelect={props.onChatSelect}
                projects={rows}
                readOnly={conversationReadOnly}
                workspace={props.workspace}
            />
        ) : undefined;
    // Exactly one composer may claim typing that nothing else wants, and it is
    // whichever one the reader can actually see: with the panel expanded over
    // the workspace column the dock is the write end of the session, and the
    // composer it covers must not answer the keyboard from underneath it.
    const composerClaimsTyping = panelComposer === undefined;

    return (
        <AppShell
            sidebarCollapsible
            windowControls={desktop}
            windowFullScreen={windowState.fullScreen}
            panelResizable
            // Widening the panel is one of its two chrome controls and lives in
            // its header beside the other, so the shell's floating tab on the
            // divider is deliberately not asked for here.
            panelMaximized={panel.maximized}
            panelFooter={panelComposer}
            panelFooterFloating
            panel={
                panel.open ? (
                    <RigPanelBody
                        canStartTerminal={props.chatId !== undefined}
                        browserContent={props.browserContent}
                        sessionId={props.chatId}
                        changes={openGroup?.changes ?? []}
                        expanded={workspace.fileTreeExpanded}
                        layout={workspace.fileLayout}
                        // A plain click still opens the file and makes it the
                        // only thing picked; the modifier clicks build a set to
                        // act on and deliberately open nothing, since picking
                        // eleven files should not open eleven tabs. Only the
                        // changed listing has anything to do with a set, so the
                        // whole checkout ignores the modifiers entirely rather
                        // than quietly collecting an invisible selection.
                        onFileSelect={(path, modifiers, orderedPaths) => {
                            const picking = workspace.fileScope === "changed";
                            if (picking && modifiers.extend) {
                                props.workspace.fileSelectionExtend(path, orderedPaths);
                                return;
                            }
                            if (picking && modifiers.toggle) {
                                props.workspace.fileSelectionToggle(path);
                                return;
                            }
                            if (picking) props.workspace.fileSelectionReplace(path);
                            if (openGroup && fileSessionId)
                                props.workspace.filePreview(
                                    fileSessionId,
                                    openGroup.id,
                                    path,
                                    fileTabKind(path, workspace.fileScope),
                                );
                        }}
                        onRevert={() => props.workspace.fileRevertPromptOpen()}
                        onFileOpen={(path) => {
                            if (openGroup && fileSessionId)
                                props.workspace.fileOpen(
                                    fileSessionId,
                                    openGroup.id,
                                    path,
                                    fileTabKind(path, workspace.fileScope),
                                );
                        }}
                        onLayoutChange={(layout) => props.workspace.fileLayoutUpdate(layout)}
                        onPanelClose={() => props.workspace.panel.panelToggle()}
                        onScopeChange={(scope) => {
                            if (openGroup) props.workspace.fileScopeUpdate(openGroup.id, scope);
                        }}
                        onToggle={(path) => props.workspace.fileTreeToggle(path)}
                        panel={panel}
                        previewTool={previewTool}
                        scope={workspace.fileScope}
                        selection={workspace.fileSelection}
                        selectedPath={activeFile?.path}
                        store={props.workspace.panel}
                        workspaceFiles={workspace.workspaceFiles}
                        workspaceFilesLoading={workspace.workspaceFilesLoading}
                    />
                ) : undefined
            }
            sidebar={props.sidebar}
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
                        actions={
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
                                            ...(target.iconUrl ? { iconUrl: target.iconUrl } : {}),
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
                                    {...(openInRecent
                                        ? {
                                              onPrimary: () =>
                                                  void props.workspace.openIn(
                                                      openGroup.id,
                                                      openInRecent.id,
                                                  ),
                                              primaryLabel: `Open in ${openInRecent.label}`,
                                          }
                                        : {})}
                                    onSelect={(id: string) => {
                                        if (id === "copy-path") {
                                            void navigator.clipboard?.writeText(
                                                openGroup.create.cwd,
                                            );
                                            return;
                                        }
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
                                        size="small"
                                        variant="ghost"
                                    />
                                ) : null}
                            </>
                        }
                        icon={openGroup.home ? "home" : "inbox"}
                        title={openGroup.name}
                    />
                    {/* Cmd+T opens a tab, and here a tab is a session in the
                        project that is already open. */}
                    <NewSessionShortcut onCreate={() => groupConversationCreate(openGroup)} />
                    {openGroup.conversations.length === 0 && workspace.groupComposer ? (
                        // A group with nothing in it gets no tab strip — an empty
                        // strip is a control that does nothing but take a row —
                        // and a live composer rather than a button: the first
                        // message is what starts the conversation, so opening a
                        // project or worktree to type into never leaves an empty
                        // session behind.
                        <ConversationView
                            agentAuthor={rigAgentAuthor}
                            composer={workspace.groupComposer}
                            composerFocusOnType={composerClaimsTyping}
                            composerPlaceholder="Message Happy…"
                            entries={NO_ENTRIES}
                            // The first message is what creates the session, so
                            // its model, effort, and access mode have to be
                            // choosable before it is sent rather than corrected
                            // afterwards. These are the same pickers an open
                            // conversation carries, over the draft instead of a
                            // live session.
                            composerControls={
                                workspace.groupSessionDraft ? (
                                    <ComposerModelControl
                                        {...rigComposerModelControlProps(
                                            workspace.groupSessionDraft.menus,
                                            {
                                                onEffortChange: (effort?: RigThinkingLevel) =>
                                                    props.workspace.sessionEffortUpdate(effort),
                                                onModelChange: (selection: RigModelSelection) =>
                                                    props.workspace.sessionModelUpdate(selection),
                                            },
                                        )}
                                    />
                                ) : undefined
                            }
                            composerFooterControl={
                                workspace.groupSessionDraft ? (
                                    <RigSessionControls
                                        fields={["permission", "tier"]}
                                        menuPlacement="above"
                                        variant="ghost"
                                        menus={workspace.groupSessionDraft.menus}
                                        onEffortChange={(effort?: RigThinkingLevel) =>
                                            props.workspace.sessionEffortUpdate(effort)
                                        }
                                        onModelChange={(selection: RigModelSelection) =>
                                            props.workspace.sessionModelUpdate(selection)
                                        }
                                        onPermissionModeChange={(mode: RigPermissionMode) =>
                                            props.workspace.sessionPermissionModeUpdate(mode)
                                        }
                                        onServiceTierChange={(tier?: RigServiceTier) =>
                                            props.workspace.sessionServiceTierUpdate(tier)
                                        }
                                    />
                                ) : undefined
                            }
                            onComposerAttachmentRemove={(attachmentId) =>
                                props.workspace.composerAttachmentRemove(attachmentId)
                            }
                            onComposerAttachmentsSelect={(files) =>
                                props.workspace.composerAttachmentsAdd(files)
                            }
                            onComposerFocusChange={(focused) =>
                                props.workspace.composerFocusUpdate(focused)
                            }
                            onComposerSend={() => props.workspace.composerTextSubmit()}
                            onComposerValueChange={(value) =>
                                props.workspace.composerTextUpdate(value)
                            }
                        />
                    ) : null}
                    {openGroup.conversations.length > 0 ||
                    groupFileTabs.length > 0 ||
                    detachedConversationTab ? (
                        <TabbedPane
                            actions={
                                <Button
                                    aria-label="Create a session in this project"
                                    icon="plus"
                                    iconOnly
                                    // A tab is a session, so adding one creates
                                    // it directly in the addressed project or
                                    // worktree instead of opening the task form.
                                    onClick={() => groupConversationCreate(openGroup)}
                                    size="small"
                                    variant="ghost"
                                />
                            }
                            activeId={activeFile?.id ?? props.chatId ?? ""}
                            closeLabel="Close tab"
                            onClose={(tabId) => {
                                if (groupFileTabs.some((tab) => tab.id === tabId)) {
                                    props.workspace.fileClose(tabId);
                                    return;
                                }
                                if (tabId === detachedConversationId) {
                                    props.onChatSelect(
                                        openGroup.conversations.length > 0
                                            ? openGroup.id
                                            : undefined,
                                        openGroup.conversations[0]?.id,
                                        true,
                                    );
                                    return;
                                }
                                // Closing the addressed session addresses what is left
                                // first, so the surface never sits on a session that has
                                // just left the list. The address it replaces is gone,
                                // so it does not belong in history either.
                                if (tabId === props.chatId) {
                                    const rest = openGroup.conversations.filter(
                                        (summary) => summary.id !== tabId,
                                    );
                                    props.onChatSelect(
                                        rest.length > 0 ? openGroup.id : undefined,
                                        rest[0]?.id,
                                        true,
                                    );
                                }
                                void props.workspace
                                    .conversationArchive(tabId as RigSessionId)
                                    .catch(() => undefined);
                            }}
                            onDoubleClick={(tabId) => {
                                const file = groupFileTabs.find((tab) => tab.id === tabId);
                                if (file)
                                    props.workspace.fileOpen(
                                        file.sessionId,
                                        file.groupId,
                                        file.path,
                                        file.kind,
                                    );
                            }}
                            {...(groupFileTabs.length === 0 && !detachedConversationTab
                                ? {
                                      onReorder: (chatIds: readonly string[]) => {
                                          const move = sidebarReorderMove(
                                              openGroup.conversations.map((summary) => summary.id),
                                              chatIds,
                                          );
                                          if (!move) return;
                                          void props.workspace
                                              .conversationReorder(
                                                  move.id as RigSessionId,
                                                  move.afterId as RigSessionId | null,
                                              )
                                              .catch(() => undefined);
                                      },
                                  }
                                : {})}
                            onSelect={(tabId) => {
                                if (groupFileTabs.some((tab) => tab.id === tabId)) {
                                    props.workspace.fileSelect(tabId);
                                    return;
                                }
                                props.workspace.fileSelect(undefined);
                                props.onChatSelect(openGroup.id, tabId);
                            }}
                            tabs={[
                                ...sessionTabs(openGroup),
                                ...(detachedConversationTab ? [detachedConversationTab] : []),
                                ...groupFileTabs.map(fileTabItem),
                            ]}
                        >
                            {activeFile ? (
                                <RigFileBody
                                    appearance={appearance.appearance}
                                    file={activeFile}
                                    mode={workspace.fileViewMode}
                                    workspace={props.workspace}
                                />
                            ) : (
                                <RigConversationBody
                                    conversation={conversation}
                                    focusOnType={composerClaimsTyping}
                                    groupId={openGroup.id}
                                    now={now}
                                    onCreate={() => groupConversationCreate(openGroup)}
                                    onChatSelect={props.onChatSelect}
                                    readOnly={conversationReadOnly}
                                    workspace={props.workspace}
                                />
                            )}
                        </TabbedPane>
                    ) : null}
                </>
            ) : (
                <>
                    {/* With no project open there is no tab strip, so this side of
                        the window would have no lane to drag it by. */}
                    {desktop ? <WindowDragRegion /> : null}
                    {/* No project is open, so there is nowhere for a session to be
                        started: the only move from here is picking a project, and
                        offering a button that cannot answer that would misdirect. */}
                    <EmptyState
                        description="Pick one in the sidebar to see its sessions."
                        icon="files"
                        size="panel"
                        title="No project open"
                    />
                </>
            )}
            {workspace.create ? (
                <RigCreateDialog create={workspace.create} workspace={props.workspace} />
            ) : null}
            {/* Renaming is a workspace-level act — the row being renamed may not
                be the project that is open — so its dialog hangs off the shell
                rather than off any one surface inside it. */}
            {workspace.rename ? (
                <ModalOverlay onDismiss={() => props.workspace.renameCancel()}>
                    <Modal
                        footer={
                            <>
                                <Button
                                    onClick={() => props.workspace.renameCancel()}
                                    variant="ghost"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    disabled={workspace.rename.submitting}
                                    onClick={() => {
                                        void props.workspace.renameSubmit().catch(() => undefined);
                                    }}
                                    variant="primary"
                                >
                                    Rename
                                </Button>
                            </>
                        }
                        onClose={() => props.workspace.renameCancel()}
                        size="small"
                        title={`Rename ${workspace.rename.currentName}`}
                    >
                        <TextField
                            disabled={workspace.rename.submitting}
                            fullWidth
                            label="Name"
                            onSubmit={() => {
                                void props.workspace.renameSubmit().catch(() => undefined);
                            }}
                            onValueChange={(value) => props.workspace.renameDraftUpdate(value)}
                            value={workspace.rename.draft}
                        />
                    </Modal>
                </ModalOverlay>
            ) : null}
            {/* Reverting is the one act in the file panel that destroys work
                nothing else can give back, so what is about to happen is said
                in full — how many files, and that HEAD is where they land —
                before it happens. */}
            {workspace.fileRevert && openGroup ? (
                <ModalOverlay onDismiss={() => props.workspace.fileRevertPromptClose()}>
                    <Modal
                        footer={
                            <>
                                <Button
                                    disabled={workspace.fileRevert.submitting}
                                    onClick={() => props.workspace.fileRevertPromptClose()}
                                    variant="ghost"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    disabled={workspace.fileRevert.submitting}
                                    onClick={() => {
                                        void props.workspace
                                            .fileRevertConfirm(openGroup.id)
                                            .catch(() => undefined);
                                    }}
                                    variant="danger"
                                >
                                    Revert
                                </Button>
                            </>
                        }
                        icon="trash"
                        onClose={() => props.workspace.fileRevertPromptClose()}
                        size="small"
                        title={
                            workspace.fileRevert.paths.length === 1
                                ? "Revert 1 file"
                                : `Revert ${String(workspace.fileRevert.paths.length)} files`
                        }
                    >
                        <div className="happy2-rig-revert">
                            <p className="happy2-rig-revert__text">
                                Their changes are discarded and each file returns to what HEAD
                                holds. This cannot be undone.
                            </p>
                            <ul className="happy2-rig-revert__paths">
                                {workspace.fileRevert.paths.map((path) => (
                                    <li className="happy2-rig-revert__path" key={path}>
                                        {path}
                                    </li>
                                ))}
                            </ul>
                            {workspace.fileRevert.error ? (
                                <p className="happy2-rig-revert__error" role="alert">
                                    {workspace.fileRevert.error}
                                </p>
                            ) : null}
                        </div>
                    </Modal>
                </ModalOverlay>
            ) : null}
        </AppShell>
    );
}

function RigFileBody(props: {
    appearance: "dark" | "light";
    file: RigFileTabSnapshot;
    mode: RigFileViewMode;
    workspace: RigWorkspaceStore;
}) {
    const { file, workspace } = props;
    if (file.kind === "media")
        return (
            <RigFilePreview
                document={file.document}
                key={file.id}
                loading={file.loading}
                onRetry={() => workspace.fileRetry(file.id)}
                path={file.path}
            />
        );
    if (
        file.kind === "file" &&
        file.document.type === "ready" &&
        "content" in file.document.value
    ) {
        const content = file.document.value.content;
        const dirty = file.draft !== undefined && file.draft !== content;
        return (
            <FileEditor
                dirty={dirty}
                onRevert={() => workspace.fileDraftRevert(file.id)}
                onSave={() => {
                    void workspace.fileDraftSave(file.id).catch(() => undefined);
                }}
                onValueChange={(value) => workspace.fileDraftUpdate(file.id, value)}
                path={file.path}
                readOnly={file.saving}
                saving={file.saving}
                status={file.saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
                value={file.draft ?? content}
            />
        );
    }
    if (
        file.kind === "diff" &&
        file.document.type === "ready" &&
        "oldContent" in file.document.value
    )
        return (
            <ChangedFileDiff
                appearance={props.appearance}
                key={file.id}
                loading={file.loading}
                mode={props.mode}
                // An untouched tab shows what was read; once edited it shows
                // what was typed, which is the only copy of it there is.
                newContent={file.draft ?? file.document.value.newContent}
                oldContent={file.document.value.oldContent}
                oldPath={file.document.value.oldPath}
                dirty={file.draft !== undefined && file.draft !== file.document.value.newContent}
                onContentChange={(content) => workspace.fileDraftUpdate(file.id, content)}
                onModeChange={(mode) => workspace.fileViewModeUpdate(mode)}
                onSave={() => {
                    void workspace.fileDraftSave(file.id).catch(() => undefined);
                }}
                path={file.path}
                saving={file.saving}
            />
        );
    if (file.document.type === "error")
        return (
            <EmptyState
                action={{
                    label: "Retry",
                    icon: "arrow-right",
                    onClick: () => workspace.fileRetry(file.id),
                }}
                description={file.document.error.message}
                icon="doc"
                size="panel"
                title="File unavailable"
            />
        );
    return (
        <EmptyState
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
 * One workspace file shown rather than edited.
 *
 * The document says where the bytes are rather than carrying them, so the
 * picture element fetches its own source over an ordinary URL. Nothing here
 * holds a browser resource with a lifetime to revoke, and a video's seeks become
 * range requests against the proxy instead of a whole file already in the DOM.
 */
function RigFilePreview(props: {
    document: RigFileTabSnapshot["document"];
    loading: boolean;
    onRetry: () => void;
    path: string;
}) {
    const document = props.document;
    if (document.type === "error")
        return (
            <FilePreview
                content={{ type: "error", message: document.error.message }}
                path={props.path}
            />
        );
    if (document.type !== "ready" || props.loading)
        return <FilePreview content={{ type: "loading" }} path={props.path} />;
    const value = document.value;
    if (!("contentType" in value))
        return <FilePreview content={{ type: "unavailable" }} path={props.path} />;
    // A format with no viewer is stated as such rather than rendered as an
    // <img> that will only ever show a broken-image glyph.
    const kind = filePreviewKind(props.path);
    return (
        <FilePreview
            content={
                value.contentType === "application/octet-stream" || kind === "binary"
                    ? { type: "unavailable" }
                    : { type: "url", url: value.url }
            }
            path={props.path}
            size={fileSizeFormat(value.size)}
        />
    );
}

/** A byte count as a person reads it. */
function fileSizeFormat(size: number): string {
    if (size < 1024) return `${String(size)} B`;
    if (size < 1024 * 1024) return `${String(Math.round(size / 102.4) / 10)} KB`;
    return `${String(Math.round(size / (102.4 * 1024)) / 10)} MB`;
}

/** The open conversation's materialization states, inside the directory's tabs. */
function RigConversationBody(props: {
    conversation: RigWorkspaceSnapshot["conversation"];
    focusOnType: boolean;
    groupId: string;
    now: number;
    onCreate: () => void;
    onChatSelect: RigWorkspaceSurfaceProps["onChatSelect"];
    readOnly: boolean;
    workspace: RigWorkspaceStore;
}) {
    const conversation = props.conversation;
    if (conversation.type === "ready")
        return (
            <RigConversationSurface
                conversation={conversation.value}
                focusOnType={props.focusOnType}
                groupId={props.groupId}
                now={props.now}
                onChatSelect={props.onChatSelect}
                readOnly={props.readOnly}
                workspace={props.workspace}
            />
        );
    if (conversation.type === "loading")
        return (
            <EmptyState
                description="Loading the selected local session."
                icon="chat"
                size="panel"
                title="Loading session…"
            />
        );
    if (conversation.type === "error")
        return (
            <EmptyState
                action={{
                    label: "Retry",
                    icon: "arrow-right",
                    onClick: () => props.workspace.conversationRetry(),
                }}
                description={conversation.error.message}
                icon="shield"
                size="panel"
                title="Session unavailable"
            />
        );
    return (
        <EmptyState
            action={{ label: "New session", icon: "plus", onClick: props.onCreate }}
            description="Select a session tab or start a new one to begin."
            icon="chat"
            size="panel"
            title="No session selected"
        />
    );
}

/**
 * Projects one local conversation into `ConversationView`: the shared entries,
 * composer, and request prompts, plus the local-only header controls and panels
 * the shared surface hosts in its slots.
 */
function RigConversationSurface(props: {
    conversation: RigConversationSnapshot;
    focusOnType: boolean;
    groupId: string;
    now: number;
    onChatSelect: RigWorkspaceSurfaceProps["onChatSelect"];
    readOnly: boolean;
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
                action={{
                    label: "Retry",
                    icon: "arrow-right",
                    onClick: () => workspace.conversationRetry(),
                }}
                description={conversation.session.error.message}
                icon="shield"
                size="panel"
                title="Session unavailable"
            />
        );
    const swallow = (operation: Promise<unknown>) => void operation.catch(() => undefined);
    return (
        <ConversationView
            agentAuthor={rigAgentAuthor}
            composer={conversation.composer}
            composerDisabled={props.readOnly}
            composerFocusOnType={!props.readOnly && props.focusOnType}
            composerPlaceholder={props.readOnly ? "Subagent chats are read-only" : "Message Happy…"}
            conversationId={conversation.conversationId}
            entries={conversation.entries}
            loading={!conversation.ready}
            scrollPosition={conversation.scrollPosition}
            onScrollPositionChange={(position) => {
                if (position.scrollTop <= 64 && !conversation.transcriptComplete)
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
                                disabled: props.readOnly || conversation.modelLocked,
                                onEffortChange: (effort?: RigThinkingLevel) =>
                                    workspace.sessionEffortUpdate(effort),
                                onModelChange: (selection: RigModelSelection) =>
                                    workspace.sessionModelUpdate(selection),
                            })}
                        />
                    ) : null}
                </>
            }
            composerFooterControl={
                <ComposerFooterBar
                    leading={
                        <RigSessionControls
                            disabled={props.readOnly}
                            fields={["permission", "tier"]}
                            menuPlacement="above"
                            variant="ghost"
                            menus={conversation.menus}
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
                    /* How much of the window this session has spent, at the far
                       end of the same row as the access mode and the speed: the
                       reader is about to type one more message, and this is
                       where they find out whether it still fits and when to
                       compact. Absent until both a token count and a declared
                       window are known — a bar over a guessed denominator says
                       nothing. */
                    trailing={
                        conversation.contextGauge ? (
                            <ContextMeter
                                approximate={conversation.contextGauge.approximate}
                                totalTokens={conversation.contextGauge.totalTokens}
                                usedTokens={conversation.contextGauge.usedTokens}
                            />
                        ) : undefined
                    }
                />
            }
            onAbort={props.readOnly ? undefined : () => swallow(workspace.runAbort())}
            onCommandInvoke={(commandId) => workspace.composerCommandInvoke(commandId)}
            onComposerAttachmentRemove={(attachmentId) =>
                workspace.composerAttachmentRemove(attachmentId)
            }
            onComposerAttachmentsSelect={(files) => workspace.composerAttachmentsAdd(files)}
            onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
            onComposerSend={() => workspace.composerTextSubmit()}
            onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
            onImageOpen={(messageId, attachmentId) => workspace.imageOpen(messageId, attachmentId)}
            onToolSelect={(entryId, tool) => {
                const subagent = subagentForTool(tool, conversation.subagents);
                if (subagent) {
                    props.onChatSelect(props.groupId, subagent.id);
                    return;
                }
                workspace.panel.previewOpen(entryId);
            }}
            onRequestAnswer={(requestId, answers) =>
                swallow(workspace.answerInput({ requestId, answers }))
            }
            expandedTurnIds={conversation.expandedTurnIds}
            onTraceToggle={(turnId) => workspace.turnTraceToggle(turnId)}
            panel={
                conversation.usagePanelOpen ? (
                    <RigUsagePanel
                        error={conversation.usageError}
                        loading={conversation.usageLoading}
                        usage={conversation.usage}
                    />
                ) : conversation.activityPanelOpen ? (
                    <RigActivityPanel
                        backgroundProcesses={conversation.backgroundProcesses}
                        goal={conversation.goal}
                        now={props.now}
                        onBackgroundProcessStop={(processId) =>
                            swallow(workspace.backgroundProcessStop(processId))
                        }
                        subagents={conversation.subagents}
                        tasks={conversation.tasks}
                    />
                ) : undefined
            }
            overlay={
                conversation.openImage ? (
                    <ModalOverlay onDismiss={() => workspace.imageClose()}>
                        <Lightbox
                            alt={conversation.openImage.alt}
                            imageUrl={conversation.openImage.url}
                            onClose={() => workspace.imageClose()}
                        />
                    </ModalOverlay>
                ) : undefined
            }
            requestSubmissions={conversation.requestSubmissions}
            running={conversation.running}
            runningAgents={
                conversation.subagents.filter((subagent) => subagent.status === "running").length
            }
            backgroundTasks={conversation.backgroundProcesses.length}
            elapsedMs={rigTurnElapsedMs(conversation, props.now)}
            workingPhase={conversation.workingPhase}
            workingLabel={conversation.workingLabel}
            viewerId={rigOwnerAuthor.id}
        />
    );
}

/**
 * Separator between a group and the session inside it in a chat-menu option id.
 * Both halves are CUID2, so no identifier can contain it.
 */
const CHAT_TARGET_SEP = "|";

/** Every session in the workspace as one menu, grouped under the place it runs in. */
function chatTargetItems(projects: readonly RigProjectGroup[]): MenuItem[] {
    const items: MenuItem[] = [];
    const section = (label: string, groupId: string, conversations: ConversationSummary[]) => {
        if (conversations.length === 0) return;
        if (items.length > 0) items.push({ kind: "separator" });
        items.push({ kind: "label", label });
        for (const summary of conversations)
            items.push({
                id: `${groupId}${CHAT_TARGET_SEP}${summary.id}`,
                kind: "item",
                label: summary.title,
            });
    };
    for (const project of projects) {
        section(project.name, project.id, [...project.conversations]);
        for (const worktree of project.worktrees)
            section(`${project.name} · ${worktree.name}`, worktree.id, [...worktree.conversations]);
    }
    return items;
}

/** The open session's title, for the trigger that names where a message is going. */
function chatTargetLabel(
    projects: readonly RigProjectGroup[],
    conversationId: string,
): string | undefined {
    for (const project of projects) {
        for (const summary of project.conversations)
            if (summary.id === conversationId) return summary.title;
        for (const worktree of project.worktrees)
            for (const summary of worktree.conversations)
                if (summary.id === conversationId) return summary.title;
    }
    return undefined;
}

/**
 * The composer that floats over the expanded panel. It writes into the session
 * the window already has open — the same draft, the same store actions, so a
 * half-typed message survives expanding and collapsing the panel — and carries a
 * picker for sending into a different session instead, which addresses that
 * session exactly as choosing its tab would.
 */
function RigPanelComposer(props: {
    conversation: RigConversationSnapshot;
    onChatSelect: RigWorkspaceSurfaceProps["onChatSelect"];
    projects: readonly RigProjectGroup[];
    readOnly: boolean;
    workspace: RigWorkspaceStore;
}) {
    const { conversation, workspace } = props;
    const swallow = (operation: Promise<unknown>) => void operation.catch(() => undefined);
    return (
        <FloatingConversationDock>
            <ConversationDock
                composer={conversation.composer}
                disabled={props.readOnly}
                // This dock only exists while it covers the workspace column's
                // composer, so it is the surface the reader writes into.
                composerFocusOnType={!props.readOnly}
                composerPlaceholder={
                    props.readOnly ? "Subagent chats are read-only" : "Message Happy…"
                }
                composerControls={
                    conversation.menus ? (
                        <ComposerModelControl
                            {...rigComposerModelControlProps(conversation.menus, {
                                disabled: props.readOnly || conversation.modelLocked,
                                onEffortChange: (effort?: RigThinkingLevel) =>
                                    workspace.sessionEffortUpdate(effort),
                                onModelChange: (selection: RigModelSelection) =>
                                    workspace.sessionModelUpdate(selection),
                            })}
                        />
                    ) : undefined
                }
                composerFooterControl={
                    <ComposerFooterBar
                        leading={
                            <RigSessionControls
                                disabled={props.readOnly}
                                fields={["permission", "tier"]}
                                menuPlacement="above"
                                variant="ghost"
                                menus={conversation.menus}
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
                        trailing={
                            <>
                                {/* The same window the conversation surface
                                    reports: this dock writes into the same
                                    session, so it answers the same question
                                    about whether the next message fits. */}
                                {conversation.contextGauge ? (
                                    <ContextMeter
                                        approximate={conversation.contextGauge.approximate}
                                        totalTokens={conversation.contextGauge.totalTokens}
                                        usedTokens={conversation.contextGauge.usedTokens}
                                    />
                                ) : null}
                                <RigControlMenu
                                    items={chatTargetItems(props.projects)}
                                    label="Chat"
                                    menuAlign="end"
                                    menuPlacement="above"
                                    menuWidth={280}
                                    variant="ghost"
                                    onSelect={(id) => {
                                        const [groupId, chatId] = id.split(CHAT_TARGET_SEP);
                                        if (groupId && chatId) props.onChatSelect(groupId, chatId);
                                    }}
                                    value={
                                        chatTargetLabel(
                                            props.projects,
                                            conversation.conversationId,
                                        ) ?? "This session"
                                    }
                                />
                            </>
                        }
                    />
                }
                onAbort={props.readOnly ? undefined : () => swallow(workspace.runAbort())}
                onCommandInvoke={(commandId) => workspace.composerCommandInvoke(commandId)}
                onComposerAttachmentRemove={(attachmentId) =>
                    workspace.composerAttachmentRemove(attachmentId)
                }
                onComposerAttachmentsSelect={(files) => workspace.composerAttachmentsAdd(files)}
                onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
                onComposerSend={() => workspace.composerTextSubmit()}
                onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
                running={conversation.running}
            />
        </FloatingConversationDock>
    );
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
        if (entry.message.sender?.id !== rigOwnerAuthor.id) continue;
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
 * The create dialog: what to do, where to do it, and how the session that does
 * it is configured — all decided before anything is started, so a task never
 * has to be filed into a session that was configured wrong and corrected after.
 */
function RigCreateDialog(props: { create: RigCreateSnapshot; workspace: RigWorkspaceStore }) {
    const { create, workspace } = props;
    const submittable = create.text.trim().length > 0 && create.groupId !== undefined;
    return (
        <ModalOverlay onDismiss={() => workspace.createCancel()}>
            <Modal
                footer={
                    <>
                        {/* Filing several tasks at once should not mean
                            reopening this between each one. */}
                        <Checkbox
                            checked={create.keepOpen}
                            // The footer right-aligns its actions; this is a
                            // setting rather than an action, so it takes the
                            // free space and sits at the other end.
                            className="happy2-rig-create__keep-open"
                            label="Keep open for the next task"
                            onChange={(checked) => workspace.createKeepOpenUpdate(checked)}
                        />
                        <Button onClick={() => workspace.createCancel()} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={!submittable || create.submitting}
                            onClick={() => {
                                void workspace.createSubmit().catch(() => undefined);
                            }}
                            variant="primary"
                        >
                            Create
                        </Button>
                    </>
                }
                icon="spark"
                onClose={() => workspace.createCancel()}
                title="Create"
            >
                <div className="happy2-rig-create">
                    <TextField
                        disabled={create.submitting}
                        fullWidth
                        label="Task"
                        multiline
                        onValueChange={(value) => workspace.createTextUpdate(value)}
                        placeholder="What should the agent do?"
                        rows={4}
                        value={create.text}
                    />
                    <div className="happy2-rig-create__row">
                        <RigControlMenu
                            items={create.groups.map((group) => ({
                                id: group.id,
                                kind: "item" as const,
                                label: group.label,
                                // A worktree is named under the project it
                                // belongs to, so a bare name is never ambiguous.
                                ...(group.nested ? { icon: "branch" as const } : {}),
                            }))}
                            label="Project"
                            onSelect={(id: string) => workspace.createGroupUpdate(id as RigGroupId)}
                            value={
                                create.groups.find((group) => group.id === create.groupId)?.label ??
                                "Choose a project"
                            }
                        />
                        {create.draft ? (
                            <RigSessionControls
                                menus={create.draft.menus}
                                onEffortChange={(effort?: RigThinkingLevel) =>
                                    workspace.createEffortUpdate(effort)
                                }
                                onModelChange={(selection: RigModelSelection) =>
                                    workspace.createModelUpdate(selection)
                                }
                                onPermissionModeChange={(mode: RigPermissionMode) =>
                                    workspace.createPermissionModeUpdate(mode)
                                }
                                onServiceTierChange={(tier?: RigServiceTier) =>
                                    workspace.createServiceTierUpdate(tier)
                                }
                            />
                        ) : null}
                    </div>
                    {create.error ? (
                        <p className="happy2-rig-create__error" role="alert">
                            {create.error}
                        </p>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}

function RigPanelBody(props: {
    browserContent?: BrowserContentRenderer;
    canStartTerminal: boolean;
    changes: OpenGroup["changes"];
    expanded: ReadonlySet<string>;
    layout: RigFileLayout;
    onFileOpen: (path: string) => void;
    onFileSelect: (
        path: string,
        modifiers: FileTreeSelectModifiers,
        orderedPaths: readonly string[],
    ) => void;
    onRevert: () => void;
    onLayoutChange: (layout: RigFileLayout) => void;
    onPanelClose: () => void;
    onScopeChange: (scope: RigFileScope) => void;
    onToggle: (path: string) => void;
    panel: RigPanelSnapshot;
    previewTool?: ConversationToolCall;
    scope: RigFileScope;
    selection: ReadonlySet<string>;
    sessionId?: string;
    selectedPath?: string;
    store: RigPanelStore;
    workspaceFiles?: RigWorkspaceFiles;
    workspaceFilesLoading: boolean;
}) {
    const all = props.scope === "all";
    // Under "All files" the changed ones keep their status marks, so the work in
    // progress stays findable inside the whole tree rather than becoming
    // indistinguishable from everything around it.
    const changeEntry = (change: OpenGroup["changes"][number]): FileTreeBuildEntry => ({
        path: change.path,
        gitStatus: change.status,
        ...(change.addedLines === undefined ? {} : { addedLines: change.addedLines }),
        ...(change.deletedLines === undefined ? {} : { deletedLines: change.deletedLines }),
    });
    const changesByPath = new Map(props.changes.map((change) => [change.path, change]));
    const entries: FileTreeBuildEntry[] = all
        ? (props.workspaceFiles?.paths ?? []).map((path: string) => {
              const change = changesByPath.get(path);
              return change ? changeEntry(change) : { path };
          })
        : props.changes.map(changeEntry);
    const nodes: FileTreeNode[] =
        props.layout === "tree" ? fileTreeBuild(entries, props.expanded) : fileTreeFlatten(entries);
    const loading = all && props.workspaceFilesLoading;
    // The listing's own total, summed from the rows it is about to draw, so the
    // number over the list and the numbers in it can never disagree.
    const addedLines = props.changes.reduce((sum, change) => sum + (change.addedLines ?? 0), 0);
    const deletedLines = props.changes.reduce((sum, change) => sum + (change.deletedLines ?? 0), 0);
    const count = entries.length;
    const activeToolTab = props.panel.tabs.find((tab) => tab.id === props.panel.activeViewId);
    const tabs: TabItem[] = [
        { closable: false, icon: "files", id: "files", label: "Files" },
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
        ...panelTabs(props.panel),
    ];
    return (
        <>
            {/* Both of the panel's own chrome controls, together at its leading
                edge. Widening the panel used to be a tab pinned to the middle of
                the divider, which put a control the reader has to hunt for in
                the one place nothing else lives — and shifted the whole column's
                content aside to make room for it. */}
            <PanelHeader edgeControl>
                <Button
                    aria-label="Hide panel"
                    aria-pressed
                    icon="panel-collapse"
                    iconOnly
                    onClick={props.onPanelClose}
                    size="small"
                    variant="ghost"
                />
                <Button
                    aria-label={props.panel.maximized ? "Restore panel" : "Expand panel"}
                    aria-pressed={props.panel.maximized}
                    icon={props.panel.maximized ? "panel-restore" : "panel-maximize"}
                    iconOnly
                    onClick={() => props.store.panelMaximizeToggle()}
                    size="small"
                    variant="ghost"
                />
            </PanelHeader>
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
                            <Button
                                aria-label="New terminal"
                                icon="terminal"
                                iconOnly
                                onClick={() => props.store.terminalAdd()}
                                size="small"
                                variant="ghost"
                            />
                        </>
                    ) : undefined
                }
                activeId={props.panel.activeViewId}
                closeLabel="Close tab"
                onClose={(tabId) => {
                    if (tabId === "preview") props.store.previewClose();
                    else props.store.tabClose(tabId as RigPanelTabId);
                }}
                onSelect={(tabId) => {
                    if (tabId === "files") props.store.filesSelect();
                    else if (tabId === "preview" && props.panel.previewEntryId)
                        props.store.previewOpen(props.panel.previewEntryId);
                    else props.store.tabSelect(tabId as RigPanelTabId);
                }}
                tabs={tabs}
            >
                {props.panel.tabs
                    .filter((tab) => tab.kind === "browser")
                    .map((tab) => (
                        <BrowserPanel
                            active={props.panel.activeViewId === tab.id}
                            initialUrl={tab.url}
                            key={tab.id}
                            onLocationChange={(url) => props.store.browserUpdate(tab.id, { url })}
                            onTitleChange={(title) => props.store.browserUpdate(tab.id, { title })}
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
                        // A truncated listing says so rather than passing off
                        // part of a repository as the whole of it.
                        {...(all && props.workspaceFiles?.truncated
                            ? { note: "Showing the first 20,000 files." }
                            : {})}
                        onLayoutChange={(layout: RigFileLayout) => props.onLayoutChange(layout)}
                        onOpen={props.onFileOpen}
                        onScopeChange={(scope: RigFileScope) => props.onScopeChange(scope)}
                        onRevert={props.onRevert}
                        onSelect={(path: string, modifiers: FileTreeSelectModifiers) =>
                            props.onFileSelect(path, modifiers, fileTreeVisibleFiles(nodes))
                        }
                        onToggle={props.onToggle}
                        scope={props.scope}
                        selectedId={props.selectedPath}
                        // Picking files is what the changed listing is for: the
                        // whole checkout has nothing to revert to and no bulk
                        // act to offer, so it is left as the plain listing.
                        {...(all ? {} : { selectedIds: props.selection })}
                    />
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
                ) : activeToolTab?.kind === "terminal" ? (
                    <RigTerminalTab
                        key={activeToolTab.id}
                        store={props.store}
                        tabId={activeToolTab.id}
                    />
                ) : activeToolTab?.kind === "browser" ? null : (
                    <EmptyState
                        description="Select Files, a preview, or a live tool tab."
                        icon="files"
                        size="panel"
                        title="Nothing selected"
                    />
                )}
            </TabbedPane>
        </>
    );
}

/**
 * One terminal tab. It reads the terminal's own store, which is the only thing in
 * this surface that changes on every frame of output, and hands it to the shared
 * `TerminalPanel` with no height of its own so it fills the panel column. Closing
 * is the tab strip's, so no second close control appears in its header.
 */
function RigTerminalTab(props: { store: RigPanelStore; tabId: RigPanelTabId }) {
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
    return <RigTerminalScreen terminal={terminal} />;
}

/** The subscribed half of a terminal tab, split out so the store is non-optional. */
function RigTerminalScreen(props: { terminal: RigTerminalStore }) {
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
            status={snapshot.status}
        />
    );
}
