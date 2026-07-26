import { CollaborationError, type MessageSummary } from "../chat/types.js";
import { type DrizzleExecutor } from "../drizzle.js";

import { and, asc, desc, eq, gt, gte, lt, type SQL } from "drizzle-orm";

import { messages } from "../schema.js";
import { chatGetAccess } from "../chat/chatGetAccess.js";
import { messageGetProjection } from "./messageGetProjection.js";
/**
 * Pages messages in an accessible chat before or after a sequence, returning chronological projections and the current chat point.
 * A newest-first page expands its oldest edge back to the user message that owns an assistant turn, so consumers never receive or render half a turn.
 */
export async function messageList(
    executor: DrizzleExecutor,
    input: {
        userId: string;
        chatId: string;
        beforeSequence?: number;
        afterSequence?: number;
        limit: number;
    },
): Promise<{
    messages: MessageSummary[];
    chatPts: string;
    hasMore: boolean;
}> {
    const chat = await chatGetAccess(executor, input.userId, input.chatId, false);
    if (!chat) throw new CollaborationError("not_found", "Chat was not found");
    const conditions: SQL[] = [eq(messages.chatId, input.chatId)];
    if (input.beforeSequence !== undefined) {
        conditions.push(lt(messages.sequence, input.beforeSequence));
    }
    if (input.afterSequence !== undefined) {
        conditions.push(gt(messages.sequence, input.afterSequence));
    }
    const ascending = input.afterSequence !== undefined;
    const result = await executor
        .select({
            id: messages.id,
        })
        .from(messages)
        .where(and(...conditions))
        .orderBy(ascending ? asc(messages.sequence) : desc(messages.sequence))
        .limit(input.limit + 1);
    let ids = result.slice(0, input.limit).map((row) => row.id);
    let summaries: MessageSummary[] = [];
    for (const id of ids) {
        const message = await messageGetProjection(executor, input.userId, id);
        if (message) summaries.push(message);
    }
    let hasMore = result.length > input.limit;
    if (!ascending) {
        summaries.reverse();
        const oldest = summaries[0];
        const turnId = oldest?.agentTrace?.turnId;
        if (turnId && turnId !== oldest.id) {
            const turnStart = await messageGetProjection(executor, input.userId, turnId);
            if (turnStart && turnStart.chatId === input.chatId) {
                const turnSequence = Number(turnStart.sequence);
                const rangeConditions: SQL[] = [
                    eq(messages.chatId, input.chatId),
                    gte(messages.sequence, turnSequence),
                ];
                if (input.beforeSequence !== undefined)
                    rangeConditions.push(lt(messages.sequence, input.beforeSequence));
                const completeTurnRange = await executor
                    .select({ id: messages.id })
                    .from(messages)
                    .where(and(...rangeConditions))
                    .orderBy(asc(messages.sequence));
                ids = completeTurnRange.map((row) => row.id);
                summaries = [];
                for (const id of ids) {
                    const message = await messageGetProjection(executor, input.userId, id);
                    if (message) summaries.push(message);
                }
            }
        }
        const oldestSequence = summaries[0]?.sequence;
        if (oldestSequence !== undefined) {
            const older = await executor
                .select({ id: messages.id })
                .from(messages)
                .where(
                    and(
                        eq(messages.chatId, input.chatId),
                        lt(messages.sequence, Number(oldestSequence)),
                    ),
                )
                .limit(1);
            hasMore = older.length > 0;
        }
    }
    return {
        messages: summaries,
        chatPts: chat.pts,
        hasMore,
    };
}
