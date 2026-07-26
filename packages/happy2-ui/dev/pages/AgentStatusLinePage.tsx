import { type CSSProperties } from "react";
import { AgentStatusLine } from "../../src/AgentStatusLine";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
const column: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "560px",
};
export function AgentStatusLinePage() {
    return (
        <ComponentPage
            number="C-072"
            summary="The one quiet mono line a working agent turn keeps under the transcript: how long it has been working, how far it fanned out, and what it has spent — never which tool it is running."
            title="Agent status line"
        >
            <Specimen
                detail="24px row · left-aligned · state and clock, then counters"
                label="Working"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={column}>
                        <AgentStatusLine
                            agents={3}
                            elapsedMs={104_000}
                            processes={2}
                            tokens={101_000}
                        />
                        <AgentStatusLine elapsedMs={7_000} tokens={860} />
                        <AgentStatusLine elapsedMs={0} />
                    </div>
                    <DimensionRule label="560 px wide · 24 px high" />
                </div>
            </Specimen>

            <Specimen
                detail="Seconds while a turn is short, then minutes, then hours"
                label="Clock and singulars"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={column}>
                        <AgentStatusLine agents={1} elapsedMs={41_000} processes={1} tokens={999} />
                        <AgentStatusLine agents={12} elapsedMs={3_723_000} tokens={2_400_000} />
                    </div>
                    <DimensionRule label="a counter appears only once the turn has it" />
                </div>
            </Specimen>

            <Specimen
                detail="A narrow pane keeps the state and truncates the counters"
                label="Narrow truncation"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ ...column, width: "220px" }}>
                        <AgentStatusLine
                            agents={32}
                            elapsedMs={3_723_000}
                            processes={32}
                            tokens={2_400_000}
                        />
                    </div>
                    <DimensionRule label="220 px wide · the state keeps its natural width" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
