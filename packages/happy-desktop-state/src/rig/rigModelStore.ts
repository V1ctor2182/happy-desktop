import { UserError } from "../types.js";
import { rigMenusDerive } from "./rigMenusStore.js";
import { rigSelectionModelUpdate, rigSessionSelectionDefault } from "./rigSessionDraftStore.js";
import type { RigMenusSnapshot, RigModelCatalog, RigSelection } from "./rigTypes.js";
import type {
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigThinkingLevel,
} from "./rigTypes.js";

export interface RigModelPreference {
    readonly effort?: RigThinkingLevel | null;
    readonly serviceTier?: RigServiceTier | null;
}

export interface RigModelPreferences {
    readonly [providerId: string]:
        | {
              readonly [modelId: string]: RigModelPreference | undefined;
          }
        | undefined;
}

export interface RigModelPreferenceIdentity {
    readonly providerId: string;
    readonly modelId: string;
}

export interface RigModelPreferenceDefault extends RigModelPreferenceIdentity {
    readonly effort?: RigThinkingLevel;
}

/** Complete machine-local model choices supplied by the desktop host. */
export interface RigModelPreferenceDocument {
    readonly defaultSelection?: RigModelPreferenceDefault;
    /** Reasoning level configured for new sessions before a model-specific fallback. */
    readonly defaultEffort?: RigThinkingLevel;
    /** Access mode configured for a new session, independent of its model. */
    readonly defaultPermissionMode?: RigPermissionMode;
    readonly lastPickedModel?: RigModelPreferenceIdentity;
    readonly preferences: RigModelPreferences;
}

export interface RigModelPreferencePersistence {
    read(): RigModelPreferenceDocument | undefined;
    write(document: RigModelPreferenceDocument): void;
    /** Reports a replacement written through another store sharing this host document. */
    subscribe?(listener: () => void): () => void;
}

export type RigModelStoreSnapshot =
    | { readonly type: "loading" }
    | { readonly type: "error"; readonly error: UserError }
    | {
          readonly type: "ready";
          readonly catalog: RigModelCatalog;
          readonly defaultSelection: RigSelection;
          readonly lastUsedSelection: RigSelection;
          readonly menus: RigMenusSnapshot;
      };

export type RigModelStoreReadySnapshot = Extract<RigModelStoreSnapshot, { type: "ready" }>;

/**
 * One daemon connection's model authority. It loads the immutable catalog once,
 * exposes model capabilities/defaults, and retains the complete selection most
 * recently chosen anywhere in that connection.
 */
export interface RigModelStore {
    get(): RigModelStoreSnapshot;
    subscribe(listener: () => void): () => void;
    /** Loads or joins the one in-flight catalog request. A failed explicit retry starts anew. */
    load(): Promise<RigModelStoreReadySnapshot>;
    /** Records a user-selected model/effort/access/tier as the next-session default. */
    selectionUsed(selection: RigSelection): void;
    /** Selects a model with that model's last locally remembered effort and speed. */
    modelSelect(current: RigSelection, input: RigModelSelection): RigSelection;
    [Symbol.dispose](): void;
}

export interface RigModelStoreOptions {
    readonly catalogRead: () => Promise<RigModelCatalog>;
    readonly preferencePersistence?: RigModelPreferencePersistence;
}

function modelError(error: unknown): UserError {
    if (error instanceof UserError) return error;
    return new UserError(error instanceof Error ? error.message : "Could not load Rig models.");
}

/** Creates the daemon-lifetime model store without opening transport work. */
export function rigModelStoreCreate(options: RigModelStoreOptions): RigModelStore {
    const listeners = new Set<() => void>();
    let snapshot: RigModelStoreSnapshot = { type: "loading" };
    let loadPromise: Promise<RigModelStoreReadySnapshot> | undefined;
    let document: RigModelPreferenceDocument = { preferences: {} };
    let preferences = document.preferences;
    let preferenceUnsubscribe: (() => void) | undefined;
    let writingPreferences = false;

    const publish = (next: RigModelStoreSnapshot): void => {
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
            menus: rigMenusDerive(snapshot.catalog, selections.lastUsedSelection),
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
                    const ready: RigModelStoreReadySnapshot = {
                        type: "ready",
                        catalog,
                        ...selections,
                        menus: rigMenusDerive(catalog, selections.lastUsedSelection),
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
                menus: rigMenusDerive(snapshot.catalog, selection),
            });
        },
        modelSelect(current, input) {
            if (snapshot.type !== "ready")
                return rigSelectionModelUpdateWithoutPreferences(snapshot, current, input);
            const selected = rigSelectionModelUpdateWithoutPreferences(snapshot, current, input);
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
    catalog: RigModelCatalog,
    document: RigModelPreferenceDocument,
    current?: RigModelStoreReadySnapshot,
): Pick<RigModelStoreReadySnapshot, "defaultSelection" | "lastUsedSelection"> {
    const catalogDefault = rigSessionSelectionDefault(catalog);
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
    catalog: RigModelCatalog,
    identity: RigModelPreferenceIdentity | undefined,
    preferences: RigModelPreferences,
    permissionMode: RigSelection["permissionMode"],
    defaultEffort?: RigThinkingLevel,
): RigSelection | undefined {
    if (!identity) return undefined;
    const provider = catalog.providers.find((candidate) => candidate.id === identity.providerId);
    const model = provider?.models.find((candidate) => candidate.id === identity.modelId);
    if (!provider || provider.disabledReason !== undefined || !model) return undefined;
    const candidateEffort =
        "effort" in identity ? (identity as RigModelPreferenceDefault).effort : undefined;
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

function rigSelectionModelUpdateWithoutPreferences(
    snapshot: RigModelStoreSnapshot,
    current: RigSelection,
    input: RigModelSelection,
): RigSelection {
    if (snapshot.type !== "ready") return current;
    return rigSelectionModelUpdate(snapshot.catalog, current, input);
}
