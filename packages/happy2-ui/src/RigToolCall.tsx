import { useState, type CSSProperties } from "react";
import type {
    RigFileDiff,
    RigJson,
    RigPermissionReview,
    RigToolEntry,
    RigToolStatus,
} from "happy2-state";
import { DiffSnippet, type DiffLine } from "./DiffSnippet";
import { Icon } from "./Icon";

export type RigToolCallProps = {
    tool: RigToolEntry;
    /** Start expanded (blueprint/tests). Otherwise rich bodies collapse by default. */
    defaultExpanded?: boolean;
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
function toolVerb(name: string, status: RigToolStatus): string {
    if (status === "awaiting_approval") return "Awaiting approval";
    if (status === "stopped") return "Stopped";
    if (status === "failed") return "Failed";
    const active = status === "running";
    const lower = name.toLowerCase();
    if (/(bash|exec|shell|command|run)/.test(lower)) return active ? "Running" : "Ran";
    if (/(grep|find|glob|^ls$|list|search)/.test(lower)) return active ? "Exploring" : "Explored";
    if (/(read|view|cat|open)/.test(lower)) return active ? "Reading" : "Read";
    if (/(write|edit|patch|update|apply)/.test(lower)) return active ? "Editing" : "Edited";
    return active ? "Using" : "Used";
}

/** Status → semantic dot tone: warning while active/awaiting, error on stop/fail. */
function statusTone(status: RigToolStatus): "success" | "warning" | "error" {
    if (status === "success") return "success";
    if (status === "failed" || status === "stopped") return "error";
    return "warning";
}

function diffVerb(kind: RigFileDiff["kind"]): string {
    if (kind === "add") return "Added";
    if (kind === "delete") return "Deleted";
    return "Edited";
}

function diffCounts(file: RigFileDiff): { added: number; deleted: number } {
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
function diffLines(file: RigFileDiff): DiffLine[] {
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

function boundedJson(value: RigJson): string | undefined {
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
            className="happy2-rig-tool__child"
            data-tone={props.tone ?? "muted"}
            data-happy2-ui="rig-tool-child"
        >
            <span aria-hidden="true" className="happy2-rig-tool__child-marker">
                └
            </span>
            <span className="happy2-rig-tool__child-text" data-happy2-ui="rig-tool-child-text">
                {props.children}
            </span>
        </div>
    );
}

function PermissionReviewRow(props: { review: RigPermissionReview }) {
    const { review } = props;
    return (
        <div className="happy2-rig-tool__review" data-happy2-ui="rig-tool-review">
            <span aria-hidden="true" className="happy2-rig-tool__child-marker">
                └
            </span>
            <span className="happy2-rig-tool__review-body">
                <span
                    className="happy2-rig-tool__review-title"
                    data-happy2-ui="rig-tool-review-title"
                >
                    Awaiting approval · {review.action}
                </span>
                <span className="happy2-rig-tool__review-reason">{review.reason}</span>
                <span
                    className="happy2-rig-tool__review-risk"
                    data-risk={review.risk}
                    data-happy2-ui="rig-tool-review-risk"
                >
                    Risk: {review.risk}
                </span>
            </span>
        </div>
    );
}

/**
 * RigToolCall — presentational renderer for one `RigToolEntry`. It picks a rich
 * body by `presentation` (file diff, exec command, background-terminal
 * interaction) and otherwise falls back to a generic header + result/args block.
 * A colored status dot and verb encode running/awaiting-approval/success/failed/
 * stopped, and a pending `permissionReview` renders an inline "Awaiting approval"
 * child line. Collapse/expand of the rich body is the component's only local UI
 * state; every value comes from props so the same entry renders identically in
 * the app, blueprint, and tests.
 */
export function RigToolCall(props: RigToolCallProps) {
    const { tool } = props;
    const presentation = tool.presentation;
    const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);

    const tone = statusTone(tool.status);

    // MCP tool calls (`mcp__server__tool`) have no protocol presentation; the TUI
    // derives their block at render time from the name, arguments, and result. We
    // do the same, but only when no richer presentation (diff/exec) applies.
    const mcp = presentation ? undefined : parseMcpToolName(tool.toolName);

    let primaryText: string;
    let stats: { added: number; deleted: number } | undefined;
    let verb: string;
    if (mcp) {
        verb = toolVerb(tool.toolName, tool.status);
        primaryText = `${mcp.server} · ${mcp.tool}`;
    } else if (presentation?.type === "fileDiff") {
        const first = presentation.files[0];
        verb = first ? diffVerb(first.kind) : toolVerb(tool.toolName, tool.status);
        primaryText = first ? first.path : humanizeToolName(tool.toolName);
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
        verb = toolVerb(tool.toolName, tool.status);
        primaryText = presentation.command;
    } else if (presentation?.type === "backgroundTerminalInteraction") {
        verb = "Interacted with";
        primaryText = presentation.command;
    } else {
        verb = toolVerb(tool.toolName, tool.status);
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

    const hasBody =
        presentation?.type === "fileDiff"
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

    return (
        <div
            className={["happy2-rig-tool", props.className].filter(Boolean).join(" ")}
            data-status={tool.status}
            data-tone={tone}
            data-presentation={presentation?.type ?? "generic"}
            data-expanded={expanded ? "" : undefined}
            data-happy2-ui="rig-tool-call"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <button
                aria-expanded={hasBody ? (expanded ? "true" : "false") : undefined}
                className="happy2-rig-tool__header"
                data-happy2-ui="rig-tool-header"
                disabled={!hasBody}
                onClick={() => hasBody && setExpanded((open) => !open)}
                type="button"
            >
                <span
                    aria-hidden="true"
                    className="happy2-rig-tool__dot"
                    data-tone={tone}
                    data-happy2-ui="rig-tool-dot"
                />
                <span className="happy2-rig-tool__verb" data-happy2-ui="rig-tool-verb">
                    {verb}
                </span>
                <span className="happy2-rig-tool__text" data-happy2-ui="rig-tool-text">
                    {primaryText}
                </span>
                {stats ? (
                    <span className="happy2-rig-tool__stats" data-happy2-ui="rig-tool-stats">
                        <span className="happy2-rig-tool__added">+{stats.added}</span>
                        <span className="happy2-rig-tool__deleted">&minus;{stats.deleted}</span>
                    </span>
                ) : null}
                {hasBody ? (
                    <span aria-hidden="true" className="happy2-rig-tool__chevron">
                        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                    </span>
                ) : null}
            </button>

            {tool.permissionReview ? <PermissionReviewRow review={tool.permissionReview} /> : null}

            {genericResult !== undefined ? (
                <ChildRow tone={tool.failed ? "error" : "muted"}>{genericResult}</ChildRow>
            ) : null}

            {mcpResult ? (
                <div data-happy2-ui="rig-tool-mcp-result">
                    {mcpResult.rows.map((row, index) => (
                        <ChildRow key={index} tone={tool.failed ? "error" : "muted"}>
                            {row || "\u00a0"}
                        </ChildRow>
                    ))}
                    {mcpResult.omitted > 0 ? <ChildRow>… {mcpResult.omitted} more</ChildRow> : null}
                </div>
            ) : null}

            {expanded && hasBody ? (
                <div className="happy2-rig-tool__body" data-happy2-ui="rig-tool-body">
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
                                              className="happy2-rig-tool__diff"
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
                                      className="happy2-rig-tool__output"
                                      data-happy2-ui="rig-tool-output"
                                  >
                                      {execOutput.lines.map((line, index) => (
                                          <div className="happy2-rig-tool__output-line" key={index}>
                                              {line || "\u00a0"}
                                              {execOutput.omitted > 0 && index === headCount - 1 ? (
                                                  <div className="happy2-rig-tool__output-elide">
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
                        <div className="happy2-rig-tool__terminal">
                            {terminalInput.map((line, index) => (
                                <ChildRow key={index}>{line || "\u00a0"}</ChildRow>
                            ))}
                        </div>
                    ) : null}

                    {argsJson ? (
                        <pre className="happy2-rig-tool__args" data-happy2-ui="rig-tool-args">
                            {argsJson}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
