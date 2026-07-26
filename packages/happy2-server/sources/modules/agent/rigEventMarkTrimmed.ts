import { type DrizzleExecutor } from "../drizzle.js";
import { type RigEventCheckpoint } from "./types.js";
import { and, eq, sql } from "drizzle-orm";
import { asRigEventCheckpoint } from "./impl/asRigEventCheckpoint.js";

import { rigEventSyncState } from "../schema.js";

import { rigEventGetCheckpoint } from "./rigEventGetCheckpoint.js";
/**
 * Marks rigEventSyncState trimmed through its exact current opaque cursor and
 * resets its trim counters. Opaque Rig cursors cannot be ordered locally.
 */
export async function rigEventMarkTrimmed(
    executor: DrizzleExecutor,
    through: string,
): Promise<RigEventCheckpoint> {
    const [updated] = await executor
        .update(rigEventSyncState)
        .set({
            trimmedThrough: through,
            eventsSinceTrim: 0,
            lastTrimmedAt: sql`CURRENT_TIMESTAMP`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(and(eq(rigEventSyncState.id, 1), eq(rigEventSyncState.cursor, through)))
        .returning();
    return updated ? asRigEventCheckpoint(updated) : rigEventGetCheckpoint(executor);
}
