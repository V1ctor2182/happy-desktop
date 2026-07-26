import { type CSSProperties } from "react";
import { RigConnectionStatus } from "../../src/RigConnectionStatus";
import { ComponentPage, Specimen } from "../kit";

const frame: CSSProperties = { width: "720px", height: "480px" };

export function RigConnectionStatusPage() {
    return (
        <ComponentPage
            number="C-147"
            summary="Minimal desktop status surface for the local Rig daemon: one muted ASCII loader, a neutral status, and concise progress."
            title="Rig connection status"
        >
            <Specimen
                detail="Centered muted ASCII loader · neutral status and progress"
                label="Connecting"
                number="01"
                stage="app"
            >
                <div style={frame}>
                    <RigConnectionStatus
                        attempt={0}
                        connection="connecting"
                        daemon="unknown"
                        onRetry={() => undefined}
                    />
                </div>
            </Specimen>
            <Specimen
                detail="Transport live, daemon booting"
                label="Daemon starting"
                number="02"
                stage="app"
            >
                <div style={frame}>
                    <RigConnectionStatus
                        attempt={0}
                        connection="connected"
                        daemon="starting"
                        onRetry={() => undefined}
                        version="1.4.2"
                    />
                </div>
            </Specimen>
            <Specimen
                detail="Connected and ready — status only; content arrives later"
                label="Ready"
                number="03"
                stage="app"
            >
                <div style={frame}>
                    <RigConnectionStatus
                        attempt={0}
                        connection="connected"
                        daemon="ready"
                        onRetry={() => undefined}
                        version="1.4.2"
                    />
                </div>
            </Specimen>
            <Specimen
                detail="Dropped connection with automatic backoff and manual retry"
                label="Disconnected"
                number="04"
                stage="app"
            >
                <div style={frame}>
                    <RigConnectionStatus
                        attempt={3}
                        connection="disconnected"
                        daemon="unknown"
                        message="connect ECONNREFUSED"
                        onRetry={() => undefined}
                    />
                </div>
            </Specimen>
            <Specimen
                detail="Daemon reachable but reporting an error"
                label="Daemon error"
                number="05"
                stage="app"
            >
                <div style={frame}>
                    <RigConnectionStatus
                        attempt={0}
                        connection="connected"
                        daemon="error"
                        message="No provider is authenticated."
                        onRetry={() => undefined}
                        version="1.4.2"
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
