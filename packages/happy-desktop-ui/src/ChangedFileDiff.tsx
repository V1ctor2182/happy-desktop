import {
    DEFAULT_TOKENIZE_MAX_LENGTH,
    areDiffRenderOptionsEqual,
    getFiletypeFromFileName,
    parseDiffFromFile,
    type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff, useWorkerPool } from "@pierre/diffs/react";
import { useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
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

const DIFF_HIGHLIGHT_WAIT_MS = 2_000;

type DiffHighlightGateSnapshot = "ready" | "waiting" | "fallback";

type DiffHighlightGate = {
    readonly getServerSnapshot: () => DiffHighlightGateSnapshot;
    readonly getSnapshot: () => DiffHighlightGateSnapshot;
    readonly subscribe: (listener: () => void) => () => void;
};

function diffIsPlainText(diff: FileDiffMetadata): boolean {
    const currentLanguage = diff.lang ?? getFiletypeFromFileName(diff.name);
    const previousLanguage =
        diff.lang ??
        (diff.prevName === undefined ? "text" : getFiletypeFromFileName(diff.prevName));
    return currentLanguage === "text" && previousLanguage === "text";
}

function diffIsMassive(diff: FileDiffMetadata): boolean {
    return (
        Math.max(diff.additionLines.length, diff.deletionLines.length) > DEFAULT_TOKENIZE_MAX_LENGTH
    );
}

/**
 * Prime Pierre's keyed diff cache before mounting its DOM renderer. A cold
 * renderer otherwise creates a plain AST immediately and replaces every code
 * node when the worker finishes. That intermediate tree is both disposable
 * work and the source of visible selection churn. Warm keys render at once;
 * cold keys get a bounded wait and then explicitly fall back to Pierre's
 * normal plain-first behavior if the worker is slow or unavailable.
 */
function createDiffHighlightGate(
    pool: ReturnType<typeof useWorkerPool>,
    diff: FileDiffMetadata | undefined,
    rendererMounted: boolean,
): DiffHighlightGate {
    const cacheReady = (): boolean =>
        pool !== undefined &&
        diff !== undefined &&
        diff.cacheKey !== undefined &&
        !diffIsPlainText(diff) &&
        (() => {
            const cached = pool.getDiffResultCache(diff);
            return (
                cached !== undefined &&
                areDiffRenderOptionsEqual(cached.options, pool.getDiffRenderOptions())
            );
        })();
    let snapshot: DiffHighlightGateSnapshot = "ready";
    if (
        pool !== undefined &&
        diff !== undefined &&
        diff.cacheKey !== undefined &&
        !diffIsPlainText(diff) &&
        !diffIsMassive(diff) &&
        !rendererMounted &&
        pool.getStats().workersFailed === false &&
        !cacheReady()
    )
        snapshot = "waiting";
    const listeners = new Set<() => void>();
    let started = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (next: Exclude<DiffHighlightGateSnapshot, "waiting">) => {
        if (snapshot !== "waiting") return;
        if (timeout !== undefined) clearTimeout(timeout);
        timeout = undefined;
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const start = () => {
        if (started || snapshot !== "waiting" || pool === undefined || diff === undefined) return;
        started = true;
        timeout = setTimeout(() => finish("fallback"), DIFF_HIGHLIGHT_WAIT_MS);
        void pool
            .initialize()
            .then(() => Promise.resolve(pool.primeDiffHighlightCache(diff)))
            .then(
                () => finish(cacheReady() ? "ready" : "fallback"),
                () => finish("fallback"),
            );
    };

    return {
        getServerSnapshot: () => "ready",
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0 && snapshot === "waiting") {
                    started = false;
                    if (timeout !== undefined) clearTimeout(timeout);
                    timeout = undefined;
                }
            };
        },
    };
}

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
    const [rendererMounted, setRendererMounted] = useState(false);
    // Parsing the patch is synchronous. Keep its inputs stable across unrelated
    // workspace notifications while this diff remains mounted; switching files
    // remounts it intentionally, and Pierre cache keys cover that lifetime
    // boundary. Contents, names, and cache keys are the identity contract.
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
    const diff = useMemo(() => {
        if (mode !== "unified" && mode !== "split") return undefined;
        const value = parseDiffFromFile(oldFile, newFile);
        // Keep unkeyed documents out of Happy's reusable warm-cache gate. Pierre
        // may assign an internal fallback key once it renders them, so this path
        // deliberately remains plain-first rather than pretending it is a
        // content-addressed saved document.
        if (oldCacheKey === undefined || newCacheKey === undefined) value.cacheKey = undefined;
        return value;
    }, [mode, newCacheKey, newFile, oldCacheKey, oldFile]);
    const pool = useWorkerPool();
    // The first mount may wait for a keyed highlighted result. Once Pierre owns
    // the DOM, later content/theme/mode updates must stay in that same instance
    // so scroll, expanded hunks, and native selection do not reset.
    const diffPostRender = useMemo(
        () => (_node: HTMLElement, _instance: unknown, phase: "mount" | "update" | "unmount") => {
            setRendererMounted(phase !== "unmount");
        },
        [],
    );
    const highlightGate = useMemo(
        () => createDiffHighlightGate(pool, diff, rendererMounted),
        [diff, pool, rendererMounted],
    );
    const highlightState = useSyncExternalStore(
        highlightGate.subscribe,
        highlightGate.getSnapshot,
        highlightGate.getServerSnapshot,
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
            onPostRender: diffPostRender,
        }),
        [diffPostRender, mode, props.appearance],
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
                    <>
                        {highlightState === "waiting" ? (
                            <div
                                aria-live="polite"
                                className="happy2-changed-file-diff__highlighting"
                                data-happy-desktop-ui="changed-file-diff-highlighting"
                            >
                                Highlighting…
                            </div>
                        ) : diff === undefined ? null : (
                            <FileDiff
                                className="happy2-changed-file-diff__renderer"
                                fileDiff={diff}
                                options={diffOptions}
                            />
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
