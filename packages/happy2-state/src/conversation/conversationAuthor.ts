import type { UserSummary } from "../types.js";

/**
 * Render-ready stable identity shared by every denormalized surface occurrence,
 * promoted out of the identity module so a conversation entry can name its
 * author without depending on the cloud account catalog. `kind` carries the
 * person/agent distinction both stacks already render differently; the local
 * stack synthesizes one person (the machine owner) and one agent (the model).
 */
export interface ConversationAuthor {
    readonly agentRole?: UserSummary["agentRole"];
    readonly id: string;
    readonly displayName: string;
    readonly username: string;
    readonly kind: UserSummary["kind"];
    readonly photoFileId?: string;
    /**
     * The session this author speaks for, when the author is another session
     * rather than a person or this session's own agent. A surface renders it as
     * a generated mark keyed by the session, so a message that arrived from
     * elsewhere is recognizable as coming from that particular elsewhere.
     */
    readonly sessionId?: string;
}
