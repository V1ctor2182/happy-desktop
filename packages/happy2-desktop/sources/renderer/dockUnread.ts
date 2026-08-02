import type { RigDirectorySnapshot, RigDirectoryStore } from "./rigDirectoryStore";

/**
 * How many conversations are waiting for the person across every Rig in this
 * window.
 *
 * This counts exactly the fact the sidebar already draws a dot for: a
 * conversation summary's `unread`, which a Rig sets durably when a turn finishes
 * or an agent needs an answer. Reading the same projection rather than deriving
 * a second one is the point — the Dock and the sidebar cannot disagree about
 * what is waiting, and opening a conversation clears both at once because
 * `sessionRead` is what changes the underlying summary.
 *
 * Sessions in a project's worktrees are counted with the project's own, because
 * the Dock speaks for the whole window and a worktree is not a place a reader
 * would think to look separately.
 */
export function rigDirectoryUnreadCount(snapshot: RigDirectorySnapshot): number {
    let count = 0;
    for (const rig of snapshot.rigs)
        for (const project of rig.projects) {
            for (const conversation of project.conversations) if (conversation.unread) count += 1;
            for (const worktree of project.worktrees)
                for (const conversation of worktree.conversations)
                    if (conversation.unread) count += 1;
        }
    return count;
}

/**
 * Keeps the Dock's count following the Rig directory for as long as the window
 * lives, and returns the way to stop.
 *
 * The directory store is the one subscribed to rather than any Rig's workspace,
 * and that is what makes the count survive a connection: reconnecting replaces a
 * Rig's product stores, and the directory is what re-subscribes to the
 * replacement and republishes. A Rig that goes down empties its projects through
 * the same path, so a teardown reports zero rather than leaving the last number
 * it happened to have.
 *
 * The first count is reported immediately, so a window that opens with nothing
 * waiting states that instead of inheriting whatever was on the icon.
 */
export function dockUnreadPublish(
    directory: RigDirectoryStore,
    report: (count: number) => void,
): () => void {
    let published: number | undefined;
    const publish = () => {
        const count = rigDirectoryUnreadCount(directory.get());
        // Reconciles arrive constantly while an agent is working and almost none
        // of them change this number; only a change is worth an IPC message.
        if (count === published) return;
        published = count;
        report(count);
    };
    const unsubscribe = directory.subscribe(publish);
    publish();
    return unsubscribe;
}
