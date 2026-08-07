import { SetupPage } from "./SetupPage";

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

/**
 * The window before anything is running: a start button, a wait, or a failure.
 *
 * All three are the same centred page as the rest of setup, so starting Happy
 * and setting it up read as one sequence rather than as two screens that happen
 * to run back to back.
 */
export function DesktopStartupScreen(props: DesktopStartupScreenProps) {
    if (props.phase === "error")
        return (
            <SetupPage
                {...(props.onRetry
                    ? { action: { label: "Try again", onSelect: props.onRetry } }
                    : {})}
                copy={props.error ?? "Happy could not start."}
                data-testid="desktop-startup-screen"
                scene="owl"
                title="Happy couldn't start."
            />
        );

    if (props.phase === "starting")
        return (
            <SetupPage
                copy={props.message ?? "Starting Happy…"}
                data-testid="desktop-startup-screen"
                scene="snail"
                title="Starting Happy…"
            />
        );

    return (
        <SetupPage
            action={{ label: "Start locally", onSelect: props.onSubmit }}
            copy="Happy runs on this machine, and can connect to others you own."
            data-testid="desktop-startup-screen"
            scene="sparkles"
            title="Happy runs on this machine."
        />
    );
}
