import type {
    RigModelPreferenceDocument,
    RigModelPreferencePersistence,
    RigPermissionMode,
    RigServiceTier,
    RigSettingsInitial,
    RigSettingsSnapshot,
    RigThinkingLevel,
} from "happy-desktop-state";
import { RIG_DEFAULT_THINKING_LEVEL } from "happy-desktop-state";
import type {
    DesktopConfig,
    DesktopDefaultModel,
    DesktopModelPreference,
    HappyDesktopBridge,
} from "../shared/desktopContract";

const STANDARD_SPEED = "standard";
const THINKING_LEVELS: ReadonlySet<string> = new Set([
    "off",
    "on",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
]);

export interface DesktopModelSettings {
    readonly initialSettings: RigSettingsInitial;
    readonly preferencePersistence: RigModelPreferencePersistence;
    settingsChanged(snapshot: RigSettingsSnapshot): void;
}

/**
 * Adapts the desktop's one JSON document to the two framework-independent state
 * stores that consume it: explicit defaults and per-model picker memory.
 */
export function desktopModelSettingsCreate(
    bridge: HappyDesktopBridge,
    initial: DesktopConfig,
): DesktopModelSettings {
    let config = initial;
    const preferenceListeners = new Set<() => void>();

    const commit = (next: DesktopConfig): void => {
        config = next;
        for (const listener of preferenceListeners) listener();
        // Invoke immediately; the privileged store is the single serialization
        // authority, so every quick selection enters its ordered write queue.
        void bridge.desktopConfigWrite(next).catch((error: unknown) => {
            console.error("Could not save desktop model settings.", error);
        });
    };

    const preferencePersistence: RigModelPreferencePersistence = {
        read: () => preferenceDocument(config),
        write(document) {
            commit(configFromPreferenceDocument(config, document));
        },
        subscribe(listener) {
            preferenceListeners.add(listener);
            return () => preferenceListeners.delete(listener);
        },
    };

    return {
        initialSettings: settingsInitial(config),
        preferencePersistence,
        settingsChanged(snapshot) {
            const nextEffort = snapshot.defaultEffort;
            const nextPermissionMode = snapshot.defaultPermissionMode;
            const nextDefault =
                snapshot.defaultProviderId && snapshot.defaultModelId
                    ? {
                          providerId: snapshot.defaultProviderId,
                          modelId: snapshot.defaultModelId,
                          ...(snapshot.defaultEffort ? { effort: snapshot.defaultEffort } : {}),
                      }
                    : undefined;
            if (
                defaultEqual(config.defaultModel, nextDefault) &&
                config.defaultEffort === nextEffort &&
                config.defaultPermissionMode === nextPermissionMode
            )
                return;

            let modelPreferences = config.modelPreferences;
            if (nextDefault?.effort) {
                const preference = modelPreferences.find(
                    (candidate) =>
                        candidate.providerId === nextDefault.providerId &&
                        candidate.modelId === nextDefault.modelId,
                );
                const updated: DesktopModelPreference = {
                    providerId: nextDefault.providerId,
                    modelId: nextDefault.modelId,
                    lastEffort: nextDefault.effort,
                    lastSpeed: preference?.lastSpeed ?? STANDARD_SPEED,
                };
                modelPreferences = [
                    ...modelPreferences.filter(
                        (candidate) =>
                            candidate.providerId !== nextDefault.providerId ||
                            candidate.modelId !== nextDefault.modelId,
                    ),
                    updated,
                ];
            }
            commit({
                defaultEffort: nextEffort,
                ...(nextDefault ? { defaultModel: nextDefault } : {}),
                defaultPermissionMode: nextPermissionMode,
                ...(nextDefault
                    ? {
                          lastPickedModel: {
                              providerId: nextDefault.providerId,
                              modelId: nextDefault.modelId,
                          },
                      }
                    : config.lastPickedModel
                      ? { lastPickedModel: config.lastPickedModel }
                      : {}),
                modelPreferences,
                version: 1,
            });
        },
    };
}

function settingsInitial(config: DesktopConfig): RigSettingsInitial {
    const effort =
        thinkingLevel(config.defaultEffort) ??
        thinkingLevel(config.defaultModel?.effort) ??
        RIG_DEFAULT_THINKING_LEVEL;
    return {
        ...(config.defaultModel
            ? {
                  defaultProviderId: config.defaultModel.providerId,
                  defaultModelId: config.defaultModel.modelId,
              }
            : {}),
        defaultEffort: effort,
        defaultPermissionMode: permissionMode(config.defaultPermissionMode),
    };
}

function preferenceDocument(config: DesktopConfig): RigModelPreferenceDocument {
    const preferences: {
        [providerId: string]: {
            [modelId: string]: {
                effort: RigThinkingLevel | null;
                serviceTier: RigServiceTier | null;
            };
        };
    } = {};
    for (const preference of config.modelPreferences) {
        const provider = preferences[preference.providerId] ?? {};
        provider[preference.modelId] = {
            effort: thinkingLevel(preference.lastEffort) ?? null,
            serviceTier: preference.lastSpeed === "fast" ? "fast" : null,
        };
        preferences[preference.providerId] = provider;
    }
    const defaultEffort = thinkingLevel(config.defaultModel?.effort);
    return {
        defaultEffort: thinkingLevel(config.defaultEffort) ?? RIG_DEFAULT_THINKING_LEVEL,
        ...(config.defaultModel
            ? {
                  defaultSelection: {
                      providerId: config.defaultModel.providerId,
                      modelId: config.defaultModel.modelId,
                      ...(defaultEffort ? { effort: defaultEffort } : {}),
                  },
              }
            : {}),
        ...(config.lastPickedModel ? { lastPickedModel: config.lastPickedModel } : {}),
        defaultPermissionMode: permissionMode(config.defaultPermissionMode),
        preferences,
    };
}

function configFromPreferenceDocument(
    current: DesktopConfig,
    document: RigModelPreferenceDocument,
): DesktopConfig {
    const modelPreferences: DesktopModelPreference[] = [];
    for (const [providerId, models] of Object.entries(document.preferences)) {
        if (!models) continue;
        for (const [modelId, preference] of Object.entries(models)) {
            if (!preference) continue;
            modelPreferences.push({
                providerId,
                modelId,
                ...(preference.effort ? { lastEffort: preference.effort } : {}),
                lastSpeed: preference.serviceTier ?? STANDARD_SPEED,
            });
        }
    }
    modelPreferences.sort(
        (left, right) =>
            left.providerId.localeCompare(right.providerId) ||
            left.modelId.localeCompare(right.modelId),
    );
    return {
        defaultEffort: document.defaultEffort ?? current.defaultEffort,
        ...(document.defaultSelection
            ? {
                  defaultModel: {
                      providerId: document.defaultSelection.providerId,
                      modelId: document.defaultSelection.modelId,
                      ...(document.defaultSelection.effort
                          ? { effort: document.defaultSelection.effort }
                          : {}),
                  },
              }
            : current.defaultModel
              ? { defaultModel: current.defaultModel }
              : {}),
        ...(document.lastPickedModel ? { lastPickedModel: document.lastPickedModel } : {}),
        defaultPermissionMode: current.defaultPermissionMode,
        modelPreferences,
        version: 1,
    };
}

function thinkingLevel(value: string | undefined): RigThinkingLevel | undefined {
    return value && THINKING_LEVELS.has(value) ? (value as RigThinkingLevel) : undefined;
}

function permissionMode(value: string | undefined): RigPermissionMode {
    switch (value) {
        case "workspace_write":
        case "read_only":
        case "full_access":
            return value;
        default:
            return "auto";
    }
}

function defaultEqual(
    left: DesktopDefaultModel | undefined,
    right: DesktopDefaultModel | undefined,
): boolean {
    return (
        left?.providerId === right?.providerId &&
        left?.modelId === right?.modelId &&
        left?.effort === right?.effort
    );
}
