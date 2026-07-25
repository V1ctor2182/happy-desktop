import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, onTestFinished } from "vitest";
import { App } from "../../sources/App";
import { appMemoryHistoryCreate, appRouterCreate } from "../../sources/navigation/appRouter";

describe("workspace route rendering", () => {
    it.each([
        "/chats",
        "/chats/chat-1",
        "/channels",
        "/channels/channel-1",
        "/home",
        "/activity",
        "/calls",
        "/files",
        "/documents",
        "/documents/document-1",
        "/apps",
        "/apps/installation-1",
        "/admin/users",
    ])("renders %s through the real route tree", async (url) => {
        const router = appRouterCreate(appMemoryHistoryCreate(url));
        onTestFinished(() => router.history.destroy());

        const screen = render(<App router={router} />);

        await waitFor(() => {
            expect(screen.container.querySelector('[data-happy2-ui="sidebar"]')).not.toBeNull();
        });
        expect(screen.container.textContent).not.toContain("Cannot read properties of undefined");
    });

    it("keeps one workspace shell mounted while the active screen changes", async () => {
        const router = appRouterCreate(appMemoryHistoryCreate("/chats"));
        onTestFinished(() => router.history.destroy());
        const screen = render(<App router={router} />);
        const sidebar = await waitFor(() => {
            const current = screen.container.querySelector('[data-happy2-ui="sidebar"]');
            expect(current).not.toBeNull();
            return current;
        });
        const sidebarBody = sidebar!.querySelector<HTMLElement>('[data-happy2-ui="sidebar-body"]')!;
        const compose = screen.getByRole("button", { name: "New chat" });
        sidebarBody.scrollTop = 48;
        compose.focus();
        expect(document.activeElement).toBe(compose);

        await router.navigate({ to: "/home" });
        await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
        expect(screen.container.querySelector('[data-happy2-ui="sidebar"]')).toBe(sidebar);
        expect(screen.container.querySelector('[data-happy2-ui="sidebar-body"]')).toBe(sidebarBody);
        expect(sidebarBody.scrollTop).toBe(48);
        expect(document.activeElement).toBe(compose);

        await router.navigate({ params: { chatId: "chat-1" }, to: "/chats/$chatId" });
        await waitFor(() => expect(router.state.location.pathname).toBe("/chats/chat-1"));
        expect(screen.container.querySelector('[data-happy2-ui="sidebar"]')).toBe(sidebar);
        expect(sidebarBody.scrollTop).toBe(48);
        expect(document.activeElement).toBe(compose);

        await router.navigate({ params: { chatId: "chat-2" }, to: "/chats/$chatId" });
        await waitFor(() => expect(router.state.location.pathname).toBe("/chats/chat-2"));
        expect(screen.container.querySelector('[data-happy2-ui="sidebar"]')).toBe(sidebar);
        expect(sidebarBody.scrollTop).toBe(48);
        expect(document.activeElement).toBe(compose);
    });
});
