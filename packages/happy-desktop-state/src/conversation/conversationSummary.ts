import type { UserError } from "../types.js";
import type { ConversationAuthor } from "./conversationAuthor.js";
import type { Loadable } from "./loadable.js";

/**
 * One row of a conversation list. `subtitle` is the second line a reader needs
 * to tell two similar conversations apart — the working directory for a local
 * session, the participants or last message for a shared chat — and `activity`
 * is the live marker every agent-driven conversation wants regardless of stack.
 */
export interface ConversationSummary {
    readonly id: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly activity: "running" | "awaitingInput" | "waiting" | "idle";
    /** Epoch milliseconds of the newest content, for relative timestamps. */
    readonly updatedAt: number;
    readonly unread?: boolean;
    /**
     * The folder this conversation was filed into, absent while it is unsorted.
     *
     * Filing is an arrangement laid over the list rather than a move: a filed
     * conversation still belongs to the project it runs in and still takes its
     * row there. This is carried so a surface showing one folder can pick out
     * the conversations in it without a second read of the catalog.
     */
    readonly folderId?: string;
    readonly mentions?: number;
    readonly avatarFileId?: string;
    readonly participants: readonly ConversationAuthor[];
}

/**
 * The immutable list surface: what is loaded and what failed. Which conversation
 * is open is deliberately absent — that is addressed by the URL and owned by the
 * router, so no list store carries a competing selection.
 */
export interface ConversationListSnapshot {
    readonly conversations: Loadable<readonly ConversationSummary[]>;
    /** Last failed create/fork/reset, surfaced without rejecting the action. */
    readonly mutationError?: UserError;
}
