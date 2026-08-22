import { SetupChoice } from "../../src/SetupChoice";
import { SetupPage } from "../../src/SetupPage";
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
        </ComponentPage>
    );
}
