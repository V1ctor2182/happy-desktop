import { and, eq, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { type MutationHint } from "../chat/types.js";
import { agentTurns, messages, users } from "../schema.js";
import { chatAdvanceWithSequence } from "../chat/chatAdvanceWithSequence.js";
import { chatHint } from "../chat/chatHint.js";
import { syncSequenceNext } from "../sync/syncSequenceNext.js";

const MAX_STEERING_PREVIEW_CHARACTERS = 2_000;

/**
 * Inserts the messages notice that a steering message reached the running agent, at the point in the transcript where it landed, and links it to its agentTurns row.
 * The steering message itself stays where it was sent so nothing a reader is looking at moves; this separate notice is what
 * answers "when did the agent actually take it", carrying the message's id, sender, and text so it reads on its own and can
 * later link back to the original. The steered turn's `assistantMessageId` is the claim: it is the one output that turn will
 * ever have, so filling it exactly once is what keeps a repeated Rig event from announcing the same steering twice.
 */
export async function agentTurnSteeringApply(
    executor: DrizzleExecutor,
    input: {
        agentUserId: string;
        steeringUserMessageId: string;
    },
): Promise<{ hint: MutationHint } | undefined> {
    return withTransaction(executor, async (tx) => {
        const [turn] = await tx
            .select({ chatId: agentTurns.chatId })
            .from(agentTurns)
            .where(
                and(
                    eq(agentTurns.userMessageId, input.steeringUserMessageId),
                    eq(agentTurns.agentUserId, input.agentUserId),
                    eq(agentTurns.status, "steered"),
                    isNull(agentTurns.assistantMessageId),
                ),
            )
            .limit(1);
        if (!turn) return undefined;
        const [steering] = await tx
            .select({
                senderUserId: messages.senderUserId,
                text: messages.text,
                username: users.username,
            })
            .from(messages)
            .innerJoin(users, eq(users.id, messages.senderUserId))
            .where(eq(messages.id, input.steeringUserMessageId))
            .limit(1);
        if (!steering?.senderUserId) return undefined;
        const [agent] = await tx
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, input.agentUserId))
            .limit(1);
        const preview = steering.text.slice(0, MAX_STEERING_PREVIEW_CHARACTERS);
        const messageId = createId();
        const sequence = await syncSequenceNext(tx);
        const mutation = await chatAdvanceWithSequence(
            tx,
            sequence,
            input.agentUserId,
            turn.chatId,
            "message.serviceCreated",
            messageId,
            undefined,
            true,
        );
        if (mutation.messageSequence === undefined)
            throw new Error("Steering notice sequence was not allocated");
        await tx.insert(messages).values({
            id: messageId,
            chatId: turn.chatId,
            sequence: mutation.messageSequence,
            changePts: mutation.pts,
            senderUserId: input.agentUserId,
            kind: "automated",
            text: `@${steering.username ?? "someone"} steered @${agent?.username ?? "the agent"}`,
            contentJson: JSON.stringify({
                service: {
                    type: "agent_steered",
                    messageId: input.steeringUserMessageId,
                    userId: steering.senderUserId,
                    text: preview,
                },
            }),
            publishedAt: sql`CURRENT_TIMESTAMP`,
        });
        const claimed = await tx
            .update(agentTurns)
            .set({
                assistantMessageId: messageId,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(
                and(
                    eq(agentTurns.userMessageId, input.steeringUserMessageId),
                    eq(agentTurns.agentUserId, input.agentUserId),
                    eq(agentTurns.status, "steered"),
                    isNull(agentTurns.assistantMessageId),
                ),
            )
            .returning({ id: agentTurns.userMessageId });
        if (claimed.length !== 1) throw new Error("Steering notice could not be linked");
        return { hint: chatHint(sequence, turn.chatId, mutation.pts) };
    });
}
