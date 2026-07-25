import { SplashScreen } from "../../src/SplashScreen";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
export function SplashScreenPage() {
    return (
        <ComponentPage
            number="C-161"
            summary="What the window holds while the app resolves: the Happy mark centered on the workspace surface, with no spinner and no copy."
            title="Splash screen"
        >
            <Specimen
                detail="Fills its host · 64px mark centered on both axes · workspace surface"
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
        </ComponentPage>
    );
}
