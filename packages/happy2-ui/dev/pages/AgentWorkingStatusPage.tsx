import { type CSSProperties } from "react";
import { AgentWorkingStatus } from "../../src/AgentWorkingStatus";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const column: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "640px",
};

/* Pinned so the countdown renders the same twice; the product ticks instead. */
const WAIT_STARTED_AT = Date.parse("2026-08-01T09:00:00Z");

export function AgentWorkingStatusPage() {
    return (
        <ComponentPage
            number="C-072"
            summary="The live footer for an active turn: current phase, elapsed time, running agents, and background tasks."
            title="Agent working status"
        >
            <Specimen
                detail="Thinking · generating tools · calling tools · texting · fallback working"
                label="Reactive phases"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={column}>
                        <AgentWorkingStatus elapsedMs={104_000} phase="thinking" />
                        <AgentWorkingStatus elapsedMs={12_000} phase="generatingTools" />
                        <AgentWorkingStatus agents={1} elapsedMs={7_000} phase="callingTools" />
                        <AgentWorkingStatus elapsedMs={4_000} phase="texting" />
                        <AgentWorkingStatus backgroundTasks={2} elapsedMs={0} phase="working" />
                    </div>
                    <DimensionRule label="640 px wide · 16/24 message type" />
                </div>
            </Specimen>
            <Specimen
                detail="The agent's own status text replaces the generic phase word"
                label="Humanized activity"
                number="02"
                stage="surface"
            >
                <div style={column}>
                    <AgentWorkingStatus
                        elapsedMs={9_000}
                        label="Reading AGENTS.md"
                        phase="callingTools"
                    />
                    <AgentWorkingStatus
                        agents={2}
                        elapsedMs={41_000}
                        label="Running 3 tools"
                        phase="callingTools"
                    />
                    <AgentWorkingStatus
                        backgroundTasks={1}
                        elapsedMs={2_000}
                        label="Waiting for permission"
                        phase="working"
                    />
                </div>
            </Specimen>
            <Specimen
                detail="A scheduled wait replaces the spinner, the agent's absolute deadline, and the turn clock with one determinate ring counting down · hover names the day it ends on"
                label="Wait countdown"
                number="03"
                stage="surface"
            >
                <div style={column}>
                    <AgentWorkingStatus
                        phase="callingTools"
                        wait={{
                            startedAt: WAIT_STARTED_AT,
                            dueAt: WAIT_STARTED_AT + 3_600_000,
                            now: WAIT_STARTED_AT + 108_000,
                        }}
                    />
                    <AgentWorkingStatus
                        phase="callingTools"
                        wait={{
                            startedAt: WAIT_STARTED_AT,
                            dueAt: WAIT_STARTED_AT + 3_600_000,
                            now: WAIT_STARTED_AT + 2_700_000,
                        }}
                    />
                    <AgentWorkingStatus
                        phase="callingTools"
                        wait={{
                            startedAt: WAIT_STARTED_AT,
                            dueAt: WAIT_STARTED_AT + 300_000,
                            now: WAIT_STARTED_AT + 258_000,
                        }}
                    />
                    <AgentWorkingStatus
                        phase="callingTools"
                        wait={{
                            startedAt: WAIT_STARTED_AT,
                            dueAt: WAIT_STARTED_AT + 172_800_000,
                            now: WAIT_STARTED_AT + 21_600_000,
                        }}
                    />
                </div>
            </Specimen>
            <Specimen
                detail="Long counts truncate after the durable working clock"
                label="Constrained"
                number="04"
                stage="surface"
            >
                <div style={{ ...column, width: "360px" }}>
                    <AgentWorkingStatus agents={32} backgroundTasks={32} elapsedMs={3_723_000} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
