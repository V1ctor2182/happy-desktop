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
    readonly activity: "running" | "awaitingInput" | "idle";
    /** Epoch milliseconds of the newest content, for relative timestamps. */
    readonly updatedAt: number;
    readonly unread?: boolean;
    readonly mentions?: number;
    readonly avatarFileId?: string;
    readonly participants: readonly ConversationAuthor[];
}

/** The immutable list surface: what is loaded, what is selected, what failed. */
export interface ConversationListSnapshot {
    readonly conversations: Loadable<readonly ConversationSummary[]>;
    readonly selectedId?: string;
    /** Last failed create/fork/reset, surfaced without rejecting the action. */
    readonly mutationError?: UserError;
}
