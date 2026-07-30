import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
/** Git working-tree state of a file, mirrored from the workspace API. */
export type FileTreeGitStatus =
    | "added"
    | "deleted"
    | "ignored"
    | "modified"
    | "renamed"
    | "untracked";
/**
 * One entry in the tree. Directories carry `children` (materialized on expand)
 * and disclosure/paging flags; files are leaves. The caller owns the shape —
 * FileTree renders exactly what it is given and never fetches or mutates.
 */
export type FileTreeNode = {
    /** Stable identity, typically the full path. */
    id: string;
    /** Row label — usually the last path segment. */
    name: string;
    /**
     * Where the row's name lives, shown dimmed after it. A flat listing needs the
     * containing directory to tell two `index.ts` apart, but the name is what is
     * being looked for, so the two are separate rather than one long path that
     * loses its tail to an ellipsis.
     */
    directory?: string;
    kind: "file" | "directory";
    gitStatus?: FileTreeGitStatus;
    /** Lines the file gained and lost, shown beside its status. */
    addedLines?: number;
    deletedLines?: number;
    /** Directory only: whether its children row-group is shown. */
    expanded?: boolean;
    /** Directory only: a page request is in flight. */
    loading?: boolean;
    /** Directory only: more children exist beyond those loaded. */
    hasMore?: boolean;
    children?: FileTreeNode[];
};
export type FileTreeProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    nodes: FileTreeNode[];
    /** Currently selected entry id, if any. */
    selectedId?: string;
    onSelect?: (id: string) => void;
    /** File activated with a double click; directories continue to toggle. */
    onOpen?: (id: string) => void;
    /** Directory expand/collapse request. */
    onToggle?: (id: string) => void;
    /** Directory paging request (the "Show more" affordance). */
    onLoadMore?: (id: string) => void;
    /** Per-depth indentation step. Defaults to 16px. */
    indent?: number;
    /** Whole-tree initial loading state (before any node is known). */
    loading?: boolean;
    loadingLabel?: string;
    emptyLabel?: string;
    moreLabel?: string;
};
/**
 * How a git state reads in a row: a single scannable letter and the word behind
 * it. `added` and `untracked` are one thing to a reader — the file is new — and
 * splitting them into an "A" and a "U" only asked which kind of new it was, so
 * both say New. The letter is decoration; `label` is what assistive technology
 * and the tooltip announce, and `tone` names the colour band in CSS.
 */
const GIT_STATUS: Record<
    FileTreeGitStatus,
    {
        letter: string;
        label: string;
        tone: "new" | "modified" | "renamed" | "deleted" | "ignored";
    }
> = {
    added: { letter: "N", label: "New", tone: "new" },
    deleted: { letter: "D", label: "Deleted", tone: "deleted" },
    ignored: { letter: "I", label: "Ignored", tone: "ignored" },
    modified: { letter: "M", label: "Modified", tone: "modified" },
    renamed: { letter: "R", label: "Renamed", tone: "renamed" },
    untracked: { letter: "N", label: "New", tone: "new" },
};
const BASE_PADDING = 8;
const DEFAULT_INDENT = 16;
/**
 * The kind of thing a file is, which is what its row's icon and icon colour say.
 * A column of identically grey documents makes the reader parse every name to
 * find the one stylesheet among forty modules; a family carries a glyph and a
 * colour, so the shape of a directory is legible before any name is read.
 */
export type FileTreeFamily =
    | "code"
    | "data"
    | "style"
    | "image"
    | "video"
    | "audio"
    | "shell"
    | "secret"
    | "archive"
    | "prose"
    | "config"
    | "directory"
    | "other";
/** Glyph for each family. Colour is the family's own, applied in CSS. */
const FAMILY_ICON: Record<FileTreeFamily, IconName> = {
    archive: "archive",
    audio: "mic",
    code: "code",
    config: "settings",
    data: "braces",
    directory: "files",
    image: "image",
    other: "doc",
    prose: "doc",
    secret: "shield",
    shell: "terminal",
    style: "braces",
    video: "play",
};
/**
 * File-type vocabulary, keyed by lowercase extension. This is a visual decision
 * the tree owns (like its git-status letters), derived purely from the file name
 * — the caller never has to pick an icon or a colour.
 */
const EXTENSION_FAMILY: Record<string, FileTreeFamily> = {
    // Source code
    ts: "code",
    tsx: "code",
    js: "code",
    jsx: "code",
    mjs: "code",
    cjs: "code",
    mts: "code",
    cts: "code",
    py: "code",
    rb: "code",
    go: "code",
    rs: "code",
    java: "code",
    kt: "code",
    kts: "code",
    swift: "code",
    c: "code",
    h: "code",
    cc: "code",
    cpp: "code",
    hpp: "code",
    cxx: "code",
    cs: "code",
    php: "code",
    lua: "code",
    dart: "code",
    scala: "code",
    ex: "code",
    exs: "code",
    clj: "code",
    hs: "code",
    ml: "code",
    sql: "code",
    html: "code",
    htm: "code",
    vue: "code",
    svelte: "code",
    astro: "code",
    // Structured data
    json: "data",
    jsonc: "data",
    json5: "data",
    yaml: "data",
    yml: "data",
    toml: "data",
    xml: "data",
    csv: "data",
    tsv: "data",
    // Configuration
    ini: "config",
    env: "config",
    lock: "config",
    properties: "config",
    conf: "config",
    plist: "config",
    // Stylesheets
    css: "style",
    scss: "style",
    sass: "style",
    less: "style",
    styl: "style",
    // Images
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    svg: "image",
    webp: "image",
    ico: "image",
    bmp: "image",
    avif: "image",
    tiff: "image",
    heic: "image",
    // Video and audio
    mp4: "video",
    mov: "video",
    webm: "video",
    mkv: "video",
    avi: "video",
    m4v: "video",
    mp3: "audio",
    wav: "audio",
    flac: "audio",
    ogg: "audio",
    m4a: "audio",
    aac: "audio",
    // Archives
    zip: "archive",
    tar: "archive",
    gz: "archive",
    tgz: "archive",
    bz2: "archive",
    xz: "archive",
    rar: "archive",
    "7z": "archive",
    // Shell scripts
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ps1: "shell",
    bat: "shell",
    cmd: "shell",
    // Keys and certificates
    pem: "secret",
    key: "secret",
    crt: "secret",
    cert: "secret",
    cer: "secret",
    p12: "secret",
    pfx: "secret",
    // Prose
    md: "prose",
    mdx: "prose",
    markdown: "prose",
    txt: "prose",
    rst: "prose",
    adoc: "prose",
    pdf: "prose",
};
/** Bare filenames (no useful extension) that still have a conventional family. */
const FILENAME_FAMILY: Record<string, FileTreeFamily> = {
    dockerfile: "code",
    makefile: "shell",
    ".gitignore": "config",
    ".gitattributes": "config",
    ".npmrc": "config",
    ".editorconfig": "config",
    ".prettierrc": "config",
    ".dockerignore": "config",
};
/**
 * Pick a file's family from its name. Directories are their own family; files
 * resolve by a special-cased bare name first, then by extension, then fall back
 * to the neutral `other`.
 */
export function fileTreeFamily(node: Pick<FileTreeNode, "kind" | "name">): FileTreeFamily {
    if (node.kind === "directory") return "directory";
    const name = node.name.toLowerCase();
    const special = FILENAME_FAMILY[name];
    if (special) return special;
    const dot = name.lastIndexOf(".");
    // No dot, or a leading-dot dotfile with no further extension (e.g. ".env"
    // reads "env"; ".gitignore" reads "gitignore" and is special-cased above).
    const ext = dot > 0 ? name.slice(dot + 1) : dot === 0 ? name.slice(1) : "";
    return EXTENSION_FAMILY[ext] ?? "other";
}
/**
 * The dimmed directory a file lives in, printed ahead of its name so the row
 * still reads as the path it is, and truncated in its middle rather than at its
 * end.
 *
 * A path is at its most identifying where it starts and where it stops, so
 * cutting the tail off `packages/happy2-ui/src/pages/files` leaves every row in
 * a monorepo reading `packages/happy2…`. The last segment is held out of the
 * shrinking run as a fixed-width tail, so the elision opens in the middle and
 * both ends survive. Doing it in CSS keeps a listing of thousands of rows free
 * of per-row measurement.
 */
function FileTreePath(props: { path: string }) {
    const cut = props.path.lastIndexOf("/");
    const head = cut === -1 ? props.path : props.path.slice(0, cut);
    // The separator travels with the tail so the directory always ends in one,
    // joining it to the name that follows without a gap between them.
    const tail = cut === -1 ? "/" : `${props.path.slice(cut)}/`;
    return (
        <span className="happy2-file-tree__path" data-happy2-ui="file-tree-path" title={props.path}>
            {cut === -1 ? null : <span className="happy2-file-tree__path-head">{head}</span>}
            <span className="happy2-file-tree__path-tail">{cut === -1 ? `${head}/` : tail}</span>
        </span>
    );
}
/**
 * What one file did to the diff. A side that changed nothing is left out rather
 * than printed as a zero the reader has to read before learning there is nothing
 * to learn, and a file with no counts at all — a binary, or a listing with no Git
 * behind it — shows nothing instead of a false "+0 −0".
 */
function FileTreeStat(props: { added?: number; deleted?: number }) {
    const added = props.added !== undefined && props.added > 0;
    const deleted = props.deleted !== undefined && props.deleted > 0;
    if (!added && !deleted) return null;
    return (
        <span className="happy2-file-tree__stat" data-happy2-ui="file-tree-stat">
            {added ? (
                <span className="happy2-file-tree__stat-added">{`+${String(props.added)}`}</span>
            ) : null}
            {deleted ? (
                <span className="happy2-file-tree__stat-deleted">{`−${String(props.deleted)}`}</span>
            ) : null}
        </span>
    );
}
function FileTreeRow(props: {
    node: FileTreeNode;
    depth: number;
    indent: number;
    selectedId?: string;
    onSelect?: (id: string) => void;
    onOpen?: (id: string) => void;
    onToggle?: (id: string) => void;
    onLoadMore?: (id: string) => void;
    moreLabel: string;
}) {
    const node = () => props.node;
    const directory = () => node().kind === "directory";
    const selected = () => props.selectedId === node().id;
    const status = () => (node().gitStatus ? GIT_STATUS[node().gitStatus!] : undefined);
    const padLeft = () => BASE_PADDING + props.depth * props.indent;
    return (
        <>
            <div
                className="happy2-file-tree__row"
                data-happy2-ui="file-tree-row"
                data-family={fileTreeFamily(node())}
                data-kind={node().kind}
                data-path={node().id}
                data-selected={selected() ? "" : undefined}
                data-status={node().gitStatus}
                data-tone={status()?.tone}
                data-expanded={directory() && node().expanded ? "" : undefined}
                style={{ paddingLeft: `${padLeft()}px` }}
            >
                <span className="happy2-file-tree__disc" data-happy2-ui="file-tree-disc">
                    {directory() ? (
                        <button
                            aria-expanded={node().expanded ? "true" : "false"}
                            aria-label={`${node().expanded ? "Collapse" : "Expand"} ${node().name}`}
                            className="happy2-file-tree__chevron"
                            data-happy2-ui="file-tree-chevron"
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onToggle?.(node().id);
                            }}
                            type="button"
                        >
                            <Icon
                                name={node().expanded ? "chevron-down" : "chevron-right"}
                                size={12}
                            />
                        </button>
                    ) : null}
                </span>
                <button
                    aria-current={selected() ? "true" : undefined}
                    className="happy2-file-tree__entry"
                    data-happy2-ui="file-tree-entry"
                    // A directory has nothing to select: clicking one anywhere
                    // along its row discloses it, which is what its chevron
                    // does and what the whole row looks like it should do.
                    // Reporting it as a selection asked the caller to open a
                    // folder as though it were a file.
                    onClick={() =>
                        directory() ? props.onToggle?.(node().id) : props.onSelect?.(node().id)
                    }
                    onDoubleClick={() => {
                        if (!directory()) props.onOpen?.(node().id);
                    }}
                    type="button"
                >
                    <span className="happy2-file-tree__icon" data-happy2-ui="file-tree-icon">
                        <Icon name={FAMILY_ICON[fileTreeFamily(node())]} size={14} />
                    </span>
                    <span className="happy2-file-tree__label" data-happy2-ui="file-tree-label">
                        {node().directory ? <FileTreePath path={node().directory!} /> : null}
                        <span className="happy2-file-tree__name" data-happy2-ui="file-tree-name">
                            {node().name}
                        </span>
                    </span>
                    <FileTreeStat added={node().addedLines} deleted={node().deletedLines} />
                    {status()
                        ? ((entry) => (
                              <span
                                  aria-label={entry.label}
                                  className="happy2-file-tree__status"
                                  data-happy2-ui="file-tree-status"
                                  title={entry.label}
                              >
                                  {entry.letter}
                              </span>
                          ))(status()!)
                        : null}
                </button>
            </div>
            {directory() && node().expanded ? (
                node().loading ? (
                    <div
                        className="happy2-file-tree__loading"
                        data-happy2-ui="file-tree-loading"
                        style={{
                            paddingLeft: `${BASE_PADDING + (props.depth + 1) * props.indent}px`,
                        }}
                    >
                        Loading…
                    </div>
                ) : (
                    <>
                        {(node().children ?? []).map((child) => (
                            <FileTreeRow
                                depth={props.depth + 1}
                                key={child.id}
                                indent={props.indent}
                                moreLabel={props.moreLabel}
                                node={child}
                                onLoadMore={props.onLoadMore}
                                onOpen={props.onOpen}
                                onSelect={props.onSelect}
                                onToggle={props.onToggle}
                                selectedId={props.selectedId}
                            />
                        ))}
                        {node().hasMore ? (
                            <button
                                className="happy2-file-tree__more"
                                data-happy2-ui="file-tree-more"
                                onClick={() => props.onLoadMore?.(node().id)}
                                style={{
                                    paddingLeft: `${BASE_PADDING + (props.depth + 1) * props.indent}px`,
                                }}
                                type="button"
                            >
                                {props.moreLabel}
                            </button>
                        ) : null}
                    </>
                )
            ) : null}
        </>
    );
}
/**
 * C-052 FileTree — a props-only, indentable file/folder tree modeled on a
 * code-editor explorer. Directories disclose with a chevron and reveal their
 * (caller-materialized) children; files are leaves that show a type icon
 * resolved from their name plus an optional git-status decoration. Selection,
 * hover, per-directory loading, and a "Show more" paging affordance are all
 * driven by props — the tree never fetches or holds state.
 */
export function FileTree(props: FileTreeProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "nodes",
        "selectedId",
        "onSelect",
        "onOpen",
        "onToggle",
        "onLoadMore",
        "indent",
        "loading",
        "loadingLabel",
        "emptyLabel",
        "moreLabel",
    ]);
    const indent = () => local.indent ?? DEFAULT_INDENT;
    return (
        <div
            className={["happy2-file-tree", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="file-tree"
            data-testid={local["data-testid"]}
            role="tree"
            style={local.style}
        >
            {!local.loading ? (
                local.nodes.length > 0 ? (
                    local.nodes.map((node) => (
                        <FileTreeRow
                            depth={0}
                            key={node.id}
                            indent={indent()}
                            moreLabel={local.moreLabel ?? "Show more…"}
                            node={node}
                            onLoadMore={local.onLoadMore}
                            onOpen={local.onOpen}
                            onSelect={local.onSelect}
                            onToggle={local.onToggle}
                            selectedId={local.selectedId}
                        />
                    ))
                ) : (
                    <div className="happy2-file-tree__status-line" data-happy2-ui="file-tree-empty">
                        {local.emptyLabel ?? "No files to show."}
                    </div>
                )
            ) : (
                <div
                    className="happy2-file-tree__status-line"
                    data-happy2-ui="file-tree-status-line"
                >
                    {local.loadingLabel ?? "Loading files…"}
                </div>
            )}
        </div>
    );
}
