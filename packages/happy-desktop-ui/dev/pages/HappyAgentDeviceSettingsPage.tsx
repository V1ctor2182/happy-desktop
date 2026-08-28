import {
    HappyAgentDeviceSettings,
    type HappyAgentDevice,
} from "../../src/pages/settings/HappyAgentDeviceSettings";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-278";

const devices: readonly HappyAgentDevice[] = [
    {
        agentVersion: "0.4.22",
        architecture: "arm64",
        current: true,
        id: "device-1",
        lastAccessed: "27 Aug 2026, 02:14",
        name: "Steve's MacBook Pro",
        osVersion: "26.5.0",
        platform: "macOS",
        removing: false,
    },
    {
        agentVersion: "0.4.21",
        architecture: "x64",
        current: false,
        id: "device-2",
        lastAccessed: "26 Aug 2026, 19:03",
        name: "tashkent-build",
        osVersion: "6.8.0",
        platform: "Linux",
        removing: false,
    },
    {
        agentVersion: "0.4.19",
        architecture: "arm64",
        current: false,
        id: "device-3",
        lastAccessed: "21 Aug 2026, 09:47",
        name: "Studio",
        osVersion: "26.4.1",
        platform: "macOS",
        removing: true,
    },
    /* No metadata: an entry this account can see but cannot yet describe. It
       still gets a row, because a quietly shortened list is worse than one
       honest gap. */
    {
        current: false,
        id: "device-4",
        lastAccessed: "14 Aug 2026, 22:10",
        removing: false,
    },
];

const noop = () => undefined;

export function HappyAgentDeviceSettingsPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Every Happy Agent installation signed into one Happy Social account, listed as settings rows. This machine is marked and carries no control — signing it out is what Disconnect does, and a second control that appeared to do the same thing differently would be lying about which. Every other row offers one act: drop it, which makes that installation sign in again."
            title="Account devices"
        >
            <Specimen
                detail="four installations · this machine at the head, then by how recently each reached the account · one removal in flight, one entry with no readable metadata"
                label="The roster"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", width: "720px" }}>
                    <HappyAgentDeviceSettings
                        devices={devices}
                        onDeviceRemove={noop}
                        read={{ status: "ready" }}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="the first read has not answered · an empty list and a wait are different facts, so the wait says so"
                label="Reading"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", width: "720px" }}>
                    <HappyAgentDeviceSettings
                        devices={[]}
                        onDeviceRemove={noop}
                        read={{ status: "loading" }}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="the roster could not be read, and the last removal was refused · both are reported above the list rather than replacing it"
                label="Failures"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", width: "720px" }}>
                    <HappyAgentDeviceSettings
                        devices={devices.slice(0, 2)}
                        onDeviceRemove={noop}
                        read={{
                            error: "Happy Agent refused the roster.",
                            status: "failed",
                        }}
                        removeError="That device was already removed."
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
