import {
    type HappyAgentClient,
    type RigProviderModelTokenUsage,
    type RigProviderTokenCounts,
    type RigProviderUsageEntry,
    type RigProviderUsageReading,
    type RigProviderUsageSource,
    type RigProviderUsageWindow,
    type happyAgentProtocol,
} from "happy-desktop-state";

const POLL_MS = 5_000;

type UsageWindow = "hour" | "day" | "week" | "month";

const WINDOWS: readonly UsageWindow[] = ["hour", "day", "week", "month"];

/** Reads daemon token usage only while the Usage settings category is observed. */
export function happyAgentUsageSourceCreate(client: HappyAgentClient): RigProviderUsageSource {
    return {
        subscribe(listener) {
            let closed = false;
            let loading = false;
            let request: AbortController | undefined;
            let providers: readonly RigProviderUsageEntry[] = [];
            let loadedAt: number | undefined;

            const load = (): void => {
                if (closed || loading) return;
                loading = true;
                request = new AbortController();
                void client.getUsage({ signal: request.signal }).then(
                    (usage) => {
                        loading = false;
                        if (closed) return;
                        loadedAt = Date.now();
                        providers = usageProject(usage, loadedAt);
                        listener({ loadedAt, loading: false, providers });
                    },
                    (error: unknown) => {
                        loading = false;
                        if (closed || request?.signal.aborted) return;
                        listener({
                            error: error instanceof Error ? error.message : String(error),
                            loading: false,
                            providers,
                            ...(loadedAt === undefined ? {} : { loadedAt }),
                        });
                    },
                );
            };

            listener({ loading: true, providers });
            load();
            const timer = setInterval(load, POLL_MS);
            return () => {
                if (closed) return;
                closed = true;
                clearInterval(timer);
                request?.abort();
            };
        },
    };
}

function usageProject(
    usage: happyAgentProtocol.DaemonUsageResponse,
    capturedAt: number,
): readonly RigProviderUsageEntry[] {
    const providersById = new Map(
        (usage.providers ?? []).map((provider) => [provider.providerId, provider]),
    );
    const providerIds = new Set(providersById.keys());
    for (const window of WINDOWS)
        for (const providerId of Object.keys(usage[window])) providerIds.add(providerId);

    return [...providerIds].map((providerId) => {
        const provider = providersById.get(providerId);
        const models = modelsProject(
            usage,
            providerId,
            provider?.models.map((model) => model.id) ?? [],
        );
        const reading = provider?.usage
            ? accountUsageProject(provider.usage, models)
            : models.length > 0
              ? { capturedAt, models }
              : undefined;
        return {
            providerId,
            ...(provider?.checkedAt == null ? {} : { checkedAt: provider.checkedAt }),
            ...(provider?.error == null ? {} : { error: provider.error }),
            ...(reading === undefined ? {} : { usage: reading }),
        };
    });
}

function accountUsageProject(
    usage: happyAgentProtocol.ProviderAccountUsage,
    models: readonly RigProviderModelTokenUsage[],
): RigProviderUsageReading {
    const fiveHour = windowProject(usage.windows.fiveHour);
    const weekly = windowProject(usage.windows.weekly);
    const monthly = windowProject(usage.windows.monthly);
    return {
        capturedAt: usage.capturedAt,
        exhausted: usage.exhausted,
        ...(usage.planName === null ? {} : { planName: usage.planName }),
        ...(fiveHour === undefined ? {} : { fiveHour }),
        ...(weekly === undefined ? {} : { weekly }),
        ...(monthly === undefined ? {} : { monthly }),
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
        ...(models.length === 0 ? {} : { models }),
    };
}

function windowProject(
    window: happyAgentProtocol.ProviderAccountUsageWindow | null,
): RigProviderUsageWindow | undefined {
    if (window === null) return undefined;
    return {
        usedPercent: window.usedPercent,
        ...(window.resetsAt === null ? {} : { resetsAt: window.resetsAt }),
        ...(window.startsAt === null ? {} : { startsAt: window.startsAt }),
        ...(window.durationMs === null ? {} : { durationMs: window.durationMs }),
    };
}

function modelsProject(
    usage: happyAgentProtocol.DaemonUsageResponse,
    providerId: string,
    configuredModelIds: readonly string[],
): readonly RigProviderModelTokenUsage[] {
    // The provider entry is the authoritative complete catalog. Rolling token
    // windows are deliberately sparse, so deriving rows from them alone hides
    // every model that has not spent tokens during the reported periods.
    const modelIds = new Set(configuredModelIds);
    for (const window of WINDOWS)
        for (const modelId of Object.keys(usage[window][providerId] ?? {})) modelIds.add(modelId);

    return [...modelIds]
        .map(
            (modelId): RigProviderModelTokenUsage => ({
                modelId,
                ...countsFor(usage.hour, providerId, modelId, "hour"),
                ...countsFor(usage.day, providerId, modelId, "day"),
                ...countsFor(usage.week, providerId, modelId, "week"),
                ...countsFor(usage.month, providerId, modelId, "month"),
            }),
        )
        .sort((left, right) => {
            // The daemon reports models keyed by an object, so their order is
            // whatever insertion produced. The account's heaviest model is the
            // one worth reading first, and the name settles a tie so the list
            // does not reshuffle between two readings that spent the same.
            const spent = monthTokens(right) - monthTokens(left);
            return spent === 0 ? left.modelId.localeCompare(right.modelId) : spent;
        });
}

/** Everything one model consumed over the widest window the daemon reports. */
function monthTokens(model: RigProviderModelTokenUsage): number {
    const counts = model.month;
    if (counts === undefined) return 0;
    return (
        counts.inputTokens + counts.outputTokens + counts.cacheReadTokens + counts.cacheWriteTokens
    );
}

function countsFor(
    usage: happyAgentProtocol.UsageBreakdown,
    providerId: string,
    modelId: string,
    window: UsageWindow,
): Partial<Record<UsageWindow, RigProviderTokenCounts>> {
    const counts = usage[providerId]?.[modelId];
    return counts === undefined ? {} : { [window]: tokenCountsProject(counts) };
}

function tokenCountsProject(counts: happyAgentProtocol.ModelUsage): RigProviderTokenCounts {
    return {
        cacheReadTokens: counts.cacheRead,
        cacheWriteTokens: counts.cacheWrite,
        inputTokens: counts.input,
        outputTokens: counts.output,
    };
}
