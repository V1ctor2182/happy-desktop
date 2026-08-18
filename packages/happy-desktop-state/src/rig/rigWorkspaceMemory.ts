import type { RigFileTabKind } from "./rigWorkspaceStore.js";
import type { RigGroupId } from "./rigTypes.js";
import type { RigViewPlacement } from "./rigPanelStore.js";

/** One file tab remembered for a group, enough to reopen it as it was left. */
export interface RigFileTabMemory {
    readonly path: string;
    readonly kind: RigFileTabKind;
    /**
     * The tab was a glance rather than a document the reader settled on. It is
     * remembered all the same: closing the window is not a decision to throw the
     * file away, and a preview that came back as a permanent tab would be a
     * different tab than the one that was on screen.
     */
    readonly preview?: boolean;
}

/** One browser tab remembered for a group's panel, by where it was left. */
export interface RigPanelBrowserMemory {
    readonly url: string;
    readonly label: string;
    /**
     * Which strip the page was being read in. Absent means the panel, which is
     * where every page opens and where every page remembered before this was
     * written down was.
     */
    readonly placement?: RigViewPlacement;
}

/**
 * Which of a panel's views was on screen. A terminal is deliberately not one of
 * them: it is a live process, and there is nothing to reattach to once the
 * window that owned it is gone.
 */
export type RigPanelViewMemory =
    | { readonly type: "files" }
    /** The browser tab at this index in `browsers`. */
    | { readonly type: "browser"; readonly index: number };

/**
 * How one group's panel was arranged: whether it was showing at all, how wide,
 * the pages it had open, and which view was in front.
 */
export interface RigPanelMemory {
    readonly open: boolean;
    readonly browsers: readonly RigPanelBrowserMemory[];
    readonly active: RigPanelViewMemory;
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
    /**
     * Where the reader dragged each tab, as a fractional order key by tab id.
     * Only tabs that have actually been moved appear: an untouched strip has no
     * keys at all and reads in the order its tabs arrived, which is what makes a
     * new tab open last without anything being written down for it.
     *
     * The keys are minted here rather than read from the daemon because this is
     * one strip of mixed things — sessions, files, whatever else lands in it —
     * and the daemon only knows about sessions. It could never order a strip it
     * can only see half of.
     */
    readonly order?: { readonly [tabId: string]: string };
    /** How the group's right-hand panel was arranged. */
    readonly panel?: RigPanelMemory;
    /**
     * What was typed into the group's composer and never sent. It is kept here
     * rather than in the daemon because the daemon has nowhere to keep it: the
     * session this message would start does not exist yet, and creating one to
     * hold a sentence would leave an empty session behind every time somebody
     * began a thought and walked away from it.
     */
    readonly draft?: string;
}

/**
 * How long an unsent group draft may be before it stops being remembered. A
 * message is a message, not a document; this is far past anything anyone types
 * into a composer and well inside what the host's storage will hold.
 */
export const RIG_GROUP_DRAFT_MAX_LENGTH = 100_000;

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
/**
 * Everything one workspace remembers about a group, written one concern at a
 * time. Each writer merges into what is already there, so recording a tab move
 * cannot silently drop a draft and folding the panel away cannot drop the tabs.
 */
export interface RigWorkspaceMemoryStore {
    groupRead(groupId: RigGroupId): RigGroupTabMemory | undefined;
    /** Records the group's open tabs, the one being read, and its recent history. */
    groupTabsWrite(
        groupId: RigGroupId,
        tabs: {
            readonly activeTabId?: string;
            readonly history: readonly string[];
            readonly files: readonly RigFileTabMemory[];
        },
    ): void;
    /**
     * Records where the reader dragged the group's tabs. An empty map means the
     * strip is back to arrival order and carries no keys at all.
     */
    groupOrderWrite(groupId: RigGroupId, order: { readonly [tabId: string]: string }): void;
    /** Records how the group's panel was arranged. */
    groupPanelWrite(groupId: RigGroupId, panel: RigPanelMemory): void;
    /** Drops a group that no longer exists, with everything remembered about it. */
    groupForget(groupId: RigGroupId): void;
    /**
     * Records what is typed into a group's composer without disturbing its tabs.
     * Empty text forgets the draft, so a group nobody has typed into carries no
     * record of one.
     */
    groupDraftWrite(groupId: RigGroupId, draft: string): void;
}

const FILE_KINDS: readonly RigFileTabKind[] = ["file", "diff", "document", "media"];

/** Reads one stored file tab, rejecting anything that is not the shape we wrote. */
function fileTabParse(value: unknown): RigFileTabMemory | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const { path, kind } = record;
    if (typeof path !== "string") return undefined;
    if (typeof kind !== "string" || !FILE_KINDS.includes(kind as RigFileTabKind)) return undefined;
    return {
        path,
        kind: kind as RigFileTabKind,
        ...(record.preview === true ? { preview: true } : {}),
    };
}

function orderParse(value: unknown): { readonly [tabId: string]: string } | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const entries = Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    );
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function panelParse(value: unknown): RigPanelMemory | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const browsers = Array.isArray(record.browsers)
        ? record.browsers.flatMap((entry) => {
              if (typeof entry !== "object" || entry === null) return [];
              const browser = entry as Record<string, unknown>;
              if (typeof browser.url !== "string") return [];
              return [
                  {
                      url: browser.url,
                      label: typeof browser.label === "string" ? browser.label : browser.url,
                  },
              ];
          })
        : [];
    const stored = record.active;
    const active: RigPanelViewMemory =
        typeof stored === "object" &&
        stored !== null &&
        (stored as Record<string, unknown>).type === "browser" &&
        typeof (stored as Record<string, unknown>).index === "number" &&
        (stored as { index: number }).index < browsers.length
            ? { type: "browser", index: (stored as { index: number }).index }
            : { type: "files" };
    const panel: RigPanelMemory = {
        open: record.open === true,
        browsers,
        active,
    };
    // A closed panel with nothing in it is the default, and writing it down for
    // every group anyone ever opened would only grow the document.
    return !panel.open && browsers.length === 0 ? undefined : panel;
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
    const draft =
        typeof record.draft === "string" && record.draft.length > 0
            ? record.draft.slice(0, RIG_GROUP_DRAFT_MAX_LENGTH)
            : undefined;
    const order = orderParse(record.order);
    const panel = panelParse(record.panel);
    if (
        history.length === 0 &&
        files.length === 0 &&
        draft === undefined &&
        order === undefined &&
        panel === undefined
    )
        return undefined;
    return {
        ...(activeTabId ? { activeTabId } : {}),
        history,
        files,
        ...(order === undefined ? {} : { order }),
        ...(panel === undefined ? {} : { panel }),
        ...(draft === undefined ? {} : { draft }),
    };
}

/** True once nothing is left worth keeping a record of this group for. */
function groupEmpty(memory: RigGroupTabMemory): boolean {
    return (
        memory.history.length === 0 &&
        memory.files.length === 0 &&
        memory.draft === undefined &&
        memory.order === undefined &&
        memory.panel === undefined
    );
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

    /** Applies one concern's change over whatever else the group remembers. */
    const merge = (groupId: RigGroupId, next: RigGroupTabMemory): void => {
        if (groupEmpty(next)) {
            if (!groups.delete(groupId)) return;
            flush();
            return;
        }
        groups.set(groupId, next);
        flush();
    };

    const groupOr = (groupId: RigGroupId): RigGroupTabMemory =>
        groups.get(groupId) ?? { history: [], files: [] };

    return {
        groupRead: (groupId) => groups.get(groupId),
        groupTabsWrite(groupId, tabs) {
            const previous = groupOr(groupId);
            merge(groupId, {
                ...previous,
                ...(tabs.activeTabId ? { activeTabId: tabs.activeTabId } : {}),
                history: tabs.history,
                files: tabs.files,
            });
        },
        groupOrderWrite(groupId, order) {
            const previous = groupOr(groupId);
            const { order: _dropped, ...rest } = previous;
            merge(
                groupId,
                Object.keys(order).length === 0 ? rest : { ...rest, order: { ...order } },
            );
        },
        groupPanelWrite(groupId, panel) {
            const previous = groupOr(groupId);
            const { panel: _dropped, ...rest } = previous;
            // The default arrangement is not worth a record: a panel nobody has
            // opened must not keep a group alive in this document.
            merge(groupId, !panel.open && panel.browsers.length === 0 ? rest : { ...rest, panel });
        },
        groupForget(groupId) {
            if (!groups.delete(groupId)) return;
            flush();
        },
        groupDraftWrite(groupId, draft) {
            const previous = groups.get(groupId);
            const next = draft.slice(0, RIG_GROUP_DRAFT_MAX_LENGTH);
            if ((previous?.draft ?? "") === next) return;
            if (next.length === 0) {
                if (!previous) return;
                const { draft: _dropped, ...rest } = previous;
                // A group whose draft was the only thing worth remembering is
                // forgotten with it rather than left as an empty record.
                merge(groupId, rest);
                return;
            }
            merge(groupId, { ...groupOr(groupId), draft: next });
        },
    };
}
