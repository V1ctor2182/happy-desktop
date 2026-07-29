import {
    RigGeneralSettings,
    RigProviderSettings,
    RigSettingsShell,
    type RigProviderRow,
    type RigSettingsCategory,
} from "../../src";
import { ComponentPage, FullScreenSpecimen } from "../kit";

const categories: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "globe", id: "providers", label: "Providers" },
];

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
            number="P-012"
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
                        modelOptions={modelOptions}
                        onAppearanceChange={noop}
                        onDefaultModelChange={noop}
                        onEffortChange={noop}
                        onPermissionModeChange={noop}
                        permissionMode="auto"
                        permissionModeOptions={permissionModeOptions}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Providers category: connected, unauthenticated, disabled, and model-less providers together"
                label="Rig settings — providers"
                number="02"
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
                    <RigProviderSettings loading onModelEnabledChange={noop} providers={[]} />
                </RigSettingsShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="A failed catalog read is a loud alert rather than an empty provider list"
                label="Rig settings — error"
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
                    <RigProviderSettings
                        error="The Rig daemon could not read its model catalog."
                        onModelEnabledChange={noop}
                        providers={[]}
                    />
                </RigSettingsShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
