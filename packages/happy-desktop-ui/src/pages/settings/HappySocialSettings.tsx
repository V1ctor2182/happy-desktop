import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import type { ThemeMode } from "../../ThemeScope";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";
import {
    HappySocialJoin,
    happySocialJoinDescription,
    happySocialJoinPresentation,
    happySocialJoinTitle,
    type HappySocialJoinProps,
    type HappySocialJoinState,
} from "./HappySocialJoin";
import { HappySocialSetupModal } from "./HappySocialSetupModal";

export type HappySocialStatus =
    | "loading"
    | "disconnected"
    | "authorizing"
    | "connected"
    | "unavailable";

/**
 * Where this account's end-to-end encryption keys stand on this machine.
 * `checking` is a connected account whose keys Happy Agent has not decided about
 * yet, and `resetting` is one clearing a bundle it cannot open; both are waits
 * rather than something to offer the reader.
 */
export type HappySocialKeysStatus =
    | "inactive"
    | "checking"
    | "create_required"
    | "restore_required"
    | "resetting"
    | "ready";

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
    /** The join flow's own state, and whether its surface is on screen. */
    readonly join: HappySocialJoinState;
    readonly joinActions: Omit<HappySocialJoinProps, "state">;
    /**
     * Whether joining is offered at all. Happy Social is still being built, so a
     * reader who has not asked for unfinished work is not invited into it.
     *
     * The gate is only about starting. An account that already exists keeps
     * every control it needs — resuming an unfinished setup, and disconnecting —
     * because turning the switch back off must not strand somebody mid-errand
     * with an account they cannot finish or leave.
     */
    readonly joinable: boolean;
    readonly joinOpen: boolean;
    readonly keys: HappySocialKeysStatus;
    readonly status: HappySocialStatus;
    readonly unavailable?: string;
    onDisconnect(): void;
    onJoinClose(): void;
    onJoinOpen(): void;
}

/**
 * The Happy Social category: one daemon-owned identity, and one control.
 *
 * Joining is a single errand with several steps, and the setup surface already
 * owns every one of them. This category therefore says where the account stands
 * and offers the one act available from here — start or resume the errand, or
 * disconnect a finished one. It does not restate the steps as separate rows: a
 * screen listing "social username" and "cloud encryption" beside their own
 * buttons was describing the internals of a flow the reader never sees in those
 * terms, and gave three different places to press for one outcome.
 *
 * With one row left there is nothing for a section heading to introduce: the
 * row's own label names the account and its description says where it stands,
 * so a title and a sentence above it were saying the same thing a third time.
 */
export function HappySocialSettings(props: HappySocialSettingsProps) {
    // No account, and no way to start one: there is nothing to report. A row
    // describing what Happy Social would do, under a control that is not there,
    // is furniture rather than information.
    if (!props.joinable && !accountExists(props)) return null;
    return (
        <HappyAgentSettingsSection>
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
            {props.enrollment.status === "error" ? (
                <Banner tone="danger" title="Social profile unavailable">
                    {props.enrollment.error}
                </Banner>
            ) : null}
            <FormRow
                control={
                    props.status === "loading" || props.enrollment.status === "loading" ? (
                        <Box className="happy-agent-settings__pending">
                            <Spinner size={16} />
                            <span>Checking…</span>
                        </Box>
                    ) : happySocialComplete(props) ? (
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
                            loading={
                                props.authorizationStarting ||
                                props.authorizationCompleting ||
                                (props.enrollment.status === "unenrolled" &&
                                    props.enrollment.enrolling === true)
                            }
                            onClick={props.onJoinOpen}
                            size="small"
                        >
                            {props.status === "disconnected"
                                ? "Join Happy Social"
                                : "Continue setup"}
                        </Button>
                    )
                }
                description={accountDescription(props)}
                label="Happy Social account"
            />
            {props.joinOpen ? (
                <HappySocialSetupModal
                    appearance={props.appearance ?? "system"}
                    description={happySocialJoinDescription(props.join)}
                    onClose={props.onJoinClose}
                    presentation={happySocialJoinPresentation(props.join)}
                    title={happySocialJoinTitle(props.join)}
                >
                    <HappySocialJoin {...props.joinActions} state={props.join} />
                </HappySocialSetupModal>
            ) : null}
        </HappyAgentSettingsSection>
    );
}

/**
 * Whether the account is finished and nothing is left to do here. Signing in is
 * only the first of the join errand's steps, so a connected account that has
 * not claimed a username or made its keys is still mid-errand and must offer to
 * resume rather than to disconnect.
 */
/**
 * Whether this machine already carries a Happy Social account, however far
 * through the errand it is. `loading` counts as not yet: a saved session that
 * turns out to exist adds the row, which is better than showing one that
 * vanishes when the read comes back empty.
 */
function accountExists(props: HappySocialSettingsProps): boolean {
    return props.status === "connected" || props.status === "authorizing";
}

function happySocialComplete(props: HappySocialSettingsProps): boolean {
    return (
        props.status === "connected" &&
        props.enrollment.status === "enrolled" &&
        props.keys !== "create_required" &&
        props.keys !== "restore_required"
    );
}

/** What the one row says about the account, under its label. */
function accountDescription(props: HappySocialSettingsProps): string {
    if (props.status === "loading")
        return "Reading the saved Happy Social session from Happy Agent";
    if (props.status === "unavailable")
        return "This Happy Agent does not support Happy Social authentication";
    if (props.status === "disconnected")
        return "Share sessions, work with other people, and sync this machine";
    if (props.status === "authorizing")
        return props.authorizationCompleting
            ? "Completing authentication with Happy Agent"
            : "Finish signing in through your browser";
    // Connected, but the rest of the errand may still be unfinished.
    if (props.enrollment.status === "unenrolled")
        return "Choose the username people will find you by";
    if (props.keys === "create_required") return "Create the encryption keys for this account";
    if (props.keys === "restore_required") return "Unlock this machine with your secret key";
    return (
        [props.displayName, props.email].filter(Boolean).join(" · ") ||
        "Connected through Happy Agent"
    );
}
