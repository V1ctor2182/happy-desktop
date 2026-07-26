import type { ChatPageActions } from "./ChatPage.js";
import { emojiItems, type LiveChatMessage } from "./chatPageModels.js";

export interface ChatMessageReactionModelOptions {
    actions: ChatPageActions;
    onError(error: unknown): void;
}

/** Toggles the selected state of reaction chips already rendered on messages. */
export function chatMessageReactionModelCreate(options: ChatMessageReactionModelOptions) {
    async function reactionToggle(message: LiveChatMessage, emoji: string) {
        const source = message.serverMessage;
        if (!source) return;
        const resolved = emojiItems.find((item) => item.id === emoji)?.char ?? emoji;
        const selected = source.reactions.some(
            (reaction) => reaction.emoji === resolved && reaction.reacted,
        );
        try {
            if (selected) await options.actions.reactionRemove(source.chatId, source.id, resolved);
            else await options.actions.reactionAdd(source.chatId, source.id, resolved);
        } catch (error) {
            options.onError(error);
        }
    }
    return { reactionToggle };
}
