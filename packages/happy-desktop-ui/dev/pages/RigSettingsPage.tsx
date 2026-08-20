import type { RigProviderUsageEntry } from "happy-desktop-state";
import {
    RigDebugLogPanel,
    RigDebugSettings,
    RigGeneralSettings,
    RigInstructionsSettings,
    RigProviderSettings,
    RigProfilerSettings,
    RigProfileSettings,
    RigSettingsShell,
    RigUsageSettings,
    type RigProviderRow,
    type RigSettingsCategory,
} from "../../src";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "P-012";

const categories: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "code", id: "debug", label: "Dev Tools" },
    { icon: "users", id: "profile", label: "Profile" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "globe", id: "providers", label: "Providers" },
    { icon: "zap", id: "usage", label: "Usage" },
];

const usageDescription = "How much of each provider account's plan this machine has spent";

const profileDescription = "Who this machine is when it authors work";

const usageAccounts: readonly RigProviderUsageEntry[] = [
    {
        providerId: "claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            vendor: "claude",
            capturedAt: 1_700_000_000_000,
            planName: "Max 20×",
            exhausted: false,
            fiveHour: { usedPercent: 42, resetsAt: 1_700_007_200_000 },
            weekly: { usedPercent: 81, resetsAt: 1_700_400_000_000 },
            monthly: { usedPercent: 34, resetsAt: 1_702_000_000_000 },
        },
    },
    {
        providerId: "codex",
        checkedAt: 1_700_000_000_000,
        usage: {
            vendor: "codex",
            capturedAt: 1_699_999_400_000,
            planName: "Pro",
            exhausted: true,
            fiveHour: { usedPercent: 100, resetsAt: 1_700_003_000_000 },
            weekly: { usedPercent: 96 },
            credits: { available: true, unlimited: false, remainingCents: 1_450 },
        },
    },
    {
        providerId: "grok",
        checkedAt: 1_700_000_000_000,
        error: "The Grok account could not be read: the assistant is signed out.",
    },
];

/** A configured account the daemon has not reached yet: neither read nor failed. */
const usageUnread: readonly RigProviderUsageEntry[] = [
    {
        providerId: "claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            vendor: "claude",
            capturedAt: 1_700_000_000_000,
            planName: "Pro",
            exhausted: false,
            fiveHour: { usedPercent: 8, resetsAt: 1_700_012_000_000 },
        },
    },
    { providerId: "codex" },
];

const usageReadingTime = (capturedAt: number) =>
    capturedAt >= 1_700_000_000_000 ? "just now" : "10 minutes ago";

const instructions = `# House rules

Ask before touching anything outside the working directory.

- Small commits, present tense, no ceremony.
- \`pnpm typecheck\` before you say a thing is done.
- Never force-push \`main\`.
`;

const modelOptions = [
    { label: "Codex · GPT-5.6 Sol", value: "codex:openai/gpt-5.6-sol" },
    { label: "Codex · GPT-5.6 Terra", value: "codex:openai/gpt-5.6-terra" },
    { label: "Claude · Opus 5 1M", value: "claude:anthropic/opus-5" },
    { label: "Claude · Sonnet 5", value: "claude:anthropic/sonnet-5" },
];

const effortOptions = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
];

const permissionModeOptions = [
    { label: "Auto", value: "auto" },
    { label: "Workspace write", value: "workspace_write" },
    { label: "Read only", value: "read_only" },
    { label: "Full access", value: "full_access" },
];

const providers: readonly RigProviderRow[] = [
    {
        id: "codex",
        models: [
            {
                contextWindow: 400_000,
                efforts: ["Low", "Medium", "High"],
                enabled: true,
                id: "codex:openai/gpt-5.6-sol",
                isDefault: true,
                modelId: "openai/gpt-5.6-sol",
                name: "GPT-5.6 Sol",
            },
            {
                contextWindow: 400_000,
                efforts: ["Medium", "High", "Max"],
                enabled: true,
                id: "codex:openai/gpt-5.6-terra",
                isDefault: false,
                modelId: "openai/gpt-5.6-terra",
                name: "GPT-5.6 Terra",
            },
            {
                efforts: ["Medium", "High"],
                enabled: false,
                id: "codex:openai/gpt-5.6-luna",
                isDefault: false,
                modelId: "openai/gpt-5.6-luna",
                name: "GPT-5.6 Luna",
            },
        ],
        name: "Codex",
        serviceTiers: ["Fast"],
        status: "ready",
    },
    {
        id: "claude",
        models: [
            {
                contextWindow: 1_000_000,
                efforts: ["Low", "Medium", "High", "Ultra"],
                enabled: true,
                id: "claude:anthropic/opus-5",
                isDefault: false,
                modelId: "anthropic/opus-5",
                name: "Opus 5 1M",
            },
            {
                contextWindow: 200_000,
                efforts: ["Low", "Medium", "High"],
                enabled: true,
                id: "claude:anthropic/sonnet-5",
                isDefault: false,
                modelId: "anthropic/sonnet-5",
                name: "Sonnet 5",
            },
        ],
        name: "Claude",
        serviceTiers: [],
        status: "ready",
    },
    {
        id: "bedrock",
        models: [
            {
                contextWindow: 200_000,
                efforts: ["Medium", "High"],
                enabled: true,
                id: "bedrock:anthropic/sonnet-5",
                isDefault: false,
                modelId: "anthropic/sonnet-5",
                name: "Sonnet 5",
            },
        ],
        name: "Bedrock",
        serviceTiers: [],
        status: "not_authenticated",
    },
    {
        id: "vertex",
        models: [],
        name: "Vertex",
        serviceTiers: [],
        status: "not_enabled",
    },
];

const noop = () => undefined;

export function RigSettingsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="The local workspace's settings window: a permanent category column whose heading is the way back out, and one category body beside it. Every state is prop-driven, with no daemon connection or router."
            title="Rig settings"
        >
            <FullScreenSpecimen
                detail="General category: appearance and the defaults a new local session starts with"
                label="Rig settings — general"
                number="01"
            >
                <RigSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <RigGeneralSettings
                        appearance="system"
                        defaultModelKey="codex:openai/gpt-5.6-sol"
                        effort="medium"
                        effortOptions={effortOptions}
                        experimentalFeaturesEnabled
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onExperimentalFeaturesChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onPermissionModeChange={noop}
                        onTitleShimmerChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                        titleShimmerEnabled={false}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Live debugger controls and a bounded raw renderer profile with React attribution"
                label="Rig settings — Dev Tools"
                number="01a"
            >
                <RigSettingsShell
                    activeCategoryId="debug"
                    categories={categories}
                    description="Inspect live runtimes or capture raw renderer performance evidence"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Dev Tools"
                >
                    <RigDebugLogPanel
                        discardedEntries={7}
                        entries={[
                            {
                                detail: JSON.stringify(
                                    {
                                        previous: "reconnecting",
                                        next: "live",
                                    },
                                    null,
                                    2,
                                ),
                                id: 1,
                                level: "info",
                                message: "Connection state changed: reconnecting → live",
                                occurredAt: 1_700_000_000_000,
                                source: "connection",
                            },
                            {
                                detail: JSON.stringify(
                                    {
                                        cursor: "01HF7YAT00SQJZ6QH1Z2WQY7Q2",
                                        type: "message.delta",
                                        payload: {
                                            agentId: "agent_01HF7Y9P3M",
                                            delta: "Inspecting the workspace now.",
                                        },
                                    },
                                    null,
                                    2,
                                ),
                                id: 2,
                                level: "info",
                                message: "SSE event arrived: message.delta",
                                occurredAt: 1_700_000_001_250,
                                source: "sse",
                            },
                            {
                                detail: "TypeError: fetch failed\n    at healthProbe (rigConnection.ts:112:18)",
                                id: 3,
                                level: "warning",
                                message: "Health probe failed (attempt 1)",
                                occurredAt: 1_700_000_003_500,
                                source: "health",
                            },
                        ]}
                    />
                    <RigDebugSettings
                        daemon={{
                            status: "running",
                            url: "ws://127.0.0.1:62701/rig",
                        }}
                        daemonConnected
                        main={{
                            status: "running",
                            url: "ws://127.0.0.1:62702/main",
                        }}
                        onAllStart={noop}
                        onAllStop={noop}
                        onDaemonStart={noop}
                        onDaemonStop={noop}
                        onMainStart={noop}
                        onMainStop={noop}
                        onRendererStart={noop}
                        onRendererStop={noop}
                        renderer={{
                            status: "running",
                            url: "ws://127.0.0.1:62703/cdp/8a84291d",
                        }}
                        supported
                    />
                    <RigProfilerSettings
                        artifactPath="~/Library/Application Support/Happy/desktop/profiler/session-preview.json"
                        capabilities={{
                            liveDebuggerAttach: true,
                            nativeTrace: true,
                            processMetrics: true,
                            reactAttribution: true,
                            reactDevtoolsProfiling: true,
                            rendererMetrics: true,
                        }}
                        onStart={noop}
                        onStop={noop}
                        status="stopped"
                        supported
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Instructions category: the machine's AGENTS.md and SECURITY.md as peer editable files"
                label="Rig settings — instructions"
                number="02"
            >
                <RigSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <RigInstructionsSettings
                        documents={[
                            {
                                bytes: instructions.length,
                                description:
                                    "Given to every agent this machine starts, on top of the project's own AGENTS.md.",
                                id: "agents",
                                label: "AGENTS.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/AGENTS.md",
                                placeholder: "Anything every agent on this machine should know…",
                                value: instructions,
                            },
                            {
                                bytes: 0,
                                description:
                                    "Applied when this machine reviews whether an agent action is allowed.",
                                id: "security",
                                label: "SECURITY.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/SECURITY.md",
                                placeholder: "Rules for deciding which agent actions are allowed…",
                                value: "",
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Profile category: the single identity this machine authors work as, edited where it is shown"
                label="Rig settings — profile"
                number="02a"
            >
                <RigSettingsShell
                    activeCategoryId="profile"
                    categories={categories}
                    description={profileDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Profile"
                >
                    <RigProfileSettings
                        email="steve@korshakov.com"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Edited in place: the fields differ from what is stored, and the last save was refused"
                label="Rig settings — profile edited"
                number="02b"
            >
                <RigSettingsShell
                    activeCategoryId="profile"
                    categories={categories}
                    description={profileDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Profile"
                >
                    <RigProfileSettings
                        dirty
                        email="steve@"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                        saveError="Enter the email used for Git commits."
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Providers category: connected, unauthenticated, disabled, and model-less providers together"
                label="Rig settings — providers"
                number="03"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings onModelEnabledChange={noop} providers={providers} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The catalog has not arrived yet, so both the picker and the provider list say so"
                label="Rig settings — loading"
                number="04"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings loading onModelEnabledChange={noop} providers={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A failed catalog read is a loud alert rather than an empty provider list"
                label="Rig settings — error"
                number="05"
            >
                <RigSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Rig daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <RigProviderSettings
                        error="The Rig daemon could not read its model catalog."
                        onModelEnabledChange={noop}
                        providers={[]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Rig offline: appearance remains local, retained defaults stay visible, and daemon-backed changes wait for reconnect"
                label="Rig settings — offline"
                number="06"
            >
                <RigSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <RigGeneralSettings
                        appearance="system"
                        defaultModelKey="codex:openai/gpt-5.6-sol"
                        effort="medium"
                        effortOptions={effortOptions}
                        experimentalFeaturesEnabled={false}
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onExperimentalFeaturesChange={noop}
                        onPermissionModeChange={noop}
                        onTitleShimmerChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                        titleShimmerEnabled={false}
                        unavailable="Rig is offline. Showing the last synced defaults."
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Rig offline: instruction drafts remain editable and visible; Save waits for reconnect"
                label="Rig settings — instructions offline"
                number="07"
            >
                <RigSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <RigInstructionsSettings
                        documents={[
                            {
                                bytes: instructions.length,
                                description:
                                    "Given to every agent this machine starts, on top of the project's own AGENTS.md.",
                                dirty: true,
                                id: "agents",
                                label: "AGENTS.md",
                                maximumBytes: 32 * 1024,
                                onRevert: noop,
                                onSave: noop,
                                onValueChange: noop,
                                path: "~/Happy/Config/AGENTS.md",
                                placeholder: "Anything every agent on this machine should know…",
                                saveDisabled: true,
                                saveDisabledReason:
                                    "Rig is offline. Draft preserved until reconnect.",
                                value: instructions,
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Usage category: three accounts separated by a rule rather than boxed — one with room across three windows, one spent with credits behind it, one that could not be read"
                label="Rig settings — usage"
                number="08"
            >
                <RigSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <RigUsageSettings
                        currentTime={1_700_000_000_000}
                        providers={usageAccounts}
                        readingTime={usageReadingTime}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Before the first reading arrives, so an empty account list is not claimed early"
                label="Rig settings — usage loading"
                number="08a"
            >
                <RigSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <RigUsageSettings loading providers={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="No assistant is signed in on this machine, so the category sends the reader where accounts are actually made"
                label="Rig settings — usage empty"
                number="08b"
            >
                <RigSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <RigUsageSettings providers={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The reading failed; what was already read stays legible beneath the banner, and an account never read says so rather than reading as unspent"
                label="Rig settings — usage error and unread"
                number="08c"
            >
                <RigSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <RigUsageSettings
                        currentTime={1_700_000_000_000}
                        error={{ name: "UserError", message: "The Rig stopped reporting usage." }}
                        providers={usageUnread}
                        readingTime={usageReadingTime}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
