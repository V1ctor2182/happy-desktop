import { HappyAgentUserInputPrompt } from "../../src/HappyAgentUserInputPrompt";
import { ComponentPage, Specimen } from "../kit";
import { happyAgentUserInput } from "./happyAgentChatFixtures";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-150";

export function HappyAgentUserInputPromptPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Happy Agent user-input request: single- and multi-select option pickers with a submit gated on required questions. Each question states its own selection rule beside its name."
            title="HappyAgentUserInputPrompt"
        >
            <Specimen
                detail="single-select (required) + multi-select question, submit gated until required is answered"
                label="Question set"
                number="01"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <HappyAgentUserInputPrompt
                        onAnswer={() => undefined}
                        request={happyAgentUserInput}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="no container of its own, for a host that already gives the question one (the inbox)"
                label="Flat"
                number="02"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <HappyAgentUserInputPrompt
                        onAnswer={() => undefined}
                        request={happyAgentUserInput}
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
                    <HappyAgentUserInputPrompt
                        onAnswer={() => undefined}
                        pending
                        request={happyAgentUserInput}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
