import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    RigModelCatalog,
    RigModelKey,
    RigModelStore,
    RigPermissionMode,
    RigSettingsSnapshot,
    RigSettingsStore,
    RigThinkingLevel,
    RigWindowStore,
} from "happy2-state";
import {
    rigModelKey,
    rigPermissionLabel,
    rigThinkingLabel,
    rigWindowStoreNoop,
} from "happy2-state";
import {
    RigGeneralSettings,
    RigProviderSettings,
    RigSettingsShell,
    type RigProviderRow,
    type RigSettingsCategory,
} from "happy2-ui";
import type { SelectOption } from "happy2-ui";

/** The categories the local settings window offers, in the order they are listed. */
export const RIG_SETTINGS_CATEGORIES: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "globe", id: "providers", label: "Providers" },
];

export const RIG_SETTINGS_DEFAULT_CATEGORY = "general";

/** True when `section` addresses a category this window actually has. */
export function rigSettingsCategoryExists(section: string): boolean {
    return RIG_SETTINGS_CATEGORIES.some((category) => category.id === section);
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    general: "How this window looks and what a new session starts with",
    providers: "Every model provider this Rig daemon knows about",
};

const PERMISSION_MODES: readonly RigPermissionMode[] = [
    "auto",
    "workspace_write",
    "read_only",
    "full_access",
];

export interface AppRigSettingsViewProps {
    appearance: AppearanceStore;
    /** Absent until a daemon connection exists; the pickers then say they are loading. */
    models?: RigModelStore;
    onClose(): void;
    onCategorySelect(id: string): void;
    platform?: "desktop" | "web";
    section: string;
    settings: RigSettingsStore;
    windowState?: RigWindowStore;
}

/**
 * Local route glue for the settings window. It subscribes once each to the
 * appearance, model-catalog, and preference stores and projects the catalog into
 * the props the shared `happy2-ui` settings surfaces take; every layout and
 * visual decision lives there.
 */
export function AppRigSettingsView(props: AppRigSettingsViewProps) {
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    const models = useSyncExternalStore(
        props.models?.subscribe ?? noSubscribe,
        props.models?.get ?? modelsUnloaded,
        props.models?.get ?? modelsUnloaded,
    );
    const settings = useSyncExternalStore(
        props.settings.subscribe,
        props.settings.get,
        props.settings.get,
    );
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const catalog = models.type === "ready" ? models.catalog : undefined;
    const selection = defaultSelection(catalog, settings);
    const model = catalog?.providers
        .flatMap((provider) => provider.models.map((entry) => ({ provider, model: entry })))
        .find(
            (entry) =>
                entry.provider.id === selection.providerId && entry.model.id === selection.modelId,
        );
    return (
        <RigSettingsShell
            activeCategoryId={props.section}
            categories={RIG_SETTINGS_CATEGORIES}
            description={CATEGORY_DESCRIPTIONS[props.section]}
            onCategorySelect={props.onCategorySelect}
            onClose={props.onClose}
            title={
                RIG_SETTINGS_CATEGORIES.find((category) => category.id === props.section)?.label ??
                "Settings"
            }
            windowControls={props.platform === "desktop"}
            windowFullScreen={windowState.fullScreen}
        >
            {props.section === "providers" ? (
                <RigProviderSettings
                    error={models.type === "error" ? models.error.message : undefined}
                    loading={models.type !== "ready" && models.type !== "error"}
                    onModelEnabledChange={(id, enabled) =>
                        props.settings.modelEnabledUpdate(id as RigModelKey, enabled)
                    }
                    providers={providerRows(catalog, settings, selection)}
                />
            ) : (
                <RigGeneralSettings
                    appearance={appearance.mode}
                    defaultModelKey={
                        selection.modelId
                            ? rigModelKey(selection.providerId, selection.modelId)
                            : undefined
                    }
                    effort={settings.defaultEffort ?? model?.model.defaultThinkingLevel}
                    effortOptions={(model?.model.thinkingLevels ?? []).map((level) => ({
                        label: rigThinkingLabel(level),
                        value: level,
                    }))}
                    error={models.type === "error" ? models.error.message : undefined}
                    loading={models.type !== "ready" && models.type !== "error"}
                    modelOptions={modelOptions(catalog, settings)}
                    onAppearanceChange={(mode) => props.appearance.appearanceSelect(mode)}
                    onDefaultModelChange={(key) => {
                        const [providerId, ...rest] = key.split(":");
                        if (providerId)
                            props.settings.defaultModelUpdate(providerId, rest.join(":"));
                    }}
                    onEffortChange={(effort) =>
                        props.settings.defaultEffortUpdate(effort as RigThinkingLevel)
                    }
                    onPermissionModeChange={(mode) =>
                        props.settings.defaultPermissionModeUpdate(mode as RigPermissionMode)
                    }
                    permissionMode={settings.defaultPermissionMode ?? "auto"}
                    permissionModeOptions={PERMISSION_MODES.map((mode) => ({
                        label: rigPermissionLabel(mode),
                        value: mode,
                    }))}
                />
            )}
        </RigSettingsShell>
    );
}

const noSubscribe = () => () => undefined;
const UNLOADED = { type: "loading" } as const;
const modelsUnloaded = () => UNLOADED;

/** The chosen default, falling back to whatever the catalog itself defaults to. */
function defaultSelection(
    catalog: RigModelCatalog | undefined,
    settings: RigSettingsSnapshot,
): { providerId: string; modelId: string } {
    return {
        modelId: settings.defaultModelId ?? catalog?.defaultModelId ?? "",
        providerId: settings.defaultProviderId ?? catalog?.defaultProviderId ?? "",
    };
}

/** Every model a usable provider offers, labelled "Provider · Model" for one flat picker. */
function modelOptions(
    catalog: RigModelCatalog | undefined,
    settings: RigSettingsSnapshot,
): readonly SelectOption[] {
    return (catalog?.providers ?? []).flatMap((provider) =>
        provider.models
            .filter((model) => !settings.disabledModels.has(rigModelKey(provider.id, model.id)))
            .map((model) => ({
                disabled: provider.disabledReason !== undefined,
                label: `${providerName(provider.id)} · ${model.name}`,
                value: rigModelKey(provider.id, model.id),
            })),
    );
}

function providerRows(
    catalog: RigModelCatalog | undefined,
    settings: RigSettingsSnapshot,
    selection: { providerId: string; modelId: string },
): readonly RigProviderRow[] {
    return (catalog?.providers ?? []).map((provider) => ({
        id: provider.id,
        models: provider.models.map((model) => ({
            contextWindow: model.contextWindow,
            efforts: model.thinkingLevels.map(rigThinkingLabel),
            enabled: !settings.disabledModels.has(rigModelKey(provider.id, model.id)),
            id: rigModelKey(provider.id, model.id),
            isDefault: provider.id === selection.providerId && model.id === selection.modelId,
            modelId: model.id,
            name: model.name,
        })),
        name: providerName(provider.id),
        serviceTiers: provider.serviceTiers.map((tier) => (tier === "fast" ? "Fast" : tier)),
        status: provider.disabledReason ?? "ready",
    }));
}

/** The daemon reports a provider by id only, so the display name is that id, titled. */
function providerName(id: string): string {
    return id
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ");
}
