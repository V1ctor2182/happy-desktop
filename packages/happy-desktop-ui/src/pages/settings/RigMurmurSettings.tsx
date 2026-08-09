import { Avatar } from "../../Avatar";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { Spinner } from "../../Spinner";
import { RigSettingsSection } from "./RigSettingsShell";

export type RigMurmurConnection = "connecting" | "connected" | "disconnected";

export interface RigMurmurContactRow {
    readonly identity: string;
    readonly name: string;
    readonly email?: string;
    readonly imageUrl?: string;
    readonly removing?: boolean;
}

export interface RigMurmurIncomingRequestRow {
    readonly id: string;
    readonly identity: string;
    readonly name: string;
    readonly email?: string;
    readonly imageUrl?: string;
    readonly answering?: boolean;
}

export interface RigMurmurOutgoingRequestRow {
    readonly id: string;
    readonly identity: string;
}

export interface RigMurmurSettingsProps {
    readonly actionError?: string;
    readonly connection: RigMurmurConnection;
    readonly contacts: readonly RigMurmurContactRow[];
    readonly enabled: boolean;
    readonly error?: string;
    readonly identity?: string;
    readonly incomingRequests: readonly RigMurmurIncomingRequestRow[];
    readonly loading?: boolean;
    readonly outgoingRequests: readonly RigMurmurOutgoingRequestRow[];
    readonly resetConfirming?: boolean;
    readonly resetting?: boolean;
    readonly unavailable?: string;
    onAddContact(): void;
    onContactRemove(identity: string): void;
    onRequestAccept(requestId: string): void;
    onRequestReject(requestId: string): void;
    onResetCancel(): void;
    onResetConfirm(): void;
    onResetOpen(): void;
}

const initials = (name: string): string =>
    name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toLocaleUpperCase();

const connectionLabel: Record<RigMurmurConnection, string> = {
    connected: "Connected",
    connecting: "Connecting…",
    disconnected: "Offline",
};

/**
 * The host's Murmur relationship settings: network state, pending handshakes,
 * and established contacts. The surface is props-only; the Rig sharing store
 * remains the single owner of every row and action.
 */
export function RigMurmurSettings(props: RigMurmurSettingsProps) {
    const pending = props.incomingRequests.length + props.outgoingRequests.length;
    return (
        <>
            <RigSettingsSection
                description="Murmur connects people you trust so folders can be shared between their Rigs."
                rows="cards"
                title="Murmur"
            >
                <Box className="happy2-rig-murmur__toolbar">
                    <Box
                        className="happy2-rig-murmur__connection"
                        data-connection={props.connection}
                    >
                        {props.connection === "connecting" ? (
                            <Spinner size={14} />
                        ) : (
                            <Icon
                                name={props.connection === "connected" ? "check" : "unlink"}
                                size={14}
                            />
                        )}
                        <span>{connectionLabel[props.connection]}</span>
                    </Box>
                    <Button
                        disabled={!props.enabled || props.unavailable !== undefined}
                        icon="plus"
                        onClick={props.onAddContact}
                        size="small"
                        variant="secondary"
                    >
                        {props.incomingRequests.length > 0 ? "Review requests" : "Add contact"}
                    </Button>
                </Box>
                {props.identity ? (
                    <Box className="happy2-rig-murmur__identity">
                        <span className="happy2-rig-murmur__identity-label">Your identity</span>
                        <code>{props.identity}</code>
                    </Box>
                ) : null}
                {!props.enabled ? (
                    <Banner tone="warning" title="Murmur is not enabled">
                        This Rig has no Murmur profile to share as.
                    </Banner>
                ) : null}
                {props.unavailable ? <Banner tone="warning">{props.unavailable}</Banner> : null}
                {props.error ? (
                    <Banner tone="danger" title="Murmur unavailable">
                        {props.error}
                    </Banner>
                ) : null}
                {props.actionError ? (
                    <Banner tone="danger" title="Murmur did not complete the action">
                        {props.actionError}
                    </Banner>
                ) : null}
            </RigSettingsSection>

            {pending > 0 ? (
                <RigSettingsSection
                    description="Contact handshakes remain here until both people have answered."
                    rows="cards"
                    title={`Requests · ${pending}`}
                >
                    {props.incomingRequests.map((request) => (
                        <article
                            className="happy2-rig-murmur-person"
                            data-kind="incoming"
                            key={request.id}
                        >
                            <Avatar
                                imageUrl={request.imageUrl}
                                initials={initials(request.name)}
                                size="md"
                            />
                            <MurmurPersonName
                                detail={request.email ?? request.identity}
                                name={request.name}
                            />
                            <Box className="happy2-rig-murmur-person__actions">
                                {request.answering ? (
                                    <Box className="happy2-rig-murmur-person__answering">
                                        <Spinner size={14} />
                                        <span>Answering…</span>
                                    </Box>
                                ) : (
                                    <>
                                        <Button
                                            onClick={() => props.onRequestReject(request.id)}
                                            size="small"
                                            variant="ghost"
                                        >
                                            Decline
                                        </Button>
                                        <Button
                                            onClick={() => props.onRequestAccept(request.id)}
                                            size="small"
                                            variant="primary"
                                        >
                                            Accept
                                        </Button>
                                    </>
                                )}
                            </Box>
                        </article>
                    ))}
                    {props.outgoingRequests.map((request) => (
                        <article
                            className="happy2-rig-murmur-person"
                            data-kind="outgoing"
                            key={request.id}
                        >
                            <Avatar icon="clock" initials="" size="md" />
                            <MurmurPersonName
                                detail="Waiting for their answer"
                                name={request.identity}
                            />
                            <Box className="happy2-rig-murmur-person__pending">
                                <Spinner size={14} />
                                <span>Pending</span>
                            </Box>
                        </article>
                    ))}
                </RigSettingsSection>
            ) : null}

            <RigSettingsSection
                description="Contacts can be selected when sharing a folder."
                rows="cards"
                title={`Contacts · ${props.contacts.length}`}
            >
                {props.contacts.map((contact) => (
                    <article className="happy2-rig-murmur-person" key={contact.identity}>
                        <Avatar
                            imageUrl={contact.imageUrl}
                            initials={initials(contact.name)}
                            size="md"
                        />
                        <MurmurPersonName
                            detail={contact.email ?? contact.identity}
                            name={contact.name}
                        />
                        <Button
                            aria-label={`Remove ${contact.name}`}
                            disabled={contact.removing === true || props.unavailable !== undefined}
                            icon="trash"
                            loading={contact.removing === true}
                            onClick={() => props.onContactRemove(contact.identity)}
                            size="small"
                            variant="ghost"
                        >
                            {contact.removing ? "Removing…" : "Remove"}
                        </Button>
                    </article>
                ))}
                {props.loading && props.contacts.length === 0 ? (
                    <Box className="happy2-rig-settings__pending">
                        <Spinner size={16} />
                        <span>Reading contacts…</span>
                    </Box>
                ) : null}
                {!props.loading && props.contacts.length === 0 && pending === 0 ? (
                    <EmptyState
                        action={
                            props.enabled && props.unavailable === undefined
                                ? {
                                      icon: "plus",
                                      label: "Add contact",
                                      onClick: props.onAddContact,
                                  }
                                : undefined
                        }
                        description="Invite someone you trust, or use an invitation they sent you."
                        icon="users"
                        size="inline"
                        title="No contacts yet"
                    />
                ) : null}
            </RigSettingsSection>

            <RigSettingsSection
                description="Use this only when Murmur is stuck and reconnecting does not recover it."
                rows="cards"
                title="Reset"
            >
                <article className="happy2-rig-murmur-reset">
                    <Box className="happy2-rig-murmur-reset__copy">
                        <span className="happy2-rig-murmur-reset__title">Reset Murmur state</span>
                        <span className="happy2-rig-murmur-reset__detail">
                            Replaces this Rig&apos;s identity and removes all contacts, requests,
                            and folder shares. You will need to add contacts and share folders
                            again.
                        </span>
                    </Box>
                    {props.resetConfirming ? (
                        <Box className="happy2-rig-murmur-reset__confirm">
                            <Button
                                disabled={props.resetting}
                                onClick={props.onResetCancel}
                                size="small"
                                variant="ghost"
                            >
                                Cancel
                            </Button>
                            <Button
                                loading={props.resetting}
                                onClick={props.onResetConfirm}
                                size="small"
                                variant="danger"
                            >
                                {props.resetting ? "Resetting…" : "Reset Murmur"}
                            </Button>
                        </Box>
                    ) : (
                        <Button
                            disabled={
                                !props.enabled ||
                                props.unavailable !== undefined ||
                                props.resetting === true
                            }
                            onClick={props.onResetOpen}
                            size="small"
                            variant="secondary"
                        >
                            Reset…
                        </Button>
                    )}
                </article>
            </RigSettingsSection>
        </>
    );
}

function MurmurPersonName(props: { detail: string; name: string }) {
    return (
        <Box className="happy2-rig-murmur-person__naming">
            <span className="happy2-rig-murmur-person__name">{props.name}</span>
            <span className="happy2-rig-murmur-person__detail">{props.detail}</span>
        </Box>
    );
}
