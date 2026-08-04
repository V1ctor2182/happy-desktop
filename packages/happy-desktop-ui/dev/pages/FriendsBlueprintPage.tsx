import {
    UserError,
    type RigFriend,
    type RigFriendId,
    type RigFriendRequest,
    type RigFriendRequestId,
    type RigFriendsAccount,
    type RigFriendsAnswerState,
    type RigFriendsInviteDraft,
    type RigFriendsProfileDraft,
} from "happy-desktop-state";
import { FriendsPage } from "../../src/pages/friends/FriendsPage";
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

const account: RigFriendsAccount = {
    id: "self",
    profile: { firstName: "Steve", lastName: "Korshakov", photoUrl: PORTRAIT },
    token: "mur_7Qc4Kk2ZpN8vWx1LdT6hRjF3sYbA0eGuMn5oPqI9CvXzHlSrEt",
};

const emptyInvite: RigFriendsInviteDraft = { token: "", submitting: false, sent: false };

const sendingInvite: RigFriendsInviteDraft = {
    token: "mur_3Bd9Nn5XkQ2rTy8MfW1jHcZ4pLvA6eGsUo0iRqK7CtYbEmSxDl",
    submitting: true,
    sent: false,
};

const sentInvite: RigFriendsInviteDraft = { token: "", submitting: false, sent: true };

const refusedInvite: RigFriendsInviteDraft = {
    token: "not-a-code",
    submitting: false,
    sent: false,
    error: new UserError("That code is not one this network knows."),
};

const requests: readonly RigFriendRequest[] = [
    {
        id: "r1" as RigFriendRequestId,
        senderId: "s1",
        profile: { firstName: "Maya", lastName: "Kovacs" },
        receivedAt: 1_754_000_000_000,
    },
    {
        id: "r2" as RigFriendRequestId,
        senderId: "s2",
        profile: { firstName: "Jun", photoUrl: PORTRAIT },
        receivedAt: 1_753_900_000_000,
    },
];

const friends: readonly RigFriend[] = [
    {
        id: "f1" as RigFriendId,
        profile: { firstName: "Tomas", lastName: "Oduya" },
        addedAt: 1_753_000_000_000,
    },
    {
        id: "f2" as RigFriendId,
        profile: { firstName: "Saoirse", lastName: "Ronan-Bell", photoUrl: PORTRAIT },
        addedAt: 1_752_000_000_000,
    },
    {
        id: "f3" as RigFriendId,
        profile: { firstName: "Amara", lastName: "Achebe" },
        addedAt: 1_751_000_000_000,
    },
];

const answering: ReadonlyMap<RigFriendRequestId, RigFriendsAnswerState> = new Map([
    ["r1" as RigFriendRequestId, { type: "pending", answer: "accept" } as RigFriendsAnswerState],
    [
        "r2" as RigFriendRequestId,
        {
            type: "failed",
            answer: "reject",
            error: new UserError("The relay did not answer. Try again."),
        } as RigFriendsAnswerState,
    ],
]);

const emptyDraft: RigFriendsProfileDraft = { firstName: "", lastName: "", submitting: false };

const filledDraft: RigFriendsProfileDraft = {
    firstName: "Ada",
    lastName: "Lovelace",
    photo: { data: "", mediaType: "image/png", previewUrl: PORTRAIT },
    submitting: false,
};

const submittingDraft: RigFriendsProfileDraft = {
    firstName: "Ada",
    lastName: "",
    submitting: true,
};

const failedDraft: RigFriendsProfileDraft = {
    firstName: "Ada",
    lastName: "Lovelace",
    submitting: false,
    error: new UserError("The relay refused the name. Try a shorter one."),
};

const noop = () => undefined;

/** The times the surface prints, fixed so every capture is identical. */
const requestTime = () => "2 Aug at 09:14";
const friendTime = () => "Connected 12 Mar";

export function FriendsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-014"
            summary="Who you are here, who is asking for you, and who you already know. A profile that does not exist yet is not an empty list: it is the greeting, and it becomes the whole surface."
            title="FriendsPage"
        >
            <FullScreenSpecimen
                detail="No profile yet: the greeting takes the screen. The picture leads because it is the part that makes the exchange feel like people; only the first name is required."
                label="Greeting"
                number="01"
            >
                <FriendsPage
                    onFirstNameChange={noop}
                    onLastNameChange={noop}
                    onPhotoRemove={noop}
                    onPhotoSelect={noop}
                    onProfileCreate={noop}
                    profileDraft={emptyDraft}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A name typed and a picture chosen: the well holds the picture at the size it is being judged at, and the way to take it back off appears under it."
                label="Greeting · filled in"
                number="02"
            >
                <FriendsPage
                    onFirstNameChange={noop}
                    onLastNameChange={noop}
                    onPhotoRemove={noop}
                    onPhotoSelect={noop}
                    onProfileCreate={noop}
                    profileDraft={filledDraft}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The profile is with the daemon: every control is held and the button says what is happening rather than going quiet."
                label="Greeting · creating"
                number="03"
            >
                <FriendsPage
                    onFirstNameChange={noop}
                    onLastNameChange={noop}
                    onPhotoRemove={noop}
                    onPhotoSelect={noop}
                    onProfileCreate={noop}
                    profileDraft={submittingDraft}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The daemon refused: what it said is printed under the fields, and everything typed is still there to correct."
                label="Greeting · refused"
                number="04"
            >
                <FriendsPage
                    onFirstNameChange={noop}
                    onLastNameChange={noop}
                    onPhotoRemove={noop}
                    onPhotoSelect={noop}
                    onProfileCreate={noop}
                    profileDraft={failedDraft}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A profile, the code that reaches it, two people asking, and three already connected. Requests are the only thing given a card of their own, because they are the only thing waiting on a decision."
                label="Requests and people"
                number="05"
            >
                <FriendsPage
                    account={account}
                    friends={friends}
                    friendTime={friendTime}
                    invite={emptyInvite}
                    onInviteSend={noop}
                    onInviteTokenChange={noop}
                    onRequestAnswer={noop}
                    profileDraft={emptyDraft}
                    requests={requests}
                    requestTime={requestTime}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="One answer under way and one that failed: the card holds both buttons while it waits, and says what went wrong without removing the person."
                label="Answers"
                number="06"
            >
                <FriendsPage
                    account={account}
                    answers={answering}
                    friends={friends}
                    friendTime={friendTime}
                    onRequestAnswer={noop}
                    profileDraft={emptyDraft}
                    requests={requests}
                    requestTime={requestTime}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A profile with nobody in it yet: the exchange is the whole screen, which is right, because handing the code over is the only thing left to do."
                label="Nobody yet"
                number="07"
            >
                <FriendsPage
                    account={account}
                    friends={[]}
                    invite={emptyInvite}
                    onInviteSend={noop}
                    onInviteTokenChange={noop}
                    profileDraft={emptyDraft}
                    requests={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A pasted code on its way to the daemon: the field and the button are held, and the button says what is happening rather than going quiet."
                label="Sending a request"
                number="11"
            >
                <FriendsPage
                    account={account}
                    friends={friends}
                    friendTime={friendTime}
                    invite={sendingInvite}
                    onInviteSend={noop}
                    onInviteTokenChange={noop}
                    profileDraft={emptyDraft}
                    requests={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The request left. An outgoing request is in none of the lists here, so this line is the only word that it happened, and it holds until the next code is typed."
                label="Request sent"
                number="12"
            >
                <FriendsPage
                    account={account}
                    friends={friends}
                    friendTime={friendTime}
                    invite={sentInvite}
                    onInviteSend={noop}
                    onInviteTokenChange={noop}
                    profileDraft={emptyDraft}
                    requests={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The code was refused: what the daemon said sits under the field, and the code stays in it, because a refused code is usually one to look at again rather than retype."
                label="Code refused"
                number="13"
            >
                <FriendsPage
                    account={account}
                    friends={friends}
                    friendTime={friendTime}
                    invite={refusedInvite}
                    onInviteSend={noop}
                    onInviteTokenChange={noop}
                    profileDraft={emptyDraft}
                    requests={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Before the first reading: nothing is claimed about who is here, because nothing is known yet."
                label="Loading"
                number="08"
            >
                <FriendsPage loading profileDraft={emptyDraft} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The reading failed: the people last seen stay readable and the failure is stated above them."
                label="Out of date"
                number="09"
            >
                <FriendsPage
                    account={account}
                    error={new UserError("The Rig did not answer the last read.")}
                    friends={friends}
                    friendTime={friendTime}
                    profileDraft={emptyDraft}
                    requests={[]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A machine that cannot do this at all. It says so plainly rather than offering a greeting that cannot be answered."
                label="Unavailable"
                number="10"
            >
                <FriendsPage unavailable="This Rig does not carry the friends service yet. Update it to connect with people." />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
