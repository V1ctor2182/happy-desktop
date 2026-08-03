import type { CSSProperties } from "react";
import type {
    RigFriend,
    RigFriendAnswer,
    RigFriendId,
    RigFriendRequest,
    RigFriendRequestId,
    RigFriendsAccount,
    RigFriendsAnswerState,
    RigFriendsProfileDraft,
    UserError,
} from "happy2-state";
import { rigFriendInitials, rigFriendName } from "happy2-state";
import { Avatar } from "../../Avatar";
import { Banner } from "../../Banner";
import { EmptyState } from "../../EmptyState";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { Toolbar } from "../../Toolbar";
import { FriendProfileSetup } from "./FriendProfileSetup";
import { FriendRequestCard } from "./FriendRequestCard";

export interface FriendsPageProps {
    /** This account's own profile. Absent means there is no profile yet. */
    account?: RigFriendsAccount;
    /** People asking to connect, most recent first. */
    requests?: readonly RigFriendRequest[];
    /** People already connected. */
    friends?: readonly RigFriend[];
    /** True before the first reading arrives, so "no one yet" is not claimed early. */
    loading?: boolean;
    /** The feed itself failed; whatever was last read stays readable beneath it. */
    error?: UserError;
    /** In-flight and failed answers, by request. */
    answers?: ReadonlyMap<RigFriendRequestId, RigFriendsAnswerState>;
    onRequestAnswer?: (requestId: RigFriendRequestId, answer: RigFriendAnswer) => void;
    /** The profile being filled in; required to offer the greeting at all. */
    profileDraft?: RigFriendsProfileDraft;
    onFirstNameChange?: (value: string) => void;
    onLastNameChange?: (value: string) => void;
    onPhotoSelect?: (file: File) => void;
    onPhotoRemove?: () => void;
    onProfileCreate?: () => void;
    /** Why this machine cannot do Friends at all, when it cannot. */
    unavailable?: string;
    /** Opens one person. Omit it while there is nowhere for a row to go. */
    onFriendOpen?: (id: RigFriendId) => void;
    /** When a request arrived, in the words the surface uses for time. */
    requestTime?: (request: RigFriendRequest) => string | undefined;
    /** When a person was connected, in the same words. */
    friendTime?: (friend: RigFriend) => string | undefined;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendsPage — who you are here, who is asking for you, and who you already
 * know.
 *
 * The three are one screen because they are one story: a request means nothing
 * without a profile to accept it with, and the list of people is what accepting
 * produces. So an account that does not exist yet is not an empty list — it is
 * the greeting, and the whole surface becomes the question of who you are.
 *
 * People are drawn as people: a face, a name, and nothing around them, on the
 * quiet grouped paper the rest of the product uses for a reading. Requests are
 * the exception and get a card of their own, because they are the one thing
 * here that is waiting on a decision.
 *
 * It renders exactly what it is handed and reports every answer and keystroke
 * upward, holding no list and no profile of its own.
 */
export function FriendsPage(props: FriendsPageProps) {
    const requests = props.requests ?? [];
    const friends = props.friends ?? [];
    const account = props.account;
    const draft = props.profileDraft;

    // The greeting is the whole surface: someone with no profile has no count to
    // read and no list to head, so the header stands down for it.
    if (!props.unavailable && !account && !props.loading && draft)
        return (
            <div
                className={["happy2-friends", props.className].filter(Boolean).join(" ")}
                data-happy2-ui="friends"
                data-state="greeting"
                data-testid={props["data-testid"]}
                style={props.style}
            >
                <FriendProfileSetup
                    draft={draft}
                    onFirstNameChange={(value) => props.onFirstNameChange?.(value)}
                    onLastNameChange={(value) => props.onLastNameChange?.(value)}
                    onPhotoRemove={() => props.onPhotoRemove?.()}
                    onPhotoSelect={(file) => props.onPhotoSelect?.(file)}
                    onSubmit={() => props.onProfileCreate?.()}
                />
            </div>
        );

    return (
        <div
            className={["happy2-friends", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="friends"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-friends__header" data-happy2-ui="friends-header">
                <Toolbar
                    height={SURFACE_HEADER_HEIGHT}
                    subtitle={
                        props.unavailable
                            ? "Not available here"
                            : friendsSubtitle(requests.length, friends.length, props.loading)
                    }
                    title="Friends"
                    titleLevel={1}
                />
            </div>
            <div className="happy2-friends__scroll" data-happy2-ui="friends-scroll">
                <div className="happy2-friends__content" data-happy2-ui="friends-content">
                    {props.error ? (
                        <Banner tone="danger" title="Friends may be out of date">
                            {props.error.message}
                        </Banner>
                    ) : null}

                    {props.unavailable ? (
                        <EmptyState
                            description={props.unavailable}
                            icon="users"
                            title="Friends is not here yet"
                        />
                    ) : null}

                    {!props.unavailable && !account && props.loading ? (
                        <EmptyState
                            animation="snail"
                            description="Reading who this machine knows."
                            icon="clock"
                            title="Loading friends…"
                        />
                    ) : null}

                    {account ? <ProfileHero account={account} /> : null}

                    {requests.length > 0 ? (
                        <section
                            className="happy2-friends__section"
                            data-happy2-ui="friends-requests"
                        >
                            <SectionLabel count={requests.length} label="Requests" />
                            <div className="happy2-friends__requests">
                                {requests.map((request) => {
                                    const answer = props.answers?.get(request.id);
                                    const time = props.requestTime?.(request);
                                    return (
                                        <FriendRequestCard
                                            {...(answer ? { answer } : {})}
                                            key={request.id}
                                            onAnswer={(requestId, given) =>
                                                props.onRequestAnswer?.(requestId, given)
                                            }
                                            request={request}
                                            {...(time === undefined ? {} : { time })}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {account ? (
                        <section
                            className="happy2-friends__section"
                            data-happy2-ui="friends-people"
                        >
                            <SectionLabel count={friends.length} label="People" />
                            {friends.length === 0 ? (
                                <p
                                    className="happy2-friends__nobody"
                                    data-happy2-ui="friends-nobody"
                                >
                                    Nobody yet. When someone asks to connect, they arrive here.
                                </p>
                            ) : (
                                <div className="happy2-friends__list" data-happy2-ui="friends-list">
                                    {friends.map((friend) => {
                                        const time = props.friendTime?.(friend);
                                        const row = (
                                            <FriendRow
                                                friend={friend}
                                                {...(time === undefined ? {} : { time })}
                                            />
                                        );
                                        return props.onFriendOpen ? (
                                            <button
                                                className="happy2-friends__row"
                                                data-happy2-ui="friends-row"
                                                key={friend.id}
                                                onClick={() => props.onFriendOpen?.(friend.id)}
                                                type="button"
                                            >
                                                {row}
                                            </button>
                                        ) : (
                                            <div
                                                className="happy2-friends__row"
                                                data-happy2-ui="friends-row"
                                                key={friend.id}
                                            >
                                                {row}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/**
 * You, at the top of your own screen. It is not a card and carries no action:
 * it exists so the person can see the face and name everyone else is being
 * shown, which is the only place that is ever visible to them.
 */
function ProfileHero({ account }: { account: RigFriendsAccount }) {
    const name = rigFriendName(account.profile);
    return (
        <div className="happy2-friends__hero" data-happy2-ui="friends-hero">
            <Avatar
                aria-label={name}
                {...(account.profile.photoUrl ? { imageUrl: account.profile.photoUrl } : {})}
                initials={rigFriendInitials(account.profile)}
                size="lg"
            />
            <span className="happy2-friends__hero-identity">
                <span className="happy2-friends__hero-name" data-happy2-ui="friends-hero-name">
                    {name}
                </span>
                <span className="happy2-friends__hero-note">This is how you appear</span>
            </span>
        </div>
    );
}

/** The name of a run of people and how many are in it. */
function SectionLabel(props: { count: number; label: string }) {
    return (
        <h2 className="happy2-friends__section-title" data-happy2-ui="friends-section-title">
            <span className="happy2-friends__section-label">{props.label}</span>
            <span className="happy2-friends__section-count">{props.count}</span>
        </h2>
    );
}

/**
 * One person. The face and the name are the row; when they joined closes it,
 * because that is the only other thing known about a connection.
 */
function FriendRow({ friend, time }: { friend: RigFriend; time?: string }) {
    const name = rigFriendName(friend.profile);
    return (
        <>
            <Avatar
                className="happy2-friends__avatar"
                {...(friend.profile.photoUrl ? { imageUrl: friend.profile.photoUrl } : {})}
                initials={rigFriendInitials(friend.profile)}
                size="lg"
            />
            <span className="happy2-friends__body">
                <span className="happy2-friends__name" data-happy2-ui="friends-name">
                    {name}
                </span>
                {time ? <span className="happy2-friends__secondary">{time}</span> : null}
            </span>
        </>
    );
}

/** What the header says is here, read once at the top. */
function friendsSubtitle(requests: number, friends: number, loading?: boolean): string {
    if (loading && requests === 0 && friends === 0) return "Loading…";
    const people = friends === 0 ? "No one yet" : friends === 1 ? "1 person" : `${friends} people`;
    if (requests === 0) return people;
    return `${requests === 1 ? "1 request" : `${requests} requests`} · ${people}`;
}
