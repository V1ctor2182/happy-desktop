import {
    SessionSharePanel,
    type SessionShareHealthSummary,
    type SessionShareMemberRow,
} from "../../src/SessionSharePanel";
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

const members: readonly SessionShareMemberRow[] = [
    {
        id: "m1",
        name: "Maya Kovacs",
        initials: "MK",
        access: "watching",
        addedTime: "Added 2 Aug at 09:14",
    },
    {
        id: "m2",
        name: "Jun Park",
        initials: "JP",
        photoUrl: PORTRAIT,
        access: "watching",
        addedTime: "Added 2 Aug at 09:20",
    },
    {
        id: "m3",
        name: "Amara Achebe",
        initials: "AA",
        access: "watching",
        addedTime: "Added yesterday",
    },
];

const withRevoked: readonly SessionShareMemberRow[] = [
    members[0]!,
    { ...members[1]!, access: "revoked", addedTime: "Removed 2 Aug at 11:02" },
    members[2]!,
];

const endedMembers: readonly SessionShareMemberRow[] = members.map((member) => ({
    ...member,
    access: "ended" as const,
}));

const liveHealth: SessionShareHealthSummary = {
    condition: "live",
    pendingEntries: 0,
    checkedTime: "a moment ago",
};

const behindHealth: SessionShareHealthSummary = {
    condition: "behind",
    pendingEntries: 42,
    pendingSize: "1.4 MB",
    checkedTime: "12 seconds ago",
};

/* The panel is reviewed at the inspector width it will actually live in. */
const panelFrame: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    width: "360px",
    height: "560px",
    border: "1px solid var(--divider)",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--surface)",
};

export function SessionSharePanelPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-246"
            summary="Everything the owner of a share has: who is watching, how far behind they are, and the three acts only an owner can perform. Once the share has ended it stops being a control surface and becomes a record of what happened."
            title="SessionSharePanel"
        >
            <Specimen
                detail="Before the first reading: nothing is claimed about who can see this, because nothing is known yet"
                label="Loading"
                number="01"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel condition="live" loading members={[]} />
                </div>
            </Specimen>

            <Specimen
                detail="Three people, everything delivered, and the one setting that decides whether what they write reaches the agent"
                label="Sharing live"
                number="02"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel
                        condition="live"
                        friendMessagesInContext
                        health={liveHealth}
                        members={members}
                        onFriendMessagesChange={noop}
                        onMemberAdd={noop}
                        onMemberRevoke={noop}
                        onStop={noop}
                    />
                </div>
                <DimensionRule label="360 px inspector width" />
            </Specimen>

            <Specimen
                detail="Delivery pressure stated as a measurement, without interrupting anything"
                label="Falling behind"
                number="03"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel
                        condition="behind"
                        friendMessagesInContext={false}
                        health={behindHealth}
                        members={members}
                        onFriendMessagesChange={noop}
                        onMemberAdd={noop}
                        onMemberRevoke={noop}
                        onStop={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Somebody already removed: they stay on the list, quieter, saying what they can do now — which is nothing from here on"
                label="Someone removed"
                number="04"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel
                        condition="live"
                        friendMessagesInContext
                        health={liveHealth}
                        members={withRevoked}
                        onFriendMessagesChange={noop}
                        onMemberAdd={noop}
                        onMemberRevoke={noop}
                        onStop={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Ended: no add, no remove, no ending, no toggle. What is left is who was watching, the sentence about what stays with them, and the one thing still possible — showing the session again, to whoever is chosen now."
                label="Sharing ended"
                number="05"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel
                        condition="ended"
                        friendMessagesInContext
                        members={endedMembers}
                        onFriendMessagesChange={noop}
                        onMemberAdd={noop}
                        onMemberRevoke={noop}
                        onShareAgain={noop}
                        onStop={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="The panel's own feed failed: what was last read stays readable beneath the statement that it may be stale"
                label="Out of date"
                number="06"
                stage="app"
            >
                <div style={panelFrame}>
                    <SessionSharePanel
                        condition="live"
                        error="The Rig did not answer the last read."
                        friendMessagesInContext
                        health={liveHealth}
                        members={members}
                        onFriendMessagesChange={noop}
                        onMemberAdd={noop}
                        onMemberRevoke={noop}
                        onStop={noop}
                        stopping
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
