import { noteStoreCreate, type NoteStore } from "./noteStore.js";
import { notesStoreCreate, type NotesStore } from "./notesStore.js";
import type { NoteSummary, NotesTransport } from "./notesTypes.js";

export interface NotesSessionSnapshot {
    /** Every note on this machine. One store for the window's whole lifetime. */
    readonly notes: NotesStore;
    /** The open note, absent while the surface is addressed without one. */
    readonly note?: NoteStore;
    readonly noteId?: string;
}

/**
 * The notes surface's session: the collection plus whichever note is open.
 *
 * It exists for the same reason the workspace store owns the open conversation —
 * which note is open is decided by the address, and the document behind it must
 * outlive any render — so a surface reads this and never creates a store itself.
 */
export interface NotesSessionStore {
    get(): NotesSessionSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Addresses the surface, with a note or without one. Opening another note
     * releases the previous one, which writes anything typed in the last moment
     * before its document is let go.
     */
    notesOpen(noteId?: string): void;
    /** Creates an empty note and resolves with it, so the caller can address it. */
    noteCreate(): Promise<NoteSummary>;
    noteRemove(id: string): Promise<void>;
}

/**
 * Creates the notes session over an already-connected transport.
 *
 * The collection is watched from the first visit onwards rather than for as long
 * as the surface is on screen: it is one directory watch over a handful of small
 * files, and holding it means the list and the open note are ready the moment the
 * reader comes back to them instead of loading again.
 */
export function notesSessionStoreCreate(transport: NotesTransport): NotesSessionStore {
    const listeners = new Set<() => void>();
    const notes = notesStoreCreate(transport);
    let snapshot: NotesSessionSnapshot = { notes };
    let release: (() => void) | undefined;
    let noteRelease: (() => void) | undefined;

    const publish = (next: NotesSessionSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notesOpen(noteId) {
            release ??= notes.notesWatch();
            if (noteId === snapshot.noteId) return;
            noteRelease?.();
            noteRelease = undefined;
            if (noteId === undefined) {
                publish({ notes });
                return;
            }
            const note = noteStoreCreate(noteId, transport);
            noteRelease = note.noteOpen();
            publish({ note, noteId, notes });
        },
        async noteCreate() {
            return await notes.noteCreate();
        },
        async noteRemove(id) {
            // The removed note may be the open one; letting its document go before
            // the file disappears keeps its pending write from recreating it.
            if (id === snapshot.noteId) {
                noteRelease?.();
                noteRelease = undefined;
                publish({ notes });
            }
            await notes.noteRemove(id);
        },
    };
}
