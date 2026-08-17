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
import { Button } from "./Button";
<<<<<<< HEAD
=======
import { CompactActivityRow } from "./CompactActivityRow";
import { DelegatedAgentActivity } from "./DelegatedAgentActivity";
import { Icon } from "./Icon";
>>>>>>> 777abca6 (Add workspace shortcuts and organize activity)

export type RigActivityPanelProps = {
    /** Opens the native Completed disclosure on its first render; omitted is closed. */
    completedInitiallyOpen?: boolean;
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
    /** Opens one delegated child session through the owning workspace. */
    onSubagentSelect?: (sessionId: string) => void;
    /** Reference "now" (epoch millis) for computing subagent elapsed time. */
    now: number;
    /** `panel` fills and scrolls a side-panel tab; the default is inline content. */
    placement?: "content" | "panel";
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

<<<<<<< HEAD
/** Formats a running subagent's elapsed span as a compact `m:ss`/`h:mm:ss`. */
function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const two = (value: number) => value.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function ActivityStatus(props: {
    label: string;
    status: RigGoalStatus | RigTaskStatus | RigSessionStatus | "running";
    part: string;
}) {
    return (
        <span
            className="happy2-rig-activity__status"
            data-status={props.status}
            data-happy-desktop-ui={props.part}
        >
            <span
                aria-hidden="true"
                className="happy2-rig-activity__status-dot"
                data-happy-desktop-ui="rig-activity-status-dot"
            />
            {props.label}
        </span>
    );
}

=======
>>>>>>> 777abca6 (Add workspace shortcuts and organize activity)
function SectionHeading(props: { count?: number; label: string }) {
    return (
        <h3 className="happy2-rig-activity__heading">
            <span
                className="happy2-rig-activity__heading-label"
                data-happy-desktop-ui="rig-activity-heading-label"
            >
                {props.label}
            </span>
            {props.count === undefined ? null : (
                <span className="happy2-rig-activity__count">{props.count}</span>
            )}
        </h3>
    );
}

function GoalSection(props: { goal: RigGoal }) {
    const { goal } = props;
    return (
        <section className="happy2-rig-activity__section" data-happy-desktop-ui="rig-activity-goal">
            <SectionHeading label="Goal" />
            <div className="happy2-rig-activity__list" data-happy-desktop-ui="rig-activity-list">
                <div className="happy2-rig-activity__row" data-happy-desktop-ui="rig-activity-row">
                    <ActivityStatus
                        label={GOAL_STATUS_LABELS[goal.status]}
                        part="rig-activity-goal-status"
                        status={goal.status}
                    />
                    <p className="happy2-rig-activity__objective">{goal.objective}</p>
                </div>
            </div>
        </section>
    );
}

function TaskRow(props: { task: RigTask }) {
    const { task } = props;
    const label = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
    return (
        <li
            className="happy2-rig-activity__row happy2-rig-activity__task"
            data-happy-desktop-ui="rig-activity-task"
        >
            <ActivityStatus
                label={TASK_STATUS_LABELS[task.status]}
                part="rig-activity-task-status"
                status={task.status}
            />
            <span className="happy2-rig-activity__task-label">{label}</span>
        </li>
    );
}

function SubagentRow(props: {
    subagent: RigSubagentSummary;
    now: number;
    onSelect?: (sessionId: string) => void;
}) {
    const { subagent, now } = props;
    const elapsed =
        subagent.elapsedMs ??
        (subagent.activeSince !== undefined ? now - subagent.activeSince : undefined);
    return (
<<<<<<< HEAD
        <li
            className="happy2-rig-activity__row happy2-rig-activity__subagent"
            data-happy-desktop-ui="rig-activity-subagent"
        >
            <ActivityStatus
                label={SUBAGENT_STATUS_LABELS[subagent.status]}
                part="rig-activity-subagent-status"
                status={subagent.status}
=======
        <li className="happy2-rig-activity__subagent" data-happy-desktop-ui="rig-activity-subagent">
            <DelegatedAgentActivity
                child={{
                    sessionId: subagent.id,
                    description: subagent.description,
                    ...(subagent.taskName === undefined ? {} : { taskName: subagent.taskName }),
                    modelId: subagent.modelId,
                    status: subagent.status,
                    ...(subagent.activeSince === undefined
                        ? {}
                        : { activeSince: subagent.activeSince }),
                    ...(subagent.elapsedMs === undefined ? {} : { elapsedMs: subagent.elapsedMs }),
                    ...(subagent.totalTokens === undefined
                        ? {}
                        : { totalTokens: subagent.totalTokens }),
                }}
                completedLabel="Done"
                now={now}
                onSelect={props.onSelect}
                placement="panel"
>>>>>>> 777abca6 (Add workspace shortcuts and organize activity)
            />
            <div className="happy2-rig-activity__subagent-content">
                <span className="happy2-rig-activity__subagent-desc">
                    {subagent.taskName ?? subagent.description}
                </span>
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
            </div>
        </li>
    );
}

function BackgroundProcessRow(props: {
    process: RigBackgroundProcess;
    onStop?: (processId: number) => void;
}) {
    const { process } = props;
    return (
        <li
            className="happy2-rig-activity__row happy2-rig-activity__process"
            data-happy-desktop-ui="rig-activity-process"
        >
            <ActivityStatus label="Running" part="rig-activity-process-status" status="running" />
            <span className="happy2-rig-activity__process-command">{process.command}</span>
            {props.onStop ? (
                <span
                    className="happy2-rig-activity__process-stop"
                    data-happy-desktop-ui="rig-activity-process-stop"
                >
                    <Button onClick={() => props.onStop?.(process.id)} size="small" variant="ghost">
                        Stop
                    </Button>
                </span>
            ) : null}
        </li>
    );
}

function AgentSection(props: {
    agents: readonly RigSubagentSummary[];
    now: number;
    onSelect?: (sessionId: string) => void;
}) {
    if (props.agents.length === 0) return null;
    return (
        <section
            className="happy2-rig-activity__section"
            data-happy-desktop-ui="rig-activity-subagents"
        >
            <SectionHeading count={props.agents.length} label="Agents" />
            <ul className="happy2-rig-activity__list" data-happy-desktop-ui="rig-activity-list">
                {props.agents.map((subagent) => (
                    <SubagentRow
                        key={subagent.id}
                        now={props.now}
                        onSelect={props.onSelect}
                        subagent={subagent}
                    />
                ))}
            </ul>
        </section>
    );
}

function TerminalSection(props: {
    processes: readonly RigBackgroundProcess[];
    onStop?: (processId: number) => void;
}) {
    if (props.processes.length === 0) return null;
    return (
        <section
            className="happy2-rig-activity__section"
            data-happy-desktop-ui="rig-activity-processes"
        >
            <SectionHeading count={props.processes.length} label="Terminals" />
            <ul className="happy2-rig-activity__list" data-happy-desktop-ui="rig-activity-list">
                {props.processes.map((process) => (
                    <BackgroundProcessRow
                        key={process.id}
                        process={process}
                        onStop={props.onStop}
                    />
                ))}
            </ul>
        </section>
    );
}

/**
 * RigActivityPanel — the read-only session activity monitor combining the TUI's
 * `/goal`, `/tasks`, `/agents`, and `/ps` views. Live agents and terminals lead;
 * settled agents remain mounted inside a collapsed disclosure. An optional
 * selection callback turns agent readouts into session-navigation buttons. Every
 * value flows from the reactive session snapshot (reconciled from
 * `tasks_changed`/`goal_changed`/`subagent_changed`/`background_processes_changed`
 * SSE events), so this component holds no product state and starts no work.
 */
export function RigActivityPanel(props: RigActivityPanelProps) {
    const { goal, tasks, subagents, backgroundProcesses } = props;
<<<<<<< HEAD
=======
    const orderedTasks = priorityOrdered(tasks, taskPriority);
    const orderedSubagents = priorityOrdered(subagents, subagentPriority);
    const runningSubagents = orderedSubagents.filter(
        (subagent) =>
            subagent.status === "idle" ||
            subagent.status === "queued" ||
            subagent.status === "running" ||
            subagent.status === "suspended",
    );
    const completedSubagents = orderedSubagents.filter(
        (subagent) =>
            subagent.status === "completed" ||
            subagent.status === "aborted" ||
            subagent.status === "error" ||
            subagent.status === "archived",
    );
    const hasRunning = runningSubagents.length > 0 || backgroundProcesses.length > 0;
>>>>>>> 777abca6 (Add workspace shortcuts and organize activity)
    const empty =
        goal === undefined &&
        tasks.length === 0 &&
        subagents.length === 0 &&
        backgroundProcesses.length === 0;
    const content = (
        <section
            className={["happy2-rig-activity", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-activity-panel"
            data-placement={props.placement === "panel" ? "panel" : undefined}
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
                    {hasRunning ? (
                        <section
                            className="happy2-rig-activity__group"
                            data-happy-desktop-ui="rig-activity-running"
                        >
                            <h2 className="happy2-rig-activity__group-heading">Running</h2>
                            <div className="happy2-rig-activity__group-content">
                                <AgentSection
                                    agents={runningSubagents}
                                    now={props.now}
                                    onSelect={props.onSubagentSelect}
                                />
                                <TerminalSection
                                    processes={backgroundProcesses}
                                    onStop={props.onBackgroundProcessStop}
                                />
                            </div>
                        </section>
                    ) : null}

                    {goal ? <GoalSection goal={goal} /> : null}

                    {tasks.length > 0 ? (
                        <section
                            className="happy2-rig-activity__section"
                            data-happy-desktop-ui="rig-activity-tasks"
                        >
                            <SectionHeading count={tasks.length} label="Tasks" />
                            <ul
                                className="happy2-rig-activity__list"
                                data-happy-desktop-ui="rig-activity-list"
                            >
                                {tasks.map((task) => (
                                    <TaskRow key={task.id} task={task} />
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {completedSubagents.length > 0 ? (
                        <details
                            className="happy2-rig-activity__completed"
                            data-happy-desktop-ui="rig-activity-completed"
                            open={props.completedInitiallyOpen || undefined}
                        >
<<<<<<< HEAD
                            <SectionHeading count={subagents.length} label="Subagents" />
                            <ul
                                className="happy2-rig-activity__list"
                                data-happy-desktop-ui="rig-activity-list"
                            >
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
                            <SectionHeading
                                count={backgroundProcesses.length}
                                label="Background terminals"
                            />
                            <ul
                                className="happy2-rig-activity__list"
                                data-happy-desktop-ui="rig-activity-list"
                            >
                                {backgroundProcesses.map((process) => (
                                    <BackgroundProcessRow
                                        key={process.id}
                                        process={process}
                                        onStop={props.onBackgroundProcessStop}
                                    />
                                ))}
                            </ul>
                        </section>
=======
                            <summary className="happy2-rig-activity__completed-summary">
                                <Icon
                                    className="happy2-rig-activity__completed-chevron"
                                    name="chevron-right"
                                    size={12}
                                />
                                <h2 className="happy2-rig-activity__completed-heading">
                                    Completed
                                </h2>
                                <span className="happy2-rig-activity__count">
                                    {completedSubagents.length}
                                </span>
                            </summary>
                            <div className="happy2-rig-activity__completed-content">
                                <AgentSection
                                    agents={completedSubagents}
                                    now={props.now}
                                    onSelect={props.onSubagentSelect}
                                />
                            </div>
                        </details>
>>>>>>> 777abca6 (Add workspace shortcuts and organize activity)
                    ) : null}
                </>
            )}
        </section>
    );
    return props.placement === "panel" ? (
        <div
            className="happy2-rig-activity-panel-scroll"
            data-happy-desktop-ui="rig-activity-panel-scroll"
        >
            <div className="happy2-rig-activity-panel-scroll__content">{content}</div>
        </div>
    ) : (
        content
    );
}
