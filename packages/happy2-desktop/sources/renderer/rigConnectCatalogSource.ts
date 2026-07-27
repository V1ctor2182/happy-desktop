import {
    connectGroups,
    type GitChangeSnapshot,
    type GroupSession,
    type ProjectGroup,
} from "@slopus/rig-connect";
import type {
    RigGitChangedFile,
    RigPermissionMode,
    RigProject,
    RigProjectAvatar,
    RigProjectCatalog,
    RigProjectId,
    RigServiceTier,
    RigSessionCatalogSnapshot,
    RigSessionCatalogSource,
    RigSessionId,
    RigSessionStatus,
    RigSessionSummary,
    RigThinkingLevel,
    RigWorktree,
    RigWorktreeId,
} from "happy2-state";

const LOCAL_PROXY_TOKEN = "happy2-local-capability";

export interface RigConnectCatalogFallback {
    read(): Promise<RigSessionCatalogSnapshot>;
    subscribe(listener: () => void, onError: (error: unknown) => void): () => void;
}

/**
 * Adapts `rig-connect`'s complete live group tree to Happy's closed catalog
 * projection. The source owns one stream; all list reads return its latest
 * immutable snapshot rather than asking the daemon to reconstruct the catalog.
 *
 * Older daemons replay retained events without first sending a complete
 * `hello`. Those events are not a catalog. Until a real hello moves the
 * connection to `live`, the existing complete reader remains authoritative.
 */
export function rigConnectCatalogSourceCreate(
    baseUrl: string,
    fallback: RigConnectCatalogFallback,
): RigSessionCatalogSource {
    const base = baseUrl.replace(/\/$/, "");
    const endpoint = `${base}/rig-connect`;
    let snapshot: RigSessionCatalogSnapshot | undefined;
    let connection: ReturnType<typeof connectGroups> | undefined;
    let fallbackUnsubscribe: (() => void) | undefined;
    let fallbackReading: Promise<void> | undefined;
    let live = false;
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

    const fallbackRead = (): Promise<void> => {
        fallbackReading ??= fallback
            .read()
            .then((next) => {
                if (disposed || live) return;
                snapshot = next;
                for (const waiter of waiting) waiter.resolve(next);
                waiting.clear();
                for (const listener of listeners) listener();
            })
            .catch(fail)
            .finally(() => {
                fallbackReading = undefined;
            });
        return fallbackReading;
    };

    const start = (): void => {
        if (disposed || connection) return;
        fallbackUnsubscribe = fallback.subscribe(() => void fallbackRead(), fail);
        connection = connectGroups({
            endpoint,
            token: LOCAL_PROXY_TOKEN,
            onChange: (projects, state) => {
                if (state.connection !== "live") return;
                live = true;
                fallbackUnsubscribe?.();
                fallbackUnsubscribe = undefined;
                publish(projects);
            },
            onError: fail,
        });
        void fallbackRead();
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
            fallbackUnsubscribe?.();
            fallbackUnsubscribe = undefined;
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
        sessions.push(...group.sessions.map(sessionProject));
        for (const workspace of group.workspaces) {
            worktrees.push({
                id: workspace.id as RigWorktreeId,
                projectId: group.id as RigProjectId,
                name: workspace.title ?? workspace.name,
                orderKey: workspace.orderKey,
                path: workspace.path,
                displayPath: workspace.path,
                status: workspace.status,
                ...gitProject(workspace.git),
            });
            sessions.push(...workspace.sessions.map(sessionProject));
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
        status: group.presence === "present" ? "ready" : "failed",
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
            status: gitStatusProject(file.status),
            revision: [
                git.revision ?? `${git.generation}:${String(git.version)}`,
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
        projectId: session.projectId as RigProjectId,
        ...(session.workspaceId ? { worktreeId: session.workspaceId as RigWorktreeId } : {}),
        orderKey: session.orderKey,
        cwd: session.cwd,
        displayCwd: session.cwd,
        providerId: session.providerId,
        modelId: session.modelId,
        permissionMode: permissionMode(session.permissionMode),
        ...(effort ? { effort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        status: session.status as RigSessionStatus,
        ...(session.title === undefined ? {} : { title: session.title }),
        ...(session.recap === undefined ? {} : { recap: session.recap }),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.lastMessageAt === undefined ? {} : { lastMessageAt: session.lastMessageAt }),
        ...(session.draft === undefined ? {} : { draft: session.draft }),
        ...(session.draftUpdatedAt === undefined ? {} : { draftUpdatedAt: session.draftUpdatedAt }),
    };
}

function permissionMode(value: string): RigPermissionMode {
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

function thinkingLevel(value: string | undefined): RigThinkingLevel | undefined {
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
