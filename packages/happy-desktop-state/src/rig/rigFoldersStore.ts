import { createStore } from "zustand/vanilla";
import type { MutationRejectedDelta } from "@slopus/rig-connect";
import type { ConversationSummary } from "../conversation/conversationSummary.js";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigFolderId, RigGroupId, RigSessionId, RigSessionScope } from "./rigTypes.js";

/**
 * One folder in the Rig's virtual tree, with the folders nested inside it
 * already joined.
 *
 * Nesting is virtual: `parentId` places a folder in the tree while `path` is the
 * flat storage directory it owns, which never moves when the tree does. `icon`
 * is a single emoji the reader chose, and is absent on a folder that has never
 * been given one — the default glyph is a presentation decision and is not
 * written into state as if the host had stored it.
 */
export interface RigFolder {
    readonly id: RigFolderId;
    readonly name: string;
    /** A single emoji, when the folder has one. */
    readonly icon?: string;
    /** What the folder is for, shown to people and given to agents working inside it. */
    readonly description?: string;
    /** Standing instructions every agent working in this folder must follow. */
    readonly rules?: string;
    /** Absent for a folder at the root of the tree. */
    readonly parentId?: RigFolderId;
    /** Flat storage directory holding this folder's files. */
    readonly path: string;
    /** Chats directly contained by this folder, in the order the host published. */
    readonly conversations: readonly ConversationSummary[];
    /** The folders nested inside this one, in the order they should be drawn. */
    readonly children: readonly RigFolder[];
}

/** One reading of the folder tree, exactly as the host published it. */
export interface RigFoldersReading {
    /** The folders at the root of the tree, each carrying its own children. */
    readonly folders: readonly RigFolder[];
    /** Chats that do not belong to a folder, project, or workspace yet. */
    readonly unsorted: readonly ConversationSummary[];
    /** Whether the feed behind this reading is live, coming back, or gone. */
    readonly connection: "connecting" | "live" | "reconnecting" | "closed";
}

/**
 * The host Rig's folder-tree feed. The host streams it: a reading arrives with
 * the opening catalog and again every time a folder is created, changed, moved,
 * or put away, so nothing above ever asks for one.
 */
export interface RigFoldersSource {
    subscribe(
        listener: (reading: RigFoldersReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

/**
 * Everything this surface does to the tree, as the connection performs it.
 *
 * The connection predicts each queued mutation and later reconciles the host's
 * answer through the same stream. The host still derives a folder's place among
 * its siblings, which is why a move names where the folder landed rather than an
 * order key. A standalone source may instead complete each action as a promise.
 */
export type RigFolderActionResult = string | void | Promise<string | void>;

export interface RigFoldersActions {
    folderCreate(input: {
        readonly name: string;
        readonly icon?: string;
        readonly parentId?: RigFolderId;
    }): RigFolderActionResult;
    /** Changes a folder's own fields. `null` clears an optional one. */
    folderUpdate(
        folderId: RigFolderId,
        changes: { readonly name?: string; readonly icon?: string | null },
    ): RigFolderActionResult;
    /** One drag-and-drop: the folder it was dropped into, and the sibling below. */
    folderMove(
        folderId: RigFolderId,
        parentId: RigFolderId | null,
        afterId: RigFolderId | null,
    ): RigFolderActionResult;
    /** Puts a folder away together with everything nested under it. */
    folderArchive(folderId: RigFolderId): RigFolderActionResult;
    /** Files one chat into a folder, or takes it back out into unsorted with `null`. */
    folderSessionSet(sessionId: RigSessionId, folderId: RigFolderId | null): RigFolderActionResult;
}

/**
 * The folder being made or edited, and nothing else.
 *
 * The draft lives here rather than in the surface showing it, so an edit in
 * flight survives the tree being republished underneath it — which happens
 * whenever any folder anywhere changes, not only this one.
 */
export interface RigFolderEditorSnapshot {
    /** `create` is a folder that does not exist yet; `edit` changes one that does. */
    readonly mode: "create" | "edit";
    /** The folder being changed. Absent while one is being made. */
    readonly folderId?: RigFolderId;
    /** Where a new folder will be made. Absent puts it at the root of the tree. */
    readonly parentId?: RigFolderId;
    readonly name: string;
    /** The emoji chosen so far. Absent means the folder carries none of its own. */
    readonly emoji?: string;
    /** True while the host is being told; the surface stays up and inert. */
    readonly submitting: boolean;
    /** Why the last attempt was refused, in the host's own words. */
    readonly error?: string;
}

export interface RigFoldersSnapshot {
    /** The folders at the root of the tree, each carrying its own children. */
    readonly folders: readonly RigFolder[];
    /** Chats waiting to be filed into a folder. */
    readonly unsorted: readonly ConversationSummary[];
    /** True until the host's first reading arrives, so "no folders" is not claimed early. */
    readonly loading: boolean;
    /** Set when the feed itself failed; the last reading stays visible beneath it. */
    readonly error?: UserError;
    /**
     * Why the last act on the tree was refused, in the reader's words. It is
     * held apart from `error` because a refused move is not a broken feed: the
     * tree on screen is still current, and only the act did not happen.
     */
    readonly actionError?: string;
    /**
     * Groups restored by the latest rejected optimistic mutation.
     *
     * The revision makes this an event a subscriber can consume once even when
     * the same group is restored by two different rejected attempts.
     */
    readonly restoredGroupRejection?: {
        readonly groupIds: readonly RigGroupId[];
        readonly revision: number;
    };
    /** The folder being made or edited, if any. */
    readonly editor?: RigFolderEditorSnapshot;
}

export interface RigFoldersStore {
    get(): RigFoldersSnapshot;
    subscribe(listener: () => void): () => void;
    /** Opens the editor on a folder that does not exist yet. */
    folderCreateOpen(parentId?: RigFolderId): void;
    /** Opens the editor on a folder that does, filled from what the host holds. */
    folderEditOpen(folderId: RigFolderId): void;
    folderNameUpdate(value: string): void;
    /** Chooses the folder's emoji. Empty text takes it back to having none. */
    folderEmojiUpdate(value: string): void;
    /** Abandons the edit. Nothing is written. */
    folderEditorCancel(): void;
    /** Commits the draft. A folder with no name is not a folder and closes instead. */
    folderEditorSubmit(): Promise<void>;
    /** Applies one drag-and-drop, reported by the sidebar as one move. */
    folderMove(
        folderId: RigFolderId,
        parentId: RigFolderId | null,
        afterId: RigFolderId | null,
    ): Promise<void>;
    folderArchive(folderId: RigFolderId): Promise<void>;
    /**
     * Files one chat into a folder, or takes it back out into unsorted with
     * `null`. Nothing here changes on its own: the chat's own listing carries
     * the folder it is in, so this reports the act and the catalog states the
     * result.
     */
    folderSessionSet(sessionId: RigSessionId, folderId: RigFolderId | null): Promise<void>;
    [Symbol.dispose](): void;
}

export interface RigFoldersStoreDeps {
    readonly source: RigFoldersSource;
    readonly actions: RigFoldersActions;
    readonly mutationSubscribe?: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
}

const EMPTY: RigFoldersSnapshot = { folders: [], unsorted: [], loading: true };
/** The connector accepts at most this many mutations before rejecting overflow. */
const RIG_MUTATION_QUEUE_LIMIT = 256;

/**
 * The Rig's folder tree, and the few things a person does to it.
 *
 * Folders belong to the Rig rather than to any project, so this is one surface
 * per connection with a lifetime of its own: the first subscriber opens the
 * feed and the last one to leave closes it. The tree is never predicted here.
 * Every act goes to the host and the change comes back on the stream, which is
 * also how a folder made in another window arrives — so there is exactly one
 * path by which this surface ever changes.
 */
export function rigFoldersStoreCreate(deps: RigFoldersStoreDeps): RigFoldersStore {
    const store = createStore<RigFoldersSnapshot>()(() => EMPTY);
    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    /** True once the host has answered live at least once. */
    let settled = false;
    let disposed = false;
    const pendingMutationIds = new Set<string>();
    const pendingMutationOrder: string[] = [];
    const pendingMutationRestoredGroups = new Map<string, readonly RigGroupId[]>();
    const earlyMutationRejections = new Map<string, MutationRejectedDelta>();
    const earlyMutationRejectionOrder: string[] = [];
    let restoredGroupRejectionRevision = 0;

    /**
     * Private authoritative writer: the host's own reading, never a public action.
     *
     * A feed that has not gone live yet is not a Rig with no folders. It reports
     * an empty tree while it is still opening, so nothing here is settled until
     * the host has actually answered once — otherwise the surface would state
     * "no folders yet" about a machine it has not finished asking.
     */
    const readingInput = (reading: RigFoldersReading): void => {
        if (disposed) return;
        const current = store.getState();
        // A reconnecting source can publish its empty opening view before the
        // durable catalog arrives. Keep the last live tree mounted through that
        // transition so route changes do not collapse and rebuild the sidebar.
        if (reading.connection !== "live") {
            if (!settled && !current.loading) store.setState({ ...current, loading: true });
            return;
        }
        settled = true;
        store.setState({
            ...current,
            folders: referencesPreserve(current.folders, reading.folders),
            unsorted: referencesPreserve(current.unsorted, reading.unsorted),
            loading: !settled,
            ...(current.error === undefined ? {} : { error: undefined }),
        });
    };

    const editorSet = (editor: RigFolderEditorSnapshot | undefined): void => {
        store.setState({ ...store.getState(), editor });
    };

    const actionFailed = (error: unknown): void => {
        if (disposed) return;
        store.setState({ ...store.getState(), actionError: rigUserError(error).message });
    };

    const actionSucceeded = (): void => {
        if (disposed || store.getState().actionError === undefined) return;
        store.setState({ ...store.getState(), actionError: undefined });
    };

    const restoredGroupsPublish = (groupIds: readonly RigGroupId[]): void => {
        if (disposed || groupIds.length === 0) return;
        restoredGroupRejectionRevision += 1;
        store.setState({
            ...store.getState(),
            restoredGroupRejection: {
                groupIds,
                revision: restoredGroupRejectionRevision,
            },
        });
    };

    const mutationTrack = (
        mutationId: string,
        restoredGroups: readonly RigGroupId[] = [],
    ): void => {
        const earlyRejection = earlyMutationRejections.get(mutationId);
        if (earlyRejection) {
            earlyMutationRejections.delete(mutationId);
            restoredGroupsPublish(restoredGroups);
            throw new Error(earlyRejection.message);
        }
        pendingMutationIds.add(mutationId);
        if (restoredGroups.length > 0)
            pendingMutationRestoredGroups.set(mutationId, restoredGroups);
        pendingMutationOrder.push(mutationId);
        while (pendingMutationOrder.length > RIG_MUTATION_QUEUE_LIMIT) {
            const expired = pendingMutationOrder.shift();
            if (expired) {
                pendingMutationIds.delete(expired);
                pendingMutationRestoredGroups.delete(expired);
            }
        }
    };

    const actionRun = async (
        result: RigFolderActionResult,
        restoredGroups: readonly RigGroupId[] = [],
    ): Promise<void> => {
        if (typeof result === "string") {
            mutationTrack(result, restoredGroups);
            return;
        }
        const mutationId = await result;
        if (typeof mutationId === "string") mutationTrack(mutationId, restoredGroups);
    };

    const unsubscribeMutationRejections = deps.mutationSubscribe?.((rejection) => {
        if (disposed) return;
        if (pendingMutationIds.delete(rejection.mutationId)) {
            restoredGroupsPublish(pendingMutationRestoredGroups.get(rejection.mutationId) ?? []);
            pendingMutationRestoredGroups.delete(rejection.mutationId);
            actionFailed(new Error(rejection.message));
            return;
        }
        // Queue overflow is rejected synchronously inside the connector, before
        // its action returns the mutation id. Hold unmatched rejections long
        // enough for `mutationTrack` to pair that return with this notification.
        earlyMutationRejections.set(rejection.mutationId, rejection);
        earlyMutationRejectionOrder.push(rejection.mutationId);
        while (earlyMutationRejectionOrder.length > RIG_MUTATION_QUEUE_LIMIT) {
            const expired = earlyMutationRejectionOrder.shift();
            if (expired) earlyMutationRejections.delete(expired);
        }
    });

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(readingInput, (error) => {
            if (disposed) return;
            // The tree already held is not made untrue by a feed that dropped,
            // so only the failure and the settled flag move.
            settled = true;
            store.setState({ ...store.getState(), error: rigUserError(error), loading: false });
        });
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        folderCreateOpen(parentId) {
            if (disposed) return;
            editorSet({
                mode: "create",
                name: "",
                submitting: false,
                ...(parentId === undefined ? {} : { parentId }),
            });
        },
        folderEditOpen(folderId) {
            if (disposed) return;
            const folder = folderFind(store.getState().folders, folderId);
            if (!folder) return;
            editorSet({
                folderId,
                mode: "edit",
                name: folder.name,
                submitting: false,
                ...(folder.icon === undefined ? {} : { emoji: folder.icon }),
                ...(folder.parentId === undefined ? {} : { parentId: folder.parentId }),
            });
        },
        folderNameUpdate(value) {
            const editor = store.getState().editor;
            if (!editor || editor.submitting) return;
            editorSet({ ...editor, name: value });
        },
        folderEmojiUpdate(value) {
            const editor = store.getState().editor;
            if (!editor || editor.submitting) return;
            const emoji = value.trim();
            editorSet({
                ...editor,
                ...(emoji ? { emoji } : { emoji: undefined }),
            });
        },
        folderEditorCancel() {
            if (store.getState().editor === undefined) return;
            editorSet(undefined);
        },
        async folderEditorSubmit() {
            const pending = store.getState().editor;
            if (!pending || pending.submitting) return;
            const name = pending.name.trim();
            // A folder with no name is not a folder, and a name nobody changed
            // is not an edit; either way there is nothing to tell the host.
            if (!name) {
                editorSet(undefined);
                return;
            }
            editorSet({ ...pending, submitting: true, error: undefined });
            try {
                if (pending.mode === "create") {
                    await actionRun(
                        deps.actions.folderCreate({
                            name,
                            ...(pending.emoji === undefined ? {} : { icon: pending.emoji }),
                            ...(pending.parentId === undefined
                                ? {}
                                : { parentId: pending.parentId }),
                        }),
                    );
                } else if (pending.folderId !== undefined) {
                    await actionRun(
                        deps.actions.folderUpdate(pending.folderId, {
                            name,
                            // Explicitly cleared rather than left alone: a reader who
                            // took the emoji off means the folder to carry none, and
                            // an absent field would leave the old one in place.
                            icon: pending.emoji ?? null,
                        }),
                    );
                }
                if (disposed) return;
                // Only if this is still the same edit. A reader who closed it and
                // opened another while the host was answering must not have that
                // one closed out from under them.
                if (store.getState().editor === undefined) return;
                editorSet(undefined);
                actionSucceeded();
            } catch (error) {
                if (disposed) return;
                const current = store.getState().editor;
                if (
                    current === undefined ||
                    current.folderId !== pending.folderId ||
                    current.mode !== pending.mode
                )
                    return;
                editorSet({ ...current, submitting: false, error: rigUserError(error).message });
            }
        },
        async folderMove(folderId, parentId, afterId) {
            try {
                await actionRun(deps.actions.folderMove(folderId, parentId, afterId));
                actionSucceeded();
            } catch (error) {
                actionFailed(error);
            }
        },
        async folderArchive(folderId) {
            try {
                const folder = folderFind(store.getState().folders, folderId);
                const restoredGroups = (
                    folder === undefined
                        ? [folderId]
                        : rigFoldersFlatten([folder]).map(({ folder }) => folder.id)
                ).map(rigFolderGroupId);
                await actionRun(deps.actions.folderArchive(folderId), restoredGroups);
                actionSucceeded();
            } catch (error) {
                actionFailed(error);
            }
        },
        async folderSessionSet(sessionId, folderId) {
            try {
                const restoredGroup = sessionGroupFind(store.getState(), sessionId);
                await actionRun(
                    deps.actions.folderSessionSet(sessionId, folderId),
                    restoredGroup === undefined ? [] : [restoredGroup],
                );
                actionSucceeded();
            } catch (error) {
                actionFailed(error);
            }
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            unsubscribeMutationRejections?.();
            listeners.clear();
        },
    };
}

const INERT: RigFoldersSnapshot = { folders: [], unsorted: [], loading: false };

/**
 * Folders for a Rig that has none to offer. Permanently empty and settled rather
 * than loading, so a surface that must subscribe unconditionally reads "there is
 * nothing here" instead of waiting for a reading that is not coming.
 */
export const rigFoldersStoreNoop: RigFoldersStore = {
    get: () => INERT,
    subscribe: () => () => undefined,
    folderCreateOpen: () => undefined,
    folderEditOpen: () => undefined,
    folderNameUpdate: () => undefined,
    folderEmojiUpdate: () => undefined,
    folderEditorCancel: () => undefined,
    folderEditorSubmit: () => Promise.resolve(),
    folderMove: () => Promise.resolve(),
    folderArchive: () => Promise.resolve(),
    folderSessionSet: () => Promise.resolve(),
    [Symbol.dispose]: () => undefined,
};

/**
 * What marks a group id as naming a folder rather than a project or a worktree.
 *
 * A folder takes a row beside them and is addressed the same way, so the three
 * share one id space; a project and a worktree carry ids the host minted, and
 * this prefix is what keeps a folder's own id from ever colliding with one.
 */
export const RIG_FOLDER_GROUP_PREFIX = "folder:";

/** The global collection of chats that have not been filed yet. */
export const RIG_UNSORTED_GROUP_ID = "unsorted:" as RigGroupId;

/** The group id addressing one folder. */
export function rigFolderGroupId(folderId: RigFolderId): RigGroupId {
    return `${RIG_FOLDER_GROUP_PREFIX}${folderId}` as RigGroupId;
}

/** The group address corresponding to one canonical session scope. */
export function rigSessionScopeGroupId(scope: RigSessionScope): RigGroupId {
    if (scope.kind === "project") return scope.projectId;
    if (scope.kind === "workspace") return scope.worktreeId;
    if (scope.kind === "folder") return rigFolderGroupId(scope.folderId);
    return RIG_UNSORTED_GROUP_ID;
}

/** The folder a group id names, or undefined when it names a checkout. */
export function rigFolderGroupParse(groupId: string): RigFolderId | undefined {
    return groupId.startsWith(RIG_FOLDER_GROUP_PREFIX)
        ? (groupId.slice(RIG_FOLDER_GROUP_PREFIX.length) as RigFolderId)
        : undefined;
}

/** One folder anywhere in the tree, by id. */
export function folderFind(
    folders: readonly RigFolder[],
    folderId: RigFolderId,
): RigFolder | undefined {
    for (const folder of folders) {
        if (folder.id === folderId) return folder;
        const nested = folderFind(folder.children, folderId);
        if (nested) return nested;
    }
    return undefined;
}

/**
 * The tree walked depth-first into one flat list, each folder carrying how deep
 * it sits. A sidebar draws rows in one column, so the nesting it shows is a
 * property of each row rather than of the list's shape.
 */
export function rigFoldersFlatten(
    folders: readonly RigFolder[],
    depth = 0,
): readonly { readonly folder: RigFolder; readonly depth: number }[] {
    return folders.flatMap((folder) => [
        { depth, folder },
        ...rigFoldersFlatten(folder.children, depth + 1),
    ]);
}

/** The folder-tree group currently containing one conversation. */
function sessionGroupFind(
    snapshot: Pick<RigFoldersSnapshot, "folders" | "unsorted">,
    sessionId: RigSessionId,
): RigGroupId | undefined {
    if (snapshot.unsorted.some((conversation) => conversation.id === sessionId))
        return RIG_UNSORTED_GROUP_ID;
    const entry = rigFoldersFlatten(snapshot.folders).find(({ folder }) =>
        folder.conversations.some((conversation) => conversation.id === sessionId),
    );
    return entry === undefined ? undefined : rigFolderGroupId(entry.folder.id);
}
