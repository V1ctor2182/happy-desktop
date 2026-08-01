import { WaitTimer } from "../../src/WaitTimer";
import { ComponentPage, Specimen } from "../kit";

/* Every time here is pinned so the page renders the same twice: the product
   passes a ticking clock, the blueprint passes these. */
const STARTED_AT = Date.parse("2026-08-01T09:00:00Z");
const NOW = STARTED_AT + 6 * 60_000;

const column = {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: "16px",
};

export function WaitTimerPage() {
    return (
        <ComponentPage
            number="C-172"
            summary="What an agent that is deliberately waiting shows while it waits: a determinate ring filling across the interval and the time left beside it. Pointing at it names the day the wait ends on — the countdown already answers everything shorter, so the absolute deadline stays out of the line."
            title="Wait timer"
        >
            <Specimen
                detail="14px ring · fill is the share of the interval already spent · tabular countdown · owns no timer, the surface supplies `now`"
                label="Across one interval"
                number="01"
                stage="surface"
            >
                <div style={column}>
                    <WaitTimer
                        finishAt={STARTED_AT + 20 * 60_000}
                        now={STARTED_AT}
                        startedAt={STARTED_AT}
                    />
                    <WaitTimer
                        finishAt={STARTED_AT + 20 * 60_000}
                        now={STARTED_AT + 5 * 60_000}
                        startedAt={STARTED_AT}
                    />
                    <WaitTimer
                        finishAt={STARTED_AT + 20 * 60_000}
                        now={STARTED_AT + 15 * 60_000}
                        startedAt={STARTED_AT}
                    />
                    <WaitTimer
                        finishAt={STARTED_AT + 20 * 60_000}
                        now={STARTED_AT + 20 * 60_000}
                        startedAt={STARTED_AT}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="seconds · minutes and seconds · hours and minutes · days and hours — the two largest units that still say something"
                label="Units"
                number="02"
                stage="surface"
            >
                <div style={column}>
                    <WaitTimer finishAt={NOW + 42_000} now={NOW} startedAt={STARTED_AT} />
                    <WaitTimer finishAt={NOW + 252_000} now={NOW} startedAt={STARTED_AT} />
                    <WaitTimer finishAt={NOW + 5_400_000} now={NOW} startedAt={STARTED_AT} />
                    <WaitTimer finishAt={NOW + 189_000_000} now={NOW} startedAt={STARTED_AT} />
                </div>
            </Specimen>

            <Specimen
                detail="18px and 24px — the ring scales with the box and the stroke stays even"
                label="Size"
                number="03"
                stage="surface"
            >
                <div style={column}>
                    <WaitTimer
                        finishAt={NOW + 252_000}
                        now={NOW}
                        size={18}
                        startedAt={STARTED_AT}
                    />
                    <WaitTimer
                        finishAt={NOW + 252_000}
                        now={NOW}
                        size={24}
                        startedAt={STARTED_AT}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
