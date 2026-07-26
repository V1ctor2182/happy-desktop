import { type DrizzleExecutor, withTransaction } from "../drizzle.js";
import { type RigEventCheckpoint } from "./types.js";
import { eq, sql } from "drizzle-orm";
import { asRigEventCheckpoint } from "./impl/asRigEventCheckpoint.js";

import { rigEventSyncState } from "../schema.js";

import { rigEventGetCheckpoint } from "./rigEventGetCheckpoint.js";
/**
 * Advances rigEventSyncState to the opaque cursor of the newest processed durable event.
 * Rig alone orders these tokens, so the single sequential ingestion loop persists
 * each delivered cursor without attempting to compare its encoded value.
 */
export async function rigEventCheckpoint(
    executor: DrizzleExecutor,
    cursor: string,
    eventCount = 1,
): Promise<RigEventCheckpoint> {
    if (!Number.isSafeInteger(eventCount) || eventCount < 1)
        throw new Error("Rig event checkpoint count must be a positive integer");
    return withTransaction(executor, async (tx) => {
        const [updated] = await tx
            .update(rigEventSyncState)
            .set({
                cursor,
                eventsSinceTrim: sql`${rigEventSyncState.eventsSinceTrim} + ${eventCount}`,
                updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(rigEventSyncState.id, 1))
            .returning();
        return updated ? asRigEventCheckpoint(updated) : rigEventGetCheckpoint(tx);
    });
}
