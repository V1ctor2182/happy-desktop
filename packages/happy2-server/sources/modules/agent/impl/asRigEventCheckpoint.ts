import { type RigEventCheckpoint } from "../types.js";
export function asRigEventCheckpoint(row: {
    cursor: string | null;
    eventsSinceTrim: number;
    lastTrimmedAt: string;
    trimmedThrough: string | null;
}): RigEventCheckpoint {
    return {
        ...(row.cursor === null
            ? {}
            : {
                  cursor: row.cursor,
              }),
        eventsSinceTrim: row.eventsSinceTrim,
        lastTrimmedAt: row.lastTrimmedAt,
        ...(row.trimmedThrough === null
            ? {}
            : {
                  trimmedThrough: row.trimmedThrough,
              }),
    };
}
