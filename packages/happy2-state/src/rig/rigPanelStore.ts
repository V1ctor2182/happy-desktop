import type { RigTerminalHandle, RigTerminalStore } from "./rigTerminalStore.js";
import type { RigGroupId, RigSessionId } from "./rigTypes.js";
import type { RigPanelMemory } from "./rigWorkspaceMemory.js";

declare const rigPanelTabIdBrand: unique symbol;

/** Branded identifier of one tab in the workspace panel, minted by this store. */
export type RigPanelTabId = string & { readonly [rigPanelTabIdBrand]: true };

/** What a panel tab holds beside the conversation. */
export type RigPanelTabKind = "terminal" | "browser" | "webapp";

/**
 * Which of the workspace's two tab strips a view is being shown in.
 *
 * Placement is a property of the view, not of the strip drawing it: a terminal
 * moved into the main content is the same terminal running the same shell under
 * the same id, and only where it is drawn has changed. Saying that in one field
 * is what makes moving one a change of placement rather than closing a tab here
 * and opening a different one there.
 */
export type RigViewPlacement = "panel" | "main";

interface RigPanelTabSnapshotBase {
    readonly id: RigPanelTabId;
    /** Tab strip label. A terminal's is its ordinal, not its shell's window title. */
    readonly label: string;
    /** Which strip is drawing this tab. Every tab is born in the panel. */
    readonly placement: RigViewPlacement;
}

export type RigPanelTabSnapshot =
    | (RigPanelTabSnapshotBase & {
          readonly kind: "terminal";
      })
    | (RigPanelTabSnapshotBase & {
          readonly kind: "browser";
          /** Last committed main-frame location, restored if the surface remounts. */
          readonly url: string;
      })
    | (RigPanelTabSnapshotBase & {
          readonly kind: "webapp";
          /** Isolated preview origin of the webapp's current version. */
          readonly url: string;
      });

export interface RigBrowserUpdate {
    /** Last committed main-frame location. */
    readonly url?: string;
    /** Page title reported by Chromium. Empty titles fall back to the host name. */
    readonly title?: string;
}

/**
 * The panel as the workspace renders it: whether it is showing at all, the tabs
 * belonging to the project or worktree currently addressed, and which of them is
 * selected. A tab's live contents are deliberately absent — a terminal repaints
 * many times a second, and folding that into this snapshot would re-render the
 * whole workspace on every frame — so a tab body reads its own store through
 * `terminal`.
 */
export interface RigPanelSnapshot {
    readonly open: boolean;
    /**
     * The panel has taken the whole window beside the sidebar. It is a property
     * of the open panel, so folding the panel away also gives up the expansion.
     */
    readonly maximized: boolean;
    readonly tabs: readonly RigPanelTabSnapshot[];
    /**
     * The permanent files view, the transient tool preview, the transient file
     * viewer, or one live tool tab.
     */
    readonly activeViewId: "files" | "preview" | "file" | RigPanelTabId;
    /** Conversation entry selected into the replaceable Preview tab. */
    readonly previewEntryId?: string;
    /**
     * A workspace file is open in the transient viewer tab. Which file it is
     * belongs to the workspace store, which reads it; this only says the tab
     * exists, so the two never disagree about the file being shown.
     */
    readonly fileViewOpen: boolean;
    /**
     * Why a new terminal cannot be opened here, or absent when one can. A shell
     * runs in the checkout, so a checkout that is not there cannot host one; the
     * owner supplies the sentence with the scope, since it is the one that knows
     * the group's state. Terminals already running are untouched by it.
     */
    readonly terminalRefusal?: string;
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
    /**
     * Expands the panel over the workspace column, or returns it to its docked
     * width. Only meaningful while the panel is showing.
     */
    panelMaximizeToggle(): void;
    /**
     * Steps the panel back from expanded to its docked width, without folding it
     * away. It is what the workspace calls when something the reader moved has
     * landed in the main content, which an expanded panel would be standing in
     * front of.
     */
    panelRestore(): void;
    /** Selects the permanent workspace-files tab and opens the panel. */
    filesSelect(): void;
    /** Opens or replaces the transient Preview tab with one conversation tool entry. */
    previewOpen(entryId: string): void;
    /** Closes the transient Preview tab and returns to Files. */
    previewClose(): void;
    /**
     * Shows the transient file-viewer tab and opens the panel. The workspace
     * store calls this as it starts reading the file, so the tab appears with
     * the file's own loading state rather than after it.
     */
    fileViewOpen(): void;
    /** Closes the file-viewer tab and returns to Files. */
    fileViewClose(): void;
    /**
     * Adds a terminal tab to the open group and selects it. The shell runs in
     * the open session, so there has to be one; the tab itself belongs to the
     * group and stays put as the reader moves between that group's sessions.
     */
    terminalAdd(): void;
    /** Adds a browser tab to the open group, optionally at one safe web URL, and selects it. */
    browserAdd(url?: string): void;
    /** Opens a named Rig webapp in the open group's isolated preview surface. */
    webappOpen(name: string, url: string): void;
    /** Reconciles Chromium-owned location/title metadata into one browser tab. */
    browserUpdate(tabId: RigPanelTabId, update: RigBrowserUpdate): void;
    tabSelect(tabId: RigPanelTabId): void;
    /**
     * Moves one tab to the other strip. Nothing behind it is touched — the shell
     * keeps running, the page keeps its address — because the tab is not being
     * closed and reopened; it is being drawn somewhere else. A tab leaving the
     * panel gives up the panel's selection to whatever is still there, and a tab
     * arriving takes it, so neither strip is left pointing at a tab it no longer
     * draws.
     */
    tabPlacementUpdate(tabId: RigPanelTabId, placement: RigViewPlacement): void;
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
     * Applies what the workspace has open. This is authoritative input from the
     * panel's owner, not a user action: navigation decides it, and the panel
     * answers by showing that group's arrangement. The conversation comes along
     * because a terminal is a process inside a session, so starting one needs to
     * know which session asked for it.
     *
     * Tabs of other groups keep running, so moving between projects and coming
     * back finds the same terminals.
     */
    scopeApply(
        groupId: RigGroupId | undefined,
        conversationId: RigSessionId | undefined,
        terminalRefusal?: string,
    ): void;

    [Symbol.dispose](): void;
}

export interface RigPanelDeps {
    /** Opens one terminal in a session; the panel owns the returned lease. */
    readonly terminalOpen: (sessionId: RigSessionId) => RigTerminalHandle;
    /**
     * How one group's arrangement survives the window. Both are optional so the
     * same store works standalone in a blueprint and in tests, where nothing is
     * remembered and nothing needs to be.
     */
    readonly memoryRead?: (groupId: RigGroupId) => RigPanelMemory | undefined;
    readonly memoryWrite?: (groupId: RigGroupId, memory: RigPanelMemory) => void;
}

interface Tab {
    readonly id: RigPanelTabId;
    readonly kind: RigPanelTabKind;
    label: string;
    readonly groupId: RigGroupId;
    readonly terminal?: RigTerminalHandle;
    title?: string;
    url?: string;
    placement: RigViewPlacement;
}

const NO_TABS: readonly RigPanelTabSnapshot[] = [];

/**
 * Whether a rebuilt tab says exactly what the one already in the snapshot says.
 * A tab that has not changed keeps its object, so a strip re-renders only the
 * tab that actually moved, was renamed, or went somewhere.
 */
function tabSame(
    before: RigPanelTabSnapshot | undefined,
    next: RigPanelTabSnapshot,
): before is RigPanelTabSnapshot {
    return (
        before !== undefined &&
        before.id === next.id &&
        before.kind === next.kind &&
        before.label === next.label &&
        before.placement === next.placement &&
        (before.kind === "terminal" || (next.kind !== "terminal" && before.url === next.url))
    );
}

/**
 * The workspace's right-hand panel. It belongs to the project or worktree the
 * reader has open, not to the session they happen to be reading inside it: a
 * terminal runs in the checkout, the files it lists are the checkout's, and a
 * page opened out of one of them is still the same page after the reader moves
 * to the next session in that project. Switching session tabs therefore leaves
 * the panel exactly as it was, while moving to another project shows that
 * project's own arrangement.
 *
 * That arrangement outlives the window: it is read back from the group's memory
 * the first time the group is addressed, so a reopened app finds the panel where
 * it was left. Terminals are the exception and are deliberately not restored —
 * they are live processes, and there is nothing left to reattach to.
 */
export function rigPanelStoreCreate(deps: RigPanelDeps): RigPanelStore {
    const listeners = new Set<() => void>();
    const tabs: Tab[] = [];
    /** Which live tool tab each group had selected, so returning to it lands there. */
    const activeByGroup = new Map<RigGroupId, RigPanelTabId>();
    /** Whether each group's panel was showing, and how wide, when it was left. */
    const chromeByGroup = new Map<RigGroupId, { open: boolean; maximized: boolean }>();
    /** Groups whose remembered arrangement has already been read back in this run. */
    const restoredGroupIds = new Set<RigGroupId>();
    let groupId: RigGroupId | undefined;
    let conversationId: RigSessionId | undefined;
    /** Why a shell cannot be started in the current scope; supplied by the owner. */
    let terminalRefusal: string | undefined;
    let open = false;
    let maximized = false;
    let activeViewId: RigPanelSnapshot["activeViewId"] = "files";
    let previewEntryId: string | undefined;
    let previewConversationId: RigSessionId | undefined;
    let fileViewShown = false;
    let nextTabNumber = 1;
    let disposed = false;
    let snapshot: RigPanelSnapshot = {
        activeViewId: "files",
        fileViewOpen: false,
        maximized: false,
        open: false,
        tabs: NO_TABS,
    };

    const project = (): RigPanelSnapshot => {
        const visible = tabs.filter((tab) => tab.groupId === groupId);
        return {
            activeViewId,
            fileViewOpen: fileViewShown,
            maximized,
            open,
            tabs: visible.map(
                (tab): RigPanelTabSnapshot =>
                    tab.kind === "browser" || tab.kind === "webapp"
                        ? {
                              id: tab.id,
                              kind: tab.kind,
                              label: tab.label,
                              placement: tab.placement,
                              url: tab.url ?? "about:blank",
                          }
                        : {
                              id: tab.id,
                              kind: tab.kind,
                              label: tab.label,
                              placement: tab.placement,
                          },
            ),
            ...(previewEntryId === undefined ? {} : { previewEntryId }),
            ...(terminalRefusal === undefined ? {} : { terminalRefusal }),
        };
    };

    const recompute = (): void => {
        const next = project();
        if (
            next.open === snapshot.open &&
            next.maximized === snapshot.maximized &&
            next.activeViewId === snapshot.activeViewId &&
            next.previewEntryId === snapshot.previewEntryId &&
            next.fileViewOpen === snapshot.fileViewOpen &&
            next.terminalRefusal === snapshot.terminalRefusal &&
            next.tabs.length === snapshot.tabs.length &&
            next.tabs.every((tab, index) => tabSame(snapshot.tabs[index], tab))
        )
            return;
        // Unchanged rows keep their identity so a tab strip re-renders only the
        // tab that actually changed.
        snapshot = {
            activeViewId: next.activeViewId,
            fileViewOpen: next.fileViewOpen,
            maximized: next.maximized,
            open: next.open,
            tabs: next.tabs.map((tab, index) => {
                const before = snapshot.tabs[index];
                return before !== undefined && tabSame(before, tab) ? before : tab;
            }),
            ...(next.previewEntryId === undefined ? {} : { previewEntryId: next.previewEntryId }),
            ...(next.terminalRefusal === undefined
                ? {}
                : { terminalRefusal: next.terminalRefusal }),
        };
        for (const listener of listeners) listener();
    };

    /**
     * Writes the addressed group's arrangement down. Everything restorable is
     * derived from the tabs themselves, so there is no second copy of the panel
     * to keep in step with this one.
     */
    const remember = (): void => {
        if (!groupId || !deps.memoryWrite) return;
        const browsers = tabs.filter((tab) => tab.groupId === groupId && tab.kind === "browser");
        const activeIndex = browsers.findIndex((tab) => tab.id === activeViewId);
        deps.memoryWrite(groupId, {
            open,
            maximized,
            browsers: browsers.map((tab) => ({
                url: tab.url ?? "about:blank",
                label: tab.label,
                placement: tab.placement,
            })),
            active: activeIndex >= 0 ? { type: "browser", index: activeIndex } : { type: "files" },
        });
    };

    const terminalTabAdd = (group: RigGroupId, session: RigSessionId): void => {
        const id = `tab_${nextTabNumber}` as RigPanelTabId;
        // Terminals are numbered across the workspace rather than per group so a
        // label never silently means two different shells.
        const label = `Terminal ${nextTabNumber}`;
        nextTabNumber += 1;
        tabs.push({
            id,
            kind: "terminal",
            label,
            groupId: group,
            placement: "panel",
            terminal: deps.terminalOpen(session),
        });
        activeByGroup.set(group, id);
        activeViewId = id;
    };

    const browserTabAdd = (group: RigGroupId, candidate?: string, label?: string): void => {
        const url = candidate === undefined ? "about:blank" : browserUrl(candidate);
        if (!url) return;
        const id = `tab_${nextTabNumber}` as RigPanelTabId;
        nextTabNumber += 1;
        tabs.push({
            id,
            kind: "browser",
            label: label ?? browserLabel(url),
            groupId: group,
            placement: "panel",
            url,
        });
        activeByGroup.set(group, id);
        activeViewId = id;
    };

    const webappTabOpen = (group: RigGroupId, name: string, url: string): void => {
        const existing = tabs.find(
            (tab) => tab.groupId === group && tab.kind === "webapp" && tab.label === name,
        );
        if (existing) {
            existing.url = url;
            // Reopening a page the reader moved into the main content brings it
            // forward there, not here: pointing the panel at a tab it no longer
            // draws would leave the panel showing nothing at all.
            if (existing.placement === "panel") {
                activeByGroup.set(group, existing.id);
                activeViewId = existing.id;
            }
            return;
        }
        const id = `tab_${nextTabNumber}` as RigPanelTabId;
        nextTabNumber += 1;
        tabs.push({ id, kind: "webapp", label: name, groupId: group, placement: "panel", url });
        activeByGroup.set(group, id);
        activeViewId = id;
    };

    /**
     * Reads one group's remembered arrangement back, once, the first time it is
     * addressed. Its pages return where they were left; its terminals do not,
     * because the processes behind them ended with the previous run.
     */
    const groupRestore = (group: RigGroupId): void => {
        if (restoredGroupIds.has(group)) return;
        restoredGroupIds.add(group);
        const memory = deps.memoryRead?.(group);
        if (!memory) return;
        for (const browser of memory.browsers) {
            browserTabAdd(group, browser.url, browser.label);
            // A page left in the main content comes back to the main content.
            // Where it was being read is part of how the group was arranged.
            const added = tabs.at(-1);
            if (added && browser.placement) added.placement = browser.placement;
        }
        const restored = tabs.filter((tab) => tab.groupId === group && tab.kind === "browser");
        const remembered =
            memory.active.type === "browser" ? restored[memory.active.index] : undefined;
        // Only a tab the panel is actually drawing can be the panel's selection.
        const active = remembered?.placement === "panel" ? remembered.id : undefined;
        if (active) activeByGroup.set(group, active);
        else activeByGroup.delete(group);
        chromeByGroup.set(group, { open: memory.open, maximized: memory.maximized });
    };

    /** The tab the panel falls back to in this group, if it still draws one. */
    const panelSibling = (group: RigGroupId): Tab | undefined =>
        tabs.find((tab) => tab.groupId === group && tab.placement === "panel");

    const tabDispose = (index: number): void => {
        const [removed] = tabs.splice(index, 1);
        removed?.terminal?.[Symbol.dispose]();
        if (!removed) return;
        if (activeByGroup.get(removed.groupId) !== removed.id) return;
        const sibling = panelSibling(removed.groupId);
        if (sibling) {
            activeByGroup.set(removed.groupId, sibling.id);
            activeViewId = sibling.id;
        } else {
            activeByGroup.delete(removed.groupId);
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
            // A folded-away panel keeps no expansion: reopening it should give
            // back the column it was docked at, not swallow the workspace.
            if (!open) maximized = false;
            remember();
            recompute();
        },
        panelMaximizeToggle() {
            if (disposed || !open) return;
            maximized = !maximized;
            remember();
            recompute();
        },
        panelRestore() {
            if (disposed || !maximized) return;
            maximized = false;
            remember();
            recompute();
        },
        filesSelect() {
            if (disposed) return;
            activeViewId = "files";
            open = true;
            remember();
            recompute();
        },
        previewOpen(entryId) {
            if (disposed || !conversationId) return;
            previewEntryId = entryId;
            previewConversationId = conversationId;
            activeViewId = "preview";
            open = true;
            remember();
            recompute();
        },
        previewClose() {
            if (disposed) return;
            previewEntryId = undefined;
            previewConversationId = undefined;
            activeViewId = "files";
            remember();
            recompute();
        },
        fileViewOpen() {
            if (disposed) return;
            fileViewShown = true;
            activeViewId = "file";
            open = true;
            remember();
            recompute();
        },
        fileViewClose() {
            if (disposed) return;
            fileViewShown = false;
            if (activeViewId === "file") activeViewId = "files";
            remember();
            recompute();
        },
        terminalAdd() {
            if (disposed || !groupId || !conversationId || terminalRefusal !== undefined) return;
            terminalTabAdd(groupId, conversationId);
            open = true;
            remember();
            recompute();
        },
        browserAdd(url) {
            if (disposed || !groupId) return;
            browserTabAdd(groupId, url);
            open = true;
            remember();
            recompute();
        },
        webappOpen(name, url) {
            if (disposed || !groupId) return;
            webappTabOpen(groupId, name, url);
            open = true;
            remember();
            recompute();
        },
        browserUpdate(tabId, update) {
            if (disposed) return;
            const tab = tabs.find(
                (candidate) => candidate.id === tabId && candidate.kind === "browser",
            );
            if (!tab) return;
            const nextUrl = update.url === undefined ? undefined : browserUrl(update.url);
            if (nextUrl && nextUrl !== tab.url) {
                tab.url = nextUrl;
                tab.title = undefined;
            }
            if (update.title !== undefined) tab.title = update.title.trim() || undefined;
            tab.label = tab.title ? tab.title.slice(0, 80) : browserLabel(tab.url ?? "about:blank");
            remember();
            recompute();
        },
        tabSelect(tabId) {
            if (disposed) return;
            const tab = tabs.find((candidate) => candidate.id === tabId);
            if (!tab) return;
            activeByGroup.set(tab.groupId, tab.id);
            activeViewId = tab.id;
            remember();
            recompute();
        },
        tabClose(tabId) {
            if (disposed) return;
            const index = tabs.findIndex((candidate) => candidate.id === tabId);
            if (index < 0) return;
            tabDispose(index);
            remember();
            recompute();
        },
        tabPlacementUpdate(tabId, placement) {
            if (disposed) return;
            const tab = tabs.find((candidate) => candidate.id === tabId);
            if (!tab || tab.placement === placement) return;
            tab.placement = placement;
            if (placement === "panel") {
                // Arriving is being looked at: the reader moved this tab here,
                // so the panel shows it and opens if it was folded away.
                activeByGroup.set(tab.groupId, tab.id);
                activeViewId = tab.id;
                open = true;
            } else if (activeByGroup.get(tab.groupId) === tab.id) {
                // Leaving hands the panel's selection back to whatever the panel
                // still draws, and to Files when it draws nothing.
                const sibling = panelSibling(tab.groupId);
                if (sibling) {
                    activeByGroup.set(tab.groupId, sibling.id);
                    activeViewId = sibling.id;
                } else {
                    activeByGroup.delete(tab.groupId);
                    activeViewId = "files";
                }
            }
            // Expanded, the panel covers the whole workspace column. Sending a
            // tab to the main content while it is expanded would put the tab
            // somewhere the panel is standing in front of, so the panel steps
            // back to its docked width and lets the reader see where it went.
            if (placement === "main") maximized = false;
            remember();
            recompute();
        },

        terminal: (tabId) => tabs.find((tab) => tab.id === tabId)?.terminal,

        scopeApply(nextGroupId, nextConversationId, nextTerminalRefusal) {
            if (disposed) return;
            terminalRefusal = nextTerminalRefusal;
            conversationId = nextConversationId;
            if (previewConversationId !== nextConversationId) {
                previewEntryId = undefined;
                previewConversationId = undefined;
            }
            if (nextGroupId === groupId) {
                recompute();
                return;
            }
            if (groupId) chromeByGroup.set(groupId, { open, maximized });
            groupId = nextGroupId;
            // A file was opened out of one checkout, and a path only means
            // something inside that checkout, so it does not travel to the next
            // project.
            fileViewShown = false;
            if (nextGroupId) groupRestore(nextGroupId);
            const chrome = nextGroupId ? chromeByGroup.get(nextGroupId) : undefined;
            open = chrome?.open ?? false;
            maximized = (chrome?.open ?? false) && (chrome?.maximized ?? false);
            const remembered =
                nextGroupId === undefined ? undefined : activeByGroup.get(nextGroupId);
            const drawn = tabs.find(
                (tab) => tab.id === remembered && tab.placement === "panel",
            )?.id;
            activeViewId = drawn ?? "files";
            recompute();
        },

        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            for (const tab of tabs.splice(0)) tab.terminal?.[Symbol.dispose]();
            activeByGroup.clear();
            chromeByGroup.clear();
            listeners.clear();
        },
    };
}

/** Accepts only ordinary web locations plus the inert new-tab document we mint ourselves. */
function browserUrl(candidate: string): string | undefined {
    if (candidate === "about:blank") return candidate;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" || parsed.protocol === "https:"
            ? parsed.href
            : undefined;
    } catch {
        return undefined;
    }
}

function browserLabel(url: string): string {
    if (url === "about:blank") return "New Tab";
    try {
        return new URL(url).hostname.replace(/^www\./u, "") || "Browser";
    } catch {
        return "Browser";
    }
}
