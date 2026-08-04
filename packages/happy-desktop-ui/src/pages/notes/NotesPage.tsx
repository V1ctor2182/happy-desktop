import { useState, useSyncExternalStore } from "react";
import type { NoteStore, NoteSummary, NotesStore } from "happy-desktop-state";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { DocumentDeleteDialog } from "../../DocumentDeleteDialog";
import { DocumentSurface } from "../../DocumentSurface";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { Toolbar } from "../../Toolbar";

const emptySubscribe = () => () => undefined;
const emptySnapshot = () => undefined;

export interface NotesPageProps {
    readonly "data-testid"?: string;
    /** Every note on this machine. */
    readonly notes: NotesStore;
    /** The open note, when one is open. Its identity is the open-note lifetime. */
    readonly note?: NoteStore;
    readonly selectedId?: string;
    readonly onOpen?: (id: string) => void;
    readonly onCreate?: () => void;
    /** Invoked only after the user confirms the destructive dialog. */
    readonly onDelete?: (note: NoteSummary) => void;
    readonly theme?: "light" | "dark";
}

function editedLabel(updatedAt: number): string {
    const date = new Date(updatedAt);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? `Edited ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`
        : `Edited ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

/**
 * The notes surface: this machine's notes as an index beside the open one.
 *
 * A note is a local file, so the list carries no sharing or channel language and
 * the surface stands alone rather than inside a conversation. The editor is the
 * same `DocumentSurface` used for collaborative documents — a note is one of
 * those that happens to live on this machine.
 */
export function NotesPage(props: NotesPageProps) {
    const snapshot = useSyncExternalStore(props.notes.subscribe, props.notes.get, props.notes.get);
    const [deleteTarget, setDeleteTarget] = useState<NoteSummary>();
    const notes = snapshot.notes;

    const list = () => {
        if (snapshot.status === "error")
            return (
                <Box className="happy2-notes-page__list">
                    <Banner tone="danger" title="Notes unavailable">
                        {snapshot.error ?? "That did not work."}
                    </Banner>
                </Box>
            );
        if (snapshot.status === "loading" || snapshot.status === "unloaded")
            return <div className="happy2-notes-page__status">Loading notes…</div>;
        if (notes.length === 0)
            return (
                <EmptyState
                    action={
                        props.onCreate
                            ? { label: "New note", onClick: () => props.onCreate?.() }
                            : undefined
                    }
                    // The list is empty and the reader can fix that from right
                    // here — so the wand goes only where the button does. The
                    // editor beside it keeps its plain glyph, so the two halves
                    // of this screen never both wave artwork at once.
                    animation={props.onCreate ? "wand" : undefined}
                    description="Notes are kept on this machine, as Markdown you can read from anywhere."
                    icon="doc"
                    size="panel"
                    title="No notes yet"
                />
            );
        return (
            <div className="happy2-notes-page__list" data-happy-desktop-ui="notes-page-list">
                {notes.map((note) => (
                    <div
                        className="happy2-notes-page__item"
                        data-selected={note.id === props.selectedId}
                        key={note.id}
                    >
                        <button
                            className="happy2-notes-page__row"
                            data-happy-desktop-ui="notes-page-row"
                            onClick={() => props.onOpen?.(note.id)}
                            type="button"
                        >
                            <span className="happy2-notes-page__title">
                                {note.title || note.excerpt || "Untitled note"}
                            </span>
                            <span className="happy2-notes-page__meta">
                                {editedLabel(note.updatedAt)}
                            </span>
                        </button>
                        {props.onDelete ? (
                            <button
                                aria-label={`Delete ${note.title || "Untitled note"}`}
                                className="happy2-notes-page__row-delete"
                                data-happy-desktop-ui="notes-page-row-delete"
                                onClick={() => setDeleteTarget(note)}
                                title="Delete note"
                                type="button"
                            >
                                <Icon name="close" size={14} />
                            </button>
                        ) : null}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <section className="happy2-notes-page" data-testid={props["data-testid"]}>
            <Box className="happy2-notes-page__list-column">
                <Toolbar
                    subtitle={`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
                    title="Notes"
                    trailing={
                        props.onCreate ? (
                            <Button
                                aria-label="New note"
                                icon="plus"
                                onClick={() => props.onCreate?.()}
                                size="small"
                                variant="secondary"
                            />
                        ) : undefined
                    }
                />
                <Box className="happy2-notes-page__scroll">{list()}</Box>
            </Box>
            <Box className="happy2-notes-page__pane">
                <NotePane note={props.note} theme={props.theme} />
            </Box>
            {deleteTarget ? (
                <DocumentDeleteDialog
                    data-testid="notes-page-delete-dialog"
                    documentTitle={deleteTarget.title || "Untitled note"}
                    onCancel={() => setDeleteTarget(undefined)}
                    onConfirm={() => {
                        const target = deleteTarget;
                        setDeleteTarget(undefined);
                        if (target) props.onDelete?.(target);
                    }}
                />
            ) : null}
        </section>
    );
}

/**
 * The open note, or the reason there is nothing to show. Kept separate so the
 * index beside it does not re-render on every keystroke in the editor.
 */
function NotePane(props: { readonly note?: NoteStore; readonly theme?: "light" | "dark" }) {
    const note = props.note;
    const snapshot = useSyncExternalStore(
        note?.subscribe ?? emptySubscribe,
        note ? note.get : emptySnapshot,
        note ? note.get : emptySnapshot,
    );
    if (!note || !snapshot)
        return (
            <EmptyState
                description="Pick a note from the list, or start a new one."
                icon="doc"
                title="No note open"
            />
        );
    return (
        <DocumentSurface
            error={snapshot.status === "error" ? snapshot.error : undefined}
            loading={snapshot.status === "loading"}
            onMarkdown={(markdown) => note.noteMarkdownUpdate(markdown)}
            onTitleCommit={(title) => note.noteTitleUpdate(title)}
            saveState={snapshot.saveState}
            saveError={snapshot.saveError}
            theme={props.theme}
            title={snapshot.note?.title ?? ""}
            user={{ name: "You", color: "#0a7c72" }}
            ydoc={snapshot.ydoc}
        />
    );
}
