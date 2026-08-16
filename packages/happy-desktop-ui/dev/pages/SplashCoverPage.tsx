import { SplashCover } from "../../src/SplashCover";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-253";

/** Stands in for the mounted app under the veil. */
function Underneath() {
    return (
        <div
            style={{
                alignItems: "center",
                background: "var(--surface)",
                display: "flex",
                height: "100%",
                justifyContent: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
            }}
        >
            The mounted app
        </div>
    );
}

const frame = {
    border: "1px solid var(--border)",
    borderRadius: "10px",
    height: "260px",
    overflow: "hidden",
    position: "relative" as const,
    width: "100%",
};

export function SplashCoverPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="The boot mark above the app and its one dissolve into it. Only the mark's opacity animates; both layers draw the same surface, so the app appears to have been there all along."
            title="Splash cover"
        >
            <Specimen
                detail="Covering: the app is not mounted underneath yet, so nothing loads behind the mark"
                label="Booting"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SplashCover ready={false}>
                            <Underneath />
                        </SplashCover>
                    </div>
                    <DimensionRule label="Veil inset 0 · z-index 10 · surface on surface" />
                </div>
            </Specimen>

            <Specimen
                detail="Waiting: a concise reason may sit below the mark without moving it"
                label="Connecting"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SplashCover note="Connecting to your local Rig daemon…" ready={false}>
                            <Underneath />
                        </SplashCover>
                    </div>
                    <DimensionRule label="Note gap 16 · mark remains optically centered" />
                </div>
            </Specimen>

            <Specimen
                detail="Ready: the veil fades over 260ms and removes itself on animationend"
                label="Dissolving"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SplashCover ready>
                            <Underneath />
                        </SplashCover>
                    </div>
                    <DimensionRule label="260ms ease-out · pointer-events none while leaving" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
