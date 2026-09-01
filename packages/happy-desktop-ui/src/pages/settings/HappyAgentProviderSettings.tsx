import { Badge, type BadgeVariant } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { Spinner } from "../../Spinner";
import { Switch } from "../../Switch";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

/** Why a provider is or is not usable, straight from the daemon's catalog. */
export type HappyAgentProviderStatus =
    | "checking"
    | "ready"
    | "authentication_failed"
    | "verification_unavailable"
    | "not_authenticated"
    | "not_enabled"
    | "no_models";

export interface HappyAgentProviderModelRow {
    /** Stable row key, `${providerId}:${modelId}`. */
    readonly id: string;
    readonly name: string;
    /** The model's own identifier, shown as the machine-readable subtitle. */
    readonly modelId: string;
    readonly enabled: boolean;
    /** The workspace default; it is offered even when the rest are switched off. */
    readonly isDefault: boolean;
    readonly contextWindow?: number;
    /** Reasoning levels this model exposes, already labelled. */
    readonly efforts: readonly string[];
}

export interface HappyAgentProviderRow {
    readonly id: string;
    readonly name: string;
    readonly status: HappyAgentProviderStatus;
    /** Whether the machine will use this provider at all. */
    readonly enabled: boolean;
    /** A requested enablement change the machine has not confirmed yet. */
    readonly saving?: boolean;
    readonly models: readonly HappyAgentProviderModelRow[];
    /** Service tiers the provider offers, already labelled. */
    readonly serviceTiers: readonly string[];
}

export type HappyAgentProviderSettingsProps = {
    providers: readonly HappyAgentProviderRow[];
    loading?: boolean;
    error?: string;
    /** Why the last provider change was refused. */
    saveError?: string;
    /** Why model enablement cannot currently be changed. */
    unavailable?: string;
    onModelEnabledChange: (id: string, enabled: boolean) => void;
    /** Switches one whole provider on or off for the machine. */
    onProviderEnabledChange: (id: string, enabled: boolean) => void;
};

const STATUS_LABELS: Record<HappyAgentProviderStatus, string> = {
    checking: "Checking",
    ready: "Connected",
    authentication_failed: "Authentication failed",
    verification_unavailable: "Check unavailable",
    not_authenticated: "Not signed in",
    not_enabled: "Disabled",
    no_models: "No models",
};

const STATUS_VARIANTS: Record<HappyAgentProviderStatus, BadgeVariant> = {
    checking: "info",
    ready: "success",
    authentication_failed: "danger",
    verification_unavailable: "warning",
    not_authenticated: "warning",
    not_enabled: "neutral",
    no_models: "neutral",
};

/** What has to happen in Happy Agent itself before the provider's models become usable. */
const STATUS_HINTS: Partial<Record<HappyAgentProviderStatus, string>> = {
    checking: "Happy is making a bounded authenticated request to verify these credentials.",
    authentication_failed:
        "The provider could not authenticate with the saved credentials. Update them or sign in again; Happy will recheck automatically when possible and whenever this page is reopened.",
    verification_unavailable:
        "Happy could not complete the authentication check. It will try again automatically.",
    not_authenticated: "Sign this provider in from Happy Agent to use its models.",
    not_enabled: "Switched off on this machine, so no agent here may use it.",
};

/**
 * The Providers category: every provider the daemon knows about, whether it is
 * usable, and which of its models the session pickers may offer. A provider that
 * is not signed in or switched off still lists its models — knowing what would be
 * available is the reason to go and connect it.
 */
export function HappyAgentProviderSettings(props: HappyAgentProviderSettingsProps) {
    if (props.error)
        return (
            <Banner tone="danger" title="Providers unavailable">
                {props.error}
            </Banner>
        );
    if (props.loading)
        return (
            <Box className="happy-agent-settings__pending">
                <Spinner size={16} />
                <span>Reading the model catalog…</span>
            </Box>
        );
    if (props.providers.length === 0)
        return (
            <EmptyState
                description="This Happy Agent daemon reports no model providers yet."
                icon="globe"
                title="No providers"
            />
        );
    return (
        <>
            {props.unavailable ? (
                <Banner tone="neutral" title="Happy Agent reconnecting">
                    {props.unavailable}
                </Banner>
            ) : null}
            {props.saveError ? (
                <Banner tone="danger" title="Provider unchanged">
                    {props.saveError}
                </Banner>
            ) : null}
            <HappyAgentSettingsSection
                description="Switching a provider off stops every agent on this machine from using it. Switching off one model only keeps it out of this window's session pickers."
                rows="cards"
                title="Model providers"
            >
                {props.providers.map((provider) => (
                    <article
                        className="happy-agent-provider"
                        data-happy-desktop-ui="happy-agent-provider"
                        data-status={provider.status}
                        key={provider.id}
                    >
                        <header className="happy-agent-provider__header">
                            <Box className="happy-agent-provider__identity">
                                <span
                                    className="happy-agent-provider__glyph"
                                    data-happy-desktop-ui="happy-agent-provider-glyph"
                                >
                                    <Icon name="globe" size={16} />
                                </span>
                                <Box className="happy-agent-provider__naming">
                                    <span
                                        className="happy-agent-provider__name"
                                        data-happy-desktop-ui="happy-agent-provider-name"
                                    >
                                        {provider.name}
                                    </span>
                                    <span
                                        className="happy-agent-provider__meta"
                                        data-happy-desktop-ui="happy-agent-provider-meta"
                                    >
                                        {providerMeta(provider)}
                                    </span>
                                </Box>
                            </Box>
                            <Badge
                                label={STATUS_LABELS[provider.status]}
                                variant={STATUS_VARIANTS[provider.status]}
                            />
                            {provider.saving || provider.status === "checking" ? (
                                <Spinner size={16} />
                            ) : null}
                            <Switch
                                aria-label={`${provider.name} enabled`}
                                checked={provider.enabled}
                                disabled={props.unavailable !== undefined || provider.saving}
                                onChange={(enabled) =>
                                    props.onProviderEnabledChange(provider.id, enabled)
                                }
                            />
                        </header>
                        <Box className="happy-agent-provider__models">
                            {provider.models.map((model) => (
                                <Box
                                    className="happy-agent-provider__model"
                                    data-happy-desktop-ui="happy-agent-provider-model"
                                    key={model.id}
                                >
                                    <Box className="happy-agent-provider__model-text">
                                        <Box className="happy-agent-provider__model-title">
                                            <span
                                                className="happy-agent-provider__model-name"
                                                data-happy-desktop-ui="happy-agent-provider-model-name"
                                            >
                                                {model.name}
                                            </span>
                                            {model.isDefault ? (
                                                <Badge label="Default" variant="accent" />
                                            ) : null}
                                        </Box>
                                        <span
                                            className="happy-agent-provider__model-meta"
                                            data-happy-desktop-ui="happy-agent-provider-model-meta"
                                        >
                                            {modelMeta(model)}
                                        </span>
                                    </Box>
                                    <Switch
                                        aria-label={`${model.name} enabled`}
                                        checked={model.enabled}
                                        disabled={
                                            props.unavailable !== undefined ||
                                            model.isDefault ||
                                            provider.status !== "ready"
                                        }
                                        onChange={(enabled) =>
                                            props.onModelEnabledChange(model.id, enabled)
                                        }
                                    />
                                </Box>
                            ))}
                            {provider.models.length === 0 ? (
                                <span
                                    className="happy-agent-provider__models-empty"
                                    data-happy-desktop-ui="happy-agent-provider-models-empty"
                                >
                                    This provider offers no models right now.
                                </span>
                            ) : null}
                        </Box>
                        {STATUS_HINTS[provider.status] ? (
                            <p
                                className="happy-agent-provider__hint"
                                data-happy-desktop-ui="happy-agent-provider-hint"
                            >
                                {STATUS_HINTS[provider.status]}
                            </p>
                        ) : null}
                    </article>
                ))}
            </HappyAgentSettingsSection>
        </>
    );
}

function providerMeta(provider: HappyAgentProviderRow): string {
    const models = `${provider.models.length} ${provider.models.length === 1 ? "model" : "models"}`;
    return provider.serviceTiers.length > 0
        ? `${models} · ${provider.serviceTiers.join(", ")}`
        : models;
}

function modelMeta(model: HappyAgentProviderModelRow): string {
    const parts = [model.modelId];
    if (model.contextWindow !== undefined)
        parts.push(`${Math.round(model.contextWindow / 1000)}K context`);
    if (model.efforts.length > 0) parts.push(model.efforts.join(" · "));
    return parts.join("  —  ");
}
