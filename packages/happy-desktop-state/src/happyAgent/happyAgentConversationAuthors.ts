import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import type { ConversationSummary } from "../conversation/conversationSummary.js";
import type { HappyAgentSessionSummary } from "./happyAgentTypes.js";

/** Stable identity of the machine owner. */
export const happyAgentOwnerAuthor: ConversationAuthor = {
    id: "happy-agent:owner",
    displayName: "You",
    username: "you",
    kind: "human",
};

/** Stable identity of an agent-authored message projected into the human lane. */
export const happyAgentInboundAuthor: ConversationAuthor = {
    id: "happy-agent:inbound",
    displayName: "Agent",
    username: "agent",
    kind: "human",
};

/** Stable identity of the agent running the conversation. */
export const agentAuthor: ConversationAuthor = {
    id: "happy-agent:agent",
    displayName: "Happy",
    username: "happy",
    kind: "agent",
    agentRole: "default",
};

/** True for a person-authored turn, excluding agent news projected into that lane. */
export function happyAgentHumanMessageAuthor(author: ConversationAuthor | undefined): boolean {
    return (
        author?.kind === "human" &&
        author.id !== happyAgentInboundAuthor.id &&
        !author.id.startsWith(`${happyAgentInboundAuthor.id}:`)
    );
}

export type HappyAgentConversationSummaryInput = Omit<
    HappyAgentSessionSummary,
    "projectId" | "worktreeId"
>;

function summaryTitle(session: HappyAgentConversationSummaryInput): string {
    if (session.title && session.title.trim().length > 0) return session.title;
    if (session.recap && session.recap.trim().length > 0) return session.recap;
    return `Session ${session.id.slice(0, 8)}`;
}

/**
 * How live one session reads in a list. A session is working when its own turn
 * is running and equally when it is only its delegated agents that still are:
 * work handed to a child is work this session set in motion, so the row keeps
 * its marker until nothing of the session's is running anywhere.
 *
 * A scheduled wait is the low-priority modifier it has always been, and it only
 * describes the session's own turn — a session sitting in a wait while its
 * children work is working, not waiting.
 */
function summaryActivity(
    session: HappyAgentConversationSummaryInput,
): ConversationSummary["activity"] {
    if (session.unreadReason === "attention_needed") return "awaitingInput";
    if (session.activeSubagentCount > 0) return "running";
    if (session.status !== "running" && session.status !== "queued") return "idle";
    return session.wait === undefined ? "running" : "waiting";
}

/** Projects one Happy Agent session into the shared conversation-list row. */
export function happyAgentConversationSummaryProject(
    session: HappyAgentConversationSummaryInput,
): ConversationSummary {
    const activity = summaryActivity(session);
    return {
        id: session.id,
        title: summaryTitle(session),
        subtitle: session.displayCwd || session.cwd,
        activity,
        updatedAt: session.lastMessageAt ?? session.updatedAt,
        ...(session.unreadReason === undefined ? {} : { unread: true }),
        participants: [happyAgentOwnerAuthor, agentAuthor],
    };
}
