import type {
    AgentTurnStatus,
    AgentTurnTraceDetails,
    AgentTurnTraceEntrySummary,
    AgentTurnTraceKind,
    AgentTurnTraceLatest,
    AgentTurnTraceSummary,
} from "../types.js";
import type { ConversationActivityEntry, ConversationEntry } from "../conversation/conversationEntry.js";
import { rigAgentAuthor, rigOwnerAuthor } from "./rigConversationProject.js";

function humanizeToolName(name: string): string {
    const explicit: Record<string, string> = {
        Agent: "Subagent",
        TaskList: "Task list",
        TaskOutput: "Background output",
        spawn_agent: "Start subagent",
        wait_agent: "Wait for subagents",
        workflow: "Workflow",
    };
    if (explicit[name]) return explicit[name]!;
    if (name.startsWith("mcp__")) {
        const parts = name.split("__");
        if (parts.length >= 3) return `${parts[1]} · ${parts.slice(2).join(" ")}`;
    }
    return name
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (character) => character.toUpperCase());
}

function activityTraceEntry(
    entry: ConversationActivityEntry,
    occurredAt: number,
): AgentTurnTraceEntrySummary {
    const activity = entry.activity;
    if (activity.kind === "reasoning") {
        const line = activity.text.split("\n").find((row) => row.trim().length > 0) ?? "";
        return {
            id: entry.id,
            kind: "reasoning",
            title: activity.streaming ? "Thinking" : "Thought",
            detail: line,
            status: activity.streaming ? "running" : "complete",
            occurredAt,
        };
    }
    if (activity.kind === "shell") {
        const failed =
            !activity.running && (activity.timedOut || (activity.exitCode ?? 0) !== 0);
        return {
            id: entry.id,
            kind: "terminal",
            title: activity.running ? "Running" : "Ran",
            detail: activity.command,
            status: activity.running ? "running" : failed ? "failed" : "complete",
            occurredAt,
        };
    }
    const tool = activity.tool;
    const failed = tool.status === "failed" || tool.failed;
    const running = tool.status === "running" || tool.status === "awaitingApproval";
    let detail: string | undefined;
    if (tool.presentation?.type === "execCommand") detail = tool.presentation.command;
    else if (tool.presentation?.type === "fileDiff") detail = tool.presentation.files[0]?.path;
    return {
        id: entry.id,
        kind: "tool",
        title: humanizeToolName(tool.toolName),
        detail,
        status: running ? "running" : failed ? "failed" : "complete",
        occurredAt,
    };
}

function latestFromActivities(
    activities: readonly ConversationActivityEntry[],
    baseTime: number,
): AgentTurnTraceLatest | undefined {
    const last = activities[activities.length - 1];
    if (!last) return undefined;
    const entry = activityTraceEntry(last, baseTime + activities.length);
    return {
        kind: entry.kind,
        title: entry.title,
        ...(entry.detail ? { detail: entry.detail } : {}),
        occurredAt: entry.occurredAt,
    };
}

function turnFailed(activities: readonly ConversationActivityEntry[]): boolean {
    return activities.some((entry) => {
        const activity = entry.activity;
        if (activity.kind === "tool") return activity.tool.failed || activity.tool.status === "failed";
        if (activity.kind === "shell")
            return (
                !activity.running &&
                (activity.timedOut || (activity.exitCode ?? 0) !== 0)
            );
        return false;
    });
}

function withAgentTrace(
    entry: ConversationEntry,
    trace: AgentTurnTraceSummary,
): ConversationEntry {
    if (entry.kind !== "message" || entry.message.sender?.kind !== "agent") return entry;
    return {
        ...entry,
        message: { ...entry.message, agentTrace: trace },
    };
}

/**
 * Attaches a shared `agentTrace` summary to every agent message in each user
 * turn so the cloud-style meta row can offer "View trace" without inlining tool
 * rows into the message header model.
 */
export function rigConversationAttachTurnTraces(
    entries: readonly ConversationEntry[],
    input: { readonly running: boolean },
): readonly ConversationEntry[] {
    const result: ConversationEntry[] = [];
    let turnUserId: string | undefined;
    let turnStartedAt = 0;
    let turnBody: ConversationEntry[] = [];

    const flush = (isOpenTurn: boolean): void => {
        if (!turnUserId) {
            result.push(...turnBody);
            turnBody = [];
            return;
        }
        const activities = turnBody.filter(
            (entry): entry is ConversationActivityEntry => entry.kind === "agentActivity",
        );
        const status: AgentTurnStatus =
            isOpenTurn && input.running
                ? "running"
                : turnFailed(activities)
                  ? "failed"
                  : "complete";
        const toolCallCount = activities.filter((entry) => entry.activity.kind === "tool").length;
        const trace: AgentTurnTraceSummary = {
            turnId: turnUserId,
            agentUserId: rigAgentAuthor.id,
            status,
            entryCount: activities.length,
            ...(toolCallCount > 0 ? { toolCallCount } : {}),
            latest: latestFromActivities(activities, turnStartedAt),
            subagents: [],
            backgroundTerminals: [],
        };
        for (const entry of turnBody) result.push(withAgentTrace(entry, trace));
        turnBody = [];
        turnUserId = undefined;
    };

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        if (entry.kind === "message" && entry.message.sender?.id === rigOwnerAuthor.id) {
            flush(false);
            turnUserId = entry.message.id;
            turnStartedAt = Date.parse(entry.message.createdAt) || index;
            result.push(entry);
            continue;
        }
        if (!turnUserId) {
            result.push(entry);
            continue;
        }
        turnBody.push(entry);
    }
    flush(true);
    return result;
}

/** Builds trace panel rows for one turn from the flat conversation entry list. */
export function rigTurnTraceDetails(
    entries: readonly ConversationEntry[],
    turnId: string,
): AgentTurnTraceDetails | undefined {
    let collecting = false;
    let baseTime = 0;
    const activities: ConversationActivityEntry[] = [];
    let trace: AgentTurnTraceSummary | undefined;

    for (const entry of entries) {
        if (entry.kind === "message" && entry.message.sender?.id === rigOwnerAuthor.id) {
            if (entry.message.id === turnId) {
                collecting = true;
                baseTime = Date.parse(entry.message.createdAt) || 0;
                continue;
            }
            if (collecting) break;
        }
        if (!collecting) continue;
        if (entry.kind === "agentActivity") activities.push(entry);
        if (entry.kind === "message" && entry.message.agentTrace?.turnId === turnId)
            trace = entry.message.agentTrace;
    }

    if (!trace) return undefined;
    const panelEntries = activities.map((activity, index) =>
        activityTraceEntry(activity, baseTime + index + 1),
    );
    return { ...trace, entries: panelEntries };
}
