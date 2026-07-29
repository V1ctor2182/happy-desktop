import type { RigPermissionMode, RigThinkingLevel } from "./rigTypes.js";

declare const rigModelKeyBrand: unique symbol;

/**
 * One model inside one provider, as `${providerId}:${modelId}`. The catalog
 * reuses a model id across providers, so neither half identifies a row on its
 * own and a plain string would silently address the wrong provider's copy.
 */
export type RigModelKey = string & { readonly [rigModelKeyBrand]: true };

export function rigModelKey(providerId: string, modelId: string): RigModelKey {
    return `${providerId}:${modelId}` as RigModelKey;
}

export interface RigSettingsSnapshot {
    /** Unset until the reader picks a model; the catalog's own default stands in. */
    readonly defaultProviderId?: string;
    readonly defaultModelId?: string;
    readonly defaultEffort?: RigThinkingLevel;
    readonly defaultPermissionMode?: RigPermissionMode;
    /** Models switched off for this workspace. Absent from the set means enabled. */
    readonly disabledModels: ReadonlySet<RigModelKey>;
}

/**
 * The local workspace's own preferences: which model a new session starts on and
 * which of the catalog's models the pickers are allowed to offer. It is the
 * reader's selection, not the daemon's — the daemon has no preference API yet, so
 * this store is deliberately memory-only and never claims a saved or
 * server-confirmed state.
 */
export interface RigSettingsStore {
    get(): RigSettingsSnapshot;
    subscribe(listener: () => void): () => void;
    /** Chooses the model a new session starts on, together with its provider. */
    defaultModelUpdate(providerId: string, modelId: string): void;
    defaultEffortUpdate(effort: RigThinkingLevel): void;
    defaultPermissionModeUpdate(mode: RigPermissionMode): void;
    /** Offers or withholds one model in the session pickers. */
    modelEnabledUpdate(key: RigModelKey, enabled: boolean): void;
}

const EMPTY_DISABLED: ReadonlySet<RigModelKey> = new Set<RigModelKey>();

/** Creates the workspace-lifetime preference store; it opens no transport or timers. */
export function rigSettingsStoreCreate(): RigSettingsStore {
    const listeners = new Set<() => void>();
    let snapshot: RigSettingsSnapshot = { disabledModels: EMPTY_DISABLED };

    const publish = (next: RigSettingsSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        defaultModelUpdate(providerId, modelId) {
            if (snapshot.defaultProviderId === providerId && snapshot.defaultModelId === modelId)
                return;
            // The effort levels are the model's own, so a level chosen for the
            // previous model cannot be carried onto a model that lacks it.
            const { defaultEffort: _dropped, ...rest } = snapshot;
            publish({ ...rest, defaultProviderId: providerId, defaultModelId: modelId });
        },
        defaultEffortUpdate(effort) {
            if (snapshot.defaultEffort === effort) return;
            publish({ ...snapshot, defaultEffort: effort });
        },
        defaultPermissionModeUpdate(mode) {
            if (snapshot.defaultPermissionMode === mode) return;
            publish({ ...snapshot, defaultPermissionMode: mode });
        },
        modelEnabledUpdate(key, enabled) {
            if (snapshot.disabledModels.has(key) === !enabled) return;
            const disabledModels = new Set(snapshot.disabledModels);
            if (enabled) disabledModels.delete(key);
            else disabledModels.add(key);
            publish({ ...snapshot, disabledModels });
        },
    };
}
