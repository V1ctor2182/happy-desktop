import type { ConversationEntry } from "happy2-state";

type MessageEntry = Extract<ConversationEntry, { kind: "message" }>;

/** Nearest message row, skipping inline tool activity between agent text blocks. */
function neighborMessage(
    entries: readonly ConversationEntry[],
    index: number,
    step: -1 | 1,
): MessageEntry | undefined {
    for (
        let cursor = index + step;
        step === -1 ? cursor >= 0 : cursor < entries.length;
        cursor += step
    ) {
        const entry = entries[cursor];
        if (entry?.kind === "message") return entry;
        if (entry?.kind === "agentActivity") continue;
        break;
    }
    return undefined;
}

function sameSender(left: MessageEntry, right: MessageEntry): boolean {
    const sender = left.message.sender?.id;
    const other = right.message.sender?.id;
    return sender !== undefined && sender === other;
}

/** Whether this message continues the previous row's author group (cloud-style). */
export function conversationMessageGrouped(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    const entry = entries[index];
    if (entry?.kind !== "message") return false;
    const previous = neighborMessage(entries, index, -1);
    return previous !== undefined && sameSender(entry, previous);
}

/** Another message from the same author follows (ignoring tool rows in between). */
export function conversationMessageGroupContinues(
    entries: readonly ConversationEntry[],
    index: number,
): boolean {
    const entry = entries[index];
    if (entry?.kind !== "message") return false;
    const next = neighborMessage(entries, index, 1);
    return next !== undefined && sameSender(entry, next);
}
