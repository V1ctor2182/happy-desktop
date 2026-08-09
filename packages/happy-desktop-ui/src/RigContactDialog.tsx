import type { CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Box } from "./Box";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { Spinner } from "./Spinner";
import { TextField } from "./TextField";

/** An invitation this Rig made, for one other person to redeem. */
export interface RigContactInvitationView {
    readonly invitation: string;
}

/** Someone waiting on an answer here, as the dialog is told about them. */
export interface RigContactRequestView {
    readonly id: string;
    /** Who they are, when their Rig has published a profile. */
    readonly name?: string;
    readonly email?: string;
    readonly imageUrl?: string;
    /** The identity they proved, shown when there is no name to show instead. */
    readonly identity: string;
    /** True while the answer given here is with the Rig. */
    readonly answering?: boolean;
}

/** A request sent from here that the other side has not answered yet. */
export interface RigContactOutgoingView {
    readonly id: string;
    readonly identity: string;
}

export type RigContactDialogProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** True while an invitation is being made. */
    creating?: boolean;
    /** The invitation this Rig made, once it has one. */
    invitation?: RigContactInvitationView;
    /** The invitation being pasted in to ask someone to be a contact. */
    requestValue: string;
    /** True while the pasted invitation is with the Rig. */
    requesting?: boolean;
    /** People waiting on an answer here. */
    incoming?: readonly RigContactRequestView[];
    /** Requests sent from here that nobody has answered yet. */
    outgoing?: readonly RigContactOutgoingView[];
    /** Why the last act was refused, in the Rig's own words. */
    error?: string;
    onInvitationCreate: () => void;
    onRequestValueChange: (value: string) => void;
    onRequestSubmit: () => void;
    onRequestAccept: (requestId: string) => void;
    onRequestReject: (requestId: string) => void;
    onClose: () => void;
};

/**
 * C-260 RigContactDialog — making a contact, from either end of the handshake.
 *
 * A contact is made in two halves: one person produces an invitation, the other
 * redeems it, and the first then answers the request that arrives. Both halves
 * are here because they are one act to the person doing it, and either end may
 * be the one sitting at this window — the same dialog is opened whether you are
 * inviting someone or were invited.
 *
 * Requests waiting on an answer come first. They are the only part of the
 * surface where someone else is waiting on this person, so they are shown above
 * the two things this person might start, rather than below where a dialog
 * opened to make an invitation would hide them.
 *
 * The dialog holds no state and starts nothing. It renders what it is given and
 * reports presses, so every state below can be put on screen by a fixture.
 */
export function RigContactDialog(props: RigContactDialogProps) {
    const incoming = props.incoming ?? [];
    const outgoing = props.outgoing ?? [];
    const requestable = props.requestValue.trim().length > 0 && props.requesting !== true;
    return (
        <ModalOverlay onDismiss={() => props.onClose()}>
            <Modal
                className={props.className}
                data-testid={props["data-testid"]}
                icon="users"
                onClose={() => props.onClose()}
                size="medium"
                style={props.style}
                title="Add contact"
            >
                <Box
                    className="happy2-rig-contact-dialog"
                    data-happy-desktop-ui="rig-contact-dialog"
                >
                    {props.error ? <Banner tone="danger">{props.error}</Banner> : null}
                    {incoming.length > 0 ? (
                        <Box className="happy2-rig-contact-dialog__section">
                            <span className="happy2-rig-contact-dialog__section-title">
                                Waiting for your answer
                            </span>
                            {incoming.map((request) => (
                                <RigContactRequestRow
                                    key={request.id}
                                    onAccept={() => props.onRequestAccept(request.id)}
                                    onReject={() => props.onRequestReject(request.id)}
                                    request={request}
                                />
                            ))}
                        </Box>
                    ) : null}
                    <Box className="happy2-rig-contact-dialog__choice">
                        <span className="happy2-rig-contact-dialog__choice-title">
                            Invite someone
                        </span>
                        <span className="happy2-rig-contact-dialog__choice-detail">
                            Make an invitation here and send it to them. They redeem it on their own
                            Rig, and you answer the request that comes back.
                        </span>
                        {props.invitation ? (
                            <RigContactInvitationCard invitation={props.invitation} />
                        ) : (
                            <Button
                                icon="link"
                                loading={props.creating === true}
                                onClick={props.onInvitationCreate}
                                size="small"
                                variant="primary"
                            >
                                {props.creating === true
                                    ? "Making invitation…"
                                    : "Create invitation"}
                            </Button>
                        )}
                    </Box>
                    <Box className="happy2-rig-contact-dialog__choice">
                        <span className="happy2-rig-contact-dialog__choice-title">
                            Use an invitation
                        </span>
                        <span className="happy2-rig-contact-dialog__choice-detail">
                            Paste an invitation someone sent you. They decide whether to accept.
                        </span>
                        <TextField
                            aria-label="Invitation from someone else"
                            disabled={props.requesting === true}
                            fullWidth
                            onSubmit={() => {
                                if (requestable) props.onRequestSubmit();
                            }}
                            onValueChange={props.onRequestValueChange}
                            placeholder="Paste an invitation"
                            size="small"
                            value={props.requestValue}
                        />
                        <Button
                            disabled={!requestable}
                            loading={props.requesting === true}
                            onClick={props.onRequestSubmit}
                            size="small"
                            variant="secondary"
                        >
                            {props.requesting === true ? "Sending…" : "Send request"}
                        </Button>
                    </Box>
                    {outgoing.length > 0 ? (
                        <Box className="happy2-rig-contact-dialog__section">
                            <span className="happy2-rig-contact-dialog__section-title">
                                Waiting for their answer
                            </span>
                            {outgoing.map((request) => (
                                <Box
                                    className="happy2-rig-contact-dialog__pending"
                                    data-happy-desktop-ui="rig-contact-pending"
                                    key={request.id}
                                >
                                    <Spinner size={14} />
                                    <span className="happy2-rig-contact-dialog__identity">
                                        {request.identity}
                                    </span>
                                </Box>
                            ))}
                        </Box>
                    ) : null}
                </Box>
            </Modal>
        </ModalOverlay>
    );
}

/**
 * The invitation itself, for sending to the person being invited.
 *
 * There is nothing to run: the other person pastes this into the same dialog on
 * their own Rig, which is why it is presented as one value to copy rather than
 * as a command line.
 */
function RigContactInvitationCard(props: { invitation: RigContactInvitationView }) {
    return (
        <Box
            className="happy2-rig-contact-dialog__invitation"
            data-happy-desktop-ui="rig-contact-invitation"
        >
            <span className="happy2-rig-contact-dialog__label">
                Send this to the person you are inviting
            </span>
            <code
                className="happy2-rig-contact-dialog__code"
                data-happy-desktop-ui="rig-contact-invitation-value"
            >
                {props.invitation.invitation}
            </code>
        </Box>
    );
}

/**
 * One person asking to become a contact, and the only decision about them.
 *
 * A request whose far Rig has published no profile still names someone real, so
 * the identity stands in for the name rather than the row being withheld: the
 * decision is about the identity in either case, and a request that could not be
 * answered until a profile arrived would simply sit there.
 */
function RigContactRequestRow(props: {
    onAccept: () => void;
    onReject: () => void;
    request: RigContactRequestView;
}) {
    const request = props.request;
    const answering = request.answering === true;
    const name = request.name ?? request.identity;
    return (
        <Box
            className="happy2-rig-contact-dialog__request"
            data-happy-desktop-ui="rig-contact-request"
        >
            <Avatar
                initials={initialsOf(name)}
                size="sm"
                {...(request.imageUrl === undefined ? {} : { imageUrl: request.imageUrl })}
            />
            <Box className="happy2-rig-contact-dialog__request-who">
                <span
                    className="happy2-rig-contact-dialog__request-name"
                    data-happy-desktop-ui="rig-contact-request-name"
                >
                    {name}
                </span>
                <span className="happy2-rig-contact-dialog__request-detail">
                    {request.email ?? request.identity}
                </span>
            </Box>
            <Box className="happy2-rig-contact-dialog__request-actions">
                <Button
                    aria-label={`Decline ${name}`}
                    disabled={answering}
                    icon="close"
                    iconOnly
                    onClick={props.onReject}
                    size="small"
                    variant="ghost"
                />
                <Button
                    disabled={answering}
                    icon="check"
                    loading={answering}
                    onClick={props.onAccept}
                    size="small"
                    variant="primary"
                >
                    Accept
                </Button>
            </Box>
        </Box>
    );
}

/**
 * The one or two letters standing in for a face.
 *
 * A name gives its first and last initial; anything else — an identity string,
 * a single word — gives its first character, because a raw key sliced in two
 * places reads as noise rather than as someone's initials.
 */
function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
    return `${words[0]!.slice(0, 1)}${words[words.length - 1]!.slice(0, 1)}`.toUpperCase();
}
