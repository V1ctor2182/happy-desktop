import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    ConversationEntry,
    ConversationToolCall,
    RigClockStore,
    RigChangedFileTabSnapshot,
    RigConnectionStore,
    RigConversationSnapshot,
    RigCreateSnapshot,
    RigFileLayout,
    RigWorkspaceFiles,
    RigFileScope,
    RigFileViewMode,
    RigHost,
    RigGroupId,
    RigModelSelection,
    RigPanelSnapshot,
    RigPanelStore,
    RigPanelTabId,
    RigPermissionMode,
    RigProjectGroup,
    RigProjectId,
    RigServiceTier,
    RigSessionCreateInput,
    RigSessionId,
    RigTerminalStore,
    RigThinkingLevel,
    RigWindowStore,
    RigWorkspaceSnapshot,
    RigWorkspaceStore,
    RigWorktreeId,
} from "happy2-state";
import { rigAgentAuthor, rigOwnerAuthor, rigWindowStoreNoop } from "happy2-state";
import {
    AppShell,
    Banner,
    Button,
    ChannelHeader,
    ContextGauge,
    ChangedFileDiff,
    ComposerModelControl,
    ConversationView,
    EmptyState,
    FilePanel,
    Lightbox,
    Checkbox,
    Modal,
    ModalOverlay,
    RigActivityPanel,
    RigConnectionStatus,
    RigControlMenu,
    SegmentedControl,
    fileTreeBuild,
    fileTreeFlatten,
    type FileTreeBuildEntry,
    RigSessionControls,
    RigUsagePanel,
    PanelHeader,
    Sidebar,
    SidebarFooter,
    SidebarUpdateAction,
    TabbedPane,
    TextField,
    TerminalPanel,
    ToolCallPreview,
    WindowDragRegion,
    rigComposerModelControlProps,
    sidebarReorderMove,
    type MenuItem,
    type FileTreeNode,
    type SidebarItem,
    type TabItem,
} from "happy2-ui";

export interface AppRigUpdate {
    readonly detail?: string;
    readonly status: "available" | "downloading" | "downloaded";
    readonly version?: string;
}

export interface AppRigViewProps {
    /** Host/UI operations for the desktop shell (menus, directory picking). */
    host: RigHost;
    /** Daemon connection/health surface, used only to gate the workspace. */
    connection: RigConnectionStore;
    /** Joined conversation-list + active-conversation product store. */
    workspace: RigWorkspaceStore;
    /** Ticking clock feeding relative timestamps in the conversation list. */
    clock: RigClockStore;
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
    /** Restarts into the ready update. Absent in a plain browser surface. */
    onUpdateRestart?: () => void;
    /**
     * The addressed group — a project or one of its worktrees — and conversation,
     * read from the route by the caller. This surface never decides what is
     * shown; it renders the addressed group's sessions and asks for a different
     * address through `onChatSelect`, exactly as the cloud workspace does.
     */
    groupId?: string;
    chatId?: string;
    /** Addresses a group and optionally one of its sessions; no group means the list. */
    onChatSelect(groupId: string | undefined, chatId?: string, replace?: boolean): void;
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

/** One tab per session in the open group, marked while the agent is working. */
function sessionTabs(group: OpenGroup): TabItem[] {
    return group.conversations.map((summary) => ({
        id: summary.id,
        label: summary.title,
        ...(summary.activity === "running" ? { busy: true } : {}),
    }));
}

function fileTabItem(tab: RigChangedFileTabSnapshot): TabItem {
    return {
        id: tab.id,
        label: tab.path.split("/").at(-1) ?? tab.path,
        icon: "doc",
        preview: tab.preview,
    };
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

/**
 * The local workspace surface. It subscribes once each to the connection,
 * workspace, clock, and appearance stores (no local React state) and composes
 * the shared `happy2-ui` components: the same `Sidebar` the cloud stack uses for
 * its conversation list — including its shared brand heading, its collapsible
 * and resizable shell column, and its pinned footer, so the two modes are one
 * component rendered twice rather than a local-only variant — and the same
 * `ConversationView` for the selected conversation. The footer carries only what
 * a machine-owned workspace actually has: the appearance toggle, the application
 * menu, and a host-supplied update action when one is ready, with no account
 * identity, profile, or administration.
 * Local-only affordances (the model and effort pickers beneath the composer, the
 * settings dialog holding the view toggles and access pickers, and the usage and
 * activity panels) are passed into that surface's slots.
 *
 * The right panel is the workspace's tool column: terminals now, other kinds of
 * tab later. It is a second subscription rather than part of the workspace
 * snapshot because a live terminal repaints far faster than the conversation does
 * and must not drag this whole surface through a render to do it.
 *
 * Until the daemon connection is live it shows the connection status with a
 * retry. Which conversation is shown comes from the route through `chatId`, and
 * choosing another one is a navigation request; materialization and every draft
 * keystroke live in the workspace store outside React, so this component stays a
 * pure projection.
 */
export function AppRigView(props: AppRigViewProps) {
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

    // Starting a session with no project in hand has to ask which directory to
    // start it in; the daemon files the answer under a project by itself.
    const conversationCreate = () => {
        void props.host.directoryPick().then((cwd) => {
            if (cwd) void props.workspace.conversationCreate({ cwd }).catch(() => undefined);
        });
    };

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
    const conversation = workspace.conversation;
    const previewTool = previewToolFind(conversation, panel.previewEntryId);
    const listAccessory =
        projects.type === "loading" || projects.type === "unloaded" ? (
            <Banner tone="neutral">Loading sessions…</Banner>
        ) : projects.type === "error" ? (
            <Banner
                action={{ label: "Retry", onClick: () => props.workspace.conversationListRetry() }}
                tone="danger"
                title="Sessions unavailable"
            >
                {projects.error.message}
            </Banner>
        ) : workspace.list.mutationError ? (
            <Banner
                action={{ label: "Retry", onClick: conversationCreate }}
                tone="danger"
                title="Session not created"
            >
                {workspace.list.mutationError.message}
            </Banner>
        ) : undefined;

    const desktop = props.platform === "desktop";
    const sidebarUpdate = props.update ? (
        <SidebarUpdateAction
            detail={props.update.detail}
            onRestart={props.update.status === "downloaded" ? props.onUpdateRestart : undefined}
            status={props.update.status}
            version={props.update.version}
        />
    ) : undefined;

    return (
        <AppShell
            sidebarCollapsible
            windowControls={desktop}
            windowFullScreen={windowState.fullScreen}
            panelResizable
            panel={
                panel.open ? (
                    <RigPanelBody
                        canStartTerminal={props.chatId !== undefined}
                        changes={openGroup?.changes ?? []}
                        expanded={workspace.fileTreeExpanded}
                        layout={workspace.fileLayout}
                        onFileSelect={(path) => {
                            if (openGroup) props.workspace.filePreview(openGroup.id, path);
                        }}
                        onFileOpen={(path) => {
                            if (openGroup) props.workspace.fileOpen(openGroup.id, path);
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
                        selectedPath={activeFile?.path}
                        store={props.workspace.panel}
                        workspaceFiles={workspace.workspaceFiles}
                        workspaceFilesLoading={workspace.workspaceFilesLoading}
                    />
                ) : undefined
            }
            sidebar={
                <Sidebar
                    activeItemId={props.groupId ?? ""}
                    // The desktop window puts the traffic lights and the sidebar
                    // toggle in this heading, so the product mark stands down and
                    // the row becomes the window's drag lane.
                    brand={!desktop}
                    composeLabel="Create"
                    footer={
                        <SidebarFooter
                            actions={sidebarUpdate}
                            appearance={appearance.appearance}
                            onAppearanceToggle={() => props.appearance.appearanceToggle()}
                            // Local app-level settings — the instance list and the
                            // rest of the shell's own commands — live in the native
                            // application menu, so that is what this opens.
                            onSettingsOpen={() => props.host.applicationMenuOpen()}
                        />
                    }
                    headerAccessory={listAccessory}
                    itemMenuItems={(item) => rowMenuItems(rows, item)}
                    onCompose={() => props.workspace.createOpen()}
                    onSectionAction={() => props.workspace.createOpen()}
                    onItemMenuSelect={(item, actionId) => {
                        const owner = rowOwnerFind(rows, item.id);
                        if (!owner) return;
                        if (actionId === ROW_MENU_RENAME) {
                            props.workspace.renameOpen(owner.project.id, owner.worktreeId);
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
                                  ...owner.project.worktrees.map(
                                      (worktree) => worktree.id as string,
                                  ),
                              ];
                        if (props.groupId !== undefined && closing.includes(props.groupId))
                            props.onChatSelect(undefined);
                        void (
                            owner.worktreeId
                                ? props.workspace.worktreeArchive(
                                      owner.project.id,
                                      owner.worktreeId,
                                  )
                                : props.workspace.projectArchive(owner.project.id)
                        ).catch(() => undefined);
                    }}
                    // Addressing a group opens its most recent session, so a list
                    // row lands on work rather than on an empty screen.
                    onItemSelect={(id) =>
                        props.onChatSelect(id, openGroupFind(rows, id)?.conversations[0]?.id)
                    }
                    onItemAction={(id) => {
                        const owner = rowOwnerFind(rows, id);
                        if (!owner) return;
                        // The plus on a project adds a worktree; the control on a
                        // worktree archives it.
                        void (
                            owner.worktreeId
                                ? props.workspace.worktreeArchive(
                                      owner.project.id,
                                      owner.worktreeId,
                                  )
                                : props.workspace.worktreeCreate(owner.project.id)
                        ).catch(() => undefined);
                    }}
                    onItemReorder={(_sectionId, move) => {
                        // A drag inside a project rearranges its worktrees; a drag
                        // at the top level rearranges the projects themselves.
                        void (
                            move.parentId
                                ? props.workspace.worktreeReorder(
                                      move.parentId as RigProjectId,
                                      move.id as RigWorktreeId,
                                      move.afterId as RigWorktreeId | null,
                                  )
                                : props.workspace.projectReorder(
                                      move.id as RigProjectId,
                                      move.afterId as RigProjectId | null,
                                  )
                        ).catch(() => undefined);
                    }}
                    sections={[
                        {
                            id: "projects",
                            label: "Projects",
                            items: rows.flatMap(sidebarItems),
                            ...(projects.type === "ready"
                                ? {
                                      empty: {
                                          actionLabel: "Create",
                                          description: "Start a session to begin working locally.",
                                          icon: "chat" as const,
                                          title: "No projects yet",
                                      },
                                  }
                                : {}),
                        },
                    ]}
                />
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
                        actions={
                            <>
                                {/* How much room the open session has left.
                                    It belongs on screen rather than inside the
                                    usage panel: it is the thing that decides
                                    whether the next message still fits. */}
                                {workspace.conversation.type === "ready" &&
                                workspace.conversation.value.contextGauge ? (
                                    <ContextGauge
                                        approximate={
                                            workspace.conversation.value.contextGauge.approximate
                                        }
                                        remainingFraction={
                                            workspace.conversation.value.contextGauge
                                                .remainingFraction
                                        }
                                        remainingTokens={
                                            workspace.conversation.value.contextGauge
                                                .remainingTokens
                                        }
                                        totalTokens={
                                            workspace.conversation.value.contextGauge.totalTokens
                                        }
                                    />
                                ) : null}
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
                                    menuAlign="end"
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
                    {openGroup.conversations.length > 0 || groupFileTabs.length > 0 ? (
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
                                if (file) props.workspace.fileOpen(file.groupId, file.path);
                            }}
                            {...(groupFileTabs.length === 0
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
                            tabs={[...sessionTabs(openGroup), ...groupFileTabs.map(fileTabItem)]}
                        >
                            {activeFile ? (
                                <RigChangedFileBody
                                    appearance={appearance.appearance}
                                    file={activeFile}
                                    mode={workspace.fileViewMode}
                                    workspace={props.workspace}
                                />
                            ) : (
                                <RigConversationBody
                                    conversation={conversation}
                                    now={now}
                                    onCreate={() => groupConversationCreate(openGroup)}
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
        </AppShell>
    );
}

function RigChangedFileBody(props: {
    appearance: "dark" | "light";
    file: RigChangedFileTabSnapshot;
    mode: RigFileViewMode;
    workspace: RigWorkspaceStore;
}) {
    const { file, workspace } = props;
    if (file.document.type === "ready")
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
            description="Reading the changed file from its workspace."
            icon="doc"
            size="panel"
            title="Loading file…"
        />
    );
}

/** The open conversation's materialization states, inside the directory's tabs. */
function RigConversationBody(props: {
    conversation: RigWorkspaceSnapshot["conversation"];
    now: number;
    onCreate: () => void;
    workspace: RigWorkspaceStore;
}) {
    const conversation = props.conversation;
    if (conversation.type === "ready")
        return (
            <RigConversationSurface
                conversation={conversation.value}
                now={props.now}
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
    now: number;
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
            composerPlaceholder="Message Happy…"
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
                                disabled: conversation.modelLocked,
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
                <RigSessionControls
                    fields={["permission", "tier"]}
                    menuPlacement="above"
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
            onAbort={() => swallow(workspace.runAbort())}
            onCommandInvoke={(commandId) => workspace.composerCommandInvoke(commandId)}
            onComposerAttachmentRemove={(attachmentId) =>
                workspace.composerAttachmentRemove(attachmentId)
            }
            onComposerAttachmentsSelect={(files) => workspace.composerAttachmentsAdd(files)}
            onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
            onComposerSend={() => workspace.composerTextSubmit()}
            onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
            onImageOpen={(messageId, attachmentId) => workspace.imageOpen(messageId, attachmentId)}
            onToolSelect={(entryId) => workspace.panel.previewOpen(entryId)}
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
            viewerId={rigOwnerAuthor.id}
        />
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
    canStartTerminal: boolean;
    changes: OpenGroup["changes"];
    expanded: ReadonlySet<string>;
    layout: RigFileLayout;
    onFileOpen: (path: string) => void;
    onFileSelect: (path: string) => void;
    onLayoutChange: (layout: RigFileLayout) => void;
    onPanelClose: () => void;
    onScopeChange: (scope: RigFileScope) => void;
    onToggle: (path: string) => void;
    panel: RigPanelSnapshot;
    previewTool?: ConversationToolCall;
    scope: RigFileScope;
    selectedPath?: string;
    store: RigPanelStore;
    workspaceFiles?: RigWorkspaceFiles;
    workspaceFilesLoading: boolean;
}) {
    const all = props.scope === "all";
    // Under "All files" the changed ones keep their status marks, so the work in
    // progress stays findable inside the whole tree rather than becoming
    // indistinguishable from everything around it.
    const statuses = new Map(props.changes.map((change) => [change.path, change.status]));
    const entries: FileTreeBuildEntry[] = all
        ? (props.workspaceFiles?.paths ?? []).map((path: string) => {
              const status = statuses.get(path);
              return { path, ...(status ? { gitStatus: status } : {}) };
          })
        : props.changes.map((change) => ({ path: change.path, gitStatus: change.status }));
    const nodes: FileTreeNode[] =
        props.layout === "tree" ? fileTreeBuild(entries, props.expanded) : fileTreeFlatten(entries);
    const loading = all && props.workspaceFilesLoading;
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
            </PanelHeader>
            <TabbedPane
                actions={
                    props.canStartTerminal ? (
                        <Button
                            aria-label="New terminal"
                            icon="plus"
                            iconOnly
                            onClick={() => props.store.terminalAdd()}
                            size="small"
                            variant="ghost"
                        />
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
                {props.panel.activeViewId === "files" ? (
                    <div className="happy2-rig-panel-files">
                        <div className="happy2-rig-file-controls">
                            <SegmentedControl
                                onChange={(value: string) =>
                                    props.onScopeChange(value as RigFileScope)
                                }
                                segments={[
                                    { value: "changed", label: "Changed" },
                                    { value: "all", label: "All files" },
                                ]}
                                size="small"
                                value={props.scope}
                            />
                            <SegmentedControl
                                onChange={(value: string) =>
                                    props.onLayoutChange(value as RigFileLayout)
                                }
                                segments={[
                                    { value: "flat", label: "List", icon: "files" },
                                    { value: "tree", label: "Tree", icon: "branch" },
                                ]}
                                size="small"
                                value={props.layout}
                            />
                        </div>
                        <FilePanel
                            emptyLabel={all ? "No files." : "No changed files."}
                            loading={loading}
                            nodes={nodes}
                            // A truncated listing says so rather than passing off
                            // part of a repository as the whole of it.
                            {...(all && props.workspaceFiles?.truncated
                                ? { note: "Showing the first 20,000 files." }
                                : {})}
                            onSelect={props.onFileSelect}
                            onOpen={props.onFileOpen}
                            onToggle={props.onToggle}
                            selectedId={props.selectedPath}
                            subtitle={`${String(count)} ${count === 1 ? "file" : "files"}`}
                            title={all ? "Files" : "Changes"}
                        />
                    </div>
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
                ) : activeToolTab?.kind === "browser" ? (
                    <EmptyState
                        description="A browser tab will render a page here."
                        icon="globe"
                        size="panel"
                        title="Not built yet"
                    />
                ) : (
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
            onReconnect={() => terminal.terminalReconnect()}
            onResize={(cols, rows) => terminal.terminalResize(cols, rows)}
            status={snapshot.status}
        />
    );
}
