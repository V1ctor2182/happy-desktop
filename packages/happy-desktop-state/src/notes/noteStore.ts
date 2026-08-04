import * as Y from "yjs";
import type { NoteSaveState, NoteSummary, NotesTransport } from "./notesTypes.js";

/** Tags content this store applied from storage, so it is never re-queued as a local edit. */
const noteStoredOrigin = "happy2-note-stored";

export interface NoteSnapshot {
    readonly id: string;
    /** The live collaborative document. Stable for this store's whole lifetime. */
    readonly ydoc: Y.Doc;
    readonly note?: NoteSummary;
    readonly status: "loading" | "ready" | "error";
    readonly error?: string;
    readonly saveState: NoteSaveState;
    readonly saveError?: string;
}

/**
 * One open note.
 *
 * The document itself is a Yjs document rather than a string, so the editor binds
 * to it directly and this store never parses content. Local edits are captured as
 * opaque updates and written after a short pause, because a note is saved
 * continuously and a keystroke is not worth a write. The Markdown that lands
 * beside the note on disk is supplied by the surface doing the editing, which is
 * the only place the editor's schema is known.
 */
export interface NoteStore {
    get(): NoteSnapshot;
    subscribe(listener: () => void): () => void;
    /** Loads the note and follows later changes to it. Returns the release. */
    noteOpen(): () => void;
    /** Records the editor's normalized Markdown for the next write. */
    noteMarkdownUpdate(markdown: string): void;
    /** Renames the note. The title is stored with the note, not inside its content. */
    noteTitleUpdate(title: string): void;
    /** Writes pending edits immediately instead of waiting for the pause. */
    noteFlush(): void;
}

export interface NoteStoreDeps {
    /** Pause after the last keystroke before a write. Shortened by tests. */
    readonly flushDelayMs?: number;
    readonly setTimeout?: (handler: () => void, ms: number) => unknown;
    readonly clearTimeout?: (handle: unknown) => void;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : "That did not save.";
}

function base64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** Creates the store for one note. It opens nothing until `noteOpen` is called. */
export function noteStoreCreate(
    id: string,
    transport: NotesTransport,
    deps: NoteStoreDeps = {},
): NoteStore {
    const flushDelayMs = deps.flushDelayMs ?? 500;
    const startTimer =
        deps.setTimeout ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
    const stopTimer =
        deps.clearTimeout ??
        ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    const listeners = new Set<() => void>();
    const ydoc = new Y.Doc();
    let snapshot: NoteSnapshot = { id, ydoc, status: "loading", saveState: "idle" };
    let open = false;
    let unsubscribe: (() => void) | undefined;
    let timer: unknown;
    let pending: Uint8Array[] = [];
    let markdown: string | undefined;
    let title: string | undefined;
    let flushing = false;
    /**
     * The stored sequence this store has already accounted for. A notification
     * that reports the same sequence is this store's own write coming back, and
     * re-reading for it would fight the editor for the document.
     */
    let seenSequence = -1;

    const publish = (next: NoteSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const captured = (update: Uint8Array, origin: unknown): void => {
        if (origin === noteStoredOrigin) return;
        pending.push(update);
        if (snapshot.saveState !== "saving") publish({ ...snapshot, saveState: "dirty" });
        flushSchedule();
    };

    const flushSchedule = (): void => {
        if (timer !== undefined) stopTimer(timer);
        timer = startTimer(() => {
            timer = undefined;
            void flush();
        }, flushDelayMs);
    };

    const flush = async (): Promise<void> => {
        if (flushing) return;
        const sending = pending;
        const sendingMarkdown = markdown;
        const sendingTitle = title;
        if (sending.length === 0 && sendingTitle === undefined) return;
        pending = [];
        title = undefined;
        flushing = true;
        publish({ ...snapshot, saveState: "saving", saveError: undefined });
        try {
            if (sending.length === 0) {
                // A rename with no content edit is still a write, and the store
                // has a dedicated call for it that does not touch the content.
                const note = await transport.noteRename(id, sendingTitle ?? "");
                seenSequence = note.sequence;
                publish({ ...snapshot, note, saveState: "idle" });
            } else {
                const note = await transport.noteApply({
                    id,
                    updates: sending.map((update) => base64Encode(update)),
                    ...(sendingMarkdown === undefined ? {} : { markdown: sendingMarkdown }),
                    ...(sendingTitle === undefined ? {} : { title: sendingTitle }),
                });
                seenSequence = note.sequence;
                publish({ ...snapshot, note, saveState: pending.length > 0 ? "dirty" : "idle" });
            }
        } catch (error) {
            // Yjs updates are commutative, so a failed batch can simply go back
            // in front of whatever has been typed since and be retried whole.
            pending = [...sending, ...pending];
            if (sendingTitle !== undefined) title ??= sendingTitle;
            publish({ ...snapshot, saveState: "error", saveError: message(error) });
        } finally {
            flushing = false;
            if (pending.length > 0 || title !== undefined) flushSchedule();
        }
    };

    const read = async (): Promise<void> => {
        try {
            const content = await transport.noteRead(id);
            if (!open) return;
            // Applying storage's state to the live document converges the two
            // rather than replacing what is on screen: an edit made here that has
            // not been written yet survives, because a Yjs merge keeps both.
            Y.applyUpdate(ydoc, base64Decode(content.state), noteStoredOrigin);
            seenSequence = content.note.sequence;
            // A title typed but not yet written outranks the stored one, so a
            // read landing mid-rename does not flick the heading back.
            const note = title === undefined ? content.note : { ...content.note, title };
            publish({ ...snapshot, note, status: "ready", error: undefined });
        } catch (error) {
            if (!open) return;
            publish({ ...snapshot, status: "error", error: message(error) });
        }
    };

    ydoc.on("update", captured);

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        noteOpen() {
            open = true;
            unsubscribe ??= transport.notesSubscribe(() => {
                if (!open) return;
                void (async () => {
                    try {
                        const notes = await transport.notesList();
                        const listed = notes.find((candidate) => candidate.id === id);
                        // Only a write this store did not make is worth reading
                        // the document back for.
                        if (listed && listed.sequence > seenSequence) await read();
                        else if (listed) publish({ ...snapshot, note: listed });
                    } catch {
                        // The open document is unaffected by a failed list; the
                        // next notification tries again.
                    }
                })();
            });
            void read();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                open = false;
                unsubscribe?.();
                unsubscribe = undefined;
                if (timer !== undefined) stopTimer(timer);
                timer = undefined;
                // Closing must not lose what was typed in the last half second.
                void flush();
                ydoc.off("update", captured);
            };
        },
        noteMarkdownUpdate(value) {
            markdown = value;
        },
        noteTitleUpdate(value) {
            title = value;
            publish({
                ...snapshot,
                // Shown immediately: the reader typed it, and the write only
                // confirms what the heading and the list already say.
                ...(snapshot.note ? { note: { ...snapshot.note, title: value } } : {}),
                saveState: "dirty",
            });
            flushSchedule();
        },
        noteFlush() {
            if (timer !== undefined) stopTimer(timer);
            timer = undefined;
            void flush();
        },
    };
}
