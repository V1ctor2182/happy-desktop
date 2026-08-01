import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type {
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigSessionCreateInput,
} from "happy2-state";
import {
    rigDaemonConnectionUnavailable,
    RigDaemonHttpError,
    type RigDaemonClient,
} from "./rigDaemonClient";
import type { EventId, GitChangedFile } from "./rigDaemonTypes";
import { openInRun, openInTargetsRead } from "./openIn";
import { rigDaemonHealthProject } from "./rigHttpProxy";
import {
    rigCatalogProject,
    rigGlobalEventProject,
    rigProjectProject,
    rigSessionEventProject,
    rigSessionProject,
    rigSessionSummaryProject,
    rigSessionUsageProject,
    rigShellResultProject,
    rigSubagentProject,
    rigTerminalProject,
    rigWorktreeProject,
} from "./rigProjection";

interface GitExecOptions {
    readonly cwd: string;
    readonly maxBuffer: number;
    readonly timeout: number;
}

function gitExecText(args: string[], options: GitExecOptions): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        execFileCallback("git", args, { ...options, encoding: "utf8" }, (error, stdout) => {
            if (error) reject(error);
            else resolvePromise(stdout);
        });
    });
}

function gitExecBuffer(args: string[], options: GitExecOptions): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
        execFileCallback("git", args, { ...options, encoding: "buffer" }, (error, stdout) => {
            if (error) reject(error);
            else resolvePromise(stdout);
        });
    });
}

interface GitLineStats {
    readonly addedLines: number;
    readonly deletedLines: number;
    readonly changes: readonly GitChangedFile[];
}

function gitChangedFilesParse(output: string): readonly Omit<GitChangedFile, "revision">[] {
    const records = output.split("\0");
    const changes: Omit<GitChangedFile, "revision">[] = [];
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (!record || record.length < 4) continue;
        const code = record.slice(0, 2);
        const path = record.slice(3);
        const status: GitChangedFile["status"] =
            code === "??"
                ? "untracked"
                : code.includes("D")
                  ? "deleted"
                  : code.includes("R") || code.includes("C")
                    ? "renamed"
                    : code.includes("A")
                      ? "added"
                      : "modified";
        // Porcelain -z writes the original path as the next NUL record for a
        // rename/copy; the destination above is the path the panel should open.
        const renamed = code.includes("R") || code.includes("C");
        const previousPath = renamed ? records[index + 1] : undefined;
        changes.push({ path, status, ...(previousPath ? { previousPath } : {}) });
        if (renamed) index += 1;
    }
    return changes;
}

/** Lines one path gained and lost, as `git diff --numstat` reports them. */
interface GitFileLines {
    readonly addedLines: number;
    readonly deletedLines: number;
}

/**
 * Reads `git diff --numstat -z` into per-path line counts.
 *
 * The `-z` form writes each record as an `added\tdeleted\t` field followed by
 * one path field, or by two path fields when rename detection fired. Nothing in
 * the record says which it was, so a path field is claimed as a rename
 * destination exactly when the field after it is not another stats field.
 * Binary files report `-` on both sides and are left without counts rather than
 * being called an empty change.
 */
function gitNumstatParse(output: string): ReadonlyMap<string, GitFileLines> {
    const lines = new Map<string, GitFileLines>();
    const fields = output.split("\0");
    const stats = /^(\d+|-)\t(\d+|-)\t$/;
    for (let index = 0; index < fields.length; index += 1) {
        const match = stats.exec(fields[index] ?? "");
        if (!match) continue;
        const first = fields[index + 1];
        if (first === undefined) break;
        const second = fields[index + 2];
        const renamed = second !== undefined && !stats.test(second) && second.length > 0;
        const path = renamed ? second : first;
        index += renamed ? 2 : 1;
        if (match[1] === "-" || match[2] === "-") continue;
        lines.set(path, { addedLines: Number(match[1]), deletedLines: Number(match[2]) });
    }
    return lines;
}

/** Files larger than this are summarized without counting their lines. */
const UNTRACKED_LINE_LIMIT = 1024 * 1024;

/**
 * A file Git has never seen has no diff, so its whole content is what it added.
 * Counting it keeps a new file from being the one row in the list with nothing
 * to say about its size. A binary or oversized file is left uncounted.
 */
async function gitUntrackedLinesRead(
    path: string,
    size: number,
): Promise<GitFileLines | undefined> {
    if (size > UNTRACKED_LINE_LIMIT) return undefined;
    try {
        const content = await readFile(path);
        if (content.includes(0)) return undefined;
        const text = content.toString("utf8");
        if (text.length === 0) return { addedLines: 0, deletedLines: 0 };
        const newlines = text.split("\n").length;
        return {
            addedLines: text.endsWith("\n") ? newlines - 1 : newlines,
            deletedLines: 0,
        };
    } catch {
        return undefined;
    }
}

async function gitChangedFilesRevise(
    root: string,
    changes: readonly Omit<GitChangedFile, "revision">[],
    lines: ReadonlyMap<string, GitFileLines>,
): Promise<readonly GitChangedFile[]> {
    return Promise.all(
        changes.map(async (change) => {
            const counted = lines.get(change.path);
            try {
                const details = await stat(resolve(root, change.path));
                const stats =
                    counted ??
                    (change.status === "untracked"
                        ? await gitUntrackedLinesRead(resolve(root, change.path), details.size)
                        : undefined);
                return {
                    ...change,
                    ...(stats ?? {}),
                    revision: `${String(details.mtimeMs)}:${String(details.size)}`,
                };
            } catch {
                return { ...change, ...(counted ?? {}), revision: change.status };
            }
        }),
    );
}

/**
 * Reads the checkout's aggregate textual diff against HEAD. A failed or
 * unavailable Git read leaves the stats absent so listing projects remains
 * available even while a checkout is being initialized or removed.
 */
async function gitLineStatsRead(path: string): Promise<GitLineStats | undefined> {
    try {
        const [stdout, statusOutput] = await Promise.all([
            gitExecText(["diff", "--numstat", "-z", "HEAD", "--"], {
                cwd: path,
                maxBuffer: 4 * 1024 * 1024,
                timeout: 5_000,
            }),
            gitExecText(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
                cwd: path,
                maxBuffer: 4 * 1024 * 1024,
                timeout: 5_000,
            }),
        ]);
        const lines = gitNumstatParse(stdout);
        const changes = await gitChangedFilesRevise(
            path,
            gitChangedFilesParse(statusOutput),
            lines,
        );
        // The checkout total is the sum of the rows the panel lists, so the
        // header and the rows beneath it can never disagree about the same diff.
        let addedLines = 0;
        let deletedLines = 0;
        for (const change of changes) {
            addedLines += change.addedLines ?? 0;
            deletedLines += change.deletedLines ?? 0;
        }
        return { addedLines, deletedLines, changes };
    } catch {
        return undefined;
    }
}

/**
 * Cap on how many paths one workspace listing returns. A repository can hold far
 * more files than anyone can scan, and shipping all of them would cost more in
 * transfer and rendering than the tail is worth. The listing says when it was
 * truncated so the panel can admit it rather than quietly showing part of a
 * repository as if it were the whole one.
 */
const WORKSPACE_FILE_LIMIT = 20_000;

/**
 * Every file Git tracks in a checkout, plus the untracked ones it does not
 * ignore — which is what "all files" means to someone looking at a working
 * tree. Asking Git rather than walking the directory means .gitignore, nested
 * ignore files, and the exclusion of .git itself are all already handled, and
 * handled the same way the changed-file list handles them.
 */
async function workspaceFilesRead(
    client: RigProxyClient,
    groupId: string,
): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
    const catalog = await client.listCatalog();
    const project = catalog.projects.find((candidate) => candidate.id === groupId);
    const workspace = catalog.workspaces.find((candidate) => candidate.id === groupId);
    const root = project?.path ?? workspace?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    let stdout: string;
    try {
        stdout = await gitExecText(
            ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 10_000 },
        );
    } catch {
        // A directory that is not a repository has no listing to give, and that
        // is an ordinary state rather than a failure: the panel shows nothing
        // under "All files" and the changed list beside it is empty too.
        return { paths: [], truncated: false };
    }
    const all = stdout.split("\0").filter((entry) => entry.length > 0);
    all.sort((left, right) => left.localeCompare(right));
    return {
        paths: all.slice(0, WORKSPACE_FILE_LIMIT),
        truncated: all.length > WORKSPACE_FILE_LIMIT,
    };
}

const CHANGED_FILE_MAX_BYTES = 2 * 1024 * 1024;

async function workspaceFileWrite(
    client: RigProxyClient,
    sessionOrGroupId: string,
    filePath: string,
    content: string,
    expectedHash: string | null,
): Promise<void> {
    const bytes = Buffer.from(content, "utf8");
    if (bytes.byteLength > CHANGED_FILE_MAX_BYTES)
        throw new Error("This file is too large to save from the editor.");
    const catalog = await client.listCatalog();
    const isGroup =
        catalog.projects.some((candidate) => candidate.id === sessionOrGroupId) ||
        catalog.workspaces.some((candidate) => candidate.id === sessionOrGroupId);
    if (isGroup) {
        const target = await workspacePathResolve(client, sessionOrGroupId, filePath);
        const current = await readFile(target);
        const currentHash = createHash("sha256").update(current).digest("hex");
        if (expectedHash !== null && expectedHash !== currentHash)
            throw new Error("This file changed since it was opened.");
        await writeFile(target, bytes);
        return;
    }
    await client.writeFile(sessionOrGroupId, {
        content: bytes.toString("base64"),
        expectedHash,
        path: filePath,
    });
}

/**
 * What is left of an attached file's name once it can only name a file in the
 * session's own working directory: no separators, no parent hops, no leading dot
 * that would hide the copy from the person who attached it.
 */
function attachmentNameSafe(name: string): string {
    const base = name.split(/[\\/]/u).pop() ?? "";
    const printable = [...base]
        .filter((character) => (character.codePointAt(0) ?? 0) >= 0x20)
        .join("");
    return printable.replace(/^\.+/u, "").trim().slice(0, 120) || "attachment";
}

/** `report.pdf` becomes `report-2.pdf`, so a copy never loses its extension. */
function attachmentNameNumbered(name: string, attempt: number): string {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name}-${String(attempt)}`;
    return `${name.slice(0, dot)}-${String(attempt)}${name.slice(dot)}`;
}

/**
 * How many names one attachment will try before giving up. A working directory
 * that already holds this many copies of the same file is telling us something
 * other than "pick another number".
 */
const ATTACHMENT_NAME_ATTEMPTS = 50;

/**
 * Copies an attached file into the session's working directory. The daemon is
 * the only way to place bytes there — the machine running the agent may not be
 * this one — and it refuses to overwrite when no hash is given, which is exactly
 * the collision check this needs: a taken name simply moves to the next one.
 */
async function attachmentWrite(
    client: RigProxyClient,
    sessionId: string,
    name: string,
    content: string,
): Promise<{ readonly path: string }> {
    const wanted = attachmentNameSafe(name);
    for (let attempt = 1; attempt <= ATTACHMENT_NAME_ATTEMPTS; attempt += 1) {
        const path = attempt === 1 ? wanted : attachmentNameNumbered(wanted, attempt);
        try {
            await client.writeFile(sessionId, { content, expectedHash: null, path });
            return { path };
        } catch (error) {
            if (!(error instanceof RigDaemonHttpError) || error.statusCode !== 409) throw error;
        }
    }
    throw new Error(`The working directory already holds every name for ${wanted}.`);
}

function changedFileText(bytes: Buffer): string {
    if (bytes.byteLength > CHANGED_FILE_MAX_BYTES)
        throw new Error("This file is too large to open in the editor.");
    if (bytes.includes(0)) throw new Error("Binary files cannot be opened in the editor.");
    return bytes.toString("utf8");
}

/** Resolves a catalog group and a relative workspace path without escaping it. */
async function workspacePathResolve(
    client: RigProxyClient,
    groupId: string,
    filePath: string,
): Promise<string> {
    const catalog = await client.listCatalog();
    const root =
        catalog.projects.find((candidate) => candidate.id === groupId)?.path ??
        catalog.workspaces.find((candidate) => candidate.id === groupId)?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    const canonicalRoot = await realpath(root);
    const target = await realpath(resolve(canonicalRoot, filePath));
    const within = relative(canonicalRoot, target);
    if (
        within === "" ||
        within === ".." ||
        within.startsWith(`..${pathSeparator}`) ||
        isAbsolute(within)
    )
        throw new Error("That file is outside the project or workspace.");
    return target;
}

const pathSeparator = process.platform === "win32" ? "\\" : "/";

/**
 * Reads one file of a checkout as bytes, addressed either by the session working
 * in it or by the project/worktree itself. Exported because the HTML preview
 * server serves a document's assets through the same client and must reach them
 * exactly as every other file route here does, including on a remote machine.
 */
export async function workspaceFileLoad(
    client: RigProxyClient,
    sessionOrGroupId: string,
    filePath: string,
    signal?: AbortSignal,
): Promise<{ readonly content: string; readonly hash: string }> {
    const catalog = await client.listCatalog();
    const isGroup =
        catalog.projects.some((candidate) => candidate.id === sessionOrGroupId) ||
        catalog.workspaces.some((candidate) => candidate.id === sessionOrGroupId);
    if (isGroup) {
        const target = await workspacePathResolve(client, sessionOrGroupId, filePath);
        const bytes = await readFile(target, { signal });
        return {
            content: bytes.toString("base64"),
            hash: createHash("sha256").update(bytes).digest("hex"),
        };
    }
    return client.readFile(sessionOrGroupId, filePath, signal);
}

/** Reads one existing, non-binary text file without asking Git for a diff. */
async function workspaceFileRead(
    client: RigProxyClient,
    sessionId: string,
    filePath: string,
    signal?: AbortSignal,
): Promise<{
    readonly path: string;
    readonly content: string;
    readonly hash: string;
}> {
    const file = await workspaceFileLoad(client, sessionId, filePath, signal);
    return {
        path: filePath,
        content: changedFileText(Buffer.from(file.content, "base64")),
        hash: file.hash,
    };
}

/** Media types the preview surface can render, by lowercase file extension. */
const PREVIEW_CONTENT_TYPE: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    heic: "image/heic",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    tiff: "image/tiff",
    webp: "image/webp",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp4: "video/mp4",
    webm: "video/webm",
    aac: "audio/aac",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    pdf: "application/pdf",
};

/** Cap on the bytes one preview may pull across the proxy. */
const PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The file a preview is currently on, held so the descriptor read and the media
 * request that follows it do not each pull the same file across the daemon
 * socket, and so a video's seeks are answered without re-reading it once per
 * scrub. One entry, because one file is being looked at; it is replaced the
 * moment a different one is asked for, so what it costs is bounded by the
 * preview cap above rather than by how many files have been opened.
 */
let previewHeld: { key: string; contentType: string; bytes: Buffer } | undefined;

function previewKey(sessionId: string, filePath: string, hash?: string): string {
    return `${sessionId}\u0000${filePath}\u0000${hash ?? ""}`;
}

/** The media type a file's extension implies, or the honest refusal to guess. */
function previewContentType(filePath: string): string {
    const name = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
    const dot = name.lastIndexOf(".");
    return PREVIEW_CONTENT_TYPE[dot > 0 ? name.slice(dot + 1) : ""] ?? "application/octet-stream";
}

/**
 * Reads one workspace file as bytes, for a surface that shows the file rather
 * than editing it.
 *
 * The editor read refuses anything with a NUL in it, which is correct for a
 * textarea and exactly wrong for the picture someone just clicked. This read
 * makes no claim about the content beyond its size and the media type its
 * extension implies, so an image, a video, or a PDF reaches the viewer intact.
 */
async function workspaceFileBytesLoad(
    client: RigProxyClient,
    sessionId: string,
    filePath: string,
    hash?: string,
    signal?: AbortSignal,
): Promise<{ readonly contentType: string; readonly bytes: Buffer; readonly hash: string }> {
    const held = previewHeld;
    if (held && hash !== undefined && held.key === previewKey(sessionId, filePath, hash))
        return { contentType: held.contentType, bytes: held.bytes, hash };
    const file = await workspaceFileLoad(client, sessionId, filePath, signal);
    const bytes = Buffer.from(file.content, "base64");
    if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("This file is too large to preview.");
    const contentType = previewContentType(filePath);
    previewHeld = { key: previewKey(sessionId, filePath, file.hash), contentType, bytes };
    return { contentType, bytes, hash: file.hash };
}

/**
 * What a preview needs to open a file, without the file in it: its media type,
 * how big it is, and which revision the bytes will be. The viewer fetches the
 * bytes themselves from the media route with an ordinary URL.
 */
async function workspaceFileBytesRead(
    client: RigProxyClient,
    sessionId: string,
    filePath: string,
    signal?: AbortSignal,
): Promise<{
    readonly path: string;
    readonly contentType: string;
    readonly size: number;
    readonly hash: string;
}> {
    const file = await workspaceFileBytesLoad(client, sessionId, filePath, undefined, signal);
    return {
        path: filePath,
        contentType: file.contentType,
        size: file.bytes.byteLength,
        hash: file.hash,
    };
}

/**
 * Serves one workspace file's bytes to an `img`, `video`, `audio`, or `iframe`.
 *
 * Answers range requests, which is not a nicety: a `video` element seeks by
 * asking for the range it wants, and a server that can only reply with the whole
 * file gives the reader a scrubber that does nothing until the download ends.
 */
async function workspaceFileMediaServe(
    client: RigProxyClient,
    sessionId: string,
    filePath: string,
    hash: string | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    signal?: AbortSignal,
): Promise<void> {
    const file = await workspaceFileBytesLoad(client, sessionId, filePath, hash, signal);
    const total = file.bytes.byteLength;
    const headers: Record<string, string> = {
        "content-type": file.contentType,
        "accept-ranges": "bytes",
        // Addressed by revision, so a stale picture can never outlive an edit
        // and there is nothing to revalidate while one is being looked at.
        "cache-control": hash === undefined ? "no-store" : "private, max-age=3600",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (range && (range[1] !== "" || range[2] !== "")) {
        const suffix = range[1] === "";
        const start = suffix ? Math.max(total - Number(range[2]), 0) : Number(range[1]);
        const end = suffix || range[2] === "" ? total - 1 : Math.min(Number(range[2]), total - 1);
        if (start > end || start >= total) {
            response.writeHead(416, { ...headers, "content-range": `bytes */${String(total)}` });
            response.end();
            return;
        }
        const part = file.bytes.subarray(start, end + 1);
        response.writeHead(206, {
            ...headers,
            "content-length": String(part.byteLength),
            "content-range": `bytes ${String(start)}-${String(end)}/${String(total)}`,
        });
        response.end(part);
        return;
    }
    response.writeHead(200, { ...headers, "content-length": String(total) });
    response.end(file.bytes);
}

async function changedFileRead(
    client: RigProxyClient,
    sessionId: string,
    groupId: string,
    filePath: string,
    signal?: AbortSignal,
): Promise<{
    readonly path: string;
    readonly oldPath: string;
    readonly oldContent: string;
    readonly newContent: string;
    readonly hash?: string;
}> {
    const catalog = await client.listCatalog();
    const root =
        catalog.projects.find((candidate) => candidate.id === groupId)?.path ??
        catalog.workspaces.find((candidate) => candidate.id === groupId)?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    const sessions = (await client.listSessions()).sessions;
    const groupSession =
        sessions.find(
            (candidate) =>
                candidate.id === sessionId &&
                (candidate.workspaceId === groupId ||
                    (candidate.workspaceId === undefined && candidate.projectId === groupId)),
        ) ??
        sessions.find(
            (candidate) =>
                candidate.workspaceId === groupId ||
                (candidate.workspaceId === undefined && candidate.projectId === groupId),
        );
    const git = await gitLineStatsRead(root);
    const change = git?.changes.find((candidate) => candidate.path === filePath);
    if (!change) throw new Error("That file is no longer changed.");
    let newContent = "";
    let hash: string | undefined;
    if (change.status !== "deleted") {
        const file = await workspaceFileLoad(client, groupSession?.id ?? groupId, filePath, signal);
        newContent = changedFileText(Buffer.from(file.content, "base64"));
        hash = file.hash;
    }

    const oldPath = change.previousPath ?? filePath;
    let oldContent = "";
    if (change.status !== "added" && change.status !== "untracked") {
        const stdout = await gitExecBuffer(["show", `HEAD:${oldPath}`], {
            cwd: root,
            maxBuffer: CHANGED_FILE_MAX_BYTES,
            timeout: 5_000,
        });
        oldContent = changedFileText(stdout);
    }
    return { path: filePath, oldPath, oldContent, newContent, ...(hash ? { hash } : {}) };
}

/**
 * Throws the working-tree changes of the named files away, returning each of
 * them to what HEAD says it should be.
 *
 * What that means depends on how the file changed, and Git has a different act
 * for each: a file it has never seen is deleted, a file added to the index goes
 * back to not existing, and a modified or deleted file is restored from HEAD.
 * A rename is two of those at once — the destination disappears and the source
 * comes back — so both of its paths are handled together, never leaving a
 * checkout holding the file under both names.
 *
 * The index is restored alongside the working tree: a staged change the reader
 * asked to be rid of is still a change, and leaving it staged would put a file
 * back in the changed list the moment the panel refreshed.
 *
 * Paths that are no longer changed are skipped rather than refused, because a
 * selection made a second ago may have been overtaken by the agent still
 * working in this checkout.
 */
async function changedFilesRevert(
    client: RigProxyClient,
    groupId: string,
    paths: readonly string[],
): Promise<void> {
    const catalog = await client.listCatalog();
    const root =
        catalog.projects.find((candidate) => candidate.id === groupId)?.path ??
        catalog.workspaces.find((candidate) => candidate.id === groupId)?.path;
    if (!root) throw new Error("That project or workspace is no longer available.");
    const git = await gitLineStatsRead(root);
    if (!git) throw new Error("That checkout has no Git state to revert to.");
    const wanted = new Set(paths);
    // Restored from HEAD: the file exists there and should again.
    const fromHead: string[] = [];
    // Restored from the index after the index is reset to HEAD, which is how a
    // file HEAD does not have stops existing at all.
    const fromIndex: string[] = [];
    const removed: string[] = [];
    for (const change of git.changes) {
        if (!wanted.has(change.path)) continue;
        if (change.status === "untracked") removed.push(change.path);
        else if (change.status === "added") fromIndex.push(change.path);
        else if (change.status === "renamed") {
            fromIndex.push(change.path);
            if (change.previousPath) fromHead.push(change.previousPath);
        } else fromHead.push(change.path);
    }
    for (const path of removed) {
        // A path from the listing is already relative to this checkout, but it
        // arrives over a request, and deleting outside the checkout is not a
        // thing this route may ever be talked into doing.
        const absolute = resolve(root, path);
        const inside = relative(root, absolute);
        if (inside.startsWith("..") || isAbsolute(inside)) continue;
        await rm(absolute, { force: true });
    }
    const restore = (args: string[], targets: readonly string[]) =>
        targets.length === 0
            ? Promise.resolve("")
            : gitExecText([...args, "--", ...targets], {
                  cwd: root,
                  maxBuffer: 4 * 1024 * 1024,
                  timeout: 15_000,
              });
    await restore(["restore", "--staged", "--worktree"], fromIndex);
    await restore(["restore", "--source=HEAD", "--staged", "--worktree"], fromHead);
}

/** The subset of the daemon client the projected loopback surface calls. */
export type RigProxyClient = Pick<
    RigDaemonClient,
    | "health"
    | "rawRequest"
    | "models"
    | "globalInstructions"
    | "setGlobalInstructions"
    | "listSessions"
    | "listCatalog"
    | "gitWatch"
    | "getProject"
    | "getProjectAsset"
    | "listWorkspaces"
    | "createWorkspace"
    | "archiveWorkspace"
    | "reorderWorkspace"
    | "reorderProject"
    | "archiveProject"
    | "renameProject"
    | "renameWorkspace"
    | "reorderSession"
    | "getSession"
    | "listSubagents"
    | "searchFiles"
    | "readFile"
    | "writeFile"
    | "getSessionUsage"
    | "getEvents"
    | "archiveSession"
    | "createSession"
    | "forkSession"
    | "reset"
    | "submitMessage"
    | "steerMessage"
    | "abort"
    | "compact"
    | "rewind"
    | "runShellCommand"
    | "stopBackgroundProcess"
    | "createTerminal"
    | "stopTerminal"
    | "answerUserInput"
    | "changeModel"
    | "changeEffort"
    | "changePermissionMode"
    | "changeServiceTier"
    | "setSessionDraft"
    | "watchSessionEvents"
    | "watchGlobalEvents"
>;

export interface RigProxyHandleOptions {
    readonly client: RigProxyClient;
    readonly method: string;
    /** Request path with any host prefix and query string already stripped. */
    readonly path: string;
    readonly query: URLSearchParams;
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    /**
     * Invoked when a route fails because this client can no longer reach or
     * authenticate to the daemon — an unreachable socket or a token the daemon
     * rejects after a restart — so the host can rebuild the connection. Errors
     * the daemon itself reports (a bad session id, a refused action) are answered
     * as ordinary error statuses and never trigger it.
     */
    readonly onConnectionError?: (error: unknown) => void;
    /** Home directory used to compute home-relative `displayCwd`s. Defaults to the OS home. */
    readonly homeDir?: string;
    /**
     * Where one HTML document of this Rig's checkouts is served as a page. Absent
     * on a host with no preview server — the browser development shell — and the
     * route then reports that this Rig cannot render a document.
     */
    readonly htmlPreviewUrl?: (sessionId: string, filePath: string) => string;
}

/**
 * The single request handler behind the loopback Rig proxy, shared by the packaged
 * Electron `node:http` server and the Vite dev-server middleware. It maps the
 * renderer transport's JSON/SSE routes onto the authenticated `ProtocolHttpClient`.
 * Ordinary routes return projected `happy2-state` shapes; the explicit
 * `rig-connect` routes preserve the connector's raw stream, JSON, conditional
 * request, and response contract. Returns `true` when it owned the request; a
 * `false` result lets the caller fall through (404 for the Node server, `next()`
 * for Vite middleware).
 */
export async function rigProxyHandle(options: RigProxyHandleOptions): Promise<boolean> {
    const { client, method, path, query, request, response } = options;
    const home = options.homeDir ?? homedir();
    const segments = path.split("/").filter((segment) => segment.length > 0);

    try {
        const rigConnectPath = rigConnectDaemonPath(path, query);
        if (rigConnectPath !== undefined) {
            await rigConnectForward(
                client,
                request,
                response,
                method,
                rigConnectPath,
                options.onConnectionError,
            );
            return true;
        }
        if (method === "GET") {
            if (path === "/health") {
                await handleHealth(client, response, options.onConnectionError);
                return true;
            }
            if (path === "/models") {
                writeJson(response, 200, rigCatalogProject((await client.models()).catalog));
                return true;
            }
            if (path === "/instructions") {
                writeJson(response, 200, await client.globalInstructions());
                return true;
            }
            if (path === "/projects") {
                const catalog = await client.listCatalog();
                // The daemon keeps archived projects in its catalog read — a
                // project is only a folder, and it comes back by being used
                // again — so leaving them out is this projection's job. Their
                // worktrees fall away with them, since the list is built by
                // walking projects.
                const projects = catalog.projects.filter(
                    (project) => project.archivedAt === undefined,
                );
                const listed = new Set(projects.map((project) => project.id));
                const workspaces = catalog.workspaces.filter((workspace) =>
                    listed.has(workspace.projectId),
                );
                const watched = await client.gitWatch([
                    ...projects.map((project) => ({ projectId: project.id })),
                    ...workspaces.map((workspace) => ({
                        projectId: workspace.projectId,
                        workspaceId: workspace.id,
                    })),
                ]);
                const projectChanges = new Map<string, number>();
                const workspaceChanges = new Map<string, number>();
                for (const event of watched.snapshots) {
                    if (event.type === "project_git_changed")
                        projectChanges.set(event.projectId, event.data.git.changedFiles);
                    else workspaceChanges.set(event.workspaceId, event.data.git.changedFiles);
                }
                const [projectStats, workspaceStats] = await Promise.all([
                    Promise.all(projects.map((project) => gitLineStatsRead(project.path))),
                    Promise.all(workspaces.map((workspace) => gitLineStatsRead(workspace.path))),
                ]);
                writeJson(response, 200, {
                    projects: projects.map((project, index) =>
                        rigProjectProject(
                            {
                                ...project,
                                changedFiles: projectChanges.get(project.id),
                                ...projectStats[index],
                            },
                            home,
                        ),
                    ),
                    worktrees: workspaces.map((workspace, index) =>
                        rigWorktreeProject(
                            {
                                ...workspace,
                                changedFiles: workspaceChanges.get(workspace.id),
                                ...workspaceStats[index],
                            },
                            home,
                        ),
                    ),
                });
                return true;
            }
            if (path === "/workspace-files") {
                writeJson(
                    response,
                    200,
                    await workspaceFilesRead(client, query.get("group") ?? ""),
                );
                return true;
            }
            if (path === "/workspace-file") {
                const document = await requestWithAbort(request, (signal) =>
                    workspaceFileRead(
                        client,
                        query.get("session") ?? "",
                        query.get("path") ?? "",
                        signal,
                    ),
                );
                writeJson(response, 200, document);
                return true;
            }
            if (path === "/workspace-file-bytes") {
                const document = await requestWithAbort(request, (signal) =>
                    workspaceFileBytesRead(
                        client,
                        query.get("session") ?? "",
                        query.get("path") ?? "",
                        signal,
                    ),
                );
                writeJson(response, 200, document);
                return true;
            }
            if (path === "/html-preview") {
                // The address of the page, not the page: the viewer loads it in
                // a guest of its own, and everything the document names is then
                // fetched from the preview origin rather than through here.
                if (!options.htmlPreviewUrl) {
                    writeJson(response, 501, {
                        error: "This Rig cannot show a rendered document.",
                    });
                    return true;
                }
                writeJson(response, 200, {
                    url: options.htmlPreviewUrl(
                        query.get("session") ?? "",
                        query.get("path") ?? "",
                    ),
                });
                return true;
            }
            if (path === "/workspace-file-media") {
                await requestWithAbort(request, (signal) =>
                    workspaceFileMediaServe(
                        client,
                        query.get("session") ?? "",
                        query.get("path") ?? "",
                        query.get("hash") ?? undefined,
                        request,
                        response,
                        signal,
                    ),
                );
                return true;
            }
            if (path === "/open-in-targets") {
                writeJson(response, 200, await openInTargetsRead());
                return true;
            }
            if (path === "/changed-file") {
                const document = await requestWithAbort(request, (signal) =>
                    changedFileRead(
                        client,
                        query.get("session") ?? "",
                        query.get("group") ?? "",
                        query.get("path") ?? "",
                        signal,
                    ),
                );
                writeJson(response, 200, document);
                return true;
            }
            if (segments[0] === "project-assets" && segments.length === 2) {
                // Re-served rather than linked so the renderer never needs the
                // daemon's socket or its bearer token to paint a project row.
                const asset = await client.getProjectAsset(segments[1]!);
                response.writeHead(200, {
                    "content-type": asset.mediaType,
                    "content-length": String(asset.bytes.byteLength),
                    "cache-control": "public, max-age=31536000, immutable",
                });
                response.end(asset.bytes);
                return true;
            }
            if (path === "/sessions") {
                // The daemon owns both the arrangement and leaving archived
                // sessions out, and already lists them in fractional-index
                // order, so this forwards its listing rather than re-sorting it.
                const sessions = (await client.listSessions()).sessions.map((summary) =>
                    rigSessionSummaryProject(summary, home),
                );
                writeJson(response, 200, sessions);
                return true;
            }
            if (path === "/events/stream") {
                await streamGlobalEvents(
                    client,
                    request,
                    response,
                    query,
                    home,
                    options.onConnectionError,
                );
                return true;
            }
            if (segments[0] === "sessions" && segments[1]) {
                const sessionId = segments[1];
                if (segments.length === 2) {
                    writeJson(
                        response,
                        200,
                        rigSessionProject((await client.getSession(sessionId)).session, home),
                    );
                    return true;
                }
                if (segments[2] === "subagents" && segments.length === 3) {
                    const subagents = (await client.listSubagents(sessionId)).subagents.map(
                        rigSubagentProject,
                    );
                    writeJson(response, 200, subagents);
                    return true;
                }
                if (segments[2] === "files" && segments.length === 3) {
                    const search = query.get("q") ?? "";
                    const limitParam = query.get("limit");
                    const limit = limitParam ? Number(limitParam) : undefined;
                    const files = (
                        await client.searchFiles(
                            sessionId,
                            search,
                            Number.isFinite(limit) ? limit : undefined,
                        )
                    ).files.map((file) => ({ fileName: file.fileName, path: file.path }));
                    writeJson(response, 200, files);
                    return true;
                }
                if (segments[2] === "usage" && segments.length === 3) {
                    writeJson(
                        response,
                        200,
                        rigSessionUsageProject(await client.getSessionUsage(sessionId)),
                    );
                    return true;
                }
                if (segments[2] === "events" && segments.length === 3) {
                    const after = query.get("after") ?? undefined;
                    const events = (
                        await client.getEvents(sessionId, after as EventId | undefined)
                    ).events.flatMap((event) => {
                        const projected = rigSessionEventProject(event, home);
                        return projected ? [projected] : [];
                    });
                    writeJson(response, 200, events);
                    return true;
                }
                if (segments[2] === "events" && segments[3] === "stream" && segments.length === 4) {
                    await streamSessionEvents(
                        client,
                        request,
                        response,
                        sessionId,
                        query,
                        home,
                        options.onConnectionError,
                    );
                    return true;
                }
            }
            return false;
        }

        if (method === "PUT" && path === "/instructions") {
            const body = await bodyReadJson(request);
            // The daemon is the one that decides what fits: it answers a refused
            // write with its own message, which travels back as an error status
            // rather than being second-guessed here.
            writeJson(
                response,
                200,
                await client.setGlobalInstructions(
                    typeof body.instructions === "string" ? body.instructions : "",
                ),
            );
            return true;
        }

        if (method === "POST" && path === "/workspace-file") {
            const body = await bodyReadJson(request);
            await workspaceFileWrite(
                client,
                String(body.session ?? ""),
                String(body.path ?? ""),
                typeof body.content === "string" ? body.content : "",
                typeof body.expectedHash === "string" ? body.expectedHash : null,
            );
            writeJson(response, 200, {});
            return true;
        }

        if (method === "POST" && path === "/changed-files/revert") {
            const body = await bodyReadJson(request);
            await changedFilesRevert(
                client,
                String(body.group ?? ""),
                Array.isArray(body.paths)
                    ? body.paths.filter((entry): entry is string => typeof entry === "string")
                    : [],
            );
            writeJson(response, 200, {});
            return true;
        }

        if (method === "POST" && path === "/attachment") {
            const body = await bodyReadJson(request);
            writeJson(
                response,
                200,
                await attachmentWrite(
                    client,
                    String(body.session ?? ""),
                    String(body.name ?? ""),
                    typeof body.content === "string" ? body.content : "",
                ),
            );
            return true;
        }

        if (method === "POST" && path === "/open-in") {
            const body = await bodyReadJson(request);
            // The group id, not a path. A directory the renderer names is a
            // directory the renderer chose; resolving it from the catalog here
            // means the only thing that can be opened is something the daemon
            // already lists as a project or worktree root.
            const groupId = String(body.group ?? "");
            const catalog = await client.listCatalog();
            const root =
                catalog.projects.find((candidate) => candidate.id === groupId)?.path ??
                catalog.workspaces.find((candidate) => candidate.id === groupId)?.path;
            if (!root) throw new Error("That project or workspace is no longer available.");
            await openInRun(String(body.target ?? ""), root);
            writeJson(response, 200, {});
            return true;
        }

        if (method === "POST" && segments[0] === "projects" && segments[1]) {
            const projectId = segments[1];
            if (segments[2] === "reorder" && segments.length === 3) {
                const body = await bodyReadJson(request);
                const afterId = afterIdOf(body);
                await projectGuarded(client, projectId, (version) =>
                    client.reorderProject(projectId, afterId, version),
                );
                writeJson(response, 200, {});
                return true;
            }
            if (segments[2] === "rename" && segments.length === 3) {
                const body = await bodyReadJson(request);
                // A project rename is unguarded because the daemon asks for no
                // version: the name has nothing derived from it, so the worst a
                // lost race costs is the later of two names.
                await client.renameProject(projectId, nameRead(body));
                writeJson(response, 200, {});
                return true;
            }
            if (segments[2] === "archive" && segments.length === 3) {
                await projectGuarded(client, projectId, (version) =>
                    client.archiveProject(projectId, version),
                );
                writeJson(response, 200, {});
                return true;
            }
            if (segments[2] === "worktrees" && segments.length === 3) {
                const body = await bodyReadJson(request);
                const created = await client.createWorkspace(projectId, {
                    // A base is only forwarded when the renderer named one: the
                    // daemon forks a requested ref verbatim, and forking nothing
                    // in particular is what makes it fetch the remote and cut
                    // the worktree from the project's trunk there rather than
                    // from whatever the project folder is checked out on.
                    ...(typeof body.baseRef === "string" ? { baseRef: body.baseRef } : {}),
                    // The renderer's idempotency key is a cuid2, which is exactly
                    // what the daemon wants for the worktree's own id: repeating
                    // one creation returns that worktree instead of a second one.
                    id: String(body.idempotencyKey ?? ""),
                    name: typeof body.name === "string" ? body.name : "Workspace",
                });
                writeJson(response, 200, rigWorktreeProject(created.workspace, home));
                return true;
            }
            if (segments[2] === "worktrees" && segments[3] && segments.length === 5) {
                const worktreeId = segments[3];
                if (segments[4] === "archive") {
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.archiveWorkspace(projectId, worktreeId, version),
                    );
                    writeJson(response, 200, {});
                    return true;
                }
                if (segments[4] === "rename") {
                    const body = await bodyReadJson(request);
                    const name = nameRead(body);
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.renameWorkspace(projectId, worktreeId, name, version),
                    );
                    writeJson(response, 200, {});
                    return true;
                }
                if (segments[4] === "reorder") {
                    const body = await bodyReadJson(request);
                    const afterId = afterIdOf(body);
                    await worktreeGuarded(client, projectId, worktreeId, (version) =>
                        client.reorderWorkspace(projectId, worktreeId, afterId, version),
                    );
                    writeJson(response, 200, {});
                    return true;
                }
            }
        }

        if (method === "POST" && segments[0] === "sessions") {
            const body = await bodyReadJson(request);
            if (segments.length === 1) {
                const session = await client.createSession(
                    createRequest(body as unknown as RigSessionCreateInput),
                );
                writeJson(response, 200, rigSessionProject(session.session, home));
                return true;
            }
            const sessionId = segments[1]!;
            const action = segments[2];
            if (segments.length !== 3) return false;
            const handled = await handleSessionPost(
                client,
                sessionId,
                action!,
                body,
                response,
                home,
            );
            return handled;
        }

        return false;
    } catch (error) {
        if (rigDaemonConnectionUnavailable(error)) options.onConnectionError?.(error);
        if (!response.headersSent) {
            // A daemon that answered is not a bad gateway: it said what was wrong
            // and with what status, and that is exactly what the renderer has to
            // act on. Restating every one of them as 502 turns "this worktree
            // name is taken" and "that session is gone" into the same opaque
            // failure. 502 is kept for the case it describes — no usable answer
            // from the daemon at all.
            if (error instanceof RigDaemonHttpError)
                writeJson(response, error.statusCode, { error: error.message });
            else writeJson(response, 502, { error: errorMessage(error) });
        } else {
            response.end();
        }
        return true;
    }
}

function rigConnectDaemonPath(path: string, query: URLSearchParams): string | undefined {
    const prefix = "/rig-connect";
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return undefined;
    const daemonPath = path.slice(prefix.length) || "/";
    const suffix = query.toString();
    return `${daemonPath}${suffix.length > 0 ? `?${suffix}` : ""}`;
}

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

function omittedHeaderNames(
    connection: string | string[] | undefined,
    additional: readonly string[],
): Set<string> {
    const omitted = new Set([...HOP_BY_HOP_HEADERS, ...additional]);
    const values = Array.isArray(connection) ? connection : [connection];
    for (const value of values) {
        for (const name of value?.split(",") ?? []) omitted.add(name.trim().toLowerCase());
    }
    return omitted;
}

async function rigConnectForward(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", abort);
    try {
        const hasBody =
            Number(request.headers["content-length"] ?? 0) > 0 ||
            request.headers["transfer-encoding"] !== undefined;
        const body = hasBody ? await bodyReadBuffer(request, 64 * 1024 * 1024) : undefined;
        const omittedRequestHeaders = omittedHeaderNames(request.headers.connection, [
            "authorization",
            "content-length",
            "cookie",
            "host",
            "origin",
            "referer",
        ]);
        const forwardedHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(request.headers)) {
            if (value === undefined || omittedRequestHeaders.has(name)) continue;
            forwardedHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
        }
        const upstream = await client.rawRequest({
            method,
            path,
            ...(body ? { body } : {}),
            ...(Object.keys(forwardedHeaders).length > 0 ? { headers: forwardedHeaders } : {}),
            signal: controller.signal,
        });
        const omittedResponseHeaders = omittedHeaderNames(upstream.headers.connection, [
            "access-control-allow-credentials",
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-allow-origin",
            "access-control-expose-headers",
            "set-cookie",
        ]);
        for (const [name, value] of Object.entries(upstream.headers)) {
            if (value === undefined || omittedResponseHeaders.has(name)) continue;
            if (name === "vary" && response.hasHeader(name)) response.appendHeader(name, value);
            else response.setHeader(name, value);
        }
        response.writeHead(upstream.statusCode);
        await pipeline(upstream.body, response);
    } catch (error) {
        if (controller.signal.aborted) return;
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        throw error;
    } finally {
        request.off("aborted", abort);
        response.off("close", abort);
    }
}

/** The daemon's user-message content blocks, as this proxy composes them. */
type ContentBlock =
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly mediaType: string; readonly data: string };

/**
 * The daemon content blocks one submitted turn carries beyond its text. A local
 * turn has no upload step, so an attached image travels as base64 alongside the
 * text block; a turn with no images sends no `content` at all and the daemon
 * builds the message from `text` as before.
 */
function contentOf(body: Record<string, unknown>): {
    readonly content?: readonly ContentBlock[];
} {
    const images = Array.isArray(body.images) ? body.images : [];
    const blocks: ContentBlock[] = [];
    for (const image of images) {
        if (typeof image !== "object" || image === null) continue;
        const { mediaType, data } = image as { mediaType?: unknown; data?: unknown };
        if (typeof mediaType !== "string" || typeof data !== "string") continue;
        blocks.push({ type: "image", mediaType, data });
    }
    if (blocks.length === 0) return {};
    return { content: [{ type: "text", text: String(body.text ?? "") }, ...blocks] };
}

async function handleSessionPost(
    client: RigProxyClient,
    sessionId: string,
    action: string,
    body: Record<string, unknown>,
    response: ServerResponse,
    home: string,
): Promise<boolean> {
    switch (action) {
        case "fork":
            writeJson(
                response,
                200,
                rigSessionProject((await client.forkSession(sessionId)).session, home),
            );
            return true;
        case "archive":
            writeJson(
                response,
                200,
                rigSessionProject((await client.archiveSession(sessionId)).session, home),
            );
            return true;
        case "reorder":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (await client.reorderSession(sessionId, afterIdOf(body))).session,
                    home,
                ),
            );
            return true;
        case "reset":
            writeJson(
                response,
                200,
                rigSessionProject((await client.reset(sessionId)).session, home),
            );
            return true;
        case "messages":
            await client.submitMessage(sessionId, {
                text: String(body.text ?? ""),
                clientSubmissionId: String(body.idempotencyKey ?? ""),
                ...contentOf(body),
            });
            writeJson(response, 200, {});
            return true;
        case "steer":
            await client.steerMessage(sessionId, {
                text: String(body.text ?? ""),
                clientSubmissionId: String(body.idempotencyKey ?? ""),
                ...(body.expectedRunId ? { expectedRunId: String(body.expectedRunId) } : {}),
                ...contentOf(body),
            });
            writeJson(response, 200, {});
            return true;
        case "draft":
            await client.setSessionDraft(sessionId, {
                draft: typeof body.draft === "string" && body.draft.length > 0 ? body.draft : null,
                origin: String(body.origin ?? ""),
                updatedAt: Number(body.updatedAt),
            });
            writeJson(response, 200, {});
            return true;
        case "abort":
            await client.abort(
                sessionId,
                body.expectedRunId ? { expectedRunId: String(body.expectedRunId) } : {},
            );
            writeJson(response, 200, {});
            return true;
        case "compact":
            await client.compact(sessionId);
            writeJson(response, 200, {});
            return true;
        case "rewind":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (await client.rewind(sessionId, String(body.messageId ?? ""))).session,
                    home,
                ),
            );
            return true;
        case "shell": {
            const result = await client.runShellCommand(sessionId, {
                command: String(body.command ?? ""),
                commandId: String(body.commandId ?? ""),
            });
            writeJson(response, 200, rigShellResultProject(result));
            return true;
        }
        case "stopBackgroundProcess":
            await client.stopBackgroundProcess(sessionId, Number(body.processId));
            writeJson(response, 200, {});
            return true;
        case "createTerminal": {
            // The size is the only thing the renderer decides: the shell and the
            // working directory are the daemon's, so a terminal opened here is the
            // user's own shell in the session it belongs to.
            const created = await client.createTerminal(sessionId, {
                cols: Number(body.cols),
                rows: Number(body.rows),
            });
            writeJson(response, 200, rigTerminalProject(created.terminal));
            return true;
        }
        case "stopTerminal":
            await client.stopTerminal(sessionId, String(body.terminalId ?? ""));
            writeJson(response, 200, {});
            return true;
        case "answerInput":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.answerUserInput(sessionId, String(body.requestId ?? ""), {
                            answers: (body.answers ?? {}) as Record<string, readonly string[]>,
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        case "model": {
            const input = body as unknown as RigModelSelection;
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeModel(sessionId, {
                            modelId: input.modelId,
                            ...(input.providerId ? { providerId: input.providerId } : {}),
                            ...(input.effort ? { effort: input.effort } : {}),
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        }
        case "effort":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeEffort(
                            sessionId,
                            body.effort ? { effort: String(body.effort) } : {},
                        )
                    ).session,
                    home,
                ),
            );
            return true;
        case "permissionMode":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changePermissionMode(sessionId, {
                            permissionMode: body.permissionMode as RigPermissionMode,
                        })
                    ).session,
                    home,
                ),
            );
            return true;
        case "serviceTier":
            writeJson(
                response,
                200,
                rigSessionProject(
                    (
                        await client.changeServiceTier(
                            sessionId,
                            body.serviceTier
                                ? { serviceTier: body.serviceTier as RigServiceTier }
                                : {},
                        )
                    ).session,
                    home,
                ),
            );
            return true;
        default:
            return false;
    }
}

async function handleHealth(
    client: RigProxyClient,
    response: ServerResponse,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    try {
        writeJson(response, 200, rigDaemonHealthProject(await client.health()));
    } catch (error) {
        // A transport failure means the daemon is unreachable; ask the host to
        // restart it and answer 503 so the loader disconnects and backs off.
        onConnectionError?.(error);
        writeJson(response, 503, { error: errorMessage(error) });
    }
}

async function streamSessionEvents(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string,
    query: URLSearchParams,
    home: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    request.on("close", () => controller.abort());
    sseStart(response);
    const after = query.get("after") ?? undefined;
    try {
        await client.watchSessionEvents({
            sessionId,
            ...(after ? { after: after as EventId } : {}),
            signal: controller.signal,
            onEvent: (event) => {
                const projected = rigSessionEventProject(event, home);
                if (projected) sseSend(response, projected);
            },
        });
    } catch (error) {
        if (controller.signal.aborted) return;
        // A dropped stream is how a restarted daemon usually announces itself, so
        // report it before the reader sees the terminal error event.
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        sseSend(response, { error: errorMessage(error) }, "error");
    } finally {
        response.end();
    }
}

async function streamGlobalEvents(
    client: RigProxyClient,
    request: IncomingMessage,
    response: ServerResponse,
    query: URLSearchParams,
    home: string,
    onConnectionError?: (error: unknown) => void,
): Promise<void> {
    const controller = new AbortController();
    request.on("close", () => controller.abort());
    sseStart(response);
    const after = query.get("after") ?? undefined;
    try {
        await client.watchGlobalEvents({
            ...(after !== undefined ? { after } : {}),
            signal: controller.signal,
            onEvent: (entry) => {
                const projected = rigGlobalEventProject(entry, home);
                if (projected) sseSend(response, projected);
            },
        });
    } catch (error) {
        if (controller.signal.aborted) return;
        // A dropped stream is how a restarted daemon usually announces itself, so
        // report it before the reader sees the terminal error event.
        if (rigDaemonConnectionUnavailable(error)) onConnectionError?.(error);
        sseSend(response, { error: errorMessage(error) }, "error");
    } finally {
        response.end();
    }
}

/** The `afterId` of a reorder request: a preceding id, or null for the front. */
function afterIdOf(body: Record<string, unknown>): string | null {
    return typeof body.afterId === "string" ? body.afterId : null;
}

/**
 * Runs one version-guarded worktree action, reading the version the same way the
 * project routes do and retrying once against whichever version won a race.
 */
async function worktreeGuarded(
    client: RigProxyClient,
    projectId: string,
    worktreeId: string,
    run: (version: number) => Promise<unknown>,
): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
        const { workspaces } = await client.listWorkspaces(projectId);
        const worktree = workspaces.find((candidate) => candidate.id === worktreeId);
        if (worktree === undefined) throw new Error("The worktree no longer exists.");
        try {
            await run(worktree.version);
            return;
        } catch (error) {
            if (attempt >= 1 || !(error instanceof RigDaemonHttpError) || error.statusCode !== 409)
                throw error;
        }
    }
}

/**
 * Runs one project mutation, supplying the version guard the daemon requires.
 * The version has to be read here rather than sent by the renderer: it is an
 * optimistic concurrency token of the wire protocol, and letting it reach
 * product state would make every project row carry a value only these calls can
 * use. A losing race answers 409, which is retried once against the version that
 * won.
 */
/**
 * Reads a name from a rename body. Blank is rejected here rather than passed on:
 * a row with no name is unaddressable in the sidebar, and the daemon would
 * accept the empty string.
 */
function nameRead(body: Record<string, unknown>): string {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) throw new Error("A name is required.");
    return name;
}

async function projectGuarded(
    client: RigProxyClient,
    projectId: string,
    run: (version: number) => Promise<unknown>,
): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
        const { project } = await client.getProject(projectId);
        try {
            await run(project.version);
            return;
        } catch (error) {
            if (attempt >= 1 || !(error instanceof RigDaemonHttpError) || error.statusCode !== 409)
                throw error;
        }
    }
}

function createRequest(input: RigSessionCreateInput) {
    return {
        cwd: input.cwd,
        // A session started from this app is one the user opened a window on, so
        // it stays listed after it settles. Only sessions started elsewhere (the
        // TUI asks for this) archive themselves once idle, and the workspace
        // list hides exactly those.
        archiveOnIdle: false,
        // Happy owns a persistent chat list, so Rig is the durable authority for
        // which of those chats have finished or are asking the person something.
        trackUnread: true,
        ...(input.worktreeId ? { workspaceId: input.worktreeId } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
        permissionMode: input.permissionMode ?? "auto",
    };
}

function sseStart(response: ServerResponse): void {
    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
    });
    // An initial comment opens the stream so the client's EventSource fires open.
    response.write(":ok\n\n");
}

function sseSend(response: ServerResponse, data: unknown, event?: string): void {
    if (event) response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

async function requestWithAbort<T>(
    request: IncomingMessage,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    try {
        return await operation(controller.signal);
    } finally {
        request.off("aborted", abort);
    }
}

/**
 * A submitted turn carries its images inline as base64, so the ceiling on a JSON
 * body is really a ceiling on how much someone can paste into one message. Base64
 * costs a third on top of the bytes, which puts a handful of five-megabyte
 * screenshots comfortably under this and still refuses a body large enough to be
 * a mistake.
 */
const JSON_BODY_MAX_BYTES = 64 * 1024 * 1024;

async function bodyReadJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    // Decoded once at the end rather than per chunk: a multi-byte character split
    // across a chunk boundary would otherwise arrive as replacement characters.
    const body = (await bodyReadBuffer(request, JSON_BODY_MAX_BYTES)).toString("utf8");
    if (body.trim().length === 0) return {};
    return JSON.parse(body) as Record<string, unknown>;
}

async function bodyReadBuffer(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maximumBytes) throw new Error("The request body is too large.");
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
