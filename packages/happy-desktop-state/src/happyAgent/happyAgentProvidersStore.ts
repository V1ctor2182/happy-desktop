import { createStore } from "zustand/vanilla";
import type { HappyAgentClient } from "@slopus/happy-agent-client";
import type { UserError } from "../types.js";
import { happyAgentModelCatalogProject } from "./happyAgentProject.js";
import { happyAgentUserError, referencesPreserve } from "./happyAgentSupport.js";
import type { HappyAgentModelCatalog, HappyAgentModelProvider } from "./happyAgentTypes.js";

/**
 * One provider as the Providers category reads it: what the daemon says it
 * offers, plus whether a change this window asked for has been answered yet.
 */
export interface HappyAgentProviderEntry extends HappyAgentModelProvider {
    /** This window has asked for a change the daemon has not confirmed yet. */
    readonly saving: boolean;
}

export interface HappyAgentProvidersSnapshot {
    /** Every provider the daemon knows about, in the order it reports them. */
    readonly providers: readonly HappyAgentProviderEntry[];
    /** True until the first answer arrives, so "no providers" is not claimed early. */
    readonly loading: boolean;
    /** Why the provider list could not be read; retained readings stay beneath it. */
    readonly error?: UserError;
    /** Why the last enablement change was refused. Cleared by the next attempt. */
    readonly saveError?: UserError;
}

/**
 * The Providers settings category: every provider this Happy Agent knows about
 * and whether it may be used.
 *
 * Enablement is the daemon's own durable configuration rather than a preference
 * of this window, so switching a provider off here switches it off for every
 * agent on the machine. The store never guesses the outcome: a change marks the
 * provider as waiting, and the configuration the daemon answers with is what the
 * surface then shows.
 */
export interface HappyAgentProvidersStore {
    get(): HappyAgentProvidersSnapshot;
    subscribe(listener: () => void): () => void;
    /** Asks the daemon to start or stop using one provider machine-wide. */
    providerEnabledUpdate(providerId: string, enabled: boolean): void;
    [Symbol.dispose](): void;
}

export interface HappyAgentProvidersStoreDeps {
    readonly client: Pick<HappyAgentClient, "getConfig" | "patchConfig">;
    /**
     * Hands on the catalog the daemon has just confirmed. Enabling a provider
     * changes what every picker in the window may offer, so the one catalog
     * authority is told rather than left holding the configuration from before.
     */
    readonly catalogChanged?: (catalog: HappyAgentModelCatalog) => void;
}

const EMPTY: HappyAgentProvidersSnapshot = { providers: [], loading: true };

/**
 * How often the open category re-reads the daemon's configuration. Providers
 * have no realtime channel yet, so the surface polls while it is watched and
 * stops the moment nobody is.
 */
const PROVIDERS_POLL_INTERVAL_MS = 4_000;

export function happyAgentProvidersStoreCreate(
    deps: HappyAgentProvidersStoreDeps,
): HappyAgentProvidersStore {
    const store = createStore<HappyAgentProvidersSnapshot>()(() => EMPTY);
    const listeners = new Set<() => void>();
    /** Providers whose requested change the daemon has not answered yet. */
    const saving = new Set<string>();
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timerCancel = (): void => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    };

    const schedule = (): void => {
        if (disposed || listeners.size === 0 || timer !== undefined) return;
        timer = setTimeout(() => {
            timer = undefined;
            load();
        }, PROVIDERS_POLL_INTERVAL_MS);
    };

    /**
     * Replaces the list with the one the daemon has just confirmed. Rows the
     * answer leaves unchanged keep their identity, so a poll every few seconds
     * does not replace every card in the category.
     */
    const settle = (catalog: HappyAgentModelCatalog): void => {
        const current = store.getState();
        const providers = referencesPreserve(
            current.providers,
            catalog.providers.map((provider) => providerEntry(provider, saving.has(provider.id))),
        );
        const { error: _cleared, ...rest } = current;
        store.setState({ ...rest, providers, loading: false }, true);
        deps.catalogChanged?.(catalog);
    };

    /** Re-marks the rows waiting on an answer without re-reading the daemon. */
    const savingPublish = (): void => {
        const current = store.getState();
        const providers = referencesPreserve(
            current.providers,
            current.providers.map((provider) =>
                provider.saving === saving.has(provider.id)
                    ? provider
                    : { ...provider, saving: saving.has(provider.id) },
            ),
        );
        if (providers === current.providers) return;
        store.setState({ providers }, false);
    };

    const load = (): void => {
        if (disposed || listeners.size === 0 || controller !== undefined) return;
        timerCancel();
        const currentController = new AbortController();
        controller = currentController;
        void deps.client.getConfig({ signal: currentController.signal }).then(
            (response) => {
                if (disposed || controller !== currentController) return;
                controller = undefined;
                settle(happyAgentModelCatalogProject(response.config));
                schedule();
            },
            (error: unknown) => {
                if (
                    disposed ||
                    controller !== currentController ||
                    currentController.signal.aborted
                )
                    return;
                controller = undefined;
                // A failed refresh never empties a list the daemon has already
                // answered: only the first read has nothing to keep, and it owns
                // the error surface.
                if (store.getState().loading)
                    store.setState({ error: happyAgentUserError(error), loading: false }, false);
                schedule();
            },
        );
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            if (listeners.size === 1) load();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size !== 0) return;
                timerCancel();
                controller?.abort();
                controller = undefined;
            };
        },
        providerEnabledUpdate(providerId, enabled) {
            if (disposed || saving.has(providerId)) return;
            saving.add(providerId);
            const { saveError: _cleared, ...rest } = store.getState();
            store.setState(rest, true);
            savingPublish();
            // The poll would otherwise land mid-write and show the configuration
            // from before the change as though the change had not been made.
            timerCancel();
            controller?.abort();
            controller = undefined;
            void deps.client.patchConfig({ providers: { [providerId]: { enabled } } }).then(
                (response) => {
                    if (disposed) return;
                    saving.delete(providerId);
                    settle(happyAgentModelCatalogProject(response.config));
                    schedule();
                },
                (error: unknown) => {
                    if (disposed) return;
                    saving.delete(providerId);
                    savingPublish();
                    store.setState({ saveError: happyAgentUserError(error) }, false);
                    schedule();
                },
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            timerCancel();
            controller?.abort();
            controller = undefined;
            saving.clear();
            listeners.clear();
        },
    };
}

function providerEntry(
    provider: HappyAgentModelProvider,
    saving: boolean,
): HappyAgentProviderEntry {
    return { ...provider, saving };
}

const INERT_SNAPSHOT: HappyAgentProvidersSnapshot = { providers: [], loading: false };

/**
 * The providers of a Happy Agent this window cannot reach. It is permanently
 * empty and settled, so the category says the machine is unavailable instead of
 * claiming it has no providers.
 */
export const happyAgentProvidersStoreNoop: HappyAgentProvidersStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    providerEnabledUpdate: () => undefined,
    [Symbol.dispose]: () => undefined,
};
