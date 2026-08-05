import type { ReactNode } from "react";
import { RigPairing, type RigPairingProgress } from "../../src/RigPairing";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const noop = () => {};

/** Enough of the props to draw one state; every specimen fills in the rest. */
const BASE = {
    available: true,
    joinValue: "",
    onInvitationCreate: noop,
    onJoinSubmit: noop,
    onJoinValueChange: noop,
    onReset: noop,
    onVerificationAccept: noop,
    onVerificationReject: noop,
} as const;

const INVITATION = {
    command: "npm install -g @slopus/rig && rig join rig://join/2f9a7c1e4b8d6053",
    invitation: "rig://join/2f9a7c1e4b8d6053",
};

const PEER = { instanceId: "workshop", name: "workshop" };

const VERIFYING: RigPairingProgress = {
    emojis: ["🐙", "🌵", "🔔", "🚲"],
    peer: PEER,
    phase: "verifying",
    role: "inviter",
};

/** One stage-width column, because every state of this surface is one column. */
function Stage(props: { children: ReactNode }) {
    return <div style={{ maxWidth: "520px", width: "100%" }}>{props.children}</div>;
}

export function RigPairingPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-215"
            summary="Trusting another machine by comparing four emojis at both ends. There is no key to copy across, no address to allow, and nothing about the other machine to configure: two machines that see the same four emojis reached each other and nobody else, which is why the emojis are the largest thing on the surface. The component holds no pairing state and starts nothing — it renders the phase it is given and reports presses."
            title="Rig pairing"
        >
            <Specimen
                detail="Nothing under way: the two ways to start one, each stating what the reader will have to do on the other machine before they commit to it"
                label="Idle — invite or join"
                number="01"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} />
                    </Stage>
                    <DimensionRule label="card padding 16 · column gap 16 · title 13/18 · detail 12/18" />
                </div>
            </Specimen>

            <Specimen
                detail="Both starts in flight. The pressed control names what it is doing rather than spinning silently, and the field it belongs to is held while the Rig has it."
                label="Submitting"
                number="02"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} creating />
                    </Stage>
                    <Stage>
                        <RigPairing {...BASE} joinValue="rig://join/2f9a7c1e4b8d6053" joining />
                    </Stage>
                    <DimensionRule label="button small · field small · disabled while the Rig holds it" />
                </div>
            </Specimen>

            <Specimen
                detail="A refused start is said above the controls and leaves them usable, because the answer to a Rig that refused is usually to try the other way"
                label="Start failed"
                number="03"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing
                            {...BASE}
                            error="That invitation has already been used."
                            joinValue="rig://join/2f9a7c1e4b8d6053"
                        />
                    </Stage>
                    <DimensionRule label="banner danger · controls stay live" />
                </div>
            </Specimen>

            <Specimen
                detail="The invitation and the exact command that redeems it, in mono and selectable: this is text a person carries to another machine, so it is shown whole rather than truncated"
                label="Invitation made"
                number="04"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing
                            {...BASE}
                            invitation={INVITATION}
                            progress={{ phase: "waiting", role: "inviter" }}
                        />
                    </Stage>
                    <DimensionRule label="code block 12/18 mono · wrap anywhere · user-select text" />
                </div>
            </Specimen>

            <Specimen
                detail="Waiting and connecting are the same shape: a spinner, what is being waited for, and the one way out. Neither claims anything about the other machine yet, because nothing has been proved."
                label="Waiting and connecting"
                number="05"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} progress={{ phase: "waiting", role: "inviter" }} />
                    </Stage>
                    <Stage>
                        <RigPairing {...BASE} progress={{ phase: "connecting", role: "joiner" }} />
                    </Stage>
                    <DimensionRule label="spinner 16 · heading gap 8 · ghost stop-watching" />
                </div>
            </Specimen>

            <Specimen
                detail="The trust decision. Four 44px slots, one glyph each, so an operating-system colour font cannot let one emoji set the others' spacing. The machine is named above them and again in the sentence, because accepting is a claim about that machine."
                label="Verifying"
                number="06"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} progress={VERIFYING} />
                    </Stage>
                    <DimensionRule label="emoji slot 44×44 · gap 12 · glyph 28 · accept primary, reject danger" />
                </div>
            </Specimen>

            <Specimen
                detail="While the answer is with the Rig both controls are held, so a second press cannot answer twice for the same comparison"
                label="Verifying — answering"
                number="07"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} answering progress={VERIFYING} />
                    </Stage>
                    <DimensionRule label="both actions disabled · no spinner: the emojis stay legible" />
                </div>
            </Specimen>

            <Specimen
                detail="Paired. It says what happened and what happens next rather than pretending the machine is already open: the node appears under Nodes once the Rig connects to it."
                label="Connected"
                number="08"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing
                            {...BASE}
                            progress={{ peer: PEER, phase: "connected", role: "inviter" }}
                        />
                    </Stage>
                    <DimensionRule label="check-circle 16 · secondary Done" />
                </div>
            </Specimen>

            <Specimen
                detail="The three ways a pairing ends without trust. Each carries the Rig's own sentence when it gave one, and the same one way to start again; a rejected pairing is not an error and is not coloured as one."
                label="Rejected, expired, failed"
                number="09"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing
                            {...BASE}
                            progress={{
                                message: "The other machine did not accept.",
                                phase: "rejected",
                                role: "inviter",
                            }}
                        />
                    </Stage>
                    <Stage>
                        <RigPairing {...BASE} progress={{ phase: "expired", role: "inviter" }} />
                    </Stage>
                    <Stage>
                        <RigPairing
                            {...BASE}
                            progress={{
                                message: "The two machines could not reach each other.",
                                phase: "failed",
                                role: "joiner",
                            }}
                        />
                    </Stage>
                    <DimensionRule label="hint 12/18 · secondary Start again" />
                </div>
            </Specimen>

            <Specimen
                detail="A Rig whose protocol does not carry pairing offers no control at all. It is stated as information rather than as a fault: that Rig still reports every machine it is already peered with."
                label="Unsupported protocol"
                number="10"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Stage>
                        <RigPairing {...BASE} available={false} />
                    </Stage>
                    <DimensionRule label="banner info · no buttons, no field" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
