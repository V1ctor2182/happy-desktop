import { ContextMeter } from "../../src/ContextMeter";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-159";
export function ContextMeterPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="How much of the model's context window the conversation has spent, as a 64px bar at the end of the composer's control row. Pointing at it slides the percentage and token counts out to its left; it stays muted until compacting is the next thing to do."
            title="Context meter"
        >
            <Specimen
                detail="64px track · 4px width fill · secondary text at 72% · hover reveals the tabular percentage and counts"
                label="Ample"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "16px",
                    }}
                >
                    <ContextMeter totalTokens={200_000} usedTokens={16_000} />
                    <ContextMeter totalTokens={1_000_000} usedTokens={390_000} />
                </div>
            </Specimen>
            <Specimen
                detail="warning colour from three quarters spent · error colour from nine tenths · the notch marks where compacting is due"
                label="Compaction due"
                number="02"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "16px",
                    }}
                >
                    <ContextMeter totalTokens={200_000} usedTokens={158_000} />
                    <ContextMeter approximate totalTokens={200_000} usedTokens={188_000} />
                    <ContextMeter totalTokens={200_000} usedTokens={200_000} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
