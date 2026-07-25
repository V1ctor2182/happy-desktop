import type {
    AgentTurnStatus,
    AgentTurnTraceEntrySummary,
    AgentTurnTraceKind,
    AgentTurnTraceLatest,
    AgentTurnTraceSummary,
} from "../types.js";
import type {
    ConversationActivityEntry,
    ConversationEntry,
} from "../conversation/conversationEntry.js";
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
        const failed = !activity.running && (activity.timedOut || (activity.exitCode ?? 0) !== 0);
        return {
            id: entry.id,
            kind: "terminal",
            title: activity.running ? "Running" : "Ran",
            detail: activity.command,
            status: activity.running ? "running" : failed ? "failed" : "complete",
            occurredAt,
        };
    }
    if (activity.kind === "labeled")
        return {
            id: entry.id,
            kind: "tool",
            title: activity.label,
            ...(activity.subject ? { detail: activity.subject } : {}),
            status:
                activity.status === "running"
                    ? "running"
                    : activity.status === "failed"
                      ? "failed"
                      : "complete",
            occurredAt,
        };
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
        if (activity.kind === "tool")
            return activity.tool.failed || activity.tool.status === "failed";
        if (activity.kind === "shell")
            return !activity.running && (activity.timedOut || (activity.exitCode ?? 0) !== 0);
        return false;
    });
}

/** The turn's final message, the one line a collapsed turn keeps on screen. */
function lastMessage(body: readonly ConversationEntry[]): ConversationEntry | undefined {
    for (let index = body.length - 1; index >= 0; index -= 1) {
        const entry = body[index]!;
        if (entry.kind === "message") return entry;
    }
    return undefined;
}

/** Attaches the turn summary that turns an agent message meta row into "View trace". */
function withAgentTrace(entry: ConversationEntry, trace: AgentTurnTraceSummary): ConversationEntry {
    if (entry.kind !== "message" || entry.message.sender?.kind !== "agent") return entry;
    return { ...entry, message: { ...entry.message, agentTrace: trace } };
}

/**
 * Splits the conversation into turns, summarizes each one, and decides how much
 * of it the transcript shows. A running turn lists its whole body so live output
 * is visible. A finished turn collapses to its final message until the reader
 * opens its "View trace" control, and expanding puts the intermediate messages
 * and tool rows back as ordinary sibling entries — the list stays flat, so a
 * long turn still virtualizes one block at a time. Exactly one agent message per
 * turn — the first one shown — carries the summary, so the control appears once.
 */
export function rigConversationAttachTurnTraces(
    entries: readonly ConversationEntry[],
    input: { readonly running: boolean; readonly expandedTurnIds: ReadonlySet<string> },
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
        const running = isOpenTurn && input.running;
        const status: AgentTurnStatus = running
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
        // A turn with nothing behind its answer has no trace to reveal, so it
        // keeps a plain message with no control.
        const summarizable = turnBody.length > 1;
        const expanded = running || input.expandedTurnIds.has(turnUserId);
        const collapsed = summarizable && !expanded ? lastMessage(turnBody) : undefined;
        const shown = collapsed ? [collapsed] : turnBody;
        let traced = !summarizable;
        for (const entry of shown) {
            if (traced) {
                result.push(entry);
                continue;
            }
            const withTrace = withAgentTrace(entry, trace);
            traced = withTrace !== entry;
            result.push(withTrace);
        }
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
