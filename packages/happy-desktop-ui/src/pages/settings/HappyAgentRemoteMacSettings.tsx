import { useState } from "react";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Modal } from "../../Modal";
import { ModalOverlay } from "../../ModalOverlay";
import { Select } from "../../Select";
import { TextField } from "../../TextField";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

export interface HappyAgentRemoteMacSnapshot {
    readonly tailnetAddresses: readonly { readonly address: string; readonly interface: string }[];
    readonly share: {
        readonly bindAddress?: string;
        readonly enabled: boolean;
        readonly message?: string;
        readonly port?: number;
        readonly status: "disabled" | "starting" | "listening" | "retrying" | "error";
    };
    readonly mount?: {
        readonly address: string;
        readonly credentialConfigured: true;
        readonly id: string;
        readonly label: string;
        readonly message?: string;
        readonly port: number;
        readonly sourceAddress: string;
        readonly status?: "connecting" | "connected" | "disconnected" | "error";
    };
}

export interface HappyAgentRemoteMacMountInput {
    readonly address: string;
    readonly label: string;
    readonly port: number;
    readonly sourceAddress: string;
    readonly token?: string;
}

export interface HappyAgentRemoteMacSettingsProps {
    /** Blueprint-only entry point for proving a confirmation without a click. */
    readonly initialConfirmation?: HappyAgentRemoteMacConfirmation;
    readonly snapshot: HappyAgentRemoteMacSnapshot;
    onMountRemove(): Promise<void>;
    onMountWrite(input: HappyAgentRemoteMacMountInput): Promise<void>;
    onRetry(): Promise<void>;
    onShareDisable(): Promise<void>;
    onShareEnable(bindAddress: string): Promise<void>;
    onShareRotate(): Promise<void>;
}

type RemoteMacOperation =
    | "mount-remove"
    | "mount-write"
    | "retry"
    | "share-disable"
    | "share-enable"
    | "share-rotate";
export type HappyAgentRemoteMacConfirmation =
    | "mount-remove"
    | "mount-replace"
    | "share-disable"
    | "share-rotate";

/** Props-only personal-Tailnet controls embedded in General settings. */
export function HappyAgentRemoteMacSettings(props: HappyAgentRemoteMacSettingsProps) {
    const addresses = props.snapshot.tailnetAddresses;
    const mount = props.snapshot.mount;
    const [shareAddress, shareAddressSet] = useState(
        props.snapshot.share.bindAddress ?? addresses[0]?.address ?? "",
    );
    const [label, labelSet] = useState(mount?.label ?? "Remote Mac");
    const [sourceAddress, sourceAddressSet] = useState(
        mount?.sourceAddress ?? addresses[0]?.address ?? "",
    );
    const [address, addressSet] = useState(mount?.address ?? "");
    const [port, portSet] = useState(mount ? String(mount.port) : "");
    const [token, tokenSet] = useState("");
    const [operation, operationSet] = useState<RemoteMacOperation | undefined>();
    const [confirmation, confirmationSet] = useState<HappyAgentRemoteMacConfirmation | undefined>(
        props.initialConfirmation,
    );
    const [error, errorSet] = useState<string | undefined>();
    const addressOptions = addresses.map((entry) => ({
        label: `${entry.address} · ${entry.interface}`,
        value: entry.address,
    }));
    const busy = operation !== undefined;
    const run = (
        next: RemoteMacOperation,
        action: () => Promise<void>,
        succeeded?: () => void,
    ): void => {
        operationSet(next);
        errorSet(undefined);
        void action().then(
            () => {
                operationSet(undefined);
                succeeded?.();
            },
            (failure: unknown) => {
                operationSet(undefined);
                errorSet(failure instanceof Error ? failure.message : String(failure));
            },
        );
    };
    const share = props.snapshot.share;
    const listener =
        share.bindAddress && share.port
            ? `${share.bindAddress}:${String(share.port)}`
            : "Not listening";
    const mountWrite = (): void =>
        run(
            "mount-write",
            () =>
                props.onMountWrite({
                    address: address.trim(),
                    label: label.trim(),
                    port: Number(port),
                    sourceAddress,
                    ...(token.trim() ? { token: token.trim() } : {}),
                }),
            () => tokenSet(""),
        );
    const endpointChanged =
        mount !== undefined && (mount.address !== address.trim() || mount.port !== Number(port));
    const mountUnavailable = mount?.status === "disconnected" || mount?.status === "error";
    const confirmed = (): void => {
        const selected = confirmation;
        confirmationSet(undefined);
        if (selected === "share-disable") run("share-disable", props.onShareDisable);
        else if (selected === "share-rotate") run("share-rotate", props.onShareRotate);
        else if (selected === "mount-remove") run("mount-remove", props.onMountRemove);
        else if (selected === "mount-replace") mountWrite();
    };

    return (
        <HappyAgentSettingsSection
            description="Let this Mac and one other personal Mac use the same live Happy Agent sessions over your private Tailscale network."
            title="Remote Mac"
        >
            {addresses.length === 0 ? (
                <Banner tone="warning" title="Tailscale address unavailable">
                    Connect this Mac to Tailscale before sharing or mounting another Mac.
                </Banner>
            ) : null}
            {error ? (
                <Banner tone="danger" title="Remote Mac setup failed">
                    {error}
                </Banner>
            ) : null}
            {share.message ? (
                <Banner
                    tone={
                        share.status === "error"
                            ? "danger"
                            : share.status === "retrying"
                              ? "warning"
                              : "neutral"
                    }
                    title="Listener"
                >
                    {share.message}
                </Banner>
            ) : null}
            <FormRow
                control={
                    share.enabled ? (
                        <Box className="happy-agent-settings__agent-control">
                            <span>{listener}</span>
                            <span>{shareStatusLabel(share.status)}</span>
                        </Box>
                    ) : (
                        <Box className="happy-agent-settings__agent-control">
                            <Box width={220}>
                                <Select
                                    aria-label="Tailscale listener address"
                                    disabled={busy || addressOptions.length === 0}
                                    fullWidth
                                    onValueChange={shareAddressSet}
                                    options={addressOptions}
                                    placeholder="No Tailscale address"
                                    size="small"
                                    value={shareAddress}
                                />
                            </Box>
                            <Button
                                disabled={busy || !shareAddress}
                                loading={operation === "share-enable"}
                                onClick={() =>
                                    run("share-enable", () => props.onShareEnable(shareAddress))
                                }
                                size="small"
                                variant="secondary"
                            >
                                Enable & copy token
                            </Button>
                        </Box>
                    )
                }
                description="Binds only to the selected 100.64.0.0/10 address; the generated token is copied once"
                label="Share this Mac"
            />
            {share.enabled ? (
                <FormRow
                    control={
                        <Box className="happy-agent-settings__agent-control">
                            {share.status === "error" || share.status === "retrying" ? (
                                <Button
                                    disabled={busy}
                                    loading={operation === "retry"}
                                    onClick={() => run("retry", props.onRetry)}
                                    size="small"
                                    variant="secondary"
                                >
                                    Retry
                                </Button>
                            ) : null}
                            <Button
                                disabled={busy}
                                loading={operation === "share-rotate"}
                                onClick={() => confirmationSet("share-rotate")}
                                size="small"
                                variant="secondary"
                            >
                                Rotate & copy token
                            </Button>
                            <Button
                                disabled={busy}
                                loading={operation === "share-disable"}
                                onClick={() => confirmationSet("share-disable")}
                                size="small"
                                variant="danger"
                            >
                                Stop sharing
                            </Button>
                        </Box>
                    }
                    description="Rotating immediately closes connections that use the previous token"
                    label="Listener access"
                />
            ) : null}
            <FormRow
                control={
                    <Box width={280}>
                        <TextField
                            aria-label="Remote Mac label"
                            disabled={busy}
                            fullWidth
                            onValueChange={labelSet}
                            size="small"
                            value={label}
                        />
                    </Box>
                }
                description="Name shown above this Mac's projects in the sidebar"
                label="Other Mac label"
            />
            <FormRow
                control={
                    <Box width={280}>
                        <Select
                            aria-label="Local Tailscale source address"
                            disabled={busy || addressOptions.length === 0}
                            fullWidth
                            onValueChange={sourceAddressSet}
                            options={addressOptions}
                            placeholder="No Tailscale address"
                            size="small"
                            value={sourceAddress}
                        />
                    </Box>
                }
                description="Every request to the other Mac is explicitly bound to this address"
                label="This Mac address"
            />
            <FormRow
                control={
                    <Box width={280}>
                        <TextField
                            aria-label="Other Mac Tailscale address"
                            disabled={busy}
                            fullWidth
                            onValueChange={addressSet}
                            placeholder="100.64.0.2"
                            size="small"
                            value={address}
                        />
                    </Box>
                }
                description="Literal Tailscale IPv4 shown by the other Mac"
                label="Other Mac address"
            />
            <FormRow
                control={
                    <Box width={280}>
                        <TextField
                            aria-label="Other Mac listener port"
                            disabled={busy}
                            fullWidth
                            onValueChange={portSet}
                            placeholder="Listener port"
                            size="small"
                            value={port}
                        />
                    </Box>
                }
                description="Port shown beside the listener address on the other Mac"
                label="Listener port"
            />
            <FormRow
                control={
                    <Box width={280}>
                        <TextField
                            aria-label="Other Mac access token"
                            autoComplete="off"
                            disabled={busy}
                            fullWidth
                            onValueChange={tokenSet}
                            placeholder={
                                mount ? "Leave blank to keep the saved token" : "Paste token"
                            }
                            size="small"
                            type="password"
                            value={token}
                        />
                    </Box>
                }
                description="Stored only in this Mac's mode-0600 desktop settings"
                label="Access token"
            />
            <FormRow
                control={
                    <Box className="happy-agent-settings__agent-control">
                        <Button
                            disabled={
                                busy ||
                                !label.trim() ||
                                !sourceAddress ||
                                !address.trim() ||
                                !port.trim() ||
                                (!mount && !token.trim())
                            }
                            loading={operation === "mount-write"}
                            onClick={() =>
                                endpointChanged ? confirmationSet("mount-replace") : mountWrite()
                            }
                            size="small"
                            variant="secondary"
                        >
                            {mount ? "Save connection" : "Connect Mac"}
                        </Button>
                        {mount ? (
                            <>
                                {mountUnavailable ? (
                                    <Button
                                        disabled={busy}
                                        loading={operation === "retry"}
                                        onClick={() => run("retry", props.onRetry)}
                                        size="small"
                                        variant="secondary"
                                    >
                                        Retry
                                    </Button>
                                ) : null}
                                <Button
                                    disabled={busy}
                                    loading={operation === "mount-remove"}
                                    onClick={() => confirmationSet("mount-remove")}
                                    size="small"
                                    variant="danger"
                                >
                                    Remove
                                </Button>
                            </>
                        ) : null}
                    </Box>
                }
                description={
                    mount
                        ? `${mount.label} is mounted at ${mount.address}:${String(mount.port)}. ${mountStatusDescription(mount)}`
                        : "The other Mac appears as another Happy Agent without replacing this Mac."
                }
                label="Connection"
            />
            {confirmation ? (
                <ModalOverlay onDismiss={() => confirmationSet(undefined)}>
                    <Modal
                        footer={
                            <>
                                <Button onClick={() => confirmationSet(undefined)} variant="ghost">
                                    Cancel
                                </Button>
                                <Button
                                    onClick={confirmed}
                                    variant={
                                        confirmation === "share-disable" ||
                                        confirmation === "mount-remove"
                                            ? "danger"
                                            : "primary"
                                    }
                                >
                                    {confirmationActionLabel(confirmation)}
                                </Button>
                            </>
                        }
                        icon={
                            confirmation === "share-disable" || confirmation === "mount-remove"
                                ? "alert"
                                : "link"
                        }
                        onClose={() => confirmationSet(undefined)}
                        size="small"
                        tone={
                            confirmation === "share-disable" || confirmation === "mount-remove"
                                ? "danger"
                                : "default"
                        }
                        title={confirmationTitle(confirmation)}
                    >
                        {confirmationDescription(confirmation)}
                    </Modal>
                </ModalOverlay>
            ) : null}
        </HappyAgentSettingsSection>
    );
}

function mountStatusDescription(mount: NonNullable<HappyAgentRemoteMacSnapshot["mount"]>): string {
    const state = (() => {
        switch (mount.status) {
            case "connected":
                return "Connected";
            case "connecting":
                return "Connecting";
            case "disconnected":
                return "Disconnected";
            case "error":
                return "Not reachable";
            case undefined:
                return undefined;
        }
    })();
    if (!state) return "";
    if (mount.message) return `${state} — ${mount.message}`;
    return `${state}.`;
}

function confirmationTitle(confirmation: HappyAgentRemoteMacConfirmation): string {
    if (confirmation === "share-disable") return "Stop sharing this Mac?";
    if (confirmation === "share-rotate") return "Rotate the access token?";
    if (confirmation === "mount-remove") return "Remove this remote Mac?";
    return "Replace this remote Mac?";
}

function confirmationDescription(confirmation: HappyAgentRemoteMacConfirmation): string {
    if (confirmation === "share-disable")
        return "Every active connection from the other Mac will close. Sessions and projects on this Mac are not deleted.";
    if (confirmation === "share-rotate")
        return "The current token will stop working immediately. The replacement is copied to this Mac's clipboard so it can be saved on the other Mac.";
    if (confirmation === "mount-remove")
        return "This removes the connection from this Happy Desktop only. It does not delete sessions, projects, or files on the other Mac.";
    return "Changing the address or port creates a new remote-Mac identity and closes every stream to the previous endpoint.";
}

function confirmationActionLabel(confirmation: HappyAgentRemoteMacConfirmation): string {
    if (confirmation === "share-disable") return "Stop sharing";
    if (confirmation === "share-rotate") return "Rotate & copy";
    if (confirmation === "mount-remove") return "Remove Mac";
    return "Replace remote Mac";
}

function shareStatusLabel(status: HappyAgentRemoteMacSnapshot["share"]["status"]): string {
    switch (status) {
        case "disabled":
            return "Disabled";
        case "starting":
            return "Starting…";
        case "listening":
            return "Listening";
        case "retrying":
            return "Waiting to retry…";
        case "error":
            return "Not listening";
    }
}
