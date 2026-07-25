import { createStore } from "zustand/vanilla";
import { rigPermissionLabel, rigServiceTierLabel, rigThinkingLabel } from "./rigSupport.js";
import type {
    RigEffortOption,
    RigMenusSnapshot,
    RigModelCatalog,
    RigModelOption,
    RigPermissionMode,
    RigPermissionModeOption,
    RigSelection,
    RigServiceTierOption,
    RigThinkingLevel,
} from "./rigTypes.js";

const PERMISSION_MODES: readonly RigPermissionMode[] = [
    "auto",
    "workspace_write",
    "read_only",
    "full_access",
];

/**
 * Pure derivation of picker options from the model catalog and the current
 * session selection. Kept side-effect free so both the standalone menus store
 * and the chat store can compute the same option lists from their own inputs.
 */
export function rigMenusDerive(
    catalog: RigModelCatalog,
    selection: RigSelection,
): RigMenusSnapshot {
    const modelOptions: RigModelOption[] = [];
    let selectedProvider = catalog.providers.find(
        (provider) => provider.id === selection.providerId,
    );
    for (const provider of catalog.providers) {
        for (const model of provider.models) {
            modelOptions.push({
                providerId: provider.id,
                modelId: model.id,
                name: model.name,
                disabled: provider.disabledReason !== undefined,
                current: provider.id === selection.providerId && model.id === selection.modelId,
            });
        }
    }

    const currentModel = selectedProvider?.models.find((model) => model.id === selection.modelId);
    const effortOptions: RigEffortOption[] = (currentModel?.thinkingLevels ?? []).map(
        (level: RigThinkingLevel): RigEffortOption => ({
            level,
            label: rigThinkingLabel(level),
            current: level === selection.effort,
            isDefault: level === currentModel?.defaultThinkingLevel,
        }),
    );

    const permissionModeOptions: RigPermissionModeOption[] = PERMISSION_MODES.map((mode) => ({
        mode,
        label: rigPermissionLabel(mode),
        current: mode === selection.permissionMode,
    }));

    const supportsFast = selectedProvider?.serviceTiers.includes("fast") ?? false;
    const serviceTierOptions: RigServiceTierOption[] = [
        {
            tier: null,
            label: rigServiceTierLabel(null),
            current: selection.serviceTier === undefined,
        },
        ...(supportsFast
            ? [
                  {
                      tier: "fast" as const,
                      label: rigServiceTierLabel("fast"),
                      current: selection.serviceTier === "fast",
                  },
              ]
            : []),
    ];

    return {
        modelOptions,
        effortOptions,
        permissionModeOptions,
        serviceTierOptions,
        currentProviderId: selection.providerId,
        currentModelId: selection.modelId,
        currentEffort: selection.effort,
        currentPermissionMode: selection.permissionMode,
        currentServiceTier: selection.serviceTier,
    };
}

export interface RigMenusStore {
    get(): RigMenusSnapshot;
    subscribe(listener: () => void): () => void;
    /** Private authoritative input: feed a fresh selection (e.g. from the chat snapshot). */
    menusSelectionUpdate(selection: RigSelection): void;
}

export interface RigMenusStoreOptions {
    readonly catalog: RigModelCatalog;
    readonly selection: RigSelection;
}

/**
 * A standalone picker-options store for a session's model/effort/permission/tier
 * choices. It is a pure derivation of catalog + selection: the owner feeds the
 * current selection through `menusSelectionUpdate`, so nothing is mirrored or
 * fetched here.
 */
export function rigMenusStoreCreate(options: RigMenusStoreOptions): RigMenusStore {
    const catalog = options.catalog;
    const store = createStore<RigMenusSnapshot>()(() => rigMenusDerive(catalog, options.selection));
    return {
        get: () => store.getState(),
        subscribe: (listener) => store.subscribe(listener),
        menusSelectionUpdate(selection) {
            store.setState(rigMenusDerive(catalog, selection), true);
        },
    };
}
