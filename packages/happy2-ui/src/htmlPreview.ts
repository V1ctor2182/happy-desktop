import type { ReactNode } from "react";

export interface HtmlPreviewProps {
    /**
     * Where the document is served as a page. Its directory is the site root, so
     * the stylesheets, scripts, and images the markup names load from beside it.
     */
    readonly source: string;
    /**
     * The revision of the file behind the page. A change to it reloads the page,
     * which is how a document being edited stays current without anyone asking
     * it to.
     */
    readonly revision?: string;
}

/**
 * Host-supplied renderer for one HTML file shown as a page.
 *
 * Running a page needs an engine, which is the embedder's, so the reusable
 * surfaces take the rendered face as a slot instead of drawing it. Blueprint and
 * any host without one supply nothing, and the file stays readable as source.
 */
export type HtmlPreviewRenderer = (props: HtmlPreviewProps) => ReactNode;
