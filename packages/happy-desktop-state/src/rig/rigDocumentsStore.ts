import * as Y from "yjs";
import type { RigDocumentSource } from "./rigDocumentStore.js";
import { rigDocumentTitle } from "./rigDocumentStore.js";
import type { RigFoldersStore } from "./rigFoldersStore.js";
import { rigFoldersFlatten } from "./rigFoldersStore.js";
import type { RigDocumentId } from "./rigTypes.js";

export interface RigDocumentsSnapshot {
    /**
     * What each linked document is called, by id. A document the host has not
     * answered for yet is absent rather than empty, so a row can say it is still
     * arriving instead of claiming the document has no name.
     */
    readonly titles: ReadonlyMap<RigDocumentId, string>;
}

/**
 * The names of every document linked into this Rig's folders.
 *
 * A document has no name on the Rig — the protocol stores an id, a MIME type,
 * and opaque state — so the only way to label one is to read its content. That
 * makes this a real store rather than a projection: it follows the folder tree,
 * watches exactly the documents the tree links, and drops one the moment its
 * last link goes.
 *
 * It is one store for the whole sidebar rather than one per row. A folder holds
 * a handful of links, not thousands, and the rows read one immutable map through
 * props instead of each opening a subscription of its own.
 */
export interface RigDocumentsStore {
    get(): RigDocumentsSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigDocumentsStoreDeps {
    readonly folders: RigFoldersStore;
    /** Opens the host's feed for one document. */
    readonly sourceCreate: (documentId: RigDocumentId) => RigDocumentSource;
}

function base64Decode(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

const EMPTY: RigDocumentsSnapshot = { titles: new Map() };

/**
 * Creates the store. It opens nothing until a surface subscribes: the first
 * subscriber starts following the folder tree, and the last one to leave lets
 * every document feed go.
 */
export function rigDocumentsStoreCreate(deps: RigDocumentsStoreDeps): RigDocumentsStore {
    const listeners = new Set<() => void>();
    /** One live feed per document the tree currently links. */
    const watched = new Map<RigDocumentId, () => void>();
    let snapshot: RigDocumentsSnapshot = EMPTY;
    let unsubscribeFolders: (() => void) | undefined;
    let disposed = false;

    const publish = (titles: ReadonlyMap<RigDocumentId, string>): void => {
        snapshot = { titles };
        for (const listener of listeners) listener();
    };

    /** Private authoritative writer: one document's own state, as the host sent it. */
    const titleInput = (documentId: RigDocumentId, state: string | undefined): void => {
        if (disposed || state === undefined) return;
        const ydoc = new Y.Doc();
        try {
            Y.applyUpdate(ydoc, base64Decode(state));
        } catch {
            // Unreadable state is not a title. The row keeps whatever it had
            // rather than being relabelled from bytes we could not parse.
            return;
        }
        const title = rigDocumentTitle(ydoc);
        if (snapshot.titles.get(documentId) === title) return;
        const titles = new Map(snapshot.titles);
        titles.set(documentId, title);
        publish(titles);
    };

    /** The documents the tree links right now, watched and nothing else. */
    const reconcile = (): void => {
        if (disposed) return;
        const linked = new Set<RigDocumentId>();
        for (const { folder } of rigFoldersFlatten(deps.folders.get().folders))
            for (const item of folder.items)
                if (item.target.kind === "document") linked.add(item.target.documentId);

        for (const [documentId, release] of watched)
            if (!linked.has(documentId)) {
                release();
                watched.delete(documentId);
            }

        for (const documentId of linked) {
            if (watched.has(documentId)) continue;
            const release = deps.sourceCreate(documentId).subscribe(
                (reading) => titleInput(documentId, reading.state),
                () => undefined,
            );
            watched.set(documentId, release);
        }

        // A document whose last link has gone stops being named.
        if (snapshot.titles.size > 0) {
            let changed = false;
            const titles = new Map(snapshot.titles);
            for (const documentId of titles.keys())
                if (!linked.has(documentId)) {
                    titles.delete(documentId);
                    changed = true;
                }
            if (changed) publish(titles);
        }
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            if (!unsubscribeFolders) {
                unsubscribeFolders = deps.folders.subscribe(reconcile);
                reconcile();
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                listeners.delete(listener);
                if (listeners.size > 0) return;
                unsubscribeFolders?.();
                unsubscribeFolders = undefined;
                for (const release of watched.values()) release();
                watched.clear();
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            unsubscribeFolders?.();
            unsubscribeFolders = undefined;
            for (const release of watched.values()) release();
            watched.clear();
            listeners.clear();
        },
    };
}

/** Documents for a Rig that links none. Permanently empty rather than loading. */
export const rigDocumentsStoreNoop: RigDocumentsStore = {
    get: () => EMPTY,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};
