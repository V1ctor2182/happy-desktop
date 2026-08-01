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
    /** Current epoch millis used to render live time remaining until each reported reset. */
    currentTime?: number;
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
 * A person opens this screen to learn one thing: whether they can keep working.
 * So the answer is the content and nothing is drawn around it — an account is a
 * name with its windows listed beneath, and the only rule on the page is the
 * one that separates one account from the next. Each window gives its share as
 * a number and repeats it as a line the full width of the column, because a
 * long measure makes a small difference visible where a short bar hides it.
 *
 * Colour is spent here rather than everywhere: a bar stays the same ink as the
 * text until the share crosses into warning, so the one account in trouble is
 * the only thing on the page that is coloured.
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
                        <ProviderSection
                            currentTime={props.currentTime}
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

function ProviderSection(props: {
    currentTime?: number;
    provider: RigProviderUsageEntry;
    readingTime?: (capturedAt: number) => string | undefined;
}) {
    const { provider } = props;
    const usage = provider.usage;
    const taken = usage ? props.readingTime?.(usage.capturedAt) : undefined;
    return (
        <section
            className="happy2-rig-usage-page__provider"
            data-happy2-ui="rig-usage-page-provider"
            data-provider={provider.providerId}
        >
            <header className="happy2-rig-usage-page__provider-header">
                <span className="happy2-rig-usage-page__identity">
                    <span
                        className="happy2-rig-usage-page__name"
                        data-happy2-ui="rig-usage-page-provider-name"
                    >
                        {providerLabel(provider)}
                    </span>
                    {usage?.planName ? (
                        <span className="happy2-rig-usage-page__plan">{usage.planName}</span>
                    ) : null}
                </span>
                <span className="happy2-rig-usage-page__provider-meta">
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
                    <UsageWindow
                        currentTime={props.currentTime}
                        label="5 hours"
                        window={usage.fiveHour}
                    />
                    <UsageWindow
                        currentTime={props.currentTime}
                        label="Week"
                        window={usage.weekly}
                    />
                    <UsageWindow
                        currentTime={props.currentTime}
                        label="Month"
                        window={usage.monthly}
                    />
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
 * One reported window: a line naming it and giving its share, and beneath that
 * the same share as a rule the full width of the column.
 *
 * A vendor that does not report a window is not shown a bar for it: an empty
 * track would read as "none of it used", which is the opposite of "we were not
 * told".
 */
function UsageWindow(props: {
    currentTime?: number;
    label: string;
    window?: RigProviderUsageWindow;
}) {
    const window = props.window;
    if (!window) return null;
    const percent = Math.min(100, Math.max(0, window.usedPercent));
    const tone =
        percent >= CRITICAL_PERCENT ? "critical" : percent >= WARNING_PERCENT ? "warning" : "ample";
    const reset =
        window.resetsAt !== undefined && props.currentTime !== undefined
            ? resetTimeRemaining(window.resetsAt, props.currentTime)
            : undefined;
    return (
        <div
            className="happy2-rig-usage-page__window"
            data-happy2-ui="rig-usage-page-window"
            data-tone={tone}
        >
            <div className="happy2-rig-usage-page__window-line">
                <span className="happy2-rig-usage-page__window-label">{props.label}</span>
                {reset ? (
                    <span
                        className="happy2-rig-usage-page__reset"
                        data-happy2-ui="rig-usage-page-reset"
                    >
                        {reset}
                    </span>
                ) : null}
                <span
                    aria-label={`${String(Math.round(percent))}% of ${props.label} used`}
                    className="happy2-rig-usage-page__percent"
                    role="img"
                >
                    {Math.round(percent)}%
                </span>
            </div>
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
        </div>
    );
}

/**
 * What to call an account. An account that has been read names its own vendor;
 * one that has not is left with its configured id, so an id that is already a
 * vendor's name is given that vendor's spelling rather than appearing beside
 * the others in lower case.
 */
function providerLabel(provider: RigProviderUsageEntry): string {
    const vendor = provider.usage?.vendor;
    if (vendor) return VENDOR_LABELS[vendor];
    return VENDOR_LABELS[provider.providerId as RigProviderVendor] ?? provider.providerId;
}

function resetTimeRemaining(resetsAt: number, currentTime: number): string {
    const remainingMinutes = Math.ceil((resetsAt - currentTime) / 60_000);
    if (remainingMinutes <= 0) return "reset due";
    if (remainingMinutes < 60) return `resets in ${String(remainingMinutes)}m`;

    const remainingHours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    if (remainingHours < 24)
        return `resets in ${String(remainingHours)}h${minutes === 0 ? "" : ` ${String(minutes)}m`}`;

    const days = Math.floor(remainingHours / 24);
    const hours = remainingHours % 24;
    return `resets in ${String(days)}d${hours === 0 ? "" : ` ${String(hours)}h`}`;
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
