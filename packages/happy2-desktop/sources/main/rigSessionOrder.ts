import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const orderVersion = 1;

/** A session ranked after every manually ordered one, so it sorts by recency. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * The order the user dragged their session tabs into, per working directory. The
 * daemon lists sessions by its own recency, which is the right default but a
 * poor answer once someone has arranged their tabs — so the arrangement is a
 * decision this desktop owns and remembers across restarts, exactly like the
 * archive beside it. Directories are keyed by the canonical `cwd` the daemon
 * reports, so the same directory keeps its order however it was addressed.
 */
export interface RigSessionOrder {
    /**
     * Sort position of a session within its directory: its index in the stored
     * order, or `UNRANKED` for a session nobody has placed yet — a session
     * created after the last drag sorts by recency behind the arranged ones.
     */
    rank(cwd: string, sessionId: string): number;
    /** Records one directory's complete session order and persists it. */
    set(cwd: string, sessionIds: readonly string[]): Promise<void>;
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
        rank(cwd, sessionId) {
            const index = orders.get(cwd)?.indexOf(sessionId) ?? -1;
            return index === -1 ? UNRANKED : index;
        },
        set(cwd, sessionIds) {
            orders.set(cwd, [...sessionIds]);
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
        if (value.version !== orderVersion || !value.directories) return [];
        if (typeof value.directories !== "object" || Array.isArray(value.directories)) return [];
        return Object.entries(value.directories as Record<string, unknown>).flatMap(
            ([cwd, sessionIds]) =>
                Array.isArray(sessionIds)
                    ? [
                          [
                              cwd,
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
    const body = { directories: Object.fromEntries(orders), version: orderVersion };
    await writeFile(temporary, `${JSON.stringify(body, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}
