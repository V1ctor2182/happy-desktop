import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const orderVersion = 2;

/** A session ranked after every manually ordered one, so it sorts by recency. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * The order the user dragged their session tabs into, per group — a project or
 * one of its worktrees. The daemon lists sessions by its own recency, which is
 * the right default but a poor answer once someone has arranged their tabs — so
 * the arrangement is a decision this desktop owns and remembers across restarts,
 * exactly like the archive beside it. Groups are keyed by the daemon's durable
 * project/worktree id, so an arrangement survives the project being renamed or
 * its directory being moved.
 */
export interface RigSessionOrder {
    /**
     * Sort position of a session within its group: its index in the stored
     * order, or `UNRANKED` for a session nobody has placed yet — a session
     * created after the last drag sorts by recency behind the arranged ones.
     */
    rank(groupId: string, sessionId: string): number;
    /** Records one group's complete session order and persists it. */
    set(groupId: string, sessionIds: readonly string[]): Promise<void>;
}

/**
 * Loads the stored orders from `path`, tolerating a missing or unreadable file
 * by starting empty: losing an arrangement costs the user a re-drag, so it must
 * never keep the workspace from opening. Every `set` rewrites the file
 * atomically and resolves once the rename is durable, and writes are serialized
 * so two drags in one tick cannot lose the earlier one.
 */
export async function rigSessionOrderCreate(path: string): Promise<RigSessionOrder> {
    const orders = new Map<string, readonly string[]>(await ordersRead(path));
    let writing: Promise<void> = Promise.resolve();
    return {
        rank(groupId, sessionId) {
            const index = orders.get(groupId)?.indexOf(sessionId) ?? -1;
            return index === -1 ? UNRANKED : index;
        },
        set(groupId, sessionIds) {
            orders.set(groupId, [...sessionIds]);
            writing = writing.then(() => ordersWrite(path, orders));
            return writing;
        },
    };
}

async function ordersRead(path: string): Promise<readonly (readonly [string, string[]])[]> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
        const value = parsed as Record<string, unknown>;
        if (value.version !== orderVersion || !value.groups) return [];
        if (typeof value.groups !== "object" || Array.isArray(value.groups)) return [];
        return Object.entries(value.groups as Record<string, unknown>).flatMap(
            ([groupId, sessionIds]) =>
                Array.isArray(sessionIds)
                    ? [
                          [
                              groupId,
                              sessionIds.filter((id): id is string => typeof id === "string"),
                          ] as const,
                      ]
                    : [],
        );
    } catch {
        return [];
    }
}

async function ordersWrite(path: string, orders: ReadonlyMap<string, readonly string[]>) {
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    const body = { groups: Object.fromEntries(orders), version: orderVersion };
    await writeFile(temporary, `${JSON.stringify(body, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}
