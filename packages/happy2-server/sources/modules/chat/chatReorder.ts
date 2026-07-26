import { CollaborationError, type MutationHint } from "./types.js";
import { type DrizzleExecutor, withTransaction } from "../drizzle.js";

import { sql } from "drizzle-orm";
import { areaHint } from "./areaHint.js";

import { chatList } from "./chatList.js";
import { orderKeyAfter } from "./utils/orderKeyAfter.js";
import { orderKeySequence } from "./utils/orderKeySequence.js";
import { userChatPreferences } from "../schema.js";
import { syncEventInsert } from "../sync/syncEventInsert.js";
import { syncSequenceNext } from "../sync/syncSequenceNext.js";

/**
 * Moves one chat directly after another in the actor's personal sidebar order by minting a single fractional index in userChatPreferences.
 *
 * A move is stated as a row and the row it now follows rather than as a restated
 * arrangement, so two devices dragging different chats both land instead of one
 * overwriting the other. The first move materializes the order: every chat the
 * actor can currently see is stamped with a key in its existing display order,
 * because a fractional index is only meaningful against neighbours that have one.
 * That normalization is deterministic from the same list, so a client can mint
 * the identical keys optimistically and the dropped row does not jump when the
 * reconcile answers. The whole rewrite shares one sync sequence so no device
 * assembles a half-old sidebar.
 */
export async function chatReorder(
    executor: DrizzleExecutor,
    actorUserId: string,
    chatId: string,
    afterChatId: string | undefined,
): Promise<{
    hint: MutationHint;
}> {
    if (afterChatId === chatId)
        throw new CollaborationError("invalid", "A chat cannot be placed after itself");
    return withTransaction(executor, async (tx) => {
        const visible = await chatList(tx, actorUserId);
        if (!visible.some((chat) => chat.id === chatId))
            throw new CollaborationError("not_found", "Chat was not found");
        if (afterChatId !== undefined && !visible.some((chat) => chat.id === afterChatId))
            throw new CollaborationError("not_found", "The preceding chat was not found");
        const sequence = await syncSequenceNext(tx);
        const materialized = visible.some((chat) => chat.orderKey === undefined)
            ? (() => {
                  const keys = orderKeySequence(visible.length);
                  return visible.map((chat, index) => ({ id: chat.id, orderKey: keys[index]! }));
              })()
            : visible.map((chat) => ({ id: chat.id, orderKey: chat.orderKey! }));
        const moved = orderKeyAfter(materialized, chatId, afterChatId ?? null);
        const written = new Map(materialized.map((item) => [item.id, item.orderKey]));
        written.set(chatId, moved);
        for (const [id, orderKey] of written) {
            const previous = visible.find((chat) => chat.id === id)?.orderKey;
            if (previous === orderKey) continue;
            await tx
                .insert(userChatPreferences)
                .values({
                    userId: actorUserId,
                    chatId: id,
                    orderKey,
                    syncSequence: sequence,
                })
                .onConflictDoUpdate({
                    target: [userChatPreferences.userId, userChatPreferences.chatId],
                    set: {
                        orderKey,
                        syncSequence: sequence,
                        updatedAt: sql`CURRENT_TIMESTAMP`,
                    },
                });
        }
        await syncEventInsert(tx, {
            sequence,
            kind: "preferences.reordered",
            entityId: chatId,
            actorUserId,
            targetUserId: actorUserId,
        });
        return {
            hint: areaHint(sequence, "preferences"),
        };
    });
}
