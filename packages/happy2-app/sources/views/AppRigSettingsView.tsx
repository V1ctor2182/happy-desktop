import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    RigInstructionsSnapshot,
    RigModelCatalog,
    RigModelKey,
    RigPermissionMode,
    RigSettingsSnapshot,
    RigSettingsStore,
    RigThinkingLevel,
    RigWindowStore,
} from "happy2-state";
import {
    RIG_INSTRUCTIONS_MAX_BYTES,
    rigModelKey,
    rigPermissionLabel,
    rigThinkingLabel,
    rigWindowStoreNoop,
} from "happy2-state";
import {
    RigGeneralSettings,
    RigInstructionsSettings,
    RigMachineSettings,
    RigProviderSettings,
    RigSettingsShell,
    type RigMachineRow,
    type RigProviderRow,
    type RigSettingsCategory,
} from "happy2-ui";
import type { SelectOption } from "happy2-ui";
import type { AppRigDirectorySnapshot, AppRigDirectoryStore } from "../AppRigView";

/** The categories the local settings window offers, in the order they are listed. */
export const RIG_SETTINGS_CATEGORIES: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "link", id: "machines", label: "Machines" },
    { icon: "globe", id: "providers", label: "Providers" },
];

export const RIG_SETTINGS_DEFAULT_CATEGORY = "general";

/** True when `section` addresses a category this window actually has. */
export function rigSettingsCategoryExists(section: string): boolean {
    return RIG_SETTINGS_CATEGORIES.some((category) => category.id === section);
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    general: "How this window looks and what a new session starts with",
    instructions: "What every agent on this machine is told before anything else",
    machines: "Every Rig this window works in, here and elsewhere",
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
    /** Every Rig in this window: the Machines category, and whose catalog is read. */
    rigs: AppRigDirectoryStore;
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
    const directory = useSyncExternalStore(props.rigs.subscribe, props.rigs.get, props.rigs.get);
    // The catalog shown is this machine's: providers are configured in the Rig
    // the window runs on, and the defaults chosen here are the window's own.
    const modelStore = directory.rigs.find((rig) => rig.kind === "local")?.session?.models;
    const models = useSyncExternalStore(
        modelStore?.subscribe ?? noSubscribe,
        modelStore?.get ?? modelsUnloaded,
        modelStore?.get ?? modelsUnloaded,
    );
    const settings = useSyncExternalStore(
        props.settings.subscribe,
        props.settings.get,
        props.settings.get,
    );
    // Subscribing is what starts the read, so the instructions are asked for
    // only while this window is open, and only once however often it is.
    const instructionsStore = directory.rigs.find((rig) => rig.kind === "local")?.session
        ?.instructions;
    const instructions = useSyncExternalStore(
        instructionsStore?.subscribe ?? noSubscribe,
        instructionsStore?.get ?? instructionsUnavailable,
        instructionsStore?.get ?? instructionsUnavailable,
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
            {props.section === "instructions" ? (
                <RigInstructionsSettings
                    bytes={instructions.bytes}
                    dirty={instructions.dirty}
                    error={
                        instructionsStore === undefined
                            ? "This window is not connected to a Rig on this machine."
                            : instructions.stored.type === "error"
                              ? instructions.stored.error.message
                              : undefined
                    }
                    loading={
                        instructionsStore !== undefined &&
                        instructions.stored.type !== "ready" &&
                        instructions.stored.type !== "error"
                    }
                    maximumBytes={RIG_INSTRUCTIONS_MAX_BYTES}
                    onRevert={() => instructionsStore?.revert()}
                    onSave={() => instructionsStore?.save()}
                    onValueChange={(value) => instructionsStore?.draftUpdate(value)}
                    path={INSTRUCTIONS_PATH}
                    saveError={instructions.saveError?.message}
                    saving={instructions.saving}
                    value={instructions.draft}
                />
            ) : props.section === "machines" ? (
                <RigMachineSettings
                    draft={{
                        destination: directory.add.destination,
                        label: directory.add.label,
                        ...(directory.add.error ? { error: directory.add.error } : {}),
                    }}
                    machines={machineRows(directory)}
                    onAdd={() => props.rigs.addSubmit()}
                    onConnect={(id) => props.rigs.rigConnect(id)}
                    onDisconnect={(id) => props.rigs.rigDisconnect(id)}
                    onDestinationChange={(value) => props.rigs.destinationUpdate(value)}
                    onForget={(id) => props.rigs.rigRemove(id)}
                    onLabelChange={(value) => props.rigs.labelUpdate(value)}
                />
            ) : props.section === "providers" ? (
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
                        const modelId = rest.join(":");
                        const selected = catalog?.providers
                            .find((provider) => provider.id === providerId)
                            ?.models.find((candidate) => candidate.id === modelId);
                        if (!providerId || !selected) return;
                        props.settings.defaultModelUpdate(providerId, modelId);
                        props.settings.defaultEffortUpdate(selected.defaultThinkingLevel);
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

/** Every Rig as one row, this machine first and never offering its own controls. */
function machineRows(directory: AppRigDirectorySnapshot): readonly RigMachineRow[] {
    return directory.rigs.map((rig) => ({
        connected: rig.connected,
        id: rig.id,
        label: rig.label,
        local: rig.kind === "local",
        projectCount: rig.projects.length,
        status: rig.status,
        ...(rig.destination ? { destination: rig.destination } : {}),
        ...(rig.message ? { message: rig.message } : {}),
        ...(rig.version ? { version: rig.version } : {}),
    }));
}

/**
 * Where the daemon keeps its global instructions. The path is fixed by Rig
 * itself and is shown rather than asked for, so it is plain what a save changes.
 */
const INSTRUCTIONS_PATH = "~/Happy/Config/AGENTS.md";

const noSubscribe = () => () => undefined;
const UNLOADED = { type: "loading" } as const;
const modelsUnloaded = () => UNLOADED;

const INSTRUCTIONS_UNAVAILABLE: RigInstructionsSnapshot = {
    stored: { type: "unloaded" },
    draft: "",
    dirty: false,
    bytes: 0,
    saving: false,
};
/** Stands in while no Rig on this machine is connected to read them from. */
const instructionsUnavailable = () => INSTRUCTIONS_UNAVAILABLE;

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
