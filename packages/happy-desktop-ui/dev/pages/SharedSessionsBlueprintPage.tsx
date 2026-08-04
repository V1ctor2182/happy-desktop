import {
    SharedSessionsPage,
    type SharedSessionRow,
} from "../../src/pages/shared/SharedSessionsPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

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

const live: readonly SharedSessionRow[] = [
    {
        id: "s1",
        title: "Token rotation race condition",
        ownerName: "Maya Kovacs",
        ownerInitials: "MK",
        live: true,
        time: "Started 2 Aug at 09:14",
        watching: 3,
    },
    {
        id: "s2",
        title: "Migrating the workspace",
        ownerName: "Jun Park",
        ownerInitials: "JP",
        ownerPhotoUrl: PORTRAIT,
        live: true,
        time: "Started yesterday",
        watching: 1,
    },
    {
        id: "s3",
        title: "Retina capture drift in WebKit",
        ownerName: "Amara Achebe",
        ownerInitials: "AA",
        live: true,
        time: "Started 30 Jul",
        watching: 2,
    },
];

const ended: readonly SharedSessionRow[] = [
    {
        id: "e1",
        title: "Token rotation race condition",
        ownerName: "Maya Kovacs",
        ownerInitials: "MK",
        live: false,
        endedReason: "The owner stopped sharing",
        time: "Ended 2 Aug at 11:02",
    },
    {
        id: "e2",
        title: "Migrating the workspace",
        ownerName: "Jun Park",
        ownerInitials: "JP",
        ownerPhotoUrl: PORTRAIT,
        live: false,
        endedReason: "The owner removed you",
        time: "Ended yesterday",
    },
    {
        id: "e3",
        title: "Retina capture drift in WebKit",
        ownerName: "Amara Achebe",
        ownerInitials: "AA",
        live: false,
        endedReason: "This machine can no longer read it",
        time: "Ended 30 Jul",
    },
];

export function SharedSessionsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-018"
            summary="The sessions other people are showing this machine. A replica is somebody else's work, so the row leads with them; the one act a member has is to open one and read it, and that is all the surface offers."
            title="SharedSessionsPage"
        >
            <FullScreenSpecimen
                detail="Before the first reading: nothing is claimed about who is showing what, because nothing is known yet."
                label="Loading"
                number="01"
            >
                <SharedSessionsPage loading />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Nobody has shared anything. It says what would make one appear rather than only that there is nothing."
                label="Empty"
                number="02"
            >
                <SharedSessionsPage onSessionOpen={noop} sessions={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Three live replicas. The person comes first, then what they are showing, then whether it is still running and who else can see it."
                label="Three live"
                number="03"
            >
                <SharedSessionsPage onSessionOpen={noop} sessions={live} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Ended each way: stopped, revoked, and unreadable by this machine. They stay in the list and say what happened, because the question about a stopped replica is never where it went."
                label="Ended"
                number="04"
            >
                <SharedSessionsPage onSessionOpen={noop} sessions={ended} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Live and ended together, which is the ordinary state of this list after a week."
                label="Mixed"
                number="05"
            >
                <SharedSessionsPage
                    onSessionOpen={noop}
                    sessions={[live[0]!, ended[1]!, live[2]!, ended[2]!]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The reading failed: what was last seen stays readable and the failure is stated above it."
                label="Out of date"
                number="06"
            >
                <SharedSessionsPage
                    error="The Rig did not answer the last read."
                    onSessionOpen={noop}
                    sessions={live}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A machine that cannot do this at all. It says so plainly rather than showing an empty list that will never fill."
                label="Unavailable"
                number="07"
            >
                <SharedSessionsPage unavailable="This Rig does not carry session sharing yet. Update it to watch a session someone shares with you." />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
