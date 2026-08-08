import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    ExperimentsStore,
    RigNodesSnapshot,
    RigPairingSnapshot,
    RigInstructionsSnapshot,
    RigSecurityPolicySnapshot,
    RigModelCatalog,
    RigModelKey,
    RigPermissionMode,
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
    rigNodesStoreNoop,
    rigPairingStoreNoop,
    rigProviderUsageStoreNoop,
    rigWindowStoreNoop,
    titleShimmerStoreNoop,
} from "happy-desktop-state";
import {
    RigGeneralSettings,
    RigInstructionsSettings,
    RigNodeSettings,
    RigPairing,
    RigProviderSettings,
    RigSettingsShell,
    RigUsageSettings,
    type RigNodeRow,
    type RigNodeTransportRow,
    type RigPairingProgress,
    type RigProviderRow,
    type RigSettingsCategory,
} from "happy-desktop-ui";
import type { SelectOption } from "happy-desktop-ui";
import { hostRig, type AppRigDirectorySnapshot, type AppRigDirectoryStore } from "../AppRigView";

/** The categories the local settings window offers, in the order they are listed. */
export const RIG_SETTINGS_CATEGORIES: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "link", id: "nodes", label: "Nodes" },
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

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    general: "How this window looks and what a new session starts with",
    instructions: "Machine-wide agent guidance and permission-review policy",
    nodes: "Machines this Rig is peered with, and how it reaches them",
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
    /** Every Rig in this window: the Machines category, and whose catalog is read. */
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
    // The host's peering, subscribed only while this window is open: subscribing
    // is what opens the status stream, and it closes again when the window does.
    const nodesStore = host?.session?.nodes ?? rigNodesStoreNoop;
    const nodes = useSyncExternalStore(nodesStore.subscribe, nodesStore.get, nodesStore.get);
    // Pairing belongs to the host as well, and only to it: a node is reached
    // because the host already trusts it. Following a pairing lasts exactly as
    // long as this subscription, so leaving the window stops asking about one.
    const pairingStore = host?.session?.pairing ?? rigPairingStoreNoop;
    const pairing = useSyncExternalStore(
        pairingStore.subscribe,
        pairingStore.get,
        pairingStore.get,
    );
    const pairingProgressView = pairingProgress(pairing);
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
            {props.section === "instructions" ? (
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
            ) : props.section === "nodes" ? (
                <RigNodeSettings
                    loading={nodes.loading}
                    nodes={nodeRows(nodes, directory)}
                    pairing={
                        <RigPairing
                            answering={pairing.answering}
                            available={pairing.available}
                            creating={pairing.creating}
                            joining={pairing.join.submitting}
                            joinValue={pairing.join.invitation}
                            onInvitationCreate={() => {
                                if (rigOnline()) pairingStore.invitationCreate();
                            }}
                            onJoinSubmit={() => {
                                if (rigOnline()) pairingStore.joinSubmit();
                            }}
                            onJoinValueChange={(value) => pairingStore.joinInvitationUpdate(value)}
                            onReset={() => pairingStore.pairingReset()}
                            onVerificationAccept={() => {
                                if (rigOnline()) pairingStore.verificationAnswer(true);
                            }}
                            onVerificationReject={() => {
                                if (rigOnline()) pairingStore.verificationAnswer(false);
                            }}
                            {...(unavailable === undefined ? {} : { disabledReason: unavailable })}
                            {...(pairing.error ? { error: pairing.error.message } : {})}
                            {...(pairing.invitation
                                ? {
                                      invitation: {
                                          command: pairing.invitation.command,
                                          invitation: pairing.invitation.invitation,
                                      },
                                  }
                                : {})}
                            {...(pairingProgressView ? { progress: pairingProgressView } : {})}
                        />
                    }
                    transports={transportRows(nodes)}
                    {...(nodes.instanceId ? { hostId: nodes.instanceId } : {})}
                    {...(nodes.name ? { hostName: nodes.name } : {})}
                    {...(nodes.publicKey ? { hostPublicKey: nodes.publicKey } : {})}
                    {...(nodes.error ? { error: nodes.error.message } : {})}
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

/** Every node the host reports, in the order the host reports them. */
function nodeRows(
    nodes: RigNodesSnapshot,
    directory: AppRigDirectorySnapshot,
): readonly RigNodeRow[] {
    // A node whose work this window actually holds is one of the Rigs in the
    // directory, addressed by the identity the host published for it.
    const open = new Set(
        directory.rigs.flatMap((rig) =>
            rig.nodeId !== undefined && rig.session ? [rig.nodeId] : [],
        ),
    );
    // A machine that answered and declined to share its API said so on its own
    // connection, so that fact is read off the Rig the window opened for it
    // rather than off the host's peer status, which cannot know it.
    const restricted = new Set(
        directory.rigs.flatMap((rig) =>
            rig.nodeId !== undefined && rig.accessRestricted === true ? [rig.nodeId] : [],
        ),
    );
    // The host's peer status carries the name it pinned when the two were
    // paired, which a machine renamed since then has outgrown and a machine
    // paired before it had a name never had. The Rig opened for that machine
    // carries what the machine itself last said, so it answers first.
    const named = new Map(
        directory.rigs.flatMap((rig) =>
            rig.nodeId !== undefined && rig.label !== rig.nodeId ? [[rig.nodeId, rig.label]] : [],
        ),
    );
    return nodes.nodes.map((node) => ({
        id: node.key,
        // What the machine calls itself, then what it proved it is, then where
        // it was dialled: a node still being reached has told the host nothing
        // but an address, and pretending otherwise would name it wrongly.
        name:
            (node.peerId === undefined ? undefined : named.get(node.peerId)) ??
            node.name ??
            node.peerId ??
            node.routes[0]?.address ??
            node.key,
        routes: node.routes.map((route) => ({
            address: route.address,
            state: route.status,
            transport: route.transport,
        })),
        state: node.status,
        ...(node.error ? { message: node.error } : {}),
        ...(node.peerId ? { peerId: node.peerId } : {}),
        ...(node.rttMs === undefined ? {} : { rttMs: node.rttMs }),
        ...(node.peerId !== undefined && open.has(node.peerId) ? { workOpen: true } : {}),
        ...(node.peerId !== undefined && restricted.has(node.peerId)
            ? { accessRestricted: true }
            : {}),
    }));
}

/**
 * The pairing under way, in the terms the surface draws.
 *
 * The store's state carries a couple of things the surface has no use for — the
 * pairing's own id and when it expires — so this narrows rather than passes the
 * object through, and the phases stay a closed union on both sides.
 */
function pairingProgress(pairing: RigPairingSnapshot): RigPairingProgress | undefined {
    const state = pairing.state;
    if (!state) return undefined;
    switch (state.phase) {
        case "connecting":
        case "waiting":
            return { phase: state.phase, role: state.role };
        case "verifying":
            return {
                emojis: state.emojis,
                peer: { instanceId: state.peer.instanceId, name: state.peer.name },
                phase: "verifying",
                role: state.role,
            };
        case "connected":
            return {
                peer: { instanceId: state.peer.instanceId, name: state.peer.name },
                phase: "connected",
                role: state.role,
            };
        default:
            return {
                phase: state.phase,
                role: state.role,
                ...(state.error === undefined ? {} : { message: state.error }),
            };
    }
}

/** Each transport the host runs, so an absent node list can explain itself. */
function transportRows(nodes: RigNodesSnapshot): readonly RigNodeTransportRow[] {
    return nodes.transports.map((transport) =>
        transport.state === "ready"
            ? {
                  localAddress: transport.localAddress,
                  state: "ready" as const,
                  transport: transport.transport,
              }
            : {
                  message: transport.error,
                  state: "unavailable" as const,
                  transport: transport.transport,
              },
    );
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
