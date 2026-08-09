import type { RigProviderUsageEntry } from "happy-desktop-state";
import {
    RigDebugSettings,
    RigGeneralSettings,
    RigInstructionsSettings,
    RigNodeSettings,
    RigPairing,
    RigProviderSettings,
    RigSecretsSettings,
    RigSettingsShell,
    RigUsageSettings,
    type RigNodeRow,
    type RigNodeTransportRow,
    type RigProviderRow,
    type RigSecretEditor,
    type RigSecretRow,
    type RigSettingsCategory,
} from "../../src";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "P-012";

const categories: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "code", id: "debug", label: "Dev Tools" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "link", id: "nodes", label: "Nodes" },
    { icon: "globe", id: "providers", label: "Providers" },
    { icon: "lock", id: "secrets", label: "Secrets" },
    { icon: "zap", id: "usage", label: "Usage" },
];

const usageDescription = "How much of each provider account's plan this machine has spent";

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

const nodes: readonly RigNodeRow[] = [
    // Reached two ways and still one machine: the routes are listed, the row is
    // not doubled, and the whole of its work is opened over one connection.
    {
        id: "workshop",
        name: "workshop",
        peerId: "workshop",
        routes: [
            { address: "iroh:4f2a…c81b", state: "connected", transport: "iroh" },
            { address: "10.0.0.4:4919", state: "connected", transport: "direct" },
        ],
        rttMs: 18,
        state: "connected",
        workOpen: true,
    },
    {
        accessRestricted: true,
        id: "builder",
        name: "builder",
        peerId: "builder",
        routes: [{ address: "iroh:9d10…77ef", state: "connected", transport: "iroh" }],
        rttMs: 142,
        state: "connected",
    },
    // Still dialling, so it has an address and nothing to address: no identity
    // has been proved yet, and nothing of its work can be opened.
    {
        id: "iroh:0b7c…31aa",
        name: "iroh:0b7c…31aa",
        routes: [{ address: "iroh:0b7c…31aa", state: "connecting", transport: "iroh" }],
        state: "connecting",
    },
    {
        id: "attic",
        message: "No route to the node since 14:02.",
        name: "attic",
        peerId: "attic",
        routes: [{ address: "iroh:6e55…b204", state: "unreachable", transport: "iroh" }],
        state: "unreachable",
    },
];

const transports: readonly RigNodeTransportRow[] = [
    { localAddress: "iroh:2c9f…a017", state: "ready", transport: "iroh" },
];

const noPairing = {
    available: true,
    joinValue: "",
    onInvitationCreate: () => {},
    onJoinSubmit: () => {},
    onJoinValueChange: () => {},
    onReset: () => {},
    onVerificationAccept: () => {},
    onVerificationReject: () => {},
} as const;

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

const secretsDescription = "Environment values this machine gives to the commands its agents run";

const secrets: readonly RigSecretRow[] = [
    {
        id: "github",
        description: "Pushes and pull requests from this machine.",
        variables: ["GITHUB_TOKEN"],
    },
    {
        id: "deploy.staging",
        description: "The staging deployer's credentials.",
        variables: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    },
    {
        id: "npm",
        description: "Publishing to the private registry.",
        variables: [],
    },
];

/** The form as it stands for a bundle nobody has named yet. */
const secretEditorCreate: RigSecretEditor = {
    mode: "create",
    secretId: "",
    description: "",
    variables: [{ key: "variable-1", name: "", value: "" }],
    onIdChange: noop,
    onDescriptionChange: noop,
    onVariableNameChange: noop,
    onVariableValueChange: noop,
    onVariableRemove: noop,
    onVariableAdd: noop,
    onSave: noop,
    onCancel: noop,
};

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
                detail="Live loopback debugger controls and raw CDP attachment URLs for the three application runtimes"
                label="Rig settings — Dev Tools"
                number="01a"
            >
                <RigSettingsShell
                    activeCategoryId="debug"
                    categories={categories}
                    description="Start, stop, and copy live debugger endpoints for Happy and Rig"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Dev Tools"
                >
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
                detail="Nodes category: the machines this Rig is peered with, in every link state at once, the one act that adds another, and the transport it reaches them over. A connected link, open work, and a shared API are three separate facts: the first node says all three, the second is up and deliberately not sharing."
                label="Rig settings — nodes"
                number="02a"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        hostName="This Mac"
                        nodes={nodes}
                        pairing={<RigPairing {...noPairing} />}
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The same category with a pairing under way. Comparing the four emojis is the trust decision, and it is taken here rather than by copying a key between machines."
                label="Rig settings — pairing under way"
                number="02e"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        hostName="This Mac"
                        nodes={nodes}
                        pairing={
                            <RigPairing
                                {...noPairing}
                                progress={{
                                    emojis: ["🐙", "🌵", "🔔", "🚲"],
                                    peer: { instanceId: "attic", name: "attic" },
                                    phase: "verifying",
                                    role: "inviter",
                                }}
                            />
                        }
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A Rig too old to pair says so where the control would have been, and its node list is unaffected: an older Rig still reports every machine it is already peered with."
                label="Rig settings — pairing unsupported"
                number="02f"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        nodes={nodes}
                        pairing={<RigPairing {...noPairing} available={false} />}
                        transports={transports}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A Rig peered with nothing says so, and its transport explains whether it could peer at all"
                label="Rig settings — no nodes"
                number="02b"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        hostId="desk"
                        nodes={[]}
                        transports={[
                            {
                                message: "Iroh is disabled in this Rig's configuration.",
                                state: "unavailable",
                                transport: "iroh",
                            },
                        ]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Before the host's first status arrives neither section is blank and neither claims emptiness: each says what it is waiting for, and swaps for the real list when it lands"
                label="Rig settings — nodes loading"
                number="02c"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings loading nodes={[]} transports={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A status feed that dropped is said once, above the last nodes it reported, because what it already told the reader did not stop being true"
                label="Rig settings — nodes feed error"
                number="02d"
            >
                <RigSettingsShell
                    activeCategoryId="nodes"
                    categories={categories}
                    description="Machines this Rig is peered with, and how it reaches them"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Nodes"
                >
                    <RigNodeSettings
                        error="Lost the status feed from this Rig."
                        hostId="desk"
                        nodes={nodes}
                        transports={transports}
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
            <FullScreenSpecimen
                detail="Secrets category: every bundle this machine holds, listed by the variables it binds. A value is never shown, including to whoever registered it, so a bundle with no variables says that rather than looking unread."
                label="Rig settings — secrets"
                number="09"
            >
                <RigSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description={secretsDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <RigSecretsSettings
                        onSecretCreate={noop}
                        onSecretEdit={noop}
                        onSecretRemoveCancel={noop}
                        onSecretRemoveConfirm={noop}
                        onSecretRemoveStart={noop}
                        secrets={secrets}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Adding one: the identifier is chosen here and nowhere else, and each variable is a name beside a value that will not be readable again"
                label="Rig settings — secret being added"
                number="09a"
            >
                <RigSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description={secretsDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <RigSecretsSettings
                        editor={{
                            ...secretEditorCreate,
                            secretId: "openai",
                            description: "Model access for this machine's agents.",
                            variables: [
                                { key: "variable-1", name: "OPENAI_API_KEY", value: "sk-live" },
                                { key: "variable-2", name: "", value: "" },
                            ],
                        }}
                        onSecretCreate={noop}
                        onSecretEdit={noop}
                        onSecretRemoveCancel={noop}
                        onSecretRemoveConfirm={noop}
                        onSecretRemoveStart={noop}
                        secrets={secrets}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Replacing one: the identifier is settled, the variable names come back, and their values do not — a replacement states the whole bundle again. The machine's refusal is shown in its own words."
                label="Rig settings — secret being replaced"
                number="09b"
            >
                <RigSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description={secretsDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <RigSecretsSettings
                        editor={{
                            ...secretEditorCreate,
                            mode: "update",
                            secretId: "deploy.staging",
                            description: "The staging deployer's credentials.",
                            error: "Environment variable 'aws region' in secret 'deploy.staging' is not a valid name.",
                            variables: [
                                { key: "variable-1", name: "AWS_ACCESS_KEY_ID", value: "AKIA" },
                                { key: "variable-2", name: "AWS_SECRET_ACCESS_KEY", value: "" },
                                { key: "variable-3", name: "aws region", value: "eu-west-1" },
                            ],
                        }}
                        onSecretCreate={noop}
                        onSecretEdit={noop}
                        onSecretRemoveCancel={noop}
                        onSecretRemoveConfirm={noop}
                        onSecretRemoveStart={noop}
                        secrets={secrets}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Removing one is confirmed on its own row, because the values go with it and nothing here can put them back"
                label="Rig settings — secret being removed"
                number="09c"
            >
                <RigSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description={secretsDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <RigSecretsSettings
                        onSecretCreate={noop}
                        onSecretEdit={noop}
                        onSecretRemoveCancel={noop}
                        onSecretRemoveConfirm={noop}
                        onSecretRemoveStart={noop}
                        secrets={secrets.map((secret) =>
                            secret.id === "github" ? { ...secret, confirmingRemove: true } : secret,
                        )}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A machine that holds none says so, and an unreachable one says that instead of offering controls that would go nowhere"
                label="Rig settings — no secrets"
                number="09d"
            >
                <RigSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description={secretsDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <RigSecretsSettings
                        onSecretCreate={noop}
                        onSecretEdit={noop}
                        onSecretRemoveCancel={noop}
                        onSecretRemoveConfirm={noop}
                        onSecretRemoveStart={noop}
                        secrets={[]}
                        unavailable="This window is not connected to a Rig on this machine."
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
