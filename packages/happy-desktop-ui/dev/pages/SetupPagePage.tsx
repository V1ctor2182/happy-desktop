import { SetupChoice } from "../../src/SetupChoice";
import { LocalOnboardingScreen } from "../../src/LocalOnboardingScreen";
import { SetupPage } from "../../src/SetupPage";
import { ThemeScope } from "../../src/ThemeScope";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-252";

const noop = () => undefined;

/** Setup fills the window, so every specimen gets a window-shaped frame. */
const frame = {
    border: "1px solid var(--border)",
    borderRadius: "10px",
    height: "460px",
    overflow: "hidden",
    position: "relative" as const,
    width: "100%",
};

export function SetupPagePage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="One step of setup as one centred page: a picture of what is happening, a sentence naming it, a line explaining it, and at most one thing to do. Every first-run state is this component with different fields filled in."
            title="Setup page"
        >
            <Specimen
                detail="Waiting on the machine · scene, title, copy, no action"
                label="Waiting"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            copy="Reading what this machine already has."
                            scene="snail"
                            title="Checking this machine…"
                        />
                    </div>
                    <DimensionRule label="560 body · 40 padding · 120 stage · 24 gap" />
                </div>
            </Specimen>

            <Specimen
                detail="A failure that can be named: the error verbatim, the command to run, one retry"
                label="Failed"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{ label: "Try again", onSelect: noop }}
                            command="happy-agent start"
                            copy="connect ENOENT /Users/you/.happy/agent/server.sock"
                            scene="owl"
                            title="Happy could not reach Happy Agent"
                        />
                    </div>
                    <DimensionRule label="Command is selectable · monospace on surface-high" />
                </div>
            </Specimen>

            <Specimen
                detail="A body of its own replaces the scene: the fork is already a picture"
                label="With a body"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage title="How should Happy run?">
                            <SetupChoice
                                onSelect={noop}
                                options={[
                                    {
                                        actionLabel: "Stay in the app",
                                        description:
                                            "Everything happens in this window. Nothing is added to your machine.",
                                        id: "app",
                                        scene: "sparkles",
                                        title: "Just the app",
                                    },
                                    {
                                        actionLabel: "Install the CLI",
                                        actionVariant: "primary",
                                        description:
                                            "Happy Agent is a coding agent you run from a terminal, always in sync with this app.",
                                        id: "happy-agent",
                                        scene: "robot",
                                        title: "Install CLI tools",
                                    },
                                ]}
                            />
                        </SetupPage>
                    </div>
                    <DimensionRule label="Slot is full width inside the body measure" />
                </div>
            </Specimen>

            <Specimen
                detail="A step, not a fault: no error, no command, and the wait sits on the button"
                label="Waiting on you"
                number="04"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{ busy: true, label: "Check again", onSelect: noop }}
                            copy="Happy Agent runs the coding assistants you have already signed in to, and none are signed in yet. Sign in to Codex, Claude Code or Grok in a terminal, and Happy picks it up from there."
                            scene="owl"
                            title="No coding assistant yet"
                        />
                    </div>
                    <DimensionRule label="Busy action spins in place · the page does not change" />
                </div>
            </Specimen>

            <Specimen
                detail="Title alone, when there is nothing truthful to add under it"
                label="Bare"
                number="05"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{ label: "Choose a folder…", onSelect: noop }}
                            scene="wand"
                            title="Open your first project"
                        />
                    </div>
                    <DimensionRule label="Missing fields collapse; the column stays centred" />
                </div>
            </Specimen>

            <Specimen
                detail="Managed first install · one verified download action, with no terminal prerequisite"
                label="Download Happy Agent"
                number="06"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{ label: "Download and start", onSelect: noop }}
                            copy="Happy downloads the published release for this Mac, verifies its checksum, and keeps each version isolated before starting it."
                            scene="owl"
                            title="Download Happy Agent"
                        />
                    </div>
                    <DimensionRule label="One native action · 36px button, sized to its label" />
                </div>
            </Specimen>

            <Specimen
                detail="Bytes arriving · the bar stands where the button stood, at the same height"
                label="Measured progress"
                number="07"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{
                                busy: true,
                                label: "Downloading…",
                                onSelect: noop,
                                progress: {
                                    detail: "12.4 MB of 38.2 MB",
                                    fraction: 0.32,
                                    kind: "measured",
                                },
                            }}
                            copy="Downloading Happy Agent 0.0.11…"
                            scene="owl"
                            title="Download Happy Agent"
                        />
                    </div>
                    <DimensionRule label="280 track · 4 tall · width eased over the reported count" />
                </div>
            </Specimen>

            <Specimen
                detail="Running with nothing measured yet · a sweep, because a bar at zero reads as stuck"
                label="Unmeasured progress"
                number="08"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <SetupPage
                            action={{
                                busy: true,
                                label: "Downloading…",
                                onSelect: noop,
                                progress: { kind: "waiting" },
                            }}
                            copy="Checking what arrived and unpacking it."
                            scene="owl"
                            title="Download Happy Agent"
                        />
                    </div>
                    <DimensionRule label="Same box · no fraction claimed, no position asserted" />
                </div>
            </Specimen>

            <Specimen
                detail="First-run setup · one shared sky, white content, appearance-paired paintings"
                label="Onboarding sky"
                number="09"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={frame}>
                        <ThemeScope mode="light">
                            <SetupPage
                                action={{ label: "Continue", onSelect: noop }}
                                backdrop={{ appearance: "light", kind: "sky" }}
                                copy="Happy Agent is running and ready for the next step."
                                scene="sparkles"
                                title="Happy Agent is ready"
                                transitionKey="ready"
                            />
                        </ThemeScope>
                    </div>
                    <div style={frame}>
                        <ThemeScope mode="dark">
                            <SetupPage
                                action={{ label: "Continue", onSelect: noop }}
                                backdrop={{ appearance: "dark", kind: "sky" }}
                                copy="Happy Agent is running and ready for the next step."
                                scene="sparkles"
                                title="Happy Agent is ready"
                                transitionKey="ready"
                            />
                        </ThemeScope>
                    </div>
                    <DimensionRule label="Same crop and contrast treatment as Welcome · 320ms stage dissolve" />
                </div>
            </Specimen>

            <Specimen
                detail="second onboarding screen · automatic verified download · no action required and no machine progress on the welcome deck"
                label="Preparing the first agent"
                number="10"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                kind: "agent-setup",
                                phase: {
                                    download: {
                                        receivedBytes: 12.4 * 1024 * 1024,
                                        totalBytes: 38.2 * 1024 * 1024,
                                    },
                                    kind: "downloading",
                                },
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="subscription search begins with all three vendor columns already mounted and a reserved empty action slot"
                label="Subscription discovery"
                number="11"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{ kind: "examining" }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="same retained vendor columns · daemon checks update their labels in place without moving the owl, title, copy, or action slot"
                label="Authentication checking"
                number="12"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                assistants: [
                                    {
                                        authentication: "checking",
                                        command: "/opt/homebrew/bin/claude",
                                        id: "claude",
                                        status: "found",
                                    },
                                    {
                                        authentication: "checking",
                                        command: "/opt/homebrew/bin/codex",
                                        id: "codex",
                                        status: "found",
                                    },
                                    {
                                        authentication: "unavailable",
                                        id: "grok",
                                        status: "missing",
                                    },
                                ],
                                complete: false,
                                kind: "provider-authentication",
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="authentication-level daemon results only · no quota inference · Continue appears after every check settles"
                label="Authentication verified"
                number="13"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                assistants: [
                                    {
                                        authentication: "valid",
                                        command: "/opt/homebrew/bin/claude",
                                        id: "claude",
                                        status: "found",
                                    },
                                    {
                                        authentication: "invalid",
                                        command: "/opt/homebrew/bin/codex",
                                        id: "codex",
                                        status: "found",
                                    },
                                    {
                                        authentication: "unavailable",
                                        id: "grok",
                                        status: "missing",
                                    },
                                ],
                                complete: true,
                                kind: "provider-authentication",
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="no valid local sign-in · Continue stays absent · Skip becomes the sole primary action"
                label="Authentication unavailable"
                number="14"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                assistants: [
                                    {
                                        authentication: "invalid",
                                        command: "/opt/homebrew/bin/claude",
                                        id: "claude",
                                        status: "found",
                                    },
                                    {
                                        authentication: "invalid",
                                        command: "/opt/homebrew/bin/codex",
                                        id: "codex",
                                        status: "found",
                                    },
                                    {
                                        authentication: "invalid",
                                        command: "/opt/homebrew/bin/grok",
                                        id: "grok",
                                        status: "found",
                                    },
                                ],
                                complete: true,
                                kind: "provider-authentication",
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="optional final onboarding decision · one clear connection action and a permanent Skip"
                label="Happy Mobile offer"
                number="15"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{ busy: false, kind: "happy-mobile-offer" }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="daemon-supplied opaque data only · crisp QR · realtime approval wait · no manual refresh"
                label="Happy Mobile pairing"
                number="16"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                data: "happy://terminal?eyJ2IjoxLCJwYWlyaW5nSWQiOiJibHVlcHJpbnQtcGFpcmluZyIsIm5vbmNlIjoiaGFwcHktbW9iaWxlIn0",
                                expiresAt: 1_900_000_000_000,
                                kind: "happy-mobile-pairing",
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>

            <Specimen
                detail="pairing failure remains optional · retry is local to this step · Skip is still available"
                label="Happy Mobile failure"
                number="17"
                stage="surface"
            >
                <div style={frame}>
                    <ThemeScope mode="dark">
                        <LocalOnboardingScreen
                            appearance="dark"
                            onAssistantsContinue={noop}
                            onConnectRetry={noop}
                            onHappyMobileConnect={noop}
                            onHappyMobileSkip={noop}
                            onProfileCreate={noop}
                            onProfileEmailChange={noop}
                            onProfileNameChange={noop}
                            onProjectChoose={noop}
                            view={{
                                busy: false,
                                kind: "happy-mobile-failed",
                                message:
                                    "The pairing code expired before Happy Mobile approved it.",
                            }}
                        />
                    </ThemeScope>
                </div>
            </Specimen>
        </ComponentPage>
    );
}
