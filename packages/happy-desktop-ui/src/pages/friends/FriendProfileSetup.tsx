import type { CSSProperties } from "react";
import type { RigFriendsProfileDraft } from "happy-desktop-state";
import { Button } from "../../Button";
import { TextField } from "../../TextField";
import { Ionicon } from "../../vectorIcons/VectorIcon";

export interface FriendProfileSetupProps {
    /** The profile being filled in, including how the last attempt to create it went. */
    draft: RigFriendsProfileDraft;
    onFirstNameChange: (value: string) => void;
    onLastNameChange: (value: string) => void;
    /** Hands up the picture the person chose, as the file they picked. */
    onPhotoSelect: (file: File) => void;
    onPhotoRemove: () => void;
    onSubmit: () => void;
    /** Keeps the profile draft editable while creation cannot reach the Rig. */
    submitDisabled?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * FriendProfileSetup — the first thing Friends asks for: who you are.
 *
 * Connecting to someone means giving them a name and a face, so this is a
 * greeting rather than a form. The picture is the largest thing on the page
 * because it is the part that makes the exchange feel like people, and it is
 * the part that may be left out. Both names are asked for: the network this
 * profile is created in stores a full name and refuses half of one, so a form
 * that accepted a single name was promising something the account could not be.
 *
 * It renders exactly the draft it is handed and reports every keystroke and the
 * decision upward. It holds no profile of its own, so the page it becomes is
 * whatever the owner does with what it sends.
 */
export function FriendProfileSetup(props: FriendProfileSetupProps) {
    const draft = props.draft;
    const photo = draft.photo;
    const ready =
        draft.firstName.trim() !== "" &&
        draft.lastName.trim() !== "" &&
        !draft.submitting &&
        !props.submitDisabled;
    return (
        <div
            className={["happy2-friend-setup", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="friend-setup"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div
                className="happy2-friend-setup__scroll"
                data-happy-desktop-ui="friend-setup-scroll"
            >
                <form
                    className="happy2-friend-setup__card"
                    data-happy-desktop-ui="friend-setup-card"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (ready) props.onSubmit();
                    }}
                >
                    {/* The picture is the greeting, so it leads and everything
                        else is read under it. The label is the control: the
                        input itself is hidden because a browser file button is
                        not a face. */}
                    <label
                        className="happy2-friend-setup__photo"
                        data-happy-desktop-ui="friend-setup-photo"
                    >
                        <input
                            accept="image/*"
                            aria-label="Choose a photo"
                            className="happy2-friend-setup__photo-input"
                            disabled={draft.submitting}
                            onChange={(event) => {
                                const input = event.currentTarget;
                                const file = input.files?.[0];
                                // Cleared so choosing the same picture again is
                                // still a change the browser reports.
                                input.value = "";
                                if (file) props.onPhotoSelect(file);
                            }}
                            type="file"
                        />
                        {/* The well is the picture's own frame rather than an
                            Avatar: this is the picture being chosen at the size
                            it is being judged at, not a person's mark in a row. */}
                        <span
                            aria-hidden="true"
                            className="happy2-friend-setup__photo-well"
                            data-happy-desktop-ui="friend-setup-photo-well"
                        >
                            {photo ? (
                                <img
                                    alt=""
                                    className="happy2-friend-setup__photo-image"
                                    draggable={false}
                                    src={photo.previewUrl}
                                />
                            ) : (
                                <Ionicon name="camera-outline" size={28} />
                            )}
                        </span>
                        <span className="happy2-friend-setup__photo-label">
                            {photo ? "Change photo" : "Add a photo"}
                        </span>
                    </label>

                    {photo ? (
                        <Button
                            disabled={draft.submitting}
                            onClick={props.onPhotoRemove}
                            size="small"
                            variant="ghost"
                        >
                            Remove photo
                        </Button>
                    ) : null}

                    <div
                        className="happy2-friend-setup__intro"
                        data-happy-desktop-ui="friend-setup-intro"
                    >
                        <h1 className="happy2-friend-setup__title">Say hello</h1>
                        <p className="happy2-friend-setup__description">
                            Friends is how the people you work with reach you. Tell them who is
                            answering.
                        </p>
                    </div>

                    <div className="happy2-friend-setup__fields">
                        <TextField
                            autoComplete="given-name"
                            disabled={draft.submitting}
                            fullWidth
                            label="First name"
                            onValueChange={props.onFirstNameChange}
                            placeholder="Ada"
                            required
                            size="large"
                            value={draft.firstName}
                        />
                        <TextField
                            autoComplete="family-name"
                            disabled={draft.submitting}
                            fullWidth
                            label="Last name"
                            onValueChange={props.onLastNameChange}
                            placeholder="Lovelace"
                            required
                            size="large"
                            value={draft.lastName}
                        />
                    </div>

                    {draft.error ? (
                        <p
                            className="happy2-friend-setup__error"
                            data-happy-desktop-ui="friend-setup-error"
                            role="alert"
                        >
                            {draft.error.message}
                        </p>
                    ) : null}

                    <Button
                        disabled={!ready}
                        fullWidth
                        size="large"
                        type="submit"
                        variant="primary"
                    >
                        {draft.submitting ? "Creating your profile…" : "Create profile"}
                    </Button>
                </form>
            </div>
        </div>
    );
}
