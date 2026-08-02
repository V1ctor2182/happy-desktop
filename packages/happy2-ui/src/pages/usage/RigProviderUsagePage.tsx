import type { CSSProperties } from "react";
import type {
    RigProviderUsageEntry,
    RigProviderUsageWindow,
    RigProviderVendor,
    UserError,
} from "happy2-state";
import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { EmptyState } from "../../EmptyState";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import type { UsageWindowTone } from "../../usageTone";
import { usagePercentClamp, usageWindowTone } from "../../usageTone";
import { Toolbar } from "../../Toolbar";
import { Ionicon } from "../../vectorIcons/VectorIcon";

export interface RigProviderUsagePageProps {
    /** Every configured provider account, in the order they should be read. */
    providers: readonly RigProviderUsageEntry[];
    /** True before the first reading arrives, so "no accounts" is not claimed early. */
    loading?: boolean;
    /** The reading itself failed; whatever was already read stays legible beneath it. */
    error?: UserError;
    /** Renders when a reading (or a failed attempt) was taken, the way the rest of the app renders time. */
    readingTime?: (capturedAt: number) => string | undefined;
    /** Current epoch millis used to render live time remaining until each reported reset. */
    currentTime?: number;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** An account is in one of these; the first three come straight from its worst window. */
type UsageTone = UsageWindowTone | "spent" | "unread" | "error";

const TONE_LABELS: Record<UsageTone, string> = {
    ample: "Room left",
    warning: "Running low",
    critical: "Nearly spent",
    spent: "Spent",
    unread: "Not read yet",
    error: "Could not be read",
};

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
 * one that separates one account from the next.
 *
 * A window is one line: what it is, how much of it is gone drawn across the
 * middle of the column, the share as a number, and when it starts over. Putting
 * the measure between the name and the number keeps the three readings about
 * one window together, which a name at the far left and a number at the far
 * right could not do.
 *
 * Colour answers "can I keep working" and nothing else. Each account carries one
 * dot in the status vocabulary the rest of the app uses — green for room left,
 * orange for running low, red for nearly spent, spent, or failed to read, and
 * grey for an account nothing has been read from yet — so the whole answer is
 * readable down the left edge. The window bars stay the ink of the text until
 * a share crosses into warning, which keeps the coloured bar meaning "this one",
 * not "this is a bar".
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
                <Toolbar
                    height={SURFACE_HEADER_HEIGHT}
                    subtitle={usageSubtitle(providers, props.loading)}
                    title="Usage"
                />
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

                    {providers.length > 0 ? (
                        <div
                            className="happy2-rig-usage-page__providers"
                            data-happy2-ui="rig-usage-page-providers"
                        >
                            {providers.map((provider) => (
                                <ProviderSection
                                    currentTime={props.currentTime}
                                    key={provider.providerId}
                                    provider={provider}
                                    {...(props.readingTime
                                        ? { readingTime: props.readingTime }
                                        : {})}
                                />
                            ))}
                        </div>
                    ) : null}
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
    const tone = providerTone(provider);
    // A failed read still has an attempt behind it, and when that attempt
    // happened is the whole difference between "signed out a minute ago" and
    // "signed out since yesterday".
    const stamp = usage ? usage.capturedAt : provider.checkedAt;
    const taken = stamp === undefined ? undefined : props.readingTime?.(stamp);
    return (
        <section
            className="happy2-rig-usage-page__provider"
            data-happy2-ui="rig-usage-page-provider"
            data-provider={provider.providerId}
            data-tone={tone}
        >
            <header className="happy2-rig-usage-page__provider-header">
                <span className="happy2-rig-usage-page__identity">
                    <span
                        aria-label={TONE_LABELS[tone]}
                        className="happy2-rig-usage-page__dot"
                        data-happy2-ui="rig-usage-page-dot"
                        role="img"
                    />
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
                        <span data-happy2-ui="rig-usage-page-exhausted">
                            <Badge label="Spent" variant="danger" />
                        </span>
                    ) : null}
                    {taken ? <span className="happy2-rig-usage-page__taken">{taken}</span> : null}
                </span>
            </header>

            {provider.error !== undefined ? (
                <p
                    className="happy2-rig-usage-page__note"
                    data-happy2-ui="rig-usage-page-provider-error"
                    data-note="error"
                >
                    <Ionicon
                        className="happy2-rig-usage-page__note-icon"
                        name="alert-circle-outline"
                        size={16}
                    />
                    <span>{provider.error}</span>
                </p>
            ) : usage === undefined ? (
                <p className="happy2-rig-usage-page__note" data-note="unread">
                    <Ionicon
                        className="happy2-rig-usage-page__note-icon"
                        name="time-outline"
                        size={16}
                    />
                    <span>This account has not been read yet.</span>
                </p>
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
 * One reported window on a single line: its name, then the share drawn across
 * the middle of the column, then that share as a number, then when it starts
 * over. The measure runs the width the column can spare so a few percent is
 * still a visible difference.
 *
 * A vendor that does not report a window is not shown a line for it: an empty
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
    const percent = usagePercentClamp(window.usedPercent);
    const tone = usageWindowTone(percent);
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
            <span className="happy2-rig-usage-page__reset" data-happy2-ui="rig-usage-page-reset">
                {reset ?? ""}
            </span>
        </div>
    );
}

/**
 * The one state an account is in, which its dot reports. A read that failed and
 * a read that never happened are different answers to "can I keep working", so
 * they are separate states rather than one grey absence; otherwise the account
 * takes the tone of its tightest window.
 */
function providerTone(provider: RigProviderUsageEntry): UsageTone {
    if (provider.error !== undefined) return "error";
    const usage = provider.usage;
    if (usage === undefined) return "unread";
    if (usage.exhausted) return "spent";
    const windows = [usage.fiveHour, usage.weekly, usage.monthly].filter(
        (window): window is RigProviderUsageWindow => window !== undefined,
    );
    if (windows.length === 0) return "ample";
    return usageWindowTone(
        Math.max(...windows.map((window) => usagePercentClamp(window.usedPercent))),
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
