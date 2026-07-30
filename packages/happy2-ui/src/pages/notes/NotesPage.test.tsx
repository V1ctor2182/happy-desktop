import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
    noteStoreCreate,
    notesStoreCreate,
    type NoteContent,
    type NoteSummary,
    type NotesTransport,
} from "happy2-state";
import * as Y from "yjs";
import { NotesPage } from "../../index";
import { createRenderer } from "../../testing";

function base64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function summary(id: string, title: string, excerpt: string): NoteSummary {
    return {
        id,
        title,
        excerpt,
        createdAt: Date.parse("2026-07-19T09:00:00.000Z"),
        updatedAt: Date.parse("2026-07-20T12:00:00.000Z"),
        sequence: 3,
    };
}

/** A machine holding the given notes, with empty content behind each of them. */
function transport(notes: readonly NoteSummary[]): NotesTransport {
    const empty = base64(Y.encodeStateAsUpdate(new Y.Doc()));
    const content = (note: NoteSummary): NoteContent => ({ note, state: empty });
    return {
        notesList: async () => notes,
        noteRead: async (id) => content(notes.find((note) => note.id === id)!),
        noteCreate: async () => content(notes[0]!),
        noteApply: async () => notes[0]!,
        noteRename: async () => notes[0]!,
        noteRemove: async () => undefined,
        notesSubscribe: () => () => undefined,
    };
}

function loadedStore(notes: readonly NoteSummary[]) {
    const store = notesStoreCreate(transport(notes));
    store.notesWatch();
    return store;
}

/** Waits for the collection's first read to publish. */
async function listed(store: ReturnType<typeof loadedStore>): Promise<void> {
    while (store.get().status !== "ready") await new Promise((resolve) => setTimeout(resolve, 0));
}

it("lists this machine's notes, opens one, and deletes only through the confirmation", async () => {
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    const onDelete = vi.fn();
    const notes = [
        summary("note-1", "Launch plan", "Ship the desktop build"),
        summary("note-2", "", "Groceries"),
    ];
    const store = loadedStore(notes);
    await listed(store);
    const note = noteStoreCreate("note-1", transport(notes));
    note.noteOpen();

    const view = createRenderer().render(
        () => (
            <NotesPage
                data-testid="page"
                note={note}
                notes={store}
                onCreate={onCreate}
                onDelete={onDelete}
                onOpen={onOpen}
                selectedId="note-1"
            />
        ),
        { width: 860, height: 460 },
    );

    const rows = document.querySelectorAll('[data-happy2-ui="notes-page-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Launch plan");
    // A note with no title is named by its first line rather than by nothing.
    expect(rows[1]?.textContent).toContain("Groceries");

    await userEvent.click(rows[1] as HTMLButtonElement);
    expect(onOpen).toHaveBeenCalledWith("note-2");

    // The list keeps its own lane, so opening a note never re-lays out the index.
    const column = document.querySelector(".happy2-notes-page__list-column") as HTMLElement;
    expect(Math.round(column.getBoundingClientRect().width)).toBe(280);

    const deletes = document.querySelectorAll('[data-happy2-ui="notes-page-row-delete"]');
    await userEvent.click(deletes[0] as HTMLButtonElement);
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = document.querySelector('[data-testid="notes-page-delete-dialog"]');
    expect(dialog?.textContent).toContain("Delete “Launch plan”?");
    await userEvent.click(
        Array.from(dialog!.querySelectorAll("button")).find(
            (button) => button.textContent === "Cancel",
        )!,
    );
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(deletes[0] as HTMLButtonElement);
    await userEvent.click(
        document.querySelector('[data-testid="document-delete-confirm"]') as HTMLButtonElement,
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]![0].id).toBe("note-1");

    (document.querySelector('[data-testid="page"] button') as HTMLButtonElement | null)?.blur();
    await view.screenshot("NotesPage.test");
});

it("offers the first note where the list would be", async () => {
    const onCreate = vi.fn();
    const store = loadedStore([]);
    await listed(store);
    const view = createRenderer().render(
        () => <NotesPage data-testid="page-empty" notes={store} onCreate={onCreate} />,
        { width: 860, height: 380 },
    );
    expect(document.querySelector('[data-testid="page-empty"]')?.textContent).toContain(
        "No notes yet",
    );
    expect(document.querySelector('[data-testid="page-empty"]')?.textContent).toContain(
        "No note open",
    );
    await userEvent.click(
        Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent === "New note",
        ) as HTMLButtonElement,
    );
    expect(onCreate).toHaveBeenCalled();
    await view.screenshot("NotesPage.empty.test");
});
