import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    RigClockStore,
    RigConnectionStore,
    RigConversationSnapshot,
    RigHost,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionFolder,
    RigSessionId,
    RigThinkingLevel,
    RigWorkspaceSnapshot,
    RigWorkspaceStore,
} from "happy2-state";
import { rigOwnerAuthor } from "happy2-state";
import {
    AppShell,
    Banner,
    Button,
    ChannelHeader,
    ComposerModelControl,
    ConversationSettingsModal,
    ConversationStatus,
    ConversationView,
    EmptyState,
    RigActivityPanel,
    RigConnectionStatus,
    RigSessionControls,
    RigUsagePanel,
    Sidebar,
    SidebarFooter,
    TabbedPane,
    WindowDragRegion,
    rigComposerModelControlProps,
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
     * The addressed working directory and conversation, read from the route by
     * the caller. This surface never decides what is shown; it renders the
     * addressed directory's sessions and asks for a different address through
     * `onChatSelect`, exactly as the cloud workspace does.
     */
    folderId?: string;
    chatId?: string;
    /** Addresses a directory and optionally one of its sessions; no directory means the list. */
    onChatSelect(folderId: string | undefined, chatId?: string, replace?: boolean): void;
}

/**
 * One list row per working directory. The directory's name is what a reader
 * recognizes and its path is what tells two similarly named checkouts apart. How
 * many sessions it holds is the tab strip's job, not the row's.
 */
function sidebarItem(folder: RigSessionFolder): SidebarItem {
    return {
        id: folder.id,
        kind: "agent",
        label: folder.name,
        initials: folder.name.slice(0, 1).toUpperCase(),
        meta: folder.displayPath,
        // A row only carries a status while one of its sessions is live.
        ...(folder.activity === "running" ? { status: "working" as const } : {}),
    };
}

/** One tab per session in the open directory, marked while the agent is working. */
function sessionTab(folder: RigSessionFolder): TabItem[] {
    return folder.conversations.map((summary) => ({
        id: summary.id,
        label: summary.title,
        ...(summary.activity === "running" ? { icon: "dot" as const } : {}),
    }));
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

    const conversationCreate = () => {
        void props.host.directoryPick().then((cwd) => {
            if (cwd) void props.workspace.conversationCreate({ cwd }).catch(() => undefined);
        });
    };

    const folders = workspace.list.folders;
    const rows = folders.type === "ready" ? folders.value : [];
    const openFolder = rows.find((folder) => folder.id === props.folderId);
    const conversation = workspace.conversation;
    const listAccessory =
        folders.type === "loading" || folders.type === "unloaded" ? (
            <Banner tone="neutral">Loading sessions…</Banner>
        ) : folders.type === "error" ? (
            <Banner
                action={{ label: "Retry", onClick: () => props.workspace.conversationListRetry() }}
                tone="danger"
                title="Sessions unavailable"
            >
                {folders.error.message}
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
            sidebar={
                <Sidebar
                    activeItemId={props.folderId ?? ""}
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
                    // Addressing a directory opens its most recent session, so a
                    // list row lands on work rather than on an empty screen.
                    onItemSelect={(id) =>
                        props.onChatSelect(
                            id,
                            rows.find((folder) => folder.id === id)?.conversations[0]?.id,
                        )
                    }
                    sections={[
                        {
                            id: "folders",
                            label: "Folders",
                            items: rows.map(sidebarItem),
                            ...(folders.type === "ready"
                                ? {
                                      empty: {
                                          actionLabel: "New session",
                                          description: "Start a session to begin working locally.",
                                          icon: "chat" as const,
                                          title: "No sessions yet",
                                      },
                                  }
                                : {}),
                        },
                    ]}
                />
            }
        >
            {openFolder ? (
                <>
                    {/* The heading names the working directory, not the session:
                        every tab beneath it is another session in this one
                        directory, so it stays put as they are switched. */}
                    <ChannelHeader
                        actions={
                            conversation.type === "ready" ? (
                                <ConversationStatus
                                    elapsedMs={conversationElapsedMs(conversation.value, now)}
                                    running={conversation.value.running}
                                />
                            ) : undefined
                        }
                        icon="inbox"
                        title={openFolder.name}
                        topic={openFolder.displayPath}
                    />
                    <TabbedPane
                        actions={
                            <Button
                                aria-label="New session in this folder"
                                icon="plus"
                                iconOnly
                                onClick={() =>
                                    void props.workspace
                                        .conversationCreate({ cwd: openFolder.path })
                                        .catch(() => undefined)
                                }
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
                                const rest = openFolder.conversations.filter(
                                    (summary) => summary.id !== chatId,
                                );
                                props.onChatSelect(
                                    rest.length > 0 ? openFolder.id : undefined,
                                    rest[0]?.id,
                                    true,
                                );
                            }
                            void props.workspace
                                .conversationArchive(chatId as RigSessionId)
                                .catch(() => undefined);
                        }}
                        onReorder={(chatIds) =>
                            void props.workspace
                                .conversationsReorder(
                                    openFolder.id,
                                    chatIds as readonly RigSessionId[],
                                )
                                .catch(() => undefined)
                        }
                        onSelect={(chatId) => props.onChatSelect(openFolder.id, chatId)}
                        tabs={sessionTab(openFolder)}
                    >
                        <RigConversationBody
                            conversation={conversation}
                            now={now}
                            onCreate={conversationCreate}
                            workspace={props.workspace}
                        />
                    </TabbedPane>
                </>
            ) : (
                <>
                    {/* With no directory open there is no tab strip, so this side of
                        the window would have no lane to drag it by. */}
                    {desktop ? <WindowDragRegion /> : null}
                    <EmptyState
                        action={{ label: "New session", icon: "plus", onClick: conversationCreate }}
                        description="Select a folder from the list or start a new session to begin."
                        icon="chat"
                        size="panel"
                        title="No folder selected"
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
 * How long the open session's current turn has been running. A live run counts
 * from its start against the ticking clock; a finished one keeps the duration
 * the turn recorded.
 */
function conversationElapsedMs(conversation: RigConversationSnapshot, now: number) {
    return conversation.running && conversation.runStartedAt !== undefined
        ? Math.max(0, now - conversation.runStartedAt)
        : conversation.turnElapsedMs;
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
