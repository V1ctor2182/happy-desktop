import type { TerminalGridSnapshot } from "happy2-state";
import { LocalOnboardingScreen, type LocalOnboardingView } from "../../src/LocalOnboardingScreen";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/** A deterministic, non-animated terminal frame so the install screens screenshot. */
function grid(lines: readonly string[]): TerminalGridSnapshot {
    return {
        cols: 80,
        cursor: { x: 0, y: lines.length, visible: false },
        lines: [...lines, ""].map((text) => ({
            cells: [...text].map((glyph, x) => ({
                x,
                text: glyph,
                width: 1 as const,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
                inverse: false,
                strikethrough: false,
                foreground: null,
                background: null,
            })),
        })),
        rows: 16,
        scrollback: [],
        title: "npm install --global @slopus/rig",
    };
}

const running = grid([
    "$ npm install --global @slopus/rig",
    "npm warn cleanup Failed to remove some directories",
    "added 214 packages in 11s",
]);

const failed = grid([
    "$ npm install --global @slopus/rig",
    "npm error code EACCES",
    "npm error syscall mkdir",
    "npm error path /usr/local/lib/node_modules/@slopus",
]);

function screen(view: LocalOnboardingView) {
    return (
        <LocalOnboardingScreen
            onCloudSubmit={() => undefined}
            onConnectRetry={() => undefined}
            onProfileSubmit={() => undefined}
            onProjectChoose={() => undefined}
            onRigInstall={() => undefined}
            onTerminalInput={() => undefined}
            onTerminalResize={() => undefined}
            view={view}
        />
    );
}

export function LocalOnboardingScreenPage() {
    return (
        <ComponentPage
            number="C-239"
            summary="First-run setup for local mode: detect Node, then Rig, install Rig in a real terminal, then the Happy Cloud questions and the first Git project. Props only; every stage is a separate closed view."
            title="Local onboarding screen"
        >
            <FullScreenSpecimen
                detail="Loading state while the login-shell probe answers"
                label="Checking this machine"
                number="01"
            >
                {screen({ kind: "checking" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy cannot install Node; the person is asked to, and detection continues on its own"
                label="Node.js missing"
                number="02"
            >
                {screen({ kind: "node-missing" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Explicit confirmation before anything is installed; the exact command is shown"
                label="Rig missing"
                number="03"
            >
                {screen({ kind: "rig-missing", nodeVersion: "v22.11.0" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The real install, centred, with live output and keyboard input"
                label="Installing Rig"
                number="04"
            >
                {screen({ kind: "rig-installing", terminal: { grid: running, running: true } })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Output is preserved after a failure and the manual path is spelled out"
                label="Install failed"
                number="05"
            >
                {screen({
                    kind: "rig-install-failed",
                    message:
                        "npm exited with status 243. Install Rig yourself with `npm install --global @slopus/rig` in a terminal, then Happy will pick it up.",
                    terminal: { grid: failed, running: false },
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Waiting on the normal user daemon"
                label="Connecting"
                number="06"
            >
                {screen({ kind: "connecting" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The daemon's own reason, with a retry that is an action rather than a refresh"
                label="Connection failed"
                number="07"
            >
                {screen({
                    kind: "connect-failed",
                    message: "Timed out while waiting for the normal Rig daemon.",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Joining, remote control, and encrypted mobile sessions are three independent answers"
                label="Happy Cloud"
                number="08"
            >
                {screen({ kind: "cloud" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Optional, encrypted, and declinable without leaving the cloud"
                label="Happy Profile"
                number="09"
            >
                {screen({ kind: "profile" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Native folder picker; a folder that is not a Git repository is refused"
                label="First project"
                number="10"
            >
                {screen({ kind: "project", busy: false })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A refused folder keeps the step and says exactly what is wrong"
                label="First project · rejected"
                number="11"
            >
                {screen({
                    busy: false,
                    kind: "project",
                    message:
                        "That folder is not a Git repository. Choose a folder with a Git repository in it, or run `git init` there first.",
                })}
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
