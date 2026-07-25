import { expect, it, vi } from "vitest";
import type { RigBackgroundProcess, RigGoal, RigSubagentSummary, RigTask } from "happy2-state";
import "./theme.css";
import "./styles/rig-activity.css";
import { RigActivityPanel } from "./RigActivityPanel";
import { createRenderer } from "./testing";

const goal: RigGoal = {
    objective: "Ship the usage panel end to end.",
    status: "active",
    createdAt: 1000,
    updatedAt: 2000,
};

const tasks: readonly RigTask[] = [
    {
        id: "t1",
        subject: "Design the API",
        description: "",
        status: "completed",
        blockedBy: [],
        blocks: [],
    },
    {
        id: "t2",
        subject: "Implement the store",
        description: "",
        status: "in_progress",
        activeForm: "Implementing the store",
        blockedBy: [],
        blocks: [],
    },
    {
        id: "t3",
        subject: "Write tests",
        description: "",
        status: "pending",
        blockedBy: [],
        blocks: [],
    },
];

const subagents: readonly RigSubagentSummary[] = [
    {
        id: "sub-1" as RigSubagentSummary["id"],
        parentSessionId: "s1" as RigSubagentSummary["parentSessionId"],
        description: "Research the protocol",
        taskName: "protocol-research",
        modelId: "gpt-5.6-sol",
        status: "running",
        depth: 1,
        createdAt: 1000,
        updatedAt: 2000,
        activeSince: 4_000,
        totalTokens: 12_500,
        latestText: "Reading the transport module.",
    },
];

const backgroundProcesses: readonly RigBackgroundProcess[] = [
    { id: 7, command: "pnpm server dev", cwd: "/repo", status: "running" },
];

it("renders the goal, task list, and subagent monitor from reactive state", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <RigActivityPanel
                    backgroundProcesses={backgroundProcesses}
                    goal={goal}
                    now={64_000}
                    subagents={subagents}
                    tasks={tasks}
                />
            </div>
        ),
        { width: 600, height: 760, padding: 12 },
    );
    await view.ready();

    // Goal objective + status pill.
    expect(view.$('[data-happy2-ui="rig-activity-goal-status"]').element.textContent).toBe(
        "Active",
    );
    expect(view.container.textContent).toContain("Ship the usage panel end to end.");

    // Three tasks; the in-progress one shows its active form.
    const taskRows = view.container.querySelectorAll('[data-happy2-ui="rig-activity-task"]');
    expect(taskRows.length).toBe(3);
    expect(view.container.textContent).toContain("Implementing the store");

    // Subagent monitor: humanized status, elapsed (now - activeSince = 60s), tokens.
    expect(view.$('[data-happy2-ui="rig-activity-subagent-status"]').element.textContent).toBe(
        "Running",
    );
    const monitor = view.$('[data-happy2-ui="rig-activity-subagent"]').element;
    expect(monitor.textContent).toContain("1:00");
    expect(monitor.textContent).toContain("12,500 tokens");
    expect(monitor.textContent).toContain("Reading the transport module.");

    // Background terminals (`/ps`) listed with their command.
    const processRows = view.container.querySelectorAll('[data-happy2-ui="rig-activity-process"]');
    expect(processRows.length).toBe(1);
    expect(processRows[0]?.textContent).toContain("pnpm server dev");

    await view.screenshot("RigActivityPanel.test");
}, 120_000);

it("shows a Stop control on a background terminal only when onBackgroundProcessStop is wired", async () => {
    const stopped: number[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <RigActivityPanel
                    backgroundProcesses={backgroundProcesses}
                    onBackgroundProcessStop={(id) => stopped.push(id)}
                    now={0}
                    subagents={[]}
                    tasks={[]}
                />
            </div>
        ),
        { width: 600, height: 240, padding: 12 },
    );
    // A second panel without the handler must not render the control.
    view.render(
        () => (
            <div data-testid="no-stop" style={{ width: "560px" }}>
                <RigActivityPanel
                    backgroundProcesses={backgroundProcesses}
                    now={0}
                    subagents={[]}
                    tasks={[]}
                />
            </div>
        ),
        { width: 600, height: 240, padding: 12 },
    );
    await view.ready();

    expect(
        view.container.querySelector(
            '[data-testid="no-stop"] [data-happy2-ui="rig-activity-process-stop"]',
        ),
    ).toBeNull();

    const stop = view.$('[data-happy2-ui="rig-activity-process-stop"]')
        .element as HTMLButtonElement;
    stop.click();
    await vi.waitFor(() => expect(stopped).toEqual([7]));

    await view.screenshot("RigActivityPanel.stop.test");
}, 120_000);

it("shows an empty state when there is no goal, task, subagent, or process", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <RigActivityPanel backgroundProcesses={[]} now={0} subagents={[]} tasks={[]} />
            </div>
        ),
        { width: 600, height: 200, padding: 12 },
    );
    await view.ready();

    expect(view.container.querySelector('[data-happy2-ui="rig-activity-empty"]')).not.toBeNull();
}, 120_000);
