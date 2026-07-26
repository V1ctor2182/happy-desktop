import type { ConversationSummary } from "../conversation/conversationSummary.js";
import { rigConversationSummaryProject } from "./rigConversationProject.js";
import type {
    RigGroupId,
    RigProject,
    RigProjectAvatar,
    RigProjectCatalog,
    RigProjectId,
    RigSessionSummary,
    RigWorktreeId,
} from "./rigTypes.js";

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
    readonly conversations: readonly ConversationSummary[];
    /** Live marker of the busiest session in the worktree. */
    readonly activity: "running" | "awaitingInput" | "idle";
    /** Epoch milliseconds of the newest content in any of its sessions. */
    readonly updatedAt: number;
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
    /** Live marker of the busiest session in the project or any of its worktrees. */
    readonly activity: "running" | "awaitingInput" | "idle";
    /** Epoch milliseconds of the newest content anywhere under the project. */
    readonly updatedAt: number;
}

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
    const projectSessions = new Map<RigProjectId, RigSessionSummary[]>();
    const worktreeSessions = new Map<RigWorktreeId, RigSessionSummary[]>();
    for (const session of sessions) {
        const bucket = session.worktreeId
            ? mapAppend(worktreeSessions, session.worktreeId)
            : mapAppend(projectSessions, session.projectId);
        bucket.push(session);
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
            conversations,
            activity: activityOf(conversations),
            updatedAt: newestOf(conversations),
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
    const running =
        activityOf(conversations) === "running" ||
        worktrees.some((worktree) => worktree.activity === "running");
    return {
        id: project.id,
        name: project.name,
        orderKey: project.orderKey,
        path: project.path,
        displayPath: project.displayPath,
        kind: project.kind,
        conversations,
        worktrees,
        activity: running ? "running" : "idle",
        updatedAt: Math.max(
            newestOf(conversations),
            ...worktrees.map((worktree) => worktree.updatedAt),
            0,
        ),
        ...(project.avatar ? { avatar: project.avatar } : {}),
    };
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
    sessions: readonly RigSessionSummary[] | undefined,
): readonly ConversationSummary[] {
    return [...(sessions ?? [])].sort(byOrderKey).map(rigConversationSummaryProject);
}

function activityOf(
    conversations: readonly ConversationSummary[],
): "running" | "awaitingInput" | "idle" {
    return conversations.some((row) => row.activity === "running") ? "running" : "idle";
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
