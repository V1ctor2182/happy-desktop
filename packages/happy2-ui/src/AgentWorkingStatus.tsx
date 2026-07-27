import { type CSSProperties } from "react";
import { partitionComponentProps } from "./componentProps";
import { Spinner } from "./Spinner";

export interface AgentWorkingStatusProps {
    /** Paints the status without changing its stable layout slot or DOM identity. */
    readonly active?: boolean;
    readonly agents?: number;
    readonly backgroundTasks?: number;
    readonly className?: string;
    readonly "data-testid"?: string;
    /** Elapsed time from request send, supplied by the owning surface clock. */
    readonly elapsedMs?: number;
    readonly style?: CSSProperties;
}

/** Fixed virtualized row height, including the status's 4px leading clearance. */
export const AGENT_WORKING_STATUS_ROW_HEIGHT = 36;

/** Formats an active turn duration without allowing its units to split across lines. */
function elapsedFormat(elapsedMs: number): string {
    const total = Math.max(0, Math.floor(elapsedMs / 1_000));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}m\u00a0${total % 60}s`;
    return `${Math.floor(minutes / 60)}h\u00a0${minutes % 60}m`;
}

/** Live footer for one active agent turn: clock, running agents, and background work. */
export function AgentWorkingStatus(props: AgentWorkingStatusProps) {
    const [local] = partitionComponentProps(props, [
        "active",
        "agents",
        "backgroundTasks",
        "className",
        "data-testid",
        "elapsedMs",
        "style",
    ]);
    const details: string[] = [];
    if (local.agents !== undefined && local.agents > 0)
        details.push(`${local.agents} ${local.agents === 1 ? "agent" : "agents"} running`);
    if (local.backgroundTasks !== undefined && local.backgroundTasks > 0)
        details.push(
            `${local.backgroundTasks} background ${local.backgroundTasks === 1 ? "task" : "tasks"}`,
        );
    return (
        <div
            aria-hidden={local.active === false ? "true" : undefined}
            aria-live={local.active === false ? undefined : "polite"}
            className={["happy2-agent-working-status", local.className].filter(Boolean).join(" ")}
            data-active={local.active === false ? undefined : ""}
            data-happy2-ui="agent-working-status"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <Spinner
                className="happy2-agent-working-status__spinner"
                label="Working"
                size={14}
                tone="muted"
                variant="braille-2"
            />
            <span
                className="happy2-agent-working-status__state"
                data-happy2-ui="agent-working-status-state"
            >
                {local.elapsedMs === undefined
                    ? "Working"
                    : `Working for\u00a0${elapsedFormat(local.elapsedMs)}`}
            </span>
            {details.length > 0 ? (
                <span
                    className="happy2-agent-working-status__details"
                    data-happy2-ui="agent-working-status-details"
                >
                    {details.join("  ·  ")}
                </span>
            ) : null}
        </div>
    );
}
