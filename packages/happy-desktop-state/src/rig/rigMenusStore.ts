import { createStore } from "zustand/vanilla";
import {
    referencesPreserve,
    rigPermissionLabel,
    rigServiceTierLabel,
    rigThinkingLabel,
} from "./rigSupport.js";
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

/** Keeps every unchanged picker collection and row stable across a fresh derivation. */
export function rigMenusReferencesPreserve(
    previous: RigMenusSnapshot,
    next: RigMenusSnapshot,
): RigMenusSnapshot {
    const modelOptions = referencesPreserve(previous.modelOptions, next.modelOptions);
    const effortOptions = referencesPreserve(previous.effortOptions, next.effortOptions);
    const permissionModeOptions = referencesPreserve(
        previous.permissionModeOptions,
        next.permissionModeOptions,
    );
    const serviceTierOptions = referencesPreserve(
        previous.serviceTierOptions,
        next.serviceTierOptions,
    );
    if (
        modelOptions === previous.modelOptions &&
        effortOptions === previous.effortOptions &&
        permissionModeOptions === previous.permissionModeOptions &&
        serviceTierOptions === previous.serviceTierOptions &&
        next.currentProviderId === previous.currentProviderId &&
        next.currentModelId === previous.currentModelId &&
        next.currentEffort === previous.currentEffort &&
        next.currentPermissionMode === previous.currentPermissionMode &&
        next.currentServiceTier === previous.currentServiceTier
    )
        return previous;
    return {
        ...next,
        modelOptions,
        effortOptions,
        permissionModeOptions,
        serviceTierOptions,
    };
}

function currentOptionsUpdate<T extends { readonly current: boolean }>(
    options: readonly T[],
    current: (option: T) => boolean,
): readonly T[] {
    let changed = false;
    const next = options.map((option) => {
        const selected = current(option);
        if (option.current === selected) return option;
        changed = true;
        return { ...option, current: selected };
    });
    return changed ? next : options;
}

/** Reprojects one selection while touching only the option family whose current row changed. */
export function rigMenusSelectionProject(
    catalog: RigModelCatalog,
    previous: RigMenusSnapshot,
    selection: RigSelection,
): RigMenusSnapshot {
    if (
        previous.currentProviderId === selection.providerId &&
        previous.currentModelId === selection.modelId &&
        previous.currentEffort === selection.effort &&
        previous.currentPermissionMode === selection.permissionMode &&
        previous.currentServiceTier === selection.serviceTier
    )
        return previous;

    if (
        previous.currentProviderId !== selection.providerId ||
        previous.currentModelId !== selection.modelId
    )
        return rigMenusReferencesPreserve(previous, rigMenusDerive(catalog, selection));

    return {
        ...previous,
        effortOptions:
            previous.currentEffort === selection.effort
                ? previous.effortOptions
                : currentOptionsUpdate(
                      previous.effortOptions,
                      (option) => option.level === selection.effort,
                  ),
        permissionModeOptions:
            previous.currentPermissionMode === selection.permissionMode
                ? previous.permissionModeOptions
                : currentOptionsUpdate(
                      previous.permissionModeOptions,
                      (option) => option.mode === selection.permissionMode,
                  ),
        serviceTierOptions:
            previous.currentServiceTier === selection.serviceTier
                ? previous.serviceTierOptions
                : currentOptionsUpdate(
                      previous.serviceTierOptions,
                      (option) => option.tier === (selection.serviceTier ?? null),
                  ),
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
            const previous = store.getState();
            store.setState(rigMenusSelectionProject(catalog, previous, selection), true);
        },
    };
}
