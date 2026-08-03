import { SessionShareIndicator } from "../../src/SessionShareIndicator";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const noop = () => undefined;

/* The strip lives in the conversation column, so it is reviewed at that measure
   rather than at whatever width the specimen stage happens to be. */
const column: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "640px",
};

export function SessionShareIndicatorPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-245"
            summary="The standing reminder that someone else is reading this session. It sits above the transcript for the whole life of the share, never collapses, and cannot be dismissed — so that nobody ever types into a shared session having forgotten it is shared."
            title="SessionShareIndicator"
        >
            <Specimen
                detail="Happy teal, an eye, and the people on the other end named — present without being an alarm"
                label="Sharing live"
                number="01"
                stage="surface"
            >
                <div style={column}>
                    <SessionShareIndicator
                        condition="live"
                        names={["Maya", "Jun"]}
                        onManage={noop}
                        onStop={noop}
                        watching={2}
                    />
                    <DimensionRule label="40 px minimum · 8/12 px padding" />
                </div>
            </Specimen>

            <Specimen
                detail="One name, and a truncated list that says how many more there are rather than pretending it is everyone"
                label="Live · one and many"
                number="02"
                stage="surface"
            >
                <div style={column}>
                    <SessionShareIndicator
                        condition="live"
                        names={["Maya"]}
                        onManage={noop}
                        onStop={noop}
                        watching={1}
                    />
                    <SessionShareIndicator
                        condition="live"
                        names={["Maya", "Jun"]}
                        onManage={noop}
                        onStop={noop}
                        watching={5}
                    />
                    <SessionShareIndicator condition="live" onManage={noop} watching={3} />
                </div>
            </Specimen>

            <Specimen
                detail="Transport pressure, not failure: the same strip in the warning role, its verb changed to say the watchers are still catching up"
                label="Falling behind"
                number="03"
                stage="surface"
            >
                <div style={column}>
                    <SessionShareIndicator
                        condition="behind"
                        names={["Maya", "Jun"]}
                        onManage={noop}
                        onStop={noop}
                        watching={2}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Neutral and past tense. Nothing to stop, because stopping already happened and cannot be walked back; only the record is left to open."
                label="Sharing ended"
                number="04"
                stage="surface"
            >
                <div style={column}>
                    <SessionShareIndicator condition="ended" onManage={noop} watching={0} />
                </div>
            </Specimen>

            <Specimen
                detail="Narrow column: the label and the sentence wrap as a pair and the actions stay pinned, so the strip never truncates the fact that someone is watching"
                label="Constrained"
                number="05"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", width: "320px" }}>
                    <SessionShareIndicator
                        condition="live"
                        names={["Maya", "Jun", "Amara"]}
                        onManage={noop}
                        watching={3}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
