import { useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { HappyState, NotificationProjection } from "happy2-state";

/**
 * Resolves a notification's label and destination from the live sidebar without
 * mirroring it. A notification carries only a chat id, so the conversation kind —
 * and therefore whether the destination is `/chats` or `/channels` — has to be
 * looked up in the sidebar projection at the moment the row is opened.
 */
export function useNotificationNavigation(state: HappyState) {
    const navigate = useNavigate();
    const sidebar = state.sidebar();
    const sidebarSnapshot = useSyncExternalStore(
        sidebar.subscribe,
        sidebar.getState,
        sidebar.getInitialState,
    );
    const chatFor = (chatId?: string) =>
        chatId ? sidebarSnapshot.chats.find((chat) => chat.id === chatId) : undefined;

    return {
        contextLabel(notification: NotificationProjection): string | undefined {
            const chat = chatFor(notification.chatId);
            if (chat) return chat.displayName;
            if (notification.chatId) return "Conversation";
            if (notification.kind === "call") return "Calls";
            if (notification.kind === "moderation") return "Administration";
            if (notification.kind === "automation") return "Automations";
            if (notification.kind === "system") return "System";
            return undefined;
        },
        open(notification: NotificationProjection): void {
            if (notification.kind === "call") {
                void navigate({ to: "/calls" });
                return;
            }
            const chatId = notification.chatId;
            if (!chatId) return;
            const chat = chatFor(chatId);
            const channel =
                chat?.chat.kind === "public_channel" || chat?.chat.kind === "private_channel";
            void navigate({
                params: { chatId },
                to: channel ? "/channels/$chatId" : "/chats/$chatId",
            });
        },
    };
}
