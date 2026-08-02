import { EmptyState } from "../../src/EmptyState";
import { LottieMark } from "../../src/LottieMark";
import { ComponentPage, Specimen } from "../kit";

/*
 * Nothing on this page animates while a screenshot is being taken. The
 * blueprint pins `prefers-reduced-motion: reduce` for its own capture runs, and
 * a mark under that preference holds frame 0 and never starts its loop, so
 * every specimen here is the same picture every time. That is the same code
 * path a reader with the preference set sees — this page is not a special case
 * built for the camera.
 */

export function LottieMarkPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-237"
            summary="One small looping vector mark, drawn by ThorVG on a worker thread against an OffscreenCanvas. All rasterising happens off the main thread, which transfers the canvas once and afterwards only sends play, pause, and seek; the renderer posts back one small frame notification per frame, handled in constant time with no listener and no React render. It stops when scrolled out of view or the window is hidden, holds a still frame when the reader has asked for reduced motion, and releases its worker player and canvas on unmount."
            title="LottieMark"
        >
            <Specimen
                detail="A mark is not a hero. Empty states use the first two — 30px inline and 36px inside a 48px medallion. The 48px on the right is the ceiling, shown so the range is visible; nothing ships at it."
                label="Sizes"
                number="01"
                stage="surface"
            >
                <div style={{ alignItems: "center", display: "flex", gap: 24 }}>
                    <LottieMark name="sparkles" size={30} />
                    <LottieMark name="sparkles" size={36} />
                    <LottieMark name="sparkles" size={48} />
                </div>
            </Specimen>

            <Specimen
                detail="Over the empty-state medallion, which is the only place a mark is used. The glyph underneath is what the reader sees before the runtime loads and what they keep if it never does."
                label="In the medallion"
                number="02"
                stage="app"
            >
                <div style={{ display: "flex", gap: 32 }}>
                    <EmptyState
                        animation="sparkles"
                        description="Nothing needs your attention right now."
                        icon="home"
                        size="inline"
                        title="You’re all caught up"
                    />
                    <EmptyState
                        animation="sparkles"
                        description="When an agent needs a decision, it waits for you here."
                        icon="check-circle"
                        size="inline"
                        title="Nothing to decide"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="The same medallion without the mark. A screen that searched and found nothing keeps this: the absence is a miss, and a miss should not be congratulated."
                label="Unmarked, for contrast"
                number="03"
                stage="app"
            >
                <EmptyState
                    description="No channels, people, messages, or files match “kryptonite”."
                    icon="search"
                    size="inline"
                    title="No results"
                />
            </Specimen>
        </ComponentPage>
    );
}
