import * as Y from "yjs";
import type { RigDocumentId } from "./rigTypes.js";

/**
 * Tags state this store applied from the host, so the host's own answer is never
 * captured again and written straight back as if the reader had typed it.
 */
const documentHostOrigin = "happy2-document-host";

/** Shared type name of the editor's fragment inside a collaborative document. */
const documentFragmentName = "document";

/** How far an open document's local edits have got towards being on the Rig. */
export type RigDocumentSaveState = "idle" | "dirty" | "saving" | "error";

/**
 * One reading of a document, exactly as the host published it.
 *
 * `state` is the document's whole collaborative state as one base64 Yjs update.
 * It is opaque to the Rig, which stores and returns it without interpreting it,
 * so the meaning of these bytes lives entirely on this side.
 */
export interface RigDocumentReading {
    /** Absent until the host has answered with the document at least once. */
    readonly state?: string;
    /** The version the host holds. Every write compares against it. */
    readonly version: number;
    readonly connection: "connecting" | "live" | "reconnecting" | "closed";
}

/**
 * The host's feed for one document. The connection re-reads the document
 * whenever the Rig reports a new version, so a change made by an agent or in
 * another window arrives here without anything asking for it.
 */
export interface RigDocumentSource {
    subscribe(
        listener: (reading: RigDocumentReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigDocumentActions {
    /** Creates one empty collaborative Markdown document and returns its stable id. */
    documentCreate(): RigDocumentId;
    /**
     * One compare-version-and-write. The version is the one this store last saw
     * from the host; a write against a stale version is refused by the Rig
     * rather than silently overwriting what it holds.
     */
    documentWrite(
        documentId: RigDocumentId,
        expectedVersion: number,
        input: { readonly state: string; readonly update: string },
    ): void | Promise<void>;
}

export interface RigDocumentSnapshot {
    readonly id: RigDocumentId;
    /** The live collaborative document. Stable for this store's whole lifetime. */
    readonly ydoc: Y.Doc;
    /** The document's own first line. Empty until it has one. */
    readonly title: string;
    readonly status: "loading" | "ready" | "error";
    readonly error?: string;
    readonly saveState: RigDocumentSaveState;
    readonly saveError?: string;
}

/**
 * One open Rig document.
 *
 * The document is a Yjs document rather than a string, so the editor binds to it
 * directly and this store never parses content. Local edits are captured as
 * opaque updates and written after a short pause, because a document is saved
 * continuously and a keystroke is not worth a write.
 *
 * A document has no name of its own on the Rig: the protocol stores an id, a
 * MIME type, and opaque state, and nothing else. Its title is therefore its
 * first line, read from the content itself — which keeps the Markdown an agent
 * reads self-describing instead of hiding the name in a field only Happy knows.
 */
export interface RigDocumentStore {
    get(): RigDocumentSnapshot;
    subscribe(listener: () => void): () => void;
    /** Loads the document and follows later changes to it. Returns the release. */
    documentOpen(): () => void;
    /** Writes pending edits immediately instead of waiting for the pause. */
    documentFlush(): void;
}

export interface RigDocumentStoreDeps {
    readonly source: RigDocumentSource;
    readonly actions: RigDocumentActions;
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

/** The longest a derived title is allowed to be before it stops being a title. */
const DOCUMENT_TITLE_MAX_LENGTH = 120;

/** The text of one node in the editor's fragment, however deeply it is wrapped. */
function nodeText(node: unknown): string {
    if (node instanceof Y.XmlText) return node.toString();
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment)
        return node
            .toArray()
            .map((child) => nodeText(child))
            .join("");
    return "";
}

/**
 * A document's title: the first line that has anything in it.
 *
 * The Rig stores no name for a document, so the content is the only thing that
 * can supply one. Reading it here rather than in the editor keeps a folder able
 * to label a document it has not opened.
 */
export function rigDocumentTitle(ydoc: Y.Doc): string {
    const fragment = ydoc.getXmlFragment(documentFragmentName);
    for (const child of fragment.toArray()) {
        const text = nodeText(child)
            // A heading pasted with its own newlines is still one title.
            .replace(/\s+/g, " ")
            .trim();
        if (text) return text.slice(0, DOCUMENT_TITLE_MAX_LENGTH);
    }
    return "";
}

/**
 * Creates the store for one document. It opens nothing until `documentOpen` is
 * called, so addressing a document and reading one are separate acts.
 */
export function rigDocumentStoreCreate(
    id: RigDocumentId,
    deps: RigDocumentStoreDeps,
): RigDocumentStore {
    const flushDelayMs = deps.flushDelayMs ?? 500;
    const startTimer =
        deps.setTimeout ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
    const stopTimer =
        deps.clearTimeout ??
        ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    const listeners = new Set<() => void>();
    const ydoc = new Y.Doc();
    let snapshot: RigDocumentSnapshot = {
        id,
        title: "",
        saveState: "idle",
        status: "loading",
        ydoc,
    };
    let open = false;
    let retainers = 0;
    let unsubscribe: (() => void) | undefined;
    let timer: unknown;
    let pending: Uint8Array[] = [];
    let flushing = false;
    /**
     * The version the host last reported. Every write compares against it, so a
     * change that arrived from elsewhere is merged before this side writes over
     * the top of it.
     */
    let version = 0;

    const publish = (next: RigDocumentSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    /** Republishes with the title the content currently states. */
    const publishTitled = (next: RigDocumentSnapshot): void => {
        const title = rigDocumentTitle(ydoc);
        publish(title === next.title ? next : { ...next, title });
    };

    const captured = (update: Uint8Array, origin: unknown): void => {
        if (origin === documentHostOrigin) {
            // The host's own state still changes what the title says.
            publishTitled(snapshot);
            return;
        }
        pending.push(update);
        publishTitled({
            ...snapshot,
            ...(snapshot.saveState === "saving" ? {} : { saveState: "dirty" as const }),
        });
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
        if (sending.length === 0) return;
        pending = [];
        flushing = true;
        publish({ ...snapshot, saveState: "saving", saveError: undefined });
        try {
            await deps.actions.documentWrite(id, version, {
                // The whole state, so the Rig holds something it can hand to the
                // next reader without replaying a queue, plus this batch as the
                // update the retained queue keeps.
                state: base64Encode(Y.encodeStateAsUpdate(ydoc)),
                update: base64Encode(Y.mergeUpdates(sending)),
            });
            publish({
                ...snapshot,
                saveState: pending.length > 0 ? "dirty" : "idle",
                saveError: undefined,
            });
        } catch (error) {
            // Yjs updates are commutative, so a failed batch can go back in
            // front of whatever has been typed since and be retried whole.
            pending = [...sending, ...pending];
            publish({ ...snapshot, saveState: "error", saveError: message(error) });
        } finally {
            flushing = false;
            if (pending.length > 0) flushSchedule();
        }
    };

    /**
     * Private authoritative writer: the host's own reading, never a public
     * action. Applying it converges the two documents rather than replacing what
     * is on screen — an edit made here that has not been written yet survives,
     * because a Yjs merge keeps both.
     */
    const readingInput = (reading: RigDocumentReading): void => {
        if (!open) return;
        version = Math.max(version, reading.version);
        if (reading.state !== undefined)
            Y.applyUpdate(ydoc, base64Decode(reading.state), documentHostOrigin);
        if (reading.connection !== "live") return;
        publishTitled({ ...snapshot, status: "ready", error: undefined });
    };

    const start = (): void => {
        if (open) return;
        open = true;
        ydoc.on("update", captured);
        unsubscribe = deps.source.subscribe(readingInput, (error) => {
            if (!open) return;
            publish({ ...snapshot, status: "error", error: message(error) });
        });
    };

    const stop = (): void => {
        if (!open) return;
        open = false;
        unsubscribe?.();
        unsubscribe = undefined;
        if (timer !== undefined) stopTimer(timer);
        timer = undefined;
        // Closing must not lose what was typed in the last half second.
        void flush();
        ydoc.off("update", captured);
    };

    const retain = (): (() => void) => {
        retainers += 1;
        if (retainers === 1) start();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            retainers = Math.max(0, retainers - 1);
            if (retainers === 0) stop();
        };
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            const release = retain();
            return () => {
                listeners.delete(listener);
                release();
            };
        },
        documentOpen: retain,
        documentFlush() {
            if (timer !== undefined) stopTimer(timer);
            timer = undefined;
            void flush();
        },
    };
}
