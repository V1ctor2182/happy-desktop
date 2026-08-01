import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";

/** Which vendor an account belongs to; the windows it reports differ by vendor. */
export type RigProviderVendor = "claude" | "codex" | "grok";

/** One rate-limit or spend window a provider reports, as a share already spent. */
export interface RigProviderUsageWindow {
    /** How much of the window is gone, 0–100. */
    readonly usedPercent: number;
    /** When the window starts over, in milliseconds. */
    readonly resetsAt?: number;
    /** When the current window began, in milliseconds. */
    readonly startsAt?: number;
    /** How long one window lasts, in milliseconds. */
    readonly durationMs?: number;
}

/** Money the account can still spend once its rate-limit window is used up. */
export interface RigProviderUsageCredits {
    readonly available: boolean;
    readonly unlimited: boolean;
    readonly remainingCents?: number;
    readonly usedPercent?: number;
}

/** One reading of one account's plan, as the daemon normalized it across vendors. */
export interface RigProviderUsageReading {
    readonly vendor: RigProviderVendor;
    /** When the daemon took this reading, in milliseconds. */
    readonly capturedAt: number;
    readonly planName?: string;
    /** True when every window this account has is spent. */
    readonly exhausted: boolean;
    readonly fiveHour?: RigProviderUsageWindow;
    readonly weekly?: RigProviderUsageWindow;
    readonly monthly?: RigProviderUsageWindow;
    readonly credits?: RigProviderUsageCredits;
}

/**
 * One provider account as the usage surface shows it. A provider with no reading
 * is still listed: knowing an account is configured but unread is different from
 * not having it at all, and the reason lives on the same row.
 */
export interface RigProviderUsageEntry {
    readonly providerId: string;
    readonly usage?: RigProviderUsageReading;
    /** When the daemon last tried this provider, in milliseconds. */
    readonly checkedAt?: number;
    /** Why the daemon's own last read of this provider failed. */
    readonly error?: string;
}

/**
 * One reading of every provider account, with how that read went.
 *
 * The daemon reports usage on request rather than pushing it, so the source
 * repeats the read for as long as something is watching. State says where that
 * cycle is: `loading` is only true before the first answer, and a later failure
 * leaves the readings already held in place, because a read that could not reach
 * the daemon does not make what we last saw untrue.
 */
export interface RigProviderUsageSourceReading {
    readonly providers: readonly RigProviderUsageEntry[];
    readonly loading: boolean;
    /** When the last successful read finished, in milliseconds. */
    readonly loadedAt?: number;
    /** Why the last attempt failed, when it failed. */
    readonly error?: string;
}

/**
 * The provider-usage feed for one Rig. Subscribing starts the reading cycle and
 * releasing the last subscriber stops it, so a machine nobody is looking at is
 * not polled.
 */
export interface RigProviderUsageSource {
    subscribe(
        listener: (reading: RigProviderUsageSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigProviderUsageSnapshot {
    /** Every configured provider account, in the order the daemon reports them. */
    readonly providers: readonly RigProviderUsageEntry[];
    /** True until the first reading arrives, so "no providers" is not claimed early. */
    readonly loading: boolean;
    /** When the last successful reading was taken, in milliseconds. */
    readonly loadedAt?: number;
    /** Set when the feed itself failed; the retained readings stay visible beneath it. */
    readonly error?: UserError;
}

export interface RigProviderUsageStore {
    get(): RigProviderUsageSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigProviderUsageStoreDeps {
    readonly source: RigProviderUsageSource;
}

/**
 * How much of each provider account's plan this Rig has spent, as one surface.
 *
 * The store owns no schedule of its own: the source repeats the daemon read
 * while anything is subscribed, and every reading it reports replaces the list
 * wholesale. There is nothing to act on here — usage is read, never changed — so
 * the store has no actions and emits no output, and the first subscriber
 * starting the cycle is what keeps a closed screen from polling a machine.
 */
export function rigProviderUsageStoreCreate(
    deps: RigProviderUsageStoreDeps,
): RigProviderUsageStore {
    const store = createStore<RigProviderUsageSnapshot>()(() => ({
        providers: [],
        loading: true,
    }));

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                store.setState(
                    {
                        providers: reading.providers,
                        loading: reading.loading,
                        ...(reading.loadedAt === undefined ? {} : { loadedAt: reading.loadedAt }),
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(reading.error) }),
                    },
                    true,
                );
            },
            (error) => {
                if (disposed) return;
                store.setState({ error: rigUserError(error), loading: false }, false);
            },
        );
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigProviderUsageSnapshot = { providers: [], loading: false };

/**
 * Usage for a Rig that reports none. It is permanently empty and settled rather
 * than loading, so a surface that must subscribe unconditionally reads "nothing
 * to report" instead of waiting forever for a reading that is not coming.
 */
export const rigProviderUsageStoreNoop: RigProviderUsageStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};
