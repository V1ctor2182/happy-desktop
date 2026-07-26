import { ContextGauge } from "../../src/ContextGauge";
import { ComponentPage, Specimen } from "../kit";
export function ContextGaugePage() {
    return (
        <ComponentPage
            number="C-159"
            summary="A 14px ring showing how much of the model's context window is still free, with the remaining percentage beside it. The ring empties as the window fills, so empty reads as out of room."
            title="Context gauge"
        >
            <Specimen
                detail="14px ring · conic remaining arc · tabular percentage · secondary text"
                label="Ample"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                    <ContextGauge
                        remainingFraction={0.92}
                        remainingTokens={184_000}
                        totalTokens={200_000}
                    />
                    <ContextGauge
                        remainingFraction={0.61}
                        remainingTokens={610_000}
                        totalTokens={1_000_000}
                    />
                </div>
            </Specimen>
            <Specimen
                detail="warning color at or below a quarter free · error color at or below a tenth"
                label="Running out"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                    <ContextGauge
                        remainingFraction={0.22}
                        remainingTokens={44_000}
                        totalTokens={200_000}
                    />
                    <ContextGauge
                        approximate
                        remainingFraction={0.06}
                        remainingTokens={12_000}
                        totalTokens={200_000}
                    />
                    <ContextGauge remainingFraction={0} remainingTokens={0} totalTokens={200_000} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
