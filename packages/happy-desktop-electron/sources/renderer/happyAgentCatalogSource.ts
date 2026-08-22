import {
    type GitChangeSnapshot,
    type GroupSession,
    type ProjectGroup,
    type RigConnection,
    type RigGitChangedFile,
    type RigPermissionMode,
    type RigProject,
    type RigProjectAvatar,
    type RigProjectCatalog,
    type RigProjectId,
    type RigServiceTier,
    type RigSessionCatalogSnapshot,
    type RigSessionCatalogSource,
    type RigSessionId,
    type RigSessionStatus,
    type RigSessionSummary,
    type RigThinkingLevel,
    type RigWorktree,
    type RigWorktreeId,
} from "happy-desktop-state";

/**
 * Projects the Happy Agent connection's live group tree into Happy's closed
 * catalog source. The connection owns bootstrap, gap recovery, and reconnects;
 * this adapter only holds the newest complete projection for synchronous reads.
 */
export function happyAgentCatalogSourceCreate(
    rig: RigConnection,
    baseUrl: string,
): RigSessionCatalogSource {
    const base = baseUrl.replace(/\/$/, "");
    let snapshot: RigSessionCatalogSnapshot | undefined;
    let connection: ReturnType<RigConnection["connectGroups"]> | undefined;
    let disposed = false;
    const listeners = new Set<() => void>();
    const errorListeners = new Set<(error: unknown) => void>();
    const waiting = new Set<{
        resolve: (value: RigSessionCatalogSnapshot) => void;
        reject: (error: unknown) => void;
    }>();

    const publish = (projects: readonly ProjectGroup[]): void => {
        if (disposed) return;
        snapshot = catalogProject(projects, base);
        for (const waiter of waiting) waiter.resolve(snapshot);
        waiting.clear();
        for (const listener of listeners) listener();
    };

    const fail = (error: unknown): void => {
        if (disposed) return;
        for (const waiter of waiting) waiter.reject(error);
        waiting.clear();
        for (const listener of errorListeners) listener(error);
    };

    const start = (): void => {
        if (disposed || connection) return;
        connection = rig.connectGroups({
            onChange: (projects, state) => {
                if (!state.sessionsComplete) return;
                publish(projects);
            },
            onError: fail,
        });
    };

    return {
        read() {
            if (disposed) return Promise.reject(new Error("The Rig catalog source is disposed."));
            if (snapshot) return Promise.resolve(snapshot);
            start();
            return new Promise<RigSessionCatalogSnapshot>((resolve, reject) => {
                waiting.add({ resolve, reject });
            });
        },
        subscribe(listener, onError) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            errorListeners.add(onError);
            start();
            return () => {
                listeners.delete(listener);
                errorListeners.delete(onError);
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            connection?.close();
            connection = undefined;
            const error = new Error("The Rig catalog source was disposed.");
            for (const waiter of waiting) waiter.reject(error);
            waiting.clear();
            listeners.clear();
            errorListeners.clear();
        },
    };
}

function catalogProject(
    groups: readonly ProjectGroup[],
    baseUrl: string,
): RigSessionCatalogSnapshot {
    const projects: RigProject[] = [];
    const worktrees: RigWorktree[] = [];
    const sessions: RigSessionSummary[] = [];

    for (const group of groups) {
        projects.push(projectProject(group, baseUrl));
        sessions.push(...group.sessions.filter((session) => !session.archived).map(sessionProject));
        for (const workspace of group.workspaces) {
            worktrees.push({
                id: workspace.id as RigWorktreeId,
                projectId: group.id as RigProjectId,
                name: workspace.name,
                orderKey: workspace.orderKey,
                path: workspace.path,
                displayPath: workspace.path,
                status: workspace.status,
                presence: workspace.presence,
                // The host's own sentence about a failed checkout, carried
                // whole. It is present only while the workspace it belongs to
                // reports one, so a workspace that stops failing stops carrying
                // a reason rather than keeping the last one it had.
                ...(workspace.error === undefined ? {} : { error: workspace.error }),
                ...gitProject(workspace.git),
            });
            sessions.push(
                ...workspace.sessions.filter((session) => !session.archived).map(sessionProject),
            );
        }
    }

    const catalog: RigProjectCatalog = { projects, worktrees };
    return { catalog, sessions };
}

function projectProject(group: ProjectGroup, baseUrl: string): RigProject {
    const avatar = avatarProject(group.avatar, baseUrl);
    return {
        id: group.id as RigProjectId,
        name: group.name,
        orderKey: group.orderKey,
        path: group.path,
        displayPath: group.path,
        kind: group.kind,
        status: group.initializationStatus,
        presence: group.presence,
        ...(group.initializationError === undefined ? {} : { error: group.initializationError }),
        ...(group.remoteSource === undefined ? {} : { remoteSource: group.remoteSource }),
        ...(group.requiredSecretKind === undefined
            ? {}
            : { requiredSecretKind: group.requiredSecretKind }),
        ...(avatar ? { avatar } : {}),
        ...gitProject(group.git),
    };
}

function avatarProject(value: object | undefined, baseUrl: string): RigProjectAvatar | undefined {
    if (value === undefined) return undefined;
    const avatar = value as {
        readonly url?: unknown;
        readonly width?: unknown;
        readonly height?: unknown;
    };
    if (
        typeof avatar.url !== "string" ||
        typeof avatar.width !== "number" ||
        typeof avatar.height !== "number"
    ) {
        return undefined;
    }
    return {
        url: avatar.url.startsWith("/") ? `${baseUrl}${avatar.url}` : avatar.url,
        width: avatar.width,
        height: avatar.height,
    };
}

function gitProject(
    git: GitChangeSnapshot | undefined,
): Pick<RigProject, "changedFiles" | "addedLines" | "deletedLines" | "changes"> {
    if (git === undefined) return {};
    return {
        changedFiles: git.changedFiles,
        addedLines: git.insertions,
        deletedLines: git.deletions,
        changes: git.files.map((file) => ({
            path: file.path,
            ...(file.previousPath ? { previousPath: file.previousPath } : {}),
            ...(git.baseRevision === undefined ? {} : { baseRevision: git.baseRevision }),
            // A binary file has no lines to count, and saying "+0 −0" about one
            // reads as an empty change rather than as an unmeasurable one.
            ...(file.binary || file.insertions === undefined
                ? {}
                : { addedLines: file.insertions }),
            ...(file.binary || file.deletions === undefined
                ? {}
                : { deletedLines: file.deletions }),
            status: gitStatusProject(file.status),
            revision: [
                git.revision ?? `${git.generation}:${String(git.version)}`,
                git.baseRevision ?? "",
                file.path,
                file.status,
                file.staged ? "staged" : "",
                file.unstaged ? "unstaged" : "",
            ].join(":"),
        })),
    };
}

function gitStatusProject(status: string): RigGitChangedFile["status"] {
    if (status === "added") return "added";
    if (status === "deleted") return "deleted";
    if (status === "renamed" || status === "copied") return "renamed";
    if (status === "untracked") return "untracked";
    return "modified";
}

function sessionProject(session: GroupSession): RigSessionSummary {
    const effort = thinkingLevel(session.effort);
    const serviceTier = session.serviceTier === "fast" ? ("fast" as RigServiceTier) : undefined;
    return {
        id: session.id as RigSessionId,
        projectId: session.scope.projectId as RigProjectId,
        ...(session.scope.kind === "workspace"
            ? { worktreeId: session.scope.workspaceId as RigWorktreeId }
            : {}),
        ...(session.orderKey === undefined ? {} : { orderKey: session.orderKey }),
        ...(session.parentSessionId === undefined
            ? {}
            : { parentSessionId: session.parentSessionId as RigSessionId }),
        cwd: session.cwd,
        displayCwd: session.cwd,
        providerId: session.providerId,
        modelId: session.modelId,
        permissionMode: permissionMode(session.permissionMode),
        ...(effort ? { effort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        status: session.status as RigSessionStatus,
        ...(session.wait === undefined
            ? {}
            : { wait: { startedAt: session.wait.startedAt, dueAt: session.wait.dueAt } }),
        ...(session.unread === undefined ? {} : { unreadReason: session.unread.reason }),
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.recap === undefined ? {} : { recap: session.recap }),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.lastMessageAt === undefined ? {} : { lastMessageAt: session.lastMessageAt }),
        ...(session.draft === undefined ? {} : { draft: session.draft }),
        ...(session.draftUpdatedAt === undefined ? {} : { draftUpdatedAt: session.draftUpdatedAt }),
    };
}

export function permissionMode(value: string): RigPermissionMode {
    if (
        value === "auto" ||
        value === "workspace_write" ||
        value === "read_only" ||
        value === "full_access"
    ) {
        return value;
    }
    return "auto";
}

export function thinkingLevel(value: string | undefined): RigThinkingLevel | undefined {
    if (
        value === "off" ||
        value === "on" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh" ||
        value === "max" ||
        value === "ultra"
    ) {
        return value;
    }
    return undefined;
}
