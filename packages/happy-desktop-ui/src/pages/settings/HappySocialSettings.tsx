import { useId, useState } from "react";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import type { ThemeMode } from "../../ThemeScope";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";
import { HappySocialSetupModal } from "./HappySocialSetupModal";

export type HappySocialStatus =
    | "loading"
    | "disconnected"
    | "authorizing"
    | "connected"
    | "unavailable";

export interface HappySocialRawStatus {
    readonly cloud: HappySocialStatus;
    readonly enrollment:
        | "inactive"
        | "checking"
        | "required"
        | "enrolling"
        | "enrolled"
        | "unsupported";
    readonly keys: "inactive" | "create_required" | "restore_required" | "ready" | "unsupported";
}

export type HappySocialEnrollment =
    | { readonly status: "inactive" }
    | { readonly status: "loading" }
    | {
          readonly enrolling?: boolean;
          readonly error?: string;
          readonly status: "unenrolled";
          readonly username: string;
      }
    | {
          readonly displayName?: string;
          readonly status: "enrolled";
          readonly username: string;
      }
    | { readonly error: string; readonly status: "error" };

export interface HappySocialSettingsProps {
    readonly appearance?: ThemeMode;
    readonly authorizationCompleting?: boolean;
    readonly authorizationStarting?: boolean;
    readonly disconnecting?: boolean;
    readonly displayName?: string;
    readonly email?: string;
    readonly enrollment: HappySocialEnrollment;
    readonly error?: string;
    readonly rawStatus?: HappySocialRawStatus;
    readonly status: HappySocialStatus;
    readonly unavailable?: string;
    onConnect(): void;
    onDisconnect(): void;
    onEnroll(): void;
    onUsernameChange(value: string): void;
}

/** The Happy Social category: one daemon-owned identity and its session actions. */
export function HappySocialSettings(props: HappySocialSettingsProps) {
    const enrollmentUsernameId = `happy-social-username-${useId()}`;
    const [setupOpen, setupOpenSet] = useState(false);
    const keysRequirement = happySocialKeysRequirement(props);
    return (
        <HappyAgentSettingsSection
            description="Happy Agent owns this authentication and keeps its Happy Social session current."
            title="Happy Social"
        >
            {props.unavailable ? (
                <Banner tone="warning" title="Happy Agent unavailable">
                    {props.unavailable}
                </Banner>
            ) : null}
            {props.error ? (
                <Banner tone="danger" title="Happy Social could not connect">
                    {props.error}
                </Banner>
            ) : null}
            <FormRow
                control={
                    props.status === "loading" ? (
                        <Box className="happy-agent-settings__pending">
                            <Spinner size={16} />
                            <span>Checking…</span>
                        </Box>
                    ) : props.status === "connected" ? (
                        <Button
                            disabled={props.unavailable !== undefined}
                            icon="unlink"
                            loading={props.disconnecting}
                            onClick={props.onDisconnect}
                            size="small"
                            variant="secondary"
                        >
                            Disconnect
                        </Button>
                    ) : (
                        <Button
                            disabled={
                                props.unavailable !== undefined || props.status === "unavailable"
                            }
                            icon="link"
                            loading={props.authorizationStarting || props.authorizationCompleting}
                            onClick={() => setupOpenSet(true)}
                            size="small"
                        >
                            {props.status === "authorizing" ? "Continue" : "Join Happy Social"}
                        </Button>
                    )
                }
                description={accountDescription(props)}
                label="Happy Social account"
            />
            {props.rawStatus ? (
                <FormRow
                    control={
                        <code
                            className="happy-social-raw-status"
                            data-happy-desktop-ui="happy-social-raw-status"
                        >
                            {JSON.stringify(props.rawStatus)}
                        </code>
                    }
                    description="Current protocol state reported by Happy Agent"
                    label="Raw status"
                />
            ) : null}
            {props.enrollment.status === "loading" ? (
                <FormRow
                    control={
                        <Box className="happy-agent-settings__pending">
                            <Spinner size={16} />
                            <span>Checking…</span>
                        </Box>
                    }
                    description="Reading the public profile linked to this account"
                    label="Social username"
                />
            ) : props.enrollment.status === "unenrolled" ? (
                <FormRow
                    control={
                        <Button
                            disabled={props.unavailable !== undefined || props.enrollment.enrolling}
                            loading={props.enrollment.enrolling}
                            onClick={() => setupOpenSet(true)}
                            size="small"
                        >
                            Continue enrollment
                        </Button>
                    }
                    description="Choose the @username people will use to find you"
                    label="Social username"
                />
            ) : props.enrollment.status === "enrolled" ? (
                <FormRow
                    control={
                        <span className="happy-social-enrollment__username">
                            @{props.enrollment.username}
                        </span>
                    }
                    description={
                        props.enrollment.displayName
                            ? `${props.enrollment.displayName} is visible to people you connect with`
                            : "Visible to people you connect with"
                    }
                    label="Social username"
                />
            ) : props.enrollment.status === "error" ? (
                <Banner tone="danger" title="Social profile unavailable">
                    {props.enrollment.error}
                </Banner>
            ) : null}
            {keysRequirement ? (
                <FormRow
                    control={
                        <Button onClick={() => setupOpenSet(true)} size="small">
                            Continue setup
                        </Button>
                    }
                    description={
                        keysRequirement === "create_required"
                            ? "Create the encrypted key bundle for this account"
                            : "Restore this account’s encrypted key bundle on this machine"
                    }
                    label="Cloud encryption"
                />
            ) : null}
            {setupOpen ? (
                <HappySocialSetupModal
                    appearance={props.appearance ?? "system"}
                    description={setupDescription(props)}
                    onClose={() => setupOpenSet(false)}
                    status={props.rawStatus ? JSON.stringify(props.rawStatus) : props.status}
                    title={setupTitle(props)}
                >
                    <HappySocialSetupContent
                        enrollmentUsernameId={enrollmentUsernameId}
                        props={props}
                    />
                </HappySocialSetupModal>
            ) : null}
        </HappyAgentSettingsSection>
    );
}

function HappySocialSetupContent(props: {
    readonly enrollmentUsernameId: string;
    readonly props: HappySocialSettingsProps;
}) {
    const social = props.props;
    if (social.unavailable)
        return (
            <Banner tone="warning" title="Happy Agent unavailable">
                {social.unavailable}
            </Banner>
        );
    if (social.status === "loading")
        return (
            <Box className="happy-agent-settings__pending">
                <Spinner size={16} />
                <span>Checking…</span>
            </Box>
        );
    if (social.status !== "connected")
        return (
            <Button
                icon="link"
                loading={social.authorizationStarting || social.authorizationCompleting}
                onClick={social.onConnect}
                size="large"
            >
                {social.status === "authorizing" ? "Open browser" : "Connect"}
            </Button>
        );
    if (social.enrollment.status === "loading")
        return (
            <Box className="happy-agent-settings__pending">
                <Spinner size={16} />
                <span>Checking enrollment…</span>
            </Box>
        );
    if (social.enrollment.status === "unenrolled")
        return (
            <form
                className="happy-social-enrollment"
                data-happy-desktop-ui="happy-social-enrollment"
                onSubmit={(event) => {
                    event.preventDefault();
                    social.onEnroll();
                }}
            >
                <Box className="happy-social-enrollment__controls">
                    <TextField
                        autoComplete="username"
                        autoFocus
                        className="happy-social-enrollment__field"
                        disabled={social.enrollment.enrolling}
                        error={social.enrollment.error}
                        fullWidth
                        id={props.enrollmentUsernameId}
                        name="happy-social-username"
                        onValueChange={social.onUsernameChange}
                        placeholder="steve"
                        required
                        size="medium"
                        value={social.enrollment.username}
                    />
                    <Button
                        disabled={social.enrollment.username.trim() === ""}
                        loading={social.enrollment.enrolling}
                        size="medium"
                        type="submit"
                    >
                        Continue
                    </Button>
                </Box>
            </form>
        );
    if (social.enrollment.status === "error")
        return (
            <Banner tone="danger" title="Social profile unavailable">
                {social.enrollment.error}
            </Banner>
        );
    return null;
}

function setupTitle(props: HappySocialSettingsProps): string {
    const keysRequirement = happySocialKeysRequirement(props);
    if (keysRequirement === "create_required") return "Create encryption keys";
    if (keysRequirement === "restore_required") return "Restore encryption keys";
    if (props.status === "connected")
        return props.enrollment.status === "enrolled"
            ? "Happy Social is ready"
            : "Continue enrollment";
    return "Join Happy Social";
}

function setupDescription(props: HappySocialSettingsProps): string {
    const keysRequirement = happySocialKeysRequirement(props);
    if (keysRequirement === "create_required")
        return "Create an encrypted key bundle before Happy Cloud can protect synced data.";
    if (keysRequirement === "restore_required")
        return "Restore this account’s encrypted key bundle to unlock protected data on this machine.";
    if (props.status !== "connected")
        return "Connect this Happy Agent to carry your identity and encrypted Cloud data.";
    if (props.enrollment.status === "enrolled")
        return `@${props.enrollment.username} is connected on this Happy Agent.`;
    return "Choose the public username people will use to find you. It cannot be changed later.";
}

function happySocialKeysRequirement(
    props: HappySocialSettingsProps,
): "create_required" | "restore_required" | undefined {
    return props.rawStatus?.keys === "create_required" ||
        props.rawStatus?.keys === "restore_required"
        ? props.rawStatus.keys
        : undefined;
}

function accountDescription(props: HappySocialSettingsProps): string {
    switch (props.status) {
        case "loading":
            return "Reading the saved Happy Social session from Happy Agent";
        case "disconnected":
            return "Connect this Happy Agent to Happy Social";
        case "authorizing":
            return props.authorizationCompleting
                ? "Completing authentication with Happy Agent"
                : "Finish authentication in your browser, or reopen it with Connect";
        case "connected":
            return (
                [props.displayName, props.email].filter(Boolean).join(" · ") ||
                "Connected through Happy Agent"
            );
        case "unavailable":
            return "This Happy Agent does not support Happy Social authentication";
    }
}
