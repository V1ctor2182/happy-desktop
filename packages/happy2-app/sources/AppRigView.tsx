import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    RigClockStore,
    RigConnectionStore,
    RigConversationSnapshot,
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
    RigWorkspaceSnapshot,
    RigWorkspaceStore,
    RigWorktreeId,
} from "happy2-state";
import { rigOwnerAuthor } from "happy2-state";
import {
    AppShell,
    Banner,
    Button,
    ChannelHeader,
    ComposerModelControl,
    ConversationSettingsModal,
    ConversationView,
    EmptyState,
    RigActivityPanel,
    RigConnectionStatus,
    RigSessionControls,
    RigUsagePanel,
    PanelHeader,
    Sidebar,
    SidebarFooter,
    TabbedPane,
    TerminalPanel,
    WindowDragRegion,
    rigComposerModelControlProps,
    sidebarReorderMove,
    type SidebarItem,
    type TabItem,
} from "happy2-ui";

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
    readonly displayPath: string;
    /**
     * The catch-all project for sessions started outside any repository. It is
     * addressed as a place rather than as a path, so the surface names it by its
     * house glyph and never spells its `~` out.
     */
    readonly home: boolean;
    readonly conversations: RigProjectGroup["conversations"];
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
    return [
        {
            id: project.id,
            kind: "agent",
            label: project.name,
            initials: project.name.slice(0, 1).toUpperCase(),
            ...(project.kind === "home" ? { icon: "home" as const } : {}),
            ...(project.avatar ? { imageUrl: project.avatar.url } : {}),
            // Adding a worktree is what a project row offers, so the control
            // stays visible rather than waiting for a hover to reveal it.
            action: { icon: "plus" as const, label: `New workspace in ${project.name}` },
            // A row only carries a status while one of its sessions is live.
            ...(project.activity === "running" ? { status: "working" as const } : {}),
        },
        ...project.worktrees.map((worktree) => ({
            id: worktree.id,
            kind: "channel" as const,
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
        })),
    ];
}

/** One tab per tool open in the right panel, iconed by what it holds. */
function panelTabs(panel: RigPanelSnapshot): TabItem[] {
    return panel.tabs.map((tab) => ({
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

/** One tab per session in the open group, marked while the agent is working. */
function sessionTabs(group: OpenGroup): TabItem[] {
    return group.conversations.map((summary) => ({
        id: summary.id,
        label: summary.title,
        ...(summary.activity === "running" ? { icon: "dot" as const } : {}),
    }));
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
                displayPath: project.displayPath,
                home: project.kind === "home",
                conversations: project.conversations,
                create: { cwd: project.path },
            };
        for (const worktree of project.worktrees)
            if (worktree.id === groupId)
                return {
                    id: worktree.id,
                    name: worktree.name,
                    displayPath: worktree.displayPath,
                    home: false,
                    conversations: worktree.conversations,
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
 * a machine-owned workspace actually has: the appearance toggle and the
 * application menu, with no account identity, profile, or administration.
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
    const conversation = workspace.conversation;
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

    return (
        <AppShell
            sidebarCollapsible
            windowControls={desktop}
            panelResizable
            panel={
                panel.open ? (
                    <RigPanelBody panel={panel} store={props.workspace.panel} />
                ) : undefined
            }
            sidebar={
                <Sidebar
                    activeItemId={props.groupId ?? ""}
                    // The desktop window puts the traffic lights and the sidebar
                    // toggle in this heading, so the product mark stands down and
                    // the row becomes the window's drag lane.
                    brand={!desktop}
                    composeLabel="New session"
                    footer={
                        <SidebarFooter
                            appearance={appearance.appearance}
                            onAppearanceToggle={() => props.appearance.appearanceToggle()}
                            // Local app-level settings — the instance list and the
                            // rest of the shell's own commands — live in the native
                            // application menu, so that is what this opens.
                            onSettingsOpen={() => props.host.applicationMenuOpen()}
                        />
                    }
                    headerAccessory={listAccessory}
                    onCompose={conversationCreate}
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
                    onItemReorder={(_sectionId, ids, parentId) => {
                        // A drag inside a project rearranges its worktrees; a drag
                        // at the top level rearranges the projects themselves.
                        const parent = parentId
                            ? rows.find((project) => project.id === parentId)
                            : undefined;
                        const before = parent
                            ? parent.worktrees.map((worktree) => worktree.id)
                            : rows.map((project) => project.id);
                        const move = sidebarReorderMove(before, ids);
                        if (!move) return;
                        void (
                            parent
                                ? props.workspace.worktreeReorder(
                                      parent.id,
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
                                          actionLabel: "New session",
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
                        {...(openGroup.conversations.length > 0
                            ? {
                                  actions: (
                                      <Button
                                          aria-label={panel.open ? "Hide panel" : "Show panel"}
                                          aria-pressed={panel.open}
                                          icon={panel.open ? "panel-collapse" : "panel-expand"}
                                          iconOnly
                                          onClick={() => props.workspace.panel.panelToggle()}
                                          size="small"
                                          variant="ghost"
                                      />
                                  ),
                              }
                            : {})}
                        icon={openGroup.home ? "home" : "inbox"}
                        title={openGroup.name}
                        {...(openGroup.home ? {} : { topic: openGroup.displayPath })}
                    />
                    {openGroup.conversations.length === 0 ? (
                        // A project with nothing in it gets no tab strip: an empty
                        // strip is a control that does nothing but take a row, and
                        // the one action worth offering is already the button below.
                        <EmptyState
                            action={{
                                label: "New session",
                                icon: "plus",
                                onClick: () => groupConversationCreate(openGroup),
                            }}
                            description={
                                openGroup.home
                                    ? "Start a session to begin working in your home folder."
                                    : `Start a session to begin working in ${openGroup.displayPath}.`
                            }
                            icon={openGroup.home ? "home" : "chat"}
                            size="panel"
                            title={
                                openGroup.home
                                    ? "No sessions in your home folder yet"
                                    : `No sessions in ${openGroup.name} yet`
                            }
                        />
                    ) : (
                        <TabbedPane
                            actions={
                                <Button
                                    aria-label="New session in this project"
                                    icon="plus"
                                    iconOnly
                                    onClick={() => groupConversationCreate(openGroup)}
                                    size="small"
                                    variant="ghost"
                                />
                            }
                            activeId={props.chatId ?? ""}
                            closeLabel="Close session"
                            onClose={(chatId) => {
                                // Closing the addressed session addresses what is left
                                // first, so the surface never sits on a session that has
                                // just left the list. The address it replaces is gone,
                                // so it does not belong in history either.
                                if (chatId === props.chatId) {
                                    const rest = openGroup.conversations.filter(
                                        (summary) => summary.id !== chatId,
                                    );
                                    props.onChatSelect(
                                        rest.length > 0 ? openGroup.id : undefined,
                                        rest[0]?.id,
                                        true,
                                    );
                                }
                                void props.workspace
                                    .conversationArchive(chatId as RigSessionId)
                                    .catch(() => undefined);
                            }}
                            onReorder={(chatIds) => {
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
                            }}
                            onSelect={(chatId) => props.onChatSelect(openGroup.id, chatId)}
                            tabs={sessionTabs(openGroup)}
                        >
                            <RigConversationBody
                                conversation={conversation}
                                now={now}
                                onCreate={() => groupConversationCreate(openGroup)}
                                workspace={props.workspace}
                            />
                        </TabbedPane>
                    )}
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
        </AppShell>
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
            composer={conversation.composer}
            composerPlaceholder="Message Happy…"
            entries={conversation.entries}
            composerControls={
                <>
                    {conversation.menus ? (
                        <ComposerModelControl
                            {...rigComposerModelControlProps(conversation.menus, {
                                onEffortChange: (effort?: RigThinkingLevel) =>
                                    swallow(workspace.effortChange(effort)),
                                onModelChange: (selection: RigModelSelection) =>
                                    swallow(workspace.modelChange(selection)),
                            })}
                        />
                    ) : null}
                    <Button
                        aria-label="Session settings"
                        icon="settings"
                        iconOnly
                        onClick={() => workspace.settingsOpen()}
                        size="small"
                        variant="ghost"
                    />
                </>
            }
            onAbort={() => swallow(workspace.runAbort())}
            onCommandInvoke={(commandId) => workspace.composerCommandInvoke(commandId)}
            onComposerFocusChange={(focused) => workspace.composerFocusUpdate(focused)}
            onComposerSend={() => workspace.composerTextSubmit()}
            onComposerValueChange={(value) => workspace.composerTextUpdate(value)}
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
                conversation.settingsOpen ? (
                    <ConversationSettingsModal
                        activityOpen={conversation.activityPanelOpen}
                        controls={
                            conversation.menus ? (
                                <RigSessionControls
                                    fields={["permission", "tier"]}
                                    menus={conversation.menus}
                                    onEffortChange={(effort?: RigThinkingLevel) =>
                                        swallow(workspace.effortChange(effort))
                                    }
                                    onModelChange={(selection: RigModelSelection) =>
                                        swallow(workspace.modelChange(selection))
                                    }
                                    onPermissionModeChange={(mode: RigPermissionMode) =>
                                        swallow(workspace.permissionModeChange(mode))
                                    }
                                    onServiceTierChange={(tier?: RigServiceTier) =>
                                        swallow(workspace.serviceTierChange(tier))
                                    }
                                />
                            ) : undefined
                        }
                        onActivityOpenChange={() => workspace.activityPanelToggle()}
                        onClose={() => workspace.settingsClose()}
                        onShowReasoningChange={() => workspace.reasoningToggle()}
                        onUsageOpenChange={(value) =>
                            value ? workspace.usagePanelOpen() : workspace.usagePanelClose()
                        }
                        showReasoning={conversation.showReasoning}
                        usageOpen={conversation.usagePanelOpen}
                    />
                ) : undefined
            }
            queued={conversation.queuedMessages}
            requestSubmissions={conversation.requestSubmissions}
            running={conversation.running}
            viewerId={rigOwnerAuthor.id}
        />
    );
}

/**
 * The right panel's header band, tab strip, and the body of whichever tab is
 * selected. Only the strip re-renders from this component's subscription; a
 * terminal's own output lands in `RigTerminalTab`, which subscribes to that
 * terminal alone, so a busy shell never re-renders its neighbours or the tab bar
 * above it.
 *
 * The band is empty and still earns its place: it puts this column's tabs on the
 * same line as the session tabs beside them instead of a header's height higher,
 * and in the desktop window it gives that edge a lane to drag the window by.
 */
function RigPanelBody(props: { panel: RigPanelSnapshot; store: RigPanelStore }) {
    const { panel, store } = props;
    const activeId = panel.activeTabId;
    const active = panel.tabs.find((tab) => tab.id === activeId);
    return (
        <>
            <PanelHeader />
            <TabbedPane
                // Adding a tab is the only control this strip carries. Hiding the panel
                // belongs to the header's toggle alone: two controls for it put the same
                // glyph on screen twice, and the one that showed the panel is the one a
                // reader goes back to.
                actions={
                    <Button
                        aria-label="New terminal"
                        icon="plus"
                        iconOnly
                        onClick={() => store.terminalAdd()}
                        size="small"
                        variant="ghost"
                    />
                }
                activeId={activeId ?? ""}
                closeLabel="Close tab"
                onClose={(tabId) => store.tabClose(tabId as RigPanelTabId)}
                onSelect={(tabId) => store.tabSelect(tabId as RigPanelTabId)}
                tabs={panelTabs(panel)}
            >
                {/* The key is the tab's identity, so selecting another tab mounts its
                body rather than re-pointing this one at a different terminal — a
                terminal's scroll position, focus, and grid belong to it alone. */}
                {active?.kind === "terminal" ? (
                    <RigTerminalTab key={active.id} store={store} tabId={active.id} />
                ) : active?.kind === "browser" ? (
                    <EmptyState
                        description="A browser tab will render a page here."
                        icon="globe"
                        size="panel"
                        title="Not built yet"
                    />
                ) : (
                    <EmptyState
                        action={{
                            label: "New terminal",
                            icon: "plus",
                            onClick: () => store.terminalAdd(),
                        }}
                        description="Open a terminal to work beside the conversation."
                        icon="terminal"
                        size="panel"
                        title="Nothing open"
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
