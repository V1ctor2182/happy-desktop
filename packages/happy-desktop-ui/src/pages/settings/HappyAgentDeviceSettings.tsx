import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

/** The operating systems a Happy Agent installation reports itself as running. */
export type HappyAgentDevicePlatform = "macOS" | "Linux" | "Windows" | "Other";

/** One installation signed into this account. */
export interface HappyAgentDevice {
    readonly agentVersion?: string;
    readonly architecture?: string;
    /** True for the installation this window is talking to. */
    readonly current: boolean;
    readonly id: string;
    /** When it last reached the account, already written the way it is shown. */
    readonly lastAccessed: string;
    /**
     * What it calls itself. Absent for an entry whose metadata this account
     * cannot read yet, which is a device it can see but cannot describe.
     */
    readonly name?: string;
    readonly osVersion?: string;
    readonly platform?: HappyAgentDevicePlatform;
    /** True while this window is waiting for the account to drop it. */
    readonly removing: boolean;
}

/**
 * What the surface knows about the roster right now.
 *
 * `unavailable` is deliberately not a failure: it means Happy Agent has not
 * reached the account, which it retries on its own. Dressing that as an error
 * would tell someone to fix something that is already fixing itself.
 */
export type HappyAgentDeviceRead =
    | { readonly status: "loading" }
    | { readonly status: "ready" }
    | { readonly status: "unavailable" }
    | { readonly error: string; readonly status: "failed" };

export interface HappyAgentDeviceSettingsProps {
    readonly devices: readonly HappyAgentDevice[];
    readonly read: HappyAgentDeviceRead;
    /** Why the last removal was refused. */
    readonly removeError?: string;
    onDeviceRemove(id: string): void;
}

/**
 * Every installation signed into this account, and the one act available for
 * each: drop it.
 *
 * Devices are listed rather than counted because the only useful question about
 * them is which ones they are — a machine you do not recognize is the whole
 * reason to look. This one is marked and cannot be dropped from here: signing
 * this machine out is what Disconnect does, and offering a second control that
 * appears to do it differently would be lying about which.
 *
 * An entry whose metadata this account cannot read still gets a row. Knowing
 * something is signed in and cannot be described is a fact worth showing; a
 * quietly shortened list is not.
 */
export function HappyAgentDeviceSettings(props: HappyAgentDeviceSettingsProps) {
    return (
        <HappyAgentSettingsSection
            description="Every Happy Agent signed into this account. Dropping one makes it sign in again."
            title="Devices"
        >
            {props.read.status === "failed" ? (
                <Banner tone="danger" title="Devices unavailable">
                    {props.read.error}
                </Banner>
            ) : null}
            {props.removeError ? (
                <Banner tone="danger" title="Not removed">
                    {props.removeError}
                </Banner>
            ) : null}
            {props.devices.length === 0 ? (
                <DeviceEmpty read={props.read} />
            ) : (
                props.devices.map((device) => (
                    <FormRow
                        control={
                            device.current ? (
                                <Badge label="This device" variant="neutral" />
                            ) : (
                                <Button
                                    icon="unlink"
                                    loading={device.removing}
                                    onClick={() => props.onDeviceRemove(device.id)}
                                    size="small"
                                    variant="secondary"
                                >
                                    Remove
                                </Button>
                            )
                        }
                        description={deviceDetail(device)}
                        key={device.id}
                        label={device.name ?? "Unnamed device"}
                    />
                ))
            )}
        </HappyAgentSettingsSection>
    );
}

/**
 * What stands where the rows would be when there are none.
 *
 * An empty roster, a first read still running, an account Happy Agent has not
 * reached, and a read that failed are four different facts, and each one is
 * said plainly rather than collapsed into a blank list. `failed` prints nothing
 * here because the banner above already carries it.
 */
function DeviceEmpty(props: { readonly read: HappyAgentDeviceRead }) {
    if (props.read.status === "failed") return null;
    if (props.read.status === "loading")
        return (
            <Box className="happy-agent-settings__pending">
                <Spinner size={16} />
                <span>Reading this account&apos;s devices…</span>
            </Box>
        );
    return (
        <Box className="happy-agent-settings__pending">
            <span>
                {props.read.status === "unavailable"
                    ? "Happy Agent has not reached this account yet. The list fills in once it does."
                    : "No devices are signed into this account."}
            </span>
        </Box>
    );
}

/**
 * The one line under a device's name: what it runs, and when it was last here.
 * Only the parts the entry actually carries are written, so a device this
 * account cannot describe says when it was seen rather than inventing a system
 * for it.
 */
function deviceDetail(device: HappyAgentDevice): string {
    const system = [device.platform, device.osVersion, device.architecture]
        .filter(Boolean)
        .join(" ");
    return [
        system === "" ? undefined : system,
        device.agentVersion === undefined ? undefined : `Happy Agent ${device.agentVersion}`,
        `Last seen ${device.lastAccessed}`,
    ]
        .filter(Boolean)
        .join(" · ");
}
