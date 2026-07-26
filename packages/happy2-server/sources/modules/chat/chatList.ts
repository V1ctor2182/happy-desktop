import { type ChatSummary } from "./types.js";
import { type DrizzleExecutor } from "../drizzle.js";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { asChat } from "./impl/asChat.js";

import { chatMembers, chats, userChatPreferences } from "../schema.js";
import { chatSelection } from "./impl/chatSelection.js";
import { chatListCondition } from "./impl/chatListVisibility.js";

/**
 * Lists the live chats one user is an active member of, in that user's personal fractional order, falling back to recency for chats they have never arranged.
 * Joining user preferences into the projection gives every device of that user one deterministic sidebar order, and `chatReorder` mints keys against exactly this order.
 */
export async function chatList(executor: DrizzleExecutor, userId: string): Promise<ChatSummary[]> {
    const rows = await executor
        .select(chatSelection)
        .from(chats)
        .leftJoin(
            chatMembers,
            and(
                eq(chatMembers.chatId, chats.id),
                eq(chatMembers.userId, userId),
                isNull(chatMembers.leftAt),
            ),
        )
        .leftJoin(
            userChatPreferences,
            and(eq(userChatPreferences.chatId, chats.id), eq(userChatPreferences.userId, userId)),
        )
        .where(chatListCondition())
        .orderBy(
            // A user either has arranged their sidebar or has not: the first
            // reorder mints a key for every row they can see. The null-last
            // term only decides the order during that one transition.
            asc(sql`case when ${userChatPreferences.orderKey} is null then 1 else 0 end`),
            asc(userChatPreferences.orderKey),
            desc(chats.updatedAt),
            asc(chats.id),
        );
    const projected = rows.map(asChat);
    const archivedById = new Map(projected.map((chat) => [chat.id, chat.archivedAt]));
    return projected.map((chat) => ({
        ...chat,
        archivedAt:
            chat.archivedAt ??
            (chat.parentChatId ? archivedById.get(chat.parentChatId) : undefined),
    }));
}
