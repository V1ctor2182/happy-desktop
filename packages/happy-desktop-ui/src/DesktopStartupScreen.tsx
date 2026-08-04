import type { FormEvent } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { OnboardingScreen } from "./OnboardingScreen";
import { WindowDragRegion } from "./TitleBar";

export type DesktopStartupPhase = "choosing" | "starting" | "error";
export interface DesktopStartupValues {
    mode: "local";
}
export interface DesktopStartupUpdate {
    availableVersion?: string;
    message?: string;
    status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
}
export interface DesktopStartupScreenProps {
    error?: string;
    message?: string;
    onChange(values: DesktopStartupValues): void;
    onInstallUpdate?(): void;
    onRetry?(): void;
    onSubmit(): void;
    phase: DesktopStartupPhase;
    update?: DesktopStartupUpdate;
    values: DesktopStartupValues;
}
export function DesktopStartupScreen(props: DesktopStartupScreenProps) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        props.onSubmit();
    };
    return (
        <>
            <WindowDragRegion />
            <OnboardingScreen
                bodyKey={props.phase}
                brand={{ name: "Happy" }}
                data-testid="desktop-startup-screen"
                kicker="Local desktop"
                loadingLabel={props.message ?? "Starting Happy…"}
                state={props.phase === "starting" ? "loading" : "form"}
                title={
                    props.phase === "error"
                        ? "Happy couldn't start."
                        : "Happy runs on this machine."
                }
                width="large"
            >
                {props.phase === "error" ? (
                    <>
                        <Banner icon="shield" title="Startup failed" tone="danger">
                            {props.error ?? "Happy could not start."}
                        </Banner>
                        {props.onRetry ? <Button onClick={props.onRetry}>Try again</Button> : null}
                    </>
                ) : props.phase === "choosing" ? (
                    <form onSubmit={submit}>
                        <p>Projects, sessions, and Rig stay on this machine.</p>
                        <Button fullWidth size="large" type="submit">
                            Start locally
                        </Button>
                    </form>
                ) : null}
            </OnboardingScreen>
        </>
    );
}
