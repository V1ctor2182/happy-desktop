import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { Spinner } from "./Spinner";
export type AgentStatusLineStatus = "running" | "complete" | "failed";
export interface AgentStatusLineProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /**
     * `running` is the live footer (braille spinner + ticking clock). `complete`
     * and `failed` are permanent transcript rows after the turn settles: same
     * quiet line, no spinner, with how long the turn took and how many tools it
     * used.
     */
    readonly status?: AgentStatusLineStatus;
    /**
     * Elapsed span for the turn. While running this is the live clock from when
     * the request was sent; once settled it is the final duration.
     */
    readonly elapsedMs?: number;
    /** Tool invocations the turn made (settled rows; optional while running). */
    readonly tools?: number;
    /** Subagents working under this turn. */
    readonly agents?: number;
    /** Background processes this turn has running. */
    readonly processes?: number;
    /** Tokens the turn has spent so far. */
    readonly tokens?: number;
}
/** 999 stays plain, 1.2k under ten thousand, 12k beyond, 1.2M past a million. */
function formatTokens(value: number): string {
    const whole = Math.max(0, Math.trunc(value));
    if (whole < 1_000) return String(whole);
    const scale = whole < 1_000_000 ? 1_000 : 1_000_000;
    const suffix = scale === 1_000 ? "k" : "M";
    const scaled = whole / scale;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/u, "")}${suffix}`;
}
/** Seconds while a turn is short, then minutes and seconds, the way a CLI counts. */
function formatElapsed(elapsedMs: number): string {
    const total = Math.max(0, Math.floor(elapsedMs / 1_000));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}m ${total % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
/**
 * C-072 AgentStatusLine — the quiet mono line a turn keeps under its work.
 *
 * While running it is the transcript footer: a braille spinner and the elapsed
 * clock from when the request was sent (before the first token), plus any live
 * fan-out. Once the turn settles the same line becomes a permanent row under
 * that turn — no spinner, the final duration, and how many tools it used.
 *
 * A readout, not a control: no border, no accent, no hover. Props only — the
 * owner supplies elapsed time from its own clock, so the component owns no
 * timer or local state. The spinner is pure CSS.
 */
export function AgentStatusLine(props: AgentStatusLineProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "status",
        "elapsedMs",
        "tools",
        "agents",
        "processes",
        "tokens",
    ]);
    const status = local.status ?? "running";
    const running = status === "running";
    const duration = local.elapsedMs === undefined ? undefined : formatElapsed(local.elapsedMs);
    // Running: "Working 1m 32s". Settled: "Done in 1m 32s" / "Failed after 1m 32s".
    const state = running
        ? duration === undefined
            ? "Working"
            : `Working ${duration}`
        : duration === undefined
          ? status === "failed"
              ? "Failed"
              : "Done"
          : status === "failed"
            ? `Failed after ${duration}`
            : `Done in ${duration}`;
    const stats: string[] = [];
    if (!running && local.tools !== undefined && local.tools > 0)
        stats.push(`${local.tools} ${local.tools === 1 ? "tool" : "tools"}`);
    if (local.agents !== undefined && local.agents > 0)
        stats.push(`${local.agents} ${local.agents === 1 ? "agent" : "agents"}`);
    if (local.processes !== undefined && local.processes > 0)
        stats.push(`${local.processes} ${local.processes === 1 ? "process" : "processes"}`);
    if (local.tokens !== undefined && local.tokens > 0)
        stats.push(`${formatTokens(local.tokens)} tokens`);
    return (
        <div
            aria-live={running ? "polite" : undefined}
            className={["happy2-agent-status-line", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="agent-status-line"
            data-status={status}
            data-testid={local["data-testid"]}
            style={local.style}
        >
            {running ? (
                <Spinner
                    className="happy2-agent-status-line__spinner"
                    label="Working"
                    size={12}
                    tone="muted"
                    variant="braille-2"
                />
            ) : null}
            <span
                className="happy2-agent-status-line__state"
                data-happy2-ui="agent-status-line-state"
            >
                {state}
            </span>
            {stats.length > 0 ? (
                <span
                    className="happy2-agent-status-line__stats"
                    data-happy2-ui="agent-status-line-stats"
                >
                    {stats.join("  ·  ")}
                </span>
            ) : null}
        </div>
    );
}
