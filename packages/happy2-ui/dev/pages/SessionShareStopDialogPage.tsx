import { type ReactNode } from "react";
import { ModalOverlay } from "../../src/ModalOverlay";
import { SessionShareStopDialog } from "../../src/SessionShareStopDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const noop = () => undefined;

/* The overlay is `position: fixed`; a transformed wrapper bounds it to the
   specimen instead of letting it escape to the viewport. */
function WindowFrame(props: { children: ReactNode; height?: number }) {
    return (
        <div
            style={{
                position: "relative",
                width: "720px",
                height: `${String(props.height ?? 400)}px`,
                overflow: "hidden",
                transform: "translateZ(0)",
                borderRadius: "8px",
                border: "1px solid var(--surface-pressed-overlay)",
                background: "var(--groupped-background)",
            }}
        >
            {props.children}
        </div>
    );
}

export function SessionShareStopDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-248"
            summary="The one confirmation in sharing that has to tell the truth. Removing someone and ending a share both stop later content and neither reaches back into what a person already saw — and that second half is stated as plainly as the first."
            title="SessionShareStopDialog"
        >
            <Specimen
                detail="One person: named in the title and again in the sentence, so there is no doubt which access is going"
                label="Remove one person"
                number="01"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStopDialog
                            kind="revoke"
                            name="Jun Park"
                            onCancel={noop}
                            onConfirm={noop}
                        />
                    </ModalOverlay>
                </WindowFrame>
                <DimensionRule label="modal small 360 px" />
            </Specimen>

            <Specimen
                detail="The removal is with the Rig: both controls are held and the confirm says what is happening"
                label="Removing"
                number="02"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay>
                        <SessionShareStopDialog
                            kind="revoke"
                            name="Jun Park"
                            onCancel={noop}
                            onConfirm={noop}
                            working
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="It did not happen: they still have access, the confirmation is still about them, and pressing again asks again"
                label="Removal refused"
                number="03"
                stage="app"
            >
                <WindowFrame height={480}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStopDialog
                            error="The Rig did not answer, so Jun still has access."
                            kind="revoke"
                            name="Jun Park"
                            onCancel={noop}
                            onConfirm={noop}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The whole share: how many people are affected, that it cannot be resumed, and that nothing already seen can be taken back"
                label="Stop sharing"
                number="04"
                stage="app"
            >
                <WindowFrame height={440}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStopDialog
                            kind="stop"
                            onCancel={noop}
                            onConfirm={noop}
                            watching={3}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The ending is with the Rig. Nothing can be pressed, because an ending halfway through is not something anything can offer to undo."
                label="Ending"
                number="05"
                stage="app"
            >
                <WindowFrame height={440}>
                    <ModalOverlay>
                        <SessionShareStopDialog
                            kind="stop"
                            onCancel={noop}
                            onConfirm={noop}
                            watching={3}
                            working
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The ending failed: everyone is still watching, and the sentence about what ending would do is unchanged"
                label="Ending refused"
                number="06"
                stage="app"
            >
                <WindowFrame height={520}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStopDialog
                            error="The relay did not answer. Everyone still has access."
                            kind="stop"
                            onCancel={noop}
                            onConfirm={noop}
                            watching={1}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>
        </ComponentPage>
    );
}
