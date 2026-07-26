import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
export type AgentTraceRowKind =
    | "reasoning"
    | "response"
    | "tool"
    | "subagent"
    | "terminal"
    | "status";
export type AgentTraceRowStatus = "running" | "complete" | "failed";
export interface AgentTraceRowProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    readonly status: AgentTraceRowStatus;
    /** Latest meaningful activity while running. */
    readonly kind?: AgentTraceRowKind;
    readonly title?: string;
    readonly detail?: string;
    readonly entryCount: number;
    /** Tool invocations when known (shown beside “View traces” in the message meta row). */
    readonly toolCallCount?: number;
    /** Turn token total when the producer reports it. */
    readonly totalTokens?: number;
    /** Subagents working under this turn right now. */
    readonly subagentCount?: number;
    /** Background terminals this turn currently has running. */
    readonly terminalCount?: number;
    /** How long the turn has been running, from the owner's clock. */
    readonly elapsedMs?: number;
    /** The trace panel is currently showing this turn. */
    readonly open?: boolean;
    readonly onOpen?: () => void;
    /**
     * Clicking closes the trace again rather than opening a panel, so an open row
     * offers to hide it. Owners that only ever open a panel leave this off.
     */
    readonly toggles?: boolean;
    /** Accessible name, default "Agent activity". */
    readonly label?: string;
    /** A compact metadata link placed beside an assistant name. */
    readonly variant?: "meta" | "row";
}
const KIND_ICONS: Record<AgentTraceRowKind, IconName> = {
    reasoning: "spark",
    response: "check-circle",
    tool: "terminal",
    subagent: "branch",
    terminal: "terminal",
    status: "check-circle",
};
/** Existing Icon glyph for a trace activity kind (shared with AgentTracePanel). */
export function agentTraceKindIcon(kind: AgentTraceRowKind): IconName {
    return KIND_ICONS[kind];
}

function formatTokenCount(value: number): string {
    if (value >= 1_000_000) {
        const scaled = value / 1_000_000;
        return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
    if (value >= 1_000) {
        const scaled = value / 1_000;
        return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}k`;
    }
    return String(value);
}

/** m:ss for a running turn; anything past an hour keeps counting in minutes. */
function formatElapsed(elapsedMs: number): string {
    const total = Math.max(0, Math.floor(elapsedMs / 1_000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * What a running turn reports beside its latest step: the work it has fanned out
 * (subagents, background terminals), what it has spent, and how long it has been
 * at it. Each part appears only once the turn actually has it, so a plain turn
 * stays a plain line.
 */
function runningStats(props: {
    subagentCount?: number;
    terminalCount?: number;
    totalTokens?: number;
    elapsedMs?: number;
}): string | undefined {
    const parts: string[] = [];
    const agents = props.subagentCount ?? 0;
    const terminals = props.terminalCount ?? 0;
    if (agents > 0) parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
    if (terminals > 0) parts.push(`${terminals} ${terminals === 1 ? "process" : "processes"}`);
    if (props.totalTokens !== undefined && props.totalTokens > 0)
        parts.push(`${formatTokenCount(props.totalTokens)} tokens`);
    if (props.elapsedMs !== undefined) parts.push(formatElapsed(props.elapsedMs));
    return parts.length > 0 ? parts.join(" · ") : undefined;
}

function metaStats(toolCallCount?: number, totalTokens?: number): string | undefined {
    const parts: string[] = [];
    if (toolCallCount !== undefined && toolCallCount > 0)
        parts.push(`${toolCallCount} ${toolCallCount === 1 ? "tool" : "tools"}`);
    if (totalTokens !== undefined && totalTokens > 0)
        parts.push(`${formatTokenCount(totalTokens)} tokens`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
}
/**
 * C-067 AgentTraceRow — a compact, single-line 28px button row rendered inside
 * an assistant message. While the turn runs it shows only the latest activity:
 * a static accent dot (no animation), the kind glyph, a title, and mono detail
 * when that detail is not already visible elsewhere — no counter churn. Once
 * the turn completes or fails it reads as a "View traces" link row with the
 * step count — "Hide traces" while open, when the owner made it a toggle.
 * Clicking fires `onOpen`; `aria-expanded` reflects whether the trace is
 * currently shown. Props only — no local state, timers,
 * or animation.
 */
export function AgentTraceRow(props: AgentTraceRowProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "status",
        "kind",
        "title",
        "detail",
        "entryCount",
        "toolCallCount",
        "totalTokens",
        "subagentCount",
        "terminalCount",
        "elapsedMs",
        "open",
        "onOpen",
        "toggles",
        "label",
        "variant",
    ]);
    const running = () => local.status === "running";
    const meta = () => local.variant === "meta";
    const stats = () => metaStats(local.toolCallCount, local.totalTokens);
    const live = () =>
        runningStats({
            subagentCount: local.subagentCount,
            terminalCount: local.terminalCount,
            totalTokens: local.totalTokens,
            elapsedMs: local.elapsedMs,
        });
    const linkLabel = () => (local.toggles && local.open ? "Hide traces" : "View traces");
    return (
        <button
            aria-expanded={local.open === true ? "true" : "false"}
            aria-label={
                local.label ??
                (meta() && stats()
                    ? `${linkLabel()}, ${stats()}`
                    : meta()
                      ? linkLabel()
                      : "Agent activity")
            }
            className={["happy2-agent-trace-row", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="agent-trace-row"
            data-status={local.status}
            data-variant={meta() ? "meta" : "row"}
            data-testid={local["data-testid"]}
            onClick={() => local.onOpen?.()}
            style={local.style}
            type="button"
        >
            <span
                aria-hidden="true"
                className="happy2-agent-trace-row__dot"
                data-happy2-ui="agent-trace-row-dot"
            />
            {!meta() && running() && local.kind !== undefined
                ? ((kind) => (
                      <span
                          aria-hidden="true"
                          className="happy2-agent-trace-row__icon"
                          data-happy2-ui="agent-trace-row-icon"
                      >
                          <Icon name={agentTraceKindIcon(kind)} size={14} />
                      </span>
                  ))(local.kind)
                : null}
            <span className="happy2-agent-trace-row__title" data-happy2-ui="agent-trace-row-title">
                {meta() ? linkLabel() : running() ? (local.title ?? "Working") : linkLabel()}
            </span>
            {meta() && stats() ? (
                <span
                    className="happy2-agent-trace-row__meta-stats"
                    data-happy2-ui="agent-trace-row-meta-stats"
                >
                    {stats()}
                </span>
            ) : null}
            {!meta() && running() && local.detail !== undefined ? (
                <span
                    className="happy2-agent-trace-row__detail"
                    data-happy2-ui="agent-trace-row-detail"
                >
                    {local.detail}
                </span>
            ) : null}
            {!meta() && running() && live() ? (
                <span
                    className="happy2-agent-trace-row__stats"
                    data-happy2-ui="agent-trace-row-stats"
                >
                    {live()}
                </span>
            ) : null}
            {!meta() && !running() ? (
                <span
                    className="happy2-agent-trace-row__count"
                    data-happy2-ui="agent-trace-row-count"
                >
                    {`${local.entryCount} steps`}
                </span>
            ) : null}
        </button>
    );
}
