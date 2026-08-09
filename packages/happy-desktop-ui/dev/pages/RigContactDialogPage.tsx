import type { ReactNode } from "react";
import { RigContactDialog } from "../../src/RigContactDialog";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-260";

/**
 * The dialog fixes itself to the window it is in, so a specimen gives it one.
 * A state carrying requests at both ends needs a taller window: the lists sit
 * above and below the two choices, and a short window would only show the
 * modal's own body scrolling.
 */
function frame(children: ReactNode, height = 520) {
    return (
        <div
            style={{
                background: "var(--groupped-background)",
                border: "1px solid var(--surface-pressed-overlay)",
                borderRadius: "8px",
                height: `${String(height)}px`,
                overflow: "hidden",
                position: "relative",
                transform: "translateZ(0)",
                width: "760px",
            }}
        >
            {children}
        </div>
    );
}

const handlers = {
    onClose: () => undefined,
    onInvitationCreate: () => undefined,
    onRequestAccept: () => undefined,
    onRequestReject: () => undefined,
    onRequestSubmit: () => undefined,
    onRequestValueChange: () => undefined,
};

const INVITATION = { invitation: "rig://contact/9d41c7a0e5b28f36" };

const INCOMING = [
    {
        email: "kate@dorset.dev",
        id: "request-1",
        identity: "z6Mkf5rMv1n8QhTb",
        name: "Kate Dorset",
    },
];

const INCOMING_UNNAMED = [{ id: "request-2", identity: "z6MkpW7yTc4aHn2L" }];

const OUTGOING = [{ id: "outgoing-1", identity: "z6MkqB3vRj9dXs7E" }];

export function RigContactDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="Making a contact from either end of the handshake: one person produces an invitation, the other pastes it in, and the first answers the request that comes back. Requests waiting on an answer here come first, because they are the only part of the surface where someone else is waiting on this person."
            title="RigContactDialog"
        >
            <Specimen
                detail="480px · nothing under way · the two things this person can start"
                label="Idle"
                number="01"
                stage="app"
            >
                {frame(<RigContactDialog {...handlers} requestValue="" />)}
            </Specimen>

            <Specimen
                detail="Invitation made: the value to send, in place of the button that made it"
                label="Invitation created"
                number="02"
                stage="app"
            >
                {frame(<RigContactDialog {...handlers} invitation={INVITATION} requestValue="" />)}
            </Specimen>

            <Specimen
                detail="Both acts in flight: the pressed control names what it is doing and the field it belongs to is held"
                label="Submitting"
                number="03"
                stage="app"
            >
                {frame(
                    <RigContactDialog
                        {...handlers}
                        creating
                        requesting
                        requestValue="rig://contact/2f9a7c1e4b8d6053"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="Someone asking to be a contact, above the two choices · avatar, name, email, and the one decision"
                label="Request waiting"
                number="04"
                stage="app"
            >
                {frame(<RigContactDialog {...handlers} incoming={INCOMING} requestValue="" />)}
            </Specimen>

            <Specimen
                detail="A request whose Rig has published no profile: the identity stands in for the name, and the decision is still answerable"
                label="Request without a profile"
                number="05"
                stage="app"
            >
                {frame(
                    <RigContactDialog {...handlers} incoming={INCOMING_UNNAMED} requestValue="" />,
                )}
            </Specimen>

            <Specimen
                detail="An answer with the Rig: that row's controls are held while the rest of the surface stays live"
                label="Answering"
                number="06"
                stage="app"
            >
                {frame(
                    <RigContactDialog
                        {...handlers}
                        incoming={[{ ...INCOMING[0]!, answering: true }]}
                        requestValue=""
                    />,
                )}
            </Specimen>

            <Specimen
                detail="Requests at both ends · waiting on this person above, waiting on someone else below"
                label="Both directions"
                number="07"
                stage="app"
            >
                {frame(
                    <RigContactDialog
                        {...handlers}
                        incoming={INCOMING}
                        outgoing={OUTGOING}
                        requestValue=""
                    />,
                    620,
                )}
            </Specimen>

            <Specimen
                detail="A refused act, in the Rig's own words, above everything it might have been about"
                label="Refused"
                number="08"
                stage="app"
            >
                {frame(
                    <RigContactDialog
                        {...handlers}
                        error="That invitation has expired."
                        requestValue="rig://contact/2f9a7c1e4b8d6053"
                    />,
                )}
            </Specimen>
        </ComponentPage>
    );
}
