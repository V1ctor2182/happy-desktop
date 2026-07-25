import { createFileRoute } from "@tanstack/react-router";

/**
 * One direct conversation. It renders nothing itself: the workspace shell reads
 * `chatId` from this match and shows the conversation in its own workspace area,
 * which keeps the message list mounted as the selection moves between chats.
 */
export const Route = createFileRoute("/_workspace/chats/$chatId")({});
