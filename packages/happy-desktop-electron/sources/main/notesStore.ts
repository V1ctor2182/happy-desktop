import { randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

/**
 * On-disk note collection owned by this machine.
 *
 * A note is two files that share one basename: `<id>.note` holds the durable
 * collaborative state and its metadata, and `<id>.md` is the normalized Markdown
 * projection beside it — the stable representation an agent can read without
 * knowing anything about the editor. The state file is the authority; the
 * Markdown is derived and may be rewritten from it at any time.
 *
 * Keeping metadata in the same file as the state means one atomic write per
 * change, so a crash can never leave a title that disagrees with the content it
 * belongs to. The Markdown is written after, because a stale projection is
 * recoverable while a lost update is not.
 */
const NOTE_STATE_SUFFIX = ".note";
const NOTE_MARKDOWN_SUFFIX = ".md";
const NOTE_FILE_VERSION = 1;
/** Bounds one note so a runaway writer cannot exhaust the disk or the IPC channel. */
const NOTE_STATE_MAX_BYTES = 8 * 1024 * 1024;
const NOTE_TITLE_MAX_LENGTH = 200;
const NOTE_MARKDOWN_MAX_BYTES = 4 * 1024 * 1024;
const NOTE_UPDATES_MAX_COUNT = 64;

export interface NoteSummary {
    readonly id: string;
    readonly title: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** Monotonic count of accepted writes, used by a client to detect staleness. */
    readonly sequence: number;
    /** First lines of the Markdown projection, for the list row. */
    readonly excerpt: string;
}

export interface NoteContent {
    readonly note: NoteSummary;
    /** Complete Yjs state as one base64 update, ready to apply to an empty document. */
    readonly state: string;
}

interface NoteFile {
    readonly version: number;
    readonly id: string;
    readonly title: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly sequence: number;
    readonly state: string;
}

export interface NoteApplyInput {
    /** Yjs updates as base64, in the order the author produced them. */
    readonly updates: readonly string[];
    /**
     * The author's normalized Markdown for the note after these updates. The
     * writer derives it, because the editor's schema lives with the editor; this
     * process stores opaque collaborative bytes and never interprets them.
     */
    readonly markdown?: string;
    readonly title?: string;
}

/** Rejected input a caller can correct, kept apart from genuine I/O failures. */
export class NoteError extends Error {
    constructor(
        readonly code: "invalid" | "not_found" | "too_large",
        message: string,
    ) {
        super(message);
        this.name = "NoteError";
    }
}

/** The default collection: a defined Happy folder in the user's home, not app-private storage,
 *  so an agent working on this machine can find the Markdown by a stable path. */
export function notesRootDefault(): string {
    return join(homedir(), ".happy2", "notes");
}

function noteIdCreate(): string {
    return randomBytes(12).toString("hex");
}

/** A note id becomes a filename, so only an opaque lowercase-hex token is ever accepted. */
function noteIdValid(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
}

function noteTitleNormalize(value: unknown): string {
    if (typeof value !== "string") return "";
    // A title becomes a single line in a list row; newlines and control
    // characters would let one note's title redraw the rows around it.
    return (
        value
            // eslint-disable-next-line no-control-regex -- control characters are precisely what this removes
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, NOTE_TITLE_MAX_LENGTH)
    );
}

function noteExcerptDerive(markdown: string): string {
    for (const line of markdown.split("\n")) {
        const text = line.replace(/^#{1,6}\s*/, "").trim();
        if (text.length > 0) return text.slice(0, 200);
    }
    return "";
}

function noteFileParse(source: string): NoteFile | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = parsed as Record<string, unknown>;
    if (value.version !== NOTE_FILE_VERSION) return undefined;
    if (!noteIdValid(value.id) || typeof value.state !== "string") return undefined;
    const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0;
    const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : createdAt;
    const sequence = typeof value.sequence === "number" ? value.sequence : 0;
    return {
        version: NOTE_FILE_VERSION,
        id: value.id,
        title: noteTitleNormalize(value.title),
        createdAt,
        updatedAt,
        sequence,
        state: value.state,
    };
}

function noteUpdateDecode(value: string): Uint8Array {
    const bytes = Buffer.from(value, "base64");
    if (bytes.byteLength === 0) throw new NoteError("invalid", "That update is empty.");
    return new Uint8Array(bytes);
}

/**
 * The state of an empty note. Produced by Yjs itself rather than written as a
 * constant so it always matches the version of Yjs doing the merging.
 */
function noteEmptyState(): string {
    return Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString("base64");
}

/**
 * The machine's note collection, and the only writer to its folder.
 *
 * Writes are serialized per note: a note's stored state is read, merged, and
 * replaced as one step, and two concurrent writers to the same note would
 * otherwise each merge onto the state the other is about to overwrite, silently
 * dropping one of them. Yjs merges are commutative, so serializing costs
 * nothing but the wait.
 *
 * The folder is also watched, because the Markdown beside each note invites
 * being read and edited by other tools on this machine. A change nobody here
 * made still has to reach the open editor, so observers are notified from one
 * place regardless of who wrote.
 */
export class NotesStore {
    #writes = new Map<string, Promise<unknown>>();
    #listeners = new Set<() => void>();
    #watcher: FSWatcher | undefined;
    #closed = false;

    constructor(readonly root: string = notesRootDefault()) {}

    /** Notifies observers of any change to the collection, including external ones. */
    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        void this.#watchStart();
        return () => {
            this.#listeners.delete(listener);
            if (this.#listeners.size === 0) this.#watchStop();
        };
    }

    close(): void {
        this.#closed = true;
        this.#listeners.clear();
        this.#watchStop();
    }

    async list(): Promise<readonly NoteSummary[]> {
        let entries: string[];
        try {
            entries = await readdir(this.root);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
        const ids = entries
            .filter((entry) => entry.endsWith(NOTE_STATE_SUFFIX))
            .map((entry) => entry.slice(0, -NOTE_STATE_SUFFIX.length))
            .filter((id) => noteIdValid(id));
        const summaries = await Promise.all(ids.map((id) => this.#summaryRead(id)));
        return summaries
            .filter((summary): summary is NoteSummary => summary !== undefined)
            .sort((left, right) => right.updatedAt - left.updatedAt);
    }

    async read(id: string): Promise<NoteContent> {
        const file = await this.#fileRead(id);
        return { note: await this.#summarize(file), state: file.state };
    }

    async create(input: { readonly title?: string } = {}): Promise<NoteContent> {
        const now = Date.now();
        const file: NoteFile = {
            version: NOTE_FILE_VERSION,
            id: noteIdCreate(),
            title: noteTitleNormalize(input.title),
            createdAt: now,
            updatedAt: now,
            sequence: 0,
            state: noteEmptyState(),
        };
        await this.#serialize(file.id, async () => {
            await this.#fileWrite(file);
            await this.#markdownWrite(file.id, "");
        });
        this.#notify();
        return { note: await this.#summarize(file), state: file.state };
    }

    /**
     * Folds a client's updates into the note's durable state and refreshes its
     * Markdown projection. Yjs merges are order-independent and idempotent, so a
     * retried batch is harmless and needs no separate delivery bookkeeping; the
     * returned sequence only tells the caller how far the stored state has moved.
     */
    async applyUpdates(id: string, input: NoteApplyInput): Promise<NoteSummary> {
        if (!Array.isArray(input.updates) || input.updates.length === 0)
            throw new NoteError("invalid", "That request carries no updates.");
        if (input.updates.length > NOTE_UPDATES_MAX_COUNT)
            throw new NoteError("invalid", "That request carries too many updates at once.");
        if (input.markdown !== undefined) {
            if (typeof input.markdown !== "string")
                throw new NoteError("invalid", "That Markdown projection is not text.");
            if (Buffer.byteLength(input.markdown, "utf8") > NOTE_MARKDOWN_MAX_BYTES)
                throw new NoteError("too_large", "That note's text is too large to store.");
        }
        const updates = input.updates.map((update) => noteUpdateDecode(update));
        return this.#serialize(id, async () => {
            const current = await this.#fileRead(id);
            const merged = Y.mergeUpdates([noteUpdateDecode(current.state), ...updates]);
            if (merged.byteLength > NOTE_STATE_MAX_BYTES)
                throw new NoteError("too_large", "That note is too large to store.");
            const next: NoteFile = {
                ...current,
                title: input.title === undefined ? current.title : noteTitleNormalize(input.title),
                updatedAt: Date.now(),
                sequence: current.sequence + 1,
                state: Buffer.from(merged).toString("base64"),
            };
            await this.#fileWrite(next);
            if (input.markdown !== undefined) await this.#markdownWrite(id, input.markdown);
            this.#notify();
            return this.#summarize(next);
        });
    }

    async rename(id: string, title: string): Promise<NoteSummary> {
        const normalized = noteTitleNormalize(title);
        return this.#serialize(id, async () => {
            const current = await this.#fileRead(id);
            const next: NoteFile = { ...current, title: normalized, updatedAt: Date.now() };
            await this.#fileWrite(next);
            this.#notify();
            return this.#summarize(next);
        });
    }

    /** Removes both files. The Markdown is a projection, so it never outlives its note. */
    async remove(id: string): Promise<void> {
        if (!noteIdValid(id)) throw new NoteError("not_found", "That note no longer exists.");
        await this.#serialize(id, async () => {
            await rm(this.#statePath(id), { force: true });
            await rm(this.#markdownPath(id), { force: true });
        });
        this.#notify();
    }

    #statePath(id: string): string {
        return join(this.root, `${id}${NOTE_STATE_SUFFIX}`);
    }

    #markdownPath(id: string): string {
        return join(this.root, `${id}${NOTE_MARKDOWN_SUFFIX}`);
    }

    async #fileRead(id: string): Promise<NoteFile> {
        if (!noteIdValid(id)) throw new NoteError("not_found", "That note no longer exists.");
        let source: string;
        try {
            source = await readFile(this.#statePath(id), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                throw new NoteError("not_found", "That note no longer exists.");
            throw error;
        }
        const file = noteFileParse(source);
        if (!file) throw new NoteError("invalid", "That note's stored state is unreadable.");
        return file;
    }

    async #fileWrite(file: NoteFile): Promise<void> {
        await mkdir(this.root, { mode: 0o700, recursive: true });
        const path = this.#statePath(file.id);
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(file)}\n`, { mode: 0o600 });
        await rename(temporary, path);
    }

    async #markdownWrite(id: string, markdown: string): Promise<void> {
        await mkdir(this.root, { mode: 0o700, recursive: true });
        const path = this.#markdownPath(id);
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, markdown, { mode: 0o600 });
        await rename(temporary, path);
    }

    async #summaryRead(id: string): Promise<NoteSummary | undefined> {
        try {
            return await this.#summarize(await this.#fileRead(id));
        } catch (error) {
            // One unreadable note must not empty the whole list.
            if (error instanceof NoteError) return undefined;
            throw error;
        }
    }

    /** The excerpt comes from the Markdown projection, the one form of the content this process reads. */
    async #summarize(file: NoteFile): Promise<NoteSummary> {
        let markdown = "";
        try {
            markdown = await readFile(this.#markdownPath(file.id), "utf8");
        } catch {
            markdown = "";
        }
        return {
            id: file.id,
            title: file.title,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            sequence: file.sequence,
            excerpt: noteExcerptDerive(markdown),
        };
    }

    #serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.#writes.get(id) ?? Promise.resolve();
        // Chained off the previous settlement rather than its value, so one
        // rejected write does not fail the next writer to the same note.
        const next = previous.then(operation, operation);
        const settled = next.then(
            () => undefined,
            () => undefined,
        );
        this.#writes.set(id, settled);
        // Drop the chain once it is idle so a long session does not retain one
        // resolved promise per note ever opened.
        void settled.then(() => {
            if (this.#writes.get(id) === settled) this.#writes.delete(id);
        });
        return next;
    }

    #notify(): void {
        for (const listener of this.#listeners) listener();
    }

    async #watchStart(): Promise<void> {
        if (this.#watcher || this.#closed) return;
        try {
            await mkdir(this.root, { mode: 0o700, recursive: true });
            const watcher = watch(this.root, { persistent: false }, () => this.#notify());
            // A watch is a convenience, not a correctness requirement: if the
            // platform drops it, the collection is still whatever is on disk.
            watcher.on("error", () => this.#watchStop());
            if (this.#closed || this.#listeners.size === 0) {
                watcher.close();
                return;
            }
            this.#watcher = watcher;
        } catch {
            this.#watcher = undefined;
        }
    }

    #watchStop(): void {
        this.#watcher?.close();
        this.#watcher = undefined;
    }
}
