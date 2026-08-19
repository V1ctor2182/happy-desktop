import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import type { ConversationSummary } from "../conversation/conversationSummary.js";
import type { RigSessionSummary } from "./rigTypes.js";

/** Stable identity of the machine owner. */
export const rigOwnerAuthor: ConversationAuthor = {
    id: "rig:owner",
    displayName: "You",
    username: "you",
    kind: "human",
};

/** Stable identity of an agent-authored message projected into the human lane. */
export const rigInboundAuthor: ConversationAuthor = {
    id: "rig:inbound",
    displayName: "Agent",
    username: "agent",
    kind: "human",
};

/** Stable identity of the agent running the conversation. */
export const rigAgentAuthor: ConversationAuthor = {
    id: "rig:agent",
    displayName: "Happy",
    username: "happy",
    kind: "agent",
    agentRole: "default",
};

/** True for a person-authored turn, excluding agent news projected into that lane. */
export function rigHumanMessageAuthor(author: ConversationAuthor | undefined): boolean {
    return (
        author?.kind === "human" &&
        author.id !== rigInboundAuthor.id &&
        !author.id.startsWith(`${rigInboundAuthor.id}:`)
    );
}

export type RigConversationSummaryInput = Omit<RigSessionSummary, "projectId" | "worktreeId">;

function summaryTitle(session: RigConversationSummaryInput): string {
    if (session.title && session.title.trim().length > 0) return session.title;
    if (session.recap && session.recap.trim().length > 0) return session.recap;
    return `Session ${session.id.slice(0, 8)}`;
}

/** Projects one Happy Agent session into the shared conversation-list row. */
export function rigConversationSummaryProject(
    session: RigConversationSummaryInput,
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
        participants: [rigOwnerAuthor, rigAgentAuthor],
    };
}
