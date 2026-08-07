import { SetupChoice } from "../../src/SetupChoice";
import { SetupPage } from "../../src/SetupPage";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

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
            number="C-252"
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
                            command="rig daemon start"
                            copy="connect ENOENT /Users/you/.happy/rig/server.sock"
                            scene="owl"
                            title="Happy could not reach Rig."
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
                                            "Rig is a coding agent you run from a terminal, always in sync with this app.",
                                        id: "rig",
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
                            copy="Rig runs the coding assistants you have already signed in to, and none are signed in yet. Sign in to Codex, Claude Code or Grok in a terminal, and Happy picks it up from there."
                            scene="owl"
                            title="No coding assistant yet."
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
                            title="Open your first project."
                        />
                    </div>
                    <DimensionRule label="Missing fields collapse; the column stays centred" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
