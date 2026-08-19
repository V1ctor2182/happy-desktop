import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    ExperimentsStore,
    RigInstructionsSnapshot,
    RigDebugLogSnapshot,
    RigSecurityPolicySnapshot,
    RigModelCatalog,
    RigModelKey,
    RigPermissionMode,
    RigProfilesStore,
    RigSettingsSnapshot,
    RigSettingsStore,
    RigThinkingLevel,
    RigWindowStore,
    TitleShimmerStore,
} from "happy-desktop-state";
import {
    RIG_INSTRUCTIONS_MAX_BYTES,
    RIG_SECURITY_POLICY_MAX_BYTES,
    rigModelKey,
    rigPermissionLabel,
    rigThinkingLabel,
    experimentsStoreNoop,
    rigAvailabilityProject,
    rigProfilesStoreNoop,
    rigProviderUsageStoreNoop,
    rigWindowStoreNoop,
    titleShimmerStoreNoop,
} from "happy-desktop-state";
import {
    RigGeneralSettings,
    RigDebugLogPanel,
    RigDebugSettings,
    RigInstructionsSettings,
    RigProviderSettings,
    RigProfilerSettings,
    RigProfilesSettings,
    RigSettingsShell,
    RigUsageSettings,
    type RigProviderRow,
    type RigSettingsCategory,
} from "happy-desktop-ui";
import type { SelectOption } from "happy-desktop-ui";
import { hostRig, type AppRigDirectoryStore } from "../AppRigView";

/** The categories the local settings window offers, in the order they are listed. */
export const RIG_SETTINGS_CATEGORIES: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "code", id: "debug", label: "Dev Tools" },
    { icon: "users", id: "profiles", label: "Profiles" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "globe", id: "providers", label: "Providers" },
    // Usage sits after Providers because it is the same accounts read the other
    // way round: which of them exist, then what each has spent.
    { icon: "zap", id: "usage", label: "Usage" },
];

export const RIG_SETTINGS_DEFAULT_CATEGORY = "general";

/** True when `section` addresses a category this window actually has. */
export function rigSettingsCategoryExists(section: string): boolean {
    return RIG_SETTINGS_CATEGORIES.some((category) => category.id === section);
}

export interface AppRigDebugTargetSnapshot {
    readonly error?: string;
    readonly status: "stopped" | "starting" | "running" | "stopping" | "unavailable" | "error";
    readonly url?: string;
}

/** The native debugger state projected into the settings route. */
export interface AppRigDebugSnapshot {
    readonly daemon: AppRigDebugTargetSnapshot;
    readonly daemonConnected: boolean;
    readonly error?: string;
    readonly loading: boolean;
    readonly main: AppRigDebugTargetSnapshot;
    readonly renderer: AppRigDebugTargetSnapshot;
    readonly supported: boolean;
}

/** Framework-neutral adapter for the desktop debugger capability. */
export interface AppRigDebugStore {
    get(): AppRigDebugSnapshot;
    subscribe(listener: () => void): () => void;
    debugAllStart(): void;
    debugAllStop(): void;
    daemonInspectorStart(): void;
    daemonInspectorStop(): void;
    mainInspectorStart(): void;
    mainInspectorStop(): void;
    rendererInspectorStart(): void;
    rendererInspectorStop(): void;
}

export interface AppRigProfilerCapabilities {
    readonly liveDebuggerAttach: boolean;
    readonly nativeTrace: boolean;
    readonly processMetrics: boolean;
    readonly reactAttribution: boolean;
    readonly reactDevtoolsProfiling: boolean;
    readonly rendererMetrics: boolean;
}

export interface AppRigProfilerSnapshot {
    readonly artifactPath?: string;
    readonly capabilities: AppRigProfilerCapabilities;
    readonly error?: string;
    readonly partialReason?: string;
    readonly status:
        | "stopped"
        | "starting"
        | "running"
        | "stopping"
        | "partial"
        | "error"
        | "unavailable";
}

/** Framework-neutral adapter for the native renderer profiler capability. */
export interface AppRigProfilerStore {
    get(): AppRigProfilerSnapshot;
    profilerStart(): void;
    profilerStop(): void;
    subscribe(listener: () => void): () => void;
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    debug: "Inspect live state, Happy and Rig debugger endpoints, and renderer profiles",
    general: "How this window looks and what a new session starts with",
    profiles: "The identities available for agent work",
    instructions: "Machine-wide agent guidance and permission-review policy",
    providers: "Every model provider this Rig daemon knows about",
    usage: "How much of each provider account's plan this machine has spent",
};

const PERMISSION_MODES: readonly RigPermissionMode[] = [
    "auto",
    "workspace_write",
    "read_only",
    "full_access",
];

export interface AppRigSettingsViewProps {
    appearance: AppearanceStore;
    /**
     * Whether this window offers the features that are not finished yet. Absent
     * in a host that remembers no such choice, which withholds them.
     */
    experiments?: ExperimentsStore;
    /** Every Rig in this window, including the one whose catalog is read. */
    debug?: AppRigDebugStore;
    profiler?: AppRigProfilerStore;
    rigs: AppRigDirectoryStore;
    onClose(): void;
    onCategorySelect(id: string): void;
    platform?: "desktop" | "web";
    section: string;
    settings: RigSettingsStore;
    /** Window-local preference for animated activity titles. */
    titleShimmer?: TitleShimmerStore;
    windowState?: RigWindowStore;
}

/**
 * Local route glue for the settings window. It subscribes once each to the
 * appearance, model-catalog, and preference stores and projects the catalog into
 * the props the shared `happy-desktop-ui` settings surfaces take; every layout and
 * visual decision lives there.
 */
export function AppRigSettingsView(props: AppRigSettingsViewProps) {
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    const experimentsStore = props.experiments ?? experimentsStoreNoop;
    const experiments = useSyncExternalStore(
        experimentsStore.subscribe,
        experimentsStore.get,
        experimentsStore.get,
    );
    const titleShimmerStore = props.titleShimmer ?? titleShimmerStoreNoop;
    const titleShimmer = useSyncExternalStore(
        titleShimmerStore.subscribe,
        titleShimmerStore.get,
        titleShimmerStore.get,
    );
    const directory = useSyncExternalStore(props.rigs.subscribe, props.rigs.get, props.rigs.get);
    const host = hostRig(directory);
    const hostAvailability = host?.session
        ? rigAvailabilityProject(host.session.connection.get(), true, {
              status: host.status,
              ...(host.message === undefined ? {} : { message: host.message }),
          })
        : undefined;
    const unavailable =
        hostAvailability?.online === false
            ? (hostAvailability.refusal ?? hostAvailability.message)
            : host?.session
              ? undefined
              : "The local Rig is unavailable.";
    const rigOnline = (): boolean => {
        const current = hostRig(props.rigs.get());
        return current?.session
            ? rigAvailabilityProject(current.session.connection.get(), true, {
                  status: current.status,
                  ...(current.message === undefined ? {} : { message: current.message }),
              }).online
            : false;
    };
    // The catalog shown is this machine's: providers are configured in the Rig
    // the window runs on, and the defaults chosen here are the window's own.
    const modelStore = host?.session?.models;
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
    const profilesStore =
        (props.section === "profiles" ? host?.session?.profiles?.() : undefined) ??
        rigProfilesStoreNoop;
    const profiles = useSyncExternalStore(
        profilesStore.subscribe,
        profilesStore.get,
        profilesStore.get,
    );
    // Subscribing is what starts the read, so the instructions are asked for
    // only while this window is open, and only once however often it is.
    const instructionsStore = host?.session?.instructions;
    const instructions = useSyncExternalStore(
        instructionsStore?.subscribe ?? noSubscribe,
        instructionsStore?.get ?? instructionsUnavailable,
        instructionsStore?.get ?? instructionsUnavailable,
    );
    const securityPolicyStore = host?.session?.securityPolicy;
    const securityPolicy = useSyncExternalStore(
        securityPolicyStore?.subscribe ?? noSubscribe,
        securityPolicyStore?.get ?? securityPolicyUnavailable,
        securityPolicyStore?.get ?? securityPolicyUnavailable,
    );
    // The Usage category is the only thing that reads these, and subscribing is
    // what starts the work: the daemon is asked what its accounts have spent,
    // and the clock ticks the time left until each reset, only while that
    // category is the one on screen.
    const usageOpen = props.section === "usage";
    const usageStore =
        (usageOpen ? host?.session?.providerUsage : undefined) ?? rigProviderUsageStoreNoop;
    const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get, usageStore.get);
    const clockStore = usageOpen ? host?.session?.clock : undefined;
    const currentTime = useSyncExternalStore(
        clockStore?.subscribe ?? noSubscribe,
        clockStore?.get ?? clockStopped,
        clockStore?.get ?? clockStopped,
    );
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const debugStore = (props.section === "debug" ? props.debug : undefined) ?? debugStoreNoop;
    const debug = useSyncExternalStore(debugStore.subscribe, debugStore.get, debugStore.get);
    const debugLogStore = props.section === "debug" ? host?.session?.debugLog : undefined;
    const debugLog = useSyncExternalStore(
        debugLogStore?.subscribe ?? noSubscribe,
        debugLogStore?.get ?? debugLogEmpty,
        debugLogStore?.get ?? debugLogEmpty,
    );
    const profilerStore =
        (props.section === "debug" ? props.profiler : undefined) ?? profilerStoreNoop;
    const profiler = useSyncExternalStore(
        profilerStore.subscribe,
        profilerStore.get,
        profilerStore.get,
    );
    const catalog = models.type === "ready" ? models.catalog : undefined;
    const selection = defaultSelection(catalog, settings);
    const model = catalog?.providers
        .flatMap((provider) => provider.models.map((entry) => ({ provider, model: entry })))
        .find(
            (entry) =>
                entry.provider.id === selection.providerId && entry.model.id === selection.modelId,
        );
    const effort =
        model?.model && !model.model.thinkingLevels.includes(settings.defaultEffort)
            ? model.model.defaultThinkingLevel
            : settings.defaultEffort;
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
            {props.section === "debug" ? (
                <>
                    <RigDebugLogPanel
                        discardedEntries={debugLog.discardedEntries}
                        entries={debugLog.entries}
                    />
                    <RigDebugSettings
                        daemon={debug.daemon}
                        daemonConnected={debug.daemonConnected}
                        error={debug.error}
                        loading={debug.loading}
                        main={debug.main}
                        onAllStart={debugStore.debugAllStart}
                        onAllStop={debugStore.debugAllStop}
                        onDaemonStart={debugStore.daemonInspectorStart}
                        onDaemonStop={debugStore.daemonInspectorStop}
                        onMainStart={debugStore.mainInspectorStart}
                        onMainStop={debugStore.mainInspectorStop}
                        onRendererStart={debugStore.rendererInspectorStart}
                        onRendererStop={debugStore.rendererInspectorStop}
                        renderer={debug.renderer}
                        supported={debug.supported}
                    />
                    <RigProfilerSettings
                        artifactPath={profiler.artifactPath}
                        capabilities={profiler.capabilities}
                        error={profiler.error}
                        onStart={profilerStore.profilerStart}
                        onStop={profilerStore.profilerStop}
                        partialReason={profiler.partialReason}
                        status={profiler.status}
                        supported={profiler.status !== "unavailable"}
                    />
                </>
            ) : props.section === "profiles" ? (
                <RigProfilesSettings
                    loading={profiles.loading}
                    onProfileCreate={() => profilesStore.profileCreateOpen()}
                    onProfileEdit={(profileId) => profilesStore.profileEditOpen(profileId)}
                    onProfileSelect={(profileId) => profilesStore.profileSelect(profileId)}
                    profiles={profiles.profiles.map((profile) => ({
                        email: profile.email,
                        id: profile.id,
                        name: profile.name,
                        selected: profile.id === profiles.selectedProfileId,
                        ...(profile.photo === undefined
                            ? {}
                            : { imageUrl: profile.photo.imageUrl }),
                    }))}
                    {...(profiles.editor ? { editor: profileEditor(profilesStore) } : {})}
                    {...(profiles.error ? { error: profiles.error.message } : {})}
                    {...(profiles.actionError ? { actionError: profiles.actionError } : {})}
                    {...(unavailable === undefined ? {} : { unavailable })}
                />
            ) : props.section === "instructions" ? (
                <RigInstructionsSettings
                    documents={[
                        {
                            bytes: instructions.bytes,
                            description:
                                "Given to every agent this machine starts, on top of the project's own AGENTS.md.",
                            dirty: instructions.dirty,
                            error: documentError(instructionsStore, instructions),
                            id: "agents",
                            label: "AGENTS.md",
                            loading: documentLoading(instructionsStore, instructions),
                            maximumBytes: RIG_INSTRUCTIONS_MAX_BYTES,
                            onRevert: () => instructionsStore?.revert(),
                            onSave: () => {
                                if (rigOnline()) instructionsStore?.save();
                            },
                            onValueChange: (value) => instructionsStore?.draftUpdate(value),
                            path: INSTRUCTIONS_PATH,
                            placeholder: "Anything every agent on this machine should know…",
                            saveError: instructions.saveError?.message,
                            saving: instructions.saving,
                            value: instructions.draft,
                            ...(unavailable === undefined
                                ? {}
                                : {
                                      saveDisabled: true,
                                      saveDisabledReason: unavailable,
                                  }),
                        },
                        {
                            bytes: securityPolicy.bytes,
                            description:
                                "Applied when this machine reviews whether an agent action is allowed.",
                            dirty: securityPolicy.dirty,
                            error: documentError(securityPolicyStore, securityPolicy),
                            id: "security",
                            label: "SECURITY.md",
                            loading: documentLoading(securityPolicyStore, securityPolicy),
                            maximumBytes: RIG_SECURITY_POLICY_MAX_BYTES,
                            onRevert: () => securityPolicyStore?.revert(),
                            onSave: () => {
                                if (rigOnline()) securityPolicyStore?.save();
                            },
                            onValueChange: (value) => securityPolicyStore?.draftUpdate(value),
                            path: SECURITY_POLICY_PATH,
                            placeholder: "Rules for deciding which agent actions are allowed…",
                            saveError: securityPolicy.saveError?.message,
                            saving: securityPolicy.saving,
                            value: securityPolicy.draft,
                            ...(unavailable === undefined
                                ? {}
                                : {
                                      saveDisabled: true,
                                      saveDisabledReason: unavailable,
                                  }),
                        },
                    ]}
                />
            ) : props.section === "providers" ? (
                <RigProviderSettings
                    error={models.type === "error" ? models.error.message : undefined}
                    loading={models.type !== "ready" && models.type !== "error"}
                    onModelEnabledChange={(id, enabled) =>
                        rigOnline()
                            ? props.settings.modelEnabledUpdate(id as RigModelKey, enabled)
                            : undefined
                    }
                    providers={providerRows(catalog, settings, selection)}
                    {...(unavailable === undefined ? {} : { unavailable })}
                />
            ) : props.section === "usage" ? (
                <RigUsageSettings
                    loading={usage.loading}
                    providers={usage.providers}
                    readingTime={usageReadingTime}
                    {...(clockStore ? { currentTime } : {})}
                    {...(usage.error ? { error: usage.error } : {})}
                />
            ) : (
                <RigGeneralSettings
                    appearance={appearance.mode}
                    defaultModelKey={
                        selection.modelId
                            ? rigModelKey(selection.providerId, selection.modelId)
                            : undefined
                    }
                    effort={effort}
                    effortOptions={(model?.model.thinkingLevels ?? []).map((level) => ({
                        label: rigThinkingLabel(level),
                        value: level,
                    }))}
                    error={models.type === "error" ? models.error.message : undefined}
                    experimentalFeaturesEnabled={experiments.experimentalFeaturesEnabled}
                    loading={models.type !== "ready" && models.type !== "error"}
                    modelOptions={modelOptions(catalog, settings)}
                    onAppearanceChange={(mode) => props.appearance.appearanceSelect(mode)}
                    onExperimentalFeaturesChange={(enabled) =>
                        experimentsStore.experimentalFeaturesUpdate(enabled)
                    }
                    onTitleShimmerChange={(enabled) =>
                        titleShimmerStore.titleShimmerUpdate(enabled)
                    }
                    onDefaultModelChange={(key) => {
                        const [providerId, ...rest] = key.split(":");
                        const modelId = rest.join(":");
                        const selected = catalog?.providers
                            .find((provider) => provider.id === providerId)
                            ?.models.find((candidate) => candidate.id === modelId);
                        if (!providerId || !selected) return;
                        if (!rigOnline()) return;
                        props.settings.defaultModelUpdate(providerId, modelId);
                        props.settings.defaultEffortUpdate(selected.defaultThinkingLevel);
                    }}
                    onEffortChange={(effort) => {
                        if (rigOnline())
                            props.settings.defaultEffortUpdate(effort as RigThinkingLevel);
                    }}
                    onPermissionModeChange={(mode) => {
                        if (rigOnline())
                            props.settings.defaultPermissionModeUpdate(mode as RigPermissionMode);
                    }}
                    permissionMode={settings.defaultPermissionMode}
                    permissionModeOptions={PERMISSION_MODES.map((mode) => ({
                        label: rigPermissionLabel(mode),
                        value: mode,
                    }))}
                    titleShimmerEnabled={titleShimmer.titleShimmerEnabled}
                    {...(unavailable === undefined ? {} : { unavailable })}
                />
            )}
        </RigSettingsShell>
    );
}

function profileEditor(store: RigProfilesStore) {
    const editor = store.get().editor;
    return {
        email: editor?.email ?? "",
        mode: editor?.mode ?? ("create" as const),
        name: editor?.name ?? "",
        saving: editor?.submitting ?? false,
        onEmailChange: (value: string) => store.profileEmailUpdate(value),
        onNameChange: (value: string) => store.profileNameUpdate(value),
        onSave: () => {
            void store.profileEditorSubmit();
        },
        onCancel: () => store.profileEditorCancel(),
        ...(editor?.error === undefined ? {} : { error: editor.error }),
    };
}

/**
 * Where the daemon keeps its global instructions. The path is fixed by Rig
 * itself and is shown rather than asked for, so it is plain what a save changes.
 */
const INSTRUCTIONS_PATH = "~/Happy/Config/AGENTS.md";
const SECURITY_POLICY_PATH = "~/Happy/Config/SECURITY.md";

const noSubscribe = () => () => undefined;
const UNLOADED = { type: "loading" } as const;
const modelsUnloaded = () => UNLOADED;
/** Stands in while no Rig on this machine is connected to read the time from. */
const clockStopped = () => 0;
const EMPTY_DEBUG_LOG: RigDebugLogSnapshot = { discardedEntries: 0, entries: [] };
const debugLogEmpty = () => EMPTY_DEBUG_LOG;
const debugStopped: AppRigDebugTargetSnapshot = { status: "stopped" };
const debugUnavailable: AppRigDebugSnapshot = {
    daemon: debugStopped,
    daemonConnected: false,
    loading: false,
    main: debugStopped,
    renderer: debugStopped,
    supported: false,
};
const debugStoreNoop: AppRigDebugStore = {
    get: () => debugUnavailable,
    subscribe: noSubscribe,
    debugAllStart: () => undefined,
    debugAllStop: () => undefined,
    daemonInspectorStart: () => undefined,
    daemonInspectorStop: () => undefined,
    mainInspectorStart: () => undefined,
    mainInspectorStop: () => undefined,
    rendererInspectorStart: () => undefined,
    rendererInspectorStop: () => undefined,
};
const profilerUnavailable: AppRigProfilerSnapshot = {
    capabilities: {
        liveDebuggerAttach: false,
        nativeTrace: false,
        processMetrics: false,
        reactAttribution: false,
        reactDevtoolsProfiling: false,
        rendererMetrics: false,
    },
    status: "unavailable",
};
const profilerStoreNoop: AppRigProfilerStore = {
    get: () => profilerUnavailable,
    profilerStart: () => undefined,
    profilerStop: () => undefined,
    subscribe: noSubscribe,
};

/**
 * When a usage reading was taken, as an absolute local time. A reading is only
 * as good as its age — a plan can be spent in the minutes since — so the account
 * says when it was taken rather than implying it is live.
 */
function usageReadingTime(capturedAt: number): string {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(capturedAt));
}

const INSTRUCTIONS_UNAVAILABLE: RigInstructionsSnapshot = {
    stored: { type: "unloaded" },
    draft: "",
    dirty: false,
    bytes: 0,
    saving: false,
};
/** Stands in while no Rig on this machine is connected to read them from. */
const instructionsUnavailable = () => INSTRUCTIONS_UNAVAILABLE;
const SECURITY_POLICY_UNAVAILABLE: RigSecurityPolicySnapshot = INSTRUCTIONS_UNAVAILABLE;
const securityPolicyUnavailable = () => SECURITY_POLICY_UNAVAILABLE;

function documentError(
    store: { get(): RigInstructionsSnapshot } | undefined,
    snapshot: RigInstructionsSnapshot,
): string | undefined {
    return store === undefined
        ? "This window is not connected to a Rig on this machine."
        : snapshot.stored.type === "error"
          ? snapshot.stored.error.message
          : undefined;
}

function documentLoading(
    store: { get(): RigInstructionsSnapshot } | undefined,
    snapshot: RigInstructionsSnapshot,
): boolean {
    return (
        store !== undefined && snapshot.stored.type !== "ready" && snapshot.stored.type !== "error"
    );
}

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
