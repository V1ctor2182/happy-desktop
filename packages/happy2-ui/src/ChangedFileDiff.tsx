import { MultiFileDiff } from "@pierre/diffs/react";
import type { CSSProperties } from "react";

export type ChangedFileDiffProps = {
    appearance: "dark" | "light";
    className?: string;
    "data-testid"?: string;
    loading?: boolean;
    newContent: string;
    oldContent: string;
    oldPath?: string;
    path: string;
    style?: CSSProperties;
};

/**
 * A complete working-tree diff surface. Pierre Diffs owns parsing, syntax
 * highlighting, hunk expansion, and line layout; Happy owns only the product
 * boundary and maps its active appearance into the renderer.
 */
export function ChangedFileDiff(props: ChangedFileDiffProps) {
    return (
        <section
            aria-label={`Changes in ${props.path}`}
            className={["happy2-changed-file-diff", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="changed-file-diff"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {props.loading ? (
                <span
                    aria-live="polite"
                    className="happy2-changed-file-diff__updating"
                    data-happy2-ui="changed-file-diff-updating"
                >
                    Updating…
                </span>
            ) : null}
            <MultiFileDiff
                className="happy2-changed-file-diff__renderer"
                newFile={{
                    name: props.path,
                    contents: props.newContent,
                }}
                oldFile={{
                    name: props.oldPath ?? props.path,
                    contents: props.oldContent,
                }}
                options={{
                    diffIndicators: "bars",
                    diffStyle: "unified",
                    hunkSeparators: "line-info-basic",
                    lineDiffType: "word-alt",
                    overflow: "scroll",
                    stickyHeader: true,
                    theme: {
                        dark: "pierre-dark",
                        light: "pierre-light",
                    },
                    themeType: props.appearance,
                }}
            />
        </section>
    );
}
