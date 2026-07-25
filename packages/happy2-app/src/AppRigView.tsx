import { useSyncExternalStore } from "react";
import type {
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionId,
    RigThinkingLevel,
    RigWorkspaceStore,
} from "happy2-state";
import { RigConnectionStatus, RigWorkspaceView } from "happy2-ui";

export interface AppRigViewProps {
    /** Host/UI operations for the desktop shell (menus, directory picking). */
    host: RigHost;
    /** Daemon connection/health surface, used only to gate the workspace. */
    connection: RigConnectionStore;
    /** Joined session-list + active-chat product store for the live connection. */
    workspace: RigWorkspaceStore;
    /** Ticking clock feeding relative timestamps in the session list. */
    clock: RigClockStore;
}

/**
 * The desktop Rig surface. It subscribes once each to the connection, workspace,
 * and clock stores (no local React state) and composes the presentational
 * `happy2-ui` components. Until the daemon connection is live and ready it shows
 * the connection status with a retry; once ready it renders the full workspace —
 * the session list and the selected session's chat — wiring every control to the
 * workspace store's actions. The selection→chat materialization lives in the
 * workspace store (outside React), so this component stays a pure projection.
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

    const createSession = () => {
        void props.host.directoryPick().then((cwd) => {
            if (cwd) void props.workspace.sessionCreate({ cwd }).catch(() => undefined);
        });
    };

    const list = workspace.sessionList;
    const chat = workspace.chat;
    const elapsedMs =
        chat && chat.runStatus === "running" && chat.runStartedAt !== undefined
            ? Math.max(0, now - chat.runStartedAt)
            : chat?.turnElapsedMs;

    return (
        <RigWorkspaceView
            sessionList={{
                sessions: list.sessions,
                selectedId: list.selectedSessionId,
                onSelect: (id: RigSessionId) => props.workspace.sessionSelect(id),
                onCreate: createSession,
                now,
            }}
            chat={
                chat
                    ? {
                          title: chat.session?.title,
                          subtitle: chat.session?.displayCwd,
                          running: chat.runStatus === "running",
                          elapsedMs,
                          entries: chat.transcript,
                          menus: chat.menus,
                          pendingUserInputs: chat.pendingUserInputs,
                          queuedMessages: chat.queuedMessages,
                          // Slash commands wired to direct workspace actions;
                          // model/effort/permission/tier stay in the header
                          // controls rather than duplicating as palette entries.
                          commands: [
                              "usage",
                              "tasks",
                              "agents",
                              "goal",
                              "ps",
                              "new",
                              "compact",
                              "abort",
                              "fork",
                              "clear",
                          ],
                          onCommand: (id) => {
                              if (id === "new")
                                  void props.workspace.sessionReset().catch(() => undefined);
                              else if (id === "compact")
                                  void props.workspace.compact().catch(() => undefined);
                              else if (id === "abort")
                                  void props.workspace.runAbort().catch(() => undefined);
                              else if (id === "clear") props.workspace.viewClear();
                              else if (id === "usage") props.workspace.usagePanelOpen();
                              else if (
                                  id === "tasks" ||
                                  id === "agents" ||
                                  id === "goal" ||
                                  id === "ps"
                              )
                                  props.workspace.activityPanelShow();
                              else if (id === "fork" && list.selectedSessionId)
                                  void props.workspace
                                      .sessionFork(list.selectedSessionId)
                                      .catch(() => undefined);
                          },
                          onFilesSearch: (query: string) =>
                              props.workspace.filesSearch(query, 8).catch(() => []),
                          showReasoning: chat.showReasoning,
                          onReasoningToggle: () => props.workspace.reasoningToggle(),
                          compactTurns: chat.compactTurns,
                          onTurnCompactToggle: () => props.workspace.turnCompactToggle(),
                          usageOpen: chat.usagePanelOpen,
                          usage: chat.usage,
                          usageLoading: chat.usageLoading,
                          usageError: chat.usageError,
                          onUsageToggle: () =>
                              chat.usagePanelOpen
                                  ? props.workspace.usagePanelClose()
                                  : props.workspace.usagePanelOpen(),
                          activityOpen: chat.activityPanelOpen,
                          goal: chat.goal,
                          tasks: chat.tasks,
                          subagents: chat.subagents,
                          now,
                          onActivityToggle: () => props.workspace.activityPanelToggle(),
                          backgroundCount: chat.backgroundProcesses.length,
                          backgroundProcesses: chat.backgroundProcesses,
                          onBackgroundProcessStop: (processId) =>
                              void props.workspace
                                  .backgroundProcessStop(processId)
                                  .catch(() => undefined),
                          onSend: (text) =>
                              void props.workspace.messageSend(text).catch(() => undefined),
                          onShellRun: (command) =>
                              void props.workspace.shellRun(command).catch(() => undefined),
                          onAbort: () => void props.workspace.runAbort().catch(() => undefined),
                          onModelChange: (selection: RigModelSelection) =>
                              void props.workspace.modelChange(selection).catch(() => undefined),
                          onEffortChange: (effort?: RigThinkingLevel) =>
                              void props.workspace.effortChange(effort).catch(() => undefined),
                          onPermissionModeChange: (mode: RigPermissionMode) =>
                              void props.workspace
                                  .permissionModeChange(mode)
                                  .catch(() => undefined),
                          onServiceTierChange: (tier?: RigServiceTier) =>
                              void props.workspace.serviceTierChange(tier).catch(() => undefined),
                          onAnswerInput: (requestId, answers) =>
                              void props.workspace
                                  .answerInput({ requestId, answers })
                                  .catch(() => undefined),
                          onRewind: (entryId) =>
                              void props.workspace.rewind(entryId).catch(() => undefined),
                      }
                    : undefined
            }
        />
    );
}
