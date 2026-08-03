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
                detail="Joining, remote control, and encrypted mobile sessions are three independent answers, and answering saves a choice rather than enrolling anything"
                label="Happy Cloud"
                number="08"
            >
                {screen({ busy: false, kind: "cloud" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Joining without letting another device drive this machine"
                label="Happy Cloud · remote control off"
                number="09"
            >
                {screen({
                    busy: false,
                    draft: { mobileSessions: true, remoteControl: false },
                    kind: "cloud",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Joining while refusing to keep encrypted sessions in the cloud for phones"
                label="Happy Cloud · mobile storage off"
                number="10"
            >
                {screen({
                    busy: false,
                    draft: { mobileSessions: false, remoteControl: true },
                    kind: "cloud",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Both optional parts declined; joining is still one press away"
                label="Happy Cloud · all off"
                number="11"
            >
                {screen({
                    busy: false,
                    draft: { mobileSessions: false, remoteControl: false },
                    kind: "cloud",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The choice could not be written down, so the step stays and says so"
                label="Happy Cloud · save failed"
                number="12"
            >
                {screen({
                    busy: false,
                    kind: "cloud",
                    message:
                        "Happy could not save your Happy Cloud choices: EACCES: permission denied, open '/Users/ada/Library/Application Support/Happy/desktop/local-onboarding.json'.",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Optional, encrypted, declinable without leaving the cloud, and not created by answering"
                label="Happy Profile"
                number="13"
            >
                {screen({ busy: false, kind: "profile" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Reading whether this Rig has ever been used, before anything is offered"
                label="Examining the Rig"
                number="14"
            >
                {screen({ kind: "examining" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Native folder picker; Rig refuses a folder that is not a Git top level"
                label="First project"
                number="15"
            >
                {screen({ kind: "project", busy: false })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The picker is open or the project is being registered, so the action is held"
                label="First project · busy"
                number="16"
            >
                {screen({ busy: true, kind: "project" })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Rig examined the folder and refused it; the step stays and says what is wrong"
                label="First project · rejected"
                number="17"
            >
                {screen({
                    busy: false,
                    kind: "project",
                    message:
                        "That folder is inside a Git repository rather than at its root. Choose the repository's own folder instead.",
                })}
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The login shell could not be read at all; detection keeps going by itself"
                label="Machine unreadable"
                number="18"
            >
                {screen({
                    kind: "checking",
                    message: "Happy could not examine this machine: spawn /bin/zsh EACCES.",
                })}
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
