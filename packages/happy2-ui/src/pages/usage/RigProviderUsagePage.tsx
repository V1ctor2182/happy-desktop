import type { CSSProperties } from "react";
import type {
    RigProviderUsageEntry,
    RigProviderUsageWindow,
    RigProviderVendor,
    UserError,
} from "happy2-state";
import { Banner } from "../../Banner";
import { EmptyState } from "../../EmptyState";
import { Toolbar } from "../../Toolbar";

export interface RigProviderUsagePageProps {
    /** Every configured provider account, in the order they should be read. */
    providers: readonly RigProviderUsageEntry[];
    /** True before the first reading arrives, so "no accounts" is not claimed early. */
    loading?: boolean;
    /** The reading itself failed; whatever was already read stays legible beneath it. */
    error?: UserError;
    /** Renders how long ago a reading was taken, the way the rest of the app renders time. */
    readingTime?: (capturedAt: number) => string | undefined;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Above this share spent, a window says so in colour; above the second, it insists. */
const WARNING_PERCENT = 75;
const CRITICAL_PERCENT = 90;

const VENDOR_LABELS: Record<RigProviderVendor, string> = {
    claude: "Claude",
    codex: "Codex",
    grok: "Grok",
};

/**
 * RigProviderUsagePage — how much of each provider account's plan this machine
 * has spent.
 *
 * One card per account, each carrying the windows that vendor reports: the
 * five-hour burst limit, the week, the month, and whatever credit is left once
 * they are gone. The bars are the answer at a glance — a person opens this
 * screen to learn whether they can keep working — and the numbers behind them
 * are there for when the answer is "nearly".
 *
 * It renders exactly what it is handed. It reads nothing and refreshes nothing:
 * the owner keeps the readings current for as long as this surface is on screen.
 */
export function RigProviderUsagePage(props: RigProviderUsagePageProps) {
    const providers = props.providers;
    return (
        <div
            className={["happy2-rig-usage-page", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-usage-page"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-usage-page__header" data-happy2-ui="rig-usage-page-header">
                <Toolbar subtitle={usageSubtitle(providers, props.loading)} title="Usage" />
            </div>
            <div className="happy2-rig-usage-page__scroll" data-happy2-ui="rig-usage-page-scroll">
                <div className="happy2-rig-usage-page__content">
                    {props.error ? (
                        <Banner tone="danger" title="Usage may be out of date">
                            {props.error.message}
                        </Banner>
                    ) : null}

                    {providers.length === 0 ? (
                        <EmptyState
                            description={
                                props.loading
                                    ? "Reading what this machine's provider accounts have spent."
                                    : "Sign in to a coding assistant on this machine and its plan appears here."
                            }
                            icon={props.loading ? "clock" : "zap"}
                            title={props.loading ? "Loading usage…" : "No provider accounts"}
                        />
                    ) : null}

                    {providers.map((provider) => (
                        <ProviderCard
                            key={provider.providerId}
                            provider={provider}
                            {...(props.readingTime ? { readingTime: props.readingTime } : {})}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ProviderCard(props: {
    provider: RigProviderUsageEntry;
    readingTime?: (capturedAt: number) => string | undefined;
}) {
    const { provider } = props;
    const usage = provider.usage;
    const taken = usage ? props.readingTime?.(usage.capturedAt) : undefined;
    return (
        <section
            className="happy2-rig-usage-page__card"
            data-happy2-ui="rig-usage-page-provider"
            data-provider={provider.providerId}
        >
            <header className="happy2-rig-usage-page__card-header">
                <span className="happy2-rig-usage-page__identity">
                    <span
                        className="happy2-rig-usage-page__name"
                        data-happy2-ui="rig-usage-page-provider-name"
                    >
                        {usage ? VENDOR_LABELS[usage.vendor] : provider.providerId}
                    </span>
                    {usage?.planName ? (
                        <span className="happy2-rig-usage-page__plan">{usage.planName}</span>
                    ) : null}
                </span>
                <span className="happy2-rig-usage-page__card-meta">
                    {usage?.exhausted ? (
                        <span
                            className="happy2-rig-usage-page__exhausted"
                            data-happy2-ui="rig-usage-page-exhausted"
                        >
                            Spent
                        </span>
                    ) : null}
                    {taken ? <span className="happy2-rig-usage-page__taken">{taken}</span> : null}
                </span>
            </header>

            {provider.error !== undefined ? (
                <p
                    className="happy2-rig-usage-page__provider-error"
                    data-happy2-ui="rig-usage-page-provider-error"
                >
                    {provider.error}
                </p>
            ) : usage === undefined ? (
                <p className="happy2-rig-usage-page__unread">This account has not been read yet.</p>
            ) : (
                <div className="happy2-rig-usage-page__windows">
                    <UsageWindow label="5 hours" window={usage.fiveHour} />
                    <UsageWindow label="Week" window={usage.weekly} />
                    <UsageWindow label="Month" window={usage.monthly} />
                    {usage.credits ? (
                        <div
                            className="happy2-rig-usage-page__credits"
                            data-happy2-ui="rig-usage-page-credits"
                        >
                            <span className="happy2-rig-usage-page__window-label">Credits</span>
                            <span className="happy2-rig-usage-page__credits-value">
                                {creditsText(
                                    usage.credits.available,
                                    usage.credits.unlimited,
                                    usage.credits.remainingCents,
                                )}
                            </span>
                        </div>
                    ) : null}
                </div>
            )}
        </section>
    );
}

/**
 * One reported window. A vendor that does not report a window is not shown a
 * bar for it: an empty track would read as "none of it used", which is the
 * opposite of "we were not told".
 */
function UsageWindow(props: { label: string; window?: RigProviderUsageWindow }) {
    const window = props.window;
    if (!window) return null;
    const percent = Math.min(100, Math.max(0, window.usedPercent));
    const tone =
        percent >= CRITICAL_PERCENT ? "critical" : percent >= WARNING_PERCENT ? "warning" : "ample";
    return (
        <div
            className="happy2-rig-usage-page__window"
            data-happy2-ui="rig-usage-page-window"
            data-tone={tone}
        >
            <span className="happy2-rig-usage-page__window-label">{props.label}</span>
            <span
                aria-hidden="true"
                className="happy2-rig-usage-page__track"
                data-happy2-ui="rig-usage-page-track"
            >
                <span
                    className="happy2-rig-usage-page__fill"
                    data-happy2-ui="rig-usage-page-fill"
                    style={{ width: `${String(percent)}%` }}
                />
            </span>
            <span
                aria-label={`${String(Math.round(percent))}% of ${props.label} used`}
                className="happy2-rig-usage-page__percent"
                role="img"
            >
                {Math.round(percent)}%
            </span>
        </div>
    );
}

function creditsText(
    available: boolean,
    unlimited: boolean,
    remainingCents: number | undefined,
): string {
    if (unlimited) return "Unlimited";
    if (!available) return "None left";
    if (remainingCents === undefined) return "Available";
    return `$${(remainingCents / 100).toFixed(2)} left`;
}

function usageSubtitle(
    providers: readonly RigProviderUsageEntry[],
    loading: boolean | undefined,
): string {
    if (providers.length === 0) return loading ? "Reading…" : "No accounts";
    const spent = providers.filter((provider) => provider.usage?.exhausted).length;
    const accounts = `${String(providers.length)} account${providers.length === 1 ? "" : "s"}`;
    return spent === 0 ? accounts : `${accounts} · ${String(spent)} spent`;
}
