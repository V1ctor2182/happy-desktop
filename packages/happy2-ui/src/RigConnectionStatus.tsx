import { type CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { OnboardingScreen } from "./OnboardingScreen";
import { WindowDragRegion } from "./TitleBar";
import { onboardingBackgroundUrl } from "./assets";

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
    readonly kicker: string;
    readonly title: string;
    readonly copy?: string;
    readonly loadingLabel: string;
    readonly bodyKey: string;
}

function statusModel(props: RigConnectionStatusProps): StatusModel {
    if (props.connection === "connecting")
        return {
            loading: true,
            kicker: "Rig connection",
            title: "Connecting to Rig.",
            loadingLabel: "Reaching your local Rig daemon…",
            bodyKey: "connecting",
        };
    if (props.connection === "disconnected")
        return {
            loading: false,
            kicker: "Rig connection",
            title: "Rig is unreachable.",
            copy: "Happy lost contact with your local Rig daemon and is retrying automatically.",
            loadingLabel: "Reconnecting…",
            bodyKey: "disconnected",
        };
    // connection === "connected": the transport is live; the daemon reports health.
    if (props.daemon === "starting")
        return {
            loading: true,
            kicker: "Rig daemon",
            title: "Starting Rig.",
            loadingLabel: "Waiting for the Rig daemon to become ready…",
            bodyKey: "starting",
        };
    if (props.daemon === "error")
        return {
            loading: false,
            kicker: "Rig daemon",
            title: "Rig could not start.",
            copy: "The Rig daemon is reachable but reported an error.",
            loadingLabel: "Rig daemon error",
            bodyKey: "error",
        };
    return {
        loading: false,
        kicker: "Rig",
        title: "Rig is ready.",
        copy: "Your local Rig workspace is connected.",
        loadingLabel: "Rig is ready",
        bodyKey: "ready",
    };
}

function reconnectingCopy(attempt: number): string {
    return attempt > 1
        ? `Reconnecting… (attempt ${attempt})`
        : "Reconnecting to your local Rig daemon…";
}

/**
 * C-147 RigConnectionStatus — the desktop status surface for the HTTP connection
 * to a local Rig daemon. It renders the whole window as a single onboarding card
 * that reports connection reachability and daemon health, offering a manual retry
 * while disconnected or after a daemon error. Content components are intentionally
 * absent here: this surface only communicates connection state. Props-only,
 * desktop-only; the owner supplies the snapshot fields and the retry handler.
 */
export function RigConnectionStatus(props: RigConnectionStatusProps) {
    const model = statusModel(props);
    return (
        <>
            <WindowDragRegion />
            <OnboardingScreen
                backgroundUrl={onboardingBackgroundUrl}
                bodyKey={model.bodyKey}
                brand={{ name: "Happy Place" }}
                className={props.className}
                copy={model.copy}
                data-testid={props["data-testid"] ?? "rig-connection-status"}
                kicker={model.kicker}
                loadingLabel={model.loadingLabel}
                state={model.loading ? "loading" : "form"}
                style={props.style}
                title={model.title}
                width="large"
            >
                {props.connection === "disconnected" ? (
                    <div
                        className="happy2-rig-connection-status"
                        data-happy2-ui="rig-connection-status-body"
                        style={bodyStyle}
                    >
                        <Banner
                            action={{ label: "Retry now", onClick: props.onRetry }}
                            icon="shield"
                            title={reconnectingCopy(props.attempt)}
                            tone="warning"
                        >
                            {props.message ?? "The Rig daemon did not respond."}
                        </Banner>
                    </div>
                ) : props.connection === "connected" && props.daemon === "error" ? (
                    <div
                        className="happy2-rig-connection-status"
                        data-happy2-ui="rig-connection-status-body"
                        style={bodyStyle}
                    >
                        <Banner icon="shield" title="Rig daemon error" tone="danger">
                            {props.message ?? "The Rig daemon reported an error."}
                        </Banner>
                        <Button onClick={props.onRetry} type="button">
                            Try again
                        </Button>
                    </div>
                ) : props.connection === "connected" && props.daemon === "ready" ? (
                    <div
                        className="happy2-rig-connection-status"
                        data-happy2-ui="rig-connection-status-body"
                        style={bodyStyle}
                    >
                        <Banner icon="check-circle" tone="success">
                            {props.version
                                ? `Connected to Rig ${props.version}.`
                                : "Connected to Rig."}
                        </Banner>
                    </div>
                ) : null}
            </OnboardingScreen>
        </>
    );
}

// Vertical stack of the status banner and its optional retry control. The
// onboarding body owns the outer scrollport; this inner column owns sibling gap.
const bodyStyle: CSSProperties = {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
};
