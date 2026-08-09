import type {
    FolderChild,
    FolderItem,
    FolderNode,
    FolderSession,
    FolderView,
    FoldersState,
    RigConnection,
} from "@slopus/rig-connect";
import type {
    ConversationSummary,
    RigDocumentId,
    RigFolder,
    RigFolderContent,
    RigFolderId,
    RigFolderItem,
    RigFolderItemId,
    RigFolderItemTarget,
    RigFoldersReading,
    RigFoldersSource,
    RigConversationSummaryInput,
    RigProjectId,
    RigServiceTier,
    RigSessionId,
    RigWorktreeId,
} from "happy-desktop-state";
import { rigConversationSummaryProject } from "happy-desktop-state";
import { permissionMode, thinkingLevel } from "./rigConnectCatalogSource";

/**
 * Adapts `rig-connect`'s live folder tree to the folders store's source
 * contract.
 *
 * The tree rides the same stream and the same opening catalog as the groups, so
 * following it costs nothing extra: `connectFolders` delivers the whole tree
 * when the catalog opens and again on every folder change the daemon publishes.
 * There is no reader behind this and nothing to poll — a folder made in another
 * window arrives here by exactly the same path as one made in this one.
 *
 * The connector reports where it stands rather than failing: a stream that drops
 * comes back as `reconnecting` and then `live`, and the store keeps showing the
 * tree it already has throughout. That is why nothing here retries.
 */
export function rigConnectFoldersSourceCreate(rig: RigConnection): RigFoldersSource {
    return {
        subscribe(listener, onError) {
            let closed = false;
            let connection: ReturnType<RigConnection["connectFolders"]> | undefined;
            try {
                connection = rig.connectFolders({
                    onChange: (view, state) => {
                        if (closed) return;
                        listener(readingProject(view, state));
                    },
                });
            } catch (error) {
                // The only thing `connectFolders` refuses is a connection that
                // is already closed, which is a fact rather than a hiccup.
                onError(error);
            }
            return () => {
                if (closed) return;
                closed = true;
                connection?.close();
            };
        },
    };
}

function readingProject(view: FolderView, state: FoldersState): RigFoldersReading {
    return {
        connection: state.connection,
        folders: view.folders.map(folderProject),
        unsorted: view.unsorted.map(sessionProject),
    };
}

/**
 * One folder and everything nested under it.
 *
 * `orderKey` is deliberately dropped: the daemon owns where a folder sits among
 * its siblings and already hands the tree over in that order, so carrying the
 * key would only invite a surface to sort by it and disagree.
 *
 * The connector's canonical `children` order contains tagged folders and links.
 * This product states those apart, so only folder children enter `children`
 * here; links enter `items` below. Reading the canonical value directly avoids
 * depending on the connector's redundant filtered `folders` convenience view.
 */
function folderProject(folder: FolderNode): RigFolder {
    const contents = folder.children.map(folderChildProject);
    return {
        children: contents.flatMap((entry) => (entry.kind === "folder" ? [entry.folder] : [])),
        contents,
        id: folder.id as RigFolderId,
        name: folder.name,
        path: folder.path,
        shared: folder.shared,
        conversations: folder.sessions.map(sessionProject),
        items: contents.flatMap((entry) => (entry.kind === "item" ? [entry.item] : [])),
        ...(folder.description === undefined ? {} : { description: folder.description }),
        ...(folder.icon === undefined ? {} : { icon: folder.icon }),
        ...(folder.parentId === undefined ? {} : { parentId: folder.parentId as RigFolderId }),
        ...(folder.rules === undefined ? {} : { rules: folder.rules }),
    };
}

function folderChildProject(child: FolderChild): RigFolderContent {
    return child.kind === "folder"
        ? { kind: "folder", folder: folderProject(child.folder) }
        : { kind: "item", item: itemProject(child.item) };
}

/**
 * One link, with the wire's open target union narrowed to the closed one the
 * product renders.
 *
 * `orderKey` is dropped for the same reason a folder's is: the daemon owns where
 * an item sits among its siblings and hands them over in that order already.
 */
function itemProject(item: FolderItem): RigFolderItem {
    return {
        id: item.id as RigFolderItemId,
        folderId: item.folderId as RigFolderId,
        target: itemTargetProject(item.target),
    };
}

function itemTargetProject(target: FolderItem["target"]): RigFolderItemTarget {
    if (target.kind === "project")
        return { kind: "project", projectId: target.projectId as RigProjectId };
    if (target.kind === "workspace")
        return { kind: "workspace", workspaceId: target.workspaceId as RigWorktreeId };
    return { kind: "document", documentId: target.documentId as RigDocumentId };
}

function sessionProject(session: FolderSession): ConversationSummary {
    const effort = thinkingLevel(session.effort);
    const serviceTier = session.serviceTier === "fast" ? ("fast" as RigServiceTier) : undefined;
    const projected: RigConversationSummaryInput = {
        id: session.id as RigSessionId,
        orderKey: session.orderKey,
        cwd: session.cwd,
        displayCwd: session.cwd,
        providerId: session.providerId,
        modelId: session.modelId,
        permissionMode: permissionMode(session.permissionMode),
        ...(effort ? { effort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        status: session.status,
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
    return rigConversationSummaryProject(projected);
}
