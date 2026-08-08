import { RigUserInputPrompt } from "../../src/RigUserInputPrompt";
import { ComponentPage, Specimen } from "../kit";
import { rigUserInput } from "./rigChatFixtures";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-150";

export function RigUserInputPromptPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Rig user-input request: single- and multi-select option pickers with a submit gated on required questions. Each question states its own selection rule beside its name."
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

            <Specimen
                detail="no container of its own, for a host that already gives the question one (the inbox)"
                label="Flat"
                number="02"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigUserInputPrompt
                        onAnswer={() => undefined}
                        request={rigUserInput}
                        variant="flat"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="an answer in flight: the options freeze rather than disappear, so a failed send can be retried with the same selections"
                label="Sending"
                number="03"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigUserInputPrompt onAnswer={() => undefined} pending request={rigUserInput} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
