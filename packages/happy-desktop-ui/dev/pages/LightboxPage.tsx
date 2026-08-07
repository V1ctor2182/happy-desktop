import { Button } from "../../src/Button";
import { Lightbox } from "../../src/Lightbox";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const column: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
};

/* The lightbox takes the whole window it is hosted in, so a specimen has to
 * state the window: this is the 1280 × 800 design reference at a readable
 * fraction, drawn at 100% scale as a real box rather than a shrunk one. */
const viewport: Record<string, string> = {
    display: "flex",
    width: "880px",
    height: "560px",
};

/* Screenshot-safe inline artwork: a deterministic SVG data-URI photo so the
 * blueprint never loads a network asset. */
function demoImage(width: number, height: number, from: string, to: string): string {
    const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
        `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
        `<stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/>` +
        `</linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/>` +
        `<circle cx='${width * 0.7}' cy='${height * 0.35}' r='${height * 0.18}' fill='rgba(255,255,255,0.22)'/>` +
        `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function LightboxPage() {
    return (
        <ComponentPage
            number="C-046"
            summary="Full image preview inside a web modal (never a new browser tab). Hosted on ModalOverlay's fill placement it takes the whole app window and paints one flat dark over it, in either appearance, with a chrome-less caption/actions header floating above the shared ImageViewer — so a picture opened from a conversation zooms and pans exactly as one opened from Files."
            title="Lightbox"
        >
            <Specimen
                detail="caption + detail + download action + close · one flat dark edge to edge, no card"
                label="Lightbox — full"
                number="01"
                stage="surface"
            >
                <div style={column}>
                    <div style={viewport}>
                        <Lightbox
                            actions={
                                <Button
                                    aria-label="Download"
                                    icon="files"
                                    iconOnly
                                    size="small"
                                    variant="ghost"
                                />
                            }
                            alt="Device farm results"
                            caption="device-farm-green.png"
                            detail="640 × 400 · 412 KB"
                            imageUrl={demoImage(640, 400, "#8b7cf7", "#f472b6")}
                            onClose={() => {}}
                        />
                    </div>
                    <DimensionRule label="fills its window · 52 px header, no rule · 40 px tool bar" />
                </div>
            </Specimen>

            <Specimen
                detail="Header collapses to just the close control when no caption/detail is set"
                label="Lightbox — image only"
                number="02"
                stage="surface"
            >
                <div style={viewport}>
                    <Lightbox
                        alt="Onboarding hero"
                        imageUrl={demoImage(360, 480, "#60a5fa", "#34d399")}
                        onClose={() => {}}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="One of a set: step controls and the reader's place in it · left/right arrow keys do the same"
                label="Lightbox — in a set"
                number="03"
                stage="surface"
            >
                <div style={column}>
                    <div style={viewport}>
                        <Lightbox
                            alt="Run 3 of the device farm"
                            caption="device-farm-03.png"
                            detail="480 × 360"
                            imageUrl={demoImage(480, 360, "#f59e0b", "#ef4444")}
                            onClose={() => {}}
                            onNext={() => {}}
                            onPrevious={() => {}}
                            position={{ index: 2, total: 7 }}
                        />
                    </div>
                    <DimensionRule label="28 px step controls · 4 px tool gap · count in tabular mono" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
