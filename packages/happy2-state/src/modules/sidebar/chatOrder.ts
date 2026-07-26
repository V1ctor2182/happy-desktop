/** The fields the personal sidebar order is derived from. */
export interface ChatOrderPosition {
    readonly id: string;
    readonly orderKey?: string;
    readonly updatedAt: string;
}

/**
 * Compares two chats the way the server's chat listing does: by the user's
 * fractional order key, then by recency for chats they have never arranged.
 * Both sides must agree exactly, because a reorder mints its key against this
 * order and an optimistic client derives the same keys the server will store.
 */
export function chatOrderCompare(left: ChatOrderPosition, right: ChatOrderPosition): number {
    if (left.orderKey !== right.orderKey) {
        if (left.orderKey === undefined) return 1;
        if (right.orderKey === undefined) return -1;
        return left.orderKey < right.orderKey ? -1 : 1;
    }
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
