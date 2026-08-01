import type { CSSProperties, ReactNode } from "react";
import { partitionComponentProps } from "./componentProps";
import { EmptyState } from "./EmptyState";

export type HtmlPreviewFrameProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /**
     * The host's page surface — an Electron guest in the product, anything inert
     * in Blueprint. Absent means the page has nowhere to load from yet, and the
     * frame says so rather than showing an empty white region that reads as a
     * document with nothing in it.
     */
    children?: ReactNode;
};

/**
 * C-173 HtmlPreviewFrame — the region a rendered HTML file occupies.
 *
 * A previewed page is drawn by the embedder's engine, not by this package, so
 * this component owns only where that page sits: it fills the region it is
 * given, sizes its guest to the whole of it, and paints the white canvas a
 * document assumes underneath, so a page that sets no background of its own
 * does not read as a hole in the app.
 */
export function HtmlPreviewFrame(props: HtmlPreviewFrameProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "children",
    ]);
    return (
        <div
            className={["happy2-html-preview", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="html-preview"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            {local.children ?? (
                <EmptyState
                    description="Happy is resolving where this document is served from."
                    icon="globe"
                    size="panel"
                    title="Preparing the page…"
                />
            )}
        </div>
    );
}
