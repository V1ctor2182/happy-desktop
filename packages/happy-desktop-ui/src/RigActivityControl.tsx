import { type CSSProperties } from "react";

export interface RigActivityControlProps {
    readonly agents?: number;
    readonly backgroundTerminals?: number;
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly disabled?: boolean;
    readonly hasGoal?: boolean;
    readonly onClick?: () => void;
    readonly open?: boolean;
    readonly style?: CSSProperties;
    readonly tasks?: number;
}

function count(value: number | undefined): number {
    return Math.max(0, Math.floor(value ?? 0));
}

function noun(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/**
 * One bounded composer-footer affordance for an unbounded session activity list.
 *
 * Tasks, delegated agents, and background terminals can each number in the
 * dozens. Their detailed rows live in the capped shared activity panel; this
 * trigger remains one compact control however those collections are composed.
 */
export function RigActivityControl(props: RigActivityControlProps) {
    const tasks = count(props.tasks);
    const agents = count(props.agents);
    const terminals = count(props.backgroundTerminals);
    const goals = props.hasGoal ? 1 : 0;
    const total = goals + tasks + agents + terminals;
    if (total === 0 && !props.open) return null;
    const fullSummary = [
        goals > 0 ? "1 goal" : undefined,
        tasks > 0 ? noun(tasks, "task") : undefined,
        agents > 0 ? noun(agents, "agent") : undefined,
        terminals > 0 ? noun(terminals, "terminal") : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <button
            aria-expanded={props.open}
            aria-label={`Session activity: ${fullSummary || "none"}`}
            className={["happy2-rig-activity-control", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-activity-control"
            data-open={props.open ? "" : undefined}
            data-testid={props["data-testid"]}
            disabled={props.disabled || props.onClick === undefined}
            onClick={props.onClick}
            style={props.style}
            title={fullSummary || "Session activity"}
            type="button"
        >
            <span
                className="happy2-rig-activity-control__summary"
                data-happy-desktop-ui="rig-activity-control-summary"
            >
                Activity
                <span className="happy2-rig-activity-control__count">
                    {total > 99 ? "99+" : total}
                </span>
            </span>
        </button>
    );
}
