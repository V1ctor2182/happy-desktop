import type { HappyAgentProviderUsageEntry } from "happy-desktop-state";
import {
    HappySocialSettings,
    HappyAgentDebugLogPanel,
    HappyAgentDebugSettings,
    HappyAgentDeviceSettings,
    HappyAgentEncryptionSettings,
    HappyAgentGeneralSettings,
    HappyAgentInstructionsSettings,
    HappyAgentMobileSettings,
    HappyAgentProviderSettings,
    HappyAgentProfilerSettings,
    HappyAgentProfileSettings,
    HappyAgentRemoteMacSettings,
    HappyAgentSecretSettings,
    HappyAgentSettingsShell,
    HappyAgentUsageSettings,
    type HappyAgentDevice,
    type HappyAgentProviderRow,
    type HappyAgentSecretRow,
    type HappyAgentSettingsCategory,
} from "../../src";
import { ComponentPage, FullScreenSpecimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "P-012";

const categories: readonly HappyAgentSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "users", id: "account", label: "Account" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "lock", id: "secrets", label: "Secrets" },
    { icon: "globe", id: "providers", label: "Providers" },
    { icon: "zap", id: "usage", label: "Usage" },
    { icon: "mobile", id: "mobile-access", label: "Mobile Access" },
    { icon: "code", id: "debug", label: "Dev Tools" },
];

const usageDescription = "How much of each provider account's plan this machine has spent";

const accountDescription =
    "Who this machine is when it authors work, and the devices signed in with it";

const mobileDescription = "This Happy Agent's connection to Happy Mobile";

const accountDevices: readonly HappyAgentDevice[] = [
    {
        agentVersion: "0.4.22",
        architecture: "arm64",
        current: true,
        id: "device-1",
        lastAccessed: "27 Aug 2026, 02:14",
        name: "Steve's MacBook Pro",
        osVersion: "26.5.0",
        platform: "macOS",
        removing: false,
    },
    {
        agentVersion: "0.4.21",
        architecture: "x64",
        current: false,
        id: "device-2",
        lastAccessed: "26 Aug 2026, 19:03",
        name: "tashkent-build",
        osVersion: "6.8.0",
        platform: "Linux",
        removing: false,
    },
];

const usageAccounts: readonly HappyAgentProviderUsageEntry[] = [
    {
        providerId: "claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            capturedAt: 1_700_000_000_000,
            planName: "Max 20×",
            exhausted: false,
            fiveHour: { usedPercent: 42, resetsAt: 1_700_007_200_000 },
            weekly: { usedPercent: 81, resetsAt: 1_700_400_000_000 },
            monthly: { usedPercent: 34, resetsAt: 1_702_000_000_000 },
            models: [
                {
                    modelId: "anthropic/opus-5",
                    hour: {
                        inputTokens: 18_400,
                        outputTokens: 6_200,
                        cacheReadTokens: 412_000,
                        cacheWriteTokens: 24_000,
                    },
                    day: {
                        inputTokens: 214_000,
                        outputTokens: 71_500,
                        cacheReadTokens: 5_120_000,
                        cacheWriteTokens: 268_000,
                    },
                    week: {
                        inputTokens: 1_420_000,
                        outputTokens: 486_000,
                        cacheReadTokens: 33_800_000,
                        cacheWriteTokens: 1_740_000,
                    },
                    month: {
                        inputTokens: 5_180_000,
                        outputTokens: 1_760_000,
                        cacheReadTokens: 121_400_000,
                        cacheWriteTokens: 6_320_000,
                    },
                },
                {
                    modelId: "anthropic/sonnet-5",
                    day: {
                        inputTokens: 9_800,
                        outputTokens: 3_100,
                        cacheReadTokens: 142_000,
                        cacheWriteTokens: 7_400,
                    },
                    week: {
                        inputTokens: 86_000,
                        outputTokens: 29_400,
                        cacheReadTokens: 1_180_000,
                        cacheWriteTokens: 62_000,
                    },
                    month: {
                        inputTokens: 402_000,
                        outputTokens: 138_000,
                        cacheReadTokens: 5_640_000,
                        cacheWriteTokens: 291_000,
                    },
                },
            ],
        },
    },
    {
        providerId: "work_codex",
        checkedAt: 1_700_000_000_000,
        usage: {
            capturedAt: 1_699_999_400_000,
            planName: "Pro",
            exhausted: true,
            fiveHour: { usedPercent: 100, resetsAt: 1_700_003_000_000 },
            weekly: { usedPercent: 96 },
            credits: { available: true, unlimited: false, remainingCents: 1_450 },
            models: [
                {
                    modelId: "openai/gpt-5.6-sol",
                    month: {
                        inputTokens: 2_940_000,
                        outputTokens: 812_000,
                        cacheReadTokens: 44_100_000,
                        cacheWriteTokens: 0,
                    },
                    week: {
                        inputTokens: 740_000,
                        outputTokens: 203_000,
                        cacheReadTokens: 11_200_000,
                        cacheWriteTokens: 0,
                    },
                },
            ],
        },
    },
    {
        providerId: "grok",
        checkedAt: 1_700_000_000_000,
        error: "The Grok account could not be read: the assistant is signed out.",
    },
];

/**
 * What the daemon actually reports today: absolute token counts by model, with
 * no plan share behind them. Two of these accounts are the same vendor with
 * different credentials, which is why an account is named by its own id — a
 * vendor's name would print "Codex" twice and hide which one is spending.
 */
const usageTokensOnly: readonly HappyAgentProviderUsageEntry[] = [
    {
        providerId: "kirill_claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            capturedAt: 1_700_000_000_000,
            models: [
                {
                    modelId: "anthropic/opus-5",
                    hour: {
                        inputTokens: 12_300,
                        outputTokens: 4_100,
                        cacheReadTokens: 286_000,
                        cacheWriteTokens: 15_800,
                    },
                    day: {
                        inputTokens: 188_000,
                        outputTokens: 62_400,
                        cacheReadTokens: 4_310_000,
                        cacheWriteTokens: 221_000,
                    },
                    week: {
                        inputTokens: 1_090_000,
                        outputTokens: 361_000,
                        cacheReadTokens: 26_700_000,
                        cacheWriteTokens: 1_380_000,
                    },
                    month: {
                        inputTokens: 4_260_000,
                        outputTokens: 1_410_000,
                        cacheReadTokens: 98_200_000,
                        cacheWriteTokens: 5_070_000,
                    },
                },
                {
                    modelId: "anthropic/fable-5",
                    week: {
                        inputTokens: 42_000,
                        outputTokens: 14_300,
                        cacheReadTokens: 611_000,
                        cacheWriteTokens: 31_200,
                    },
                    month: {
                        inputTokens: 151_000,
                        outputTokens: 52_800,
                        cacheReadTokens: 2_240_000,
                        cacheWriteTokens: 114_000,
                    },
                },
            ],
        },
    },
    {
        providerId: "bulka_codex",
        checkedAt: 1_700_000_000_000,
        usage: {
            capturedAt: 1_700_000_000_000,
            models: [
                {
                    modelId: "openai/gpt-5.6-sol",
                    day: {
                        inputTokens: 61_000,
                        outputTokens: 22_800,
                        cacheReadTokens: 1_940_000,
                        cacheWriteTokens: 88_000,
                    },
                    week: {
                        inputTokens: 604_000,
                        outputTokens: 214_000,
                        cacheReadTokens: 18_300_000,
                        cacheWriteTokens: 903_000,
                    },
                    month: {
                        inputTokens: 2_310_000,
                        outputTokens: 806_000,
                        cacheReadTokens: 71_500_000,
                        cacheWriteTokens: 3_420_000,
                    },
                },
            ],
        },
    },
    {
        providerId: "bulka_happy_codex",
        checkedAt: 1_700_000_000_000,
        usage: { capturedAt: 1_700_000_000_000, models: [] },
    },
];

/** A configured account the daemon has not reached yet: neither read nor failed. */
const usageUnread: readonly HappyAgentProviderUsageEntry[] = [
    {
        providerId: "claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            capturedAt: 1_700_000_000_000,
            planName: "Pro",
            exhausted: false,
            fiveHour: { usedPercent: 8, resetsAt: 1_700_012_000_000 },
        },
    },
    { providerId: "work_codex" },
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

const providers: readonly HappyAgentProviderRow[] = [
    {
        enabled: true,
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
        enabled: true,
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
        status: "authentication_failed",
    },
    {
        enabled: true,
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
        saving: true,
        serviceTiers: [],
        status: "checking",
    },
    {
        enabled: false,
        id: "vertex",
        models: [],
        name: "Vertex",
        serviceTiers: [],
        status: "not_enabled",
    },
];

const secrets: readonly HappyAgentSecretRow[] = [
    {
        availableToAgents: true,
        description: "Production deploy credentials",
        environmentVariables: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
        id: "secret-production",
        managed: false,
        updatedAt: "29 Aug 2026, 01:42",
    },
    {
        availableToAgents: false,
        description: "Linear integration",
        environmentVariables: ["LINEAR_API_KEY"],
        id: "secret-linear",
        managed: true,
        updatedAt: "27 Aug 2026, 18:10",
    },
];

const noop = () => undefined;
const promiseNoop = () => Promise.resolve();

/**
 * The Happy Social row is the specimen here, so every fixture keeps the join
 * surface closed and settled. Its own screens are specimens of C-275.
 */
const happySocialJoinFixture = {
    join: { step: "checking" } as const,
    keys: "inactive" as const,
    joinActions: {
        onAccountConnect: noop,
        onAcknowledgementChange: noop,
        onConfirmationChange: noop,
        onConfirmationSubmit: noop,
        onPasswordChange: noop,
        onPasswordSubmit: noop,
        onRestorePasswordChange: noop,
        onRestoreSecretChange: noop,
        onRestoreSubmit: noop,
        onSecretSubmit: noop,
        onUsernameChange: noop,
        onUsernameSubmit: noop,
        onVaultDeleteCancel: noop,
        onVaultDeleteConfirmationChange: noop,
        onVaultDeleteOpen: noop,
        onVaultDeleteSubmit: noop,
    },
    joinable: true,
    joinOpen: false,
    onDisconnect: noop,
    onJoinClose: noop,
    onJoinOpen: noop,
};

export function HappyAgentSettingsBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="The local workspace's settings window: a permanent category column whose heading is the way back out, and one category body beside it. Server-backed state is prop-driven, while transient write-only form values stay inside shared UI."
            title="Happy Agent settings"
        >
            <FullScreenSpecimen
                detail="General category: appearance and the defaults a new local session starts with"
                label="Happy Agent settings — general"
                number="01"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <HappyAgentGeneralSettings
                        // The ordinary resting state of a machine with an update:
                        // the check found it and fetched it without asking, so
                        // the version is already on disk and the only thing left
                        // is the interruption nobody has agreed to yet.
                        agent={{
                            availableVersion: "0.3.1",
                            installedVersion: "0.3.0",
                            managed: true,
                            message: "Happy Agent 0.3.1 is ready to install.",
                            operation: "idle",
                            readyVersion: "0.3.1",
                            runningVersion: "0.3.0",
                            runtime: "ready",
                            updateAvailable: true,
                            versions: [
                                { downloaded: true, prerelease: false, version: "0.3.1" },
                                { downloaded: false, prerelease: true, version: "0.3.1-rc.2" },
                                { downloaded: true, prerelease: false, version: "0.3.0" },
                                { downloaded: true, prerelease: false, version: "0.2.9" },
                            ],
                        }}
                        appearance="system"
                        defaultModelKey="codex:openai/gpt-5.6-sol"
                        effort="medium"
                        effortOptions={effortOptions}
                        experimentalFeaturesEnabled
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onAgentCheck={noop}
                        onAgentRestart={noop}
                        onAgentUpgrade={noop}
                        onAgentVersionSelect={noop}
                        onExperimentalFeaturesChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onPermissionModeChange={noop}
                        onScrollbarVisibilityChange={noop}
                        onTitleShimmerChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                        remoteMac={{
                            snapshot: {
                                mount: {
                                    address: "100.88.40.12",
                                    credentialConfigured: true,
                                    id: "remote-blueprint",
                                    label: "Studio Mac",
                                    port: 43127,
                                    sourceAddress: "100.93.11.4",
                                    status: "connected",
                                },
                                share: {
                                    bindAddress: "100.93.11.4",
                                    enabled: true,
                                    port: 44831,
                                    status: "listening",
                                },
                                tailnetAddresses: [{ address: "100.93.11.4", interface: "utun7" }],
                            },
                            onMountRemove: promiseNoop,
                            onMountWrite: promiseNoop,
                            onRetry: promiseNoop,
                            onShareDisable: promiseNoop,
                            onShareEnable: promiseNoop,
                            onShareRotate: promiseNoop,
                        }}
                        scrollbarVisibility="automatic"
                        titleShimmerEnabled={false}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Remote Mac resting state: sharing is off and no other Mac is mounted"
                label="Happy Agent settings — Remote Mac disabled"
                number="01r"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <HappyAgentRemoteMacSettings
                        snapshot={{
                            share: { enabled: false, status: "disabled" },
                            tailnetAddresses: [{ address: "100.93.11.4", interface: "utun7" }],
                        }}
                        onMountRemove={promiseNoop}
                        onMountWrite={promiseNoop}
                        onRetry={promiseNoop}
                        onShareDisable={promiseNoop}
                        onShareEnable={promiseNoop}
                        onShareRotate={promiseNoop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Remote Mac recovery state: the mount remains in place while both the listener and remote connection wait for Tailscale"
                label="Happy Agent settings — Remote Mac unreachable"
                number="01s"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <HappyAgentRemoteMacSettings
                        snapshot={{
                            mount: {
                                address: "100.88.40.12",
                                credentialConfigured: true,
                                id: "remote-unreachable-blueprint",
                                label: "Studio Mac",
                                message: "No route to the other Mac.",
                                port: 43127,
                                sourceAddress: "100.93.11.4",
                                status: "disconnected",
                            },
                            share: {
                                bindAddress: "100.93.11.4",
                                enabled: true,
                                message: "The Tailscale interface disappeared.",
                                port: 44831,
                                status: "retrying",
                            },
                            tailnetAddresses: [],
                        }}
                        onMountRemove={promiseNoop}
                        onMountWrite={promiseNoop}
                        onRetry={promiseNoop}
                        onShareDisable={promiseNoop}
                        onShareEnable={promiseNoop}
                        onShareRotate={promiseNoop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Remote Mac risky transition: rotation explains the immediate disconnect and one-time clipboard handoff before it proceeds"
                label="Happy Agent settings — rotate Remote Mac token"
                number="01t"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <HappyAgentRemoteMacSettings
                        initialConfirmation="share-rotate"
                        snapshot={{
                            share: {
                                bindAddress: "100.93.11.4",
                                enabled: true,
                                port: 44831,
                                status: "listening",
                            },
                            tailnetAddresses: [{ address: "100.93.11.4", interface: "utun7" }],
                        }}
                        onMountRemove={promiseNoop}
                        onMountWrite={promiseNoop}
                        onRetry={promiseNoop}
                        onShareDisable={promiseNoop}
                        onShareEnable={promiseNoop}
                        onShareRotate={promiseNoop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social account: Happy Agent reports its persisted cloud identity as connected"
                label="Happy Agent settings — Happy Social connected"
                number="01a"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            displayName: "Steve Korshakov",
                            status: "enrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        keys="ready"
                        status="connected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Signed in, but the errand is unfinished: one row, and the only act available is to resume it"
                label="Happy Agent settings — Happy Social keys required"
                number="01ac"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            displayName: "Steve Korshakov",
                            status: "enrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        keys="create_required"
                        status="connected"
                    />
                    <HappyAgentEncryptionSettings
                        encryption={{ status: "create_required" }}
                        onKeysContinue={noop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Unfinished work switched off and no account yet: the category is withheld entirely rather than shown with nothing to press"
                label="Happy Agent settings — Happy Social not offered"
                number="01ad"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappyAgentProfileSettings
                        email="steve@korshakov.com"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                    />
                    <HappySocialSettings
                        enrollment={{ status: "inactive" }}
                        {...happySocialJoinFixture}
                        joinable={false}
                        status="disconnected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="An account already made before the switch went off: it keeps every control it needs, so nobody is stranded mid-errand"
                label="Happy Agent settings — Happy Social kept when not offered"
                number="01ae"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            displayName: "Steve Korshakov",
                            status: "enrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        joinable={false}
                        keys="create_required"
                        status="connected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social enrollment: WorkOS authentication is complete and the public username is the next required choice"
                label="Happy Agent settings — Happy Social enrollment"
                number="01aa"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{ status: "unenrolled", username: "" }}
                        {...happySocialJoinFixture}
                        status="connected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social enrollment: a refused username remains editable with the server answer beside the field"
                label="Happy Agent settings — Happy Social enrollment refused"
                number="01ab"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            error: "That username is already taken.",
                            status: "unenrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        status="connected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social account: Connect stays visibly pending while browser authentication returns to Happy Agent"
                label="Happy Agent settings — Happy Social connecting"
                number="01b"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        authorizationCompleting
                        enrollment={{ status: "inactive" }}
                        {...happySocialJoinFixture}
                        status="authorizing"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social account: an authorization retained across restart can reopen its browser flow"
                label="Happy Agent settings — Happy Social authorization retained"
                number="01c"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        enrollment={{ status: "inactive" }}
                        {...happySocialJoinFixture}
                        status="authorizing"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Social account: a daemon-reported authentication failure remains retryable"
                label="Happy Agent settings — Happy Social verification failed"
                number="01d"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappySocialSettings
                        enrollment={{ status: "inactive" }}
                        error="Happy Agent could not complete Happy Social authentication."
                        {...happySocialJoinFixture}
                        status="disconnected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Mobile Access category: configured and connected, with the installation-wide unlink action"
                label="Happy Agent settings — Mobile Access"
                number="01e"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="mobile-access"
                    categories={categories}
                    description={mobileDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Mobile Access"
                >
                    <HappyAgentMobileSettings
                        configured
                        onDisconnect={noop}
                        onPair={noop}
                        onPairingCancel={noop}
                        status="connected"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Happy Mobile pairing: the unconfigured installation is waiting for a phone to scan its authorization"
                label="Happy Agent settings — Mobile Access pairing"
                number="01f"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="mobile-access"
                    categories={categories}
                    description={mobileDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Mobile Access"
                >
                    <HappyAgentMobileSettings
                        configured={false}
                        onDisconnect={noop}
                        onPair={noop}
                        onPairingCancel={noop}
                        pairingData="happy://pair?authorization=blueprint-happy-mobile"
                        pairingExpiresAt={1_700_003_600_000}
                        status="pairing"
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Live debugger controls and a bounded raw renderer profile with React attribution"
                label="Happy Agent settings — Dev Tools"
                number="01g"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="debug"
                    categories={categories}
                    description="Inspect live runtimes or capture raw renderer performance evidence"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Dev Tools"
                >
                    <HappyAgentDebugLogPanel
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
                                detail: "TypeError: fetch failed\n    at healthProbe (happyAgentConnection.ts:112:18)",
                                id: 3,
                                level: "warning",
                                message: "Health probe failed (attempt 1)",
                                occurredAt: 1_700_000_003_500,
                                source: "health",
                            },
                        ]}
                    />
                    <HappyAgentDebugSettings
                        daemon={{
                            status: "running",
                            url: "ws://127.0.0.1:62701/happy-agent",
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
                    <HappyAgentProfilerSettings
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
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Instructions category: the machine's AGENTS.md and SECURITY.md as peer editable files"
                label="Happy Agent settings — instructions"
                number="02"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <HappyAgentInstructionsSettings
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
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Account category in full, in the order the four are true in: who this machine authors as, the account it signs into, what that account's data is locked with, and every installation sharing it"
                label="Happy Agent settings — account"
                number="02a"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappyAgentProfileSettings
                        email="steve@korshakov.com"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                        username="steve"
                    />
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            displayName: "Steve Korshakov",
                            status: "enrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        keys="ready"
                        status="connected"
                    />
                    <HappyAgentEncryptionSettings
                        encryption={{
                            identityKey: "TTYFvS8PBRw760IXOVgI24YAx8qiV9Zxmb9HdZ5F2Ss",
                            secret: { status: "hidden" },
                            status: "ready",
                        }}
                        onKeysContinue={noop}
                        onSecretHide={noop}
                        onSecretReveal={noop}
                    />
                    <HappyAgentDeviceSettings
                        devices={accountDevices}
                        onDeviceRemove={noop}
                        read={{ status: "ready" }}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="An account whose encryption is unfinished: the way to resume it sits under the account it protects, above the devices that would share it"
                label="Happy Agent settings — encryption required"
                number="02aa"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappyAgentProfileSettings
                        email="steve@korshakov.com"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                        username="steve"
                    />
                    <HappySocialSettings
                        displayName="Steve Korshakov"
                        email="steve@example.com"
                        enrollment={{
                            displayName: "Steve Korshakov",
                            status: "enrolled",
                            username: "steve",
                        }}
                        {...happySocialJoinFixture}
                        keys="create_required"
                        status="connected"
                    />
                    <HappyAgentEncryptionSettings
                        encryption={{ status: "create_required" }}
                        onKeysContinue={noop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The retained secret key on demand: read from Happy Agent, shown once, and copyable"
                label="Happy Agent settings — secret key revealed"
                number="02ab"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappyAgentProfileSettings
                        email="steve@korshakov.com"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                        username="steve"
                    />
                    <HappyAgentEncryptionSettings
                        encryption={{
                            identityKey: "TTYFvS8PBRw760IXOVgI24YAx8qiV9Zxmb9HdZ5F2Ss",
                            secret: {
                                secret: "H1-4K2QW-9XZTM-7NPDV-3JHRB-8CFGL2",
                                status: "revealed",
                            },
                            status: "ready",
                        }}
                        onSecretHide={noop}
                        onSecretReveal={noop}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Edited in place: the fields differ from what is stored, and the last save was refused"
                label="Happy Agent settings — profile edited"
                number="02b"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="account"
                    categories={categories}
                    description={accountDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Account"
                >
                    <HappyAgentProfileSettings
                        dirty
                        email="steve@"
                        name="Steve Korshakov"
                        onEmailChange={noop}
                        onNameChange={noop}
                        onRevert={noop}
                        onSave={noop}
                        saveError="Enter the email used for Git commits."
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Secrets category: safe metadata lists write-only environment bundles without exposing values"
                label="Happy Agent settings — secrets"
                number="02s"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description="Write-only environment bundles this Happy Agent can provide to agents"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <HappyAgentSecretSettings
                        onSecretCreate={() => Promise.resolve()}
                        secrets={secrets}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Create flow: one write-only value row, explicit global availability, and the standard modal form placement"
                label="Happy Agent settings — create secret"
                number="02t"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="secrets"
                    categories={categories}
                    description="Write-only environment bundles this Happy Agent can provide to agents"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Secrets"
                >
                    <HappyAgentSecretSettings
                        initialCreateOpen
                        onSecretCreate={() => Promise.resolve()}
                        secrets={secrets}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Providers category: verified, rejected, checking, and disabled providers together"
                label="Happy Agent settings — providers"
                number="03"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Happy Agent daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <HappyAgentProviderSettings
                        onModelEnabledChange={noop}
                        onProviderEnabledChange={noop}
                        providers={providers}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A refused provider change: the list still shows what the daemon holds, with the refusal above it"
                label="Happy Agent settings — providers refused"
                number="03a"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Happy Agent daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <HappyAgentProviderSettings
                        onModelEnabledChange={noop}
                        onProviderEnabledChange={noop}
                        providers={providers}
                        saveError="This Happy Agent cannot change its providers while it is running."
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The catalog has not arrived yet, so both the picker and the provider list say so"
                label="Happy Agent settings — loading"
                number="04"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Happy Agent daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <HappyAgentProviderSettings
                        loading
                        onModelEnabledChange={noop}
                        onProviderEnabledChange={noop}
                        providers={[]}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A failed catalog read is a loud alert rather than an empty provider list"
                label="Happy Agent settings — error"
                number="05"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="providers"
                    categories={categories}
                    description="Every model provider this Happy Agent daemon knows about"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Providers"
                >
                    <HappyAgentProviderSettings
                        error="The Happy Agent daemon could not read its model catalog."
                        onModelEnabledChange={noop}
                        onProviderEnabledChange={noop}
                        providers={[]}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Happy Agent offline: appearance remains local, retained defaults stay visible, and daemon-backed changes wait for reconnect"
                label="Happy Agent settings — offline"
                number="06"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="general"
                    categories={categories}
                    description="How this window looks and what a new session starts with"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="General"
                >
                    <HappyAgentGeneralSettings
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
                        onScrollbarVisibilityChange={noop}
                        onTitleShimmerChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                        remoteMac={{
                            snapshot: {
                                mount: {
                                    address: "100.88.40.12",
                                    credentialConfigured: true,
                                    id: "remote-offline-blueprint",
                                    label: "Studio Mac",
                                    message: "The remote Mac rejected the saved token.",
                                    port: 43127,
                                    sourceAddress: "100.93.11.4",
                                    status: "error",
                                },
                                share: {
                                    bindAddress: "100.93.11.4",
                                    enabled: true,
                                    message: "The Tailscale address is temporarily unavailable.",
                                    port: 44831,
                                    status: "error",
                                },
                                tailnetAddresses: [{ address: "100.93.11.4", interface: "utun7" }],
                            },
                            onMountRemove: promiseNoop,
                            onMountWrite: promiseNoop,
                            onRetry: promiseNoop,
                            onShareDisable: promiseNoop,
                            onShareEnable: promiseNoop,
                            onShareRotate: promiseNoop,
                        }}
                        scrollbarVisibility="automatic"
                        titleShimmerEnabled={false}
                        unavailable="Happy Agent is offline. Showing the last synced defaults."
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Known Happy Agent offline: instruction drafts remain editable and visible; Save waits for reconnect"
                label="Happy Agent settings — instructions offline"
                number="07"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="instructions"
                    categories={categories}
                    description="Machine-wide agent guidance and permission-review policy"
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Instructions"
                >
                    <HappyAgentInstructionsSettings
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
                                    "Happy Agent is offline. Draft preserved until reconnect.",
                                value: instructions,
                            },
                        ]}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Usage category: three accounts separated by a rule rather than boxed — one with room across three windows, one spent with credits behind it, one that could not be read"
                label="Happy Agent settings — usage"
                number="08"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <HappyAgentUsageSettings
                        currentTime={1_700_000_000_000}
                        providers={usageAccounts}
                        readingTime={usageReadingTime}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Token counts with no plan share behind them: what each model spent per rolling window, two accounts of the same vendor kept apart by their own names, and one that has spent nothing"
                label="Happy Agent settings — usage tokens only"
                number="08a"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <HappyAgentUsageSettings
                        currentTime={1_700_000_000_000}
                        providers={usageTokensOnly}
                        readingTime={usageReadingTime}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Before the first reading arrives, so an empty account list is not claimed early"
                label="Happy Agent settings — usage loading"
                number="08b"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <HappyAgentUsageSettings loading providers={[]} />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="No assistant is signed in on this machine, so the category sends the reader where accounts are actually made"
                label="Happy Agent settings — usage empty"
                number="08c"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <HappyAgentUsageSettings providers={[]} />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="The reading failed; what was already read stays legible beneath the banner, and an account never read says so rather than reading as unspent"
                label="Happy Agent settings — usage error and unread"
                number="08d"
            >
                <HappyAgentSettingsShell
                    activeCategoryId="usage"
                    categories={categories}
                    description={usageDescription}
                    onCategorySelect={noop}
                    onClose={noop}
                    title="Usage"
                >
                    <HappyAgentUsageSettings
                        currentTime={1_700_000_000_000}
                        error={{
                            name: "UserError",
                            message: "The Happy Agent stopped reporting usage.",
                        }}
                        providers={usageUnread}
                        readingTime={usageReadingTime}
                    />
                </HappyAgentSettingsShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
