import type { RigFileTabKind } from "./rigWorkspaceStore.js";
import type { RigGroupId, RigSessionId } from "./rigTypes.js";

/** One file tab remembered for a group, enough to reopen it as it was left. */
export interface RigFileTabMemory {
    readonly sessionId: RigSessionId;
    readonly path: string;
    readonly kind: RigFileTabKind;
}

/**
 * What one project or worktree was left looking like: the tab that was being
 * read, the order tabs were last read in, and the files that were open in it.
 * The history is what makes a closed tab fall back to the one behind it rather
 * than to an arbitrary row.
 */
export interface RigGroupTabMemory {
    /** The tab that was on screen: a session id, or a file tab id. */
    readonly activeTabId?: string;
    /** Tab ids, most recently read first. */
    readonly history: readonly string[];
    /** The group's open file tabs, in strip order. */
    readonly files: readonly RigFileTabMemory[];
}

/**
 * Everything one Rig's window remembers between runs about where the reader
 * was: each group's tabs, and which sessions still have unseen finished work.
 * Read state belongs here rather than in the session list's lifetime because a
 * session whose work finished before a restart is still unread after it.
 */
export interface RigWorkspaceMemoryDocument {
    readonly groups: { readonly [groupId: string]: RigGroupTabMemory | undefined };
    readonly unreadSessionIds: readonly string[];
}

/**
 * Where that memory is kept. The state package never names a storage medium: the
 * host supplies one, and omitting it leaves the memory alive for this client's
 * lifetime only.
 */
export interface RigWorkspaceMemoryPersistence {
    read(): RigWorkspaceMemoryDocument | undefined;
    write(document: RigWorkspaceMemoryDocument): void;
}

/**
 * The one memory both the session list and the workspace write into, so a Rig
 * keeps a single durable document rather than two that can disagree about which
 * sessions exist.
 */
export interface RigWorkspaceMemoryStore {
    groupRead(groupId: RigGroupId): RigGroupTabMemory | undefined;
    groupUpdate(groupId: RigGroupId, memory: RigGroupTabMemory): void;
    /** Drops a group that no longer exists, with everything remembered about it. */
    groupForget(groupId: RigGroupId): void;
    unreadRead(): readonly RigSessionId[];
    unreadUpdate(sessionIds: readonly RigSessionId[]): void;
}

const FILE_KINDS: readonly RigFileTabKind[] = ["file", "diff"];

/** Reads one stored file tab, rejecting anything that is not the shape we wrote. */
function fileTabParse(value: unknown): RigFileTabMemory | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const { sessionId, path, kind } = record;
    if (typeof sessionId !== "string" || typeof path !== "string") return undefined;
    if (typeof kind !== "string" || !FILE_KINDS.includes(kind as RigFileTabKind)) return undefined;
    return { sessionId: sessionId as RigSessionId, path, kind: kind as RigFileTabKind };
}

function groupParse(value: unknown): RigGroupTabMemory | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const history = Array.isArray(record.history)
        ? record.history.filter((id): id is string => typeof id === "string")
        : [];
    const files = Array.isArray(record.files)
        ? record.files.flatMap((entry) => {
              const file = fileTabParse(entry);
              return file ? [file] : [];
          })
        : [];
    const activeTabId = typeof record.activeTabId === "string" ? record.activeTabId : undefined;
    if (history.length === 0 && files.length === 0) return undefined;
    return { ...(activeTabId ? { activeTabId } : {}), history, files };
}

/**
 * Creates the memory a Rig's surfaces share, hydrated from the host's storage
 * when it has one. Stored documents come from a previous version of this app and
 * from a file a reader can edit, so every field is parsed rather than trusted;
 * an unreadable document simply means nothing is remembered.
 */
export function rigWorkspaceMemoryStoreCreate(
    persistence?: RigWorkspaceMemoryPersistence,
): RigWorkspaceMemoryStore {
    const groups = new Map<string, RigGroupTabMemory>();
    let unreadSessionIds: readonly RigSessionId[] = [];

    const stored = (() => {
        try {
            return persistence?.read();
        } catch {
            return undefined;
        }
    })();
    if (stored && typeof stored === "object") {
        const storedGroups = (stored as RigWorkspaceMemoryDocument).groups;
        if (storedGroups && typeof storedGroups === "object")
            for (const [groupId, value] of Object.entries(storedGroups)) {
                const group = groupParse(value);
                if (group) groups.set(groupId, group);
            }
        const storedUnread = (stored as RigWorkspaceMemoryDocument).unreadSessionIds;
        if (Array.isArray(storedUnread))
            unreadSessionIds = storedUnread.filter(
                (id): id is RigSessionId => typeof id === "string",
            );
    }

    const flush = (): void => {
        if (!persistence) return;
        try {
            persistence.write({
                groups: Object.fromEntries(groups),
                unreadSessionIds: [...unreadSessionIds],
            });
        } catch {
            // Storage the host refused still keeps this client's memory alive.
        }
    };

    return {
        groupRead: (groupId) => groups.get(groupId),
        groupUpdate(groupId, memory) {
            groups.set(groupId, memory);
            flush();
        },
        groupForget(groupId) {
            if (!groups.delete(groupId)) return;
            flush();
        },
        unreadRead: () => unreadSessionIds,
        unreadUpdate(sessionIds) {
            unreadSessionIds = [...sessionIds];
            flush();
        },
    };
}
