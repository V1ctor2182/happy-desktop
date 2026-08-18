import { MultiFileDiff } from "@pierre/diffs/react";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { CodeEditor } from "./CodeEditor";
import { CODE_BLOCK_HIGHLIGHT_CACHE_MAX_TEXT_LENGTH } from "./CodeBlock";
import { PIERRE_PANE_CSS } from "./pierreCodeSurface";
import { SegmentedControl } from "./SegmentedControl";

/**
 * How a changed file is being looked at.
 *
 * - `preview` — the file as it now stands, in the product's own file preview:
 *   the document rendered, the picture shown, the source read whole. What the
 *   result reads like, which is the one question a diff cannot answer.
 * - `unified` — additions and deletions interleaved in one column.
 * - `split` — old and new side by side.
 * - `edit` — the working-tree text, editable.
 */
export type ChangedFileDiffMode = "preview" | "unified" | "split" | "edit";

export const CHANGED_FILE_DIFF_MODES: readonly ChangedFileDiffMode[] = [
    "preview",
    "unified",
    "split",
    "edit",
];

const MODE_LABELS: Record<ChangedFileDiffMode, string> = {
    preview: "Preview",
    unified: "Unified",
    split: "Split",
    edit: "Edit",
};

export type ChangedFileDiffProps = {
    appearance: "dark" | "light";
    className?: string;
    "data-testid"?: string;
    loading?: boolean;
    newContent: string;
    oldContent: string;
    oldPath?: string;
    /** Stable identity for the saved/base side of the diff, when known. */
    oldCacheKey?: string;
    path: string;
    /** Stable loaded-document identity used by the edit mode's bounded state cache. */
    documentKey?: string;
    /** Stable identity for the working-tree side of the diff, when clean. */
    newCacheKey?: string;
    style?: CSSProperties;
    /** Which view is showing. Defaults to the unified diff. */
    mode?: ChangedFileDiffMode;
    onModeChange?: (mode: ChangedFileDiffMode) => void;
    /**
     * Receives edits to the working-tree text. Without it there is nobody to
     * hand an edit to, so the mode is not offered at all rather than offered
     * and silently inert.
     */
    onContentChange?: (content: string) => void;
    /** True while an edit is being written back; the field stays up and inert. */
    saving?: boolean;
    /** Keeps the edit draft available while disabling persistence. */
    saveDisabled?: boolean;
    /** Writes the pending edit back. */
    onSave?: () => void;
    /**
     * The file as it now stands, drawn by whatever the product opens a file
     * into. It is the caller's because a preview is a whole viewer — a rendered
     * document, a picture on its stage, a recording that plays — and this
     * component knows only about text and about diffs of text. Without one
     * there is nothing to show, so the mode is not offered at all rather than
     * offered over an empty pane; that is the honest answer for a file the
     * change deleted, which no longer has a copy to look at.
     */
    preview?: ReactNode;
};

/**
 * C-237 ChangedFileDiff — a complete working-tree diff surface. Pierre Diffs
 * owns parsing, syntax highlighting, hunk expansion, and line layout; Happy owns
 * the product boundary, the view modes, and the colors.
 *
 * Preview is not one of Pierre's: the file as it now stands is a whole file, and
 * a whole file is what the product's file preview already shows. It arrives as a
 * slot so a changed Markdown document reads as the document rather than as a
 * diff against itself, which is all this renderer with nothing to compare
 * against could ever produce.
 *
 * The colors are the theme's own. Pierre derives every diff surface by mixing
 * one accent per side into the page background, so pointing those two accents
 * and that background at Happy's `--diff-*` tokens is all it takes for the
 * full-file view and the inline `DiffSnippet` to agree — rather than the
 * full-file view carrying a second palette that merely resembles the first.
 */
export function ChangedFileDiff(props: ChangedFileDiffProps) {
    const editable = props.onContentChange !== undefined;
    const previewable = props.preview !== undefined;
    const segments = CHANGED_FILE_DIFF_MODES.filter((candidate) =>
        candidate === "edit" ? editable : candidate === "preview" ? previewable : true,
    ).map((candidate) => ({ value: candidate, label: MODE_LABELS[candidate] }));
    // Which view is on is remembered across files, so the one that was chosen
    // may not exist for the file that is now open — a deleted file has no copy
    // left to read. It falls back to the diff, which is the only thing such a
    // file still has, rather than leaving the switch pointing at a mode this
    // pane cannot draw.
    const requested = props.mode ?? "unified";
    const mode = segments.some((segment) => segment.value === requested) ? requested : "unified";
    // MultiFileDiff memoizes its parse by oldFile/newFile object identity. Keep
    // these inputs stable across unrelated workspace notifications while this
    // diff remains mounted; switching files remounts it intentionally, and
    // Pierre cache keys cover that lifetime boundary. Contents, names, and
    // cache keys are the measured identity contract.
    const newCacheKey =
        props.newContent.length <= CODE_BLOCK_HIGHLIGHT_CACHE_MAX_TEXT_LENGTH
            ? props.newCacheKey
            : undefined;
    const oldCacheKey =
        props.oldContent.length <= CODE_BLOCK_HIGHLIGHT_CACHE_MAX_TEXT_LENGTH
            ? props.oldCacheKey
            : undefined;
    const newFile = useMemo(
        () => ({
            name: props.path,
            contents: props.newContent,
            ...(newCacheKey === undefined ? {} : { cacheKey: newCacheKey }),
        }),
        [newCacheKey, props.newContent, props.path],
    );
    const oldFile = useMemo(
        () => ({
            name: props.oldPath ?? props.path,
            contents: props.oldContent,
            ...(oldCacheKey === undefined ? {} : { cacheKey: oldCacheKey }),
        }),
        [oldCacheKey, props.oldContent, props.oldPath, props.path],
    );
    const diffOptions = useMemo(
        () => ({
            diffIndicators: "bars" as const,
            diffStyle: mode === "split" ? ("split" as const) : ("unified" as const),
            hunkSeparators: "line-info-basic" as const,
            lineDiffType: "word-alt" as const,
            overflow: "scroll" as const,
            stickyHeader: true,
            theme: {
                dark: "pierre-dark" as const,
                light: "pierre-light" as const,
            },
            themeType: props.appearance,
            unsafeCSS: PIERRE_PANE_CSS,
        }),
        [mode, props.appearance],
    );
    return (
        <section
            aria-label={`Changes in ${props.path}`}
            className={["happy2-changed-file-diff", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="changed-file-diff"
            data-mode={mode}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                className="happy2-changed-file-diff__bar"
                data-happy-desktop-ui="changed-file-diff-bar"
            >
                <SegmentedControl
                    aria-label="How this changed file is shown"
                    onChange={(value) => props.onModeChange?.(value as ChangedFileDiffMode)}
                    segments={segments}
                    size="compact"
                    value={mode}
                />
                <span className="happy2-changed-file-diff__bar-end">
                    {props.loading || props.saving ? (
                        <span
                            aria-live="polite"
                            className="happy2-changed-file-diff__updating"
                            data-happy-desktop-ui="changed-file-diff-updating"
                        >
                            {props.saving ? "Saving…" : "Updating…"}
                        </span>
                    ) : null}
                </span>
            </div>

            <div
                className="happy2-changed-file-diff__body"
                data-happy-desktop-ui="changed-file-diff-body"
            >
                {mode === "preview" ? (
                    props.preview
                ) : mode === "edit" ? (
                    <CodeEditor
                        className="happy2-changed-file-diff__editor"
                        documentKey={props.documentKey}
                        name={props.path}
                        // The shortcut every editor has. Without it the only way
                        // to save is to stop typing and reach for a button,
                        // which is not how anyone edits a file.
                        onSave={() => {
                            if (!props.saveDisabled) props.onSave?.();
                        }}
                        onValueChange={(content) => props.onContentChange?.(content)}
                        readOnly={props.saving === true}
                        value={props.newContent}
                    />
                ) : (
                    <MultiFileDiff
                        className="happy2-changed-file-diff__renderer"
                        newFile={newFile}
                        oldFile={oldFile}
                        options={diffOptions}
                    />
                )}
            </div>
        </section>
    );
}
