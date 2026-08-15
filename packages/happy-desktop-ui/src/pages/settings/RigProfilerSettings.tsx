import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { CopyButton } from "../../CopyButton";
import { FormRow } from "../../FormRow";
import { RigSettingsSection } from "./RigSettingsShell";

export type RigProfilerStatus =
    | "stopped"
    | "starting"
    | "running"
    | "stopping"
    | "partial"
    | "error"
    | "unavailable";

export interface RigProfilerCapabilities {
    readonly liveDebuggerAttach: boolean;
    readonly nativeTrace: boolean;
    readonly processMetrics: boolean;
    readonly reactAttribution: boolean;
    readonly reactDevtoolsProfiling: boolean;
    readonly rendererMetrics: boolean;
}

export interface RigProfilerSettingsProps {
    readonly artifactPath?: string;
    readonly capabilities: RigProfilerCapabilities;
    readonly error?: string;
    readonly onStart: () => void;
    readonly onStop: () => void;
    readonly partialReason?: string;
    readonly status: RigProfilerStatus;
    readonly supported: boolean;
}

/**
 * The profile control stays beside the live debugger controls in Dev Tools.
 * It describes the build capability explicitly: a normal renderer can still
 * capture native CDP timings, but cannot acquire React attribution after boot.
 */
export function RigProfilerSettings(props: RigProfilerSettingsProps) {
    const running = props.status === "running";
    const pending = props.status === "starting" || props.status === "stopping";
    const unavailable =
        !props.supported || (!props.capabilities.nativeTrace && props.status === "unavailable");
    return (
        <>
            {props.error ? (
                <Banner tone="danger" title="Profiler unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {unavailable ? (
                <Banner tone="neutral" title="Electron desktop only">
                    Native tracing and process metrics are available in Happy’s Electron desktop
                    window.
                </Banner>
            ) : null}
            <RigSettingsSection
                description="Capture a bounded renderer trace, React commits, changed hook indices, and native process metrics."
                title="React renderer profile"
            >
                <FormRow
                    control={
                        <Box style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <Button
                                disabled={unavailable || pending || running}
                                loading={props.status === "starting"}
                                onClick={props.onStart}
                                size="small"
                                variant="secondary"
                            >
                                Start profile
                            </Button>
                            <Button
                                disabled={unavailable || pending || !running}
                                loading={props.status === "stopping"}
                                onClick={props.onStop}
                                size="small"
                                variant="secondary"
                            >
                                Stop and save
                            </Button>
                        </Box>
                    }
                    description={statusDescription(props.status, props.partialReason)}
                    label="Capture"
                />
                <FormRow
                    control={
                        <span>
                            {props.capabilities.reactAttribution ? "Available" : "Unavailable"}
                        </span>
                    }
                    description="Requires a profile build with the hook installed before React starts. Standard builds remain native-only."
                    label="React attribution"
                />
                <FormRow
                    control={
                        <span>
                            {props.capabilities.liveDebuggerAttach
                                ? "Available during capture"
                                : "Unavailable"}
                        </span>
                    }
                    description="The external renderer debugger stays attached during capture; exclusive trace commands are rejected rather than stealing it."
                    label="Live debugger"
                />
                <FormRow
                    control={
                        <span>
                            {props.capabilities.reactDevtoolsProfiling
                                ? "Available"
                                : "Unavailable"}
                        </span>
                    }
                    description="The profile renderer installed the official React DevTools backend before React started."
                    label="React DevTools profiling"
                />
                {props.artifactPath ? (
                    <FormRow
                        control={
                            <CopyButton
                                label="Copy profiler artifact path"
                                text={props.artifactPath}
                            />
                        }
                        description={props.artifactPath}
                        label="Last artifact"
                    />
                ) : null}
            </RigSettingsSection>
        </>
    );
}

function statusDescription(status: RigProfilerStatus, partialReason?: string): string {
    if (status === "starting") return "Starting the native trace…";
    if (status === "running") return "Capturing until Stop or the one-minute safety limit.";
    if (status === "stopping") return "Stopping React and writing the artifact…";
    if (status === "partial")
        return partialReason
            ? `Saved a partial artifact: ${partialReason}`
            : "Saved a partial artifact.";
    if (status === "error") return "The last capture failed.";
    return "No profile is currently running.";
}
