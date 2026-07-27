import type { ConversationEntry } from "happy2-state";

type MessageEntry = Extract<ConversationEntry, { kind: "message" }>;

/** Preceding message row, skipping inline tool activity and settled status rows. */
function previousMessage(
    entries: readonly ConversationEntry[],
    index: number,
): MessageEntry | undefined {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const entry = entries[cursor];
        if (entry?.kind === "message") return entry;
        if (entry?.kind === "agentActivity" || entry?.kind === "turnStatus") continue;
        break;
    }
    return undefined;
}

function sameSender(left: MessageEntry, right: MessageEntry): boolean {
    const sender = left.message.sender?.id;
    const other = right.message.sender?.id;
    return sender !== undefined && sender === other;
}

/**
 * Whether this entry resumes prose directly under a run of tool rows. Those rows
 * are deliberately tight, so such a message stays grouped — no repeated avatar or
 * author — but needs the clearance a fresh block has, or the run reads as
 * belonging to the text below it instead of the text above. Roomier activity
 * (reasoning, shell runs) already carries that clearance itself.
 */
export function conversationEntryResumesAfterActivity(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    const previous = entries[index - 1];
    return (
        entries[index]?.kind === "message" &&
        previous?.kind === "agentActivity" &&
        previous.activity.kind === "tool"
    );
}

/** Whether this message continues the previous row's author group (cloud-style). */
export function conversationMessageGrouped(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    const entry = entries[index];
    if (entry?.kind !== "message") return false;
    if (entry.message.sender?.kind === "agent" && entries[index - 1]?.kind === "agentActivity")
        return true;
    const previous = previousMessage(entries, index);
    return previous !== undefined && sameSender(entry, previous);
}

/**
 * Whether this activity is the first agent-authored row after a user boundary.
 * It owns the identity header for a tool-first turn; later activity rows and the
 * final answer continue that same visual group.
 */
export function conversationAgentActivityStartsGroup(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    if (entries[index]?.kind !== "agentActivity") return false;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const entry = entries[cursor];
        if (!entry) break;
        if (entry.kind === "agentActivity") return false;
        if (entry.kind === "message") return entry.message.sender?.kind !== "agent";
        if (entry.kind === "notice") continue;
        break;
    }
    return true;
}

/** Whether this status follows activity already emitted in the same turn. */
export function conversationTurnStatusAfterActivity(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    if (entries[index]?.kind !== "turnStatus") return false;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const entry = entries[cursor];
        if (entry?.kind === "agentActivity") return true;
        if (entry?.kind === "turnStatus") return false;
        if (entry?.kind === "message" && entry.message.sender?.kind !== "agent") return false;
    }
    return false;
}
