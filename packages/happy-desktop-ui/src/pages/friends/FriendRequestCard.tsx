import type { CSSProperties } from "react";
import type {
    RigFriendAnswer,
    RigFriendRequest,
    RigFriendRequestId,
    RigFriendsAnswerState,
} from "happy-desktop-state";
import { rigFriendInitials, rigFriendName } from "happy-desktop-state";
import { Avatar } from "../../Avatar";
import { Button } from "../../Button";

export interface FriendRequestCardProps {
    request: RigFriendRequest;
    /** How the answer already given is going, when one has been given. */
    answer?: RigFriendsAnswerState;
    onAnswer: (requestId: RigFriendRequestId, answer: RigFriendAnswer) => void;
    disabled?: boolean;
    /** When the request arrived, in the words the surface uses for time. */
    time?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendRequestCard — one person asking to connect, and the two answers.
 *
 * A request is a person, so the card is mostly their face and their name; the
 * words between them only say what is being asked. Accepting is the ordinary
 * thing to do, so it takes the solid button and sits first; declining is quiet
 * beside it rather than dressed as a danger, because turning someone down is not
 * a destructive act.
 *
 * The card never removes itself. It shows the answer it was given as under way
 * and keeps the person on screen until the owner says the request is settled.
 */
export function FriendRequestCard(props: FriendRequestCardProps) {
    const request = props.request;
    const answer = props.answer;
    const pending = answer?.type === "pending";
    const name = rigFriendName(request.profile);
    return (
        <article
            className={["happy2-friend-request", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="friend-request"
            data-request-id={request.id}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-friend-request__person">
                <Avatar
                    aria-label={name}
                    className="happy2-friend-request__avatar"
                    {...(request.profile.photoUrl ? { imageUrl: request.profile.photoUrl } : {})}
                    initials={rigFriendInitials(request.profile)}
                    size="lg"
                />
                <div className="happy2-friend-request__identity">
                    <span
                        className="happy2-friend-request__name"
                        data-happy-desktop-ui="friend-request-name"
                    >
                        {name}
                    </span>
                    <span className="happy2-friend-request__note">
                        <span className="happy2-friend-request__ask">wants to connect</span>
                        {props.time ? (
                            <span className="happy2-friend-request__time">{props.time}</span>
                        ) : null}
                    </span>
                </div>
            </div>

            <div className="happy2-friend-request__actions">
                {/* Spoken as well as shown: the answer leaves on its own, so
                    someone who is not watching this card still hears it go. */}
                {pending ? (
                    <span
                        className="happy2-friend-request__status"
                        data-happy-desktop-ui="friend-request-status"
                        role="status"
                    >
                        {answer.answer === "accept" ? "Accepting…" : "Declining…"}
                    </span>
                ) : null}
                <Button
                    disabled={pending || props.disabled}
                    onClick={() => props.onAnswer(request.id, "reject")}
                    size="medium"
                    variant="ghost"
                >
                    Decline
                </Button>
                <Button
                    disabled={pending || props.disabled}
                    onClick={() => props.onAnswer(request.id, "accept")}
                    size="medium"
                    variant="primary"
                >
                    Accept
                </Button>
            </div>

            {answer?.type === "failed" ? (
                <p
                    className="happy2-friend-request__error"
                    data-happy-desktop-ui="friend-request-error"
                    role="alert"
                >
                    {answer.error.message}
                </p>
            ) : null}
        </article>
    );
}
