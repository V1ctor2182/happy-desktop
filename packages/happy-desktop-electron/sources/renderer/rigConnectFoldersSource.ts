import type { FolderNode, FoldersState, RigConnection } from "@slopus/rig-connect";
import type {
    RigFolder,
    RigFolderId,
    RigFoldersReading,
    RigFoldersSource,
} from "happy-desktop-state";

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
                    onChange: (folders, state) => {
                        if (closed) return;
                        listener(readingProject(folders, state));
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

function readingProject(folders: readonly FolderNode[], state: FoldersState): RigFoldersReading {
    return { connection: state.connection, folders: folders.map(folderProject) };
}

/**
 * One folder and everything nested under it.
 *
 * `orderKey` is deliberately dropped: the daemon owns where a folder sits among
 * its siblings and already hands the tree over in that order, so carrying the
 * key would only invite a surface to sort by it and disagree.
 */
function folderProject(folder: FolderNode): RigFolder {
    return {
        children: folder.children.map(folderProject),
        id: folder.id as RigFolderId,
        name: folder.name,
        path: folder.path,
        ...(folder.description === undefined ? {} : { description: folder.description }),
        ...(folder.icon === undefined ? {} : { icon: folder.icon }),
        ...(folder.parentId === undefined ? {} : { parentId: folder.parentId as RigFolderId }),
        ...(folder.rules === undefined ? {} : { rules: folder.rules }),
    };
}
