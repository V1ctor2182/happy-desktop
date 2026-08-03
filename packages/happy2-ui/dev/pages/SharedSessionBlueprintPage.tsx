import type {
    ComposerSnapshot,
    ConversationAuthor,
    ConversationEntry,
    ConversationMessageEntry,
} from "happy2-state";
import { SharedSessionView } from "../../src/pages/shared/SharedSessionView";
import { ComponentPage, FullScreenSpecimen } from "../kit";
import { conversationEntries } from "./rigChatFixtures";

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

/**
 * A friend writing into somebody else's session. The identity is the ordinary
 * human author the state layer supplies — attributed by the name the owner
 * registered, never one carried over the wire — so it takes the transcript's
 * existing incoming-human treatment with no row type of its own.
 */
function friendMessage(
    id: string,
    sequence: string,
    name: string,
    text: string,
): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: "ses_alpha01234567",
            sequence,
            changePts: sequence,
            sender: {
                id: "rig:friend:m2",
                displayName: name,
                username: "friend",
                kind: "human",
            },
            kind: "user",
            automated: false,
            audience: "agents",
            agentUserIds: [],
            text,
            revision: 0,
            mentions: [],
            attachments: [],
            reactions: [],
            receipts: [],
            expiryMode: "none",
            createdAt: "2026-07-25T09:44:00.000Z",
        },
    };
}

const agentAuthor: ConversationAuthor = {
    id: "rig:agent",
    displayName: "Happy",
    username: "happy",
    kind: "agent",
    agentRole: "default",
};

/* The replica the reader sees: the owner's own transcript with a friend's
   message posted into the middle of it. */
const entries: readonly ConversationEntry[] = [
    ...conversationEntries.slice(0, 4),
    friendMessage("fr1", "3.5", "Jun Park", "Does the blocking lock hold across the retry?"),
    ...conversationEntries.slice(4),
];

const composer: ComposerSnapshot = {
    scopeId: "share:s2",
    text: "",
    attachments: [],
    revision: 0,
    submission: { status: "idle" },
    focused: false,
    capabilities: { shellMode: false, commands: [], mentions: false },
    mentionCandidates: [],
    agentUserIds: [],
};

const typedComposer: ComposerSnapshot = {
    ...composer,
    text: "Does the blocking lock hold across the retry?",
};

const owner = {
    ownerName: "Maya Kovacs",
    ownerInitials: "MK",
    ownerPhotoUrl: PORTRAIT,
    title: "Token rotation race condition",
} as const;

export function SharedSessionBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-019"
            summary="Somebody else's session, replicated and read here. The header names the person whose work this is, a permanent strip says the screen cannot be written to, and every write-side callback of an entry is left out on purpose."
            title="SharedSessionView"
        >
            <FullScreenSpecimen
                detail="Before the first page arrives: nothing is drawn that would imply the transcript is empty rather than unread."
                label="Loading"
                number="01"
            >
                <SharedSessionView {...owner} entries={[]} live loading />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Live, with the whole replicated transcript and a message being written back to the owner. A friend's message in the middle takes the transcript's existing incoming-human treatment: a face, the name the owner registered, and a neutral bubble on the left — unmistakable against the agent's unbubbled prose."
                label="Live"
                number="02"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    composer={composer}
                    entries={entries}
                    live
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                    viewerId="rig:friend:m2"
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The replica has not caught up to the present yet, so the list ends with the way on to it. It is the last row rather than chrome, so it scrolls away once the reader has reached the present."
                label="Newer messages"
                number="03"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    composer={composer}
                    entries={entries}
                    live
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                    onLoadMore={noop}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A further page towards the present is being read: the affordance says so and is held, and nothing already on screen moves."
                label="Catching up"
                number="04"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    composer={composer}
                    entries={entries}
                    live
                    loadingMore
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                    onLoadMore={noop}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The replica has caught up to the present, so there is nothing left to ask for and no affordance offering to."
                label="Complete"
                number="05"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    composer={typedComposer}
                    entries={entries}
                    live
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Ended because the owner removed this reader. The strip says which of the two endings happened, in the same place it said the session was live, so a replica that stopped receiving is never read as one that went quiet."
                label="Ended · removed"
                number="06"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    endedReason="The owner removed you"
                    entries={entries}
                    live={false}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Ended because the owner stopped sharing altogether. Nothing is offered to restart it, because nothing can."
                label="Ended · stopped"
                number="07"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    endedReason="The owner stopped sharing"
                    entries={entries}
                    live={false}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The feed failed: everything already read stays readable, and the failure is stated above it rather than replacing it."
                label="Out of date"
                number="08"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    composer={composer}
                    entries={entries}
                    error="The Rig did not answer the last read."
                    live
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A message cannot be sent right now. The reason is said above the composer and the composer itself goes inert, rather than a send that silently does nothing."
                label="Composer refused"
                number="09"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    composer={typedComposer}
                    composerRefusal="The owner has turned off messages from the people watching, so this will not reach the agent."
                    entries={entries}
                    live
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A replica with nothing in it yet, and no composer: what a member reads when the owner shares a session before saying anything in it."
                label="Nothing yet"
                number="10"
            >
                <SharedSessionView {...owner} complete entries={[]} live />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A back affordance in the header leaves this replica and returns to the sessions shared with you. It reads as leaving somebody else's session, not as closing your own work."
                label="Back to the list"
                number="11"
            >
                <SharedSessionView
                    {...owner}
                    agentAuthor={agentAuthor}
                    complete
                    composer={composer}
                    entries={entries}
                    live
                    onClose={noop}
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
