import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

export type HappySocialStatus =
    | "loading"
    | "disconnected"
    | "authorizing"
    | "connected"
    | "unavailable";

export interface HappySocialSettingsProps {
    readonly authorizationCompleting?: boolean;
    readonly authorizationStarting?: boolean;
    readonly disconnecting?: boolean;
    readonly displayName?: string;
    readonly email?: string;
    readonly error?: string;
    readonly status: HappySocialStatus;
    readonly unavailable?: string;
    onConnect(): void;
    onDisconnect(): void;
}

/** The Happy Social category: one daemon-owned identity and its session actions. */
export function HappySocialSettings(props: HappySocialSettingsProps) {
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
