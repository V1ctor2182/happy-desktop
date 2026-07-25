import { RigTranscript } from "../../src/RigTranscript";
import { ComponentPage, Specimen } from "../kit";
import { rigTranscriptEntries } from "./rigChatFixtures";

export function RigTranscriptPage() {
    return (
        <ComponentPage
            number="C-149"
            summary="Ordered Rig transcript: user input surfaces, dim agent/thinking markdown, colored notices, tool calls, and a live activity line while running."
            title="RigTranscript"
        >
            <Specimen
                detail="every entry kind, tools expanded, plus the running activity line with elapsed"
                label="Full transcript (running)"
                number="01"
                stage="surface"
            >
                <div style={{ width: "900px", background: "var(--surface)" }}>
                    <RigTranscript
                        elapsedMs={42_000}
                        entries={rigTranscriptEntries}
                        running
                        toolsDefaultExpanded
                    />
                </div>
            </Specimen>

            <Specimen
                detail="idle: no activity line; tools collapsed to their headers"
                label="Idle transcript"
                number="02"
                stage="surface"
            >
                <div style={{ width: "900px", background: "var(--surface)" }}>
                    <RigTranscript entries={rigTranscriptEntries} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
