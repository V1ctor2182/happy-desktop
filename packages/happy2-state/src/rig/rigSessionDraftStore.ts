import { createStore } from "zustand/vanilla";
import { rigMenusDerive } from "./rigMenusStore.js";
import type {
    RigMenusSnapshot,
    RigModelCatalog,
    RigModelSelection,
    RigPermissionMode,
    RigSelection,
    RigServiceTier,
    RigThinkingLevel,
} from "./rigTypes.js";

/**
 * How a session that does not exist yet is configured, plus the picker options
 * that configuration derives. `menus` is a pure derivation of `selection`, not a
 * second copy of it: the two can never disagree because only one is stored.
 */
export interface RigSessionDraftSnapshot {
    readonly selection: RigSelection;
    readonly menus: RigMenusSnapshot;
}

/**
 * The model, effort, access mode, and service tier a session will be created
 * with. It exists so those choices can be made before the first message rather
 * than discovered afterwards: until a session exists there is no chat store to
 * own them, and creating one just to hold a preference would leave an empty
 * session behind every time somebody opened a project to look around.
 */
export interface RigSessionDraftStore {
    get(): RigSessionDraftSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Selects a model, and with it the provider that offers it. Effort follows
     * the new model's own default rather than carrying over a level the model
     * may not support, and a service tier the new provider does not offer is
     * dropped for the same reason.
     */
    modelUpdate(input: RigModelSelection): void;
    effortUpdate(effort?: RigThinkingLevel): void;
    permissionModeUpdate(permissionMode: RigPermissionMode): void;
    serviceTierUpdate(serviceTier?: RigServiceTier): void;
}

export interface RigSessionDraftOptions {
    readonly catalog: RigModelCatalog;
    /**
     * What to open the draft on — the workspace's most recent selection, so a
     * new session starts configured the way the last one was. Absent for the
     * first draft of a session, which falls back to the catalog's own defaults.
     */
    readonly selection?: RigSelection;
}

/**
 * The access mode a local session starts in. It matches what the desktop proxy
 * applies when a create request names no mode, so the picker and the request
 * agree instead of the picker showing one thing and creation doing another.
 */
const DEFAULT_PERMISSION_MODE: RigPermissionMode = "auto";

/**
 * The selection a draft opens on when the workspace has no previous one: the
 * catalog's declared default model at that model's own default effort.
 *
 * A catalog whose declared default names a model it does not list is a broken
 * catalog, but it is not worth refusing to start a session over — the daemon
 * still applies its own default. The first listed model of the first usable
 * provider stands in, so the pickers open on something real rather than on a
 * model id that does not exist.
 */
export function rigSessionSelectionDefault(catalog: RigModelCatalog): RigSelection {
    const declared = catalog.providers.find(
        (provider) => provider.id === catalog.defaultProviderId,
    );
    const declaredModel = declared?.models.find((model) => model.id === catalog.defaultModelId);
    const provider =
        declaredModel !== undefined
            ? declared
            : catalog.providers.find(
                  (candidate) =>
                      candidate.disabledReason === undefined && candidate.models.length > 0,
              );
    const model = declaredModel ?? provider?.models[0];
    return {
        providerId: provider?.id ?? catalog.defaultProviderId,
        modelId: model?.id ?? catalog.defaultModelId,
        ...(model ? { effort: model.defaultThinkingLevel } : {}),
        permissionMode: DEFAULT_PERMISSION_MODE,
    };
}

/**
 * Holds one pending session configuration. The catalog arrives already resolved,
 * so the constructor opens no transport work and the same concrete store backs
 * the empty-project composer, the create dialog, Blueprint, and tests.
 *
 * Every action is a synchronous local mutation of this store alone. Nothing here
 * reaches a daemon: a draft is what the reader has chosen, and it becomes real
 * only when whoever owns this store reads `selection` and creates a session with
 * it.
 */
export function rigSessionDraftStoreCreate(options: RigSessionDraftOptions): RigSessionDraftStore {
    const catalog = options.catalog;
    const seed = options.selection ?? rigSessionSelectionDefault(catalog);
    const snapshotOf = (selection: RigSelection): RigSessionDraftSnapshot => ({
        selection,
        menus: rigMenusDerive(catalog, selection),
    });
    const store = createStore<RigSessionDraftSnapshot>()(() => snapshotOf(seed));
    const selectionSet = (selection: RigSelection): void => {
        store.setState(snapshotOf(selection), true);
    };

    return {
        get: () => store.getState(),
        subscribe: (listener) => store.subscribe(listener),

        modelUpdate(input) {
            const current = store.getState().selection;
            // A model names its provider only when the caller knows it; the
            // catalog is the authority on which provider actually offers it.
            const providerId =
                input.providerId ??
                catalog.providers.find((provider) =>
                    provider.models.some((model) => model.id === input.modelId),
                )?.id ??
                current.providerId;
            const provider = catalog.providers.find((candidate) => candidate.id === providerId);
            const model = provider?.models.find((candidate) => candidate.id === input.modelId);
            const effort = input.effort ?? model?.defaultThinkingLevel;
            const tierSupported =
                current.serviceTier === undefined ||
                (provider?.serviceTiers.includes(current.serviceTier) ?? false);
            selectionSet({
                providerId,
                modelId: input.modelId,
                ...(effort !== undefined ? { effort } : {}),
                permissionMode: current.permissionMode,
                ...(tierSupported && current.serviceTier !== undefined
                    ? { serviceTier: current.serviceTier }
                    : {}),
            });
        },

        effortUpdate(effort) {
            const current = store.getState().selection;
            selectionSet({
                providerId: current.providerId,
                modelId: current.modelId,
                ...(effort !== undefined ? { effort } : {}),
                permissionMode: current.permissionMode,
                ...(current.serviceTier !== undefined ? { serviceTier: current.serviceTier } : {}),
            });
        },

        permissionModeUpdate(permissionMode) {
            const current = store.getState().selection;
            selectionSet({ ...current, permissionMode });
        },

        serviceTierUpdate(serviceTier) {
            const current = store.getState().selection;
            selectionSet({
                providerId: current.providerId,
                modelId: current.modelId,
                ...(current.effort !== undefined ? { effort: current.effort } : {}),
                permissionMode: current.permissionMode,
                ...(serviceTier !== undefined ? { serviceTier } : {}),
            });
        },
    };
}
