import { Banner } from "./Banner";
import { Box } from "./Box";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { TextField } from "./TextField";

/** Which side of a pairing this machine is on. */
export type RigPairingRole = "inviter" | "joiner";

/** The four emojis compared on both machines to prove they reached each other. */
export type RigPairingEmojis = readonly [string, string, string, string];

/** The machine on the other end, once it has said who it is. */
export interface RigPairingPeer {
    readonly name: string;
    readonly instanceId: string;
}

/**
 * Where a pairing has got to, as the surface is told it.
 *
 * The phases carry only what is true at that point, so the component renders
 * from the phase rather than testing optional fields: there are no emojis to
 * compare before the exchange has produced them, and no machine to name before
 * it has identified itself.
 */
export type RigPairingProgress =
    | { readonly phase: "connecting" | "waiting"; readonly role: RigPairingRole }
    | {
          readonly phase: "verifying";
          readonly role: RigPairingRole;
          readonly emojis: RigPairingEmojis;
          readonly peer: RigPairingPeer;
      }
    | { readonly phase: "connected"; readonly role: RigPairingRole; readonly peer: RigPairingPeer }
    | {
          readonly phase: "expired" | "failed" | "rejected";
          readonly role: RigPairingRole;
          readonly message?: string;
      };

/** An invitation this machine made, and the command that redeems it. */
export interface RigPairingInvitationView {
    readonly invitation: string;
    /** The exact command to run on the machine being invited. */
    readonly command: string;
}

export type RigPairingProps = {
    /**
     * False on a Rig whose protocol does not carry pairing. The surface explains
     * that instead of drawing controls that would fail, because an older Rig
     * still reports the machines it is peered with — it just cannot be asked
     * from here to trust a new one.
     */
    available: boolean;
    className?: string;
    /** True while an invitation is being made. */
    creating?: boolean;
    /** The invitation this machine made, once it has one. */
    invitation?: RigPairingInvitationView;
    /** The invitation being pasted in to join another machine. */
    joinValue: string;
    /** True while the pasted invitation is with the Rig. */
    joining?: boolean;
    /** True while an accept or reject is with the Rig. */
    answering?: boolean;
    /** Where the pairing under way has got to. */
    progress?: RigPairingProgress;
    /** Why the last attempt failed. */
    error?: string;
    /** Why pairing mutations are temporarily unavailable. Local invitation text remains readable. */
    disabledReason?: string;
    onInvitationCreate: () => void;
    onJoinValueChange: (value: string) => void;
    onJoinSubmit: () => void;
    onVerificationAccept: () => void;
    onVerificationReject: () => void;
    /** Clears the pairing on screen, so another can be started. */
    onReset: () => void;
};

const PHASE_TITLES: Record<RigPairingProgress["phase"], string> = {
    connecting: "Reaching the other machine",
    waiting: "Waiting for the other machine",
    verifying: "Check these match",
    connected: "Paired",
    expired: "Invitation expired",
    failed: "Pairing failed",
    rejected: "Pairing rejected",
};

/**
 * Pairing this Rig with another machine.
 *
 * Trust is established by comparing four emojis at both ends and answering on
 * each. That comparison is the whole of it: there is no key to copy across, no
 * address to allow, and nothing about the other machine to configure here. Two
 * machines that see the same four emojis reached each other and nobody else,
 * which is why the emojis are the largest thing on the surface.
 *
 * The component holds no pairing state and starts nothing. It renders the phase
 * it is given and reports presses, so every state below can be put on screen
 * directly by a blueprint or a test.
 */
export function RigPairing(props: RigPairingProps) {
    if (!props.available) {
        return (
            <Box
                className={["happy2-rig-pairing", props.className].filter(Boolean).join(" ")}
                data-happy-desktop-ui="rig-pairing"
                data-available="false"
            >
                <Banner tone="info">
                    This Rig is too old to pair from here. It still reports the machines it is
                    already peered with.
                </Banner>
            </Box>
        );
    }
    return (
        <Box
            className={["happy2-rig-pairing", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-pairing"
            data-available="true"
        >
            {props.error ? <Banner tone="danger">{props.error}</Banner> : null}
            {props.progress ? (
                <RigPairingProgressView
                    answering={props.answering ?? false}
                    mutationsDisabled={props.disabledReason !== undefined}
                    onReset={props.onReset}
                    onVerificationAccept={props.onVerificationAccept}
                    onVerificationReject={props.onVerificationReject}
                    progress={props.progress}
                />
            ) : null}
            {props.invitation ? <RigPairingInvitationCard invitation={props.invitation} /> : null}
            {props.progress === undefined && props.invitation === undefined ? (
                <Box className="happy2-rig-pairing__start">
                    <Box className="happy2-rig-pairing__choice">
                        <span className="happy2-rig-pairing__choice-title">Invite a machine</span>
                        <span className="happy2-rig-pairing__choice-detail">
                            Make an invitation here, then run the command it gives you on the other
                            machine.
                        </span>
                        <Button
                            disabled={props.creating || props.disabledReason !== undefined}
                            icon="link"
                            onClick={props.onInvitationCreate}
                            size="small"
                            variant="primary"
                        >
                            {props.creating ? "Making invitation…" : "Create invitation"}
                        </Button>
                    </Box>
                    <Box className="happy2-rig-pairing__choice">
                        <span className="happy2-rig-pairing__choice-title">
                            Join with an invitation
                        </span>
                        <span className="happy2-rig-pairing__choice-detail">
                            Paste an invitation made on another machine.
                        </span>
                        <TextField
                            aria-label="Invitation from another machine"
                            disabled={props.joining}
                            fullWidth
                            onSubmit={props.onJoinSubmit}
                            onValueChange={props.onJoinValueChange}
                            placeholder="Paste an invitation"
                            size="small"
                            value={props.joinValue}
                        />
                        <Button
                            disabled={
                                props.joining ||
                                props.disabledReason !== undefined ||
                                props.joinValue.trim().length === 0
                            }
                            onClick={props.onJoinSubmit}
                            size="small"
                            variant="secondary"
                        >
                            {props.joining ? "Joining…" : "Join"}
                        </Button>
                    </Box>
                </Box>
            ) : null}
        </Box>
    );
}

/** The invitation itself and the one command that redeems it. */
function RigPairingInvitationCard(props: { invitation: RigPairingInvitationView }) {
    return (
        <Box
            className="happy2-rig-pairing__invitation"
            data-happy-desktop-ui="rig-pairing-invitation"
        >
            <span className="happy2-rig-pairing__invitation-label">
                Run this on the machine you are inviting
            </span>
            <code
                className="happy2-rig-pairing__command"
                data-happy-desktop-ui="rig-pairing-command"
            >
                {props.invitation.command}
            </code>
            <span className="happy2-rig-pairing__invitation-label">Invitation</span>
            <code
                className="happy2-rig-pairing__invitation-value"
                data-happy-desktop-ui="rig-pairing-invitation-value"
            >
                {props.invitation.invitation}
            </code>
        </Box>
    );
}

/** What the pairing under way is doing, and the only decision it may need. */
function RigPairingProgressView(props: {
    answering: boolean;
    mutationsDisabled: boolean;
    onReset: () => void;
    onVerificationAccept: () => void;
    onVerificationReject: () => void;
    progress: RigPairingProgress;
}) {
    const progress = props.progress;
    return (
        <Box
            className="happy2-rig-pairing__progress"
            data-happy-desktop-ui="rig-pairing-progress"
            data-phase={progress.phase}
        >
            <Box className="happy2-rig-pairing__progress-heading">
                {progress.phase === "connecting" || progress.phase === "waiting" ? (
                    <Spinner size={16} />
                ) : (
                    <Icon
                        name={progress.phase === "connected" ? "check-circle" : "link"}
                        size={16}
                    />
                )}
                <span
                    className="happy2-rig-pairing__progress-title"
                    data-happy-desktop-ui="rig-pairing-title"
                >
                    {PHASE_TITLES[progress.phase]}
                </span>
            </Box>
            {progress.phase === "verifying" ? (
                <>
                    <span
                        className="happy2-rig-pairing__peer"
                        data-happy-desktop-ui="rig-pairing-peer"
                    >
                        {progress.peer.name}
                    </span>
                    {/* The emojis are the trust decision, so each one gets its own
                        fixed slot: font emoji come from an operating-system colour
                        font whose artwork differs in size per glyph, and a shared
                        run would let one of them decide the others' spacing. */}
                    <Box
                        aria-label={`Verification emojis: ${progress.emojis.join(" ")}`}
                        className="happy2-rig-pairing__emojis"
                        data-happy-desktop-ui="rig-pairing-emojis"
                        role="img"
                    >
                        {progress.emojis.map((emoji, index) => (
                            <span
                                aria-hidden
                                className="happy2-rig-pairing__emoji"
                                data-happy-desktop-ui="rig-pairing-emoji"
                                // The emojis are a fixed-length tuple in a fixed
                                // order and are never reordered or filtered, so
                                // position is their identity.
                                key={index}
                            >
                                {emoji}
                            </span>
                        ))}
                    </Box>
                    <span className="happy2-rig-pairing__hint">
                        Accept only if the same four emojis are shown on {progress.peer.name}.
                    </span>
                    <Box className="happy2-rig-pairing__actions">
                        <Button
                            disabled={props.answering || props.mutationsDisabled}
                            onClick={props.onVerificationAccept}
                            size="small"
                            variant="primary"
                        >
                            Accept
                        </Button>
                        <Button
                            disabled={props.answering || props.mutationsDisabled}
                            onClick={props.onVerificationReject}
                            size="small"
                            variant="danger"
                        >
                            Reject
                        </Button>
                    </Box>
                </>
            ) : null}
            {progress.phase === "connected" ? (
                <>
                    <span
                        className="happy2-rig-pairing__peer"
                        data-happy-desktop-ui="rig-pairing-peer"
                    >
                        {progress.peer.name}
                    </span>
                    <span className="happy2-rig-pairing__hint">
                        This machine is now trusted. It appears under Nodes once the Rig connects to
                        it.
                    </span>
                    <Box className="happy2-rig-pairing__actions">
                        <Button onClick={props.onReset} size="small" variant="secondary">
                            Done
                        </Button>
                    </Box>
                </>
            ) : null}
            {progress.phase === "expired" ||
            progress.phase === "failed" ||
            progress.phase === "rejected" ? (
                <>
                    <span
                        className="happy2-rig-pairing__hint"
                        data-happy-desktop-ui="rig-pairing-message"
                    >
                        {progress.message ?? "Nothing was trusted. You can start again."}
                    </span>
                    <Box className="happy2-rig-pairing__actions">
                        <Button onClick={props.onReset} size="small" variant="secondary">
                            Start again
                        </Button>
                    </Box>
                </>
            ) : null}
            {progress.phase === "connecting" || progress.phase === "waiting" ? (
                <Box className="happy2-rig-pairing__actions">
                    <Button onClick={props.onReset} size="small" variant="ghost">
                        Stop watching
                    </Button>
                </Box>
            ) : null}
        </Box>
    );
}
