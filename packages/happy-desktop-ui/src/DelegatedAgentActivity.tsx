import type { CSSProperties } from "react";
import type { ConversationDelegationChild } from "happy-desktop-state";
import { elapsedTimeFormat } from "./elapsedTimeFormat";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";

export type DelegatedAgentActivityProps = {
    child: ConversationDelegationChild;
    /**
     * Reference epoch millis a running child clocks its elapsed time against.
     * The owner supplies one shared clock so no row runs a timer of its own.
     */
    now?: number;
    /** Freezes the preparing spinner on one frame for deterministic fixtures. */
    spinnerFrame?: number;
    /** Opens the selected child session. */
    onSelect?: (sessionId: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const STATUS_LABELS: Record<ConversationDelegationChild["status"], string> = {
    idle: "Idle",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    aborted: "Stopped",
    suspended: "Suspended",
    error: "Failed",
    archived: "Closed",
};

const TOKENS = new Intl.NumberFormat("en-US");

function taskLabel(child: ConversationDelegationChild): string {
    return child.taskName ?? child.description;
}

/**
 * How long this child has been working. A run still going counts up from when
 * it started against the shared clock; a settled one keeps what it recorded.
 */
function childElapsed(
    child: ConversationDelegationChild,
    now: number | undefined,
): number | undefined {
    if (child.status === "running" && child.activeSince !== undefined && now !== undefined)
        return (child.elapsedMs ?? 0) + Math.max(0, now - child.activeSince);
    return child.elapsedMs;
}

/** Compact visible state label used in the row's facts line. */
function statusLabel(status: ConversationDelegationChild["status"]): string {
    return STATUS_LABELS[status].toLocaleLowerCase("en-US");
}

/**
 * One delegated child in the same grammar as ordinary tool activity. The task
 * and model are the Agent call's arguments; elapsed and token facts sit beneath
 * them, aligned with the tool name rather than the glyph. Only a child still
 * being prepared spins.
 */
export function DelegatedAgentActivity(props: DelegatedAgentActivityProps) {
    const child = props.child;
    const preparing = child.status === "idle" || child.status === "queued";
    const elapsed = childElapsed(child, props.now);
    const status = statusLabel(child.status);
    const label = taskLabel(child);
    const className = ["happy2-delegated-agent", props.className].filter(Boolean).join(" ");
    const accessibleFacts = [
        `model ${child.modelId}`,
        STATUS_LABELS[child.status],
        ...(elapsed === undefined ? [] : [elapsedTimeFormat(elapsed)]),
        ...(child.totalTokens === undefined ? [] : [`${TOKENS.format(child.totalTokens)} tokens`]),
    ];

    return (
        <div
            className={className}
            data-happy-desktop-ui="delegated-agent"
            data-status={child.status}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <button
                aria-label={`${props.onSelect ? "Open delegated task" : "Delegated task"} ${label}, ${accessibleFacts.join(", ")}`}
                className="happy2-delegated-agent__row"
                disabled={props.onSelect === undefined}
                onClick={() => props.onSelect?.(child.sessionId)}
                type="button"
            >
                <span
                    aria-hidden="true"
                    className="happy2-delegated-agent__glyph"
                    data-happy-desktop-ui="delegated-agent-glyph"
                >
                    {preparing ? (
                        <Spinner
                            frame={props.spinnerFrame}
                            label={`Preparing ${label}`}
                            size={12}
                            tone="muted"
                            variant="circle"
                        />
                    ) : (
                        <Icon name="agents" size={12} />
                    )}
                </span>
                <span className="happy2-delegated-agent__content">
                    <span className="happy2-delegated-agent__primary">
                        <span className="happy2-delegated-agent__verb">Agent</span>
                        <span className="happy2-delegated-agent__arguments">
                            <span className="happy2-delegated-agent__task">{label}</span>
                            <span aria-hidden="true">·</span>
                            <span className="happy2-delegated-agent__model">{child.modelId}</span>
                        </span>
                    </span>
                    <span className="happy2-delegated-agent__meta">
                        <span>{status}</span>
                        {elapsed === undefined ? null : (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>{elapsedTimeFormat(elapsed)}</span>
                            </>
                        )}
                        {child.totalTokens === undefined ? null : (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>{TOKENS.format(child.totalTokens)} tokens</span>
                            </>
                        )}
                    </span>
                </span>
            </button>
        </div>
    );
}
