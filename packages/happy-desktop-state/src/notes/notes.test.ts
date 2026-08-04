import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { noteStoreCreate } from "./noteStore.js";
import { notesSessionStoreCreate } from "./notesSessionStore.js";
import { notesStoreCreate } from "./notesStore.js";
import type { NoteContent, NoteSummary, NotesTransport } from "./notesTypes.js";

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

/**
 * A machine that stores notes, standing in for the desktop main process: it
 * merges with real Yjs, so a test sees exactly the convergence the product
 * depends on rather than a string it agreed to remember.
 */
function fakeMachine() {
    const documents = new Map<string, Y.Doc>();
    const notes = new Map<string, NoteSummary>();
    const listeners = new Set<() => void>();
    let sequence = 0;
    let counter = 0;
    let failNext: string | undefined;

    const notify = () => {
        for (const listener of listeners) listener();
    };
    const content = (id: string): NoteContent => ({
        note: notes.get(id)!,
        state: base64Encode(Y.encodeStateAsUpdate(documents.get(id)!)),
    });
    const advance = (id: string, changes: Partial<NoteSummary> = {}): NoteSummary => {
        sequence += 1;
        const next = { ...notes.get(id)!, ...changes, sequence, updatedAt: sequence };
        notes.set(id, next);
        return next;
    };

    const transport: NotesTransport = {
        notesList: async () => [...notes.values()],
        noteRead: async (id) => {
            if (!notes.has(id)) throw new Error("That note no longer exists.");
            return content(id);
        },
        noteCreate: async (title) => {
            counter += 1;
            const id = `note-${counter}`;
            documents.set(id, new Y.Doc());
            notes.set(id, {
                id,
                title: title ?? "",
                createdAt: 0,
                updatedAt: 0,
                sequence: 0,
                excerpt: "",
            });
            notify();
            return content(id);
        },
        noteApply: async (request) => {
            if (failNext !== undefined) {
                const message = failNext;
                failNext = undefined;
                throw new Error(message);
            }
            const document = documents.get(request.id)!;
            for (const update of request.updates) Y.applyUpdate(document, base64Decode(update));
            const next = advance(request.id, {
                ...(request.title === undefined ? {} : { title: request.title }),
                ...(request.markdown === undefined ? {} : { excerpt: request.markdown }),
            });
            notify();
            return next;
        },
        noteRename: async (id, title) => {
            const next = advance(id, { title });
            notify();
            return next;
        },
        noteRemove: async (id) => {
            documents.delete(id);
            notes.delete(id);
            notify();
        },
        notesSubscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };

    return {
        transport,
        /** An edit made by someone else on the machine, as the store would see it. */
        foreignEdit(id: string, write: string) {
            const document = documents.get(id)!;
            document.getText("body").insert(document.getText("body").length, write);
            advance(id);
            notify();
        },
        text: (id: string) => documents.get(id)!.getText("body").toString(),
        failNextApply(message: string) {
            failNext = message;
        },
    };
}

/** Settles the microtask queue the stores use between a call and its publish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("notes collection store", () => {
    it("opens nothing until a surface watches, then follows the machine", async () => {
        const machine = fakeMachine();
        const store = notesStoreCreate(machine.transport);
        expect(store.get()).toEqual({ notes: [], status: "unloaded", creating: false });

        const release = store.notesWatch();
        await settle();
        expect(store.get().status).toBe("ready");
        expect(store.get().notes).toEqual([]);

        const created = await store.noteCreate("Plan");
        await settle();
        expect(store.get().notes.map((note) => note.title)).toEqual(["Plan"]);

        // A note written by another tool on the machine arrives without asking.
        machine.foreignEdit(created.id, "outside");
        await settle();
        expect(store.get().notes[0]?.sequence).toBeGreaterThan(created.sequence);

        const followed = store.get().notes[0]?.sequence;
        release();
        // Released: the machine is no longer followed, so an edit made on it stops
        // arriving here until a surface watches again.
        machine.foreignEdit(created.id, " more");
        await settle();
        expect(store.get().notes[0]?.sequence).toBe(followed);
    });

    it("reports a machine that cannot answer without emptying the list", async () => {
        const machine = fakeMachine();
        const failing: NotesTransport = {
            ...machine.transport,
            notesList: async () => {
                throw new Error("Notes folder is unreadable.");
            },
        };
        const store = notesStoreCreate(failing);
        store.notesWatch();
        await settle();
        expect(store.get()).toMatchObject({
            status: "error",
            error: "Notes folder is unreadable.",
        });
    });
});

describe("open note store", () => {
    it("writes edits after a pause and keeps the document while doing it", async () => {
        const machine = fakeMachine();
        const created = await machine.transport.noteCreate("Plan");
        const store = noteStoreCreate(created.note.id, machine.transport, { flushDelayMs: 1 });
        const release = store.noteOpen();
        await settle();
        expect(store.get().status).toBe("ready");

        const document = store.get().ydoc;
        document.getText("body").insert(0, "hello");
        store.noteMarkdownUpdate("hello");
        expect(store.get().saveState).toBe("dirty");
        await settle();
        await settle();
        expect(machine.text(created.note.id)).toBe("hello");
        expect(store.get().saveState).toBe("idle");
        // Storage applying its own state back must not disturb what is on screen.
        expect(document.getText("body").toString()).toBe("hello");
        release();
    });

    it("retries a failed write in front of what was typed since, losing nothing", async () => {
        const machine = fakeMachine();
        const created = await machine.transport.noteCreate();
        const store = noteStoreCreate(created.note.id, machine.transport, { flushDelayMs: 1 });
        const release = store.noteOpen();
        await settle();

        const states: string[] = [];
        store.subscribe(() => states.push(store.get().saveState));

        machine.failNextApply("The disk is full.");
        store.get().ydoc.getText("body").insert(0, "first");
        store.get().ydoc.getText("body").insert(5, " second");
        for (let attempt = 0; attempt < 6; attempt += 1) await settle();

        // The rejected batch is reported, then retried whole in front of whatever
        // was typed since it: Yjs updates commute, so nothing is lost or reordered.
        expect(states).toContain("error");
        expect(machine.text(created.note.id)).toBe("first second");
        expect(store.get().saveState).toBe("idle");
        release();
    });

    it("converges an edit made elsewhere into the open document", async () => {
        const machine = fakeMachine();
        const created = await machine.transport.noteCreate();
        const store = noteStoreCreate(created.note.id, machine.transport, { flushDelayMs: 1 });
        const release = store.noteOpen();
        await settle();
        store.get().ydoc.getText("body").insert(0, "mine");
        await settle();
        await settle();

        machine.foreignEdit(created.note.id, " theirs");
        await settle();
        await settle();
        // Both survive: the read merges rather than replacing the open document.
        expect(store.get().ydoc.getText("body").toString()).toContain("mine");
        expect(store.get().ydoc.getText("body").toString()).toContain("theirs");
        release();
    });

    it("shows a typed title immediately and writes it without a content edit", async () => {
        const machine = fakeMachine();
        const created = await machine.transport.noteCreate("Draft");
        const store = noteStoreCreate(created.note.id, machine.transport, { flushDelayMs: 1 });
        const release = store.noteOpen();
        await settle();

        store.noteTitleUpdate("Final");
        expect(store.get().note?.title).toBe("Final");
        expect(store.get().saveState).toBe("dirty");
        await settle();
        await settle();
        expect((await machine.transport.notesList())[0]?.title).toBe("Final");
        release();
    });
});

describe("notes session", () => {
    it("opens one note at a time and releases the previous document", async () => {
        const machine = fakeMachine();
        const session = notesSessionStoreCreate(machine.transport);
        session.notesOpen();
        const first = await session.noteCreate();
        const second = await session.noteCreate();
        await settle();

        session.notesOpen(first.id);
        await settle();
        const opened = session.get().note;
        expect(session.get().noteId).toBe(first.id);
        expect(opened?.get().status).toBe("ready");

        session.notesOpen(second.id);
        await settle();
        expect(session.get().noteId).toBe(second.id);
        // A different note is a different document, never the previous one reused.
        expect(session.get().note).not.toBe(opened);

        // Addressing the same note again keeps the open document, so navigating
        // back to it does not throw away undo history or reload the content.
        const current = session.get().note;
        session.notesOpen(second.id);
        expect(session.get().note).toBe(current);

        // Removing the open note lets its document go before the file disappears.
        await session.noteRemove(second.id);
        await settle();
        expect(session.get().note).toBeUndefined();
        expect(
            session
                .get()
                .notes.get()
                .notes.map((note) => note.id),
        ).toEqual([first.id]);
    });
});
