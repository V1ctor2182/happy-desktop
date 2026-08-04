import type { NoteSummary, NotesTransport } from "./notesTypes.js";

export interface NotesSnapshot {
    readonly notes: readonly NoteSummary[];
    readonly status: "unloaded" | "loading" | "ready" | "error";
    readonly error?: string;
    /** A note whose creation is in flight, so the surface can hold the control still. */
    readonly creating: boolean;
}

/**
 * Every note on this machine, as one list.
 *
 * The collection is small and entirely local, so the whole list is re-read
 * whenever anything changes rather than reconciled entry by entry. A note edited
 * by another tool on the machine therefore appears without the reader asking, and
 * the store needs no notion of a difference or a cursor.
 */
export interface NotesStore {
    get(): NotesSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Begins watching the collection and reads it once. Returns the release, so
     * the surface holding the list decides how long it stays live; nothing is
     * opened until a surface asks.
     */
    notesWatch(): () => void;
    /** Reads the collection again. Safe to call while a read is in flight. */
    notesReload(): void;
    /** Creates an empty note and resolves with it, so the caller can open it. */
    noteCreate(title?: string): Promise<NoteSummary>;
    noteRename(id: string, title: string): Promise<void>;
    noteRemove(id: string): Promise<void>;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : "That did not work.";
}

/** Creates the collection store. It opens nothing until `notesWatch` is called. */
export function notesStoreCreate(transport: NotesTransport): NotesStore {
    const listeners = new Set<() => void>();
    let snapshot: NotesSnapshot = { notes: [], status: "unloaded", creating: false };
    let watchers = 0;
    let unsubscribe: (() => void) | undefined;
    let reading = false;
    let readAgain = false;

    const publish = (next: NotesSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const read = async (): Promise<void> => {
        if (reading) {
            // One more change arrived while this read was open; the list it
            // returns is already stale, so read once more when it settles
            // instead of starting a second concurrent read per notification.
            readAgain = true;
            return;
        }
        reading = true;
        if (snapshot.status === "unloaded")
            publish({ ...snapshot, status: "loading", error: undefined });
        try {
            const notes = await transport.notesList();
            publish({ ...snapshot, notes, status: "ready", error: undefined });
        } catch (error) {
            publish({ ...snapshot, status: "error", error: message(error) });
        } finally {
            reading = false;
            if (readAgain) {
                readAgain = false;
                void read();
            }
        }
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notesWatch() {
            watchers += 1;
            unsubscribe ??= transport.notesSubscribe(() => void read());
            void read();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                watchers -= 1;
                if (watchers > 0) return;
                unsubscribe?.();
                unsubscribe = undefined;
            };
        },
        notesReload() {
            void read();
        },
        async noteCreate(title) {
            publish({ ...snapshot, creating: true });
            try {
                const created = await transport.noteCreate(title);
                // The change notification will refresh the list, but a new note
                // is opened immediately and must already be in it.
                void read();
                return created.note;
            } finally {
                publish({ ...snapshot, creating: false });
            }
        },
        async noteRename(id, title) {
            await transport.noteRename(id, title);
            void read();
        },
        async noteRemove(id) {
            await transport.noteRemove(id);
            void read();
        },
    };
}
