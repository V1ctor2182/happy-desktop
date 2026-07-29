import { UserError } from "../types.js";
import { rigMenusDerive } from "./rigMenusStore.js";
import { rigSelectionModelUpdate, rigSessionSelectionDefault } from "./rigSessionDraftStore.js";
import type { RigMenusSnapshot, RigModelCatalog, RigSelection } from "./rigTypes.js";
import type { RigModelSelection, RigServiceTier, RigThinkingLevel } from "./rigTypes.js";

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

export interface RigModelPreferencePersistence {
    read(): RigModelPreferences | undefined;
    write(preferences: RigModelPreferences): void;
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
    let preferences: RigModelPreferences = options.preferencePersistence?.read() ?? {};

    const publish = (next: RigModelStoreSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        load() {
            if (snapshot.type === "ready") return Promise.resolve(snapshot);
            if (loadPromise) return loadPromise;
            if (snapshot.type === "error") publish({ type: "loading" });
            loadPromise = options.catalogRead().then(
                (catalog) => {
                    const defaultSelection = rigSessionSelectionDefault(catalog);
                    const ready: RigModelStoreReadySnapshot = {
                        type: "ready",
                        catalog,
                        defaultSelection,
                        lastUsedSelection: defaultSelection,
                        menus: rigMenusDerive(catalog, defaultSelection),
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
            options.preferencePersistence?.write(preferences);
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
