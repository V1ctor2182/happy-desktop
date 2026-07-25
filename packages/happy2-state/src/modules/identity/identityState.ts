import { type ConversationAuthor } from "../../conversation/conversationAuthor.js";
import { type UserSummary } from "../../types.js";
import { type ChatStore } from "../chat/chatState.js";
import { type StateRuntime } from "../runtime/runtimeState.js";

export interface IdentitiesReconcileContext {
    readonly runtime: StateRuntime;
    readonly identities: IdentityCatalog;
    chatsGet(): Iterable<readonly [string, ChatStore]>;
    directoryReconcile(): void;
    agentSecretsReconcile(): void;
    sidebarIdentityReconcile(identity: ConversationAuthor): void;
}

/** Fetches authoritative user presentations after a users hint and replaces affected retained rows only. */
export async function identitiesReconcile(context: IdentitiesReconcileContext): Promise<void> {
    const contacts = await context.runtime.operation("getContacts");
    for (const user of contacts.users) {
        const identity = context.identities.project(user);
        for (const [, binding] of context.chatsGet())
            binding.getState().chatInput({ type: "identityReconciled", identity });
        context.sidebarIdentityReconcile(identity);
    }
    context.directoryReconcile();
    context.agentSecretsReconcile();
}

/** Canonicalizes rare identity presentation changes for structural sharing across surface rows. */
export class IdentityCatalog {
    private readonly identities = new Map<string, ConversationAuthor>();

    project(user: UserSummary): ConversationAuthor {
        const existing = this.identities.get(user.id);
        const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");
        if (
            existing &&
            existing.displayName === displayName &&
            existing.username === user.username &&
            existing.kind === user.kind &&
            existing.agentRole === user.agentRole &&
            existing.photoFileId === user.photoFileId
        ) {
            return existing;
        }
        const next: ConversationAuthor = {
            ...(user.agentRole ? { agentRole: user.agentRole } : {}),
            id: user.id,
            displayName,
            username: user.username,
            kind: user.kind,
            ...(user.photoFileId ? { photoFileId: user.photoFileId } : {}),
        };
        this.identities.set(user.id, next);
        return next;
    }

    get(userId: string): ConversationAuthor | undefined {
        return this.identities.get(userId);
    }

    clear(): void {
        this.identities.clear();
    }
}
