import type {
    AgentTurnStatus,
    AgentTurnTraceEntrySummary,
    AgentTurnTraceKind,
    AgentTurnTraceLatest,
    AgentTurnTraceSummary,
} from "../types.js";
import {
    entrySequence,
    type ConversationActivityEntry,
    type ConversationEntry,
    type ConversationMessageEntry,
    type ConversationNoticeEntry,
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

/** The section's final message, the one line a collapsed section keeps on screen. */
function lastMessage(body: readonly ConversationEntry[]): ConversationMessageEntry | undefined {
    for (let index = body.length - 1; index >= 0; index -= 1) {
        const entry = body[index]!;
        if (entry.kind === "message") return entry;
    }
    return undefined;
}

/**
 * Stable authored result for a turn that performed work without emitting text.
 * It remains empty in product state; Message owns the faint “(no text)”
 * presentation so copying and persistence never fabricate assistant prose.
 */
function emptyAgentMessage(
    sectionId: string,
    anchor: ConversationMessageEntry,
    body: readonly ConversationEntry[],
    sequence: string,
): ConversationMessageEntry {
    let occurredAt: number | undefined;
    for (let index = body.length - 1; index >= 0; index -= 1) {
        const entry = body[index];
        if (entry?.kind === "agentActivity" && entry.occurredAt !== undefined) {
            occurredAt = entry.occurredAt;
            break;
        }
    }
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id: `${sectionId}:empty-agent-text`,
            chatId: anchor.message.chatId,
            sequence,
            changePts: sequence,
            sender: rigAgentAuthor,
            kind: "automated",
            automated: false,
            audience: "people",
            agentUserIds: [],
            text: "",
            generationStatus: "complete",
            revision: 0,
            mentions: [],
            attachments: [],
            reactions: [],
            receipts: [],
            expiryMode: "none",
            createdAt:
                occurredAt === undefined
                    ? anchor.message.createdAt
                    : new Date(occurredAt).toISOString(),
        },
    };
}

/** Attaches the turn summary that turns an agent message meta row into "View trace". */
function withAgentTrace(entry: ConversationEntry, trace: AgentTurnTraceSummary): ConversationEntry {
    if (entry.kind !== "message" || entry.message.sender?.kind !== "agent") return entry;
    return { ...entry, message: { ...entry.message, agentTrace: trace } };
}

/**
 * Splits a daemon run into the visual sections introduced by steering messages,
 * summarizes each section, and decides how much of it is visible. A running or
 * expanded section lists its original rows in order. A collapsed section keeps
 * its last text response, or a faint empty result when it performed tools
 * without producing prose.
 *
 * The section identity is the user message that opened it. This deliberately
 * differs from Rig's run-level turn ID: several steering sections may belong to
 * one daemon turn while remaining separate reader-visible transcript sections.
 */
export function rigConversationAttachTurnTraces(
    entries: readonly ConversationEntry[],
    input: {
        readonly activeTurnId?: string;
        readonly expandedTurnIds: ReadonlySet<string>;
        /** User messages submitted into an already running turn. */
        readonly steeringMessageIds?: ReadonlySet<string>;
        /** Final duration keyed by the user message that opened the section. */
        readonly durations?: ReadonlyMap<string, number>;
    },
): readonly ConversationEntry[] {
    return attachSectionTraces(entries, input);
}

type TurnTraceInput = Parameters<typeof rigConversationAttachTurnTraces>[1];

/** Projects the daemon run into visual sections separated by steering messages. */
function attachSectionTraces(
    entries: readonly ConversationEntry[],
    input: TurnTraceInput,
): readonly ConversationEntry[] {
    const result: ConversationEntry[] = [];
    let turnUserId: string | undefined;
    let turnUserMessage: ConversationMessageEntry | undefined;
    let turnBody: ConversationEntry[] = [];

    const flush = (isOpenTurn: boolean, end: "settled" | "steered" = "settled"): void => {
        if (!turnUserId) {
            result.push(...turnBody);
            turnBody = [];
            turnUserMessage = undefined;
            return;
        }
        const activities = turnBody.filter(
            (entry): entry is ConversationActivityEntry => entry.kind === "agentActivity",
        );
        const running = isOpenTurn && input.activeTurnId === turnUserId;
        const expanded = running || input.expandedTurnIds.has(turnUserId);
        const durableFinalMessage = lastMessage(turnBody);
        const firstErrorIndex = turnBody.findIndex(
            (entry) => entry.kind === "notice" && entry.level === "error",
        );
        const summaryAnchor =
            turnBody[firstErrorIndex > 0 ? firstErrorIndex - 1 : Math.max(0, turnBody.length - 1)];
        const summarySequence = `${summaryAnchor ? entrySequence(summaryAnchor) : turnUserId}:0-summary`;
        const collapsedEmptyMessage =
            !expanded &&
            durableFinalMessage === undefined &&
            activities.length > 0 &&
            turnUserMessage !== undefined
                ? emptyAgentMessage(turnUserId, turnUserMessage, turnBody, summarySequence)
                : undefined;
        const finalMessage = durableFinalMessage ?? collapsedEmptyMessage;
        const projectedBody =
            collapsedEmptyMessage === undefined
                ? turnBody
                : firstErrorIndex >= 0
                  ? [
                        ...turnBody.slice(0, firstErrorIndex),
                        collapsedEmptyMessage,
                        ...turnBody.slice(firstErrorIndex),
                    ]
                  : [...turnBody, collapsedEmptyMessage];
        const failed =
            durableFinalMessage?.message.generationStatus === "failed" ||
            turnBody.some((entry) => entry.kind === "notice" && entry.level === "error");
        // A finished turn is complete whenever it produced a final reply. A tool
        // that failed mid-turn is ordinary agent recovery, not a failed turn —
        // only the run's own terminal outcome marks the final assistant message
        // and therefore the turn as failed.
        const status: AgentTurnStatus = running ? "running" : failed ? "failed" : "complete";
        // A shell run is a tool the agent used, so it counts as one. The reader
        // is being told how much work the turn took, not which internal shape
        // the daemon happened to deliver each step in.
        const toolCallCount = activities.filter(
            (entry) => entry.activity.kind === "tool" || entry.activity.kind === "shell",
        ).length;
        const durationMs = !running ? input.durations?.get(turnUserId) : undefined;
        const trace: AgentTurnTraceSummary = {
            turnId: turnUserId,
            agentUserId: rigAgentAuthor.id,
            status,
            entryCount: activities.length,
            ...(toolCallCount > 0 ? { toolCallCount } : {}),
            latest: latestFromActivities(activities, 0),
            subagents: [],
            backgroundTerminals: [],
        };
        // A turn with nothing behind its answer has no trace to reveal, so it
        // keeps a plain message with no control.
        const summarizable =
            finalMessage !== undefined && (turnBody.length > 1 || activities.length > 0);
        const collapsed = summarizable && !expanded ? finalMessage : undefined;
        // Collapsing hides the turn's work, but not what went wrong doing it: a
        // failure or a retry is the reason the answer looks the way it does, and
        // burying it behind a control the reader has no reason to open would
        // leave a broken run reading as a successful one. Warning and error
        // notices therefore stay on screen in turn order alongside the answer.
        const persistentNotices = turnBody.filter(
            (entry): entry is ConversationNoticeEntry =>
                entry.kind === "notice" && entry.level !== "info",
        );
        const shown = collapsed
            ? [
                  ...persistentNotices.filter((entry) => entry.level !== "error"),
                  collapsed,
                  // The terminal error explains the settled turn, so it stays
                  // directly above that turn's neutral completion footer.
                  ...persistentNotices.filter((entry) => entry.level === "error"),
              ]
            : expanded
              ? turnBody
              : projectedBody;
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
        // A settled section keeps one permanent status row. A tool-only section
        // has no copy payload, but it still completed real work and therefore
        // keeps the same footer beneath its collapsed empty result. Running
        // sections use the message-list footer so their clock can tick.
        if (!running && (durableFinalMessage !== undefined || activities.length > 0)) {
            // Ordered from the end of the whole turn, not the end of what is
            // currently shown: entries sort by sequence, so anchoring it to a
            // collapsed turn's single message would drop the row in among the
            // work as soon as the reader expanded the trace.
            const last = turnBody[turnBody.length - 1];
            const lastSequence = last ? entrySequence(last) : turnUserId;
            result.push({
                kind: "turnStatus",
                id: `turn-status:${turnUserId}`,
                sequence: `${lastSequence}:status`,
                status: end === "steered" ? "steered" : failed ? "failed" : "complete",
                ...(end === "steered" ||
                !durableFinalMessage ||
                durableFinalMessage.message.text.trim().length === 0
                    ? {}
                    : { copyText: durableFinalMessage.message.text }),
                ...(durationMs !== undefined ? { durationMs } : {}),
                ...(toolCallCount > 0 ? { tools: toolCallCount } : {}),
            });
        }
        turnBody = [];
        turnUserId = undefined;
        turnUserMessage = undefined;
    };

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        if (entry.kind === "message" && entry.message.sender?.id === rigOwnerAuthor.id) {
            flush(false, input.steeringMessageIds?.has(entry.message.id) ? "steered" : "settled");
            turnUserId = entry.message.id;
            turnUserMessage = entry;
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
