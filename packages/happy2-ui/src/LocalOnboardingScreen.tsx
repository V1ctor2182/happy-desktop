import { useState, type ReactNode } from "react";
import type { TerminalGridSnapshot } from "happy2-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { OnboardingScreen, type OnboardingStep } from "./OnboardingScreen";
import { Switch } from "./Switch";
import { TerminalPanel } from "./TerminalPanel";
import { WindowDragRegion } from "./TitleBar";

/** The three Happy Cloud answers, as one decision. */
export interface LocalOnboardingCloudChoice {
    readonly joined: boolean;
    readonly remoteControl: boolean;
    readonly mobileSessions: boolean;
}

/**
 * What the Happy Cloud toggles start at. The step owns them as local UI state
 * once it is on screen, so this is the initial visual value alone — it is what
 * lets every combination be rendered rather than only the default one.
 */
export interface LocalOnboardingCloudDraft {
    readonly remoteControl: boolean;
    readonly mobileSessions: boolean;
}

/** The live install terminal, exactly as the surface may draw it. */
export interface LocalOnboardingTerminal {
    readonly grid?: TerminalGridSnapshot;
    readonly running: boolean;
}

/**
 * Which first-run screen is on, and everything that screen draws. It is a closed
 * union rather than a stage name plus optional fields, so a screen cannot be
 * rendered without the facts it is about.
 */
export type LocalOnboardingView =
    | { readonly kind: "checking"; readonly message?: string }
    | { readonly kind: "node-missing" }
    | {
          readonly kind: "rig-missing";
          readonly nodeVersion: string;
          readonly message?: string;
      }
    | { readonly kind: "rig-installing"; readonly terminal: LocalOnboardingTerminal }
    | {
          readonly kind: "rig-install-failed";
          readonly terminal: LocalOnboardingTerminal;
          readonly message: string;
      }
    | { readonly kind: "connecting" }
    | { readonly kind: "connect-failed"; readonly message: string }
    | {
          readonly kind: "cloud";
          /** What the toggles start at, so every combination can be rendered. */
          readonly draft?: LocalOnboardingCloudDraft;
          readonly busy: boolean;
          readonly message?: string;
      }
    | { readonly kind: "profile"; readonly busy: boolean; readonly message?: string }
    | { readonly kind: "examining" }
    | { readonly kind: "project"; readonly busy: boolean; readonly message?: string };

export interface LocalOnboardingScreenProps {
    readonly view: LocalOnboardingView;
    /** The person's explicit confirmation to install Rig, and to run it again. */
    onRigInstall(): void;
    onTerminalInput(data: string): void;
    onTerminalResize(cols: number, rows: number): void;
    onConnectRetry(): void;
    onCloudSubmit(choice: LocalOnboardingCloudChoice): void;
    onProfileSubmit(create: boolean): void;
    onProjectChoose(): void;
}

/** Where the node download lives, shown as text because Happy cannot install it. */
const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";
const NODE_HOMEBREW_COMMAND = "brew install node";
const RIG_INSTALL_COMMAND = "npm install --global @slopus/rig";

/**
 * C-239 LocalOnboardingScreen — first-run setup for a Happy that runs on this
 * machine.
 *
 * It walks one straight line: prove the machine can run Rig (Node, then the
 * `rig` command, then a daemon), decide about Happy Cloud, then open a first
 * project. Every screen is props only — the component owns no setup state, does
 * not know how anything is detected or installed, and reports each decision
 * through a callback. The one exception is the Happy Cloud step, which holds its
 * three toggles as local UI state until the person submits them as one answer.
 */
export function LocalOnboardingScreen(props: LocalOnboardingScreenProps) {
    const view = props.view;
    return (
        <>
            <WindowDragRegion />
            <OnboardingScreen
                bodyKey={view.kind}
                brand={{ name: "Happy" }}
                copy={screenCopy(view)}
                data-testid="local-onboarding-screen"
                kicker={screenKicker(view)}
                loadingLabel={screenLoadingLabel(view)}
                state={screenState(view)}
                steps={stepsFor(view)}
                title={screenTitle(view)}
                width="large"
            >
                <LocalOnboardingBody {...props} />
            </OnboardingScreen>
        </>
    );
}

function LocalOnboardingBody(props: LocalOnboardingScreenProps) {
    const view = props.view;
    switch (view.kind) {
        case "connecting":
        case "examining":
            return null;
        case "checking":
            // A machine that cannot be examined at all keeps being examined, so
            // there is nothing to press: the reason is stated and the screen
            // continues on its own.
            if (!view.message) return null;
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <Banner icon="shield" title="Happy cannot read this machine" tone="warning">
                        {view.message}
                    </Banner>
                    <p
                        className="happy2-local-onboarding__note"
                        data-happy2-ui="local-onboarding-note"
                    >
                        Happy keeps trying on its own. Nothing has been installed or changed.
                    </p>
                </div>
            );
        case "node-missing":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <Banner icon="shield" title="Node.js is required" tone="warning">
                        Rig runs on Node.js, and Happy cannot install it for you. Install Node.js
                        yourself and Happy will continue on its own — there is nothing to press here
                        afterwards.
                    </Banner>
                    <CommandRow copyLabel="Copy Homebrew command" text={NODE_HOMEBREW_COMMAND} />
                    <p
                        className="happy2-local-onboarding__note"
                        data-happy2-ui="local-onboarding-note"
                    >
                        Or download the LTS installer from {NODE_DOWNLOAD_URL}. If Node.js is
                        already installed but only inside a version manager, open a new terminal,
                        make it your default there, and Happy will find it.
                    </p>
                </div>
            );
        case "rig-missing":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <p
                        className="happy2-local-onboarding__lead"
                        data-happy2-ui="local-onboarding-lead"
                    >
                        Happy works through Rig, the agent runtime that runs on this machine.
                        Node.js {view.nodeVersion} is ready, so Happy can install Rig globally for
                        you. It runs this exact command in a terminal you can watch:
                    </p>
                    <CommandRow copyLabel="Copy install command" text={RIG_INSTALL_COMMAND} />
                    {view.message ? (
                        <Banner icon="shield" title="That install could not start" tone="danger">
                            {view.message}
                        </Banner>
                    ) : null}
                    <div
                        className="happy2-local-onboarding__actions"
                        data-happy2-ui="local-onboarding-actions"
                    >
                        <Button onClick={props.onRigInstall} size="large" type="button">
                            Install Rig
                        </Button>
                    </div>
                    <p
                        className="happy2-local-onboarding__note"
                        data-happy2-ui="local-onboarding-note"
                    >
                        Prefer to do it yourself? Run that command in your own terminal; Happy picks
                        Rig up as soon as it appears.
                    </p>
                </div>
            );
        case "rig-installing":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <InstallTerminal
                        onInput={props.onTerminalInput}
                        onResize={props.onTerminalResize}
                        terminal={view.terminal}
                    />
                </div>
            );
        case "rig-install-failed":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <Banner icon="shield" title="Rig was not installed" tone="danger">
                        {view.message}
                    </Banner>
                    <CommandRow copyLabel="Copy install command" text={RIG_INSTALL_COMMAND} />
                    <InstallTerminal
                        onInput={props.onTerminalInput}
                        onResize={props.onTerminalResize}
                        terminal={view.terminal}
                    />
                    <div
                        className="happy2-local-onboarding__actions"
                        data-happy2-ui="local-onboarding-actions"
                    >
                        <Button onClick={props.onRigInstall} type="button" variant="secondary">
                            Run it again
                        </Button>
                    </div>
                </div>
            );
        case "connect-failed":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <Banner icon="shield" title="Rig did not start" tone="danger">
                        {view.message}
                    </Banner>
                    <div
                        className="happy2-local-onboarding__actions"
                        data-happy2-ui="local-onboarding-actions"
                    >
                        <Button onClick={props.onConnectRetry} type="button">
                            Try again
                        </Button>
                    </div>
                </div>
            );
        case "cloud":
            return (
                <CloudStep
                    busy={view.busy}
                    {...(view.draft ? { draft: view.draft } : {})}
                    {...(view.message ? { message: view.message } : {})}
                    onSubmit={props.onCloudSubmit}
                />
            );
        case "profile":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <p
                        className="happy2-local-onboarding__lead"
                        data-happy2-ui="local-onboarding-lead"
                    >
                        A Happy Profile is how friends recognise you: a name and a picture that
                        travel with your messages. It is entirely optional, and everything in it
                        would be end-to-end encrypted — Happy would store it without being able to
                        read it.
                    </p>
                    <PendingNote>
                        No profile is created by answering this. Happy writes your answer down on
                        this machine and will ask you for a name and a picture when profiles are
                        ready.
                    </PendingNote>
                    {view.message ? (
                        <Banner icon="shield" title="That answer was not saved" tone="danger">
                            {view.message}
                        </Banner>
                    ) : null}
                    <div
                        className="happy2-local-onboarding__actions"
                        data-happy2-ui="local-onboarding-actions"
                    >
                        <Button
                            disabled={view.busy}
                            onClick={() => props.onProfileSubmit(false)}
                            type="button"
                            variant="secondary"
                        >
                            No profile
                        </Button>
                        <Button
                            disabled={view.busy}
                            onClick={() => props.onProfileSubmit(true)}
                            type="button"
                        >
                            {view.busy ? "Saving…" : "Set one up for me"}
                        </Button>
                    </div>
                </div>
            );
        case "project":
            return (
                <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
                    <p
                        className="happy2-local-onboarding__lead"
                        data-happy2-ui="local-onboarding-lead"
                    >
                        A project is a folder on this machine that agents work in. It has to be a
                        Git repository, so their work can be reviewed, undone, and branched into
                        workspaces.
                    </p>
                    {view.message ? (
                        <Banner icon="shield" tone="warning">
                            {view.message}
                        </Banner>
                    ) : null}
                    <div
                        className="happy2-local-onboarding__actions"
                        data-happy2-ui="local-onboarding-actions"
                    >
                        <Button
                            disabled={view.busy}
                            onClick={props.onProjectChoose}
                            size="large"
                            type="button"
                        >
                            {view.busy ? "Opening…" : "Choose a folder…"}
                        </Button>
                    </div>
                </div>
            );
    }
}

/**
 * The install as it actually runs. The command is fixed and this process cannot
 * choose another, so the terminal is presented as one centred window: real
 * output, real input, and it stays on screen after the command exits so a
 * failure can be read rather than guessed at.
 */
function InstallTerminal(props: {
    readonly onInput: (data: string) => void;
    readonly onResize: (cols: number, rows: number) => void;
    readonly terminal: LocalOnboardingTerminal;
}) {
    return (
        <div
            className="happy2-local-onboarding__terminal"
            data-happy2-ui="local-onboarding-terminal"
        >
            <TerminalPanel
                {...(props.terminal.grid ? { grid: props.terminal.grid } : {})}
                height={320}
                onInput={props.onInput}
                onReconnect={() => undefined}
                onResize={props.onResize}
                status={props.terminal.running ? "connected" : "exited"}
            />
        </div>
    );
}

/**
 * The Happy Cloud questions. Joining, being reachable from another device, and
 * keeping encrypted session blobs in the cloud are three separate answers, and
 * the last two only mean anything once the first is yes. The toggles are local
 * UI state until the person submits them, because they are one decision, and
 * they start from `draft` so every combination is a state this screen can be
 * rendered in rather than only the default one.
 *
 * Submitting records a request. Nothing here creates an account, enrols this
 * machine, or stores anything anywhere, and the copy says so.
 */
function CloudStep(props: {
    readonly busy: boolean;
    readonly draft?: LocalOnboardingCloudDraft;
    readonly message?: string;
    readonly onSubmit: (choice: LocalOnboardingCloudChoice) => void;
}) {
    const [remoteControl, remoteControlSet] = useState(props.draft?.remoteControl ?? true);
    const [mobileSessions, mobileSessionsSet] = useState(props.draft?.mobileSessions ?? true);
    return (
        <div className="happy2-local-onboarding" data-happy2-ui="local-onboarding">
            <p className="happy2-local-onboarding__lead" data-happy2-ui="local-onboarding-lead">
                Happy Cloud connects this machine to other people: friends, group chats, and sharing
                a live session so someone can watch or join what an agent is doing. Your projects
                and agents keep running here either way — nothing moves off this machine because you
                joined.
            </p>
            <div
                className="happy2-local-onboarding__choices"
                data-happy2-ui="local-onboarding-choices"
            >
                <Switch
                    checked={remoteControl}
                    description="Once Happy Cloud is available, pick up a conversation from another device you are signed in on and steer this machine's agents from there."
                    label="Let me control this machine remotely"
                    onChange={remoteControlSet}
                />
                <Switch
                    checked={mobileSessions}
                    description="Using Happy on a phone will mean your sessions are stored in the cloud as end-to-end encrypted blobs Happy cannot read. Turn this off to ask for everything else and keep every session only on this machine."
                    label="Store encrypted sessions so phones can read them"
                    onChange={mobileSessionsSet}
                />
            </div>
            <PendingNote>
                Nothing is created or connected by answering this. There is no Happy Cloud account,
                no enrolment, and no session leaves this machine yet; your answers are written down
                here so setup can finish the moment Happy Cloud can accept them.
            </PendingNote>
            {props.message ? (
                <Banner icon="shield" title="Those answers were not saved" tone="danger">
                    {props.message}
                </Banner>
            ) : null}
            <div
                className="happy2-local-onboarding__actions"
                data-happy2-ui="local-onboarding-actions"
            >
                <Button
                    disabled={props.busy}
                    onClick={() =>
                        props.onSubmit({
                            joined: false,
                            mobileSessions: false,
                            remoteControl: false,
                        })
                    }
                    type="button"
                    variant="secondary"
                >
                    Stay local only
                </Button>
                <Button
                    disabled={props.busy}
                    onClick={() => props.onSubmit({ joined: true, mobileSessions, remoteControl })}
                    type="button"
                >
                    {props.busy ? "Saving…" : "Save these choices"}
                </Button>
            </div>
        </div>
    );
}

/**
 * States plainly that an answer is a recorded intention rather than something
 * that has already happened. Every screen that asks about Happy Cloud carries
 * one, because the honest difference between "saved" and "done" is the whole
 * point of these two steps.
 */
function PendingNote(props: { readonly children: ReactNode }) {
    return (
        <p className="happy2-local-onboarding__note" data-happy2-ui="local-onboarding-note">
            {props.children}
        </p>
    );
}

/** One shell command, shown exactly as it will run, with a copy of its own. */
function CommandRow(props: { readonly copyLabel: string; readonly text: string }) {
    return (
        <div className="happy2-local-onboarding__command" data-happy2-ui="local-onboarding-command">
            <span
                className="happy2-local-onboarding__command-mark"
                data-happy2-ui="local-onboarding-command-mark"
            >
                <Icon name="terminal" size={16} />
            </span>
            <code
                className="happy2-local-onboarding__command-text"
                data-happy2-ui="local-onboarding-command-text"
            >
                {props.text}
            </code>
            <CopyButton label={props.copyLabel} text={props.text} />
        </div>
    );
}

/** The three phases of setup, so the person can see where the line ends. */
function stepsFor(view: LocalOnboardingView): readonly OnboardingStep[] {
    const phase =
        view.kind === "cloud" || view.kind === "profile"
            ? 1
            : view.kind === "project" || view.kind === "examining"
              ? 2
              : 0;
    return ["This machine", "Happy Cloud", "First project"].map((label, index) => ({
        label,
        state: index < phase ? "complete" : index === phase ? "current" : "upcoming",
    }));
}

function screenKicker(view: LocalOnboardingView): string {
    switch (view.kind) {
        case "cloud":
        case "profile":
            return "Happy Cloud";
        case "examining":
        case "project":
            return "First project";
        default:
            return "Set up this machine";
    }
}

function screenTitle(view: LocalOnboardingView): string {
    switch (view.kind) {
        case "checking":
            return "Looking at this machine.";
        case "node-missing":
            return "Happy needs Node.js.";
        case "rig-missing":
            return "Happy needs Rig.";
        case "rig-installing":
            return "Installing Rig.";
        case "rig-install-failed":
            return "That install did not finish.";
        case "connecting":
            return "Starting Rig.";
        case "connect-failed":
            return "Rig could not start.";
        case "cloud":
            return "Do you want Happy Cloud?";
        case "profile":
            return "Do you want a Happy Profile?";
        case "examining":
            return "Reading your Rig.";
        case "project":
            return "Open your first project.";
    }
}

function screenCopy(view: LocalOnboardingView): string | undefined {
    switch (view.kind) {
        case "rig-installing":
            return "This is the real install, running in your own login shell. Leave it to finish.";
        case "connect-failed":
            return "Happy keeps looking; nothing is lost while you sort this out.";
        default:
            return undefined;
    }
}

function screenLoadingLabel(view: LocalOnboardingView): string | undefined {
    if (view.kind === "checking") return "Checking for Node.js and Rig…";
    if (view.kind === "connecting") return "Connecting to your Rig daemon…";
    if (view.kind === "examining") return "Checking whether this Rig has been used…";
    return undefined;
}

/** Loading is for the screens with nothing to answer and nothing to report. */
function screenState(view: LocalOnboardingView): "form" | "loading" {
    if (view.kind === "connecting" || view.kind === "examining") return "loading";
    return view.kind === "checking" && !view.message ? "loading" : "form";
}
