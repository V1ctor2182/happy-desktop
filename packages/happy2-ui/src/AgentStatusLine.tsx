import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
export interface AgentStatusLineProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** How long the turn has been running, from the owner's clock. */
    readonly elapsedMs?: number;
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
 * C-072 AgentStatusLine — the one quiet line a working agent turn keeps under
 * the transcript: how long it has been at it, how far it has fanned out, what
 * it has spent. It deliberately never names the tool it is running; the steps
 * above it already say that, and a line that rewrites itself on every call
 * reads as noise. Everything is left-aligned in one mono run, so the row is
 * scanned as a status, not as another message.
 *
 * A readout, not a control: no border, no dot, no accent, no hover. Props only
 * — the owner supplies elapsed time from its own clock, so the component owns
 * no timer, state, or animation.
 */
export function AgentStatusLine(props: AgentStatusLineProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "elapsedMs",
        "agents",
        "processes",
        "tokens",
    ]);
    // Order of growth: what the turn is doing, then how wide it went, then what
    // it cost. Every part after the first appears only once the turn has it.
    const parts: string[] = [
        local.elapsedMs === undefined ? "Working" : `Working ${formatElapsed(local.elapsedMs)}`,
    ];
    if (local.agents !== undefined && local.agents > 0)
        parts.push(`${local.agents} ${local.agents === 1 ? "agent" : "agents"}`);
    if (local.processes !== undefined && local.processes > 0)
        parts.push(`${local.processes} ${local.processes === 1 ? "process" : "processes"}`);
    if (local.tokens !== undefined && local.tokens > 0)
        parts.push(`${formatTokens(local.tokens)} tokens`);
    return (
        <div
            aria-live="polite"
            className={["happy2-agent-status-line", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="agent-status-line"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <span
                className="happy2-agent-status-line__state"
                data-happy2-ui="agent-status-line-state"
            >
                {parts[0]}
            </span>
            {parts.length > 1 ? (
                <span
                    className="happy2-agent-status-line__stats"
                    data-happy2-ui="agent-status-line-stats"
                >
                    {parts.slice(1).join("  ·  ")}
                </span>
            ) : null}
        </div>
    );
}
