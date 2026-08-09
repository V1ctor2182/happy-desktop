import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { CopyButton } from "../../CopyButton";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { RigSettingsSection } from "./RigSettingsShell";

export interface RigDebugTarget {
    readonly error?: string;
    readonly status: "stopped" | "starting" | "running" | "stopping" | "unavailable" | "error";
    readonly url?: string;
}

export type RigDebugSettingsProps = {
    readonly daemon: RigDebugTarget;
    readonly daemonConnected: boolean;
    readonly error?: string;
    readonly loading?: boolean;
    readonly main: RigDebugTarget;
    readonly onAllStart: () => void;
    readonly onAllStop: () => void;
    readonly onDaemonStart: () => void;
    readonly onDaemonStop: () => void;
    readonly onMainStart: () => void;
    readonly onMainStop: () => void;
    readonly onRendererStart: () => void;
    readonly onRendererStop: () => void;
    readonly renderer: RigDebugTarget;
    readonly supported: boolean;
};

/**
 * Live native debugger controls. Every target binds to loopback on demand, and
 * every copied address is the raw WebSocket endpoint an external CDP client uses.
 */
export function RigDebugSettings(props: RigDebugSettingsProps) {
    if (!props.supported && !props.loading)
        return (
            <Banner tone="neutral" title="Electron desktop only">
                Live debugger attachment is available in Happy’s Electron desktop window.
            </Banner>
        );

    const targets = [props.main, props.renderer, props.daemon];
    const anyPending = targets.some((target) => pending(target));
    const allRunning = targets.every((target) => target.status === "running");
    const allStopped = targets.every(
        (target) =>
            target.status === "stopped" || (target.status === "error" && target.url === undefined),
    );

    return (
        <>
            {props.error ? (
                <Banner tone="danger" title="Dev Tools unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.loading ? (
                <Box className="happy2-rig-settings__pending">
                    <Spinner size={16} />
                    <span>Reading debugger status…</span>
                </Box>
            ) : null}
            <RigSettingsSection
                description="Starts and stops every debugger live. Happy stays open and the renderer is not reloaded."
                title="Control"
            >
                <FormRow
                    control={
                        <Box style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <Button
                                disabled={
                                    !props.supported || props.loading || anyPending || allRunning
                                }
                                loading={targets.some((target) => target.status === "starting")}
                                onClick={props.onAllStart}
                                size="small"
                                variant="secondary"
                            >
                                Start all
                            </Button>
                            <Button
                                disabled={
                                    !props.supported || props.loading || anyPending || allStopped
                                }
                                loading={targets.some((target) => target.status === "stopping")}
                                onClick={props.onAllStop}
                                size="small"
                                variant="secondary"
                            >
                                Stop all
                            </Button>
                        </Box>
                    }
                    description="Electron main, the current Happy renderer, and the local Rig daemon"
                    label="All debuggers"
                />
            </RigSettingsSection>
            <RigSettingsSection
                description="Each endpoint listens only on 127.0.0.1. Copy its WebSocket URL into a raw CDP client."
                title="Attachment points"
            >
                <DebuggerRow
                    copyLabel="Copy Electron main debugger URL"
                    label="Electron main"
                    onStart={props.onMainStart}
                    onStop={props.onMainStop}
                    target={props.main}
                />
                <DebuggerRow
                    copyLabel="Copy Happy renderer CDP URL"
                    label="Happy renderer"
                    onStart={props.onRendererStart}
                    onStop={props.onRendererStop}
                    target={props.renderer}
                />
                <DebuggerRow
                    copyLabel="Copy Rig daemon debugger URL"
                    disabled={!props.daemonConnected}
                    label="Rig daemon"
                    onStart={props.onDaemonStart}
                    onStop={props.onDaemonStop}
                    target={props.daemon}
                    unavailable="Rig is not connected"
                />
            </RigSettingsSection>
        </>
    );
}

function DebuggerRow(props: {
    readonly copyLabel: string;
    readonly disabled?: boolean;
    readonly label: string;
    readonly onStart: () => void;
    readonly onStop: () => void;
    readonly target: RigDebugTarget;
    readonly unavailable?: string;
}) {
    const url = props.target.url;
    const running = props.target.status === "running" && url !== undefined;
    const stopping = props.target.status === "stopping";
    const unavailable = props.target.status === "unavailable";
    const stopFailed = props.target.status === "error" && url !== undefined;
    return (
        <FormRow
            control={
                running || stopping || unavailable || stopFailed ? (
                    <Box style={{ alignItems: "center", display: "flex", gap: 6 }}>
                        {url ? <CopyButton label={props.copyLabel} text={url} /> : null}
                        <Button
                            disabled={props.disabled}
                            loading={stopping}
                            onClick={props.onStop}
                            size="small"
                            variant="secondary"
                        >
                            Stop
                        </Button>
                    </Box>
                ) : (
                    <Button
                        disabled={props.disabled}
                        loading={props.target.status === "starting"}
                        onClick={props.onStart}
                        size="small"
                        variant="secondary"
                    >
                        Start
                    </Button>
                )
            }
            description={targetDescription(props.target, props.disabled, props.unavailable)}
            label={props.label}
        />
    );
}

function targetDescription(
    target: RigDebugTarget,
    unavailable: boolean | undefined,
    unavailableMessage: string | undefined,
): string {
    if (target.status === "running" && target.url) return target.url;
    if (target.status === "starting") return "Starting…";
    if (target.status === "stopping") return "Stopping…";
    if (target.error) return target.error;
    if (unavailable) return unavailableMessage ?? "Unavailable";
    return "Not listening";
}

function pending(target: RigDebugTarget): boolean {
    return target.status === "starting" || target.status === "stopping";
}
