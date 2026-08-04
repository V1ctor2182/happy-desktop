import type { CSSProperties } from "react";
import type {
    RigBackgroundProcess,
    RigGoal,
    RigGoalStatus,
    RigSessionStatus,
    RigSubagentSummary,
    RigTask,
    RigTaskStatus,
} from "happy-desktop-state";

export type RigActivityPanelProps = {
    /** The session's persistent goal, when one is set (`/goal`). */
    goal?: RigGoal;
    /** The session task list in display order (`/tasks`). */
    tasks: readonly RigTask[];
    /** Delegated subagents for the live monitor (`/agents`). */
    subagents: readonly RigSubagentSummary[];
    /** Running background terminals (`/ps`). */
    backgroundProcesses: readonly RigBackgroundProcess[];
    /** Requests termination of one background terminal (`/stop`); omit to hide the control. */
    onBackgroundProcessStop?: (processId: number) => void;
    /** Reference "now" (epoch millis) for computing subagent elapsed time. */
    now: number;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const GOAL_STATUS_LABELS: Record<RigGoalStatus, string> = {
    active: "Active",
    blocked: "Blocked",
    complete: "Complete",
    paused: "Paused",
};

const TASK_STATUS_LABELS: Record<RigTaskStatus, string> = {
    pending: "Pending",
    in_progress: "In progress",
    completed: "Completed",
};

// Mirrors the TUI `humanizeSubagentStatus` mapping from session status.
const SUBAGENT_STATUS_LABELS: Record<RigSessionStatus, string> = {
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

/** Formats a running subagent's elapsed span as a compact `m:ss`/`h:mm:ss`. */
function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const two = (value: number) => value.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function GoalSection(props: { goal: RigGoal }) {
    const { goal } = props;
    return (
        <section className="happy2-rig-activity__section" data-happy-desktop-ui="rig-activity-goal">
            <h3 className="happy2-rig-activity__heading">Goal</h3>
            <div className="happy2-rig-activity__goal">
                <span
                    className="happy2-rig-activity__status"
                    data-status={goal.status}
                    data-happy-desktop-ui="rig-activity-goal-status"
                >
                    {GOAL_STATUS_LABELS[goal.status]}
                </span>
                <p className="happy2-rig-activity__objective">{goal.objective}</p>
            </div>
        </section>
    );
}

function TaskRow(props: { task: RigTask }) {
    const { task } = props;
    const label = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
    return (
        <li className="happy2-rig-activity__task" data-happy-desktop-ui="rig-activity-task">
            <span
                className="happy2-rig-activity__status"
                data-status={task.status}
                data-happy-desktop-ui="rig-activity-task-status"
            >
                {TASK_STATUS_LABELS[task.status]}
            </span>
            <span className="happy2-rig-activity__task-label">{label}</span>
        </li>
    );
}

function SubagentRow(props: { subagent: RigSubagentSummary; now: number }) {
    const { subagent, now } = props;
    const elapsed =
        subagent.elapsedMs ??
        (subagent.activeSince !== undefined ? now - subagent.activeSince : undefined);
    return (
        <li className="happy2-rig-activity__subagent" data-happy-desktop-ui="rig-activity-subagent">
            <div className="happy2-rig-activity__subagent-head">
                <span
                    className="happy2-rig-activity__status"
                    data-status={subagent.status}
                    data-happy-desktop-ui="rig-activity-subagent-status"
                >
                    {SUBAGENT_STATUS_LABELS[subagent.status]}
                </span>
                <span className="happy2-rig-activity__subagent-desc">
                    {subagent.taskName ?? subagent.description}
                </span>
            </div>
            <div className="happy2-rig-activity__subagent-meta">
                <span className="happy2-rig-activity__subagent-model">{subagent.modelId}</span>
                {elapsed !== undefined && elapsed >= 0 ? (
                    <span className="happy2-rig-activity__subagent-elapsed">
                        {formatElapsed(elapsed)}
                    </span>
                ) : null}
                {subagent.totalTokens !== undefined ? (
                    <span className="happy2-rig-activity__subagent-tokens">
                        {TOKENS.format(subagent.totalTokens)} tokens
                    </span>
                ) : null}
            </div>
            {subagent.latestText ? (
                <p className="happy2-rig-activity__subagent-latest">{subagent.latestText}</p>
            ) : null}
        </li>
    );
}

function BackgroundProcessRow(props: {
    process: RigBackgroundProcess;
    onStop?: (processId: number) => void;
}) {
    const { process } = props;
    return (
        <li className="happy2-rig-activity__process" data-happy-desktop-ui="rig-activity-process">
            <span
                className="happy2-rig-activity__status"
                data-status="running"
                data-happy-desktop-ui="rig-activity-process-status"
            >
                Running
            </span>
            <span className="happy2-rig-activity__process-command">{process.command}</span>
            {props.onStop ? (
                <button
                    type="button"
                    className="happy2-rig-activity__process-stop"
                    data-happy-desktop-ui="rig-activity-process-stop"
                    onClick={() => props.onStop?.(process.id)}
                >
                    Stop
                </button>
            ) : null}
        </li>
    );
}

/**
 * RigActivityPanel — the read-only session activity monitor combining the TUI's
 * `/goal`, `/tasks`, `/agents`, and `/ps` views: the persistent goal with its
 * status, the task list, the delegated-subagent monitor with status/elapsed/tokens/
 * latest text, and running background terminals. Every value flows from the reactive
 * session snapshot (reconciled from `tasks_changed`/`goal_changed`/`subagent_changed`/
 * `background_processes_changed` SSE events), so this component holds no state and
 * starts no work — it only projects the props it is given.
 */
export function RigActivityPanel(props: RigActivityPanelProps) {
    const { goal, tasks, subagents, backgroundProcesses } = props;
    const empty =
        goal === undefined &&
        tasks.length === 0 &&
        subagents.length === 0 &&
        backgroundProcesses.length === 0;
    return (
        <section
            className={["happy2-rig-activity", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-activity-panel"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {empty ? (
                <p
                    className="happy2-rig-activity__empty"
                    data-happy-desktop-ui="rig-activity-empty"
                >
                    No goal, tasks, or subagents for this session yet.
                </p>
            ) : (
                <>
                    {goal ? <GoalSection goal={goal} /> : null}

                    {tasks.length > 0 ? (
                        <section
                            className="happy2-rig-activity__section"
                            data-happy-desktop-ui="rig-activity-tasks"
                        >
                            <h3 className="happy2-rig-activity__heading">
                                Tasks
                                <span className="happy2-rig-activity__count">{tasks.length}</span>
                            </h3>
                            <ul className="happy2-rig-activity__list">
                                {tasks.map((task) => (
                                    <TaskRow key={task.id} task={task} />
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {subagents.length > 0 ? (
                        <section
                            className="happy2-rig-activity__section"
                            data-happy-desktop-ui="rig-activity-subagents"
                        >
                            <h3 className="happy2-rig-activity__heading">
                                Subagents
                                <span className="happy2-rig-activity__count">
                                    {subagents.length}
                                </span>
                            </h3>
                            <ul className="happy2-rig-activity__list">
                                {subagents.map((subagent) => (
                                    <SubagentRow
                                        key={subagent.id}
                                        now={props.now}
                                        subagent={subagent}
                                    />
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {backgroundProcesses.length > 0 ? (
                        <section
                            className="happy2-rig-activity__section"
                            data-happy-desktop-ui="rig-activity-processes"
                        >
                            <h3 className="happy2-rig-activity__heading">
                                Background terminals
                                <span className="happy2-rig-activity__count">
                                    {backgroundProcesses.length}
                                </span>
                            </h3>
                            <ul className="happy2-rig-activity__list">
                                {backgroundProcesses.map((process) => (
                                    <BackgroundProcessRow
                                        key={process.id}
                                        process={process}
                                        onStop={props.onBackgroundProcessStop}
                                    />
                                ))}
                            </ul>
                        </section>
                    ) : null}
                </>
            )}
        </section>
    );
}
