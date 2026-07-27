import type { RigTerminalHandle, RigTerminalStore } from "./rigTerminalStore.js";
import type { RigSessionId } from "./rigTypes.js";

declare const rigPanelTabIdBrand: unique symbol;

/** Branded identifier of one tab in the workspace panel, minted by this store. */
export type RigPanelTabId = string & { readonly [rigPanelTabIdBrand]: true };

/**
 * What a panel tab holds. A terminal tab runs a shell in the session's working
 * directory; a browser tab is declared here because the panel's whole point is
 * hosting more than one kind of tool beside the conversation, but it renders
 * nothing yet.
 */
export type RigPanelTabKind = "terminal" | "browser";

export interface RigPanelTabSnapshot {
    readonly id: RigPanelTabId;
    readonly kind: RigPanelTabKind;
    /** Tab strip label. A terminal's is its ordinal, not its shell's window title. */
    readonly label: string;
}

/**
 * The panel as the workspace renders it: whether it is showing at all, the tabs
 * belonging to the conversation currently addressed, and which of them is
 * selected. A tab's live contents are deliberately absent — a terminal repaints
 * many times a second, and folding that into this snapshot would re-render the
 * whole workspace on every frame — so a tab body reads its own store through
 * `terminal`.
 */
export interface RigPanelSnapshot {
    readonly open: boolean;
    readonly tabs: readonly RigPanelTabSnapshot[];
    /** The permanent files view, transient tool preview, or one live tool tab. */
    readonly activeViewId: "files" | "preview" | RigPanelTabId;
    /** Conversation entry selected into the replaceable Preview tab. */
    readonly previewEntryId?: string;
}

export interface RigPanelStore {
    get(): RigPanelSnapshot;
    subscribe(listener: () => void): () => void;

    /**
     * Shows or hides the panel. It never starts anything: a terminal is a process
     * in the user's working directory, and opening a column is not consent to run
     * one. The panel shows its own content and offers to start a terminal.
     */
    panelToggle(): void;
    /** Selects the permanent workspace-files tab and opens the panel. */
    filesSelect(): void;
    /** Opens or replaces the transient Preview tab with one conversation tool entry. */
    previewOpen(entryId: string): void;
    /** Closes the transient Preview tab and returns to Files. */
    previewClose(): void;
    /** Adds a terminal tab to the open conversation and selects it. */
    terminalAdd(): void;
    tabSelect(tabId: RigPanelTabId): void;
    /**
     * Closes one tab, ending whatever it was running. Closing the last one leaves
     * the panel showing: the terminal section is only part of the column, and the
     * rest of it is still worth reading.
     */
    tabClose(tabId: RigPanelTabId): void;

    /**
     * The live store behind a terminal tab, for the view that renders it. It is
     * not part of the snapshot precisely so a terminal's output notifies only its
     * own subscriber.
     */
    terminal(tabId: RigPanelTabId): RigTerminalStore | undefined;

    /**
     * Applies which conversation the workspace has open. This is authoritative
     * input from the panel's owner, not a user action: navigation decides it, and
     * the panel answers by showing that conversation's tabs. Tabs of other
     * conversations keep running, so switching session tabs and coming back finds
     * the same terminals.
     */
    conversationApply(conversationId: RigSessionId | undefined): void;

    [Symbol.dispose](): void;
}

export interface RigPanelDeps {
    /** Opens one terminal in a session; the panel owns the returned lease. */
    readonly terminalOpen: (sessionId: RigSessionId) => RigTerminalHandle;
}

interface Tab {
    readonly id: RigPanelTabId;
    readonly kind: RigPanelTabKind;
    readonly label: string;
    readonly conversationId: RigSessionId;
    readonly terminal?: RigTerminalHandle;
}

const NO_TABS: readonly RigPanelTabSnapshot[] = [];

/**
 * The workspace's right-hand panel. It is one store for the whole workspace
 * rather than one per conversation because whether the panel is showing is a
 * property of the window the user arranged, not of the session they happen to be
 * reading: switching session tabs must not fold the panel away and reopening it
 * must not lose the shell they were half-way through a command in.
 *
 * Tabs, by contrast, belong to their conversation — a terminal runs in that
 * session's working directory and cannot be shown under another one — so they are
 * held per conversation and the snapshot projects only the addressed one's.
 */
export function rigPanelStoreCreate(deps: RigPanelDeps): RigPanelStore {
    const listeners = new Set<() => void>();
    const tabs: Tab[] = [];
    /** Which live tool tab each conversation had selected, so returning to it lands there. */
    const activeByConversation = new Map<RigSessionId, RigPanelTabId>();
    let conversationId: RigSessionId | undefined;
    let open = false;
    let activeViewId: RigPanelSnapshot["activeViewId"] = "files";
    let previewEntryId: string | undefined;
    let previewConversationId: RigSessionId | undefined;
    let nextTabNumber = 1;
    let disposed = false;
    let snapshot: RigPanelSnapshot = { activeViewId: "files", open: false, tabs: NO_TABS };

    const project = (): RigPanelSnapshot => {
        const visible = tabs.filter((tab) => tab.conversationId === conversationId);
        return {
            activeViewId,
            open,
            tabs: visible.map((tab) => ({ id: tab.id, kind: tab.kind, label: tab.label })),
            ...(previewEntryId === undefined ? {} : { previewEntryId }),
        };
    };

    const recompute = (): void => {
        const next = project();
        if (
            next.open === snapshot.open &&
            next.activeViewId === snapshot.activeViewId &&
            next.previewEntryId === snapshot.previewEntryId &&
            next.tabs.length === snapshot.tabs.length &&
            next.tabs.every((tab, index) => {
                const before = snapshot.tabs[index];
                return (
                    before !== undefined &&
                    before.id === tab.id &&
                    before.kind === tab.kind &&
                    before.label === tab.label
                );
            })
        )
            return;
        // Unchanged rows keep their identity so a tab strip re-renders only the
        // tab that actually changed.
        snapshot = {
            activeViewId: next.activeViewId,
            open: next.open,
            tabs: next.tabs.map((tab, index) => {
                const before = snapshot.tabs[index];
                return before !== undefined &&
                    before.id === tab.id &&
                    before.kind === tab.kind &&
                    before.label === tab.label
                    ? before
                    : tab;
            }),
            ...(next.previewEntryId === undefined ? {} : { previewEntryId: next.previewEntryId }),
        };
        for (const listener of listeners) listener();
    };

    const terminalTabAdd = (session: RigSessionId): void => {
        const id = `tab_${nextTabNumber}` as RigPanelTabId;
        // Terminals are numbered across the workspace rather than per conversation
        // so a label never silently means two different shells.
        const label = `Terminal ${nextTabNumber}`;
        nextTabNumber += 1;
        tabs.push({
            id,
            kind: "terminal",
            label,
            conversationId: session,
            terminal: deps.terminalOpen(session),
        });
        activeByConversation.set(session, id);
        activeViewId = id;
    };

    const tabDispose = (index: number): void => {
        const [removed] = tabs.splice(index, 1);
        removed?.terminal?.[Symbol.dispose]();
        if (!removed) return;
        if (activeByConversation.get(removed.conversationId) !== removed.id) return;
        const sibling = tabs.find((tab) => tab.conversationId === removed.conversationId);
        if (sibling) {
            activeByConversation.set(removed.conversationId, sibling.id);
            activeViewId = sibling.id;
        } else {
            activeByConversation.delete(removed.conversationId);
            activeViewId = "files";
        }
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        panelToggle() {
            if (disposed) return;
            open = !open;
            recompute();
        },
        filesSelect() {
            if (disposed) return;
            activeViewId = "files";
            open = true;
            recompute();
        },
        previewOpen(entryId) {
            if (disposed || !conversationId) return;
            previewEntryId = entryId;
            previewConversationId = conversationId;
            activeViewId = "preview";
            open = true;
            recompute();
        },
        previewClose() {
            if (disposed) return;
            previewEntryId = undefined;
            previewConversationId = undefined;
            activeViewId = "files";
            recompute();
        },
        terminalAdd() {
            if (disposed || !conversationId) return;
            terminalTabAdd(conversationId);
            open = true;
            recompute();
        },
        tabSelect(tabId) {
            if (disposed) return;
            const tab = tabs.find((candidate) => candidate.id === tabId);
            if (!tab) return;
            activeByConversation.set(tab.conversationId, tab.id);
            activeViewId = tab.id;
            recompute();
        },
        tabClose(tabId) {
            if (disposed) return;
            const index = tabs.findIndex((candidate) => candidate.id === tabId);
            if (index < 0) return;
            tabDispose(index);
            recompute();
        },

        terminal: (tabId) => tabs.find((tab) => tab.id === tabId)?.terminal,

        conversationApply(next) {
            if (disposed || next === conversationId) return;
            conversationId = next;
            if (previewConversationId !== next) {
                previewEntryId = undefined;
                previewConversationId = undefined;
            }
            activeViewId =
                (next === undefined ? undefined : activeByConversation.get(next)) ?? "files";
            recompute();
        },

        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            for (const tab of tabs.splice(0)) tab.terminal?.[Symbol.dispose]();
            activeByConversation.clear();
            listeners.clear();
        },
    };
}
