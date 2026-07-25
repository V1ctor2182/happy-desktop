import { createStore, type StoreApi } from "zustand/vanilla";

/** How a plugin app overlay is presented over the primary surface. */
export type AppOverlayPresentation = "modal" | "fullscreen";

/**
 * One transient layer floating over the primary surface. Exactly one may be open
 * at a time: these are all focus-taking, dismissable surfaces, so opening a
 * second would leave the first unreachable behind it.
 */
export type OverlaySnapshot =
    | { readonly type: "closed" }
    | { readonly type: "search"; readonly query: string }
    | { readonly type: "profile"; readonly userId: string }
    | { readonly type: "file"; readonly fileId: string }
    | { readonly type: "workspaceFile"; readonly chatId: string; readonly path: string }
    | { readonly type: "document"; readonly chatId: string; readonly documentId: string }
    | {
          readonly type: "app";
          readonly instanceId: string;
          readonly presentation: AppOverlayPresentation;
      };

/**
 * The inspector docked beside an open conversation. Unlike an overlay it does not
 * take focus from the conversation, but it is still scoped to one chat and is
 * dropped when the conversation changes.
 */
export type InspectorSnapshot =
    | { readonly type: "closed" }
    | { readonly type: "info" }
    | { readonly type: "profile"; readonly userId: string }
    | { readonly type: "workspace" }
    | { readonly type: "documents" };

/**
 * The agent terminal docked in the conversation, if one is open. Like the
 * inspector it is scoped to one conversation and retires when that changes.
 */
export type TerminalPanelSnapshot =
    | { readonly type: "closed" }
    | { readonly type: "open"; readonly agentUserId: string };

export interface OverlaysSnapshot {
    readonly overlay: OverlaySnapshot;
    readonly inspector: InspectorSnapshot;
    readonly terminal: TerminalPanelSnapshot;
    /**
     * Bumped to re-read the open workspace file from the server. The reload is a
     * new lease of the same path, so the count is what distinguishes the second
     * lease from the first; nothing renders this number.
     */
    readonly workspaceFileGeneration: number;
}

export interface OverlaysState extends OverlaysSnapshot {
    overlaySearchOpen(): void;
    overlaySearchQueryUpdate(query: string): void;
    overlayProfileOpen(userId: string): void;
    overlayFileOpen(fileId: string): void;
    overlayWorkspaceFileOpen(chatId: string, path: string): void;
    overlayDocumentOpen(chatId: string, documentId: string): void;
    overlayAppOpen(instanceId: string, presentation: AppOverlayPresentation): void;
    overlayAppPresentationUpdate(presentation: AppOverlayPresentation): void;
    overlayClose(): void;
    inspectorInfoShow(): void;
    inspectorProfileShow(userId: string): void;
    inspectorWorkspaceShow(): void;
    inspectorDocumentsShow(): void;
    inspectorClose(): void;
    overlayWorkspaceFileReload(): void;
    terminalOpen(agentUserId: string): void;
    terminalClose(): void;
    chatContextUpdate(chatId?: string): void;
    primaryContextUpdate(): void;
}

export type OverlaysStore = StoreApi<OverlaysState>;

const closed: OverlaysSnapshot = {
    overlay: { type: "closed" },
    inspector: { type: "closed" },
    terminal: { type: "closed" },
    workspaceFileGeneration: 0,
};

/**
 * Creates the store for surfaces that float over, or dock beside, the primary
 * screen: the command palette, profile and file modals, plugin app overlays, and
 * the conversation inspector.
 *
 * These layers are deliberately not part of the URL. They are transient view
 * state a user does not expect to survive a reload or to travel in a shared
 * link, and modelling them as routes previously forced hand-written URL parsing,
 * formatting, and normalization for combinations most of which cannot coexist.
 * Keeping them here lets the router address only durable destinations.
 *
 * Both layers live in one store because they must be observed together: the
 * inspector and an overlay are closed by the same navigation, and the "close the
 * inspector, which also closes the overlay that depended on it" rule is a single
 * atomic transition that cannot be split across two independently notifying
 * stores.
 */
export function overlaysStoreCreate(): OverlaysStore {
    return createStore<OverlaysState>()((set) => ({
        ...closed,
        overlaySearchOpen(): void {
            // Reopening while already open preserves the typed query so a
            // repeated shortcut press does not clear what the user is typing.
            set((snapshot) =>
                snapshot.overlay.type === "search"
                    ? snapshot
                    : { ...snapshot, overlay: { type: "search", query: "" } },
            );
        },
        overlaySearchQueryUpdate(query): void {
            set((snapshot) =>
                snapshot.overlay.type === "search"
                    ? { ...snapshot, overlay: { type: "search", query } }
                    : snapshot,
            );
        },
        overlayProfileOpen(userId): void {
            set((snapshot) => ({ ...snapshot, overlay: { type: "profile", userId } }));
        },
        overlayFileOpen(fileId): void {
            set((snapshot) => ({ ...snapshot, overlay: { type: "file", fileId } }));
        },
        overlayWorkspaceFileOpen(chatId, path): void {
            set((snapshot) => ({ ...snapshot, overlay: { type: "workspaceFile", chatId, path } }));
        },
        overlayDocumentOpen(chatId, documentId): void {
            set((snapshot) => ({ ...snapshot, overlay: { type: "document", chatId, documentId } }));
        },
        overlayAppOpen(instanceId, presentation): void {
            set((snapshot) => ({
                ...snapshot,
                overlay: { type: "app", instanceId, presentation },
            }));
        },
        overlayAppPresentationUpdate(presentation): void {
            set((snapshot) =>
                snapshot.overlay.type === "app"
                    ? { ...snapshot, overlay: { ...snapshot.overlay, presentation } }
                    : snapshot,
            );
        },
        overlayWorkspaceFileReload(): void {
            set((snapshot) =>
                snapshot.overlay.type === "workspaceFile"
                    ? {
                          ...snapshot,
                          workspaceFileGeneration: snapshot.workspaceFileGeneration + 1,
                      }
                    : snapshot,
            );
        },
        terminalOpen(agentUserId): void {
            set((snapshot) =>
                snapshot.terminal.type === "open" && snapshot.terminal.agentUserId === agentUserId
                    ? snapshot
                    : { ...snapshot, terminal: { type: "open", agentUserId } },
            );
        },
        terminalClose(): void {
            set((snapshot) =>
                snapshot.terminal.type === "closed"
                    ? snapshot
                    : { ...snapshot, terminal: { type: "closed" } },
            );
        },
        overlayClose(): void {
            set((snapshot) =>
                snapshot.overlay.type === "closed"
                    ? snapshot
                    : { ...snapshot, overlay: { type: "closed" } },
            );
        },
        inspectorInfoShow(): void {
            set((snapshot) => ({ ...snapshot, inspector: { type: "info" } }));
        },
        inspectorProfileShow(userId): void {
            set((snapshot) => ({ ...snapshot, inspector: { type: "profile", userId } }));
        },
        inspectorWorkspaceShow(): void {
            set((snapshot) => ({ ...snapshot, inspector: { type: "workspace" } }));
        },
        inspectorDocumentsShow(): void {
            set((snapshot) => ({ ...snapshot, inspector: { type: "documents" } }));
        },
        inspectorClose(): void {
            // An overlay opened out of the inspector (a workspace file, a
            // document) has no reachable owner once the inspector is gone, so it
            // closes in the same transition rather than floating unexplained.
            set((snapshot) => {
                const dependent =
                    snapshot.overlay.type === "workspaceFile" ||
                    snapshot.overlay.type === "document";
                if (snapshot.inspector.type === "closed" && !dependent) return snapshot;
                return {
                    ...snapshot,
                    inspector: { type: "closed" },
                    overlay: dependent ? { type: "closed" } : snapshot.overlay,
                };
            });
        },
        chatContextUpdate(chatId): void {
            // The inspector and chat-scoped overlays describe one conversation.
            // Moving to a different conversation (or to none) retires them
            // instead of showing another chat's members or workspace file.
            set((snapshot) => {
                const overlay = snapshot.overlay;
                const scoped =
                    overlay.type === "workspaceFile" || overlay.type === "document"
                        ? overlay
                        : undefined;
                const keepOverlay = !scoped || (chatId !== undefined && scoped.chatId === chatId);
                if (
                    snapshot.inspector.type === "closed" &&
                    snapshot.terminal.type === "closed" &&
                    keepOverlay
                )
                    return snapshot;
                return {
                    ...snapshot,
                    inspector: { type: "closed" },
                    terminal: { type: "closed" },
                    overlay: keepOverlay ? overlay : { type: "closed" },
                };
            });
        },
        primaryContextUpdate(): void {
            // Any deliberate move to another primary screen dismisses every
            // floating layer, so navigation never leaves a stale modal covering
            // a screen it was not opened from.
            set((snapshot) =>
                snapshot.overlay.type === "closed" &&
                snapshot.inspector.type === "closed" &&
                snapshot.terminal.type === "closed"
                    ? snapshot
                    : { ...closed, workspaceFileGeneration: snapshot.workspaceFileGeneration },
            );
        },
    }));
}
