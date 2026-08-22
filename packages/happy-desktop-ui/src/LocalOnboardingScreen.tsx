import { type AssistantMarkName } from "./AssistantMark";
import { SetupAssistants, type SetupAssistantEntry } from "./SetupAssistants";
import { SetupPage, type SetupPageProgress } from "./SetupPage";
import { TextField } from "./TextField";

/** The coding assistants Happy looks for, and nothing beyond them. */
export type LocalOnboardingAssistantId = "claude" | "codex" | "grok";

/**
 * One of them as the machine answered for it: the command is here, or it is
 * not. Whether a command that is here can actually run is the connected Happy Agent's
 * answer rather than the shell's, and the screen showing this carries it.
 */
export interface LocalOnboardingAssistant {
    readonly id: LocalOnboardingAssistantId;
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

export type LocalOnboardingView =
    | { readonly kind: "checking"; readonly message?: string }
    | { readonly kind: "node-missing" }
    | {
          readonly busy: boolean;
          readonly download?: LocalOnboardingDownload;
          readonly kind: "daemon-download";
          readonly message?: string;
      }
    /** The agent that was just fetched, being started and reached. */
    | { readonly kind: "agent-starting"; readonly message?: string }
    | { readonly kind: "connecting" }
    | { readonly kind: "connect-failed"; readonly message: string; readonly retrying: boolean }
    | {
          readonly kind: "providers-missing";
          /** The three, in the order their cards are read. */
          readonly assistants: readonly LocalOnboardingAssistant[];
          readonly retrying: boolean;
      }
    /** What the machine turned out to have, reported once after an install. */
    | {
          readonly kind: "assistants-found";
          readonly assistants: readonly LocalOnboardingAssistant[];
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
    readonly view: LocalOnboardingView;
    onAssistantsContinue(): void;
    onConnectRetry(): void;
    onDaemonDownload(): void;
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
function assistantFoundEntry(assistant: LocalOnboardingAssistant): SetupAssistantEntry {
    const { mark, name } = ASSISTANTS[assistant.id];
    return {
        detail: assistant.command ?? "Not installed",
        detailKind: assistant.command ? "path" : "sentence",
        id: assistant.id,
        mark,
        name,
        status: assistant.status === "found" ? "found" : "missing",
    };
}

/**
 * The same column on the screen Happy Agent's refusal raises, where a found
 * command means something more specific: it is here, and nobody has signed in
 * to it. So the line stops being a location and becomes the one instruction on
 * the screen.
 */
function assistantSignInEntry(assistant: LocalOnboardingAssistant): SetupAssistantEntry {
    const { command, mark, name } = ASSISTANTS[assistant.id];
    return {
        detail: assistant.status === "missing" ? "Not installed" : `Run ${command} to sign in`,
        id: assistant.id,
        mark,
        name,
        status: assistant.status === "found" ? "signed-out" : "missing",
    };
}

/**
 * First-run setup for this machine, as a sequence of centred pages.
 *
 * Every stage is one `SetupPage`: a picture of what is happening, a sentence
 * naming it, a line explaining it, and at most one thing to do. There is no step
 * rail and no progress chrome, because setup is not a form — it is a short
 * series of facts about this machine, each of which either resolves on its own
 * or asks for exactly one decision.
 *
 * Which stage is showing is entirely the caller's, derived from what is true of
 * the machine rather than from a position someone remembered, so an interrupted
 * install or a restart resumes at the truthful stage. This component only draws
 * it.
 */
export function LocalOnboardingScreen(props: LocalOnboardingScreenProps) {
    const { view } = props;

    if (view.kind === "checking")
        return (
            <SetupPage
                copy={view.message ?? "Reading what this machine already has."}
                data-testid="local-onboarding-screen"
                scene="snail"
                title="Checking this machine…"
            />
        );

    if (view.kind === "connecting")
        return (
            <SetupPage
                copy="Starting your Happy Agent and waiting for it to answer."
                data-testid="local-onboarding-screen"
                scene="snail"
                title="Connecting to Happy Agent…"
            />
        );

    if (view.kind === "examining")
        return (
            <SetupPage
                copy="Reading which projects your Happy Agent already holds."
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Looking around…"
            />
        );

    if (view.kind === "node-missing")
        return (
            <SetupPage
                copy="Happy Agent runs on Node, and Happy will not put a runtime on your machine by itself. Install Node and setup continues on its own."
                data-testid="local-onboarding-screen"
                scene="wand"
                title="Node.js is required"
            />
        );

    if (view.kind === "daemon-download")
        return (
            <SetupPage
                action={{
                    busy: view.busy,
                    label: view.busy ? "Downloading…" : "Download and start",
                    onSelect: props.onDaemonDownload,
                    // Once it is running, this stage always reports itself as a
                    // bar: the bytes when they are moving, and a sweep for the
                    // moments either side of them. Swapping between a spinner
                    // and a bar as the count came and went would flicker twice
                    // during one download.
                    ...(view.busy ? { progress: downloadProgress(view.download) } : {}),
                }}
                copy={
                    view.message ??
                    "Happy downloads the published release for this Mac, verifies its checksum, and keeps each version isolated before starting it."
                }
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Download Happy Agent"
            />
        );

    // Deliberately the download screen again, down to the title and the owl:
    // starting what was just fetched is the end of that same download, and
    // nobody asked for it separately. Only the words under the bar change.
    if (view.kind === "agent-starting")
        return (
            <SetupPage
                action={{
                    busy: true,
                    label: "Starting…",
                    // Unreachable while busy, and there is nothing else this
                    // screen could ask for: the install is already running.
                    onSelect: props.onDaemonDownload,
                    progress: { kind: "waiting" },
                }}
                copy={view.message ?? "Starting Happy Agent and connecting to it."}
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Download Happy Agent"
            />
        );

    if (view.kind === "providers-missing")
        return (
            <SetupPage
                // Nothing is broken here, so nothing on this screen says so. Happy Agent
                // runs the coding assistants already signed in on this machine —
                // it has none yet, which is the last ordinary step of setting one
                // up, and it clears itself the moment one is signed in.
                copy="Happy runs the coding assistants already set up on this machine. Here is what it found; set one up in a terminal and Happy picks it up from there."
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Set up a coding assistant"
            >
                <SetupAssistants
                    assistants={view.assistants.map(assistantSignInEntry)}
                    data-testid="local-onboarding-assistants"
                />
            </SetupPage>
        );

    // The install is done and the agent is answering. This is the one moment the
    // machine's own inventory is worth a screen, so it gets one — and a button
    // rather than a timer, because it is the person's to read for as long as
    // they want.
    if (view.kind === "assistants-found")
        return (
            <SetupPage
                action={{ label: "Continue", onSelect: props.onAssistantsContinue }}
                copy="Happy Agent is running. It found these coding assistants on this machine, and will run whichever of them you are signed in to."
                data-testid="local-onboarding-screen"
                scene="sparkles"
                title="Happy Agent is ready"
            >
                <SetupAssistants
                    assistants={view.assistants.map(assistantFoundEntry)}
                    data-testid="local-onboarding-assistants"
                />
            </SetupPage>
        );

    if (view.kind === "profile-required")
        return (
            <SetupPage
                action={{
                    busy: view.busy,
                    disabled: !view.name.trim() || !view.email.trim(),
                    label: "Create profile",
                    onSelect: props.onProfileCreate,
                }}
                copy={
                    view.message ??
                    "Happy Agent uses this identity for your work and for messages shared with other Happy Agents."
                }
                data-testid="local-onboarding-screen"
                scene="sparkles"
                title="Create your profile"
            >
                <div className="happy2-local-onboarding__profile-form">
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

    return (
        <SetupPage
            action={{
                disabled: view.busy,
                label: view.busy ? "Opening…" : "Choose a folder…",
                onSelect: props.onProjectChoose,
            }}
            copy={
                view.message ??
                "Point Happy at a folder you work in. It becomes the first project on this machine, and you can add more later."
            }
            data-testid="local-onboarding-screen"
            scene="wand"
            title="Open your first project"
        />
    );
}
