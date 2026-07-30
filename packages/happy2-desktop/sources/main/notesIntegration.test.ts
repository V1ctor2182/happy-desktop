import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { notesSessionStoreCreate, type NotesTransport } from "happy2-state";
import { NotesStore } from "./notesStore";

const stores: NotesStore[] = [];
const directories: string[] = [];

afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

/**
 * The renderer's transport over the real collection, standing in for the IPC hop
 * between them: both sides are the shipped code, so this exercises the note
 * lifecycle end to end rather than against a remembered fake.
 */
function transportOver(store: NotesStore): NotesTransport {
    return {
        notesList: () => store.list(),
        noteRead: (id) => store.read(id),
        noteCreate: (title) => store.create(title === undefined ? {} : { title }),
        noteApply: (request) => store.applyUpdates(request.id, request),
        noteRename: (id, title) => store.rename(id, title),
        noteRemove: (id) => store.remove(id),
        notesSubscribe: (listener) => store.subscribe(listener),
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("carries a note from the editor's document to Markdown on disk and back after a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "happy2-notes-e2e-"));
    directories.push(root);
    const machine = new NotesStore(root);
    stores.push(machine);
    const session = notesSessionStoreCreate(transportOver(machine));

    session.notesOpen();
    const created = await session.noteCreate();
    session.notesOpen(created.id);
    await settle();
    const note = session.get().note!;
    expect(note.get().status).toBe("ready");

    // What the editor does: write into the collaborative document, then hand over
    // its own Markdown projection and the title the reader typed.
    note.get().ydoc.getText("body").insert(0, "buy milk");
    note.noteMarkdownUpdate("# Groceries\n\nbuy milk\n");
    note.noteTitleUpdate("Groceries");
    note.noteFlush();
    await settle();
    expect(note.get().saveState).toBe("idle");

    // The Markdown is a plain file under a stable path, which is the whole point:
    // an agent on this machine reads the note without knowing about the editor.
    await expect(readFile(join(root, `${created.id}.md`), "utf8")).resolves.toBe(
        "# Groceries\n\nbuy milk\n",
    );
    expect((await machine.list())[0]).toMatchObject({
        id: created.id,
        title: "Groceries",
        excerpt: "Groceries",
    });

    // A restarted app is a second session over the same folder: the content is
    // whatever the files say.
    const reopened = new NotesStore(root);
    stores.push(reopened);
    const next = notesSessionStoreCreate(transportOver(reopened));
    next.notesOpen(created.id);
    await settle();
    expect(next.get().note?.get().ydoc.getText("body").toString()).toBe("buy milk");
    expect(next.get().note?.get().note?.title).toBe("Groceries");
});
