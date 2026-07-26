import { and, eq, sql } from "drizzle-orm";

import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { agentTurns } from "../schema.js";

/**
 * Marks the claimed agentTurns row delivered into a run in flight, so it never runs again as a turn of its own.
 * `steered` is terminal: the message is now part of another turn's conversation and its own reply will never exist.
 * The row deliberately keeps no run identifier — a run belongs to the turn that started it, and `agent_turns` holds
 * one row per session and run — so the durable link to what happened is the steering notice this row later carries.
 * Only this worker's own claim may be confirmed, so a claim that expired and was taken over elsewhere cannot be
 * closed twice.
 */
export async function agentTurnMarkSteered(
    executor: DrizzleExecutor,
    input: {
        agentUserId: string;
        userMessageId: string;
        workerId: string;
    },
): Promise<boolean> {
    const changed = await withTransaction(executor, (tx) =>
        tx
            .update(agentTurns)
            .set({
                status: "steered",
                workerId: null,
                leaseExpiresAt: null,
                completedAt: sql`CURRENT_TIMESTAMP`,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(
                and(
                    eq(agentTurns.userMessageId, input.userMessageId),
                    eq(agentTurns.agentUserId, input.agentUserId),
                    eq(agentTurns.workerId, input.workerId),
                    eq(agentTurns.status, "steering"),
                ),
            )
            .returning({ id: agentTurns.userMessageId }),
    );
    return changed.length === 1;
}
