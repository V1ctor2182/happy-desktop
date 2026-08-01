import { useState, type CSSProperties } from "react";
import type {
    ConversationActivity,
    ConversationActivityPresentation,
    ConversationActivityReview,
    ConversationActivityStatus,
    ConversationFileDiff,
    ConversationJson,
    ConversationToolCall,
} from "happy2-state";
import { CopyButton } from "./CopyButton";
import { DiffSnippet, type DiffLine } from "./DiffSnippet";
import { Icon, type IconName } from "./Icon";
import { renderMessageMarkdown } from "./MessageMarkdown";
import { ScrollingText } from "./ScrollingText";
import { Spinner } from "./Spinner";
import { TypedText } from "./TypedText";
import { Ionicon, Octicon } from "./vectorIcons/VectorIcon";

export type AgentActivityRowProps = {
    activity: ConversationActivity;
    /** Opens a tool's complete body in an owner-provided detail surface. */
    onToolSelect?: (tool: ConversationToolCall) => void;
    /** Start expanded (blueprint/tests). Otherwise rich bodies collapse by default. */
    defaultExpanded?: boolean;
    /**
     * Local conversation tool rows: one neutral line aligned with agent text, with
     * no inline result or expand affordance.
     */
    singleLine?: boolean;
    /** Durable event time, revealed with the row's trailing hover metadata. */
    time?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/** Max file diffs rendered per tool before an overflow note replaces the rest. */
const MAX_DIFF_FILES = 5;
/** Head/tail line budget for exec-command output before the middle is elided. */
const EXEC_HEAD_TAIL = 5;
/** Bounded JSON budget for generic tool-call arguments (chars). */
const JSON_BUDGET = 4096;
/** MCP result-row budget: dim child rows shown before an overflow note (A3). */
const MCP_RESULT_ROWS = 5;

function AgentActivityTime(props: { time?: string }) {
    return props.time ? (
        <span className="happy2-agent-activity__time" data-happy2-ui="agent-activity-time">
            {props.time}
        </span>
    ) : null;
}

/**
 * Parses an MCP tool name (`mcp__server__tool`) into its server and tool parts.
 * Returns undefined for any name that is not an MCP invocation, so the caller
 * falls back to the generic tool rendering path.
 */
function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
    if (!name.startsWith("mcp__")) return undefined;
    const parts = name.split("__");
    if (parts.length < 3) return undefined;
    return { server: parts[1]!, tool: parts.slice(2).join(" ") };
}

/** Splits an MCP result into ≤`budget` dim rows, returning the overflow count. */
function mcpResultRows(display: string, budget: number): { rows: string[]; omitted: number } {
    const all = display.replace(/\n+$/, "").split("\n");
    if (all.length <= budget) return { rows: all, omitted: 0 };
    return { rows: all.slice(0, budget), omitted: all.length - budget };
}

/** Friendly tool label — mirrors the TUI `humanizeToolName` mapping (A3). */
function humanizeToolName(name: string): string {
    const explicit: Record<string, string> = {
        Agent: "Subagent",
        TaskList: "Task list",
        TaskOutput: "Background output",
        spawn_agent: "Start subagent",
        wait_agent: "Wait for subagents",
        workflow: "Workflow",
    };
    if (explicit[name]) return explicit[name]!;
    if (name.startsWith("mcp__")) {
        const parts = name.split("__");
        if (parts.length >= 3) return `${parts[1]} · ${parts.slice(2).join(" ")}`;
    }
    return name
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (character) => character.toUpperCase());
}

/** Active/done verb for a tool by name + status (A2/A3). */
function toolVerb(
    name: string,
    status: ConversationActivityStatus,
    presentation?: ConversationActivityPresentation,
): string {
    if (status === "awaitingApproval") return "Awaiting approval";
    if (status === "stopped") return "Stopped";
    const active = status === "running";
    const lower = name.toLowerCase();
    if (presentation?.type === "exploration") return active ? "Exploring" : "Explored";
    if (
        presentation?.type === "execCommand" ||
        presentation?.type === "backgroundTerminalInteraction" ||
        /(bash|exec|shell|command|run)/.test(lower)
    )
        return "Bash";
    if (/(grep|find|glob|^ls$|list|search)/.test(lower)) return active ? "Exploring" : "Explored";
    if (/(read|view|cat|open)/.test(lower)) return active ? "Reading" : "Read";
    if (/(write|edit|patch|update|apply)/.test(lower)) return active ? "Editing" : "Edited";
    return active ? "Tool" : "Used";
}

/**
 * Tool → the glyph saying what kind of work it was. Commands use Octicons
 * `code`, failed tools use Octicons `alert`, and file edits use Ionicons
 * `document-outline`; the remaining tool families use the curated vocabulary.
 */
type ToolGlyph =
    | { set: "house"; name: IconName }
    | { set: "ionicons"; name: "document-outline" }
    | { set: "octicons"; name: "alert" | "code" };

function toolGlyph(
    name: string,
    presentation: ConversationActivityPresentation | undefined,
    failed: boolean,
): ToolGlyph {
    if (failed) return { set: "octicons", name: "alert" };
    if (presentation?.type === "exploration") return { set: "house", name: "search" };
    if (presentation?.type === "fileDiff") return { set: "ionicons", name: "document-outline" };
    if (
        presentation?.type === "execCommand" ||
        presentation?.type === "backgroundTerminalInteraction"
    )
        return { set: "octicons", name: "code" };
    const lower = name.toLowerCase();
    if (/(bash|exec|shell|command|run)/.test(lower)) return { set: "octicons", name: "code" };
    if (/(grep|find|glob|^ls$|list|search)/.test(lower)) return { set: "house", name: "search" };
    if (/(read|view|cat|open)/.test(lower)) return { set: "house", name: "doc" };
    if (/(write|edit|patch|update|apply)/.test(lower))
        return { set: "ionicons", name: "document-outline" };
    if (/(fetch|http|web|url|browser)/.test(lower)) return { set: "house", name: "globe" };
    if (/(task|todo|plan)/.test(lower)) return { set: "house", name: "tasks" };
    if (/(agent|spawn|subagent|workflow)/.test(lower)) return { set: "house", name: "agents" };
    return { set: "house", name: "zap" };
}

function ToolIcon(props: { glyph: ToolGlyph }) {
    if (props.glyph.set === "ionicons") return <Ionicon name={props.glyph.name} size={12} />;
    if (props.glyph.set === "octicons") return <Octicon name={props.glyph.name} size={12} />;
    return <Icon name={props.glyph.name} size={12} />;
}

/** Retypes a tool label whenever this row's projected text changes. */
function AgentActivityChangingText(props: { value: string }) {
    return <TypedText data-happy2-ui="agent-activity-changing-text" value={props.value} />;
}

function explorationSummary(
    presentation: Extract<ConversationActivityPresentation, { type: "exploration" }>,
): string {
    const operations = presentation.operations;
    if (operations.every((operation) => operation.kind === "read")) {
        return [
            ...new Set(
                operations.flatMap((operation) =>
                    operation.kind === "read" ? [operation.name] : [],
                ),
            ),
        ].join(", ");
    }
    return operations
        .map((operation) => {
            if (operation.kind === "list") return `List ${operation.target}`;
            if (operation.kind === "read") return `Read ${operation.name}`;
            const detail =
                operation.query !== undefined && operation.path !== undefined
                    ? `${operation.query} in ${operation.path}`
                    : (operation.query ?? operation.path ?? operation.command);
            return `Search ${detail}`;
        })
        .join(" · ");
}

/** Status → semantic dot tone: warning while active/awaiting, error on stop/fail. */
function statusTone(status: ConversationActivityStatus): "success" | "warning" | "error" {
    if (status === "success") return "success";
    if (status === "failed" || status === "stopped") return "error";
    return "warning";
}

function diffVerb(kind: ConversationFileDiff["kind"]): string {
    if (kind === "add") return "Added";
    if (kind === "delete") return "Deleted";
    return "Edit";
}

function fileName(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

function diffCounts(file: ConversationFileDiff): { added: number; deleted: number } {
    if (file.added !== undefined || file.deleted !== undefined)
        return { added: file.added ?? 0, deleted: file.deleted ?? 0 };
    let added = 0;
    let deleted = 0;
    for (const hunk of file.hunks)
        for (const line of hunk.lines) {
            if (line.kind === "add") added += 1;
            else if (line.kind === "delete") deleted += 1;
        }
    return { added, deleted };
}

/** Flattens a file's hunks into numbered DiffSnippet lines with `@@` meta rows. */
function diffLines(file: ConversationFileDiff): DiffLine[] {
    const lines: DiffLine[] = [];
    file.hunks.forEach((hunk, index) => {
        if (file.hunks.length > 1 || index > 0)
            lines.push({
                kind: "meta",
                text: `@@ -${hunk.oldStart} +${hunk.newStart} @@`,
            });
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        for (const line of hunk.lines) {
            if (line.kind === "add") {
                lines.push({ kind: "add", number: newLine, text: line.text });
                newLine += 1;
            } else if (line.kind === "delete") {
                lines.push({ kind: "del", number: oldLine, text: line.text });
                oldLine += 1;
            } else {
                lines.push({ kind: "context", number: newLine, text: line.text });
                oldLine += 1;
                newLine += 1;
            }
        }
    });
    return lines;
}

/** Keep the first and last `budget` lines, eliding the middle with a count note. */
function headTail(text: string, budget: number): { lines: string[]; omitted: number } {
    const all = text.replace(/\n+$/, "").split("\n");
    if (all.length <= budget * 2) return { lines: all, omitted: 0 };
    return {
        lines: [...all.slice(0, budget), ...all.slice(all.length - budget)],
        omitted: all.length - budget * 2,
    };
}

function boundedJson(value: ConversationJson): string | undefined {
    if (value === null) return undefined;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
        return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    const text = JSON.stringify(value, null, 2);
    return text.length > JSON_BUDGET ? `${text.slice(0, JSON_BUDGET)}\n… truncated` : text;
}

function ChildRow(props: { tone?: "muted" | "error"; children: React.ReactNode }) {
    return (
        <div
            className="happy2-agent-activity__child"
            data-tone={props.tone ?? "muted"}
            data-happy2-ui="agent-activity-child"
        >
            <span aria-hidden="true" className="happy2-agent-activity__child-marker">
                └
            </span>
            <span
                className="happy2-agent-activity__child-text"
                data-happy2-ui="agent-activity-child-text"
            >
                {props.children}
            </span>
        </div>
    );
}

function PermissionReviewRow(props: { review: ConversationActivityReview }) {
    const { review } = props;
    const title =
        review.decision === "allow"
            ? "Approved"
            : review.decision === "deny"
              ? "Denied"
              : "Awaiting approval";
    return (
        <div className="happy2-agent-activity__review" data-happy2-ui="agent-activity-review">
            <span aria-hidden="true" className="happy2-agent-activity__child-marker">
                └
            </span>
            <span className="happy2-agent-activity__review-body">
                <span
                    className="happy2-agent-activity__review-title"
                    data-happy2-ui="agent-activity-review-title"
                >
                    {title} · {review.action}
                </span>
                <span className="happy2-agent-activity__review-reason">{review.reason}</span>
                <span
                    className="happy2-agent-activity__review-risk"
                    data-risk={review.risk}
                    data-happy2-ui="agent-activity-review-risk"
                >
                    Risk: {review.risk}
                </span>
            </span>
        </div>
    );
}

/**
 * One tool invocation: a rich body chosen by `presentation` (file diff, exec
 * command, background-terminal interaction) with a generic header + result/args
 * fallback. A colored status dot and verb encode running/awaiting-approval/
 * success/failed/stopped, and a pending `review` renders an inline "Awaiting
 * approval" child line. Collapse/expand of the rich body is the only local UI
 * state; every value comes from props.
 */
function AgentToolActivity(props: {
    tool: ConversationToolCall;
    defaultExpanded?: boolean;
    onSelect?: (tool: ConversationToolCall) => void;
    singleLine?: boolean;
    time?: string;
}) {
    const { tool } = props;
    const presentation = tool.presentation;
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
    const singleLine = props.singleLine ?? false;
    const running = tool.status === "running";

    const tone = singleLine ? "neutral" : statusTone(tool.status);

    // MCP tool calls (`mcp__server__tool`) have no protocol presentation; the TUI
    // derives their block at render time from the name, arguments, and result. We
    // do the same, but only when no richer presentation (diff/exec) applies.
    const mcp = presentation ? undefined : parseMcpToolName(tool.toolName);

    let primaryText: string;
    let stats: { added: number; deleted: number } | undefined;
    let verb: string;
    if (mcp) {
        verb = toolVerb(tool.toolName, tool.status, presentation);
        primaryText = `${mcp.server} · ${mcp.tool}`;
    } else if (presentation?.type === "exploration") {
        verb = toolVerb(tool.toolName, tool.status, presentation);
        primaryText = explorationSummary(presentation);
    } else if (presentation?.type === "fileDiff") {
        const first = presentation.files[0];
        verb = first ? diffVerb(first.kind) : toolVerb(tool.toolName, tool.status, presentation);
        primaryText = first ? fileName(first.path) : humanizeToolName(tool.toolName);
        stats = presentation.files.reduce(
            (total, file) => {
                const counts = diffCounts(file);
                return {
                    added: total.added + counts.added,
                    deleted: total.deleted + counts.deleted,
                };
            },
            { added: 0, deleted: 0 },
        );
    } else if (presentation?.type === "execCommand") {
        verb = toolVerb(tool.toolName, tool.status, presentation);
        primaryText = presentation.command;
    } else if (presentation?.type === "backgroundTerminalInteraction") {
        verb = toolVerb(tool.toolName, tool.status, presentation);
        primaryText = presentation.command;
    } else {
        verb = toolVerb(tool.toolName, tool.status, presentation);
        primaryText = humanizeToolName(tool.toolName);
    }

    const argsJson = presentation ? undefined : boundedJson(tool.arguments);
    const execOutput =
        presentation?.type === "execCommand"
            ? headTail(presentation.output, EXEC_HEAD_TAIL)
            : undefined;
    const terminalInput =
        presentation?.type === "backgroundTerminalInteraction"
            ? presentation.input.replace(/\n+$/, "").split("\n")
            : undefined;

    /* What a reader reaches for the clipboard to get: the subject that scrolled
       out of the row, followed by the output or result the row only shows in
       part. Both are elided on screen, so the copy is the unabridged text. */
    const copyText = [
        primaryText,
        presentation?.type === "execCommand"
            ? presentation.output
            : presentation === undefined
              ? tool.display
              : undefined,
    ]
        .map((part) => part?.replace(/\n+$/, ""))
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join("\n");

    const hasBody = singleLine
        ? false
        : presentation?.type === "fileDiff"
          ? presentation.files.length > 0
          : presentation?.type === "execCommand"
            ? presentation.output.trim().length > 0
            : presentation?.type === "backgroundTerminalInteraction"
              ? presentation.input.trim().length > 0
              : Boolean(argsJson);

    // MCP results render as capped dim rows (≤5, then "… N more"); an interrupted
    // call collapses to a single "Interrupted." row, matching the TUI.
    const mcpResult = mcp
        ? tool.failure?.kind === "interrupted"
            ? { rows: ["Interrupted."], omitted: 0 }
            : tool.display && tool.display.trim().length > 0
              ? mcpResultRows(tool.display, MCP_RESULT_ROWS)
              : { rows: ["(empty result)"], omitted: 0 }
        : undefined;

    const genericResult =
        mcp || presentation
            ? undefined
            : tool.display !== undefined && tool.display.length > 0
              ? tool.display
              : "(empty result)";

    const header = (
        <>
            {singleLine ? null : (
                <span
                    aria-hidden="true"
                    className="happy2-agent-activity__dot"
                    data-tone={tone}
                    data-happy2-ui="agent-activity-dot"
                />
            )}
            {/* What kind of work this was, told at a glance. It is decoration
                over the verb beside it, which already says the same thing in
                words, so it stays out of the accessibility tree. */}
            <span
                aria-hidden="true"
                className="happy2-agent-activity__glyph"
                data-happy2-ui="agent-activity-glyph"
            >
                {running ? (
                    <Spinner
                        label={`${humanizeToolName(tool.toolName)} is running`}
                        size={12}
                        tone="muted"
                        variant="circle"
                    />
                ) : (
                    <ToolIcon
                        glyph={toolGlyph(
                            tool.toolName,
                            presentation,
                            tool.failed || tool.status === "failed",
                        )}
                    />
                )}
            </span>
            <span className="happy2-agent-activity__verb" data-happy2-ui="agent-activity-verb">
                <AgentActivityChangingText value={verb} />
            </span>
            {stats ? (
                <span
                    className="happy2-agent-activity__file-summary"
                    data-happy2-ui="agent-activity-file-summary"
                >
                    <ScrollingText
                        className="happy2-agent-activity__text"
                        data-happy2-ui="agent-activity-text"
                    >
                        <AgentActivityChangingText value={primaryText} />
                    </ScrollingText>
                    {/* A side that changed nothing is left unsaid: "+0" is a
                        number the reader has to read before learning there was
                        nothing to learn. */}
                    {stats.added || stats.deleted ? (
                        <span
                            className="happy2-agent-activity__stats"
                            data-happy2-ui="agent-activity-stats"
                        >
                            {stats.added ? (
                                <span className="happy2-agent-activity__added">+{stats.added}</span>
                            ) : null}
                            {stats.deleted ? (
                                <span className="happy2-agent-activity__deleted">
                                    &minus;{stats.deleted}
                                </span>
                            ) : null}
                        </span>
                    ) : null}
                </span>
            ) : (
                <ScrollingText
                    className="happy2-agent-activity__text"
                    data-happy2-ui="agent-activity-text"
                >
                    <AgentActivityChangingText value={primaryText} />
                </ScrollingText>
            )}
            {hasBody ? (
                <span aria-hidden="true" className="happy2-agent-activity__chevron">
                    <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                </span>
            ) : null}
            <AgentActivityTime time={props.time} />
        </>
    );

    return (
        <div
            className="happy2-agent-activity"
            data-status={tool.status}
            data-failed={tool.failed || tool.status === "failed" ? "" : undefined}
            data-tone={tone}
            data-presentation={presentation?.type ?? "generic"}
            data-single-line={singleLine ? "" : undefined}
            data-expanded={expanded ? "" : undefined}
            data-happy2-ui="agent-activity-call"
        >
            {/* The copy action is a sibling of the header rather than part of
                it: the header is itself a button in most variants, and a
                nested button would be neither valid nor clickable. */}
            <div className="happy2-agent-activity__line" data-happy2-ui="agent-activity-line">
                {singleLine && props.onSelect ? (
                    <button
                        className="happy2-agent-activity__header"
                        data-happy2-ui="agent-activity-header"
                        onClick={() => props.onSelect?.(tool)}
                        type="button"
                    >
                        {header}
                    </button>
                ) : singleLine ? (
                    <div
                        className="happy2-agent-activity__header"
                        data-happy2-ui="agent-activity-header"
                    >
                        {header}
                    </div>
                ) : (
                    <button
                        aria-expanded={hasBody ? (expanded ? "true" : "false") : undefined}
                        className="happy2-agent-activity__header"
                        data-happy2-ui="agent-activity-header"
                        disabled={!hasBody}
                        onClick={() => hasBody && setExpanded((open) => !open)}
                        type="button"
                    >
                        {header}
                    </button>
                )}
                <CopyButton
                    data-happy2-ui="agent-activity-copy"
                    label="Copy tool detail"
                    text={copyText}
                />
            </div>

            {!singleLine && tool.review ? <PermissionReviewRow review={tool.review} /> : null}

            {!singleLine && genericResult !== undefined ? (
                <ChildRow tone={tool.failed ? "error" : "muted"}>{genericResult}</ChildRow>
            ) : null}

            {!singleLine && mcpResult ? (
                <div data-happy2-ui="agent-activity-mcp-result">
                    {mcpResult.rows.map((row, index) => (
                        <ChildRow key={index} tone={tool.failed ? "error" : "muted"}>
                            {row || "\u00a0"}
                        </ChildRow>
                    ))}
                    {mcpResult.omitted > 0 ? <ChildRow>… {mcpResult.omitted} more</ChildRow> : null}
                </div>
            ) : null}

            {expanded && hasBody ? (
                <div className="happy2-agent-activity__body" data-happy2-ui="agent-activity-body">
                    {presentation?.type === "fileDiff"
                        ? (() => {
                              const shown = presentation.files.slice(0, MAX_DIFF_FILES);
                              const omittedFiles =
                                  (presentation.omittedFiles ?? 0) +
                                  Math.max(0, presentation.files.length - MAX_DIFF_FILES);
                              return (
                                  <>
                                      {shown.map((file, index) => (
                                          <div
                                              className="happy2-agent-activity__diff"
                                              key={`${file.path}-${index}`}
                                          >
                                              <DiffSnippet
                                                  file={file.path}
                                                  lines={diffLines(file)}
                                                  stats={{
                                                      added: diffCounts(file).added,
                                                      removed: diffCounts(file).deleted,
                                                  }}
                                              />
                                              {file.omittedLines ? (
                                                  <ChildRow>
                                                      … {file.omittedLines} more lines
                                                  </ChildRow>
                                              ) : null}
                                          </div>
                                      ))}
                                      {omittedFiles > 0 ? (
                                          <ChildRow>… {omittedFiles} more files</ChildRow>
                                      ) : null}
                                  </>
                              );
                          })()
                        : null}

                    {presentation?.type === "execCommand" && execOutput
                        ? (() => {
                              const headCount =
                                  execOutput.omitted > 0 ? EXEC_HEAD_TAIL : execOutput.lines.length;
                              return (
                                  <pre
                                      className="happy2-agent-activity__output"
                                      data-happy2-ui="agent-activity-output"
                                  >
                                      {execOutput.lines.map((line, index) => (
                                          <div
                                              className="happy2-agent-activity__output-line"
                                              key={index}
                                          >
                                              {line || "\u00a0"}
                                              {execOutput.omitted > 0 && index === headCount - 1 ? (
                                                  <div className="happy2-agent-activity__output-elide">
                                                      … +{execOutput.omitted} lines
                                                  </div>
                                              ) : null}
                                          </div>
                                      ))}
                                  </pre>
                              );
                          })()
                        : null}

                    {terminalInput ? (
                        <div className="happy2-agent-activity__terminal">
                            {terminalInput.map((line, index) => (
                                <ChildRow key={index}>{line || "\u00a0"}</ChildRow>
                            ))}
                        </div>
                    ) : null}

                    {argsJson ? (
                        <pre
                            className="happy2-agent-activity__args"
                            data-happy2-ui="agent-activity-args"
                        >
                            {argsJson}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** Model reasoning: one compact line that expands into the full thinking text. */
function AgentReasoningActivity(props: {
    text: string;
    streaming: boolean;
    defaultExpanded?: boolean;
    time?: string;
}) {
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
    const summary = props.text.split("\n").find((line) => line.trim().length > 0) ?? "";
    return (
        <div
            className="happy2-agent-activity"
            data-expanded={expanded ? "" : undefined}
            data-presentation="reasoning"
            data-tone="warning"
            data-happy2-ui="agent-activity-reasoning"
        >
            <button
                aria-expanded={expanded ? "true" : "false"}
                className="happy2-agent-activity__header"
                data-happy2-ui="agent-activity-header"
                onClick={() => setExpanded((open) => !open)}
                type="button"
            >
                <span
                    aria-hidden="true"
                    className="happy2-agent-activity__dot"
                    data-tone={props.streaming ? "warning" : "success"}
                    data-happy2-ui="agent-activity-dot"
                />
                <span className="happy2-agent-activity__verb" data-happy2-ui="agent-activity-verb">
                    {props.streaming ? "Thinking" : "Thought"}
                </span>
                <ScrollingText
                    className="happy2-agent-activity__text"
                    data-happy2-ui="agent-activity-text"
                >
                    {summary}
                </ScrollingText>
                <span aria-hidden="true" className="happy2-agent-activity__chevron">
                    <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                </span>
                <AgentActivityTime time={props.time} />
            </button>
            {expanded ? (
                <div
                    className="happy2-agent-activity__body happy2-agent-activity__reasoning happy2-message__body--markdown"
                    data-happy2-ui="agent-activity-reasoning-body"
                >
                    {renderMessageMarkdown(props.text)}
                </div>
            ) : null}
        </div>
    );
}

/** A shell-mode run: the command line, its exit state, and its captured output. */
function AgentShellActivity(props: {
    command: string;
    output: string;
    exitCode: number | null;
    running: boolean;
    timedOut: boolean;
    defaultExpanded?: boolean;
    time?: string;
}) {
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);
    const failed = !props.running && (props.timedOut || (props.exitCode ?? 0) !== 0);
    const status = props.running
        ? "Running"
        : props.timedOut
          ? "Timed out"
          : `Exit ${props.exitCode ?? "?"}`;
    const hasBody = props.output.trim().length > 0;
    return (
        <div
            className="happy2-agent-activity"
            data-expanded={expanded ? "" : undefined}
            data-presentation="shell"
            data-tone={props.running ? "warning" : failed ? "error" : "success"}
            data-happy2-ui="agent-activity-shell"
        >
            <button
                aria-expanded={hasBody ? (expanded ? "true" : "false") : undefined}
                className="happy2-agent-activity__header"
                data-happy2-ui="agent-activity-header"
                disabled={!hasBody}
                onClick={() => hasBody && setExpanded((open) => !open)}
                type="button"
            >
                <span
                    aria-hidden="true"
                    className="happy2-agent-activity__dot"
                    data-tone={props.running ? "warning" : failed ? "error" : "success"}
                    data-happy2-ui="agent-activity-dot"
                />
                <span
                    aria-hidden="true"
                    className="happy2-agent-activity__glyph"
                    data-happy2-ui="agent-activity-glyph"
                >
                    {failed ? (
                        <Octicon name="alert" size={12} />
                    ) : (
                        <Octicon name="code" size={12} />
                    )}
                </span>
                <span className="happy2-agent-activity__verb" data-happy2-ui="agent-activity-verb">
                    Bash
                </span>
                <ScrollingText
                    className="happy2-agent-activity__text"
                    data-happy2-ui="agent-activity-text"
                >
                    {props.command}
                </ScrollingText>
                <span
                    className="happy2-agent-activity__status"
                    data-failed={failed ? "true" : undefined}
                    data-happy2-ui="agent-activity-status"
                >
                    {status}
                </span>
                {hasBody ? (
                    <span aria-hidden="true" className="happy2-agent-activity__chevron">
                        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                    </span>
                ) : null}
                <AgentActivityTime time={props.time} />
            </button>
            {expanded && hasBody ? (
                <div className="happy2-agent-activity__body" data-happy2-ui="agent-activity-body">
                    <pre
                        className="happy2-agent-activity__output"
                        data-happy2-ui="agent-activity-output"
                    >
                        {props.output}
                    </pre>
                </div>
            ) : null}
        </div>
    );
}

/**
 * A step the producer already described: its label and subject go straight to
 * the same single line a local tool call renders, so a summarized cloud turn and
 * a streamed local one read identically.
 */
function AgentLabeledActivity(props: {
    label: string;
    subject?: string;
    status: ConversationActivityStatus;
    mono: boolean;
    time?: string;
}) {
    return (
        <div
            className="happy2-agent-activity"
            data-happy2-ui="agent-activity-call"
            data-mono={props.mono ? "" : undefined}
            data-single-line=""
            data-status={props.status}
            data-tone="neutral"
        >
            <div className="happy2-agent-activity__header" data-happy2-ui="agent-activity-header">
                <span className="happy2-agent-activity__verb" data-happy2-ui="agent-activity-verb">
                    <AgentActivityChangingText value={props.label} />
                </span>
                {props.subject !== undefined && props.subject.length > 0 ? (
                    <ScrollingText
                        className="happy2-agent-activity__text"
                        data-happy2-ui="agent-activity-text"
                    >
                        <AgentActivityChangingText value={props.subject} />
                    </ScrollingText>
                ) : null}
                <AgentActivityTime time={props.time} />
            </div>
        </div>
    );
}

/** Compact live inference marker; the circular spinner replaces a textual status row. */
function AgentWaitingActivity(props: { label: string }) {
    return (
        <div
            className="happy2-agent-activity"
            data-happy2-ui="agent-activity-call"
            data-single-line=""
            data-status="running"
            data-tone="neutral"
        >
            <div className="happy2-agent-activity__header" data-happy2-ui="agent-activity-header">
                <Spinner label={props.label} size={16} tone="muted" variant="circle" />
            </div>
        </div>
    );
}

/**
 * AgentActivityRow — the one glanceable row for everything an agent does inside
 * a conversation: a tool call, a reasoning block, or a shell run. Each variant
 * shows a status dot, a verb, and its subject on a single line and expands to
 * the detail on demand, so a long working turn stays readable without hiding
 * what happened. Presentational only: the caller supplies the projected
 * activity and the surface decides which rows to show at all.
 */
export function AgentActivityRow(props: AgentActivityRowProps) {
    const activity = props.activity;
    return (
        <div
            className={["happy2-agent-activity-row", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="agent-activity-row"
            data-kind={activity.kind}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {activity.kind === "tool" ? (
                <AgentToolActivity
                    defaultExpanded={props.defaultExpanded}
                    onSelect={props.onToolSelect}
                    singleLine={props.singleLine}
                    time={props.time}
                    tool={activity.tool}
                />
            ) : activity.kind === "waiting" ? (
                <AgentWaitingActivity label={activity.label} />
            ) : activity.kind === "labeled" ? (
                <AgentLabeledActivity
                    label={activity.label}
                    mono={activity.mono}
                    status={activity.status}
                    subject={activity.subject}
                    time={props.time}
                />
            ) : activity.kind === "reasoning" ? (
                <AgentReasoningActivity
                    defaultExpanded={props.defaultExpanded}
                    streaming={activity.streaming}
                    text={activity.text}
                    time={props.time}
                />
            ) : (
                <AgentShellActivity
                    command={activity.command}
                    defaultExpanded={props.defaultExpanded}
                    exitCode={activity.exitCode}
                    output={activity.output}
                    running={activity.running}
                    timedOut={activity.timedOut}
                    time={props.time}
                />
            )}
        </div>
    );
}
