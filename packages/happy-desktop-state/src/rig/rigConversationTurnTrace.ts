import type {
    AgentTurnStatus,
    AgentTurnTraceEntrySummary,
    AgentTurnTraceLatest,
    AgentTurnTraceSummary,
} from "../types.js";
import {
    entrySequence,
    noticeFailed,
    noticeInformational,
    type ConversationActivityEntry,
    type ConversationDelegationEntry,
    type ConversationEntry,
    type ConversationMessageEntry,
} from "../conversation/conversationEntry.js";
import { rigAgentAuthor, rigHumanMessageAuthor } from "./rigConversationProject.js";

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
 * Attaches the turn summary that turns a row's meta line into "View traces".
 *
 * An agent message and an agent activity row both qualify, because the row the
 * control belongs on depends on how much of the turn is showing: a collapsed
 * turn is one answer, while an expanded one begins with whatever the agent did
 * first — often a tool call, and sometimes nothing else at all.
 */
function withAgentTrace(entry: ConversationEntry, trace: AgentTurnTraceSummary): ConversationEntry {
    if (entry.kind === "agentActivity") return { ...entry, agentTrace: trace };
    if (entry.kind === "delegation") return { ...entry, agentTrace: trace };
    if (entry.kind !== "message" || entry.message.sender?.kind !== "agent") return entry;
    return { ...entry, message: { ...entry.message, agentTrace: trace } };
}

/**
 * Splits a daemon run into the visual sections introduced by steering messages,
 * summarizes each section, and decides how much of it is visible. A running or
 * expanded section lists its original rows in order. A collapsed section keeps
 * its last text response, a persistent delegation, or one real activity row
 * when it performed tools without producing prose.
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
    let turnBody: ConversationEntry[] = [];

    const flush = (isOpenTurn: boolean, end: "settled" | "steered" = "settled"): void => {
        if (!turnUserId) {
            result.push(...turnBody);
            turnBody = [];
            return;
        }
        const activities = turnBody.filter(
            (entry): entry is ConversationActivityEntry => entry.kind === "agentActivity",
        );
        const delegations = turnBody.filter(
            (entry): entry is ConversationDelegationEntry => entry.kind === "delegation",
        );
        const running = isOpenTurn && input.activeTurnId === turnUserId;
        const expanded = running || input.expandedTurnIds.has(turnUserId);
        const durableFinalMessage = lastMessage(turnBody);
        const firstDelegation = delegations[0];
        const collapsedActivity =
            !expanded && durableFinalMessage === undefined && firstDelegation === undefined
                ? activities[activities.length - 1]
                : undefined;
        const collapsedAnchor = durableFinalMessage ?? firstDelegation ?? collapsedActivity;
        const failed =
            durableFinalMessage?.message.generationStatus === "failed" ||
            turnBody.some((entry) => entry.kind === "notice" && noticeFailed(entry));
        // A finished turn is complete whenever it produced a final reply. A tool
        // that failed mid-turn is ordinary agent recovery, not a failed turn —
        // only the run's own terminal outcome marks the final assistant message
        // and therefore the turn as failed.
        const status: AgentTurnStatus = running ? "running" : failed ? "failed" : "complete";
        // A shell run is a tool the agent used, so it counts as one. The reader
        // is being told how much work the turn took, not which internal shape
        // the daemon happened to deliver each step in.
        const toolCallCount =
            activities.filter(
                (entry) => entry.activity.kind === "tool" || entry.activity.kind === "shell",
            ).length + delegations.length;
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
        // keeps a plain message with no control. The work itself is what can be
        // revealed, so a turn that produced no text still offers the control on
        // the row its work starts on.
        const summarizable = activities.length > 0;
        const collapsed = summarizable && !expanded;
        // Collapsing hides the turn's work, but not what went wrong doing it: a
        // failure or a retry is the reason the answer looks the way it does, and
        // burying it behind a control the reader has no reason to open would
        // leave a broken run reading as a successful one. Warning and error
        // notices therefore stay on screen in turn order alongside the answer.
        const shown = collapsed
            ? turnBody.filter(
                  (entry) =>
                      entry.kind === "delegation" ||
                      entry === collapsedAnchor ||
                      (entry.kind === "notice" && !noticeInformational(entry)),
              )
            : expanded
              ? turnBody
              : turnBody;
        /*
         * Collapsed, a final answer owns the control just as it does in the
         * modern projector; a no-answer turn falls back to its first persistent
         * delegation. Expanded, the first agent-owned row carries it.
         */
        let traced = !summarizable;
        for (const entry of shown) {
            if (traced) {
                result.push(entry);
                continue;
            }
            if (collapsed && collapsedAnchor !== undefined && entry !== collapsedAnchor) {
                result.push(entry);
                continue;
            }
            const withTrace = withAgentTrace(entry, trace);
            traced = withTrace !== entry;
            result.push(withTrace);
        }
        // A settled section keeps one permanent status row. A tool-only section
        // has no copy payload, but it still completed real work and therefore
        // keeps the same footer beneath its retained activity. Running sections
        // use the message-list footer so their clock can tick.
        if (
            !running &&
            (durableFinalMessage !== undefined || activities.length > 0 || delegations.length > 0)
        ) {
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
    };

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        if (entry.kind === "message" && rigHumanMessageAuthor(entry.message.sender)) {
            flush(false, input.steeringMessageIds?.has(entry.message.id) ? "steered" : "settled");
            turnUserId = entry.message.id;
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
