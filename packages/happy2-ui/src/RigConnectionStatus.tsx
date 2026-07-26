import { type CSSProperties } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { WindowDragRegion } from "./TitleBar";

export type RigConnectionState = "connecting" | "connected" | "disconnected";
export type RigDaemonState = "unknown" | "starting" | "ready" | "error";

export interface RigConnectionStatusProps {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** Transport reachability, independent of daemon health. */
    connection: RigConnectionState;
    /** Daemon liveness reported by the last successful probe. */
    daemon: RigDaemonState;
    /** Daemon version, when a probe has succeeded. */
    version?: string;
    /** Error detail for a daemon error or a probe failure. */
    message?: string;
    /** Consecutive failed reconnect attempts; zero while connected. */
    attempt: number;
    onRetry(): void;
}

interface StatusModel {
    readonly loading: boolean;
    readonly status: string;
    readonly progress: string;
}

function statusModel(props: RigConnectionStatusProps): StatusModel {
    if (props.connection === "connecting")
        return {
            loading: true,
            status: "Connecting to Rig",
            progress: "Checking the local service…",
        };
    if (props.connection === "disconnected")
        return {
            loading: true,
            status: "Reconnecting to Rig",
            progress:
                props.attempt > 1
                    ? `Waiting for the local service · attempt ${props.attempt}`
                    : "Waiting for the local service…",
        };
    // connection === "connected": the transport is live; the daemon reports health.
    if (props.daemon === "starting")
        return {
            loading: true,
            status: "Starting Rig",
            progress: "Waiting for the daemon to become ready…",
        };
    if (props.daemon === "error")
        return {
            loading: false,
            status: "Rig needs attention",
            progress: props.message ?? "The local daemon reported an error.",
        };
    return {
        loading: false,
        status: "Rig is ready",
        progress: props.version ? `Local daemon ${props.version}` : "Local daemon connected",
    };
}

/**
 * C-147 RigConnectionStatus — the desktop status surface for the HTTP connection
 * to a local Rig daemon. One centered, muted ASCII loader and two neutral lines
 * report connection reachability and daemon progress without presenting startup
 * as an onboarding or warning flow. A quiet retry action appears only when the
 * owner can intervene. Props-only and desktop-only.
 */
export function RigConnectionStatus(props: RigConnectionStatusProps) {
    const model = statusModel(props);
    const canRetry =
        props.connection === "disconnected" ||
        (props.connection === "connected" && props.daemon === "error");
    return (
        <>
            <WindowDragRegion />
            <section
                className={["happy2-rig-connection-status", props.className]
                    .filter(Boolean)
                    .join(" ")}
                data-testid={props["data-testid"] ?? "rig-connection-status"}
                data-happy2-ui="rig-connection-status"
                data-state={props.connection === "connected" ? props.daemon : props.connection}
                style={props.style}
            >
                <div
                    aria-live="polite"
                    className="happy2-rig-connection-status__content"
                    data-happy2-ui="rig-connection-status-body"
                >
                    <span
                        className="happy2-rig-connection-status__loader"
                        data-happy2-ui="rig-connection-status-loader"
                    >
                        {model.loading ? (
                            <Spinner label={model.status} size={20} tone="muted" variant="line" />
                        ) : (
                            <span aria-hidden className="happy2-rig-connection-status__marker">
                                ·
                            </span>
                        )}
                    </span>
                    <strong
                        className="happy2-rig-connection-status__status"
                        data-happy2-ui="rig-connection-status-label"
                    >
                        {model.status}
                    </strong>
                    <span
                        className="happy2-rig-connection-status__progress"
                        data-happy2-ui="rig-connection-status-progress"
                    >
                        {model.progress}
                    </span>
                    {canRetry ? (
                        <Button onClick={props.onRetry} size="small" type="button" variant="ghost">
                            Retry now
                        </Button>
                    ) : null}
                </div>
            </section>
        </>
    );
}
