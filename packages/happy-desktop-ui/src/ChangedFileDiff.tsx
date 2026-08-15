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

type DiffSelectionSide = "additions" | "deletions" | "unified";

interface DiffSelectionPosition {
    readonly lineIndex: string;
    readonly offset: number;
    readonly side: DiffSelectionSide;
}

interface DiffSelectionBookmark {
    readonly anchor: DiffSelectionPosition;
    readonly focus: DiffSelectionPosition;
}

interface DiffSelectionPoint {
    readonly node: Node;
    readonly offset: number;
}

/**
 * Pierre replaces the code text nodes when its worker finishes highlighting.
 * That is the right rendering strategy for a diff, but Chromium drops a native
 * text selection when the selected nodes are replaced. Keep a selection in the
 * diff's line/side coordinate system and put it back after Pierre's render.
 *
 * This is deliberately not React state: a selection is browser interaction
 * state, and storing it in the component snapshot would add a render for every
 * drag update. The bridge is also stable for the lifetime of one diff so the
 * `onPostRender` option does not make Pierre reconfigure on every workspace
 * notification.
 */
function createDiffSelectionBridge(): {
    readonly onPostRender: (
        node: HTMLElement,
        instance: unknown,
        phase: "mount" | "update" | "unmount",
    ) => void;
} {
    let host: HTMLElement | undefined;
    let bookmark: DiffSelectionBookmark | undefined;
    let pointerSelecting = false;
    let restoreFrame: number | undefined;
    let selectionRoot: ShadowRoot | undefined;

    const nodeInsideHost = (node: Node, candidate: HTMLElement): boolean => {
        const shadowRoot = candidate.shadowRoot;
        return shadowRoot !== null && shadowRoot.contains(node);
    };

    const positionRead = (
        node: Node,
        offset: number,
        candidate: HTMLElement,
    ): DiffSelectionPosition | undefined => {
        const element =
            node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        const line = element?.closest<HTMLElement>("[data-line][data-line-index]");
        if (
            line === null ||
            line === undefined ||
            !nodeInsideHost(line, candidate) ||
            (node !== line && !line.contains(node))
        )
            return undefined;
        const code = line.closest<HTMLElement>("[data-code]");
        if (code === null || !nodeInsideHost(code, candidate)) return undefined;
        const side: DiffSelectionSide | undefined = code.hasAttribute("data-unified")
            ? "unified"
            : code.hasAttribute("data-additions")
              ? "additions"
              : code.hasAttribute("data-deletions")
                ? "deletions"
                : undefined;
        const lineIndex = line.dataset.lineIndex;
        if (side === undefined || lineIndex === undefined || !/^\d+(?:,\d+)?$/u.test(lineIndex))
            return undefined;
        try {
            const range = document.createRange();
            range.selectNodeContents(line);
            const maxOffset =
                node.nodeType === Node.TEXT_NODE
                    ? (node.textContent?.length ?? 0)
                    : node.childNodes.length;
            range.setEnd(node, Math.max(0, Math.min(offset, maxOffset)));
            return {
                lineIndex,
                offset: range.toString().length,
                side,
            };
        } catch {
            return undefined;
        }
    };

    const selectionRead = (candidate: HTMLElement): DiffSelectionBookmark | undefined => {
        const selection = window.getSelection();
        if (
            selection === null ||
            selection.isCollapsed ||
            selection.anchorNode === null ||
            selection.focusNode === null ||
            !nodeInsideHost(selection.anchorNode, candidate) ||
            !nodeInsideHost(selection.focusNode, candidate)
        )
            return undefined;
        const anchor = positionRead(selection.anchorNode, selection.anchorOffset, candidate);
        const focus = positionRead(selection.focusNode, selection.focusOffset, candidate);
        return anchor === undefined || focus === undefined ? undefined : { anchor, focus };
    };

    const textPointAt = (line: HTMLElement, requestedOffset: number): DiffSelectionPoint => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, requestedOffset);
        let last: Text | undefined;
        while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            last = text;
            const length = text.data.length;
            if (remaining <= length) return { node: text, offset: remaining };
            remaining -= length;
        }
        return last === undefined
            ? { node: line, offset: line.childNodes.length }
            : { node: last, offset: last.data.length };
    };

    const positionRestore = (
        candidate: HTMLElement,
        position: DiffSelectionPosition,
    ): DiffSelectionPoint | undefined => {
        const code = candidate.shadowRoot?.querySelector<HTMLElement>(
            `[data-code][data-${position.side}]`,
        );
        const line = code?.querySelector<HTMLElement>(
            `[data-line][data-line-index="${position.lineIndex}"]`,
        );
        return line === null || line === undefined ? undefined : textPointAt(line, position.offset);
    };

    const selectionRestore = (candidate: HTMLElement): void => {
        if (bookmark === undefined) return;
        const anchor = positionRestore(candidate, bookmark.anchor);
        const focus = positionRestore(candidate, bookmark.focus);
        if (anchor === undefined || focus === undefined) return;
        const selection = window.getSelection();
        if (selection === null) return;
        try {
            selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        } catch {
            try {
                const range = document.createRange();
                range.setStart(anchor.node, anchor.offset);
                range.setEnd(focus.node, focus.offset);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch {
                // The line may have been virtualized away between renders. Keep
                // the bookmark so a later render can restore it if it returns.
            }
        }
    };

    const selectionRestoreAfterBrowserSettlement = (candidate: HTMLElement): void => {
        if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
        restoreFrame = requestAnimationFrame(() => {
            restoreFrame = undefined;
            if (host === candidate && !pointerSelecting) selectionRestore(candidate);
        });
    };

    const selectionChanged = (): void => {
        if (host === undefined) return;
        const next = selectionRead(host);
        if (next !== undefined) bookmark = next;
        else {
            const selection = window.getSelection();
            const connectedSelection =
                selection?.anchorNode?.isConnected === true &&
                selection.focusNode?.isConnected === true;
            // Replacing the selected text nodes can briefly collapse Chromium's
            // selection or leave a non-collapsed range whose endpoints are
            // already detached. Keep the logical bookmark through both
            // renderer-driven transitions. A real pointer interaction clears
            // it at pointerdown, and a connected selection made elsewhere
            // clears it here.
            if (pointerSelecting || (selection?.isCollapsed === false && connectedSelection))
                bookmark = undefined;
        }
    };

    const pointerDown = (event: PointerEvent): void => {
        if (host === undefined) return;
        pointerSelecting = event.composedPath().includes(host);
        bookmark = undefined;
    };

    const pointerUp = (): void => {
        if (!pointerSelecting) return;
        pointerSelecting = false;
        selectionChanged();
    };

    const onPostRender = (
        node: HTMLElement,
        _instance: unknown,
        phase: "mount" | "update" | "unmount",
    ): void => {
        if (phase === "unmount") {
            if (host === node) {
                document.removeEventListener("selectionchange", selectionChanged);
                document.removeEventListener("pointerdown", pointerDown, true);
                document.removeEventListener("pointerup", pointerUp, true);
                selectionRoot?.removeEventListener("selectionchange", selectionChanged);
                if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
                host = undefined;
                pointerSelecting = false;
                restoreFrame = undefined;
                selectionRoot = undefined;
            }
            return;
        }
        if (host !== node) {
            if (host !== undefined) {
                document.removeEventListener("selectionchange", selectionChanged);
                document.removeEventListener("pointerdown", pointerDown, true);
                document.removeEventListener("pointerup", pointerUp, true);
                selectionRoot?.removeEventListener("selectionchange", selectionChanged);
                if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
                restoreFrame = undefined;
            }
            host = node;
            selectionRoot = node.shadowRoot ?? undefined;
            document.addEventListener("selectionchange", selectionChanged);
            document.addEventListener("pointerdown", pointerDown, true);
            document.addEventListener("pointerup", pointerUp, true);
            selectionRoot?.addEventListener("selectionchange", selectionChanged);
        }
        if (bookmark !== undefined) {
            selectionRestore(node);
            // Chromium queues selectionchange after the DOM replacement. A
            // synchronous restore can therefore be collapsed again after this
            // callback returns. Restore once more on the next paint boundary,
            // unless the user has started a new selection in the meantime.
            selectionRestoreAfterBrowserSettlement(node);
        }
    };

    return { onPostRender };
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
    const selectionBridge = useMemo(() => createDiffSelectionBridge(), []);
    const diffOptions = useMemo(
        () => ({
            diffIndicators: "bars" as const,
            diffStyle: mode === "split" ? ("split" as const) : ("unified" as const),
            hunkSeparators: "line-info-basic" as const,
            lineDiffType: "word-alt" as const,
            onPostRender: selectionBridge.onPostRender,
            overflow: "scroll" as const,
            stickyHeader: true,
            theme: {
                dark: "pierre-dark" as const,
                light: "pierre-light" as const,
            },
            themeType: props.appearance,
            unsafeCSS: PIERRE_PANE_CSS,
        }),
        [mode, props.appearance, selectionBridge],
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
