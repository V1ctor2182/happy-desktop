import { and, eq, sql } from "drizzle-orm";

import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { agentTurns } from "../schema.js";

/**
 * Returns a claimed agentTurns steering delivery to the pending queue after Rig refused to fold it into the run.
 * This is the path that makes steering safe to attempt at all: a refused message keeps its own pending turn and is
 * answered normally once the current run ends, so a race between a finishing run and an arriving message never
 * silently drops what someone said.
 */
export async function agentTurnReleaseSteering(
    executor: DrizzleExecutor,
    input: {
        agentUserId: string;
        userMessageId: string;
        workerId: string;
    },
): Promise<void> {
    await withTransaction(executor, (tx) =>
        tx
            .update(agentTurns)
            .set({
                status: "pending",
                workerId: null,
                leaseExpiresAt: null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(
                and(
                    eq(agentTurns.userMessageId, input.userMessageId),
                    eq(agentTurns.agentUserId, input.agentUserId),
                    eq(agentTurns.workerId, input.workerId),
                    eq(agentTurns.status, "steering"),
                ),
            ),
    );
}
