import { RigUserInputPrompt } from "../../src/RigUserInputPrompt";
import { ComponentPage, Specimen } from "../kit";
import { rigUserInput } from "./rigChatFixtures";

export function RigUserInputPromptPage() {
    return (
        <ComponentPage
            number="C-150"
            summary="Rig user-input request: single- and multi-select option pickers with a submit gated on required questions."
            title="RigUserInputPrompt"
        >
            <Specimen
                detail="single-select (required) + multi-select question, submit gated until required is answered"
                label="Question set"
                number="01"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigUserInputPrompt onAnswer={() => undefined} request={rigUserInput} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
