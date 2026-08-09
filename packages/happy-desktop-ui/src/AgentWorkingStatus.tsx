import { type CSSProperties } from "react";
import { partitionComponentProps } from "./componentProps";
import { ShimmerText } from "./ShimmerText";
import { Spinner } from "./Spinner";
import { TypedText } from "./TypedText";
import { WaitRing, waitFinishDateLabel, waitRemainingLabel } from "./WaitRing";

export type AgentWorkingPhase =
    | "waiting"
    | "working"
    | "thinking"
    | "generatingTools"
    | "callingTools"
    | "texting";

export interface AgentWorkingStatusProps {
    /** Paints the status without changing its stable layout slot or DOM identity. */
    readonly active?: boolean;
    /** The turn is blocked on a structured answer, so no work animation is shown. */
    readonly awaitingInput?: boolean;
    readonly className?: string;
    readonly "data-testid"?: string;
    /** Elapsed time from request send, supplied by the owning surface clock. */
    readonly elapsedMs?: number;
    /**
     * Humanized activity text from the agent, shown instead of the phase word.
     * Falls back to the phase label when the agent says nothing about its work.
     */
    readonly label?: string;
    /**
     * `typewriter` (default) retypes the phase word when it changes; `calm`
     * changes it in place under one continuous shimmer.
     */
    readonly motion?: "typewriter" | "calm";
    /** Current work projected by the owning product store. */
    readonly phase?: AgentWorkingPhase;
    /**
     * The scheduled wait this turn is sitting inside, measured against the
     * owning surface's clock. While one is running it replaces the spinner, the
     * agent's own "waiting until <time>" label, and the turn clock: a reader
     * watching a wait wants how much longer, not three numbers to subtract.
     */
    readonly wait?: AgentWaitStatus;
    readonly style?: CSSProperties;
}

/** One scheduled wait, as both of its ends plus the clock it is measured against. */
export interface AgentWaitStatus {
    /** Epoch ms the wait began at. */
    readonly startedAt: number;
    /** Epoch ms the wait ends at. */
    readonly dueAt: number;
    /** Current time from the owning surface's clock. */
    readonly now: number;
}

/** Fixed virtualized row height, including the status's 4px leading clearance. */
export const AGENT_WORKING_STATUS_ROW_HEIGHT = 36;

const PHASE_LABELS: Readonly<Record<AgentWorkingPhase, string>> = {
    waiting: "Waiting for model",
    working: "Working",
    thinking: "Thinking",
    generatingTools: "Generating tools",
    callingTools: "Calling tools",
    texting: "Texting",
};

/** Formats the active turn clock in the smallest useful human-readable units. */
function elapsedFormat(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/** The phase word a scheduled wait shows in place of "Thinking". */
function waitLabel(wait: AgentWaitStatus): string {
    const remaining = wait.dueAt - wait.now;
    return remaining > 0 ? `Wait for ${waitRemainingLabel(remaining)}` : "Wait ending";
}

/** Live footer for one active agent turn: loader, elapsed clock, and phase. */
export function AgentWorkingStatus(props: AgentWorkingStatusProps) {
    const [local] = partitionComponentProps(props, [
        "active",
        "awaitingInput",
        "className",
        "data-testid",
        "elapsedMs",
        "label",
        "motion",
        "phase",
        "style",
        "wait",
    ]);
    const label = local.label ?? PHASE_LABELS[local.phase ?? "working"];
    return (
        <div
            aria-hidden={local.active === false ? "true" : undefined}
            aria-live={local.active === false ? undefined : "polite"}
            className={["happy2-agent-working-status", local.className].filter(Boolean).join(" ")}
            data-active={local.active === false ? undefined : ""}
            data-awaiting-input={local.awaitingInput ? "" : undefined}
            data-happy-desktop-ui="agent-working-status"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <span
                className="happy2-agent-working-status__state"
                data-happy-desktop-ui="agent-working-status-state"
            >
                {local.awaitingInput ? (
                    <span
                        className="happy2-agent-working-status__phase"
                        data-happy-desktop-ui="agent-working-status-phase"
                    >
                        Waiting for answer
                    </span>
                ) : (
                    <>
                        {/* A wait takes the loader's box, because the share of a
                            known interval already spent is the honest version
                            of the same glyph. */}
                        {local.wait ? (
                            <WaitRing
                                className="happy2-agent-working-status__ring"
                                finishAt={local.wait.dueAt}
                                now={local.wait.now}
                                size={14}
                                startedAt={local.wait.startedAt}
                            />
                        ) : (
                            <Spinner
                                className="happy2-agent-working-status__spinner"
                                label={label}
                                size={14}
                                tone="muted"
                                variant="braille-2"
                            />
                        )}
                        {local.elapsedMs === undefined ? null : (
                            <>
                                <span
                                    className="happy2-agent-working-status__timer"
                                    data-happy-desktop-ui="agent-working-status-timer"
                                >
                                    {elapsedFormat(local.elapsedMs)}
                                </span>
                                <span
                                    aria-hidden="true"
                                    className="happy2-agent-working-status__separator"
                                >
                                    ·
                                </span>
                            </>
                        )}
                        {local.wait ? (
                            <span
                                className="happy2-agent-working-status__phase"
                                data-happy-desktop-ui="agent-working-status-phase"
                                title={`Until ${waitFinishDateLabel(local.wait.dueAt)}`}
                            >
                                {waitLabel(local.wait)}
                            </span>
                        ) : (
                            <span
                                className="happy2-agent-working-status__phase"
                                data-happy-desktop-ui="agent-working-status-phase-slot"
                            >
                                {local.motion === "calm" ? (
                                    <ShimmerText
                                        data-happy-desktop-ui="agent-working-status-phase"
                                        sweep="sheen"
                                        tone="muted"
                                    >
                                        {label}
                                    </ShimmerText>
                                ) : (
                                    <TypedText
                                        data-happy-desktop-ui="agent-working-status-phase"
                                        value={label}
                                    />
                                )}
                            </span>
                        )}
                    </>
                )}
            </span>
        </div>
    );
}
