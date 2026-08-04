/**
 * The notes surface's view of the machine that stores them.
 *
 * Notes are files on the machine running Happy, not rows behind an account, so
 * this package is handed an already-connected boundary and never learns how it is
 * reached. The desktop implementation talks to its main process; a test supplies
 * an in-memory one.
 */
export interface NotesTransport {
    notesList(): Promise<readonly NoteSummary[]>;
    noteRead(id: string): Promise<NoteContent>;
    noteCreate(title?: string): Promise<NoteContent>;
    noteApply(request: NoteApplyRequest): Promise<NoteSummary>;
    noteRename(id: string, title: string): Promise<NoteSummary>;
    noteRemove(id: string): Promise<void>;
    /**
     * Fires when the collection changes for any reason, including a file edited
     * outside Happy. It is a hint that something moved, never the change itself:
     * a surface reacts by reading, exactly as it would after its own write.
     */
    notesSubscribe(listener: () => void): () => void;
}

export interface NoteSummary {
    readonly id: string;
    readonly title: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** Monotonic count of accepted writes to this note's stored state. */
    readonly sequence: number;
    /** Opening line of the note's text, for a list row. */
    readonly excerpt: string;
}

export interface NoteContent {
    readonly note: NoteSummary;
    /** The note's complete collaborative state as one base64 Yjs update. */
    readonly state: string;
}

export interface NoteApplyRequest {
    readonly id: string;
    readonly updates: readonly string[];
    /**
     * The note's normalized Markdown after these updates. The editor's schema
     * belongs to the editor, so the surface that made the edit derives this and
     * the storage layer keeps it beside the collaborative state without
     * interpreting either.
     */
    readonly markdown?: string;
    readonly title?: string;
}

/** How far a note's local edits have got towards being on disk. */
export type NoteSaveState = "idle" | "dirty" | "saving" | "error";
