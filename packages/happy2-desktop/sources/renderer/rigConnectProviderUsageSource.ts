import type { ProviderUsageEntry, ProviderUsageState, RigConnection } from "@slopus/rig-connect";
import type {
    RigProviderUsageEntry,
    RigProviderUsageSource,
    RigProviderUsageSourceReading,
} from "happy2-state";

/**
 * Adapts `rig-connect`'s provider-usage reader to the usage store's source
 * contract.
 *
 * Usage is the one thing the daemon does not stream: it is read on request, so
 * `connectProviderUsage` repeats that read on an interval for as long as it is
 * open. This source therefore opens the reader when something first subscribes
 * and closes it when the last subscriber leaves, so a window showing anything
 * else is not asking a machine about its plan every minute.
 */
export function rigConnectProviderUsageSourceCreate(rig: RigConnection): RigProviderUsageSource {
    return {
        subscribe(listener, onError) {
            let closed = false;
            const connection = rig.connectProviderUsage({
                onChange: (providers, state) => {
                    if (closed) return;
                    listener(readingProject(providers, state));
                },
                onError: (error) => {
                    if (closed) return;
                    onError(error);
                },
            });
            return () => {
                if (closed) return;
                closed = true;
                connection.close();
            };
        },
    };
}

function readingProject(
    providers: readonly ProviderUsageEntry[],
    state: ProviderUsageState,
): RigProviderUsageSourceReading {
    return {
        providers: providers.map(entryProject),
        loading: state.loading,
        ...(state.loadedAt === null ? {} : { loadedAt: state.loadedAt }),
        ...(state.error === null ? {} : { error: state.error }),
    };
}

function entryProject(entry: ProviderUsageEntry): RigProviderUsageEntry {
    const usage = entry.usage;
    return {
        providerId: entry.providerId,
        ...(entry.checkedAt === null ? {} : { checkedAt: entry.checkedAt }),
        ...(entry.error === null ? {} : { error: entry.error }),
        ...(usage === null
            ? {}
            : {
                  usage: {
                      vendor: usage.vendor,
                      capturedAt: usage.capturedAt,
                      exhausted: usage.exhausted,
                      ...(usage.planName === null ? {} : { planName: usage.planName }),
                      ...(usage.windows.fiveHour === null
                          ? {}
                          : { fiveHour: windowProject(usage.windows.fiveHour) }),
                      ...(usage.windows.weekly === null
                          ? {}
                          : { weekly: windowProject(usage.windows.weekly) }),
                      ...(usage.windows.monthly === null
                          ? {}
                          : { monthly: windowProject(usage.windows.monthly) }),
                      ...(usage.credits === null
                          ? {}
                          : {
                                credits: {
                                    available: usage.credits.available,
                                    unlimited: usage.credits.unlimited,
                                    ...(usage.credits.remainingCents === null
                                        ? {}
                                        : { remainingCents: usage.credits.remainingCents }),
                                    ...(usage.credits.usedPercent === null
                                        ? {}
                                        : { usedPercent: usage.credits.usedPercent }),
                                },
                            }),
                  },
              }),
    };
}

function windowProject(window: {
    usedPercent: number;
    resetsAt: number | null;
    startsAt: number | null;
    durationMs: number | null;
}) {
    return {
        usedPercent: window.usedPercent,
        ...(window.resetsAt === null ? {} : { resetsAt: window.resetsAt }),
        ...(window.startsAt === null ? {} : { startsAt: window.startsAt }),
        ...(window.durationMs === null ? {} : { durationMs: window.durationMs }),
    };
}
