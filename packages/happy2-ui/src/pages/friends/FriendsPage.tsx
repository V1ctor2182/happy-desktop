import type { CSSProperties } from "react";
import { ProfileCard, type ProfilePresence, type ProfileStatus } from "../../ProfileCard";
import { Toolbar } from "../../Toolbar";

export interface Friend {
    id: string;
    name: string;
    /** The handle shown beside the name, without its `@`. */
    username: string;
    /** What they do or where they are, under the name. */
    title?: string;
    imageUrl?: string;
    initials: string;
    presence?: ProfilePresence;
    status?: ProfileStatus;
}

export interface FriendsPageProps {
    /** The people to show, in the order they should be read. */
    friends: readonly Friend[];
    /** Opens one person. Omit it while there is nowhere for a tile to go. */
    onFriendOpen?: (id: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendsPage — the people this account is connected to, as a gallery of tiles.
 *
 * A person is recognised by their face before their name, so this surface fills
 * the window with cards rather than holding a reading column: the point of the
 * screen is to scan faces. It renders exactly the people it is handed and
 * reports a click upward; it holds no list of its own.
 */
export function FriendsPage(props: FriendsPageProps) {
    return (
        <div
            className={["happy2-friends", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="friends"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-friends__header" data-happy2-ui="friends-header">
                <Toolbar subtitle={friendsSubtitle(props.friends.length)} title="Friends" />
            </div>
            <div className="happy2-friends__scroll" data-happy2-ui="friends-scroll">
                <div className="happy2-friends__grid" data-happy2-ui="friends-grid">
                    {props.friends.map((friend) =>
                        props.onFriendOpen ? (
                            <button
                                className="happy2-friends__tile"
                                data-happy2-ui="friends-tile"
                                key={friend.id}
                                onClick={() => props.onFriendOpen?.(friend.id)}
                                type="button"
                            >
                                <FriendTile friend={friend} />
                            </button>
                        ) : (
                            <FriendTile friend={friend} key={friend.id} />
                        ),
                    )}
                </div>
            </div>
        </div>
    );
}

function FriendTile({ friend }: { friend: Friend }) {
    return (
        <ProfileCard
            imageUrl={friend.imageUrl}
            initials={friend.initials}
            name={friend.name}
            presence={friend.presence}
            size="compact"
            status={friend.status}
            title={friend.title}
            username={friend.username}
        />
    );
}

/** Names how many people are here, so the count is read once at the top. */
function friendsSubtitle(count: number): string {
    if (count === 0) return "No one yet";
    return count === 1 ? "1 person" : `${count} people`;
}
