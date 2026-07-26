import { type CSSProperties } from "react";
import { TurnSummary } from "../../src/TurnSummary";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const column: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "640px",
};

export function TurnSummaryPage() {
    return (
        <ComponentPage
            number="C-164"
            summary="The settled footer for a turn: total duration, a red failure outcome, and a final-message copy confirmation."
            title="Turn summary"
        >
            <Specimen
                detail="Message-sized type · copy changes to a check after success"
                label="Completed"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={column}>
                        <TurnSummary
                            copyText="The migration completed successfully."
                            durationMs={104_000}
                            status="complete"
                        />
                        <TurnSummary copyText="Done." durationMs={7_000} status="complete" />
                    </div>
                    <DimensionRule label="640 px wide · 16/24 message type" />
                </div>
            </Specimen>
            <Specimen
                detail="Failure wording and copy action share the destructive treatment"
                label="Failed"
                number="02"
                stage="surface"
            >
                <div style={column}>
                    <TurnSummary
                        copyText="The provider connection failed."
                        durationMs={41_000}
                        status="failed"
                    />
                    <TurnSummary copyText="The run failed." status="failed" />
                    <TurnSummary durationMs={18_000} status="steered" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
