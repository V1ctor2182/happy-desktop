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
 * was: each group's open and recently read tabs. Chat read state is durable Rig
 * state and deliberately does not have a second local copy here.
 */
export interface RigWorkspaceMemoryDocument {
    readonly groups: { readonly [groupId: string]: RigGroupTabMemory | undefined };
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
 * The workspace's durable navigation memory.
 */
export interface RigWorkspaceMemoryStore {
    groupRead(groupId: RigGroupId): RigGroupTabMemory | undefined;
    groupUpdate(groupId: RigGroupId, memory: RigGroupTabMemory): void;
    /** Drops a group that no longer exists, with everything remembered about it. */
    groupForget(groupId: RigGroupId): void;
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
    }

    const flush = (): void => {
        if (!persistence) return;
        try {
            persistence.write({ groups: Object.fromEntries(groups) });
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
    };
}
