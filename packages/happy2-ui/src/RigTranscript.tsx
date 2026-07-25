import { type CSSProperties } from "react";
import type { RigTranscriptEntry } from "happy2-state";
import { Icon } from "./Icon";
import { renderMessageMarkdown } from "./MessageMarkdown";
import { RigToolCall } from "./RigToolCall";

export type RigTranscriptProps = {
    entries: readonly RigTranscriptEntry[];
    /** True while a run is in flight; shows the live activity line with elapsed. */
    running?: boolean;
    /** Elapsed run time in ms, supplied by the owner (no timers live in the UI). */
    elapsedMs?: number;
    /** Opens a user-attached image (entry id + image index). */
    onImageOpen?: (entryId: string, index: number) => void;
    /**
     * Rewinds the conversation back to a user message (truncates everything after
     * it). When provided, each user entry shows a rewind affordance; the owner
     * confirms and calls the store `rewind` action with the entry id (= message id).
     */
    onRewind?: (entryId: string) => void;
    /** Renders rich tool bodies expanded from the first paint (blueprint/tests). */
    toolsDefaultExpanded?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const NOTICE_ICON = "•";

function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

function RigUserEntry(props: {
    entry: Extract<RigTranscriptEntry, { kind: "user" }>;
    onImageOpen?: (entryId: string, index: number) => void;
    onRewind?: (entryId: string) => void;
}) {
    const { entry } = props;
    return (
        <div className="happy2-rig-entry happy2-rig-entry--user" data-happy2-ui="rig-entry-user">
            <span
                aria-hidden="true"
                className="happy2-rig-entry__prefix happy2-rig-entry__prefix--user"
            >
                ›
            </span>
            <div className="happy2-rig-entry__user-body">
                {props.onRewind ? (
                    <button
                        aria-label="Rewind the conversation to this message"
                        className="happy2-rig-entry__rewind"
                        data-happy2-ui="rig-entry-rewind"
                        onClick={() => props.onRewind?.(entry.id)}
                        title="Rewind to here"
                        type="button"
                    >
                        <Icon name="reply" size={12} />
                        <span className="happy2-rig-entry__rewind-label">Rewind</span>
                    </button>
                ) : null}
                {entry.text ? (
                    <div
                        className="happy2-rig-entry__user-text"
                        data-happy2-ui="rig-entry-user-text"
                    >
                        {entry.text}
                    </div>
                ) : null}
                {entry.images.length > 0 ? (
                    <div className="happy2-rig-entry__images" data-happy2-ui="rig-entry-images">
                        {entry.images.map((image, index) => (
                            <button
                                aria-label={`Open attached image ${index + 1}`}
                                className="happy2-rig-entry__image-chip"
                                data-happy2-ui="rig-entry-image-chip"
                                key={index}
                                onClick={() => props.onImageOpen?.(entry.id, index)}
                                type="button"
                            >
                                {image.mediaType || "image"}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function RigAgentTextEntry(props: { entry: Extract<RigTranscriptEntry, { kind: "agentText" }> }) {
    const { entry } = props;
    return (
        <div className="happy2-rig-entry happy2-rig-entry--agent" data-happy2-ui="rig-entry-agent">
            <span aria-hidden="true" className="happy2-rig-entry__prefix">
                {NOTICE_ICON}
            </span>
            <div
                className="happy2-rig-entry__markdown happy2-message__body--markdown"
                data-happy2-ui="rig-entry-markdown"
            >
                {renderMessageMarkdown(entry.text)}
                {entry.streaming ? (
                    <span
                        aria-label="Generating"
                        className="happy2-rig-entry__caret"
                        data-happy2-ui="rig-entry-caret"
                        role="img"
                    />
                ) : null}
            </div>
        </div>
    );
}

function RigThinkingEntry(props: { entry: Extract<RigTranscriptEntry, { kind: "thinking" }> }) {
    const { entry } = props;
    return (
        <div
            className="happy2-rig-entry happy2-rig-entry--thinking"
            data-happy2-ui="rig-entry-thinking"
        >
            <span aria-hidden="true" className="happy2-rig-entry__prefix">
                {NOTICE_ICON}
            </span>
            <div
                className="happy2-rig-entry__markdown happy2-message__body--markdown"
                data-happy2-ui="rig-entry-thinking-markdown"
            >
                {renderMessageMarkdown(entry.text)}
                {entry.streaming ? (
                    <span
                        aria-label="Thinking"
                        className="happy2-rig-entry__caret"
                        data-happy2-ui="rig-entry-caret"
                        role="img"
                    />
                ) : null}
            </div>
        </div>
    );
}

function RigNoticeEntry(props: {
    level: "info" | "warning" | "error";
    title: string;
    text: string;
    testid: string;
}) {
    return (
        <div
            className="happy2-rig-entry happy2-rig-entry--notice"
            data-level={props.level}
            data-happy2-ui={props.testid}
        >
            <span aria-hidden="true" className="happy2-rig-entry__prefix" data-level={props.level}>
                {NOTICE_ICON}
            </span>
            <div className="happy2-rig-entry__notice-body">
                <span
                    className="happy2-rig-entry__notice-title"
                    data-happy2-ui="rig-entry-notice-title"
                >
                    {props.title}
                </span>
                {props.text ? (
                    <span
                        className="happy2-rig-entry__notice-text"
                        data-happy2-ui="rig-entry-notice-text"
                    >
                        {props.text}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function RigShellEntry(props: { entry: Extract<RigTranscriptEntry, { kind: "shell" }> }) {
    const { entry } = props;
    const status = entry.running
        ? "Running"
        : entry.timedOut
          ? "Timed out"
          : entry.exitCode === 0
            ? "Exit 0"
            : `Exit ${entry.exitCode ?? "?"}`;
    const failed = !entry.running && (entry.timedOut || (entry.exitCode ?? 0) !== 0);
    return (
        <div className="happy2-rig-entry happy2-rig-entry--shell" data-happy2-ui="rig-entry-shell">
            <span aria-hidden="true" className="happy2-rig-entry__prefix">
                {"!"}
            </span>
            <div className="happy2-rig-entry__shell-body">
                <div className="happy2-rig-entry__shell-head">
                    <span
                        className="happy2-rig-entry__shell-command"
                        data-happy2-ui="rig-entry-shell-command"
                    >
                        {entry.command}
                    </span>
                    <span
                        className="happy2-rig-entry__shell-status"
                        data-happy2-ui="rig-entry-shell-status"
                        data-failed={failed ? "true" : undefined}
                        data-running={entry.running ? "true" : undefined}
                    >
                        {status}
                    </span>
                </div>
                {entry.output ? (
                    <pre
                        className="happy2-rig-entry__shell-output"
                        data-happy2-ui="rig-entry-shell-output"
                    >
                        {entry.output}
                    </pre>
                ) : null}
            </div>
        </div>
    );
}

function RigTurnSeparator(props: {
    entry: Extract<RigTranscriptEntry, { kind: "turnSeparator" }>;
}) {
    const { entry } = props;
    const parts: string[] = [];
    // Match the TUI: only surface elapsed once a turn ran long enough to matter.
    if (entry.elapsedMs !== undefined && entry.elapsedMs >= 60_000)
        parts.push(`Worked for ${formatElapsed(entry.elapsedMs)}`);
    if (entry.toolCount > 0)
        parts.push(`${entry.toolCount} ${entry.toolCount === 1 ? "tool" : "tools"}`);
    if (entry.fileCount > 0)
        parts.push(`${entry.fileCount} ${entry.fileCount === 1 ? "file" : "files"}`);
    if (entry.additions > 0 || entry.deletions > 0)
        parts.push(`+${entry.additions} \u2212${entry.deletions}`);
    return (
        <div
            className="happy2-rig-turn-separator"
            data-happy2-ui="rig-turn-separator"
            role="separator"
        >
            <span aria-hidden="true" className="happy2-rig-turn-separator__rule" />
            {parts.length > 0 ? (
                <span
                    className="happy2-rig-turn-separator__label"
                    data-happy2-ui="rig-turn-separator-label"
                >
                    {parts.join(" · ")}
                </span>
            ) : null}
            {parts.length > 0 ? (
                <span aria-hidden="true" className="happy2-rig-turn-separator__rule" />
            ) : null}
        </div>
    );
}

function RigTranscriptEntryView(props: {
    entry: RigTranscriptEntry;
    onImageOpen?: (entryId: string, index: number) => void;
    onRewind?: (entryId: string) => void;
    toolsDefaultExpanded?: boolean;
}) {
    const { entry } = props;
    switch (entry.kind) {
        case "user":
            return (
                <RigUserEntry
                    entry={entry}
                    onImageOpen={props.onImageOpen}
                    onRewind={props.onRewind}
                />
            );
        case "agentText":
            return <RigAgentTextEntry entry={entry} />;
        case "thinking":
            return <RigThinkingEntry entry={entry} />;
        case "tool":
            return <RigToolCall tool={entry.tool} defaultExpanded={props.toolsDefaultExpanded} />;
        case "system":
            return (
                <RigNoticeEntry
                    level="info"
                    title="System"
                    text={entry.text}
                    testid="rig-entry-system"
                />
            );
        case "notice":
            return (
                <RigNoticeEntry
                    level={entry.level}
                    title={entry.title}
                    text={entry.text}
                    testid="rig-entry-notice"
                />
            );
        case "shell":
            return <RigShellEntry entry={entry} />;
        case "turnSeparator":
            return <RigTurnSeparator entry={entry} />;
    }
}

/**
 * RigTranscript — renders an ordered `RigTranscriptEntry[]` with the role/symbol/
 * color contract of the Rig TUI: `›` user input surface, `•` dim agent/thinking
 * markdown, colored `•` notices, and rich tool calls. Entries are keyed by their
 * stable `id` so a streamed tail or status change updates one row in place. A live
 * activity line with the owner-supplied elapsed time is appended while `running`.
 * Presentational only; the parent filters thinking visibility and owns run state.
 */
export function RigTranscript(props: RigTranscriptProps) {
    return (
        <div
            className={["happy2-rig-transcript", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-transcript"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-transcript__entries" data-happy2-ui="rig-transcript-entries">
                {props.entries.map((entry) => (
                    <RigTranscriptEntryView
                        entry={entry}
                        key={entry.id}
                        onImageOpen={props.onImageOpen}
                        onRewind={props.onRewind}
                        toolsDefaultExpanded={props.toolsDefaultExpanded}
                    />
                ))}
                {props.running ? (
                    <div
                        className="happy2-rig-transcript__activity"
                        data-happy2-ui="rig-transcript-activity"
                        role="status"
                    >
                        <span aria-hidden="true" className="happy2-rig-transcript__activity-wave" />
                        <span className="happy2-rig-transcript__activity-label">Working</span>
                        {props.elapsedMs !== undefined ? (
                            <span
                                className="happy2-rig-transcript__activity-elapsed"
                                data-happy2-ui="rig-transcript-elapsed"
                            >
                                {formatElapsed(props.elapsedMs)}
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
