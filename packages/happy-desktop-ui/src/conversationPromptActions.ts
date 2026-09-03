import type { ConversationEntry } from "happy-desktop-state";

/**
 * Whether a transcript entry can be edited inline and resent by this reader.
 *
 * Historical attachments are durable projections, while a composer attachment
 * owns a live browser File. Until that bridge exists, only a settled text-only
 * prompt is representable without inventing bytes or silently dropping context.
 */
export function conversationPromptCanEditAndResend(
    entry: ConversationEntry,
    viewerId: string | undefined,
): boolean {
    if (entry.kind !== "message") return false;
    const message = entry.message;
    return (
        entry.delivery === "sent" &&
        message.sender?.kind === "human" &&
        message.sender.id === viewerId &&
        message.text.trim().length > 0 &&
        message.attachments.length === 0
    );
}
