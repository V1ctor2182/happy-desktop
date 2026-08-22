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

/** Projects one Happy Agent session into the shared conversation-list row. */
export function happyAgentConversationSummaryProject(
    session: HappyAgentConversationSummaryInput,
): ConversationSummary {
    const activity =
        session.unreadReason === "attention_needed"
            ? "awaitingInput"
            : session.status === "running" || session.status === "queued"
              ? session.wait === undefined
                  ? "running"
                  : "waiting"
              : "idle";
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
