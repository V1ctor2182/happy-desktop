import type { RigProject, RigWorktree } from "./rigTypes.js";

/**
 * What may be done in one project or worktree right now.
 *
 * Writing and stopping are separate permissions on purpose. A checkout that has
 * gone away cannot take a message, a file save, or a new shell — but a session
 * that was already running in it is still running, and the reader must be able
 * to stop it. Tying the two together would leave work the reader can see, cannot
 * write to, and cannot end either.
 */
export interface RigGroupAccess {
    /** Whether work may be started in, or written into, this checkout. */
    readonly canWrite: boolean;
    /**
     * Whether work already running here may be stopped. Always true: stopping
     * acts on a process the host is running, not on the directory, so it does
     * not need the directory to be there.
     */
    readonly canAbort: boolean;
    /** Why writing is refused, in the host's terms. Absent exactly when `canWrite`. */
    readonly writeRefusal?: string;
}

/** Everything is allowed; the shared value for the ordinary case. */
export const RIG_GROUP_ACCESS_OPEN: RigGroupAccess = { canWrite: true, canAbort: true };

/**
 * Why work cannot be written into this worktree's checkout, read from the host's
 * raw record, or `undefined` when it can.
 *
 * This is deliberately the raw `status`/`presence` pair rather than the reduced
 * lifecycle the rows are drawn from. The lifecycle answers "what should the
 * reader be told", and it folds several states into `ready` because they look
 * alike on screen — a worktree being archived is still a present directory. That
 * reduction must never decide whether a session may be started: an archiving
 * checkout is about to be deleted, and starting work in it would race the
 * removal. Only the exact pair `status === "ready" && presence === "present"`
 * means a directory that is there and is going to stay there.
 */
export function rigWorktreeWriteRefusal(worktree: RigWorktree): string | undefined {
    if (worktree.status === "initializing") return "This workspace is still being created.";
    if (worktree.status === "failed" || worktree.status === "archive_failed") {
        return worktree.error === undefined
            ? "This workspace could not be created."
            : `This workspace could not be created. ${worktree.error}`;
    }
    if (worktree.status === "archiving") return "This workspace is being removed.";
    if (worktree.status === "archived") return "This workspace has been removed.";
    if (worktree.presence === "missing") return "This workspace's folder is no longer on disk.";
    // Everything that is left is `ready` and `present`. The check is written
    // this way round so a status added upstream is refused until it is
    // understood, rather than silently treated as usable.
    return worktree.status === "ready" ? undefined : "This workspace is not ready.";
}

/** Whether this worktree's checkout can take work, from the host's raw record. */
export function rigWorktreeWritable(worktree: RigWorktree): boolean {
    return rigWorktreeWriteRefusal(worktree) === undefined;
}

/**
 * Why work cannot be written into this project's directory, or `undefined` when
 * it can. A project is the folder Happy was pointed at, so the only thing that
 * can be wrong with it is that the folder is no longer there.
 */
export function rigProjectWriteRefusal(project: RigProject): string | undefined {
    return project.status === "ready" ? undefined : "This project's folder is no longer on disk.";
}

/** The access one refusal describes: writable when it is absent, stoppable either way. */
export function rigGroupAccessOf(writeRefusal: string | undefined): RigGroupAccess {
    return writeRefusal === undefined
        ? RIG_GROUP_ACCESS_OPEN
        : { canWrite: false, canAbort: true, writeRefusal };
}
