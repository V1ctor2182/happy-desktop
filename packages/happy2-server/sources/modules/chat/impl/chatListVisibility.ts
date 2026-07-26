import { type DrizzleExecutor } from "../../drizzle.js";
import { chatMembers, chats } from "../../schema.js";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Builds the shared predicate for chats that belong in one user's sidebar list.
 * Active membership is the only rule: the sidebar shows the conversations a
 * person is actually in, never one they merely could join, so there is no
 * read-only row to grey out. Discovering an unjoined channel is the directory's
 * job, and leaving removes the row outright.
 *
 * The caller must have left-joined `chatMembers` restricted to that user's
 * active membership, which is the join this predicate reads.
 */
export function chatListCondition() {
    return and(isNull(chats.deletedAt), sql`${chatMembers.userId} IS NOT NULL`);
}

/** Reports whether a chat's current durable state places it in one user's sidebar list. */
export async function chatAppearsInListDb(
    executor: DrizzleExecutor,
    userId: string,
    chatId: string,
): Promise<boolean> {
    const [row] = await executor
        .select({ id: chats.id })
        .from(chats)
        .leftJoin(
            chatMembers,
            and(
                eq(chatMembers.chatId, chats.id),
                eq(chatMembers.userId, userId),
                isNull(chatMembers.leftAt),
            ),
        )
        .where(and(eq(chats.id, chatId), chatListCondition()))
        .limit(1);
    return row !== undefined;
}
