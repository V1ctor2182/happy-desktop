import { and, eq, isNull } from "drizzle-orm";

import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { type MutationHint } from "../chat/types.js";
import { agentTurnWorkSelection } from "./impl/agentTurnWorkSelection.js";
import { agentTurns, messages, users } from "../schema.js";
import { finishAgentTurn } from "./impl/finishAgentTurn.js";

const STOPPED_WITHOUT_TEXT = "Stopped.";

/**
 * Stops the chat's running agent turn on a reader's request and finishes it durably with whatever the agent had already streamed.
 * Releasing the lease inside the same transaction that publishes the reply is what makes the stop authoritative: the worker still
 * streaming this turn loses its next lease renewal and unwinds, so no second process can keep writing to a turn a person ended.
 * The turn is finished rather than deleted because its partial answer is already visible to everyone in the chat; queued turns for
 * the same chat stay pending, since stopping the current inference does not discard messages a person has already sent.
 */
export async function agentTurnAbort(
    executor: DrizzleExecutor,
    input: {
        agentUserId: string;
        chatId: string;
    },
): Promise<
    | {
          hint: MutationHint;
          runId?: string;
          sessionId: string;
          userMessageId: string;
      }
    | undefined
> {
    return withTransaction(executor, async (tx) => {
        const [turn] = await tx
            .select(agentTurnWorkSelection)
            .from(agentTurns)
            .innerJoin(messages, eq(messages.id, agentTurns.userMessageId))
            .innerJoin(users, eq(users.id, agentTurns.agentUserId))
            .where(
                and(
                    eq(agentTurns.chatId, input.chatId),
                    eq(agentTurns.agentUserId, input.agentUserId),
                    eq(agentTurns.status, "running"),
                    eq(users.kind, "agent"),
                    eq(users.active, 1),
                    isNull(users.deletedAt),
                ),
            )
            .limit(1);
        if (!turn?.actorUserId) return undefined;
        // The words already on screen are the partial reply streamed into the
        // assistant message, which outruns the turn's committed text. Keeping
        // that exact text is what makes a stop look like a pause rather than a
        // rewrite of what the reader just watched arrive.
        const [assistant] = await tx
            .select({ text: messages.text })
            .from(messages)
            .innerJoin(agentTurns, eq(agentTurns.assistantMessageId, messages.id))
            .where(
                and(
                    eq(agentTurns.userMessageId, turn.userMessageId),
                    eq(agentTurns.agentUserId, turn.agentUserId),
                ),
            )
            .limit(1);
        const finished = await finishAgentTurn(tx, {
            agentUserId: turn.agentUserId,
            actorUserId: turn.actorUserId,
            eventKind: "message.completed",
            sessionId: turn.sessionId,
            status: "complete",
            text: assistant?.text.trim() || turn.streamCommittedText.trim() || STOPPED_WITHOUT_TEXT,
            traceTitle: "Turn stopped",
            userMessageId: turn.userMessageId,
        });
        if (!finished) return undefined;
        return {
            hint: finished.hint,
            ...(turn.runId ? { runId: turn.runId } : {}),
            sessionId: turn.sessionId,
            userMessageId: turn.userMessageId,
        };
    });
}
