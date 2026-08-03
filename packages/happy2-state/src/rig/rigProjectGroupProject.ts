import type { ConversationSummary } from "../conversation/conversationSummary.js";
import { rigConversationSummaryProject } from "./rigConversationProject.js";
import type {
    RigGroupId,
    RigProject,
    RigProjectAvatar,
    RigProjectCatalog,
    RigProjectId,
    RigSessionId,
    RigSessionSummary,
    RigWorktree,
    RigWorktreeId,
} from "./rigTypes.js";

/**
 * Where a worktree is in its life, as the host reports it.
 *
 * A worktree is listed from the moment it is asked for, so the row exists long
 * before its checkout does and can outlive the checkout it names. These are the
 * phases the host actually distinguishes:
 *
 * - `creating` — the checkout is being prepared. The row is addressable and
 *   named, but its directory does not exist yet, so nothing can run in it.
 * - `ready` — the checkout is prepared and present.
 * - `missing` — the checkout was prepared and its directory is no longer there.
 *   Nothing in Happy did that; it is what the host sees on disk now.
 * - `failed` — the host could not prepare the checkout, carrying its own reason
 *   when it gives one. Terminal: nothing further happens to this worktree.
 *
 * Being archived is deliberately not a phase. The host stops listing a worktree
 * the moment its archival begins, so "on its way out" is not something this list
 * can observe — see the filter in `rigProjectGroupsProject`.
 */
export type RigWorktreeLifecycle =
    | { readonly phase: "creating" }
    | { readonly phase: "ready" }
    | { readonly phase: "missing" }
    | { readonly phase: "failed"; readonly reason?: string };

/**
 * One of a project's git worktrees with the sessions running in it. A worktree is
 * a branch someone is working on in parallel, so its sessions list under it
 * rather than beside the project's own — the same way a project's sessions list
 * under the project.
 */
export interface RigWorktreeGroup {
    readonly id: RigWorktreeId;
    readonly projectId: RigProjectId;
    /** Name the daemon reserved for the worktree; the row's label. */
    readonly name: string;
    /** Fractional index this worktree sorts by among its project's worktrees. */
    readonly orderKey: string;
    readonly path: string;
    readonly displayPath: string;
    /**
     * Whether this worktree's checkout is being prepared, usable, gone, or was
     * never made at all. Every row carries one: a worktree that exists is always
     * somewhere in that sequence, and a row saying nothing about it would be a
     * row the reader has to guess at.
     */
    readonly lifecycle: RigWorktreeLifecycle;
    readonly conversations: readonly ConversationSummary[];
    /** Live marker of the busiest session in the worktree. */
    readonly activity: "running" | "awaitingInput" | "waiting" | "idle";
    /** Epoch milliseconds of the newest content in any of its sessions. */
    readonly updatedAt: number;
    readonly changedFiles?: number;
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: RigWorktree["changes"];
}

/**
 * One project of the local workspace with every session filed under it. The
 * daemon owns projects durably — it derives their name from the git remote and
 * their picture from the repository or its hosting provider — so the list
 * addresses the project, not the working directory: `id` survives a restart and
 * a rename, and no filesystem layout reaches the address bar.
 */
export interface RigProjectGroup {
    readonly id: RigProjectId;
    readonly name: string;
    /** Fractional index this project sorts by in the list. */
    readonly orderKey: string;
    readonly path: string;
    readonly displayPath: string;
    /** `home` is the catch-all project for sessions started outside any repository. */
    readonly kind: "regular" | "home";
    readonly avatar?: RigProjectAvatar;
    /** Sessions in the project itself, i.e. not in one of its worktrees. */
    readonly conversations: readonly ConversationSummary[];
    readonly worktrees: readonly RigWorktreeGroup[];
    /** Live marker of the busiest session directly in the project. */
    readonly activity: "running" | "awaitingInput" | "waiting" | "idle";
    /** Epoch milliseconds of the newest content anywhere under the project. */
    readonly updatedAt: number;
    readonly changedFiles?: number;
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: RigProject["changes"];
}

/** A session the host has given a position, and which therefore takes a row. */
type RigPlacedSession = RigSessionSummary & { readonly orderKey: string };

/**
 * Groups the flat session catalog under the daemon's projects and worktrees,
 * preserving the incoming session order inside each group and ordering the
 * projects by their newest session. A project with no sessions is still listed —
 * it is a place to start one — while a worktree only appears once it has work in
 * it.
 *
 * Sessions whose project the catalog does not describe are dropped rather than
 * guessed at: the catalog and the session list are read together, so the only way
 * to see one is a session created between the two reads, and the very next
 * reconcile lists it.
 */
export function rigProjectGroupsProject(
    catalog: RigProjectCatalog,
    sessions: readonly RigSessionSummary[],
): readonly RigProjectGroup[] {
    const projectSessions = new Map<RigProjectId, RigPlacedSession[]>();
    const worktreeSessions = new Map<RigWorktreeId, RigPlacedSession[]>();
    for (const session of sessions) {
        // No position, no place in the list. A subagent runs under the session
        // that started it and is reachable through that session; giving it a row
        // of its own would put a session nobody opened in the tab strip and
        // leave the drag order with rows the host will not reorder.
        if (session.orderKey === undefined) continue;
        const placed: RigPlacedSession = { ...session, orderKey: session.orderKey };
        const bucket = session.worktreeId
            ? mapAppend(worktreeSessions, session.worktreeId)
            : mapAppend(projectSessions, session.projectId);
        bucket.push(placed);
    }

    const worktreesByProject = new Map<RigProjectId, RigWorktreeGroup[]>();
    for (const worktree of catalog.worktrees) {
        // A worktree being torn down is already gone as far as the reader is
        // concerned: they asked for it. Listing it again between "archiving" and
        // "archived" would take the row away, put it back, and take it away
        // again. A failed archive stays listed — it still exists.
        if (worktree.status === "archived" || worktree.status === "archiving") continue;
        // A worktree is listed as soon as it exists, before anything has run in
        // it: it was created deliberately and is where the next session goes, so
        // an empty one is a destination rather than clutter.
        const conversations = conversationsOf(worktreeSessions.get(worktree.id));
        mapAppend(worktreesByProject, worktree.projectId).push({
            id: worktree.id,
            projectId: worktree.projectId,
            name: worktree.name,
            orderKey: worktree.orderKey,
            path: worktree.path,
            displayPath: worktree.displayPath,
            lifecycle: worktreeLifecycleOf(worktree),
            conversations,
            activity: activityOf(conversations),
            updatedAt: newestOf(conversations),
            ...(worktree.changedFiles === undefined ? {} : { changedFiles: worktree.changedFiles }),
            ...(worktree.addedLines === undefined ? {} : { addedLines: worktree.addedLines }),
            ...(worktree.deletedLines === undefined ? {} : { deletedLines: worktree.deletedLines }),
            ...(worktree.changes === undefined ? {} : { changes: worktree.changes }),
        });
    }

    const groups = catalog.projects.map((project) =>
        projectGroup(
            project,
            conversationsOf(projectSessions.get(project.id)),
            (worktreesByProject.get(project.id) ?? []).sort(byOrderKey),
        ),
    );
    return groups.sort(byOrderKey);
}

function projectGroup(
    project: RigProject,
    conversations: readonly ConversationSummary[],
    worktrees: readonly RigWorktreeGroup[],
): RigProjectGroup {
    return {
        id: project.id,
        name: project.name,
        orderKey: project.orderKey,
        path: project.path,
        displayPath: project.displayPath,
        kind: project.kind,
        conversations,
        worktrees,
        // A project and each of its worktrees are independent destinations.
        // Child activity belongs on the child row rather than bubbling upward.
        activity: activityOf(conversations),
        updatedAt: Math.max(
            newestOf(conversations),
            ...worktrees.map((worktree) => worktree.updatedAt),
            0,
        ),
        ...(project.avatar ? { avatar: project.avatar } : {}),
        ...(project.changedFiles === undefined ? {} : { changedFiles: project.changedFiles }),
        ...(project.addedLines === undefined ? {} : { addedLines: project.addedLines }),
        ...(project.deletedLines === undefined ? {} : { deletedLines: project.deletedLines }),
        ...(project.changes === undefined ? {} : { changes: project.changes }),
    };
}

/*
 * The phases with nothing else to say are shared objects rather than fresh ones,
 * so a reconcile that changed a session cannot hand a worktree row a new
 * lifecycle object and make an otherwise unchanged row compare as changed.
 */
const LIFECYCLE_CREATING: RigWorktreeLifecycle = { phase: "creating" };
const LIFECYCLE_READY: RigWorktreeLifecycle = { phase: "ready" };
const LIFECYCLE_MISSING: RigWorktreeLifecycle = { phase: "missing" };
const LIFECYCLE_FAILED: RigWorktreeLifecycle = { phase: "failed" };

/**
 * Reads the host's worktree record as the phase a reader can act on.
 *
 * Preparation and presence are two separate facts about the same checkout, and
 * only their combination says what the reader is looking at: a checkout that was
 * never made is not the same thing as one that was made and then removed, and
 * showing both as "not there" would hide which of the two happened.
 *
 * `archive_failed` reads as `failed` rather than as a phase of its own. It is a
 * value Happy's transport type still admits and the host no longer produces —
 * archival either finishes or leaves the worktree listed as it was — so giving
 * it its own presentation would be building a screen for something nothing
 * sends.
 */
function worktreeLifecycleOf(worktree: RigWorktree): RigWorktreeLifecycle {
    if (worktree.status === "initializing") return LIFECYCLE_CREATING;
    if (worktree.status === "failed" || worktree.status === "archive_failed") {
        return worktree.error === undefined
            ? LIFECYCLE_FAILED
            : { phase: "failed", reason: worktree.error };
    }
    return worktree.presence === "missing" ? LIFECYCLE_MISSING : LIFECYCLE_READY;
}

/**
 * The arrangement the user dragged, as the host records it: fractional index
 * first, then id to break the tie the host breaks the same way. Sorting on the
 * key rather than on recency is what keeps a dragged row where it was put
 * instead of letting the next message throw it back to the top.
 */
function byOrderKey(
    left: { readonly orderKey: string; readonly id: string },
    right: { readonly orderKey: string; readonly id: string },
): number {
    if (left.orderKey !== right.orderKey) return left.orderKey < right.orderKey ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * One group's rows in the arrangement the host records. The sessions are sorted
 * here rather than trusted in arrival order because an optimistic reorder
 * rewrites only the moved row's key: sorting on the key is what moves the row.
 */
function conversationsOf(
    sessions: readonly RigPlacedSession[] | undefined,
): readonly ConversationSummary[] {
    return [...(sessions ?? [])].sort(byOrderKey).map(rigConversationSummaryProject);
}

function activityOf(
    conversations: readonly ConversationSummary[],
): "running" | "awaitingInput" | "waiting" | "idle" {
    if (conversations.some((row) => row.activity === "awaitingInput")) return "awaitingInput";
    // Waiting is a low-priority modifier: one session doing real work makes the
    // whole group read as working, and only a group where nothing runs at all
    // wears the clock.
    if (conversations.some((row) => row.activity === "running")) return "running";
    return conversations.some((row) => row.activity === "waiting") ? "waiting" : "idle";
}

function newestOf(conversations: readonly ConversationSummary[]): number {
    return conversations.reduce((newest, row) => Math.max(newest, row.updatedAt), 0);
}

function mapAppend<Key, Value>(map: Map<Key, Value[]>, key: Key): Value[] {
    const existing = map.get(key);
    if (existing) return existing;
    const created: Value[] = [];
    map.set(key, created);
    return created;
}

/** The group a session lists under: its worktree when it has one, otherwise its project. */
export function rigSessionGroupIdOf(session: {
    readonly projectId: RigProjectId;
    readonly worktreeId?: RigWorktreeId;
}): RigGroupId {
    return session.worktreeId ?? session.projectId;
}
