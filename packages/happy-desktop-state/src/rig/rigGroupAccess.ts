import type { RigProject, RigWorktree } from "./rigTypes.js";

/**
 * What may be done in one project or worktree right now.
 *
 * Conversing, writing, and stopping are separate permissions on purpose.
 *
 * A checkout the host is still preparing has no directory to save a file into
 * or open a shell in, but Rig has already named where it will be and queues the
 * work a session sends until the checkout is there. So a chat can be started
 * and written into before the checkout exists, while everything that reaches
 * for the directory itself has to wait for it.
 *
 * Stopping is separate again: a checkout that has gone away still has whatever
 * was already running in it, and the reader must be able to end that. Tying the
 * three together would leave work the reader can see, cannot write to, and
 * cannot stop either.
 */
export interface RigGroupAccess {
    /**
     * Whether the checkout itself may be written into: files, shells, forks,
     * and everything else whose effect is a change on disk here and now.
     */
    readonly canWrite: boolean;
    /**
     * Whether work already running here may be stopped. Always true: stopping
     * acts on a process the host is running, not on the directory, so it does
     * not need the directory to be there.
     */
    readonly canAbort: boolean;
    /** Why writing is refused, in the host's terms. Absent exactly when `canWrite`. */
    readonly writeRefusal?: string;
    /**
     * Whether a conversation may be started here or sent to. Broader than
     * `canWrite`: a workspace still being prepared accepts chats, because the
     * host holds their work until the checkout is ready rather than failing it.
     */
    readonly canConverse: boolean;
    /** Why conversing is refused. Absent exactly when `canConverse`. */
    readonly conversationRefusal?: string;
}

/** Everything is allowed; the shared value for the ordinary case. */
export const RIG_GROUP_ACCESS_OPEN: RigGroupAccess = {
    canWrite: true,
    canAbort: true,
    canConverse: true,
};

/**
 * Why an id the catalog does not describe is refused.
 *
 * Not finding a group is never permission to write into it. There are exactly
 * two ways an id can be absent and they are not the same situation, so they are
 * not the same sentence: the catalog has not been read yet and nothing is known,
 * or it has been read and this id is not in it, which means the host has
 * withdrawn it. Both refuse; only the second is a removal.
 */
export const RIG_GROUP_UNREAD_REFUSAL = "Happy is still reading this Rig's workspaces.";
export const RIG_GROUP_UNLISTED_REFUSAL = "That project or workspace is no longer listed.";

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
    if (worktree.status === "failed") {
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
 * Why a conversation cannot be started in this worktree or sent to, or
 * `undefined` when it can.
 *
 * A workspace the host is still preparing is deliberately not refused. Rig
 * names the checkout before it has finished making it, and it holds a session's
 * work until the workspace turns ready rather than running it against a
 * directory that is not there. So the reader can open a workspace the moment
 * they ask for it, type into it, and have that first message run by itself once
 * the checkout lands. What is refused here is only what will never work: a
 * workspace that failed, one on its way out, and one whose folder is gone.
 */
export function rigWorktreeConversationRefusal(worktree: RigWorktree): string | undefined {
    if (worktree.status === "initializing") return undefined;
    return rigWorktreeWriteRefusal(worktree);
}

/**
 * Why work cannot be written into this project's directory, or `undefined` when
 * it can. A project is the folder Happy was pointed at, so the only thing that
 * can be wrong with it is that the folder is no longer there.
 */
export function rigProjectWriteRefusal(project: RigProject): string | undefined {
    return project.status === "ready" ? undefined : "This project's folder is no longer on disk.";
}

/**
 * The access these two refusals describe. Stopping is allowed either way.
 *
 * `conversationRefusal` defaults to `writeRefusal` because the two answers
 * differ only where a place can take a chat but not a change on disk. A caller
 * that has one sentence for the whole group — an id the catalog does not
 * describe at all, above all — is saying both, and saying it once is how it
 * cannot say two different things by accident.
 */
export function rigGroupAccessOf(
    writeRefusal: string | undefined,
    conversationRefusal: string | undefined = writeRefusal,
): RigGroupAccess {
    if (writeRefusal === undefined && conversationRefusal === undefined)
        return RIG_GROUP_ACCESS_OPEN;
    return {
        canWrite: writeRefusal === undefined,
        canAbort: true,
        ...(writeRefusal === undefined ? {} : { writeRefusal }),
        canConverse: conversationRefusal === undefined,
        ...(conversationRefusal === undefined ? {} : { conversationRefusal }),
    };
}
