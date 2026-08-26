import { useId } from "react";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

export type HappySocialStatus =
    | "loading"
    | "disconnected"
    | "authorizing"
    | "connected"
    | "unavailable";

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
    readonly authorizationCompleting?: boolean;
    readonly authorizationStarting?: boolean;
    readonly disconnecting?: boolean;
    readonly displayName?: string;
    readonly email?: string;
    readonly enrollment: HappySocialEnrollment;
    readonly error?: string;
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
                            onClick={props.onConnect}
                            size="small"
                        >
                            {props.status === "authorizing" ? "Open browser" : "Connect"}
                        </Button>
                    )
                }
                description={accountDescription(props)}
                label="Happy Social account"
            />
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
                <form
                    className="happy-social-enrollment"
                    data-happy-desktop-ui="happy-social-enrollment"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onEnroll();
                    }}
                >
                    <FormRow
                        control={
                            <Box className="happy-social-enrollment__controls">
                                <TextField
                                    autoComplete="username"
                                    autoFocus
                                    className="happy-social-enrollment__field"
                                    disabled={
                                        props.unavailable !== undefined ||
                                        props.enrollment.enrolling
                                    }
                                    error={props.enrollment.error}
                                    fullWidth
                                    id={enrollmentUsernameId}
                                    name="happy-social-username"
                                    onValueChange={props.onUsernameChange}
                                    placeholder="steve"
                                    required
                                    size="medium"
                                    value={props.enrollment.username}
                                />
                                <Button
                                    disabled={
                                        props.unavailable !== undefined ||
                                        props.enrollment.username.trim() === ""
                                    }
                                    loading={props.enrollment.enrolling}
                                    size="medium"
                                    type="submit"
                                    variant="primary"
                                >
                                    Continue
                                </Button>
                            </Box>
                        }
                        description="Choose the @username people will use to find you. It cannot be changed later."
                        htmlFor={enrollmentUsernameId}
                        label="Choose a username"
                        layout="stacked"
                    />
                </form>
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
        </HappyAgentSettingsSection>
    );
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
