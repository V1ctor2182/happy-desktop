import { partitionComponentProps } from "./componentProps";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button";
import { CodeBlock } from "./CodeBlock";
import { fileTreeFamily } from "./FileTree";
import { Icon, type IconName } from "./Icon";
import { ImageViewer } from "./ImageViewer";
import { MarkdownDocument } from "./MarkdownDocument";
import { SegmentedControl } from "./SegmentedControl";
import { Spinner } from "./Spinner";
import { Ionicon } from "./vectorIcons/VectorIcon";
/**
 * How a file is shown. `binary` is the honest answer for something this surface
 * cannot render — an executable, an archive, a format nobody wrote a viewer for
 * — and says so with the file's own facts rather than a wall of mojibake.
 */
export type FilePreviewKind =
    | "image"
    | "video"
    | "audio"
    | "markdown"
    | "html"
    | "text"
    | "pdf"
    | "binary";
/** What the preview is looking at, once the caller has resolved the bytes. */
export type FilePreviewContent =
    | { readonly type: "loading" }
    | { readonly type: "error"; readonly message: string }
    /** A URL the browser can render directly: an object URL or an app-served asset. */
    | { readonly type: "url"; readonly url: string }
    /** Decoded text, for the Markdown and source views. */
    | { readonly type: "text"; readonly text: string }
    /** Nothing to render, only the facts about the file. */
    | { readonly type: "unavailable" };
export type FilePreviewProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** Full path or name. Its last segment titles the preview. */
    path: string;
    /** Overrides the kind derived from the path — use it when the bytes disagree. */
    kind?: FilePreviewKind;
    content: FilePreviewContent;
    /** Human-readable size, shown beside the name. */
    size?: string;
    /**
     * Intrinsic pixel size of an image, shown beside its size. Absent lets the
     * picture state its own once it decodes, which is the only place that fact
     * exists for a file the caller only holds an address for.
     */
    dimensions?: string;
    /** Trailing header controls, e.g. Download or Open in editor. */
    actions?: ReactNode;
    /**
     * Shows this picture in a window of the host's own. Present only where such
     * a window exists, so the control is absent rather than inert in a browser.
     */
    onImageWindowOpen?: () => void;
    /**
     * Opens a file a rendered Markdown document links to. Absent leaves those
     * links inert, which is the honest answer on a surface with no workspace
     * behind it.
     */
    onFileOpen?: (path: string) => void;
    /**
     * The file as a page rather than as characters, supplied by the host: an
     * HTML document has a rendered face this surface cannot draw itself, since
     * running a page is the embedder's job. Absent leaves such a file readable
     * as source only, which is the honest state before its address is known.
     */
    rendered?: ReactNode;
    onClose?: () => void;
    closeLabel?: string;
};

/** Which face of a Markdown file is showing: the document, or what it is written in. */
type MarkdownFace = "rendered" | "source";

const MARKDOWN_FACES: readonly { value: MarkdownFace; label: string }[] = [
    { value: "rendered", label: "Rendered" },
    { value: "source", label: "Source" },
];
/** File extensions this surface can actually render, by how it renders them. */
const EXTENSION_KIND: Record<string, FilePreviewKind> = {
    avif: "image",
    bmp: "image",
    gif: "image",
    heic: "image",
    ico: "image",
    jpeg: "image",
    jpg: "image",
    png: "image",
    svg: "image",
    tiff: "image",
    webp: "image",
    m4v: "video",
    mkv: "video",
    mov: "video",
    mp4: "video",
    webm: "video",
    aac: "audio",
    flac: "audio",
    m4a: "audio",
    mp3: "audio",
    ogg: "audio",
    wav: "audio",
    markdown: "markdown",
    md: "markdown",
    mdx: "markdown",
    htm: "html",
    html: "html",
    pdf: "pdf",
};
/** Kinds whose bytes are opaque: a preview asks the caller for a URL, not text. */
const URL_KINDS = new Set<FilePreviewKind>(["image", "video", "audio", "pdf"]);
/**
 * What the preview should do with a file, from its name.
 *
 * Anything the `FileTree` already recognizes as source, data, configuration, or
 * prose is text, because the reason to open one is to read it. Everything else
 * is binary until proven otherwise — guessing wrong towards text is what fills a
 * viewer with replacement characters.
 */
export function filePreviewKind(path: string): FilePreviewKind {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1) : "";
    const known = EXTENSION_KIND[ext];
    if (known) return known;
    const family = fileTreeFamily({ kind: "file", name });
    return family === "code" ||
        family === "data" ||
        family === "style" ||
        family === "config" ||
        family === "shell" ||
        family === "prose"
        ? "text"
        : "binary";
}
/** Header glyph for each kind — what sort of thing is being looked at. */
const KIND_ICON: Record<FilePreviewKind, IconName> = {
    audio: "mic",
    binary: "doc",
    html: "globe",
    image: "image",
    markdown: "doc",
    pdf: "doc",
    text: "code",
    video: "play",
};
/**
 * C-169 FilePreview — one file, shown rather than downloaded.
 *
 * Clicking a JPEG shows the JPEG, a video plays, and a Markdown file renders as
 * prose. This is the single surface behind every "open this file" in the
 * product; where it appears — a main content tab, the side panel — is the
 * caller's decision, and the preview fills whatever region it is given.
 *
 * Props only. The caller resolves the bytes, decides whether they became a URL
 * or text, and owns the loading and failure states; the preview renders what it
 * is handed and never fetches.
 */
export function FilePreview(props: FilePreviewProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "path",
        "kind",
        "content",
        "size",
        "dimensions",
        "actions",
        "onFileOpen",
        "onImageWindowOpen",
        "rendered",
        "onClose",
        "closeLabel",
    ]);
    // Which face of a Markdown file is showing is a property of looking at it,
    // not of the file or the product, so it stays here and resets when the
    // preview is replaced by a different file.
    const [face, setFace] = useState<MarkdownFace>("rendered");
    // What the picture turned out to be, keyed by the address it was measured
    // from, so neither a different file nor a new revision of this one ever
    // wears the previous picture's dimensions.
    const [measured, setMeasured] = useState<{ source: string; dimensions: string }>();
    const kind = local.kind ?? filePreviewKind(local.path);
    const name = local.path.slice(local.path.lastIndexOf("/") + 1);
    const directory = local.path.slice(0, local.path.lastIndexOf("/") + 1);
    const source = local.content.type === "url" ? local.content.url : local.path;
    const dimensions =
        local.dimensions ?? (measured?.source === source ? measured.dimensions : undefined);
    const meta = [dimensions, local.size].filter(Boolean).join(" · ");
    return (
        <section
            className={["happy2-file-preview", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="file-preview"
            data-kind={kind}
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <header className="happy2-file-preview__header" data-happy2-ui="file-preview-header">
                <span className="happy2-file-preview__glyph" data-happy2-ui="file-preview-glyph">
                    <Icon name={KIND_ICON[kind]} size={16} />
                </span>
                <span className="happy2-file-preview__heading">
                    <span className="happy2-file-preview__name" data-happy2-ui="file-preview-name">
                        {name}
                    </span>
                    {directory || meta ? (
                        <span
                            className="happy2-file-preview__subtitle"
                            data-happy2-ui="file-preview-subtitle"
                        >
                            {[directory, meta].filter(Boolean).join(" · ")}
                        </span>
                    ) : null}
                </span>
                <span className="happy2-file-preview__actions">
                    {(kind === "markdown" || local.rendered !== undefined) &&
                    local.content.type === "text" ? (
                        <SegmentedControl
                            data-testid="file-preview-face"
                            onChange={(value) => setFace(value as MarkdownFace)}
                            segments={[...MARKDOWN_FACES]}
                            size="small"
                            value={face}
                        />
                    ) : null}
                    {local.actions}
                    {local.onClose ? (
                        <Button
                            aria-label={local.closeLabel ?? "Close preview"}
                            icon="close"
                            iconOnly
                            onClick={() => local.onClose?.()}
                            size="small"
                            variant="ghost"
                        />
                    ) : null}
                </span>
            </header>
            <div className="happy2-file-preview__body" data-happy2-ui="file-preview-body">
                <FilePreviewBody
                    content={local.content}
                    face={face}
                    kind={kind}
                    name={name}
                    onFileOpen={local.onFileOpen}
                    onImageMeasure={(size) =>
                        setMeasured({
                            source,
                            dimensions: `${String(size.width)} × ${String(size.height)}`,
                        })
                    }
                    onImageWindowOpen={local.onImageWindowOpen}
                    rendered={local.rendered}
                />
            </div>
        </section>
    );
}
/**
 * The rendered file itself. Every branch that cannot show the content says why
 * in the same centered notice, so a failed image and an unviewable archive read
 * as the same kind of answer instead of two different broken states.
 */
function FilePreviewBody(props: {
    content: FilePreviewContent;
    face: MarkdownFace;
    kind: FilePreviewKind;
    name: string;
    onFileOpen?: (path: string) => void;
    onImageMeasure: (size: { readonly width: number; readonly height: number }) => void;
    onImageWindowOpen?: () => void;
    rendered?: ReactNode;
}) {
    // A picture is handed to the shared viewer in every state, including the
    // ones that have no picture: its loading, failed, and unviewable notices are
    // the ones a reader already knows from every other place an image opens.
    if (props.kind === "image" && props.content.type !== "text")
        return (
            <ImageViewer
                actions={
                    props.onImageWindowOpen ? (
                        <>
                            <Button
                                aria-label="Open in a new window"
                                iconOnly
                                onClick={props.onImageWindowOpen}
                                size="small"
                                variant="ghost"
                            >
                                <Ionicon name="open-outline" size={14} />
                            </Button>
                            <span className="happy2-image-viewer__divider" />
                        </>
                    ) : undefined
                }
                content={props.content}
                name={props.name}
                onNaturalSize={props.onImageMeasure}
            />
        );
    if (props.content.type === "loading")
        return (
            <div className="happy2-file-preview__notice" data-happy2-ui="file-preview-loading">
                <Spinner size={16} />
                <span className="happy2-file-preview__notice-title">Opening {props.name}…</span>
            </div>
        );
    if (props.content.type === "error")
        return (
            <div
                className="happy2-file-preview__notice"
                data-happy2-ui="file-preview-error"
                data-tone="danger"
            >
                <Icon name="close" size={20} />
                <span className="happy2-file-preview__notice-title">
                    {props.name} could not be opened
                </span>
                <span className="happy2-file-preview__notice-detail">{props.content.message}</span>
            </div>
        );
    if (props.content.type === "url" && URL_KINDS.has(props.kind)) {
        const url = props.content.url;
        if (props.kind === "video")
            return (
                <div className="happy2-file-preview__stage" data-happy2-ui="file-preview-stage">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a workspace file has no caption track to offer */}
                    <video
                        className="happy2-file-preview__video"
                        controls
                        data-happy2-ui="file-preview-video"
                        src={url}
                    />
                </div>
            );
        if (props.kind === "audio")
            return (
                <div className="happy2-file-preview__stage" data-happy2-ui="file-preview-stage">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a workspace file has no caption track to offer */}
                    <audio
                        className="happy2-file-preview__audio"
                        controls
                        data-happy2-ui="file-preview-audio"
                        src={url}
                    />
                </div>
            );
        return (
            <iframe
                className="happy2-file-preview__document"
                data-happy2-ui="file-preview-document"
                src={url}
                title={props.name}
            />
        );
    }
    // A page the host renders wins over every text view of the same bytes: it is
    // what the reader asked for by opening the file at all.
    if (props.rendered !== undefined && props.face === "rendered") return props.rendered;
    if (props.content.type === "text" && props.kind === "markdown" && props.face === "rendered")
        return (
            <MarkdownDocument
                {...(props.onFileOpen ? { onFileOpen: props.onFileOpen } : {})}
                text={props.content.text}
            />
        );
    // Source is highlighted by the same engine as the working-tree diff, and
    // numbered, because a file read whole is a file whose lines get referred to.
    // The header above already names it, so the renderer's own header is off.
    if (props.content.type === "text")
        return (
            <div className="happy2-file-preview__source" data-happy2-ui="file-preview-code">
                <CodeBlock
                    className="happy2-file-preview__source-renderer"
                    lineNumbers
                    name={props.name}
                    text={props.content.text}
                />
            </div>
        );
    return (
        <div className="happy2-file-preview__notice" data-happy2-ui="file-preview-unavailable">
            <Icon name={KIND_ICON[props.kind]} size={20} />
            <span className="happy2-file-preview__notice-title">{props.name} has no preview</span>
            <span className="happy2-file-preview__notice-detail">
                This file is not a format Happy can show.
            </span>
        </div>
    );
}
