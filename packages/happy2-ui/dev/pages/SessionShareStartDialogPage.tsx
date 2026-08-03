import { type ReactNode } from "react";
import { ModalOverlay } from "../../src/ModalOverlay";
import {
    SessionShareStartDialog,
    type SessionShareCandidate,
} from "../../src/SessionShareStartDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/*
 * A deterministic picture: drawn inline so the workbench never waits on a
 * network asset and every capture is identical.
 */
const PORTRAIT =
    "data:image/svg+xml;base64," +
    btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
            '<rect width="96" height="96" fill="#2baccc"/>' +
            '<circle cx="48" cy="38" r="16" fill="#ffffff"/>' +
            '<circle cx="48" cy="92" r="30" fill="#ffffff"/>' +
            "</svg>",
    );

const noop = () => undefined;

/* The overlay is `position: fixed`; a transformed wrapper bounds it to the
   specimen instead of letting it escape to the viewport. */
function WindowFrame(props: { children: ReactNode; height?: number }) {
    return (
        <div
            style={{
                position: "relative",
                width: "720px",
                height: `${String(props.height ?? 560)}px`,
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

const candidates: readonly SessionShareCandidate[] = [
    { id: "f1", name: "Maya Kovacs", initials: "MK" },
    { id: "f2", name: "Jun Park", initials: "JP", photoUrl: PORTRAIT },
    { id: "f3", name: "Amara Achebe", initials: "AA" },
    { id: "f4", name: "Tomas Oduya", initials: "TO" },
];

const none: ReadonlySet<string> = new Set();
const two: ReadonlySet<string> = new Set(["f1", "f3"]);

export function SessionShareStartDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-247"
            summary="Choosing the people a session is shown to, and starting to show it to them. The sentence about what a new watcher gets to see is always under the list, because it is always true."
            title="SessionShareStartDialog"
        >
            <Specimen
                detail="Nobody ticked yet: the list is people, and starting is held until at least one of them is chosen"
                label="Nobody selected"
                number="01"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={candidates}
                            friendMessagesInContext={false}
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={none}
                        />
                    </ModalOverlay>
                </WindowFrame>
                <DimensionRule label="modal medium 480 px" />
            </Specimen>

            <Specimen
                detail="Two people chosen, and what they write set to reach the agent — the one decision here that is not about who"
                label="Two selected"
                number="02"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={candidates}
                            friendMessagesInContext
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={two}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The share is with the Rig: every control is held and the button says what is happening rather than going quiet"
                label="Starting"
                number="03"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay>
                        <SessionShareStartDialog
                            candidates={candidates}
                            friendMessagesInContext
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={two}
                            starting
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The Rig refused: what it said sits above the list, and every choice already made is still there to try again with"
                label="Refused"
                number="04"
                stage="app"
            >
                <WindowFrame height={620}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={candidates}
                            error="The relay did not answer, so nobody has been given access."
                            friendMessagesInContext
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={two}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="Nobody to choose from: no Start at all, and the reason said instead of a button that could do nothing"
                label="No candidates"
                number="05"
                stage="app"
            >
                <WindowFrame height={420}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={[]}
                            friendMessagesInContext={false}
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={none}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="Growing a share that already exists: the title, the verb, and the standing sentence all change, and everyone already watching keeps what they have"
                label="Add mode"
                number="06"
                stage="app"
            >
                <WindowFrame>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={[candidates[3]!]}
                            friendMessagesInContext
                            mode="add"
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={new Set(["f4"])}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="Add mode with nobody left to add: the reason is the other one, because an empty list means something different here"
                label="Add mode · everyone has access"
                number="07"
                stage="app"
            >
                <WindowFrame height={420}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={[]}
                            friendMessagesInContext
                            mode="add"
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={none}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="The friends have not been read yet: the dialog says the list is loading rather than claiming there is nobody, and there is still no Start to press"
                label="Reading friends"
                number="08"
                stage="app"
            >
                <WindowFrame height={420}>
                    <ModalOverlay onDismiss={noop}>
                        <SessionShareStartDialog
                            candidates={[]}
                            friendMessagesInContext={false}
                            loading
                            onCancel={noop}
                            onFriendMessagesChange={noop}
                            onStart={noop}
                            onToggle={noop}
                            selected={none}
                        />
                    </ModalOverlay>
                </WindowFrame>
            </Specimen>
        </ComponentPage>
    );
}
