import { FriendsPage, type Friend } from "../../src/pages/friends/FriendsPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

const friends: readonly Friend[] = [
    {
        id: "1",
        initials: "MK",
        name: "Maya Kovacs",
        presence: "online",
        status: { emoji: "🛠", text: "Shipping the parser" },
        title: "Compilers",
        username: "maya",
    },
    {
        id: "2",
        initials: "TO",
        name: "Tomas Oduya",
        presence: "online",
        title: "Infrastructure",
        username: "tomas",
    },
    {
        id: "3",
        initials: "SR",
        name: "Saoirse Ronan-Bell",
        presence: "offline",
        status: { emoji: "🌍", text: "Back Monday" },
        title: "Design systems",
        username: "saoirse",
    },
    { id: "4", initials: "JW", name: "Jun Wei", presence: "offline", username: "jun" },
    {
        id: "5",
        initials: "AA",
        name: "Amara Achebe",
        presence: "online",
        title: "Security",
        username: "amara",
    },
    {
        id: "6",
        initials: "LP",
        name: "Lars Pettersen",
        presence: "offline",
        status: { text: "Reviewing" },
        title: "Data",
        username: "lars",
    },
    { id: "7", initials: "NH", name: "Noor Haddad", presence: "online", username: "noor" },
];

export function FriendsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-014"
            summary="The people this account is connected to, read down one column the way a conversation is. Nothing is drawn around a person; a fill appears only under the pointer."
            title="FriendsPage"
        >
            <FullScreenSpecimen
                detail="Seven people. A row carries the face with its presence, the name and handle on one baseline, and what they do and are doing on the line beneath."
                label="List"
                number="01"
            >
                <FriendsPage friends={friends} onFriendOpen={() => undefined} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Nobody yet: the header still names the destination and counts what is there, and the column is simply empty."
                label="No one"
                number="02"
            >
                <FriendsPage friends={[]} />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
