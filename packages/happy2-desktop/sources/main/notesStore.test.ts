import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NoteError, NotesStore } from "./notesStore";

const stores: NotesStore[] = [];
const directories: string[] = [];

afterEach(async () => {
    for (const store of stores.splice(0)) store.close();
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

async function storeCreate(): Promise<NotesStore> {
    const root = await mkdtemp(join(tmpdir(), "happy2-notes-"));
    directories.push(root);
    const store = new NotesStore(root);
    stores.push(store);
    return store;
}

/** One client's edit, as the base64 update an editor would send. */
function edit(apply: (doc: Y.Doc) => void, from?: string): string {
    const doc = new Y.Doc();
    if (from) Y.applyUpdate(doc, new Uint8Array(Buffer.from(from, "base64")));
    const before = Y.encodeStateVector(doc);
    apply(doc);
    return Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString("base64");
}

function text(state: string): string {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, "base64")));
    return doc.getText("body").toString();
}

describe("machine note collection", () => {
    it("keeps the collaborative state and the Markdown beside it, and survives a reload", async () => {
        const store = await storeCreate();
        const created = await store.create({ title: "  Launch plan\nQ3  " });
        // A title becomes one line in a list row, so newlines never reach disk.
        expect(created.note.title).toBe("Launch plan Q3");

        const applied = await store.applyUpdates(created.note.id, {
            updates: [edit((doc) => doc.getText("body").insert(0, "hello"), created.state)],
            markdown: "# Launch plan\n\nhello\n",
        });
        expect(applied.sequence).toBe(1);
        // The excerpt is read from the projection, the only form of the content
        // this process understands.
        expect(applied.excerpt).toBe("Launch plan");
        await expect(readFile(join(store.root, `${created.note.id}.md`), "utf8")).resolves.toBe(
            "# Launch plan\n\nhello\n",
        );

        // A second store over the same folder is a restarted app: the note is
        // whatever is on disk, not whatever was in memory.
        const reopened = new NotesStore(store.root);
        stores.push(reopened);
        const read = await reopened.read(created.note.id);
        expect(text(read.state)).toBe("hello");
        expect(await reopened.list()).toEqual([applied]);
    });

    it("merges concurrent edits to one note instead of dropping either", async () => {
        const store = await storeCreate();
        const created = await store.create();
        // Both clients edited the same stored state, neither having seen the
        // other: a merge keeps both, while a last-writer-wins store would lose one.
        const first = edit((doc) => doc.getText("body").insert(0, "A"), created.state);
        const second = edit((doc) => doc.getText("body").insert(0, "B"), created.state);
        await Promise.all([
            store.applyUpdates(created.note.id, { updates: [first] }),
            store.applyUpdates(created.note.id, { updates: [second] }),
        ]);
        const merged = text((await store.read(created.note.id)).state);
        expect(merged).toHaveLength(2);
        expect(merged.split("").sort().join("")).toBe("AB");
        expect((await store.read(created.note.id)).note.sequence).toBe(2);
    });

    it("renames without touching content, and removes both files", async () => {
        const store = await storeCreate();
        const created = await store.create({ title: "Draft" });
        await store.applyUpdates(created.note.id, {
            updates: [edit((doc) => doc.getText("body").insert(0, "kept"), created.state)],
            markdown: "kept\n",
        });
        const renamed = await store.rename(created.note.id, "Final");
        expect(renamed.title).toBe("Final");
        expect(text((await store.read(created.note.id)).state)).toBe("kept");

        await store.remove(created.note.id);
        expect(await store.list()).toEqual([]);
        await expect(readFile(join(store.root, `${created.note.id}.md`), "utf8")).rejects.toThrow();
    });

    it("rejects what a caller can correct as invalid input rather than failing the collection", async () => {
        const store = await storeCreate();
        const created = await store.create();
        await expect(store.read("not-an-id")).rejects.toThrow(NoteError);
        await expect(store.read("0".repeat(24))).rejects.toMatchObject({ code: "not_found" });
        await expect(store.applyUpdates(created.note.id, { updates: [] })).rejects.toMatchObject({
            code: "invalid",
        });
        await expect(
            store.applyUpdates(created.note.id, {
                updates: [edit((doc) => doc.getText("body").insert(0, "x"), created.state)],
                markdown: "x".repeat(5 * 1024 * 1024),
            }),
        ).rejects.toMatchObject({ code: "too_large" });

        // One unreadable file must not empty the list around it.
        await writeFile(join(store.root, `${"a".repeat(24)}.note`), "{ not json");
        expect(await store.list()).toHaveLength(1);
    });
});
