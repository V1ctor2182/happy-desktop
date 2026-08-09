import { useSyncExternalStore } from "react";
import type {
    AppearanceStore,
    ExperimentsStore,
    RigNodesSnapshot,
    RigPairingSnapshot,
    RigInstructionsSnapshot,
    RigSecretsSnapshot,
    RigSecurityPolicySnapshot,
    RigModelCatalog,
    RigModelKey,
    RigPermissionMode,
    RigProfilesStore,
    RigSettingsSnapshot,
    RigSecretsStore,
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
    rigProfilesStoreNoop,
    rigProviderUsageStoreNoop,
    rigSecretsStoreNoop,
    rigWindowStoreNoop,
    titleShimmerStoreNoop,
} from "happy-desktop-state";
import {
    RigGeneralSettings,
    RigDebugSettings,
    RigInstructionsSettings,
    RigNodeSettings,
    RigPairing,
    RigProviderSettings,
    RigProfilesSettings,
    RigSecretsSettings,
    RigSettingsShell,
    RigUsageSettings,
    type RigNodeRow,
    type RigNodeTransportRow,
    type RigPairingProgress,
    type RigProviderRow,
    type RigSecretEditor,
    type RigSecretRow,
    type RigSettingsCategory,
} from "happy-desktop-ui";
import type { SelectOption } from "happy-desktop-ui";
import { hostRig, type AppRigDirectorySnapshot, type AppRigDirectoryStore } from "../AppRigView";

/** The categories the local settings window offers, in the order they are listed. */
export const RIG_SETTINGS_CATEGORIES: readonly RigSettingsCategory[] = [
    { icon: "settings", id: "general", label: "General" },
    { icon: "code", id: "debug", label: "Dev Tools" },
    { icon: "users", id: "profiles", label: "Profiles" },
    { icon: "doc", id: "instructions", label: "Instructions" },
    { icon: "link", id: "nodes", label: "Nodes" },
    { icon: "globe", id: "providers", label: "Providers" },
    { icon: "lock", id: "secrets", label: "Secrets" },
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

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    debug: "Start, stop, and copy live debugger endpoints for Happy and Rig",
    general: "How this window looks and what a new session starts with",
    profiles: "Who this host says is sending work to another Rig",
    instructions: "Machine-wide agent guidance and permission-review policy",
    nodes: "Machines this Rig is peered with, and how it reaches them",
    providers: "Every model provider this Rig daemon knows about",
    secrets: "Environment values this machine gives to the commands its agents run",
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
    debug?: AppRigDebugStore;
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
    // The registry is read while this category is the one on screen and not
    // otherwise: subscribing is what starts the reading cycle, and leaving the
    // category stops it.
    const secretsStore =
        (props.section === "secrets" ? host?.session?.secrets : undefined) ?? rigSecretsStoreNoop;
    const secrets = useSyncExternalStore(
        secretsStore.subscribe,
        secretsStore.get,
        secretsStore.get,
    );
    const windowStateStore = props.windowState ?? rigWindowStoreNoop;
    const windowState = useSyncExternalStore(
        windowStateStore.subscribe,
        windowStateStore.get,
        windowStateStore.get,
    );
    const debugStore = (props.section === "debug" ? props.debug : undefined) ?? debugStoreNoop;
    const debug = useSyncExternalStore(debugStore.subscribe, debugStore.get, debugStore.get);
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
            ) : props.section === "secrets" ? (
                <RigSecretsSettings
                    onSecretCreate={() => {
                        secretsStore.secretCreateStart();
                    }}
                    onSecretEdit={(id) => {
                        secretsStore.secretEditStart(id);
                    }}
                    onSecretRemoveCancel={() => {
                        secretsStore.secretRemoveCancel();
                    }}
                    onSecretRemoveConfirm={() => {
                        if (rigOnline()) secretsStore.secretRemoveConfirm();
                    }}
                    onSecretRemoveStart={(id) => {
                        secretsStore.secretRemoveStart(id);
                    }}
                    loading={secrets.loading}
                    secrets={secretRows(secrets)}
                    {...(secrets.editor ? { editor: secretEditor(secretsStore) } : {})}
                    {...(secrets.error ? { error: secrets.error.message } : {})}
                    {...(secrets.removeError ? { removeError: secrets.removeError.message } : {})}
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

/** Every secret bundle this Rig holds, with whichever row is being removed. */
function secretRows(secrets: RigSecretsSnapshot): readonly RigSecretRow[] {
    return secrets.secrets.map((secret) => ({
        id: secret.id,
        description: secret.description,
        variables: secret.environmentVariables,
        ...(secrets.removingId === secret.id
            ? { confirmingRemove: true, removing: secrets.removing }
            : {}),
    }));
}

/**
 * The open form, bound to the store that holds it. Read from the store's
 * current snapshot rather than from the one this render closed over, so a
 * handler kept from an earlier render still acts on what the form now says.
 */
function secretEditor(store: RigSecretsStore): RigSecretEditor {
    const editor = store.get().editor;
    return {
        mode: editor?.mode ?? "create",
        secretId: editor?.secretId ?? "",
        description: editor?.description ?? "",
        variables: editor?.variables ?? [],
        saving: editor?.saving ?? false,
        onIdChange: (value) => {
            store.secretIdUpdate(value);
        },
        onDescriptionChange: (value) => {
            store.secretDescriptionUpdate(value);
        },
        onVariableNameChange: (key, value) => {
            store.secretVariableNameUpdate(key, value);
        },
        onVariableValueChange: (key, value) => {
            store.secretVariableValueUpdate(key, value);
        },
        onVariableRemove: (key) => {
            store.secretVariableRemove(key);
        },
        onVariableAdd: () => {
            store.secretVariableAdd();
        },
        onSave: () => {
            store.secretSave();
        },
        onCancel: () => {
            store.secretEditCancel();
        },
        ...(editor?.saveError ? { error: editor.saveError.message } : {}),
    };
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
