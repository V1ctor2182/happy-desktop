import { type AssistantMarkName } from "./AssistantMark";
import { Button } from "./Button";
import { SetupAssistants, type SetupAssistantEntry } from "./SetupAssistants";
import { SetupPage, SetupProgress, type SetupPageProgress } from "./SetupPage";
import { TextField } from "./TextField";
import type { ThemeMode } from "./ThemeScope";

/** The coding assistants Happy looks for, and nothing beyond them. */
export type LocalOnboardingAssistantId = "claude" | "codex" | "grok";

/**
 * One of them as the machine answered for it: the command is here, or it is
 * not. Whether a command that is here can actually run is the connected Happy Agent's
 * answer rather than the shell's, and the screen showing this carries it.
 */
export interface LocalOnboardingAssistant {
    readonly id: LocalOnboardingAssistantId;
    /** What the daemon proved about the currently configured local credential. */
    readonly authentication: "checking" | "valid" | "invalid" | "error" | "unavailable";
    readonly status: "found" | "missing";
    /** Where the machine keeps it, when it has it. */
    readonly command?: string;
}

/**
 * The Happy Agent archive arriving, while it is arriving. Counted by the
 * process fetching it; absent before the first byte and after the last.
 */
export interface LocalOnboardingDownload {
    readonly receivedBytes: number;
    readonly totalBytes: number;
}

export type LocalOnboardingAgentSetupPhase =
    | { readonly kind: "preparing" }
    | { readonly download?: LocalOnboardingDownload; readonly kind: "downloading" }
    | { readonly kind: "retrying"; readonly message: string }
    | { readonly kind: "ready"; readonly version: string }
    | { readonly kind: "starting" };

export type LocalOnboardingView =
    | { readonly kind: "checking"; readonly message?: string }
    | { readonly kind: "node-missing" }
    | {
          readonly kind: "agent-setup";
          readonly message?: string;
          readonly phase: LocalOnboardingAgentSetupPhase;
      }
    | { readonly kind: "connecting" }
    | { readonly kind: "connect-failed"; readonly message: string; readonly retrying: boolean }
    | {
          /** Binary discovery followed by daemon-owned authentication checks. */
          readonly kind: "provider-authentication";
          readonly assistants: readonly LocalOnboardingAssistant[];
          readonly complete: boolean;
      }
    | { readonly kind: "examining" }
    | {
          readonly busy: boolean;
          readonly email: string;
          readonly kind: "profile-required";
          readonly message?: string;
          readonly name: string;
      }
    | { readonly kind: "project"; readonly busy: boolean; readonly message?: string };

export interface LocalOnboardingScreenProps {
    readonly appearance: ThemeMode;
    readonly view: LocalOnboardingView;
    onAssistantsContinue(): void;
    onConnectRetry(): void;
    onProjectChoose(): void;
    onProfileNameChange(value: string): void;
    onProfileEmailChange(value: string): void;
    onProfileCreate(): void;
}

/** What a reader is told to run when Happy cannot start their Happy Agent itself. */
const DAEMON_START_COMMAND = "happy-agent start";

/**
 * The download as the button reports it: the counted share and both sizes while
 * an archive is on the way, and an unmeasured wait otherwise.
 *
 * The two ends of a download are genuinely unmeasured rather than zero and one
 * hundred — the release is being looked up, then what arrived is being checked
 * and unpacked — so neither is dressed up as a fraction.
 */
function downloadProgress(download: LocalOnboardingDownload | undefined): SetupPageProgress {
    if (!download || download.totalBytes <= 0) return { kind: "waiting" };
    return {
        detail: `${byteSize(download.receivedBytes)} of ${byteSize(download.totalBytes)}`,
        fraction: download.receivedBytes / download.totalBytes,
        kind: "measured",
    };
}

function agentSetupProgress(phase: LocalOnboardingAgentSetupPhase): SetupPageProgress {
    if (phase.kind === "ready") return { detail: phase.version, fraction: 1, kind: "measured" };
    return phase.kind === "downloading" ? downloadProgress(phase.download) : { kind: "waiting" };
}

function agentSetupProgressLabel(phase: LocalOnboardingAgentSetupPhase): string {
    switch (phase.kind) {
        case "preparing":
            return "Preparing download…";
        case "downloading":
            return "Downloading Happy Agent…";
        case "retrying":
            return "Retrying automatically…";
        case "ready":
            return "Starting Happy Agent…";
        case "starting":
            return "Waiting for Happy Agent…";
    }
}

function agentSetupCopy(
    phase: LocalOnboardingAgentSetupPhase,
    message: string | undefined,
): string {
    switch (phase.kind) {
        case "retrying":
            return `${phase.message} Happy will retry the download automatically.`;
        case "ready":
            return message ?? "Happy Agent is downloaded and starting automatically.";
        case "starting":
            return message ?? "Happy Agent is starting automatically.";
        case "preparing":
        case "downloading":
            return "Happy is downloading and verifying Happy Agent for this machine.";
    }
}

/** A size as someone would say it, at the one decimal a release is worth. */
function byteSize(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Each assistant as its column says it: whose mark it carries, the product's
 * name, and the command that name is on this machine.
 *
 * The id is the command, which is why nothing here is looked up twice — but all
 * three are written out separately anyway. What a person is told to install and
 * what they are told to type are not always the same word, and the mark belongs
 * to the company rather than to the command: Codex is OpenAI's, so that is what
 * its mark is called here. Putting the wrong name on somebody else's trademark
 * is not a shortcut worth taking.
 */
const ASSISTANTS: Record<
    LocalOnboardingAssistantId,
    { command: string; mark: AssistantMarkName; name: string }
> = {
    claude: { command: "claude", mark: "claude", name: "Claude Code" },
    codex: { command: "codex", mark: "openai", name: "Codex" },
    grok: { command: "grok", mark: "grok", name: "Grok" },
};

/**
 * One card on the report that follows an install: what is on the machine, and
 * where.
 *
 * A found assistant shows the path the shell gave, because the one question
 * somebody has about a machine that "has" a command is which one it found —
 * two versions on a PATH is the ordinary case, not the exotic one.
 */
function assistantAuthenticationEntry(assistant: LocalOnboardingAssistant): SetupAssistantEntry {
    const { mark, name } = ASSISTANTS[assistant.id];
    const detail = (() => {
        switch (assistant.authentication) {
            case "checking":
                return "Checking credentials…";
            case "valid":
                return "Credentials valid";
            case "invalid":
                return "Credentials invalid";
            case "error":
                return "Could not verify";
            case "unavailable":
                return "Not installed";
        }
    })();
    return {
        detail,
        id: assistant.id,
        mark,
        name,
        status:
            assistant.authentication === "valid"
                ? "found"
                : assistant.authentication === "checking"
                  ? "signed-out"
                  : "missing",
    };
}

/**
 * The same column on the screen Happy Agent's refusal raises, where a found
 * command means something more specific: it is here, and nobody has signed in
 * to it. So the line stops being a location and becomes the one instruction on
 * the screen.
 */
const UNDETECTED_ASSISTANTS: readonly SetupAssistantEntry[] = Object.entries(ASSISTANTS).map(
    ([id, assistant]) => ({
        detail: "Checking credentials…",
        id,
        mark: assistant.mark,
        name: assistant.name,
        status: "signed-out",
    }),
);

interface MachineSetupProjection {
    readonly assistants?: readonly SetupAssistantEntry[];
    readonly copy: string;
    readonly hasValidAuthentication: boolean;
    readonly label: string;
    readonly progress: SetupPageProgress;
    readonly ready: boolean;
    readonly title: string;
}

function machineSetupProject(view: LocalOnboardingView): MachineSetupProjection | undefined {
    if (view.kind === "agent-setup")
        return {
            copy: agentSetupCopy(view.phase, view.message),
            hasValidAuthentication: false,
            label: agentSetupProgressLabel(view.phase),
            progress: agentSetupProgress(view.phase),
            ready: false,
            title: "Launching Happy Agent",
        };
    if (view.kind === "connecting")
        return {
            copy: "Happy Agent is starting and connecting to Happy.",
            hasValidAuthentication: false,
            label: "Waiting for Happy Agent…",
            progress: { kind: "waiting" },
            ready: false,
            title: "Launching Happy Agent",
        };
    if (view.kind === "examining")
        return {
            copy: "Happy is looking for existing Claude, Codex, and Grok subscriptions on this machine.",
            hasValidAuthentication: false,
            label: "Preparing authentication checks…",
            progress: { kind: "waiting" },
            ready: false,
            title: "Searching for existing subscriptions",
        };
    if (view.kind === "provider-authentication")
        return {
            assistants: view.assistants.map(assistantAuthenticationEntry),
            copy: view.complete
                ? view.assistants.some((assistant) => assistant.authentication === "valid")
                    ? "Happy will use these subscriptions for its work."
                    : "Happy couldn't find a valid subscription on this machine. Install and sign in to Claude, Codex, or Grok later; Happy will detect it automatically, or you can rescan from Settings."
                : "Happy is checking the existing authentication for your Claude, Codex, and Grok subscriptions.",
            hasValidAuthentication: view.assistants.some(
                (assistant) => assistant.authentication === "valid",
            ),
            label: "Checking subscription authentication…",
            progress: { fraction: 1, kind: "measured" },
            ready: view.complete,
            title: view.complete
                ? view.assistants.some((assistant) => assistant.authentication === "valid")
                    ? "Found valid subscriptions"
                    : "Unable to find valid subscriptions"
                : "Searching for existing subscriptions",
        };
    return undefined;
}

function MachineSetupStatus(props: {
    readonly projection: MachineSetupProjection;
    onContinue(): void;
    onSkip(): void;
}) {
    const showAssistants = props.projection.assistants !== undefined;
    return (
        <div
            className="happy-local-onboarding__machine-status"
            data-happy-desktop-ui="local-onboarding-machine-status"
            data-view={showAssistants ? "assistants" : "progress"}
        >
            <div
                aria-hidden={showAssistants}
                className="happy-local-onboarding__machine-progress"
                data-happy-desktop-ui="local-onboarding-machine-progress"
            >
                <SetupProgress
                    label={props.projection.label}
                    progress={props.projection.progress}
                />
            </div>
            <div
                aria-hidden={!showAssistants}
                className="happy-local-onboarding__machine-assistants"
                data-happy-desktop-ui="local-onboarding-machine-assistants"
            >
                <SetupAssistants
                    assistants={props.projection.assistants ?? UNDETECTED_ASSISTANTS}
                    data-testid={showAssistants ? "local-onboarding-assistants" : undefined}
                />
                {props.projection.ready ? (
                    <div className="happy-local-onboarding__machine-actions">
                        {props.projection.hasValidAuthentication ? (
                            <Button onClick={props.onContinue} size="large" width={240}>
                                Continue
                            </Button>
                        ) : (
                            <Button onClick={props.onSkip} size="large" width={240}>
                                Skip
                            </Button>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/**
 * First-run setup for this machine, as one machine-setup surface followed by
 * the profile and project decisions it discovers are still owed.
 *
 * Every state is one `SetupPage`: a picture of what is happening, a sentence
 * naming it, a line explaining it, and at most one thing to do. Download,
 * launch, subscription discovery, and automatic verification retain one transition
 * identity so their live progress changes in place instead of becoming a tour
 * of setup pages.
 *
 * Which stage is showing is entirely the caller's, derived from what is true of
 * the machine rather than from a position someone remembered, so an interrupted
 * install or a restart resumes at the truthful stage. This component only draws
 * it.
 */
export function LocalOnboardingScreen(props: LocalOnboardingScreenProps) {
    const { view } = props;
    // Download, start, discovery, and verification are one machine-setup
    // surface. Only a profile or project decision begins another page.
    const transitionKey =
        view.kind === "profile-required" || view.kind === "project"
            ? view.kind
            : "local-agent-setup";
    const frame = {
        backdrop: { appearance: props.appearance, kind: "sky" },
        transitionKey,
    } as const;
    const machineSetup = machineSetupProject(view);

    if (machineSetup)
        return (
            <SetupPage
                {...frame}
                className="happy-local-onboarding__machine-setup"
                copy={machineSetup.copy}
                data-testid="local-onboarding-screen"
                scene="owl"
                title={machineSetup.title}
            >
                <MachineSetupStatus
                    onContinue={props.onAssistantsContinue}
                    onSkip={props.onAssistantsContinue}
                    projection={machineSetup}
                />
            </SetupPage>
        );

    if (view.kind === "checking")
        return (
            <SetupPage
                {...frame}
                copy={view.message ?? "Reading what this machine already has."}
                data-testid="local-onboarding-screen"
                scene="snail"
                title="Checking this machine…"
            />
        );

    if (view.kind === "node-missing")
        return (
            <SetupPage
                {...frame}
                copy="Happy Agent runs on Node, and Happy will not put a runtime on your machine by itself. Install Node and setup continues on its own."
                data-testid="local-onboarding-screen"
                scene="wand"
                title="Node.js is required"
            />
        );

    if (view.kind === "profile-required")
        return (
            <SetupPage
                {...frame}
                action={{
                    busy: view.busy,
                    disabled: !view.name.trim() || !view.email.trim(),
                    label: "Create profile",
                    onSelect: props.onProfileCreate,
                    width: 240,
                }}
                copy={
                    view.message ??
                    "Happy Agent uses this identity for your work and for messages shared with other Happy Agents."
                }
                data-testid="local-onboarding-screen"
                scene="disguised-face"
                title="Create your profile"
            >
                <div className="happy-local-onboarding__profile-form">
                    <TextField
                        autoFocus
                        fullWidth
                        label="Name"
                        onSubmit={props.onProfileCreate}
                        onValueChange={props.onProfileNameChange}
                        placeholder="Your name"
                        required
                        value={view.name}
                    />
                    <TextField
                        fullWidth
                        label="Git email"
                        onSubmit={props.onProfileCreate}
                        onValueChange={props.onProfileEmailChange}
                        placeholder="you@example.com"
                        required
                        type="email"
                        value={view.email}
                    />
                </div>
            </SetupPage>
        );

    if (view.kind === "connect-failed")
        return (
            <SetupPage
                {...frame}
                action={{
                    busy: view.retrying,
                    label: "Try again",
                    onSelect: props.onConnectRetry,
                }}
                command={DAEMON_START_COMMAND}
                // Whatever actually refused, verbatim. This screen used to say
                // nothing at all above a bare retry, which left a daemon failing
                // for a nameable reason looking like a button that did nothing.
                copy={view.message}
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Happy could not reach Happy Agent"
            />
        );

    if (view.kind === "project")
        return (
            <SetupPage
                {...frame}
                action={{
                    disabled: view.busy,
                    label: view.busy ? "Opening…" : "Choose a folder…",
                    onSelect: props.onProjectChoose,
                    width: 240,
                }}
                copy={
                    view.message ??
                    "Point Happy at a folder you work in. It becomes your first project, and you can add more later."
                }
                data-testid="local-onboarding-screen"
                scene="wand"
                title="Open your first project"
            />
        );

    return null;
}
