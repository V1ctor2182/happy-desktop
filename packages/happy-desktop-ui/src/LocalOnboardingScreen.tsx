import { SetupPage } from "./SetupPage";
import { TextField } from "./TextField";

export type LocalOnboardingView =
    | { readonly kind: "checking"; readonly message?: string }
    | { readonly kind: "node-missing" }
    | { readonly kind: "rig-missing"; readonly message?: string }
    | { readonly kind: "connecting" }
    | { readonly kind: "connect-failed"; readonly message: string; readonly retrying: boolean }
    | { readonly kind: "rig-update-required"; readonly message: string }
    | {
          readonly downloaded: boolean;
          readonly kind: "happy-update-required";
          readonly message: string;
      }
    | {
          readonly kind: "providers-missing";
          /** The assistants Rig looked for, in the order it named them. */
          readonly providers: readonly string[];
          readonly retrying: boolean;
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
    onConnectRetry(): void;
    onProjectChoose(): void;
    onProfileNameChange(value: string): void;
    onProfileEmailChange(value: string): void;
    onProfileCreate(): void;
    onHappyUpdateInstall(): void;
}

/** What a reader is told to run when Happy cannot start their Rig itself. */
const DAEMON_START_COMMAND = "rig daemon start";

/** Turns Rig's provider ids into something that reads like a sentence. */
function providersPhrase(providers: readonly string[]): string {
    const names = providers.map((provider) => PROVIDER_NAMES[provider] ?? provider);
    if (names.length === 0) return "a coding assistant";
    if (names.length === 1) return names[0] as string;
    return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1] as string}`;
}

/** What each provider Rig knows is actually called on someone's machine. */
const PROVIDER_NAMES: Record<string, string> = {
    bedrock: "Amazon Bedrock",
    claude: "Claude Code",
    codex: "Codex",
    grok: "Grok",
};

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
                copy="Starting your Rig and waiting for it to answer."
                data-testid="local-onboarding-screen"
                scene="snail"
                title="Connecting to Rig…"
            />
        );

    if (view.kind === "examining")
        return (
            <SetupPage
                copy="Reading which projects your Rig already holds."
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Looking around…"
            />
        );

    if (view.kind === "node-missing")
        return (
            <SetupPage
                copy="Rig runs on Node, and Happy will not put a runtime on your machine by itself. Install Node and setup continues on its own."
                data-testid="local-onboarding-screen"
                scene="wand"
                title="Node.js is required."
            />
        );

    if (view.kind === "rig-missing")
        return (
            <SetupPage
                copy={
                    view.message ??
                    "Install Rig globally outside Happy. Happy will detect it and start its daemon automatically."
                }
                data-testid="local-onboarding-screen"
                scene="robot"
                title="Rig is required."
            />
        );

    if (view.kind === "providers-missing")
        return (
            <SetupPage
                // Nothing is broken here, so nothing on this screen says so. Rig
                // runs the coding assistants already signed in on this machine —
                // it has none yet, which is the last ordinary step of setting one
                // up, and it clears itself the moment one is signed in.
                copy={`Rig runs the coding assistants you have already signed in to, and none are signed in yet. Sign in to ${providersPhrase(view.providers)} in a terminal, and Happy picks it up from there.`}
                data-testid="local-onboarding-screen"
                scene="owl"
                title="No coding assistant yet."
            />
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
                    "Rig uses this identity for your work and for messages shared with other Rigs."
                }
                data-testid="local-onboarding-screen"
                scene="sparkles"
                title="Create your profile."
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
                title="Happy could not reach Rig."
            />
        );

    if (view.kind === "rig-update-required")
        return (
            <SetupPage
                copy={view.message}
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Rig needs an update."
            />
        );

    if (view.kind === "happy-update-required")
        return (
            <SetupPage
                {...(view.downloaded
                    ? {
                          action: {
                              label: "Install update and restart",
                              onSelect: props.onHappyUpdateInstall,
                          },
                      }
                    : {})}
                copy={view.message}
                data-testid="local-onboarding-screen"
                scene="owl"
                title="Happy needs an update."
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
            title="Open your first project."
        />
    );
}
