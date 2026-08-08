import {
    type GitChangeSnapshot,
    type GroupSession,
    type ProjectGroup,
    type RigConnection,
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
} from "happy-desktop-state";

export interface RigConnectCatalogFallback {
    read(): Promise<RigSessionCatalogSnapshot>;
    subscribe(listener: () => void, onError: (error: unknown) => void): () => void;
}

const FALLBACK_RETRY_INITIAL_MS = 250;
const FALLBACK_RETRY_MAXIMUM_MS = 5_000;

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
    rig: RigConnection,
    baseUrl: string,
    fallback: RigConnectCatalogFallback,
): RigSessionCatalogSource {
    const base = baseUrl.replace(/\/$/, "");
    let snapshot: RigSessionCatalogSnapshot | undefined;
    let connection: ReturnType<RigConnection["connectGroups"]> | undefined;
    let fallbackUnsubscribe: (() => void) | undefined;
    let fallbackReading: Promise<void> | undefined;
    let fallbackReadingGeneration = -1;
    let fallbackRetry: ReturnType<typeof setTimeout> | undefined;
    let fallbackFailures = 0;
    // A hint arrived while a read was in flight, so one more read is owed.
    let fallbackRereadWanted = false;
    let live = false;
    // Which source is authoritative right now. Every asynchronous read carries
    // the generation it was started under, so a read issued against the source
    // Happy has since moved off can never publish over the newer one.
    let generation = 0;
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

    const fallbackRetryCancel = (): void => {
        if (fallbackRetry === undefined) return;
        clearTimeout(fallbackRetry);
        fallbackRetry = undefined;
    };

    const fallbackRetrySchedule = (readGeneration: number): void => {
        if (disposed || live || generation !== readGeneration || fallbackRetry !== undefined) {
            return;
        }
        const delay = Math.min(
            FALLBACK_RETRY_INITIAL_MS * 2 ** Math.min(fallbackFailures, 5),
            FALLBACK_RETRY_MAXIMUM_MS,
        );
        fallbackFailures += 1;
        fallbackRetry = setTimeout(() => {
            fallbackRetry = undefined;
            if (!disposed && !live && generation === readGeneration) {
                fallbackSubscribe(readGeneration);
                void fallbackRead();
            }
        }, delay);
    };

    /**
     * Follows durable-change hints while the complete reader is authoritative.
     * The renderer SSE is a one-shot resource after an error, so an errored
     * subscription is released and reopened by the same backoff that bridges
     * failed reads. A successful read then keeps this fresh stream alive.
     */
    const fallbackSubscribe = (readGeneration: number): void => {
        if (disposed || live || generation !== readGeneration || fallbackUnsubscribe !== undefined)
            return;
        let current = true;
        let close = (): void => undefined;
        fallbackUnsubscribe = () => {
            if (!current) return;
            current = false;
            close();
        };
        const subscriptionClose = fallback.subscribe(
            () => {
                if (current && !disposed && !live && generation === readGeneration)
                    void fallbackRead();
            },
            (error) => {
                if (!current || disposed || live || generation !== readGeneration) return;
                current = false;
                fallbackUnsubscribe = undefined;
                close();
                fail(error);
                fallbackRetrySchedule(readGeneration);
            },
        );
        close = subscriptionClose;
        // Covers a source that reports failure synchronously from subscribe.
        if (!current) close();
    };

    const fallbackStart = (): void => {
        if (disposed || fallbackUnsubscribe) return;
        connection?.close();
        connection = undefined;
        // The stream stopped being authoritative the moment it failed, even if
        // it had reached `live` earlier. Handing authority back to the complete
        // reader before it starts is what lets its results be published at all.
        live = false;
        generation += 1;
        fallbackFailures = 0;
        fallbackSubscribe(generation);
        void fallbackRead();
    };

    /**
     * Reads the complete catalog, coalescing hints that arrive while a read is
     * already in flight.
     *
     * A hint that arrives after the request went out describes a catalog the
     * answer on its way back cannot contain: that snapshot was taken before the
     * change happened. Returning it and stopping would leave the surface showing
     * a state that is already stale, with nothing scheduled to correct it — the
     * next change might be minutes away, or might never come. So one further
     * read is remembered and run once this one settles, whether it succeeded or
     * failed, and any number of hints in between collapse into that single
     * reread rather than into a queue of them.
     */
    const fallbackRead = (): Promise<void> => {
        if (fallbackReading !== undefined && fallbackReadingGeneration === generation) {
            fallbackRereadWanted = true;
            return fallbackReading;
        }
        const readGeneration = generation;
        fallbackReadingGeneration = readGeneration;
        fallbackRereadWanted = false;
        let succeeded = false;
        const reading = fallback
            .read()
            .then((next) => {
                if (disposed || live || generation !== readGeneration) return;
                succeeded = true;
                fallbackFailures = 0;
                // The SSE may have failed while this HTTP read was in flight.
                // Restore a live hint source before cancelling the backoff;
                // otherwise this successful snapshot would strand the catalog
                // with neither a subscription nor another recovery attempt.
                fallbackSubscribe(readGeneration);
                if (fallbackUnsubscribe !== undefined) fallbackRetryCancel();
                snapshot = next;
                for (const waiter of waiting) waiter.resolve(next);
                waiting.clear();
                for (const listener of listeners) listener();
            })
            .catch((error: unknown) => {
                if (disposed || generation !== readGeneration) return;
                fail(error);
            })
            .finally(() => {
                if (fallbackReading !== reading) return;
                fallbackReading = undefined;
                // Only for the source that is still authoritative: a reread owed
                // to a reader Happy has since moved off would publish over the
                // newer one, which is the thing the generation exists to stop.
                const wanted = fallbackRereadWanted;
                fallbackRereadWanted = false;
                if (succeeded && wanted && !disposed && !live && generation === readGeneration) {
                    void fallbackRead();
                } else if (!succeeded) {
                    fallbackRetrySchedule(readGeneration);
                }
            });
        fallbackReading = reading;
        return reading;
    };

    const start = (): void => {
        if (disposed || connection || fallbackUnsubscribe) return;
        connection = rig.connectGroups({
            onChange: (projects, state) => {
                // A stream that closes reports it here and nowhere else: its
                // `onError` fires only for a rejected subscription, so a group
                // stream that simply ended used to leave the catalog with no
                // authority and no recovery — the first read parked forever and
                // the surface above it stayed on "loading" for the life of the
                // window. Handing authority to the complete reader is the only
                // thing that can answer it now.
                if (state.connection === "closed") {
                    fallbackStart();
                    return;
                }
                // A stream that is coming back keeps whatever it already
                // published; the reader only takes over when there is nothing
                // published at all, because then something must answer the read.
                if (state.connection !== "live") {
                    if (!snapshot) fallbackStart();
                    return;
                }
                if (!live) {
                    live = true;
                    generation += 1;
                }
                fallbackFailures = 0;
                fallbackRetryCancel();
                fallbackUnsubscribe?.();
                fallbackUnsubscribe = undefined;
                publish(projects);
            },
            onError: fallbackStart,
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
            fallbackUnsubscribe?.();
            fallbackUnsubscribe = undefined;
            fallbackRetryCancel();
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
        // rig-connect only groups sessions the host has placed, so a session
        // reaching here always has a key; it is carried through rather than
        // asserted so the absence would propagate honestly if that changed.
        ...(session.orderKey === undefined ? {} : { orderKey: session.orderKey }),
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
