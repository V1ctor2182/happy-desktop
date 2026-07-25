import type { ConversationSummary } from "../conversation/conversationSummary.js";
import { rigConversationSummaryProject } from "./rigConversationProject.js";
import type { RigSessionSummary } from "./rigTypes.js";

declare const rigFolderIdBrand: unique symbol;

/**
 * Branded identifier of a working directory in the local workspace. It is a hash
 * of the canonical `cwd` rather than the path itself, so it is a short, opaque,
 * URL-safe path segment that never has to be escaped and never leaks a user's
 * directory layout into the address bar.
 */
export type RigFolderId = string & { readonly [rigFolderIdBrand]: true };

/**
 * One working directory of the local workspace with every session started in it.
 * Local sessions belong to a directory the way a chat belongs to a channel, so
 * the directory — not the session — is what the list addresses; the sessions
 * inside it are its tabs, newest first.
 */
export interface RigSessionFolder {
    readonly id: RigFolderId;
    /** Canonical absolute path; the identity the hash is taken over. */
    readonly path: string;
    /** Presentation path (home-relative when the daemon supplied one). */
    readonly displayPath: string;
    /** Last path segment, the name the list row shows. */
    readonly name: string;
    readonly conversations: readonly ConversationSummary[];
    /** Live marker of the busiest session in the directory. */
    readonly activity: "running" | "awaitingInput" | "idle";
    /** Epoch milliseconds of the newest content in any of its sessions. */
    readonly updatedAt: number;
}

/**
 * Stable 32-bit FNV-1a hash of a canonical directory path, hex encoded. The
 * value only has to be deterministic and collision-resistant enough to address
 * one open window's directories; it is recomputed from durable state on every
 * projection and is never persisted or sent to the daemon.
 */
export function rigFolderIdOf(path: string): RigFolderId {
    let hash = 0x811c9dc5;
    for (let index = 0; index < path.length; index += 1) {
        hash ^= path.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0") as RigFolderId;
}

/** The last segment of a path, falling back to the path itself for a root. */
function folderName(path: string): string {
    const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? path;
}

/**
 * Groups the flat session catalog by working directory, preserving the incoming
 * session order inside each directory and ordering the directories by their
 * newest session. Both the grouping key and the id come from the canonical
 * `cwd`, so two sessions the daemon considers the same directory always land in
 * the same folder even when their presentation paths differ.
 */
export function rigSessionFoldersProject(
    sessions: readonly RigSessionSummary[],
): readonly RigSessionFolder[] {
    const folders = new Map<string, RigSessionSummary[]>();
    for (const session of sessions) {
        const existing = folders.get(session.cwd);
        if (existing) existing.push(session);
        else folders.set(session.cwd, [session]);
    }
    const projected: RigSessionFolder[] = [];
    for (const [path, entries] of folders) {
        const conversations = entries.map(rigConversationSummaryProject);
        const running = conversations.some((row) => row.activity === "running");
        projected.push({
            id: rigFolderIdOf(path),
            path,
            displayPath: entries[0]!.displayCwd || path,
            name: folderName(entries[0]!.displayCwd || path),
            conversations,
            activity: running ? "running" : "idle",
            updatedAt: conversations.reduce((newest, row) => Math.max(newest, row.updatedAt), 0),
        });
    }
    return projected.sort((left, right) => right.updatedAt - left.updatedAt);
}
