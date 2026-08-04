import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { FileTree, type FileTreeNode, type FileTreeProps } from "./FileTree";
import { Icon } from "./Icon";
/** Which files the listing is about: only what changed, or the whole checkout. */
export type FileBrowserScope = "changed" | "all";
/** Whether the listing nests into directories or reads as one flat run of files. */
export type FileBrowserLayout = "flat" | "tree";
export type FileBrowserProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    scope: FileBrowserScope;
    onScopeChange?: (scope: FileBrowserScope) => void;
    layout: FileBrowserLayout;
    onLayoutChange?: (layout: FileBrowserLayout) => void;
    /** Rows to list. Passed straight through to FileTree. */
    nodes: readonly FileTreeNode[];
    selectedId?: FileTreeProps["selectedId"];
    /**
     * Files picked as a set. Passing it is what makes the listing a place where
     * several files can be acted on at once; the control row states how many are
     * picked and offers `onRevert` in place of the listing's totals.
     */
    selectedIds?: FileTreeProps["selectedIds"];
    /**
     * Discards the picked files' changes. Omitted, the count is still stated but
     * nothing is offered to do with it — a caller with no way to change a
     * checkout should not show a control that promises to.
     */
    onRevert?: () => void;
    onSelect?: FileTreeProps["onSelect"];
    onOpen?: FileTreeProps["onOpen"];
    onToggle?: FileTreeProps["onToggle"];
    onLoadMore?: FileTreeProps["onLoadMore"];
    loading?: boolean;
    loadingLabel?: string;
    emptyLabel?: string;
    /** Rows the listing holds, stated beside the controls rather than over them. */
    count: number;
    /** Total lines the listed files gained and lost, when the scope has a diff. */
    addedLines?: number;
    deletedLines?: number;
    /** Optional truthfulness note under the controls (e.g. a truncated listing). */
    note?: string;
};
const SCOPES: { id: FileBrowserScope; label: string }[] = [
    { id: "changed", label: "Changed" },
    { id: "all", label: "All files" },
];
/**
 * C-168 FileBrowser — the file listing of a workspace panel.
 *
 * One 32px control row and a scrolling `FileTree` beneath it, and nothing else.
 * The row carries both of the listing's questions — which files, and whether
 * they nest — plus what the listing currently holds, because a separate 56px
 * header repeating "Changes · 24 files" spent a whole band of a narrow panel
 * restating its own controls.
 *
 * Every control in the row is flat: text and glyphs that change contrast, with
 * no track, pill, or border, and no rule between the row and the files. A panel
 * this narrow is read as one column, and each hairline drawn across it cuts that
 * column into pieces that have to be reassembled by eye.
 *
 * Props only — the caller supplies the nodes and every handler; the browser
 * never fetches.
 */
export function FileBrowser(props: FileBrowserProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "scope",
        "onScopeChange",
        "layout",
        "onLayoutChange",
        "nodes",
        "selectedId",
        "selectedIds",
        "onRevert",
        "onSelect",
        "onOpen",
        "onToggle",
        "onLoadMore",
        "loading",
        "loadingLabel",
        "emptyLabel",
        "count",
        "addedLines",
        "deletedLines",
        "note",
    ]);
    const added = local.addedLines !== undefined && local.addedLines > 0;
    const deleted = local.deletedLines !== undefined && local.deletedLines > 0;
    const picked = local.selectedIds?.size ?? 0;
    return (
        <section
            className={["happy2-file-browser", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="file-browser"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <div
                className="happy2-file-browser__controls"
                data-happy-desktop-ui="file-browser-controls"
            >
                <div className="happy2-file-browser__scopes" role="group">
                    {SCOPES.map((scope) => (
                        <button
                            aria-pressed={local.scope === scope.id}
                            className="happy2-file-browser__scope"
                            data-active={local.scope === scope.id ? "" : undefined}
                            data-happy-desktop-ui="file-browser-scope"
                            key={scope.id}
                            onClick={() => local.onScopeChange?.(scope.id)}
                            type="button"
                        >
                            {scope.label}
                        </button>
                    ))}
                </div>
                {/* What is picked replaces what the listing holds, because the
                    two answer the same question and only one of them is what
                    the reader is currently doing. The act on the picked files
                    sits beside their count rather than in a menu: a selection
                    exists to be acted on, and it is gone as soon as it is. */}
                <span
                    className="happy2-file-browser__summary"
                    data-happy-desktop-ui="file-browser-summary"
                >
                    {picked > 0 ? (
                        <span className="happy2-file-browser__picked">
                            {`${String(picked)} selected`}
                        </span>
                    ) : (
                        <span className="happy2-file-browser__count">
                            {`${String(local.count)} ${local.count === 1 ? "file" : "files"}`}
                        </span>
                    )}
                    {picked === 0 && (added || deleted) ? (
                        <span className="happy2-file-browser__lines">
                            {added ? (
                                <span className="happy2-file-browser__added">{`+${String(local.addedLines)}`}</span>
                            ) : null}
                            {deleted ? (
                                <span className="happy2-file-browser__deleted">{`−${String(local.deletedLines)}`}</span>
                            ) : null}
                        </span>
                    ) : null}
                </span>
                {picked > 0 && local.onRevert ? (
                    <button
                        className="happy2-file-browser__revert"
                        data-happy-desktop-ui="file-browser-revert"
                        onClick={() => local.onRevert?.()}
                        type="button"
                    >
                        Revert
                    </button>
                ) : null}
                <div className="happy2-file-browser__layouts" role="group">
                    <button
                        aria-label="List files"
                        aria-pressed={local.layout === "flat"}
                        className="happy2-file-browser__layout"
                        data-active={local.layout === "flat" ? "" : undefined}
                        data-happy-desktop-ui="file-browser-layout"
                        onClick={() => local.onLayoutChange?.("flat")}
                        type="button"
                    >
                        <Icon name="files" size={14} />
                    </button>
                    <button
                        aria-label="Nest files into directories"
                        aria-pressed={local.layout === "tree"}
                        className="happy2-file-browser__layout"
                        data-active={local.layout === "tree" ? "" : undefined}
                        data-happy-desktop-ui="file-browser-layout"
                        onClick={() => local.onLayoutChange?.("tree")}
                        type="button"
                    >
                        <Icon name="branch" size={14} />
                    </button>
                </div>
            </div>
            {local.note ? (
                <div
                    className="happy2-file-browser__note"
                    data-happy-desktop-ui="file-browser-note"
                >
                    {local.note}
                </div>
            ) : null}
            {/* The tree does its own scrolling here, because a checkout listing
                draws only the rows on screen and nothing outside it can know
                how tall the rest would have been. */}
            <div className="happy2-file-browser__body" data-happy-desktop-ui="file-browser-body">
                <FileTree
                    emptyLabel={local.emptyLabel}
                    label={local.scope === "all" ? "All files" : "Changed files"}
                    loading={local.loading}
                    loadingLabel={local.loadingLabel}
                    nodes={local.nodes}
                    onLoadMore={local.onLoadMore}
                    onOpen={local.onOpen}
                    onSelect={local.onSelect}
                    onToggle={local.onToggle}
                    selectedId={local.selectedId}
                    selectedIds={local.selectedIds}
                    virtualize
                />
            </div>
        </section>
    );
}
