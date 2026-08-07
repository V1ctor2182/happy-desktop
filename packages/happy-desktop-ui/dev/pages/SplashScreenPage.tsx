import { SplashScreen } from "../../src/SplashScreen";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
export function SplashScreenPage() {
    return (
        <ComponentPage
            number="C-161"
            summary="What the window holds while the app resolves: the muted Happy mark centered on the workspace surface, with no spinner and an optional reassurance note."
            title="Splash screen"
        >
            <Specimen
                detail="Fills its host · 64px mark centered on both axes · grayscale and faded · workspace surface"
                label="Starting"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ width: "640px", height: "400px" }}>
                        <SplashScreen />
                    </div>
                    <DimensionRule label="640 × 400 host · mark 64 × 64" />
                </div>
            </Specimen>

            <Specimen
                detail="A narrow host keeps the mark centered and unscaled"
                label="Narrow host"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ width: "280px", height: "240px" }}>
                        <SplashScreen label="Happy Place" />
                    </div>
                    <DimensionRule label="280 × 240 host · mark stays 64 × 64" />
                </div>
            </Specimen>

            <Specimen
                detail="A slow local Rig start adds a quiet note below the mark; the mark itself does not move"
                label="With a note"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ width: "640px", height: "400px" }}>
                        <SplashScreen note="Still starting Rig…" />
                    </div>
                    <DimensionRule label="640 × 400 host · mark 64 × 64 · note centered below" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
