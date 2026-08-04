import type { TerminalGridSnapshot } from "happy-desktop-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { OnboardingScreen } from "./OnboardingScreen";
import { TerminalPanel } from "./TerminalPanel";
import { WindowDragRegion } from "./TitleBar";

export interface LocalOnboardingTerminal {
    readonly grid?: TerminalGridSnapshot;
    readonly running: boolean;
}

export type LocalOnboardingView =
    | { readonly kind: "checking"; readonly message?: string }
    | { readonly kind: "node-missing" }
    | { readonly kind: "rig-missing"; readonly nodeVersion: string; readonly message?: string }
    | { readonly kind: "rig-installing"; readonly terminal: LocalOnboardingTerminal }
    | {
          readonly kind: "rig-install-failed";
          readonly terminal: LocalOnboardingTerminal;
          readonly message: string;
      }
    | { readonly kind: "connecting" }
    | { readonly kind: "connect-failed"; readonly message: string }
    | { readonly kind: "examining" }
    | { readonly kind: "project"; readonly busy: boolean; readonly message?: string };

export interface LocalOnboardingScreenProps {
    readonly view: LocalOnboardingView;
    onRigInstall(): void;
    onTerminalInput(data: string): void;
    onTerminalResize(cols: number, rows: number): void;
    onConnectRetry(): void;
    onProjectChoose(): void;
}

export function LocalOnboardingScreen(props: LocalOnboardingScreenProps) {
    const { view } = props;
    const loading =
        view.kind === "checking" || view.kind === "connecting" || view.kind === "examining";
    return (
        <>
            <WindowDragRegion />
            <OnboardingScreen
                bodyKey={view.kind}
                brand={{ name: "Happy" }}
                data-testid="local-onboarding-screen"
                kicker="Set up this machine"
                loadingLabel="Checking this machine…"
                state={loading ? "loading" : "form"}
                steps={[
                    {
                        label: "This machine",
                        state: view.kind === "project" ? "complete" : "current",
                    },
                    {
                        label: "First project",
                        state: view.kind === "project" ? "current" : "upcoming",
                    },
                ]}
                title={
                    view.kind === "project" ? "Open your first project." : "Set up Happy locally."
                }
                width="large"
            >
                {body(props)}
            </OnboardingScreen>
        </>
    );
}

function body(props: LocalOnboardingScreenProps) {
    const { view } = props;
    if (view.kind === "checking" || view.kind === "connecting" || view.kind === "examining")
        return null;
    if (view.kind === "node-missing")
        return (
            <Banner icon="shield" title="Node.js is required" tone="warning">
                Install Node.js, then Happy will continue automatically.
            </Banner>
        );
    if (view.kind === "rig-missing")
        return (
            <Button onClick={props.onRigInstall} size="large">
                Install Rig
            </Button>
        );
    if (view.kind === "rig-installing" || view.kind === "rig-install-failed")
        return (
            <TerminalPanel
                {...(view.terminal.grid ? { grid: view.terminal.grid } : {})}
                height={320}
                onInput={props.onTerminalInput}
                onReconnect={() => undefined}
                onResize={props.onTerminalResize}
                status={view.terminal.running ? "connected" : "exited"}
            />
        );
    if (view.kind === "connect-failed")
        return <Button onClick={props.onConnectRetry}>Try again</Button>;
    return (
        <Button disabled={view.busy} onClick={props.onProjectChoose} size="large">
            {view.busy ? "Opening…" : "Choose a folder…"}
        </Button>
    );
}
