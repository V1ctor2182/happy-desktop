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
            summary="The live footer for an active turn: message-sized working time, running agents, and background tasks."
            title="Agent working status"
        >
            <Specimen
                detail="Message-sized type · live clock · current fan-out"
                label="Working"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={column}>
                        <AgentWorkingStatus agents={3} backgroundTasks={2} elapsedMs={104_000} />
                        <AgentWorkingStatus agents={1} elapsedMs={7_000} />
                        <AgentWorkingStatus elapsedMs={0} />
                    </div>
                    <DimensionRule label="640 px wide · 16/24 message type" />
                </div>
            </Specimen>
            <Specimen
                detail="Long counts truncate after the durable working clock"
                label="Constrained"
                number="02"
                stage="surface"
            >
                <div style={{ ...column, width: "360px" }}>
                    <AgentWorkingStatus agents={32} backgroundTasks={32} elapsedMs={3_723_000} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
