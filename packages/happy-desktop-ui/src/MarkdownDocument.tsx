import { partitionComponentProps } from "./componentProps";
import {
    createContext,
    createElement,
    useContext,
    type ComponentPropsWithoutRef,
    type CSSProperties,
    type ReactNode,
} from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock, codeBlockLanguage } from "./CodeBlock";

export type MarkdownDocumentProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** The document's Markdown source. */
    text: string;
    /** Stable identity for the saved Markdown bytes, when the caller has one. */
    cacheKey?: string;
    /**
     * Opens a link that points at another file rather than at the web — a
     * relative path, a `file:` URL, or a bare workspace path. Without it those
     * links render inert, because a document viewer that cannot open its
     * neighbours should say so by not offering the click.
     */
    onFileOpen?: (path: string) => void;
};

/** Schemes a document link may navigate the browser to. */
const NAVIGABLE_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * The web address a link carries, or `undefined` when it is not one. Anything
 * that is not an absolute `http:`, `https:`, or `mailto:` target is refused here
 * so a document cannot navigate the app through `javascript:`, `data:`, or a
 * protocol-relative host.
 */
function webHref(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.startsWith("//")) return undefined;
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed);
    if (!scheme) return undefined;
    return NAVIGABLE_SCHEMES.has(scheme[1]!.toLowerCase()) ? trimmed : undefined;
}

/**
 * A `path:line` or `path:line:column` target, reduced to the file it names.
 *
 * Naming a line is how everything that writes about code refers to it, and a
 * reader who clicks one is asking for that file. Carrying the position through
 * as part of the name left the whole reference pointing at nothing openable, so
 * the position is dropped here — the file is what a viewer can show.
 */
function withoutPosition(path: string): string {
    return path.replace(/:\d+(?::\d+)?$/u, "");
}

/**
 * The file this link points at, for a link that is not a web address: a
 * relative path, an absolute path, or a `file:` URL. A bare `#fragment` is
 * in-document navigation and names no file, and a path ending in `/` names a
 * directory rather than something to open.
 */
export function markdownDocumentLinkPath(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//"))
        return undefined;
    if (webHref(trimmed) !== undefined) return undefined;
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed);
    if (scheme && scheme[1]!.toLowerCase() === "file") {
        try {
            const file = withoutPosition(decodeURIComponent(new URL(trimmed).pathname));
            return file.length > 0 && !file.endsWith("/") ? file : undefined;
        } catch {
            return undefined;
        }
    }
    // A link's own fragment and query are addressing within the target
    // document; the file itself is what a viewer can open.
    const path = withoutPosition(trimmed.split(/[#?]/u)[0] ?? "");
    // A colon before a line number is not a scheme separator, so the position
    // comes off before anything decides this is a protocol: `Message.tsx:42`
    // read as a scheme was a file reference the reader could not open. What is
    // still prefixed by a scheme after that really is one, and no viewer here
    // opens it.
    if (/^[a-z][a-z0-9+.-]*:/iu.test(path)) return undefined;
    return path.length > 0 && !path.endsWith("/") ? path : undefined;
}

const FileOpenContext = createContext<((path: string) => void) | undefined>(undefined);
const MarkdownCacheKeyContext = createContext<string | undefined>(undefined);

/**
 * A link in a document. A web address opens in a fresh browsing context severed
 * from the app; a link to another file opens in the viewer itself, which is the
 * whole reason a document reads better here than in a browser.
 */
const DocumentLink = ({ children, href }: ComponentPropsWithoutRef<"a"> & ExtraProps) => {
    const onFileOpen = useContext(FileOpenContext);
    const web = webHref(href);
    if (web !== undefined)
        return (
            <a
                className="happy2-markdown-document__link"
                data-happy-desktop-ui="markdown-document-link"
                href={web}
                rel="noopener noreferrer nofollow"
                target="_blank"
            >
                {children}
            </a>
        );
    const path = markdownDocumentLinkPath(href);
    if (path === undefined || onFileOpen === undefined)
        return (
            <span
                className="happy2-markdown-document__link"
                data-happy-desktop-ui="markdown-document-link"
            >
                {children}
            </span>
        );
    return (
        <button
            className="happy2-markdown-document__link happy2-markdown-document__link--file"
            data-happy-desktop-ui="markdown-document-file-link"
            data-path={path}
            onClick={() => onFileOpen(path)}
            type="button"
        >
            {children}
        </button>
    );
};

/**
 * A document image renders as a labelled link rather than an `<img>`: the bytes
 * of a relative image live in a workspace this viewer has no reader for, and a
 * remote one would make merely opening a document fetch from its author's host.
 */
const DocumentImage = ({ alt, src }: ComponentPropsWithoutRef<"img"> & ExtraProps) => {
    const label = alt?.trim() || (typeof src === "string" ? src : "") || "image";
    return (
        <span
            className="happy2-markdown-document__image"
            data-happy-desktop-ui="markdown-document-image"
        >
            {label}
        </span>
    );
};

/**
 * The code inside a fence, with the language its author labelled it with.
 *
 * Returns nothing for anything that is not a fenced block — a `<pre>` reached
 * some other way still has a document to appear in, and falling back to plain
 * text is the honest answer for content whose shape was not what was expected.
 */
function documentFence(
    node: ExtraProps["node"],
): { lang?: string; text: string; offset?: number } | undefined {
    const code = node?.children.find(
        (child) => child.type === "element" && child.tagName === "code",
    );
    if (code === undefined || code.type !== "element") return undefined;
    const text = code.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        // Markdown always terminates a fence's last line; the renderer draws
        // that as an extra empty row nobody wrote.
        .replace(/\n$/, "");
    if (text.length === 0) return undefined;
    const names = code.properties["className"];
    const label = (Array.isArray(names) ? names.map(String) : [])
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length);
    const offset = node?.position?.start.offset;
    return {
        lang: codeBlockLanguage(label),
        text,
        ...(offset === undefined ? {} : { offset }),
    };
}

/**
 * Fenced code is highlighted with the product's one code renderer, so a `ts`
 * block in a document reads exactly like the same lines opened as a file. The
 * wrapper keeps the block's spacing in the document flow.
 */
const DocumentPre = ({
    children,
    node,
    ...props
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) => {
    const fence = documentFence(node);
    const documentCacheKey = useContext(MarkdownCacheKeyContext);
    const cacheKey =
        fence?.offset === undefined || documentCacheKey === undefined
            ? undefined
            : `${documentCacheKey}:f${String(fence.offset)}`;
    return (
        <div
            className="happy2-markdown-document__code"
            data-happy-desktop-ui="markdown-document-code"
        >
            {fence ? (
                <CodeBlock
                    {...(cacheKey === undefined ? {} : { cacheKey })}
                    lang={fence.lang}
                    text={fence.text}
                />
            ) : (
                <pre {...props}>{children}</pre>
            )}
        </div>
    );
};

/**
 * Headings render with no generated `id`. A viewer shows one document at a
 * time but several viewers can share a page, and generated anchors would
 * collide between them; the type ramp is by tag, so plain elements are enough.
 */
const headingOverride = (
    tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
): NonNullable<Components[typeof tag]> => {
    const DocumentHeading = ({ children }: { children?: ReactNode }) =>
        createElement(tag, undefined, children);
    return DocumentHeading as NonNullable<Components[typeof tag]>;
};

const documentComponents: Components = {
    a: DocumentLink,
    img: DocumentImage,
    pre: DocumentPre,
    h1: headingOverride("h1"),
    h2: headingOverride("h2"),
    h3: headingOverride("h3"),
    h4: headingOverride("h4"),
    h5: headingOverride("h5"),
    h6: headingOverride("h6"),
};

/**
 * C-171 MarkdownDocument — a Markdown file read as a document.
 *
 * This is the reading end of the file viewer: a full-bleed scrollport with the
 * document set on a reading measure inside it, in the document type ramp rather
 * than the tighter chat one. GitHub-flavoured tables, task lists, and fenced
 * code are supported; raw HTML is never activated, since no raw-HTML plugin is
 * present and the document's author is not necessarily the reader.
 *
 * Props only: the caller has already read the file and decides what a link to
 * another file does.
 */
export function MarkdownDocument(props: MarkdownDocumentProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "text",
        "cacheKey",
        "onFileOpen",
    ]);
    return (
        <div
            className={["happy2-markdown-document", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="markdown-document"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <article
                className="happy2-markdown-document__body"
                data-happy-desktop-ui="markdown-document-body"
            >
                <MarkdownCacheKeyContext.Provider value={local.cacheKey}>
                    <FileOpenContext.Provider value={local.onFileOpen}>
                        <Markdown components={documentComponents} remarkPlugins={[remarkGfm]}>
                            {local.text}
                        </Markdown>
                    </FileOpenContext.Provider>
                </MarkdownCacheKeyContext.Provider>
            </article>
        </div>
    );
}
