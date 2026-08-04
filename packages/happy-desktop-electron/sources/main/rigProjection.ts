import type {
    AgentBlock,
    AgentLoopEvent,
    AssistantMessage,
    BashSessionActivity,
    FileDiff,
    GetSessionUsageResponse,
    GlobalEventQueueEntry,
    Message,
    ModelCatalog,
    Model,
    Project,
    ProjectWorkspace,
    ProtocolSession,
    RemoteTerminalSummary,
    RunShellCommandResponse,
    SessionGoal,
    SessionEvent,
    SessionSummary,
    SessionTask,
    SubagentSummary,
    ToolCall,
    ToolCallPresentation,
    ToolResultBlock,
    ToolResultPresentation,
    UserInputRequest,
} from "./rigDaemonTypes";
import type {
    RigAgentEvent,
    RigBackgroundProcess,
    RigBlock,
    RigEventId,
    RigFileDiff,
    RigGlobalEvent,
    RigGoal,
    RigJson,
    RigMessage,
    RigModel,
    RigModelCatalog,
    RigProject,
    RigProjectComputeState,
    RigProjectId,
    RigQueuedMessage,
    RigSession,
    RigSessionEvent,
    RigSessionId,
    RigSessionSummary,
    RigSessionUsage,
    RigSlotAction,
    RigSlotEntry,
    RigShellCommandResult,
    RigUsageGroup,
    RigUsageQuotaWindow,
    RigSubagentSummary,
    RigTask,
    RigTerminal,
    RigTerminalId,
    RigThinkingLevel,
    RigToolFailure,
    RigToolPresentation,
    RigUserInputRequest,
    RigWorktree,
    RigWorktreeId,
    RigWebapp,
} from "happy-desktop-state";
import type { SlotAction, SlotEntry, Webapp } from "./rigDaemonTypes";

/**
 * Pure projections from Rig's raw `@slopus/rig` protocol types into the closed,
 * serialization-safe `happy-desktop-state` projections. They live in the desktop main
 * process (and the dev-server plugin) so the renderer/app bundle never imports a
 * `@slopus` wire shape: the loopback proxy exposes already-projected JSON/SSE.
 *
 * These are deliberately synchronous and side-effect free (only `displayCwd` reads
 * an injected home directory), which keeps them exhaustively unit-testable.
 */

/** Renders a home-relative display path (`~/work`) without touching the filesystem. */
export function rigDisplayCwd(cwd: string, homeDir: string): string {
    if (!homeDir) return cwd;
    if (cwd === homeDir) return "~";
    if (cwd.startsWith(`${homeDir}/`)) return `~${cwd.slice(homeDir.length)}`;
    return cwd;
}

export function rigCatalogProject(catalog: ModelCatalog): RigModelCatalog {
    return {
        defaultModelId: catalog.defaultModelId,
        defaultProviderId: catalog.defaultProviderId,
        models: catalog.models.map(modelProject),
        providers: catalog.providers.map((provider) => ({
            id: provider.providerId,
            models: provider.models.map(modelProject),
            serviceTiers: provider.serviceTiers ?? [],
            ...(provider.disabledReason ? { disabledReason: provider.disabledReason } : {}),
        })),
    };
}

/**
 * Projects one daemon project into the row the workspace list shows. The avatar
 * `url` stays daemon-relative (`/project-assets/<hash>`): only the renderer knows
 * which loopback origin it is talking to, so it — not this pure projection —
 * resolves the path against that origin.
 */
export function rigProjectProject(project: Project, homeDir: string): RigProject {
    return {
        id: project.id as RigProjectId,
        name: project.name,
        orderKey: project.orderKey,
        path: project.path,
        displayPath: rigDisplayCwd(project.path, homeDir),
        kind: project.kind,
        status: project.initializationStatus,
        ...(project.changedFiles === undefined ? {} : { changedFiles: project.changedFiles }),
        ...(project.addedLines === undefined ? {} : { addedLines: project.addedLines }),
        ...(project.deletedLines === undefined ? {} : { deletedLines: project.deletedLines }),
        ...(project.changes === undefined ? {} : { changes: project.changes }),
        ...(project.avatar
            ? {
                  avatar: {
                      url: project.avatar.url,
                      width: project.avatar.width,
                      height: project.avatar.height,
                  },
              }
            : {}),
    };
}

/**
 * Projects one daemon project's compute settings into what the settings surface
 * reads. The daemon states the choice and the generation together; a project that
 * states no choice keeps the generation it has, because the generation counts
 * changes to the setting rather than belonging to any one choice.
 */
export function rigProjectComputeProject(project: Project): RigProjectComputeState {
    const compute = project.settings.defaultWorkspaceCompute;
    return {
        projectId: project.id as RigProjectId,
        generation: compute?.generation ?? 0,
        ...(compute === undefined
            ? {}
            : {
                  compute:
                      compute.type === "local"
                          ? { type: "local" }
                          : { type: "docker", image: compute.image },
              }),
    };
}

/** Projects one of a project's git worktrees into the nested group the list shows. */
export function rigWorktreeProject(workspace: ProjectWorkspace, homeDir: string): RigWorktree {
    return {
        id: workspace.id as RigWorktreeId,
        projectId: workspace.projectId as RigProjectId,
        name: workspace.name,
        orderKey: workspace.orderKey,
        path: workspace.path,
        displayPath: rigDisplayCwd(workspace.path, homeDir),
        status: workspace.status,
        presence: workspace.presence,
        ...(workspace.error === undefined ? {} : { error: workspace.error }),
        ...(workspace.changedFiles === undefined ? {} : { changedFiles: workspace.changedFiles }),
        ...(workspace.addedLines === undefined ? {} : { addedLines: workspace.addedLines }),
        ...(workspace.deletedLines === undefined ? {} : { deletedLines: workspace.deletedLines }),
        ...(workspace.changes === undefined ? {} : { changes: workspace.changes }),
    };
}

export function rigSessionSummaryProject(
    summary: SessionSummary,
    homeDir: string,
): RigSessionSummary {
    return {
        id: summary.id as RigSessionId,
        projectId: summary.projectId as RigProjectId,
        ...(summary.workspaceId ? { worktreeId: summary.workspaceId as RigWorktreeId } : {}),
        // A subagent carries no key. Passing the absence through is what keeps it
        // out of the lists; inventing one would file it under a project as an
        // ordinary session.
        ...(summary.orderKey === undefined ? {} : { orderKey: summary.orderKey }),
        cwd: summary.cwd,
        displayCwd: rigDisplayCwd(summary.cwd, homeDir),
        providerId: summary.providerId,
        modelId: summary.modelId,
        permissionMode: summary.permissionMode,
        status: summary.status,
        ...(summary.wait === undefined
            ? {}
            : { wait: { startedAt: summary.wait.startedAt, dueAt: summary.wait.dueAt } }),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        ...(summary.effort ? { effort: summary.effort as RigThinkingLevel } : {}),
        ...(summary.serviceTier ? { serviceTier: summary.serviceTier } : {}),
        ...(summary.title ? { title: summary.title } : {}),
        ...(summary.recap ? { recap: summary.recap } : {}),
        ...(summary.lastMessageAt ? { lastMessageAt: summary.lastMessageAt } : {}),
        ...(summary.draft ? { draft: summary.draft } : {}),
        ...(summary.draftUpdatedAt === undefined ? {} : { draftUpdatedAt: summary.draftUpdatedAt }),
    };
}

export function rigSessionProject(session: ProtocolSession, homeDir: string): RigSession {
    return {
        id: session.id as RigSessionId,
        projectId: session.projectId as RigProjectId,
        ...(session.workspaceId ? { worktreeId: session.workspaceId as RigWorktreeId } : {}),
        // A session with no place in an ordered list (a subagent) carries no key.
        ...(session.orderKey === undefined ? {} : { orderKey: session.orderKey }),
        cwd: session.cwd,
        displayCwd: rigDisplayCwd(session.cwd, homeDir),
        providerId: session.providerId,
        modelId: session.modelId,
        models: session.models.map(modelProject),
        permissionMode: session.permissionMode,
        modelLocked: session.modelLocked,
        status: session.status,
        messages: session.snapshot.messages.map(messageProject),
        queuedMessages: queuedMessagesProject(session.snapshot.queue),
        pendingUserInputs: session.pendingUserInputs.map(userInputProject),
        tasks: session.tasks.map(taskProject),
        subagents: [],
        backgroundProcesses: (session.backgroundProcesses ?? []).map(backgroundProcessProject),
        // ProtocolSession has no created/updated timestamps; the summary carries
        // those, so the session snapshot uses metadata time as its best proxy.
        createdAt: session.metadataUpdatedAt ?? 0,
        updatedAt: session.metadataUpdatedAt ?? 0,
        ...(session.effort ? { effort: session.effort as RigThinkingLevel } : {}),
        ...(session.serviceTier ? { serviceTier: session.serviceTier } : {}),
        ...(session.title ? { title: session.title } : {}),
        ...(session.recap ? { recap: session.recap } : {}),
        ...(session.draft ? { draft: session.draft } : {}),
        ...(session.draftUpdatedAt === undefined ? {} : { draftUpdatedAt: session.draftUpdatedAt }),
        ...(session.goal ? { goal: goalProject(session.goal) } : {}),
        ...(session.lastEventId ? { lastEventId: session.lastEventId as RigEventId } : {}),
    };
}

export function rigSubagentProject(subagent: SubagentSummary): RigSubagentSummary {
    return {
        id: subagent.id as RigSessionId,
        parentSessionId: subagent.parentSessionId as RigSessionId,
        ...(subagent.parentToolCallId ? { parentToolCallId: subagent.parentToolCallId } : {}),
        description: subagent.description,
        modelId: subagent.modelId,
        status: subagent.status,
        depth: subagent.depth,
        createdAt: subagent.createdAt,
        updatedAt: subagent.updatedAt,
        ...(subagent.taskName ? { taskName: subagent.taskName } : {}),
        ...(subagent.activeSince ? { activeSince: subagent.activeSince } : {}),
        ...(subagent.elapsedMs ? { elapsedMs: subagent.elapsedMs } : {}),
        ...(subagent.latestText ? { latestText: subagent.latestText } : {}),
        ...(subagent.totalTokens ? { totalTokens: subagent.totalTokens } : {}),
    };
}

/**
 * Projects the protocol's session-usage response into the client usage snapshot.
 * Flattens per-model groups to plain token/cost numbers, sums a session total,
 * and reduces provider quota windows to the two rate-limit windows the TUI shows.
 * Pure read model for the on-demand `/usage` panel; holds no durable state.
 */
export function rigSessionUsageProject(response: GetSessionUsageResponse): RigSessionUsage {
    const groups: RigUsageGroup[] = response.groups.map((group) => ({
        modelId: group.modelId,
        providerId: group.providerId,
        inputTokens: group.usage.input,
        outputTokens: group.usage.output,
        cacheReadTokens: group.usage.cacheRead,
        cacheWriteTokens: group.usage.cacheWrite,
        totalTokens: group.usage.totalTokens,
        cost: group.usage.cost.total,
        ...(group.usage.reasoning !== undefined ? { reasoningTokens: group.usage.reasoning } : {}),
    }));
    const totalTokens = groups.reduce((sum, group) => sum + group.totalTokens, 0);
    const totalCost = groups.reduce((sum, group) => sum + group.cost, 0);
    const quotas = response.quotas.map((entry) => {
        const windows: RigUsageQuotaWindow[] = [];
        const five = entry.quota.windows.fiveHour;
        if (five && five.status === "available")
            windows.push({
                kind: "fiveHour",
                usedPercent: five.usedPercent,
                resetsAt: five.resetsAt,
            });
        const weekly = entry.quota.windows.weekly;
        if (weekly && weekly.status === "available")
            windows.push({
                kind: "weekly",
                usedPercent: weekly.usedPercent,
                resetsAt: weekly.resetsAt,
            });
        return { providerId: entry.providerId, windows };
    });
    return {
        currentProviderId: response.currentProviderId,
        groups,
        totalTokens,
        totalCost,
        quotas,
        ...(response.context
            ? {
                  context: {
                      modelId: response.context.modelId,
                      providerId: response.context.providerId,
                      totalTokens: response.context.totalTokens,
                      approximate: response.context.approximate,
                  },
              }
            : {}),
    };
}

export function rigMessageProject(message: Message): RigMessage {
    return messageProject(message);
}

/**
 * Projects one raw `SessionEvent` into the chat surface's `RigSessionEvent`, or
 * `undefined` when the event has no chat projection (steering, quota, shell,
 * secrets, MCP, workflows, external tools) and must be dropped. The background-
 * process change is delivered nested inside `agent_event` on the wire but is a
 * session-level concern here, so it is lifted out to its own top-level event.
 */
export function rigSessionEventProject(
    event: SessionEvent,
    homeDir: string,
): RigSessionEvent | undefined {
    const base = {
        eventId: event.id as RigEventId,
        sessionId: event.sessionId as RigSessionId,
        createdAt: event.createdAt,
    };
    switch (event.type) {
        case "session_created":
            return {
                ...base,
                type: "session_created",
                session: rigSessionProject(event.data.session, homeDir),
            };
        case "session_updated":
            return {
                ...base,
                type: "session_updated",
                session: rigSessionProject(event.data.session, homeDir),
            };
        case "message_submitted":
            return {
                ...base,
                type: "message_submitted",
                message: messageProject(event.data.message),
                displayText: event.data.displayText,
                runId: event.data.runId,
                ...(event.data.delivery ? { delivery: event.data.delivery } : {}),
            };
        case "run_started":
            return { ...base, type: "run_started", runId: event.data.runId };
        case "agent_event": {
            const inner = event.data.event;
            if (inner.type === "background_processes_changed") {
                return {
                    ...base,
                    type: "background_processes_changed",
                    processes: (inner.processes ?? []).map(backgroundProcessProject),
                };
            }
            const projected = agentEventProject(inner);
            return projected
                ? {
                      ...base,
                      type: "agent_event",
                      runId: event.data.runId,
                      ...("messageId" in inner ? { messageId: inner.messageId } : {}),
                      event: projected,
                  }
                : undefined;
        }
        case "agent_message":
            return {
                ...base,
                type: "agent_message",
                runId: event.data.runId,
                message: messageProject(event.data.message),
            };
        case "run_finished":
            return {
                ...base,
                type: "run_finished",
                runId: event.data.runId,
                stopReason: event.data.stopReason,
                modelLocked: event.data.modelLocked,
                ...(event.data.errorMessage !== undefined
                    ? { errorMessage: event.data.errorMessage }
                    : {}),
            };
        case "run_error":
            return {
                ...base,
                type: "run_error",
                runId: event.data.runId,
                errorMessage: event.data.errorMessage,
                modelLocked: event.data.modelLocked,
            };
        case "session_reset":
            return {
                ...base,
                type: "session_reset",
                messages: event.data.snapshot.messages.map(messageProject),
            };
        case "session_rewound":
            return {
                ...base,
                type: "session_rewound",
                messageId: event.data.messageId,
                messages: event.data.snapshot.messages.map(messageProject),
            };
        case "session_title_changed":
            return {
                ...base,
                type: "session_title_changed",
                status: event.data.status,
                ...(event.data.title ? { title: event.data.title } : {}),
                ...(event.data.recap ? { recap: event.data.recap } : {}),
            };
        case "model_changed":
            return {
                ...base,
                type: "model_changed",
                modelId: event.data.modelId,
                providerId: event.data.snapshot.providerId,
                ...(event.data.effort ? { effort: event.data.effort as RigThinkingLevel } : {}),
            };
        case "effort_changed":
            return {
                ...base,
                type: "effort_changed",
                modelId: event.data.modelId,
                ...(event.data.effort ? { effort: event.data.effort as RigThinkingLevel } : {}),
            };
        case "service_tier_changed":
            return { ...base, type: "service_tier_changed", serviceTier: event.data.serviceTier };
        case "permission_mode_changed":
            return {
                ...base,
                type: "permission_mode_changed",
                permissionMode: event.data.permissionMode,
            };
        case "session_draft_changed":
            return {
                ...base,
                type: "session_draft_changed",
                ...(event.data.draft === undefined ? {} : { draft: event.data.draft }),
                ...(event.data.origin === undefined ? {} : { origin: event.data.origin }),
                updatedAt: event.data.updatedAt,
            };
        case "user_input_requested":
            return {
                ...base,
                type: "user_input_requested",
                request: userInputProject(event.data),
            };
        case "user_input_resolved":
            return {
                ...base,
                type: "user_input_resolved",
                requestId: event.data.requestId,
                status: event.data.status,
            };
        case "tasks_changed":
            return { ...base, type: "tasks_changed", tasks: event.data.tasks.map(taskProject) };
        case "goal_changed":
            return {
                ...base,
                type: "goal_changed",
                goal: event.data.goal ? goalProject(event.data.goal) : null,
            };
        case "subagent_changed":
            return {
                ...base,
                type: "subagent_changed",
                subagent: rigSubagentProject(event.data.subagent),
            };
        case "shell_command_started":
            return {
                ...base,
                type: "shell_command_started",
                commandId: event.data.commandId,
                command: event.data.command,
            };
        case "shell_command_finished":
            return {
                ...base,
                type: "shell_command_finished",
                commandId: event.data.commandId,
                command: event.data.command,
                output: event.data.output,
                exitCode: event.data.exitCode,
                timedOut: event.data.timedOut,
            };
        default:
            return undefined;
    }
}

/**
 * Projects one global-queue entry into a `RigGlobalEvent` used to keep the
 * workspace list live, or `undefined` for entries the list does not consume. The
 * session payload is a full `ProtocolSession`, so the envelope's `createdAt`
 * seeds the summary timestamps the list sorts by until the next full reconcile.
 *
 * Project and worktree events carry no payload here: a project's name or picture
 * changing only ever means "re-read the catalog", and the list treats every
 * global event as a delivery hint anyway.
 */
export function rigGlobalEventProject(
    entry:
        | GlobalEventQueueEntry
        | {
              readonly live: true;
              readonly event: import("./rigDaemonTypes").GlobalLiveEvent;
          },
    homeDir: string,
): RigGlobalEvent | undefined {
    const event = entry.event;
    if ("live" in entry) {
        const live = entry.event as import("./rigDaemonTypes").GlobalLiveEvent;
        if (live.type === "slots_changed") return { type: "slots_changed" };
        if (live.type === "webapps_changed") return { type: "webapps_changed" };
        if (live.type !== "project_git_changed" && live.type !== "workspace_git_changed")
            return undefined;
        return {
            type: "git_changed",
            projectId: live.projectId as RigProjectId,
            ...(live.type === "workspace_git_changed"
                ? { worktreeId: live.workspaceId as RigWorktreeId }
                : {}),
        };
    }
    if (event.type === "session_created") {
        return {
            cursor: entry.cursor,
            type: "session_created",
            session: summaryFromSession(event.data.session, event.createdAt, homeDir),
        };
    }
    if (event.type === "session_updated") {
        return {
            cursor: entry.cursor,
            type: "session_updated",
            session: summaryFromSession(event.data.session, event.createdAt, homeDir),
        };
    }
    if (event.type === "session_title_changed") {
        return {
            cursor: entry.cursor,
            type: "session_title_changed",
            sessionId: event.sessionId as RigSessionId,
            status: event.data.status,
            ...(event.data.title ? { title: event.data.title } : {}),
            ...(event.data.recap ? { recap: event.data.recap } : {}),
        };
    }
    if (
        event.type === "run_started" ||
        event.type === "run_finished" ||
        event.type === "run_error"
    ) {
        return {
            cursor: entry.cursor,
            type: "session_activity_changed",
            sessionId: event.sessionId as RigSessionId,
        };
    }
    if (
        event.type === "project_created" ||
        event.type === "project_updated" ||
        event.type === "workspace_created" ||
        event.type === "workspace_updated"
    ) {
        return { cursor: entry.cursor, type: "catalog_changed" };
    }
    return undefined;
}

/** Projects one durable Rig slot entry into the framework-neutral product shape. */
export function rigSlotEntryProject(entry: SlotEntry): RigSlotEntry {
    return {
        id: entry.id,
        slot: entry.slot,
        scope: entry.scope,
        ...(entry.projectId ? { projectId: entry.projectId as RigProjectId } : {}),
        ...(entry.workspaceId ? { workspaceId: entry.workspaceId as RigWorktreeId } : {}),
        ...(entry.sessionId ? { sessionId: entry.sessionId as RigSessionId } : {}),
        content:
            entry.content.type === "text"
                ? { type: "text", markdown: entry.content.markdown }
                : {
                      type: "button",
                      label: entry.content.label,
                      action: rigSlotActionProject(entry.content.action),
                  },
        author:
            entry.author.type === "agent"
                ? { type: "agent", sessionId: entry.author.sessionId as RigSessionId }
                : { type: "plugin", folder: entry.author.folder, name: entry.author.name },
        description: entry.description,
        purpose: entry.purpose,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}

function rigSlotActionProject(action: SlotAction): RigSlotAction {
    switch (action.type) {
        case "send-current-chat":
            return { type: action.type, message: action.message };
        case "open-webapp":
            return { type: action.type, webapp: action.webapp };
        case "send-chat":
        case "draft-chat":
            return {
                type: action.type,
                sessionId: action.sessionId as RigSessionId,
                message: action.message,
            };
        case "new-chat":
            return {
                type: action.type,
                ...(action.projectId ? { projectId: action.projectId as RigProjectId } : {}),
                ...(action.workspaceId ? { workspaceId: action.workspaceId as RigWorktreeId } : {}),
                ...(action.model ? { model: action.model } : {}),
                ...(action.effort ? { effort: action.effort as RigThinkingLevel } : {}),
                ...(action.prompt ? { prompt: action.prompt } : {}),
            };
    }
}

/** Projects one versioned webapp and its revision history into product state. */
export function rigWebappProject(webapp: Webapp): RigWebapp {
    return {
        name: webapp.name,
        description: webapp.description,
        purpose: webapp.purpose,
        authorSessionId: webapp.authorSessionId,
        ...(webapp.sourceDescription ? { sourceDescription: webapp.sourceDescription } : {}),
        currentVersion: webapp.currentVersion,
        versions: webapp.versions.map((version) => ({
            version: version.version,
            changeDescription: version.changeDescription,
            createdAt: version.createdAt,
        })),
        createdAt: webapp.createdAt,
        updatedAt: webapp.updatedAt,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function modelProject(model: Model): RigModel {
    return {
        id: model.id,
        name: model.name,
        thinkingLevels: model.thinkingLevels as readonly RigThinkingLevel[],
        defaultThinkingLevel: model.defaultThinkingLevel as RigThinkingLevel,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    };
}

/**
 * Projects the agent's steering queue into displayable previews. Only non-internal
 * user turns are shown (system/internal enqueues are runner plumbing), and each is
 * flattened to its text blocks so the composer can preview what submits next.
 */
function queuedMessagesProject(
    queue: readonly { readonly id: string; readonly message: Message }[],
): readonly RigQueuedMessage[] {
    const previews: RigQueuedMessage[] = [];
    for (const entry of queue) {
        if (entry.message.internal) continue;
        if (entry.message.role !== "user") continue;
        const text = entry.message.blocks
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("")
            .trim();
        if (text.length === 0) continue;
        previews.push({ id: entry.id, text });
    }
    return previews;
}

function messageProject(message: Message): RigMessage {
    // A compaction record is context bookkeeping, not a turn anyone wrote: keep it
    // out of the transcript the way every other internal message is kept out.
    if (message.role === "compaction")
        return {
            id: message.id,
            role: "system",
            blocks: (message.blocks as readonly AgentBlock[]).map(blockProject),
            internal: true,
        };
    // A failed inference attempt is history the reader has to see — it is why the
    // run stopped, or why it took another turn — but nobody authored it, so it
    // reads as the transcript's own voice rather than as the agent speaking.
    if (message.role === "error")
        return {
            id: message.id,
            role: "system",
            blocks: (message.blocks as readonly AgentBlock[]).map(blockProject),
            internal: false,
        };
    return {
        id: message.id,
        role: message.role,
        blocks: (message.blocks as readonly AgentBlock[]).map(blockProject),
        internal: message.internal ?? false,
    };
}

function blockProject(block: AgentBlock): RigBlock {
    switch (block.type) {
        case "text":
            return { type: "text", text: block.text };
        case "image":
            return {
                type: "image",
                mediaType: block.mediaType,
                data: block.data,
                ...(block.detail ? { detail: block.detail } : {}),
            };
        case "thinking":
            return {
                type: "thinking",
                thinking: block.thinking,
                redacted: block.redacted ?? false,
            };
        case "tool_call":
            return {
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: jsonProject(block.arguments),
                ...(block.presentation
                    ? { presentation: callPresentationProject(block.presentation) }
                    : {}),
            };
        case "tool_result":
            return toolResultProject(block);
    }
}

function toolResultProject(block: ToolResultBlock): RigBlock {
    return {
        type: "toolResult",
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        display: block.display,
        failed: block.isError ?? Boolean(block.failure),
        ...(block.failure ? { failure: failureProject(block.failure) } : {}),
        ...(block.presentation ? { presentation: presentationProject(block.presentation) } : {}),
    };
}

function failureProject(failure: NonNullable<ToolResultBlock["failure"]>): RigToolFailure {
    return { kind: failure.kind, ...(failure.message ? { message: failure.message } : {}) };
}

function callPresentationProject(presentation: ToolCallPresentation): RigToolPresentation {
    if (presentation.type === "exec_command") {
        return {
            type: "execCommand",
            command: presentation.command,
            output: "",
        };
    }
    return {
        type: "exploration",
        operations: presentation.operations.map((operation) => ({ ...operation })),
    };
}

function presentationProject(presentation: ToolResultPresentation): RigToolPresentation {
    if (presentation.type === "file_diff") {
        return {
            type: "fileDiff",
            files: presentation.files.map(fileDiffProject),
            ...(presentation.omittedFiles ? { omittedFiles: presentation.omittedFiles } : {}),
        };
    }
    if (presentation.type === "exec_command") {
        return { type: "execCommand", command: presentation.command, output: presentation.output };
    }
    // A command shown as exploration while it ran stays exploration once it
    // finishes, so the finished row replaces the running one rather than
    // appearing beside it as a second, unrelated tool call.
    if (presentation.type === "exploration") {
        return {
            type: "exploration",
            operations: presentation.operations.map((operation) => ({ ...operation })),
        };
    }
    return {
        type: "backgroundTerminalInteraction",
        command: presentation.command,
        input: presentation.input,
    };
}

function fileDiffProject(diff: FileDiff): RigFileDiff {
    return {
        path: diff.path,
        kind: diff.kind,
        hunks: diff.hunks.map((hunk) => ({
            oldStart: hunk.oldStart,
            newStart: hunk.newStart,
            lines: hunk.lines.map((line) => ({ kind: line.kind, text: line.text })),
        })),
        ...(diff.language ? { language: diff.language } : {}),
        ...(diff.added !== undefined ? { added: diff.added } : {}),
        ...(diff.deleted !== undefined ? { deleted: diff.deleted } : {}),
        ...(diff.omittedLines ? { omittedLines: diff.omittedLines } : {}),
    };
}

/**
 * Projects one streaming `AgentLoopEvent` to the chat's `RigAgentEvent`, or
 * `undefined` for loop events the chat surface does not render (steering
 * applied, batch rejected, ephemeral status labels, background-process changes
 * — the last is lifted to a session-level event by the caller). Iteration start
 * is retained because it introduces the durable message id for every later
 * streaming block in that inference.
 */
function agentEventProject(event: AgentLoopEvent): RigAgentEvent | undefined {
    switch (event.type) {
        case "text_start":
            return { type: "text_start" };
        case "text_delta":
            return { type: "text_delta", text: event.delta };
        case "text_end":
            return { type: "text_end" };
        case "thinking_start":
            return { type: "thinking_start" };
        case "thinking_delta":
            return { type: "thinking_delta", thinking: event.delta };
        case "thinking_end":
            return { type: "thinking_end" };
        case "toolcall_start": {
            const call = toolCallAt(event.partial, event.contentIndex);
            return call
                ? { type: "toolcall_start", toolCallId: call.id, toolName: call.name }
                : undefined;
        }
        case "toolcall_delta": {
            const call = toolCallAt(event.partial, event.contentIndex);
            return call
                ? { type: "toolcall_delta", toolCallId: call.id, argumentsDelta: event.delta }
                : undefined;
        }
        case "toolcall_end":
            return {
                type: "toolcall_end",
                toolCallId: event.toolCall.id,
                arguments: jsonProject(event.toolCall.arguments),
            };
        case "done":
            return { type: "done", reason: event.reason };
        case "error":
            return { type: "error", reason: event.error.errorMessage ?? event.reason };
        case "context_compaction_started":
            return { type: "context_compaction_started" };
        case "context_compaction_finished":
            return { type: "context_compaction_finished" };
        case "context_compacted":
            return {
                type: "context_compacted",
                reason: event.reason,
                estimatedTokensBefore: event.estimatedTokensBefore,
                estimatedTokensAfter: event.estimatedTokensAfter,
            };
        case "inference_retry":
            return {
                type: "inference_retry",
                attempt: event.attempt,
                maxAttempts: event.maxAttempts,
                reason: event.reason,
            };
        case "inference_iteration_start":
            return { type: "inference_iteration_start", messageId: event.messageId };
        case "tool_execution_start":
            return {
                type: "tool_execution_start",
                toolCallId: event.toolCall.id,
                toolName: event.toolCall.name,
                arguments: jsonProject(event.toolCall.arguments),
                ...(event.toolCall.presentation
                    ? { presentation: callPresentationProject(event.toolCall.presentation) }
                    : {}),
            };
        case "tool_execution_progress":
            return {
                type: "tool_execution_progress",
                toolCallId: event.toolCallId,
                display: event.display,
            };
        case "tool_execution_end":
            return {
                type: "tool_execution_end",
                toolCallId: event.result.toolCallId,
                toolName: event.result.toolName,
                display: event.result.display,
                failed: event.result.isError ?? Boolean(event.result.failure),
                ...(event.result.failure ? { failure: failureProject(event.result.failure) } : {}),
                ...(event.result.presentation
                    ? { presentation: presentationProject(event.result.presentation) }
                    : {}),
            };
        default:
            return undefined;
    }
}

function toolCallAt(partial: AssistantMessage, index: number): ToolCall | undefined {
    const content = partial.content[index];
    return content && content.type === "toolCall" ? content : undefined;
}

function userInputProject(request: UserInputRequest): RigUserInputRequest {
    return {
        requestId: request.requestId,
        questions: request.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            multiSelect: question.multiSelect,
            required: question.required ?? false,
            options: question.options.map((option) => ({
                label: option.label,
                description: option.description,
            })),
        })),
    };
}

function taskProject(task: SessionTask): RigTask {
    return {
        id: task.id,
        subject: task.subject,
        description: task.description,
        status: task.status,
        blockedBy: task.blockedBy,
        blocks: task.blocks,
        ...(task.activeForm ? { activeForm: task.activeForm } : {}),
        ...(task.owner ? { owner: task.owner } : {}),
    };
}

function goalProject(goal: SessionGoal): RigGoal {
    return {
        objective: goal.objective,
        status: goal.status,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
    };
}

function backgroundProcessProject(process: BashSessionActivity): RigBackgroundProcess {
    return {
        id: process.sessionId,
        command: process.command,
        cwd: process.cwd,
        status: process.status,
    };
}

/**
 * Projects a `runShellCommand` daemon response into the closed `RigShellCommandResult`.
 * A still-running response (the command detached into a background terminal) carries
 * no captured output yet, so it maps to an empty result flagged with the background id.
 */
export function rigShellResultProject(response: RunShellCommandResponse): RigShellCommandResult {
    if (response.status === "running") {
        return {
            command: response.command,
            commandId: response.commandId,
            output: "",
            exitCode: null,
            timedOut: false,
            backgroundProcessId: response.sessionId,
        };
    }
    return {
        command: response.command,
        commandId: response.commandId,
        output: response.output,
        exitCode: response.exitCode,
        timedOut: response.timedOut,
        ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
        ...(response.sessionId !== undefined ? { backgroundProcessId: response.sessionId } : {}),
    };
}

/**
 * Projects a daemon terminal summary into the closed `RigTerminal`. The wire
 * shape also carries the protocol `epoch`, which belongs to the attachment's
 * resume handshake rather than to product state — the renderer learns it from the
 * channel itself — so it is deliberately dropped here.
 */
export function rigTerminalProject(summary: RemoteTerminalSummary): RigTerminal {
    return {
        id: summary.id as RigTerminalId,
        cols: summary.cols,
        rows: summary.rows,
        status: summary.status,
        exitCode: summary.exitCode,
    };
}

function summaryFromSession(
    session: ProtocolSession,
    createdAt: number,
    homeDir: string,
): RigSessionSummary {
    return {
        id: session.id as RigSessionId,
        projectId: session.projectId as RigProjectId,
        ...(session.workspaceId ? { worktreeId: session.workspaceId as RigWorktreeId } : {}),
        // A session with no place in an ordered list (a subagent) carries no key.
        ...(session.orderKey === undefined ? {} : { orderKey: session.orderKey }),
        cwd: session.cwd,
        displayCwd: rigDisplayCwd(session.cwd, homeDir),
        providerId: session.providerId,
        modelId: session.modelId,
        permissionMode: session.permissionMode,
        status: session.status,
        ...(session.activity?.wait === undefined
            ? {}
            : {
                  wait: {
                      startedAt: session.activity.wait.startedAt,
                      dueAt: session.activity.wait.dueAt,
                  },
              }),
        createdAt,
        updatedAt: session.metadataUpdatedAt ?? createdAt,
        ...(session.effort ? { effort: session.effort as RigThinkingLevel } : {}),
        ...(session.serviceTier ? { serviceTier: session.serviceTier } : {}),
        ...(session.title ? { title: session.title } : {}),
        ...(session.recap ? { recap: session.recap } : {}),
    };
}

function jsonProject(value: unknown): RigJson {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(jsonProject);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, jsonProject(entry)]),
        );
    }
    return null;
}
