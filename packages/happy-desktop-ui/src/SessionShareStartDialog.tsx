import { type CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Modal } from "./Modal";
import { Switch } from "./Switch";

export interface SessionShareCandidate {
    id: string;
    name: string;
    initials: string;
    photoUrl?: string;
}

export interface SessionShareStartDialogProps {
    /** Friends who can be given access. */
    candidates: readonly SessionShareCandidate[];
    /** Who is currently ticked. */
    selected: ReadonlySet<string>;
    onToggle: (candidateId: string) => void;
    /** Whether what friends write should reach the agent. */
    friendMessagesInContext: boolean;
    onFriendMessagesChange: (value: boolean) => void;
    onStart: () => void;
    onCancel: () => void;
    /** Disables only the network confirmation while keeping Cancel available. */
    confirmDisabled?: boolean;
    /** Explains why confirmation is unavailable. */
    confirmDisabledReason?: string;
    /** True while the list of friends is still being read. */
    loading?: boolean;
    /** True while the share is being created. */
    starting?: boolean;
    /** Why the last attempt failed. */
    error?: string;
    /**
     * Used when this dialog adds one more person to a share that already
     * exists: the title, the verb, and the standing explanation all change.
     */
    mode?: "start" | "add";
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * C-247 SessionShareStartDialog — choosing the people a session is shown to,
 * and starting to show it to them.
 *
 * The list is people, drawn as people: a face and the name this machine knows
 * them under. Under it stands the sentence that decides whether a reader should
 * be doing this at all — that a new watcher sees the conversation from its
 * beginning, including everything the agent runs — and it is always there,
 * whether the share is starting or growing, because it is always true.
 *
 * With nobody to choose from there is no Start: an empty list means the friends
 * have not been read yet, that everyone already has access, or that this machine
 * knows no one yet, and the dialog says which rather than offering a button that
 * cannot do anything.
 *
 * It renders the `Modal` card only. The application hosts it inside
 * `ModalOverlay`, which owns the scrim, the stacking, and dismissal.
 */
export function SessionShareStartDialog(props: SessionShareStartDialogProps) {
    const adding = props.mode === "add";
    const empty = props.candidates.length === 0;
    const chosen = props.candidates.filter((candidate) => props.selected.has(candidate.id)).length;
    const verb = adding ? "Add" : "Share";
    return (
        <Modal
            className={["happy2-session-share-start", props.className].filter(Boolean).join(" ")}
            data-testid={props["data-testid"]}
            footer={
                <div className="happy2-session-share-start__actions">
                    <Button disabled={props.starting} onClick={props.onCancel} variant="ghost">
                        Cancel
                    </Button>
                    {empty ? null : (
                        <Button
                            data-testid="session-share-start-confirm"
                            disabled={props.starting || props.confirmDisabled || chosen === 0}
                            icon="eye"
                            onClick={props.onStart}
                            title={props.confirmDisabledReason}
                            variant="primary"
                        >
                            {props.starting
                                ? adding
                                    ? "Adding…"
                                    : "Starting…"
                                : adding
                                  ? "Add to session"
                                  : "Share session"}
                        </Button>
                    )}
                </div>
            }
            icon="eye"
            onClose={props.starting ? undefined : props.onCancel}
            size="medium"
            style={props.style}
            title={adding ? "Add someone to this session" : "Share this session"}
        >
            <div className="happy2-session-share-start__body">
                {props.error ? (
                    <Banner icon="alert" title={`${verb} did not happen`} tone="danger">
                        {props.error}
                    </Banner>
                ) : null}

                {empty ? (
                    <p
                        className="happy2-session-share-start__reason"
                        data-happy-desktop-ui="session-share-start-reason"
                    >
                        {props.loading
                            ? "Reading who you can share this with…"
                            : adding
                              ? "Everyone you know already has access."
                              : "Add a friend first to share this session with them."}
                    </p>
                ) : (
                    <ul
                        className="happy2-session-share-start__list"
                        data-happy-desktop-ui="session-share-start-list"
                    >
                        {props.candidates.map((candidate) => {
                            const controlId = `session-share-candidate-${candidate.id}`;
                            return (
                                <li
                                    className="happy2-session-share-start__candidate"
                                    data-candidate-id={candidate.id}
                                    data-happy-desktop-ui="session-share-candidate"
                                    data-selected={
                                        props.selected.has(candidate.id) ? "" : undefined
                                    }
                                    key={candidate.id}
                                >
                                    <Checkbox
                                        aria-label={candidate.name}
                                        checked={props.selected.has(candidate.id)}
                                        disabled={props.starting}
                                        id={controlId}
                                        onChange={() => props.onToggle(candidate.id)}
                                    />
                                    {/* The face and the name label the control
                                        rather than sitting beside it, so the
                                        whole row is the hit target without a
                                        second interactive element in it. */}
                                    <label
                                        className="happy2-session-share-start__candidate-body"
                                        htmlFor={controlId}
                                    >
                                        <Avatar
                                            {...(candidate.photoUrl
                                                ? { imageUrl: candidate.photoUrl }
                                                : {})}
                                            initials={candidate.initials}
                                            size="md"
                                        />
                                        <span
                                            className="happy2-session-share-start__candidate-name"
                                            data-happy-desktop-ui="session-share-candidate-name"
                                        >
                                            {candidate.name}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <p
                    className="happy2-session-share-start__standing"
                    data-happy-desktop-ui="session-share-start-standing"
                >
                    They will see this conversation from the beginning, including everything the
                    agent runs.
                    {adding ? " Everyone already watching keeps the access they have." : ""}
                </p>

                <Switch
                    checked={props.friendMessagesInContext}
                    className="happy2-session-share-start__setting"
                    data-testid="session-share-start-friend-messages"
                    description="What they write arrives in this session as context the agent can read."
                    disabled={props.starting}
                    label="Let them write to the agent"
                    onChange={(value) => props.onFriendMessagesChange(value)}
                />
            </div>
        </Modal>
    );
}
