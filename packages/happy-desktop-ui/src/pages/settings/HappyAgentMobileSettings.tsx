import { Badge, type BadgeVariant } from "../../Badge";
import { Banner } from "../../Banner";
import { Button } from "../../Button";
import { Box } from "../../Box";
import { FormRow } from "../../FormRow";
import { QRCode } from "../../QRCode";
import { Spinner } from "../../Spinner";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

export type HappyAgentMobileStatus =
    | "loading"
    | "disabled"
    | "disconnected"
    | "pairing"
    | "connecting"
    | "connected"
    | "failed"
    | "unavailable";

export interface HappyAgentMobileSettingsProps {
    /** Undefined until Happy Agent has reported its durable configuration. */
    readonly configured?: boolean;
    readonly status: HappyAgentMobileStatus;
    readonly disconnecting?: boolean;
    readonly pairingStarting?: boolean;
    readonly pairingCanceling?: boolean;
    readonly pairingData?: string;
    readonly pairingExpiresAt?: number;
    /** Why the live integration state could not be read. */
    readonly error?: string;
    /** Why the last disconnect attempt was refused. */
    readonly disconnectError?: string;
    /** Why the last pairing action was refused. */
    readonly pairingError?: string;
    /** Detail Happy Agent reported for a failed or disconnected integration. */
    readonly message?: string;
    /** Why actions cannot currently reach this Happy Agent. */
    readonly unavailable?: string;
    onDisconnect(): void;
    onPair(): void;
    onPairingCancel(): void;
}

const STATUS_LABELS: Record<HappyAgentMobileStatus, string> = {
    loading: "Reading…",
    disabled: "Unavailable",
    disconnected: "Disconnected",
    pairing: "Pairing",
    connecting: "Connecting",
    connected: "Connected",
    failed: "Connection failed",
    unavailable: "Unavailable",
};

const STATUS_VARIANTS: Record<HappyAgentMobileStatus, BadgeVariant> = {
    loading: "neutral",
    disabled: "neutral",
    disconnected: "warning",
    pairing: "info",
    connecting: "info",
    connected: "success",
    failed: "danger",
    unavailable: "neutral",
};

/** The Mobile Access category: configuration and live Happy Mobile connection state. */
export function HappyAgentMobileSettings(props: HappyAgentMobileSettingsProps) {
    return (
        <HappyAgentSettingsSection
            description="Pairing lets Happy Mobile follow and continue the work running through this Happy Agent."
            title="Mobile Access"
        >
            {props.unavailable ? (
                <Banner tone="warning" title="Happy Agent unavailable">
                    {props.unavailable}
                </Banner>
            ) : null}
            {props.error ? (
                <Banner tone="danger" title="Happy Mobile status unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.disconnectError ? (
                <Banner tone="danger" title="Still connected">
                    {props.disconnectError}
                </Banner>
            ) : null}
            {props.pairingError ? (
                <Banner tone="danger" title="Pairing unavailable">
                    {props.pairingError}
                </Banner>
            ) : null}
            {props.message ? (
                <Banner
                    tone={props.status === "failed" ? "danger" : "warning"}
                    title={props.status === "failed" ? "Connection failed" : "Disconnected"}
                >
                    {props.message}
                </Banner>
            ) : null}
            <FormRow
                control={
                    <Badge
                        label={configurationLabel(props.configured)}
                        variant={props.configured ? "success" : "neutral"}
                    />
                }
                description="Whether this Happy Agent has a saved Happy Mobile pairing."
                label="Configuration"
            />
            <FormRow
                control={
                    <Badge
                        label={STATUS_LABELS[props.status]}
                        variant={STATUS_VARIANTS[props.status]}
                    />
                }
                description={statusDescription(props.status)}
                label="Connection"
            />
            {props.status === "pairing" && props.pairingData ? (
                <Box className="happy-agent-mobile-settings__pairing">
                    <QRCode
                        data={props.pairingData}
                        data-testid="happy-mobile-settings-pairing-qr"
                        label="QR code to pair Happy Mobile"
                        size={240}
                    />
                    <Box className="happy-agent-mobile-settings__waiting">
                        <Spinner label="Pairing in progress" size={16} />
                        <span>{pairingWaitingLabel(props.pairingExpiresAt)}</span>
                    </Box>
                    <Button
                        loading={props.pairingCanceling}
                        onClick={props.onPairingCancel}
                        size="small"
                        variant="ghost"
                    >
                        Cancel pairing
                    </Button>
                </Box>
            ) : null}
            {props.configured === false &&
            (props.status === "disconnected" || props.status === "failed") ? (
                <FormRow
                    align="start"
                    control={
                        <Button
                            disabled={props.unavailable !== undefined}
                            icon="link"
                            loading={props.pairingStarting}
                            onClick={props.onPair}
                            size="small"
                            variant="primary"
                        >
                            Connect
                        </Button>
                    }
                    description="Start a secure pairing and scan the QR code with Happy Mobile."
                    label="Pair Happy Mobile"
                />
            ) : null}
            {props.configured === true ? (
                <FormRow
                    align="start"
                    control={
                        <Button
                            disabled={props.unavailable !== undefined}
                            icon="unlink"
                            loading={props.disconnecting}
                            onClick={props.onDisconnect}
                            size="small"
                            variant="danger"
                        >
                            Disconnect
                        </Button>
                    }
                    description="Remove this pairing from Happy Agent. Happy Mobile will no longer be able to follow its work."
                    label="Disconnect Happy Mobile"
                />
            ) : null}
        </HappyAgentSettingsSection>
    );
}

function pairingWaitingLabel(expiresAt: number | undefined): string {
    if (expiresAt === undefined) return "Waiting for your phone…";
    const expiration = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
    }).format(expiresAt);
    return `Waiting for your phone · expires ${expiration}`;
}

function configurationLabel(configured: boolean | undefined): string {
    if (configured === undefined) return "Unknown";
    return configured ? "Configured" : "Not configured";
}

function statusDescription(status: HappyAgentMobileStatus): string {
    switch (status) {
        case "loading":
            return "Reading the current Happy Mobile connection from Happy Agent.";
        case "disabled":
            return "Happy Mobile integration is disabled in this Happy Agent installation.";
        case "disconnected":
            return "Happy Agent is not currently connected to Happy Mobile.";
        case "pairing":
            return "Happy Agent is waiting for Happy Mobile to finish pairing.";
        case "connecting":
            return "The saved pairing is connecting to Happy Mobile.";
        case "connected":
            return "Happy Agent has a live connection to Happy Mobile.";
        case "failed":
            return "Happy Agent could not establish its Happy Mobile connection.";
        case "unavailable":
            return "This Happy Agent does not report Happy Mobile integration state.";
    }
}
