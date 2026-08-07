import type { CSSProperties } from "react";
import type {
    RigSessionUsage,
    RigUsageGroup,
    RigUsageQuota,
    RigUsageQuotaWindow,
} from "happy-desktop-state";
import { USAGE_CRITICAL_PERCENT, usagePercentClamp, usageWindowTone } from "./usageTone";

export type RigUsagePanelProps = {
    /** The projected usage snapshot; omit while the first load is in flight. */
    usage?: RigSessionUsage;
    /** True while a load/poll is in flight (shows a subtle loading affordance). */
    loading?: boolean;
    /** Displayable error from a failed load; replaces the body when set. */
    error?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const TOKENS = new Intl.NumberFormat("en-US");
const COST = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatTokens(value: number): string {
    return TOKENS.format(value);
}

function formatCost(value: number): string {
    // Sub-cent costs still read meaningfully at four decimals; larger ones use two.
    return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : COST.format(value);
}

const QUOTA_LABELS: Record<RigUsageQuotaWindow["kind"], string> = {
    fiveHour: "5 hours",
    weekly: "Week",
};

/** Formats an epoch-millis reset time as a short local day/time. */
function formatReset(resetsAt: number): string {
    return new Date(resetsAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function GroupRow(props: { group: RigUsageGroup }) {
    const { group } = props;
    return (
        <tr className="happy2-rig-usage__row" data-happy-desktop-ui="rig-usage-group">
            <th className="happy2-rig-usage__model" scope="row">
                {group.modelId}
            </th>
            <td className="happy2-rig-usage__num">{formatTokens(group.inputTokens)}</td>
            <td className="happy2-rig-usage__num">{formatTokens(group.outputTokens)}</td>
            <td className="happy2-rig-usage__num">
                {formatTokens(group.cacheReadTokens + group.cacheWriteTokens)}
            </td>
            <td className="happy2-rig-usage__num">{formatTokens(group.totalTokens)}</td>
            <td className="happy2-rig-usage__num">{formatCost(group.cost)}</td>
        </tr>
    );
}

function QuotaRow(props: { quota: RigUsageQuota }) {
    const { quota } = props;
    return (
        <div className="happy2-rig-usage__quota" data-happy-desktop-ui="rig-usage-quota">
            <span className="happy2-rig-usage__quota-provider">{quota.providerId}</span>
            {quota.windows.length === 0 ? (
                <span className="happy2-rig-usage__quota-empty">No limits reported</span>
            ) : (
                quota.windows.map((window) => {
                    const percent = usagePercentClamp(window.usedPercent);
                    return (
                        <span
                            className="happy2-rig-usage__quota-window"
                            data-happy-desktop-ui="rig-usage-quota-window"
                            data-tone={usageWindowTone(percent)}
                            key={window.kind}
                        >
                            <span className="happy2-rig-usage__quota-label">
                                {QUOTA_LABELS[window.kind]}
                            </span>
                            <span className="happy2-rig-usage__quota-bar" aria-hidden="true">
                                <span
                                    className="happy2-rig-usage__quota-fill"
                                    data-full={percent >= USAGE_CRITICAL_PERCENT ? "" : undefined}
                                    style={{ width: `${String(percent)}%` }}
                                />
                            </span>
                            <span
                                aria-label={`${String(Math.round(percent))}% of ${QUOTA_LABELS[window.kind]} used`}
                                className="happy2-rig-usage__quota-percent"
                                role="img"
                            >
                                {Math.round(percent)}%
                            </span>
                            <span className="happy2-rig-usage__quota-reset">
                                resets {formatReset(window.resetsAt)}
                            </span>
                        </span>
                    );
                })
            )}
        </div>
    );
}

/**
 * RigUsagePanel — presentational token/cost accounting for a session (`/usage`).
 * Renders per-model token+cost groups, a session total, an approximate
 * context-window occupancy line, and any provider rate-limit windows. Purely
 * driven by a `RigSessionUsage` snapshot plus loading/error flags, so the owning
 * surface fetches (and polls while visible) and passes the result down. Holds no
 * state and starts no work of its own.
 *
 * It is a content block rather than a card: the reading is named and framed by
 * whatever carries it — `ComposerPanel` above the composer — so it neither
 * repeats that title nor draws a second border inside the first one.
 *
 * A rate-limit window is drawn with the same grammar the provider-usage page
 * uses — name, measure, share, reset, in fixed columns, and monochrome until
 * the share is worth colouring — so the same limit read here and read there is
 * recognisably the same reading rather than two unrelated charts.
 */
export function RigUsagePanel(props: RigUsagePanelProps) {
    const { usage } = props;
    return (
        <section
            className={["happy2-rig-usage", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-usage-panel"
            data-loading={props.loading ? "" : undefined}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {props.error !== undefined ? (
                <p className="happy2-rig-usage__error" data-happy-desktop-ui="rig-usage-error">
                    {props.error}
                </p>
            ) : usage === undefined ? (
                <p className="happy2-rig-usage__empty" data-happy-desktop-ui="rig-usage-empty">
                    Loading usage…
                </p>
            ) : (
                <>
                    <div
                        className="happy2-rig-usage__totals"
                        data-happy-desktop-ui="rig-usage-totals"
                    >
                        <span className="happy2-rig-usage__total">
                            <span className="happy2-rig-usage__total-value">
                                {formatTokens(usage.totalTokens)}
                            </span>
                            <span className="happy2-rig-usage__total-label">tokens</span>
                        </span>
                        <span className="happy2-rig-usage__total">
                            <span className="happy2-rig-usage__total-value">
                                {formatCost(usage.totalCost)}
                            </span>
                            <span className="happy2-rig-usage__total-label">cost</span>
                        </span>
                    </div>

                    {usage.groups.length > 0 ? (
                        <table
                            className="happy2-rig-usage__table"
                            data-happy-desktop-ui="rig-usage-table"
                        >
                            <thead>
                                <tr>
                                    <th scope="col">Model</th>
                                    <th scope="col">In</th>
                                    <th scope="col">Out</th>
                                    <th scope="col">Cache</th>
                                    <th scope="col">Total</th>
                                    <th scope="col">Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                                {usage.groups.map((group) => (
                                    <GroupRow
                                        group={group}
                                        key={`${group.providerId}:${group.modelId}`}
                                    />
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="happy2-rig-usage__empty">No model usage yet.</p>
                    )}

                    {usage.context ? (
                        <p
                            className="happy2-rig-usage__context"
                            data-happy-desktop-ui="rig-usage-context"
                        >
                            Context: {formatTokens(usage.context.totalTokens)} tokens
                            {usage.context.approximate ? " (approximate)" : ""} on{" "}
                            {usage.context.modelId}
                        </p>
                    ) : null}

                    {usage.quotas.length > 0 ? (
                        <div
                            className="happy2-rig-usage__quotas"
                            data-happy-desktop-ui="rig-usage-quotas"
                        >
                            {usage.quotas.map((quota) => (
                                <QuotaRow key={quota.providerId} quota={quota} />
                            ))}
                        </div>
                    ) : null}
                </>
            )}
        </section>
    );
}
