import { type CSSProperties } from "react";
import type { RigFileSearchResult } from "happy2-state";

export type RigFileMentionProps = {
    /** Candidate files for the active `@`-mention query, in daemon rank order. */
    files: readonly RigFileSearchResult[];
    /** The mention query (text after `@`), shown when there are no matches. */
    query: string;
    /** Inserts the chosen file path into the composer at the mention token. */
    onSelect: (file: RigFileSearchResult) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * RigFileMention — the `@`-mention autocomplete popover for the Rig composer. It is
 * a pure list of workspace file candidates supplied by the owner (who runs the
 * async search); choosing one calls `onSelect` so the composer can replace the
 * mention token with `@path`. Presentational only: it holds no query or search state.
 */
export function RigFileMention(props: RigFileMentionProps) {
    return (
        <div
            className={["happy2-rig-file-mention", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-file-mention"
            data-testid={props["data-testid"]}
            role="listbox"
            style={props.style}
        >
            {props.files.length === 0 ? (
                <p
                    className="happy2-rig-file-mention__empty"
                    data-happy2-ui="rig-file-mention-empty"
                >
                    No files match “{props.query}”
                </p>
            ) : (
                props.files.map((file) => (
                    <button
                        className="happy2-rig-file-mention__item"
                        data-happy2-ui="rig-file-mention-item"
                        data-path={file.path}
                        key={file.path}
                        onClick={() => props.onSelect(file)}
                        role="option"
                        type="button"
                    >
                        <span className="happy2-rig-file-mention__name">{file.fileName}</span>
                        <span className="happy2-rig-file-mention__path">{file.path}</span>
                    </button>
                ))
            )}
        </div>
    );
}
