import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import type { ConversationEntry } from "../conversation/conversationEntry.js";
import { rigConversationBuild, rigNoticeEntry, rigOwnerAuthor } from "./rigConversationProject.js";
import type {
    RigBlock,
    RigExplorationOperation,
    RigFileDiff,
    RigJson,
    RigMessage,
    RigSession,
    RigToolFailure,
    RigToolPresentation,
} from "./rigTypes.js";

/**
 * One decoded replica history entry, before it becomes a transcript row.
 *
 * The whole entry travels as one JSON string the owner's machine wrote, so this
 * shape is the envelope around it rather than anything about its contents:
 * `shareSequence` is the only ordering anyone may trust, and `shareEventId` is
 * what gives a row that carries no message id an identity of its own.
 */
export interface RigSessionShareReplicaEntry {
    readonly shareEventId: string;
    readonly shareSequence: number;
    readonly createdAt: number;
    readonly canonicalJson: string;
}

/**
 * The identity a friend-authored message is attributed to.
 *
 * `displayName` is the name the owner registered for that person when they were
 * given access, carried on the message itself — it is the owner's own choice of
 * name rather than something the friend's machine claims for itself, so it is
 * safe to render as attribution. The id is built from the membership, which is
 * what makes one person's rows keep one identity across the whole transcript.
 */
export function rigFriendAuthor(friend: {
    readonly displayName: string;
    readonly shareMemberId: string;
}): ConversationAuthor {
    return {
        id: `rig:friend:${friend.shareMemberId}`,
        displayName: friend.displayName,
        username: usernameOf(friend.displayName),
        kind: "human",
    };
}

/**
 * Who the shared session belongs to, as the person reading a replica sees them.
 *
 * A member's machine is told the owner's peer id and nothing else about them, so
 * this identity has no name to carry — but it must still be its own identity.
 * `rigOwnerAuthor` means "the person at this machine", and on a member's machine
 * that person is the member: attributing the owner's turns to it would show
 * somebody else's prompts as the reader's own.
 */
const REPLICA_OWNER_AUTHOR: ConversationAuthor = {
    id: "rig:share:owner",
    displayName: "Session owner",
    username: "session-owner",
    kind: "human",
};

/** The transcript rows one history entry turns into, before they are ordered. */
type ReplicaItem =
    | { readonly kind: "message"; readonly message: RigMessage }
    | { readonly kind: "notice"; readonly entry: ConversationEntry };

/**
 * Builds the read-only transcript a member sees, in share order.
 *
 * The rows come from the owner's own message log, decoded and handed to the same
 * builder a local session uses, so a replica renders with the tool calls, diffs,
 * and reasoning the owner sees rather than as flattened text. Published events
 * contribute only the two service lines a reader would otherwise never learn
 * about — a run that failed, and a notice the session wrote about itself.
 *
 * Everything here is remote data written by another machine. A row that does not
 * parse, or does not match any shape this understands, is dropped and the rest of
 * the transcript is built without it: an unreadable row is not an error the
 * reader should be shown, and it must never be able to empty the conversation.
 */
export function rigSessionShareReplicaProject(input: {
    readonly shareId: string;
    readonly entries: readonly RigSessionShareReplicaEntry[];
    readonly showReasoning: boolean;
    /** The reader's own Murmur peer id, so their own posted messages read as theirs. */
    readonly viewerPeerId?: string;
}): readonly ConversationEntry[] {
    const items: ReplicaItem[] = [];
    const authors = new Map<string, ConversationAuthor>();
    // The owner publishes forward, but a page is only as ordered as the machine
    // that wrote it; `shareSequence` is the share's own order and the only one
    // this trusts.
    const ordered = [...input.entries].sort(
        (left, right) => left.shareSequence - right.shareSequence,
    );
    for (const entry of ordered) {
        const envelope = envelopeParse(entry.canonicalJson);
        if (!envelope) continue;
        if (envelope.kind === "message") {
            const decoded = messageDecode(envelope.payload);
            if (!decoded) continue;
            items.push({ kind: "message", message: decoded.message });
            // Only a user turn needs an author decided here: everything else is
            // the agent or the session speaking, and the builder names those.
            if (decoded.message.role === "user")
                authors.set(decoded.message.id, userAuthor(decoded.friend, input.viewerPeerId));
            continue;
        }
        const notice = noticeDecode(entry.shareEventId, envelope.payload);
        if (notice) items.push({ kind: "notice", entry: notice });
    }

    const messages: RigMessage[] = [];
    for (const item of items) if (item.kind === "message") messages.push(item.message);
    const built = rigConversationBuild({
        sessionId: input.shareId,
        // A replica has no session: no working directory, no model, no queue,
        // nothing anyone may act on. `rigConversationBuild` reads `messages` and
        // nothing else off this argument, so the decoded log is handed over as
        // the whole of it rather than inventing a session that does not exist.
        session: { messages } as unknown as RigSession,
        ephemeral: [],
        showReasoning: input.showReasoning,
        pendingUserInputs: [],
    });

    return entriesSequenced(authorsApply(entriesInterleave(items, built), authors));
}

/**
 * Puts the service lines back where the share put them.
 *
 * The builder emits every message row and then everything else, which is right
 * for a live session but would move a failure to the end of a replica. Each row
 * it produced is keyed by the message it came from, so walking the two lists
 * together restores the one order the share actually has.
 */
function entriesInterleave(
    items: readonly ReplicaItem[],
    built: readonly ConversationEntry[],
): readonly ConversationEntry[] {
    const interleaved: ConversationEntry[] = [];
    let cursor = 0;
    for (const item of items) {
        if (item.kind === "notice") {
            interleaved.push(item.entry);
            continue;
        }
        while (cursor < built.length && entryMessageId(built[cursor]!) === item.message.id)
            interleaved.push(built[cursor++]!);
    }
    while (cursor < built.length) interleaved.push(built[cursor++]!);
    return interleaved;
}

/** The message a built row came from; every row is keyed by it, alone or with a block index. */
function entryMessageId(entry: ConversationEntry): string {
    const id = entry.kind === "message" ? entry.message.id : entry.id;
    const separator = id.indexOf(":");
    return separator === -1 ? id : id.slice(0, separator);
}

/**
 * Re-attributes the user turns the builder gave to this machine's owner.
 *
 * A local session has exactly one person in it, so the builder signs every user
 * turn as the reader. A shared one has at least two, and telling them apart is
 * most of what makes a replica readable.
 */
function authorsApply(
    entries: readonly ConversationEntry[],
    authors: ReadonlyMap<string, ConversationAuthor>,
): readonly ConversationEntry[] {
    if (authors.size === 0) return entries;
    return entries.map((entry) => {
        if (entry.kind !== "message") return entry;
        const author = authors.get(entry.message.id);
        return author ? { ...entry, message: { ...entry.message, sender: author } } : entry;
    });
}

/**
 * Positional ordering keys, applied after the rows are in share order. The
 * builder numbered its own output before the service lines were put back among
 * them, so those numbers describe an order this transcript no longer has.
 */
function entriesSequenced(entries: readonly ConversationEntry[]): readonly ConversationEntry[] {
    return entries.map((entry, index) => {
        const sequence = String(index + 1).padStart(8, "0");
        if (entry.kind === "message")
            return { ...entry, message: { ...entry.message, sequence, changePts: sequence } };
        return { ...entry, sequence };
    });
}

/** Who wrote one user turn: the reader, another member, or the session's owner. */
function userAuthor(
    friend: ReplicaFriendAuthor | undefined,
    viewerPeerId: string | undefined,
): ConversationAuthor {
    if (!friend) return REPLICA_OWNER_AUTHOR;
    // A message the reader posted comes back through the owner like everyone
    // else's, so this is where it is recognised as their own.
    if (viewerPeerId !== undefined && friend.murmurPeerId === viewerPeerId) return rigOwnerAuthor;
    return rigFriendAuthor(friend);
}

/** A name reduced to the one-word handle every author carries beside it. */
function usernameOf(displayName: string): string {
    const handle = displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return handle === "" ? "friend" : handle;
}

// ---------------------------------------------------------------------------
// Decoding what the owner's machine published
// ---------------------------------------------------------------------------

/**
 * The envelope every history entry is written as. `position` and `runId` are
 * deliberately unread: a replica is ordered by its share sequence, and a run is
 * something the owner's session has rather than something a reader can act on.
 */
interface ReplicaEnvelope {
    readonly kind: "event" | "message";
    readonly payload: unknown;
}

/** The membership a friend-authored message names, as it arrived in the payload. */
interface ReplicaFriendAuthor {
    readonly displayName: string;
    readonly murmurPeerId: string;
    readonly shareMemberId: string;
}

function envelopeParse(canonicalJson: string): ReplicaEnvelope | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(canonicalJson);
    } catch {
        return undefined;
    }
    const envelope = record(parsed);
    if (!envelope) return undefined;
    const kind = text(envelope["kind"]);
    if (kind !== "event" && kind !== "message") return undefined;
    return { kind, payload: envelope["payload"] };
}

/**
 * The two published events a reader would otherwise never learn about, as
 * service lines. Everything else the owner publishes describes streaming or
 * session lifecycle, which a replica shows through the messages themselves; an
 * event this does not recognise is not an error and is dropped in silence.
 */
function noticeDecode(shareEventId: string, payload: unknown): ConversationEntry | undefined {
    const event = record(payload);
    if (!event) return undefined;
    const type = text(event["type"]);
    const data = record(event["data"]) ?? event;
    if (type === "run_error") {
        const message = text(data["errorMessage"]);
        return message
            ? rigNoticeEntry(`event:${shareEventId}`, "error", "Run failed", message)
            : undefined;
    }
    if (type === "system_notice") {
        const message = text(data["text"]);
        return message
            ? rigNoticeEntry(`event:${shareEventId}`, "info", "System", message)
            : undefined;
    }
    return undefined;
}

/**
 * One published message record as the local message shape.
 *
 * The decisions are the ones the desktop host already makes for a local
 * session, so a shared transcript and an owned one read identically: a
 * compaction pass is context bookkeeping and stays out of the transcript, a
 * failed inference is history the reader has to see but nobody authored, and a
 * tool call and its result are ordinary blocks the builder pairs up.
 */
function messageDecode(
    payload: unknown,
): { readonly message: RigMessage; readonly friend?: ReplicaFriendAuthor } | undefined {
    const source = record(payload);
    if (!source) return undefined;
    const id = text(source["id"]);
    const role = text(source["role"]);
    if (id === undefined || role === undefined) return undefined;
    const blocks = blocksDecode(source["blocks"]);
    if (role === "compaction") return { message: { id, role: "system", blocks, internal: true } };
    if (role === "error") return { message: { id, role: "system", blocks, internal: false } };
    if (role !== "system" && role !== "user" && role !== "agent") return undefined;
    const internal = source["internal"] === true;
    const friend = role === "user" ? friendAuthorDecode(source["friendAuthor"]) : undefined;
    return {
        message: { id, role, blocks, internal },
        ...(friend === undefined ? {} : { friend }),
    };
}

function friendAuthorDecode(value: unknown): ReplicaFriendAuthor | undefined {
    const source = record(value);
    if (!source) return undefined;
    const displayName = text(source["displayName"]);
    const murmurPeerId = text(source["murmurPeerId"]);
    const shareMemberId = text(source["shareMemberId"]);
    if (displayName === undefined || murmurPeerId === undefined || shareMemberId === undefined)
        return undefined;
    return { displayName, murmurPeerId, shareMemberId };
}

function blocksDecode(value: unknown): readonly RigBlock[] {
    if (!Array.isArray(value)) return [];
    const blocks: RigBlock[] = [];
    for (const entry of value) {
        const block = blockDecode(entry);
        if (block) blocks.push(block);
    }
    return blocks;
}

function blockDecode(value: unknown): RigBlock | undefined {
    const block = record(value);
    if (!block) return undefined;
    switch (text(block["type"])) {
        case "text": {
            const content = text(block["text"]);
            return content === undefined ? undefined : { type: "text", text: content };
        }
        case "image": {
            const mediaType = text(block["mediaType"]);
            const data = text(block["data"]);
            if (mediaType === undefined || data === undefined) return undefined;
            const detail = text(block["detail"]);
            return {
                type: "image",
                mediaType,
                data,
                ...(detail === "high" || detail === "original" ? { detail } : {}),
            };
        }
        case "thinking": {
            const thinking = text(block["thinking"]);
            return thinking === undefined
                ? undefined
                : { type: "thinking", thinking, redacted: block["redacted"] === true };
        }
        case "tool_call": {
            const id = text(block["id"]);
            const name = text(block["name"]);
            if (id === undefined || name === undefined) return undefined;
            const presentation = callPresentationDecode(block["presentation"]);
            return {
                type: "toolCall",
                id,
                name,
                arguments: jsonDecode(block["arguments"]),
                ...(presentation === undefined ? {} : { presentation }),
            };
        }
        case "tool_result": {
            const toolCallId = text(block["toolCallId"]);
            const toolName = text(block["toolName"]);
            if (toolCallId === undefined || toolName === undefined) return undefined;
            const failure = failureDecode(block["failure"]);
            const presentation = resultPresentationDecode(block["presentation"]);
            return {
                type: "toolResult",
                toolCallId,
                toolName,
                display: text(block["display"]) ?? "",
                failed: block["isError"] === true || failure !== undefined,
                ...(failure === undefined ? {} : { failure }),
                ...(presentation === undefined ? {} : { presentation }),
            };
        }
        default:
            return undefined;
    }
}

const FAILURE_KINDS: readonly RigToolFailure["kind"][] = [
    "execution_failed",
    "interrupted",
    "invalid_arguments",
    "tool_unavailable",
];

function failureDecode(value: unknown): RigToolFailure | undefined {
    const source = record(value);
    if (!source) return undefined;
    const kind = FAILURE_KINDS.find((candidate) => candidate === text(source["kind"]));
    if (kind === undefined) return undefined;
    const message = text(source["message"]);
    return { kind, ...(message === undefined ? {} : { message }) };
}

/**
 * How a call describes itself before it has run. A command shown while it runs
 * carries no output yet, exactly as it does for a local session.
 */
function callPresentationDecode(value: unknown): RigToolPresentation | undefined {
    const source = record(value);
    if (!source) return undefined;
    const type = text(source["type"]);
    if (type === "exec_command") {
        const command = text(source["command"]);
        return command === undefined ? undefined : { type: "execCommand", command, output: "" };
    }
    if (type === "exploration")
        return { type: "exploration", operations: operationsDecode(source["operations"]) };
    return undefined;
}

function resultPresentationDecode(value: unknown): RigToolPresentation | undefined {
    const source = record(value);
    if (!source) return undefined;
    const type = text(source["type"]);
    if (type === "file_diff") {
        const files = filesDecode(source["files"]);
        const omittedFiles = source["omittedFiles"];
        return {
            type: "fileDiff",
            files,
            ...(typeof omittedFiles === "number" ? { omittedFiles } : {}),
        };
    }
    if (type === "exec_command") {
        const command = text(source["command"]);
        return command === undefined
            ? undefined
            : { type: "execCommand", command, output: text(source["output"]) ?? "" };
    }
    // A command shown as exploration while it ran stays exploration once it
    // finishes, so the finished row replaces the running one.
    if (type === "exploration")
        return { type: "exploration", operations: operationsDecode(source["operations"]) };
    if (type === "background_terminal_interaction") {
        const command = text(source["command"]);
        return command === undefined
            ? undefined
            : {
                  type: "backgroundTerminalInteraction",
                  command,
                  input: text(source["input"]) ?? "",
              };
    }
    return undefined;
}

function operationsDecode(value: unknown): readonly RigExplorationOperation[] {
    if (!Array.isArray(value)) return [];
    const operations: RigExplorationOperation[] = [];
    for (const entry of value) {
        const source = record(entry);
        if (!source) continue;
        const kind = text(source["kind"]);
        if (kind === "list") {
            const target = text(source["target"]);
            if (target !== undefined) operations.push({ kind, target });
        } else if (kind === "read") {
            const name = text(source["name"]);
            if (name !== undefined) operations.push({ kind, name });
        } else if (kind === "search") {
            const command = text(source["command"]);
            if (command === undefined) continue;
            const path = text(source["path"]);
            const query = text(source["query"]);
            operations.push({
                kind,
                command,
                ...(path === undefined ? {} : { path }),
                ...(query === undefined ? {} : { query }),
            });
        }
    }
    return operations;
}

const DIFF_KINDS: readonly RigFileDiff["kind"][] = ["add", "delete", "update"];

function filesDecode(value: unknown): readonly RigFileDiff[] {
    if (!Array.isArray(value)) return [];
    const files: RigFileDiff[] = [];
    for (const entry of value) {
        const source = record(entry);
        if (!source) continue;
        const path = text(source["path"]);
        const kind = DIFF_KINDS.find((candidate) => candidate === text(source["kind"]));
        if (path === undefined || kind === undefined) continue;
        const language = text(source["language"]);
        files.push({
            path,
            kind,
            hunks: hunksDecode(source["hunks"]),
            ...(language === undefined ? {} : { language }),
            ...(typeof source["added"] === "number" ? { added: source["added"] } : {}),
            ...(typeof source["deleted"] === "number" ? { deleted: source["deleted"] } : {}),
            ...(typeof source["omittedLines"] === "number"
                ? { omittedLines: source["omittedLines"] }
                : {}),
        });
    }
    return files;
}

function hunksDecode(value: unknown): RigFileDiff["hunks"] {
    if (!Array.isArray(value)) return [];
    const hunks: RigFileDiff["hunks"][number][] = [];
    for (const entry of value) {
        const source = record(entry);
        if (!source) continue;
        const oldStart = source["oldStart"];
        const newStart = source["newStart"];
        if (typeof oldStart !== "number" || typeof newStart !== "number") continue;
        hunks.push({ oldStart, newStart, lines: linesDecode(source["lines"]) });
    }
    return hunks;
}

const LINE_KINDS: readonly RigFileDiff["hunks"][number]["lines"][number]["kind"][] = [
    "add",
    "context",
    "delete",
];

function linesDecode(value: unknown): RigFileDiff["hunks"][number]["lines"] {
    if (!Array.isArray(value)) return [];
    const lines: RigFileDiff["hunks"][number]["lines"][number][] = [];
    for (const entry of value) {
        const source = record(entry);
        if (!source) continue;
        const kind = LINE_KINDS.find((candidate) => candidate === text(source["kind"]));
        const line = text(source["text"]);
        if (kind === undefined || line === undefined) continue;
        lines.push({ kind, text: line });
    }
    return lines;
}

/** Tool arguments, narrowed to the closed JSON the transcript renders. */
function jsonDecode(value: unknown): RigJson {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(jsonDecode);
    const source = record(value);
    if (!source) return null;
    return Object.fromEntries(
        Object.entries(source).map(([key, entry]) => [key, jsonDecode(entry)]),
    );
}

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function text(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
