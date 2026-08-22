import { Fragment, type CSSProperties } from "react";

export interface HappyAgentActivityControlProps {
    readonly agents?: number;
    readonly backgroundTerminals?: number;
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly disabled?: boolean;
    readonly onClick?: () => void;
    readonly style?: CSSProperties;
}

/** Fixed height of the one-line transcript activity entry, including its row box. */
export const HAPPY_AGENT_ACTIVITY_CONTROL_TRANSCRIPT_HEIGHT = 24;

function count(value: number | undefined): number {
    return Math.max(0, Math.floor(value ?? 0));
}

function noun(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/**
 * One bounded affordance for live delegated agents and background terminals.
 * The detailed collection lives in the side panel; the transcript keeps only
 * the current live counts, as quiet trailing text on the working-status line.
 * The turn's own loader already says work is running, so this summary carries
 * no second spinner.
 */
export function HappyAgentActivityControl(props: HappyAgentActivityControlProps) {
    const agents = count(props.agents);
    const terminals = count(props.backgroundTerminals);
    if (agents + terminals === 0) return null;
    const summaryParts = [
        ...(terminals > 0 ? [{ id: "terminals", label: noun(terminals, "Terminal") }] : []),
        ...(agents > 0 ? [{ id: "agents", label: noun(agents, "Agent") }] : []),
    ];
    const fullSummary = summaryParts.map((part) => part.label).join(" · ");
    return (
        <div
            className="happy2-happy-agent-activity-transcript"
            data-happy-desktop-ui="happy-agent-activity-entry"
            style={props.style}
        >
            <button
                aria-label={`Open session details: ${fullSummary}`}
                className={["happy2-happy-agent-activity-transcript__row", props.className]
                    .filter(Boolean)
                    .join(" ")}
                data-happy-desktop-ui="happy-agent-activity-control"
                data-testid={props["data-testid"]}
                disabled={props.disabled || props.onClick === undefined}
                onClick={props.onClick}
                title={`Open session details: ${fullSummary}`}
                type="button"
            >
                <span className="happy2-happy-agent-activity-transcript__primary">
                    {summaryParts.map((part, index) => (
                        <Fragment key={part.id}>
                            {index > 0 ? (
                                <span
                                    aria-hidden="true"
                                    className="happy2-happy-agent-activity-transcript__separator"
                                >
                                    ·
                                </span>
                            ) : null}
                            <span>{part.label}</span>
                        </Fragment>
                    ))}
                </span>
            </button>
        </div>
    );
}
