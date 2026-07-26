import { type DrizzleExecutor } from "../../drizzle.js";
import { userChatPreferences } from "../../schema.js";
import { and, eq, isNotNull, sql } from "drizzle-orm";

/**
 * Drops one user's personal sidebar position for a chat they are no longer in.
 * A departed chat leaves the sidebar entirely, so keeping its key would silently
 * restore a stale slot on rejoin; the chat then arrives at the end like any
 * newly joined one. Other preferences on the row (star, notifications) survive.
 */
export async function chatOrderKeyClearDb(
    executor: DrizzleExecutor,
    userId: string,
    chatId: string,
    sequence: number,
): Promise<void> {
    await executor
        .update(userChatPreferences)
        .set({
            orderKey: null,
            syncSequence: sequence,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
            and(
                eq(userChatPreferences.userId, userId),
                eq(userChatPreferences.chatId, chatId),
                isNotNull(userChatPreferences.orderKey),
            ),
        );
}
