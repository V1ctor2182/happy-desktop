import { and, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";

import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { agentTurns, messages, users } from "../schema.js";

const STEERING_LEASE_MS = 30_000;

export interface AgentSteerableTurn {
    agentUserId: string;
    chatId: string;
    runId: string;
    sessionId: string;
    /** The message being delivered into the run, and the turn row it replaces. */
    steeringUserMessageId: string;
    text: string;
}

/**
 * Claims the agentTurns rows that should be folded into an agent's run already in flight instead of waiting behind it.
 * A queued turn is steerable only when the same agent is running a turn in the same session whose run identifier is
 * known and whose prompt came earlier, so a message can never be injected into a run that predates it or into a run
 * nobody has attached yet. Claiming moves each row to `steering` under this worker's lease, which keeps two servers
 * from delivering one message twice while leaving an expired claim recoverable; a claim that is never confirmed
 * returns to `pending` and runs as its own turn, so no message is lost when Rig refuses the steer.
 */
export async function agentTurnClaimSteerable(
    executor: DrizzleExecutor,
    input: {
        chatId: string;
        workerId: string;
    },
): Promise<AgentSteerableTurn[]> {
    return withTransaction(executor, async (tx) => {
        const now = Date.now();
        const [running] = await tx
            .select({
                agentUserId: agentTurns.agentUserId,
                runId: agentTurns.runId,
                sequence: messages.sequence,
                sessionId: agentTurns.sessionId,
            })
            .from(agentTurns)
            .innerJoin(messages, eq(messages.id, agentTurns.userMessageId))
            .innerJoin(users, eq(users.id, agentTurns.agentUserId))
            .where(
                and(
                    eq(agentTurns.chatId, input.chatId),
                    eq(agentTurns.status, "running"),
                    isNotNull(agentTurns.runId),
                    eq(users.active, 1),
                ),
            )
            .limit(1);
        if (!running?.runId) return [];
        const candidates = await tx
            .select({
                sequence: messages.sequence,
                text: agentTurns.prompt,
                userMessageId: agentTurns.userMessageId,
            })
            .from(agentTurns)
            .innerJoin(messages, eq(messages.id, agentTurns.userMessageId))
            .where(
                and(
                    eq(agentTurns.chatId, input.chatId),
                    eq(agentTurns.agentUserId, running.agentUserId),
                    eq(agentTurns.sessionId, running.sessionId),
                    gt(messages.sequence, running.sequence),
                    or(
                        eq(agentTurns.status, "pending"),
                        and(
                            eq(agentTurns.status, "steering"),
                            or(
                                eq(agentTurns.workerId, input.workerId),
                                lt(agentTurns.leaseExpiresAt, new Date(now).toISOString()),
                            ),
                        ),
                    ),
                ),
            )
            .orderBy(messages.sequence);
        const claimed: AgentSteerableTurn[] = [];
        for (const candidate of candidates) {
            const rows = await tx
                .update(agentTurns)
                .set({
                    status: "steering",
                    workerId: input.workerId,
                    leaseExpiresAt: new Date(now + STEERING_LEASE_MS).toISOString(),
                    updatedAt: sql`CURRENT_TIMESTAMP`,
                })
                .where(
                    and(
                        eq(agentTurns.userMessageId, candidate.userMessageId),
                        eq(agentTurns.agentUserId, running.agentUserId),
                        or(eq(agentTurns.status, "pending"), eq(agentTurns.status, "steering")),
                    ),
                )
                .returning({ id: agentTurns.userMessageId });
            if (rows.length !== 1) continue;
            claimed.push({
                agentUserId: running.agentUserId,
                chatId: input.chatId,
                runId: running.runId,
                sessionId: running.sessionId,
                steeringUserMessageId: candidate.userMessageId,
                text: candidate.text,
            });
        }
        return claimed;
    });
}
