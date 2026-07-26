import { MultiFileDiff } from "@pierre/diffs/react";
import type { CSSProperties } from "react";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";

/**
 * How a changed file is being looked at.
 *
 * - `preview` — the file as it now stands, with no change marks. What the
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
    path: string;
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
    /** True when there are unsaved edits, which is what puts Save on the bar. */
    dirty?: boolean;
    /** Writes the pending edit back. */
    onSave?: () => void;
};

/**
 * A complete working-tree diff surface. Pierre Diffs owns parsing, syntax
 * highlighting, hunk expansion, and line layout; Happy owns the product
 * boundary, the view modes, and the colors.
 *
 * The colors are the theme's own. Pierre derives every diff surface by mixing
 * one accent per side into the page background, so pointing those two accents
 * and that background at Happy's `--diff-*` tokens is all it takes for the
 * full-file view and the inline `DiffSnippet` to agree — rather than the
 * full-file view carrying a second palette that merely resembles the first.
 */
export function ChangedFileDiff(props: ChangedFileDiffProps) {
    const mode = props.mode ?? "unified";
    const editable = props.onContentChange !== undefined;
    const segments = CHANGED_FILE_DIFF_MODES.filter(
        (candidate) => candidate !== "edit" || editable,
    ).map((candidate) => ({ value: candidate, label: MODE_LABELS[candidate] }));
    return (
        <section
            aria-label={`Changes in ${props.path}`}
            className={["happy2-changed-file-diff", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="changed-file-diff"
            data-mode={mode}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-changed-file-diff__bar" data-happy2-ui="changed-file-diff-bar">
                <SegmentedControl
                    onChange={(value) => props.onModeChange?.(value as ChangedFileDiffMode)}
                    segments={segments}
                    size="small"
                    value={mode}
                />
                <span className="happy2-changed-file-diff__bar-end">
                    {props.loading || props.saving ? (
                        <span
                            aria-live="polite"
                            className="happy2-changed-file-diff__updating"
                            data-happy2-ui="changed-file-diff-updating"
                        >
                            {props.saving ? "Saving…" : "Updating…"}
                        </span>
                    ) : null}
                    {/* Only offered when there is something to save. An always-on
                        Save over an unchanged file invites the question of
                        whether it did anything. */}
                    {props.dirty && props.onSave ? (
                        <Button
                            disabled={props.saving === true}
                            onClick={props.onSave}
                            size="small"
                            variant="primary"
                        >
                            Save
                        </Button>
                    ) : null}
                </span>
            </div>

            <div className="happy2-changed-file-diff__body" data-happy2-ui="changed-file-diff-body">
                {mode === "edit" ? (
                    <textarea
                        aria-label={`Edit ${props.path}`}
                        className="happy2-changed-file-diff__editor"
                        data-happy2-ui="changed-file-diff-editor"
                        onChange={(event) => props.onContentChange?.(event.target.value)}
                        onKeyDown={(event) => {
                            // The shortcut every editor has. Without it the only
                            // way to save is to stop typing and reach for a
                            // button, which is not how anyone edits a file.
                            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                                event.preventDefault();
                                props.onSave?.();
                            }
                        }}
                        readOnly={props.saving === true}
                        spellCheck={false}
                        value={props.newContent}
                    />
                ) : (
                    <MultiFileDiff
                        className="happy2-changed-file-diff__renderer"
                        newFile={{
                            name: props.path,
                            contents: props.newContent,
                        }}
                        oldFile={{
                            name: props.oldPath ?? props.path,
                            // Preview is this same renderer with nothing to
                            // compare against, so every line reads as context.
                            // Syntax highlighting, gutters, and scrolling then
                            // stay identical to the diff it sits beside.
                            contents: mode === "preview" ? props.newContent : props.oldContent,
                        }}
                        options={{
                            diffIndicators: "bars",
                            diffStyle: mode === "split" ? "split" : "unified",
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
                )}
            </div>
        </section>
    );
}
