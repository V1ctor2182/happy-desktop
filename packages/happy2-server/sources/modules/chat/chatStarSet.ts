import { CollaborationError, type MutationHint } from "./types.js";
import { type DrizzleExecutor, withTransaction } from "../drizzle.js";

import { and, eq, sql } from "drizzle-orm";
import { areaHint } from "./areaHint.js";

import { userChatPreferences } from "../schema.js";
import { chatGetAccess } from "./chatGetAccess.js";
import { syncEventInsert } from "../sync/syncEventInsert.js";
import { syncSequenceNext } from "../sync/syncSequenceNext.js";

/**
 * Adds or removes a star in the actor's userChatPreferences for an accessible chat.
 * The idempotent personal-state transition lets all devices reconcile the sidebar without duplicating stars during retries; sidebar position is the separate personal order `chatReorder` owns.
 */
export async function chatStarSet(
    executor: DrizzleExecutor,
    actorUserId: string,
    chatId: string,
    starred: boolean,
): Promise<{
    hint: MutationHint;
}> {
    return withTransaction(executor, async (tx) => {
        if (!(await chatGetAccess(tx, actorUserId, chatId, false)))
            throw new CollaborationError("not_found", "Chat was not found");
        const sequence = await syncSequenceNext(tx);
        await tx
            .insert(userChatPreferences)
            .values({
                userId: actorUserId,
                chatId,
                starred: starred ? 1 : 0,
                syncSequence: sequence,
            })
            .onConflictDoUpdate({
                target: [userChatPreferences.userId, userChatPreferences.chatId],
                set: {
                    starred: starred ? 1 : 0,
                    syncSequence: sequence,
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                },
            });
        await syncEventInsert(tx, {
            sequence,
            kind: "preferences.changed",
            entityId: chatId,
            actorUserId,
            targetUserId: actorUserId,
        });
        return {
            hint: areaHint(sequence, "preferences"),
        };
    });
}
