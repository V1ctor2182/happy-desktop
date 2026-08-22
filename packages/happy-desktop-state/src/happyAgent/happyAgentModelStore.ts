import { UserError } from "../types.js";
import { happyAgentMenusDerive } from "./happyAgentMenusStore.js";
import {
    happyAgentSelectionModelUpdate,
    happyAgentSessionSelectionDefault,
} from "./happyAgentSessionDraftStore.js";
import type {
    HappyAgentMenusSnapshot,
    HappyAgentModelCatalog,
    HappyAgentSelection,
} from "./happyAgentTypes.js";
import type {
    HappyAgentModelSelection,
    HappyAgentPermissionMode,
    HappyAgentServiceTier,
    HappyAgentThinkingLevel,
} from "./happyAgentTypes.js";

export interface HappyAgentModelPreference {
    readonly effort?: HappyAgentThinkingLevel | null;
    readonly serviceTier?: HappyAgentServiceTier | null;
}

export interface HappyAgentModelPreferences {
    readonly [providerId: string]:
        | {
              readonly [modelId: string]: HappyAgentModelPreference | undefined;
          }
        | undefined;
}

export interface HappyAgentModelPreferenceIdentity {
    readonly providerId: string;
    readonly modelId: string;
}

export interface HappyAgentModelPreferenceDefault extends HappyAgentModelPreferenceIdentity {
    readonly effort?: HappyAgentThinkingLevel;
}

/** Complete machine-local model choices supplied by the desktop host. */
export interface HappyAgentModelPreferenceDocument {
    readonly defaultSelection?: HappyAgentModelPreferenceDefault;
    /** Reasoning level configured for new sessions before a model-specific fallback. */
    readonly defaultEffort?: HappyAgentThinkingLevel;
    /** Access mode configured for a new session, independent of its model. */
    readonly defaultPermissionMode?: HappyAgentPermissionMode;
    readonly lastPickedModel?: HappyAgentModelPreferenceIdentity;
    readonly preferences: HappyAgentModelPreferences;
}

export interface HappyAgentModelPreferencePersistence {
    read(): HappyAgentModelPreferenceDocument | undefined;
    write(document: HappyAgentModelPreferenceDocument): void;
    /** Reports a replacement written through another store sharing this host document. */
    subscribe?(listener: () => void): () => void;
}

export type HappyAgentModelStoreSnapshot =
    | { readonly type: "loading" }
    | { readonly type: "error"; readonly error: UserError }
    | {
          readonly type: "ready";
          readonly catalog: HappyAgentModelCatalog;
          readonly defaultSelection: HappyAgentSelection;
          readonly lastUsedSelection: HappyAgentSelection;
          readonly menus: HappyAgentMenusSnapshot;
      };

export type HappyAgentModelStoreReadySnapshot = Extract<
    HappyAgentModelStoreSnapshot,
    { type: "ready" }
>;

/**
 * One daemon connection's model authority. It loads the immutable catalog once,
 * exposes model capabilities/defaults, and retains the complete selection most
 * recently chosen anywhere in that connection.
 */
export interface HappyAgentModelStore {
    get(): HappyAgentModelStoreSnapshot;
    subscribe(listener: () => void): () => void;
    /** Loads or joins the one in-flight catalog request. A failed explicit retry starts anew. */
    load(): Promise<HappyAgentModelStoreReadySnapshot>;
    /** Records a user-selected model/effort/access/tier as the next-session default. */
    selectionUsed(selection: HappyAgentSelection): void;
    /** Selects a model with that model's last locally remembered effort and speed. */
    modelSelect(current: HappyAgentSelection, input: HappyAgentModelSelection): HappyAgentSelection;
    [Symbol.dispose](): void;
}

export interface HappyAgentModelStoreOptions {
    readonly catalogRead: () => Promise<HappyAgentModelCatalog>;
    readonly preferencePersistence?: HappyAgentModelPreferencePersistence;
}

/**
 * The catalog read's failure as something a surface can show, without losing
 * what actually refused.
 *
 * The cause travels because a refusal carries meaning its sentence does not: a
 * daemon answering "this route is not shared" is a machine deliberately keeping
 * its work to itself, and a caller telling that apart from a broken one reads
 * the original rather than parsing this wording.
 */
function modelError(error: unknown): UserError {
    if (error instanceof UserError) return error;
    return new UserError(
        error instanceof Error ? error.message : "Could not load Happy Agent models.",
        undefined,
        error,
    );
}

/** Creates the daemon-lifetime model store without opening transport work. */
export function happyAgentModelStoreCreate(
    options: HappyAgentModelStoreOptions,
): HappyAgentModelStore {
    const listeners = new Set<() => void>();
    let snapshot: HappyAgentModelStoreSnapshot = { type: "loading" };
    let loadPromise: Promise<HappyAgentModelStoreReadySnapshot> | undefined;
    let document: HappyAgentModelPreferenceDocument = { preferences: {} };
    let preferences = document.preferences;
    let preferenceUnsubscribe: (() => void) | undefined;
    let writingPreferences = false;

    const publish = (next: HappyAgentModelStoreSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const preferencesReconcile = (): void => {
        if (writingPreferences) return;
        document = options.preferencePersistence?.read() ?? { preferences: {} };
        preferences = document.preferences;
        if (snapshot.type !== "ready") return;
        const selections = selectionsFromDocument(snapshot.catalog, document, snapshot);
        publish({
            ...snapshot,
            ...selections,
            menus: happyAgentMenusDerive(snapshot.catalog, selections.lastUsedSelection),
        });
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        load() {
            document = options.preferencePersistence?.read() ?? document;
            preferences = document.preferences;
            preferenceUnsubscribe ??=
                options.preferencePersistence?.subscribe?.(preferencesReconcile);
            if (snapshot.type === "ready") return Promise.resolve(snapshot);
            if (loadPromise) return loadPromise;
            if (snapshot.type === "error") publish({ type: "loading" });
            loadPromise = options.catalogRead().then(
                (catalog) => {
                    document = options.preferencePersistence?.read() ?? document;
                    preferences = document.preferences;
                    const selections = selectionsFromDocument(catalog, document);
                    const ready: HappyAgentModelStoreReadySnapshot = {
                        type: "ready",
                        catalog,
                        ...selections,
                        menus: happyAgentMenusDerive(catalog, selections.lastUsedSelection),
                    };
                    publish(ready);
                    loadPromise = undefined;
                    return ready;
                },
                (error: unknown) => {
                    const failure = modelError(error);
                    publish({ type: "error", error: failure });
                    loadPromise = undefined;
                    throw failure;
                },
            );
            return loadPromise;
        },
        selectionUsed(selection) {
            if (snapshot.type !== "ready") return;
            const provider = preferences[selection.providerId] ?? {};
            preferences = {
                ...preferences,
                [selection.providerId]: {
                    ...provider,
                    [selection.modelId]: {
                        effort: selection.effort ?? null,
                        serviceTier: selection.serviceTier ?? null,
                    },
                },
            };
            document = {
                ...document,
                lastPickedModel: {
                    providerId: selection.providerId,
                    modelId: selection.modelId,
                },
                preferences,
            };
            writingPreferences = true;
            try {
                options.preferencePersistence?.write(document);
            } finally {
                writingPreferences = false;
            }
            publish({
                ...snapshot,
                lastUsedSelection: selection,
                menus: happyAgentMenusDerive(snapshot.catalog, selection),
            });
        },
        modelSelect(current, input) {
            if (snapshot.type !== "ready")
                return happyAgentSelectionModelUpdateWithoutPreferences(snapshot, current, input);
            const selected = happyAgentSelectionModelUpdateWithoutPreferences(
                snapshot,
                current,
                input,
            );
            const preference = preferences[selected.providerId]?.[selected.modelId];
            const provider = snapshot.catalog.providers.find(
                (candidate) => candidate.id === selected.providerId,
            );
            const model = provider?.models.find((candidate) => candidate.id === selected.modelId);
            const effort =
                preference?.effort && model?.thinkingLevels.includes(preference.effort)
                    ? preference.effort
                    : selected.effort;
            const serviceTier =
                preference?.serviceTier === null
                    ? undefined
                    : preference?.serviceTier &&
                        provider?.serviceTiers.includes(preference.serviceTier)
                      ? preference.serviceTier
                      : selected.serviceTier;
            return {
                providerId: selected.providerId,
                modelId: selected.modelId,
                ...(effort !== undefined ? { effort } : {}),
                permissionMode: selected.permissionMode,
                ...(serviceTier !== undefined ? { serviceTier } : {}),
            };
        },
        [Symbol.dispose]() {
            preferenceUnsubscribe?.();
            listeners.clear();
        },
    };
}

function selectionsFromDocument(
    catalog: HappyAgentModelCatalog,
    document: HappyAgentModelPreferenceDocument,
    current?: HappyAgentModelStoreReadySnapshot,
): Pick<HappyAgentModelStoreReadySnapshot, "defaultSelection" | "lastUsedSelection"> {
    const catalogDefault = happyAgentSessionSelectionDefault(catalog);
    const catalogDefaultModel = catalog.providers
        .find((provider) => provider.id === catalogDefault.providerId)
        ?.models.find((model) => model.id === catalogDefault.modelId);
    const catalogDefaultEffort =
        document.defaultEffort &&
        catalogDefaultModel?.thinkingLevels.includes(document.defaultEffort)
            ? document.defaultEffort
            : catalogDefault.effort;
    const defaultPermissionMode =
        document.defaultPermissionMode ??
        current?.defaultSelection.permissionMode ??
        catalogDefault.permissionMode;
    const catalogSelection = {
        ...catalogDefault,
        ...(catalogDefaultEffort !== undefined ? { effort: catalogDefaultEffort } : {}),
        permissionMode: defaultPermissionMode,
    };
    const defaultSelection =
        preferenceSelection(
            catalog,
            document.defaultSelection,
            document.preferences,
            defaultPermissionMode,
            document.defaultEffort,
        ) ?? catalogSelection;
    const lastUsedSelection =
        preferenceSelection(
            catalog,
            document.lastPickedModel,
            document.preferences,
            document.defaultPermissionMode ??
                current?.lastUsedSelection.permissionMode ??
                defaultSelection.permissionMode,
        ) ?? defaultSelection;
    return { defaultSelection, lastUsedSelection };
}

function preferenceSelection(
    catalog: HappyAgentModelCatalog,
    identity: HappyAgentModelPreferenceIdentity | undefined,
    preferences: HappyAgentModelPreferences,
    permissionMode: HappyAgentSelection["permissionMode"],
    defaultEffort?: HappyAgentThinkingLevel,
): HappyAgentSelection | undefined {
    if (!identity) return undefined;
    const provider = catalog.providers.find((candidate) => candidate.id === identity.providerId);
    const model = provider?.models.find((candidate) => candidate.id === identity.modelId);
    if (!provider || provider.disabledReason !== undefined || !model) return undefined;
    const candidateEffort =
        "effort" in identity ? (identity as HappyAgentModelPreferenceDefault).effort : undefined;
    const explicitEffort =
        candidateEffort && model.thinkingLevels.includes(candidateEffort)
            ? candidateEffort
            : undefined;
    const preference = preferences[identity.providerId]?.[identity.modelId];
    const rememberedEffort =
        preference?.effort && model.thinkingLevels.includes(preference.effort)
            ? preference.effort
            : undefined;
    const supportedDefaultEffort =
        defaultEffort && model.thinkingLevels.includes(defaultEffort) ? defaultEffort : undefined;
    const serviceTier =
        preference?.serviceTier && provider.serviceTiers.includes(preference.serviceTier)
            ? preference.serviceTier
            : undefined;
    return {
        providerId: identity.providerId,
        modelId: identity.modelId,
        effort:
            explicitEffort ??
            supportedDefaultEffort ??
            rememberedEffort ??
            model.defaultThinkingLevel,
        permissionMode,
        ...(serviceTier !== undefined ? { serviceTier } : {}),
    };
}

function happyAgentSelectionModelUpdateWithoutPreferences(
    snapshot: HappyAgentModelStoreSnapshot,
    current: HappyAgentSelection,
    input: HappyAgentModelSelection,
): HappyAgentSelection {
    if (snapshot.type !== "ready") return current;
    return happyAgentSelectionModelUpdate(snapshot.catalog, current, input);
}
