import type { CSSProperties } from "react";
import { Avatar } from "../../Avatar";
import { EmptyState } from "../../EmptyState";
import type { ProfilePresence, ProfileStatus } from "../../ProfileCard";
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
    /** Opens one person. Omit it while there is nowhere for a row to go. */
    onFriendOpen?: (id: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendsPage — the people this account is connected to, read as a column.
 *
 * A person is a face and a name, so that is all a row draws: no card, no
 * hairline between neighbours, no fill until the pointer is on one. The list
 * sits in the same reading column a conversation uses, for the same reason —
 * names are read down a single edge, and a gallery of bordered tiles makes the
 * eye hunt across a grid for the one thing it came to find.
 *
 * It renders exactly the people it is handed and reports a click upward; it
 * holds no list of its own.
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
                <div className="happy2-friends__list" data-happy2-ui="friends-list">
                    {props.friends.length === 0 ? (
                        <EmptyState
                            description="People you connect with appear here, with what they are working on."
                            icon="users"
                            title="No one yet"
                        />
                    ) : null}
                    {props.friends.map((friend) =>
                        props.onFriendOpen ? (
                            <button
                                className="happy2-friends__row"
                                data-happy2-ui="friends-row"
                                key={friend.id}
                                onClick={() => props.onFriendOpen?.(friend.id)}
                                type="button"
                            >
                                <FriendRow friend={friend} />
                            </button>
                        ) : (
                            <div
                                className="happy2-friends__row"
                                data-happy2-ui="friends-row"
                                key={friend.id}
                            >
                                <FriendRow friend={friend} />
                            </div>
                        ),
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * One person. The name leads; the handle follows it on the same baseline
 * because it identifies rather than describes. What they are doing right now
 * closes the row, since that is the line most often being looked for.
 */
function FriendRow({ friend }: { friend: Friend }) {
    const status = friend.status;
    const hasStatus = Boolean(status && (status.emoji ?? status.text));
    return (
        <>
            <Avatar
                className="happy2-friends__avatar"
                imageUrl={friend.imageUrl}
                initials={friend.initials}
                online={friend.presence === "online" ? true : undefined}
                size="lg"
            />
            <span className="happy2-friends__body">
                <span className="happy2-friends__identity">
                    <span className="happy2-friends__name" data-happy2-ui="friends-name">
                        {friend.name}
                    </span>
                    <span className="happy2-friends__username">@{friend.username}</span>
                </span>
                {friend.title || hasStatus ? (
                    <span className="happy2-friends__secondary">
                        {friend.title ? (
                            <span className="happy2-friends__title">{friend.title}</span>
                        ) : null}
                        {friend.title && hasStatus ? (
                            <span aria-hidden="true" className="happy2-friends__dot">
                                ·
                            </span>
                        ) : null}
                        {status?.emoji ? (
                            <span className="happy2-friends__status-emoji">
                                <span className="happy2-friends__status-emoji-glyph">
                                    {status.emoji}
                                </span>
                            </span>
                        ) : null}
                        {status?.text ? (
                            <span className="happy2-friends__status-text">{status.text}</span>
                        ) : null}
                    </span>
                ) : null}
            </span>
        </>
    );
}

/** Names how many people are here, so the count is read once at the top. */
function friendsSubtitle(count: number): string {
    if (count === 0) return "No one yet";
    return count === 1 ? "1 person" : `${count} people`;
}
