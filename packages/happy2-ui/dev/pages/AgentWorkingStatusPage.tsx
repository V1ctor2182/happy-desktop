import { type CSSProperties } from "react";
import { AgentWorkingStatus } from "../../src/AgentWorkingStatus";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const column: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "640px",
};

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
                detail="Long counts truncate after the durable working clock"
                label="Constrained"
                number="03"
                stage="surface"
            >
                <div style={{ ...column, width: "360px" }}>
                    <AgentWorkingStatus agents={32} backgroundTasks={32} elapsedMs={3_723_000} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
