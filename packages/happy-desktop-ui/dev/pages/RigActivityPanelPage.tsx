import type {
    RigBackgroundProcess,
    RigGoal,
    RigSubagentSummary,
    RigTask,
} from "happy-desktop-state";
import { RigActivityPanel } from "../../src/RigActivityPanel";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-157";

// Fixed "now" keeps subagent elapsed timing deterministic for screenshots.
const NOW = Date.UTC(2026, 6, 25, 17, 0, 0);

const goal: RigGoal = {
    objective: "Build a fully featured Rig client UI that matches the TUI feature-for-feature.",
    status: "active",
    createdAt: NOW - 3_600_000,
    updatedAt: NOW - 60_000,
};

const tasks: readonly RigTask[] = [
    {
        id: "t1",
        subject: "Design the usage API",
        description: "",
        status: "completed",
        blockedBy: [],
        blocks: [],
    },
    {
        id: "t2",
        subject: "Wire the activity panel",
        description: "",
        status: "in_progress",
        activeForm: "Wiring the activity panel through the store",
        blockedBy: [],
        blocks: [],
    },
    {
        id: "t3",
        subject: "Cross-browser tests",
        description: "",
        status: "pending",
        blockedBy: ["t2"],
        blocks: [],
    },
];

const subagents: readonly RigSubagentSummary[] = [
    {
        id: "sub-1" as RigSubagentSummary["id"],
        parentSessionId: "s1" as RigSubagentSummary["parentSessionId"],
        description: "Research the protocol surface",
        taskName: "protocol-research",
        modelId: "gpt-5.6-sol",
        status: "running",
        depth: 1,
        createdAt: NOW - 120_000,
        updatedAt: NOW - 5_000,
        activeSince: NOW - 90_000,
        totalTokens: 12_500,
        latestText: "Reading the transport module to map the usage endpoint.",
    },
    {
        id: "sub-2" as RigSubagentSummary["id"],
        parentSessionId: "s1" as RigSubagentSummary["parentSessionId"],
        description: "Draft the migration",
        modelId: "sonnet-5",
        status: "completed",
        depth: 1,
        createdAt: NOW - 300_000,
        updatedAt: NOW - 200_000,
        elapsedMs: 95_000,
        totalTokens: 48_200,
    },
];

const backgroundProcesses: readonly RigBackgroundProcess[] = [
    {
        id: 1,
        command: "pnpm --dir packages/happy-desktop-electron dev",
        cwd: "/repo",
        status: "running",
    },
    { id: 2, command: "vite --host", cwd: "/repo", status: "running" },
];

export function RigActivityPanelPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Rig session activity monitor (`/goal`, `/tasks`, `/agents`, `/ps`): persistent goal with status, task list, delegated-subagent monitor, and running background terminals. Read-only; SSE-reactive."
            title="RigActivityPanel"
        >
            <Specimen
                detail="a session with a goal, task list, two subagents, and background terminals"
                label="Populated"
                number="01"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigActivityPanel
                        backgroundProcesses={backgroundProcesses}
                        onBackgroundProcessStop={() => undefined}
                        goal={goal}
                        now={NOW}
                        subagents={subagents}
                        tasks={tasks}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="tasks only, no goal or subagents"
                label="Tasks only"
                number="02"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigActivityPanel
                        backgroundProcesses={[]}
                        now={NOW}
                        subagents={[]}
                        tasks={tasks}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="nothing tracked for this session yet"
                label="Empty"
                number="03"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigActivityPanel
                        backgroundProcesses={[]}
                        now={NOW}
                        subagents={[]}
                        tasks={[]}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
