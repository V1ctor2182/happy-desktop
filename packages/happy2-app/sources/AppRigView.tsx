import { useMemo, useState, useSyncExternalStore } from "react";
import type {
    ConversationSummary,
    RigClockStore,
    RigConnectionStore,
    RigConversationSnapshot,
    RigHost,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionId,
    RigThinkingLevel,
    RigWorkspaceStore,
} from "happy2-state";
import { rigOwnerAuthor, rigTurnTraceDetails } from "happy2-state";
import {
    AppShell,
    Banner,
    Button,
    ComposerModelControl,
    ConversationSettingsModal,
    ConversationView,
    EmptyState,
    RigActivityPanel,
    RigConnectionStatus,
    RigSessionControls,
    RigUsagePanel,
    Sidebar,
    rigComposerModelControlProps,
    type SidebarItem,
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
}

/** Relative age of a conversation's newest content, for its list row. */
function relativeTime(then: number, now: number): string {
    const seconds = Math.floor(Math.max(0, now - then) / 1000);
    if (seconds < 45) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

function sidebarItem(summary: ConversationSummary, now: number): SidebarItem {
    return {
        id: summary.id,
        kind: "agent",
        label: summary.title,
        initials: summary.title.slice(0, 1).toUpperCase(),
        meta: summary.subtitle ?? relativeTime(summary.updatedAt, now),
        // A row only carries a status while it is live; an idle row shows its
        // directory instead, which is what tells two local sessions apart.
        ...(summary.activity === "running" ? { status: "working" as const } : {}),
    };
}

/**
 * The local workspace surface. It subscribes once each to the connection,
 * workspace, and clock stores (no local React state) and composes the shared
 * `happy2-ui` components: the same `Sidebar` the cloud stack uses for its
 * conversation list — including its shared brand heading, so the two modes are
 * one component rendered twice rather than a local-only variant — and the same
 * `ConversationView` for the selected conversation. Local-only affordances (the
 * model and effort pickers beneath the composer, the settings dialog holding the
 * view toggles and access pickers, and the usage and activity panels) are passed
 * into that surface's slots.
 *
 * Until the daemon connection is live it shows the connection status with a
 * retry. Selection, materialization, and every draft keystroke live in the
 * workspace store outside React, so this component stays a pure projection.
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

    const conversations = workspace.list.conversations;
    const rows = conversations.type === "ready" ? conversations.value : [];
    const conversation = workspace.conversation;
    const listAccessory =
        conversations.type === "loading" || conversations.type === "unloaded" ? (
            <Banner tone="neutral">Loading sessions…</Banner>
        ) : conversations.type === "error" ? (
            <Banner
                action={{ label: "Retry", onClick: () => props.workspace.conversationListRetry() }}
                tone="danger"
                title="Sessions unavailable"
            >
                {conversations.error.message}
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

    return (
        <AppShell
            sidebar={
                <Sidebar
                    activeItemId={workspace.list.selectedId ?? ""}
                    brand
                    composeLabel="New session"
                    headerAccessory={listAccessory}
                    onCompose={conversationCreate}
                    onItemSelect={(id) => props.workspace.conversationSelect(id as RigSessionId)}
                    sections={[
                        {
                            id: "sessions",
                            label: "Sessions",
                            items: rows.map((summary) => sidebarItem(summary, now)),
                            ...(conversations.type === "ready"
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
            {conversation.type === "ready" ? (
                <RigConversationSurface
                    conversation={conversation.value}
                    now={now}
                    workspace={props.workspace}
                />
            ) : conversation.type === "loading" ? (
                <EmptyState
                    description="Loading the selected local session."
                    icon="chat"
                    size="panel"
                    title="Loading session…"
                />
            ) : conversation.type === "error" ? (
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
            ) : (
                <EmptyState
                    action={{ label: "New session", icon: "plus", onClick: conversationCreate }}
                    description="Select a session from the list or start a new one to begin."
                    icon="chat"
                    size="panel"
                    title="No session selected"
                />
            )}
        </AppShell>
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
    if (conversation.session.type === "loading" || conversation.session.type === "unloaded")
        return (
            <EmptyState
                description="Loading the selected local session."
                icon="chat"
                size="panel"
                title="Loading session…"
            />
        );
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
    const elapsedMs =
        conversation.running && conversation.runStartedAt !== undefined
            ? Math.max(0, props.now - conversation.runStartedAt)
            : conversation.turnElapsedMs;
    const swallow = (operation: Promise<unknown>) => void operation.catch(() => undefined);
    const [traceMessageId, setTraceMessageId] = useState<string | undefined>();
    const traceDetails = useMemo(() => {
        if (!traceMessageId) return undefined;
        const row = conversation.entries.find(
            (entry) => entry.kind === "message" && entry.message.id === traceMessageId,
        );
        const turnId =
            row?.kind === "message" ? row.message.agentTrace?.turnId : undefined;
        if (!turnId) return undefined;
        return rigTurnTraceDetails(conversation.entries, turnId);
    }, [conversation.entries, traceMessageId]);

    return (
        <ConversationView
            composer={conversation.composer}
            composerPlaceholder="Message Happy…"
            elapsedMs={elapsedMs}
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
            onRewind={(messageId) => swallow(workspace.rewind(messageId))}
            onTraceClose={() => setTraceMessageId(undefined)}
            onTraceOpen={(messageId) => setTraceMessageId(messageId)}
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
                        compactTurns={conversation.compactTurns}
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
                        onCompactTurnsChange={() => workspace.turnCompactToggle()}
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
            subtitle={conversation.subtitle}
            title={conversation.title ?? "Untitled session"}
            traceDetails={traceDetails}
            traceMessageId={traceMessageId}
            viewerId={rigOwnerAuthor.id}
        />
    );
}
