import type { CSSProperties } from "react";
import type { RigFriendsInviteDraft } from "happy-desktop-state";
import { Button } from "../../Button";
import { CopyButton } from "../../CopyButton";
import { TextField } from "../../TextField";

export interface FriendInviteProps {
    /** This machine's own code, the thing another one needs in order to ask for it. */
    code: string;
    /** The code being pasted in, and how the last attempt to use it went. */
    draft: RigFriendsInviteDraft;
    onCodeChange: (value: string) => void;
    onSend: () => void;
    /** Keeps the pasted-code draft editable while its network submission is unavailable. */
    submitDisabled?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendInvite — the two halves of reaching someone: the code you hand out, and
 * the one you were handed.
 *
 * They are one object because they are one act performed from both ends. A
 * person opening this is either about to give their code away or about to paste
 * somebody else's in, and having to look in two places for the two directions of
 * the same exchange is what made connecting feel like configuration.
 *
 * The code is long and nobody reads it, so it is shown as evidence that one
 * exists and copied rather than transcribed. A sent request appears in none of
 * the lists on this surface — those are people asking for *us* — so the
 * confirmation under the field is the only word a person gets that it left, and
 * it holds until they start typing the next one.
 *
 * Props only: it renders the draft it is handed and reports every keystroke and
 * the decision upward.
 */
export function FriendInvite(props: FriendInviteProps) {
    const draft = props.draft;
    const ready = draft.token.trim() !== "" && !draft.submitting && !props.submitDisabled;
    return (
        <div
            className={["happy2-friend-invite", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="friend-invite"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-friend-invite__half" data-happy-desktop-ui="friend-invite-mine">
                <span className="happy2-friend-invite__label">Your code</span>
                {/* The well takes TextField's own control height and inset fill
                    and is plainly not editable: mono, secondary, and carrying
                    the copy where a caret would be. */}
                <div className="happy2-friend-invite__well">
                    <span
                        className="happy2-friend-invite__code"
                        data-happy-desktop-ui="friend-invite-code"
                        title={props.code}
                    >
                        {props.code}
                    </span>
                    <CopyButton
                        data-happy-desktop-ui="friend-invite-copy"
                        label="Copy your code"
                        text={props.code}
                    />
                </div>
                <span className="happy2-friend-invite__hint">
                    Give this to someone and they can ask to connect.
                </span>
            </div>

            <div className="happy2-friend-invite__half" data-happy-desktop-ui="friend-invite-send">
                <span className="happy2-friend-invite__label">Add someone</span>
                <form
                    className="happy2-friend-invite__form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (ready) props.onSend();
                    }}
                >
                    <TextField
                        aria-label="Their code"
                        className="happy2-friend-invite__field"
                        disabled={draft.submitting}
                        fullWidth
                        onValueChange={props.onCodeChange}
                        placeholder="Paste their code"
                        value={draft.token}
                    />
                    <Button disabled={!ready} type="submit" variant="primary">
                        {draft.submitting ? "Sending…" : "Send request"}
                    </Button>
                </form>
                {draft.error ? (
                    <span
                        className="happy2-friend-invite__error"
                        data-happy-desktop-ui="friend-invite-error"
                        role="alert"
                    >
                        {draft.error.message}
                    </span>
                ) : draft.sent ? (
                    <span
                        className="happy2-friend-invite__sent"
                        data-happy-desktop-ui="friend-invite-sent"
                        role="status"
                    >
                        Request sent. They see it when their machine is running.
                    </span>
                ) : (
                    <span className="happy2-friend-invite__hint">
                        They answer on their own machine, and appear here once they do.
                    </span>
                )}
            </div>
        </div>
    );
}
