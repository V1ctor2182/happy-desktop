import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { workspaceFileLoad, type RigProxyClient } from "./rigProxyHandle";

export interface HtmlPreviewServerHandle {
    /**
     * The address of one HTML file, as the page itself will be loaded. Its
     * directory is the site root, so the document's own relative references
     * resolve to sibling files without anything rewriting the markup.
     */
    previewUrl(sessionId: string, filePath: string): string;
    close(): void;
}

export interface HtmlPreviewServerOptions {
    /** The client whose workspace files this server reads. One per Rig. */
    readonly client: RigProxyClient;
}

/**
 * What a page is allowed to load, by lowercase extension, and the media type it
 * is served as.
 *
 * This list is the whole security boundary of the preview: a document can only
 * ever reach the parts of a checkout that a web page is made of. There is no
 * entry for `.env`, a key, a database, or a source file that is not itself web
 * content, so a page that asks for one is answered exactly as it would be for a
 * file that does not exist.
 */
const PREVIEW_CONTENT_TYPE: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    cjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    map: "application/json; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    webmanifest: "application/manifest+json; charset=utf-8",
    wasm: "application/wasm",
    pdf: "application/pdf",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    heic: "image/heic",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
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
    otf: "font/otf",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
};

/** Cap on the bytes one previewed page may pull for a single asset. */
const PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

/**
 * A local static site around one HTML file in a workspace.
 *
 * A document is not a picture: opening it means opening everything it names —
 * its stylesheet, its script, its fonts, the images beside it — each by the path
 * the markup already uses. That is a server's job, so this is a server: an
 * unguessable loopback origin that answers ordinary GET requests for files under
 * the directory of the document being looked at, and nothing else.
 *
 * It is deliberately its own origin rather than another route on the Rig proxy.
 * A previewed page runs its own scripts, and same-origin scripts on the proxy
 * would inherit the capability that reaches the entire daemon surface.
 *
 * Two rules bound what it can serve. The site root is the document's own
 * directory, so nothing above it is addressable at all; and every served file
 * must have an extension a web page is made of, so a checkout's `.env`, keys,
 * and sources are answered as missing rather than read. Files are read through
 * the Rig client, which is what makes a preview of a file on a remote machine
 * work exactly like one on this machine.
 */
export function htmlPreviewServerCreate(
    options: HtmlPreviewServerOptions,
): Promise<HtmlPreviewServerHandle> {
    const capability = randomBytes(32).toString("base64url");
    const capabilityPrefix = `/${capability}`;
    let expectedHost: string | undefined;
    let origin: string | undefined;
    const server = createServer((request, response) => {
        void serve(options.client, capabilityPrefix, expectedHost, origin, request, response).catch(
            () => {
                if (!response.headersSent) response.writeHead(500);
                response.end();
            },
        );
    });
    return new Promise<HtmlPreviewServerHandle>((resolvePromise, reject) => {
        const onError = (error: unknown) => reject(error as Error);
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", onError);
            const address = server.address() as AddressInfo | null;
            if (!address) {
                server.close();
                reject(new Error("The HTML preview server did not bind a loopback port."));
                return;
            }
            expectedHost = `127.0.0.1:${String(address.port)}`;
            origin = `http://${expectedHost}`;
            resolvePromise({
                previewUrl(sessionId, filePath) {
                    const site = previewSite(filePath);
                    return [
                        `${origin!}${capabilityPrefix}`,
                        encodeURIComponent(sessionId),
                        encodeURIComponent(site.directory),
                        encodeURIComponent(site.name),
                    ].join("/");
                },
                close: () => server.close(),
            });
        });
    });
}

/**
 * Splits a document's path into the site it makes and the page inside it. The
 * directory travels as one encoded segment so the browser resolves `./style.css`
 * against the document rather than against some prefix of the checkout, and a
 * document at the root of a checkout still names a directory rather than an
 * empty one.
 */
function previewSite(filePath: string): { readonly directory: string; readonly name: string } {
    const normalized = filePath.replaceAll("\\", "/").replace(/^\/+/u, "");
    const cut = normalized.lastIndexOf("/");
    return {
        directory: cut < 0 ? "." : normalized.slice(0, cut),
        name: cut < 0 ? normalized : normalized.slice(cut + 1),
    };
}

/** Answers one asset request, or refuses it without saying what exists. */
async function serve(
    client: RigProxyClient,
    capabilityPrefix: string,
    expectedHost: string | undefined,
    origin: string | undefined,
    request: IncomingMessage,
    response: ServerResponse,
): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // The capability is what makes this origin unguessable to anything else on
    // the machine; a page of our own may of course fetch across it, but only
    // within the site prefix its own document was served from.
    if (
        request.headers.host !== expectedHost ||
        (request.headers.origin !== undefined &&
            request.headers.origin !== "null" &&
            request.headers.origin !== origin) ||
        !url.pathname.startsWith(`${capabilityPrefix}/`)
    ) {
        response.writeHead(403);
        response.end();
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        // A static site has nothing to submit to. A form post is answered as
        // refused rather than quietly rendering the page again.
        response.writeHead(405, { allow: "GET, HEAD" });
        response.end();
        return;
    }
    const segments = url.pathname
        .slice(capabilityPrefix.length + 1)
        .split("/")
        .map((segment) => decodeURIComponent(segment));
    const [sessionId, directory, ...rest] = segments;
    if (!sessionId || !directory || rest.length === 0) {
        notFound(response);
        return;
    }
    // A link to a directory is a link to its page, which is what every other
    // static server answers with and what the markup was written against.
    const within = pathWithin(url.pathname.endsWith("/") ? [...rest, "index.html"] : rest);
    if (within === undefined) {
        notFound(response);
        return;
    }
    const contentType = PREVIEW_CONTENT_TYPE[extensionOf(within)];
    if (contentType === undefined) {
        notFound(response);
        return;
    }
    const filePath = directory === "." ? within : `${directory}/${within}`;
    let bytes: Buffer;
    try {
        const file = await workspaceFileLoad(client, sessionId, filePath);
        bytes = Buffer.from(file.content, "base64");
        if (bytes.byteLength > PREVIEW_MAX_BYTES) {
            response.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
            response.end("This file is too large to preview.");
            return;
        }
    } catch {
        // A file the checkout no longer holds and a file this session may not
        // read are the same answer to a page: it is not there.
        notFound(response);
        return;
    }
    writeAsset(request, response, contentType, bytes);
}

/**
 * The requested path relative to the site root, or nothing when it leaves it.
 *
 * The root is the document's own directory, so `..` is not a path this server
 * has an answer for: it is the one way a page could ask for the rest of the
 * machine, and it is refused before anything is read rather than clamped into
 * something that looks like it worked.
 */
function pathWithin(segments: readonly string[]): string | undefined {
    const kept: string[] = [];
    for (const segment of segments) {
        if (segment === "" || segment === ".") continue;
        if (segment === ".." || segment.includes("\\") || segment.includes("\0")) return undefined;
        // A dotfile is never part of a page and is frequently a secret.
        if (segment.startsWith(".")) return undefined;
        kept.push(segment);
    }
    return kept.length > 0 ? kept.join("/") : undefined;
}

function extensionOf(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1) : "";
}

function notFound(response: ServerResponse): void {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
}

/**
 * Writes one asset, answering a range request when the element asking made one.
 * A `video` seeks by asking for the bytes it wants, so a preview that could only
 * reply with the whole file would give the reader a scrubber that does nothing.
 */
function writeAsset(
    request: IncomingMessage,
    response: ServerResponse,
    contentType: string,
    bytes: Buffer,
): void {
    const total = bytes.byteLength;
    const headers: Record<string, string> = {
        "content-type": contentType,
        "accept-ranges": "bytes",
        // The file under a preview is being worked on: what it holds now is the
        // only correct answer, and reloading must never show the previous one.
        "cache-control": "no-store",
        // The media type here is decided by the extension allowlist, so a page
        // must not be allowed to talk Chromium into reading it as another kind.
        "x-content-type-options": "nosniff",
    };
    const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? "");
    if (range && (range[1] !== "" || range[2] !== "")) {
        const suffix = range[1] === "";
        const start = suffix ? Math.max(total - Number(range[2]), 0) : Number(range[1]);
        const end = suffix || range[2] === "" ? total - 1 : Math.min(Number(range[2]), total - 1);
        if (start > end || start >= total) {
            response.writeHead(416, { ...headers, "content-range": `bytes */${String(total)}` });
            response.end();
            return;
        }
        response.writeHead(206, {
            ...headers,
            "content-range": `bytes ${String(start)}-${String(end)}/${String(total)}`,
            "content-length": String(end - start + 1),
        });
        response.end(request.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
        return;
    }
    response.writeHead(200, { ...headers, "content-length": String(total) });
    response.end(request.method === "HEAD" ? undefined : bytes);
}
