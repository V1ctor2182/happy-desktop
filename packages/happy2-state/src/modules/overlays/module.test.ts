import { describe, expect, it } from "vitest";
import { overlaysStoreCreate } from "./overlaysState.js";

describe("overlays module", () => {
    it("keeps one overlay open at a time and preserves a typed query when reopened", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().overlaySearchOpen();
        overlays.getState().overlaySearchQueryUpdate("deploy");
        expect(overlays.getState().overlay).toEqual({ type: "search", query: "deploy" });

        overlays.getState().overlaySearchOpen();
        expect(overlays.getState().overlay).toEqual({ type: "search", query: "deploy" });

        overlays.getState().overlayProfileOpen("user-1");
        expect(overlays.getState().overlay).toEqual({ type: "profile", userId: "user-1" });

        overlays.getState().overlayClose();
        expect(overlays.getState().overlay).toEqual({ type: "closed" });
    });

    it("ignores a query update for an overlay that is not the search palette", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().overlayFileOpen("file-1");
        overlays.getState().overlaySearchQueryUpdate("ignored");
        expect(overlays.getState().overlay).toEqual({ type: "file", fileId: "file-1" });
    });

    it("changes only the presentation of an open app overlay", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().overlayAppOpen("inst-1", "modal");
        overlays.getState().overlayAppPresentationUpdate("fullscreen");
        expect(overlays.getState().overlay).toEqual({
            type: "app",
            instanceId: "inst-1",
            presentation: "fullscreen",
        });

        overlays.getState().overlayClose();
        overlays.getState().overlayAppPresentationUpdate("modal");
        expect(overlays.getState().overlay).toEqual({ type: "closed" });
    });

    it("closes an inspector-owned overlay together with the inspector", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().inspectorWorkspaceShow();
        overlays.getState().overlayWorkspaceFileOpen("chat-1", "sources/index.ts");
        overlays.getState().inspectorClose();
        expect(overlays.getState()).toMatchObject({
            inspector: { type: "closed" },
            overlay: { type: "closed" },
        });
    });

    it("leaves an independent overlay open when the inspector closes", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().inspectorInfoShow();
        overlays.getState().overlayProfileOpen("user-2");
        overlays.getState().inspectorClose();
        expect(overlays.getState()).toMatchObject({
            inspector: { type: "closed" },
            overlay: { type: "profile", userId: "user-2" },
        });
    });

    it("retires the inspector and chat-scoped overlays when the conversation changes", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().inspectorInfoShow();
        overlays.getState().overlayDocumentOpen("chat-1", "doc-1");

        overlays.getState().chatContextUpdate("chat-1");
        expect(overlays.getState()).toMatchObject({
            inspector: { type: "closed" },
            overlay: { type: "document", chatId: "chat-1", documentId: "doc-1" },
        });

        overlays.getState().inspectorWorkspaceShow();
        overlays.getState().chatContextUpdate("chat-2");
        expect(overlays.getState()).toMatchObject({
            inspector: { type: "closed" },
            overlay: { type: "closed" },
        });
    });

    it("dismisses every layer when the primary screen changes", () => {
        const overlays = overlaysStoreCreate();
        overlays.getState().inspectorInfoShow();
        overlays.getState().overlayFileOpen("file-9");
        overlays.getState().primaryContextUpdate();
        expect(overlays.getState()).toMatchObject({
            inspector: { type: "closed" },
            overlay: { type: "closed" },
        });
    });

    it("does not notify subscribers when a transition changes nothing", () => {
        const overlays = overlaysStoreCreate();
        let notifications = 0;
        const unsubscribe = overlays.subscribe(() => (notifications += 1));

        overlays.getState().overlayClose();
        overlays.getState().inspectorClose();
        overlays.getState().primaryContextUpdate();
        overlays.getState().chatContextUpdate("chat-1");
        expect(notifications).toBe(0);

        overlays.getState().overlaySearchOpen();
        expect(notifications).toBe(1);
        unsubscribe();
    });
});
