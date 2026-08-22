import { Badge, type BadgeVariant } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { Spinner } from "../../Spinner";
import { Switch } from "../../Switch";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

/** Why a provider is or is not usable, straight from the daemon's catalog. */
export type HappyAgentProviderStatus = "ready" | "not_authenticated" | "not_enabled" | "no_models";

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
    readonly models: readonly HappyAgentProviderModelRow[];
    /** Service tiers the provider offers, already labelled. */
    readonly serviceTiers: readonly string[];
}

export type HappyAgentProviderSettingsProps = {
    providers: readonly HappyAgentProviderRow[];
    loading?: boolean;
    error?: string;
    /** Why model enablement cannot currently be changed. */
    unavailable?: string;
    onModelEnabledChange: (id: string, enabled: boolean) => void;
};

const STATUS_LABELS: Record<HappyAgentProviderStatus, string> = {
    ready: "Connected",
    not_authenticated: "Not signed in",
    not_enabled: "Disabled",
    no_models: "No models",
};

const STATUS_VARIANTS: Record<HappyAgentProviderStatus, BadgeVariant> = {
    ready: "success",
    not_authenticated: "warning",
    not_enabled: "neutral",
    no_models: "neutral",
};

/** What has to happen in Happy Agent itself before the provider's models become usable. */
const STATUS_HINTS: Partial<Record<HappyAgentProviderStatus, string>> = {
    not_authenticated: "Sign this provider in from Happy Agent to use its models.",
    not_enabled: "Enable this provider in Happy Agent's configuration to use it.",
};

/**
 * The Providers category: every provider the daemon knows about, whether it is
 * usable, and which of its models the session pickers may offer. A provider that
 * is not signed in or not enabled still lists its models — knowing what would be
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
            <Box className="happy2-happy-agent-settings__pending">
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
            <HappyAgentSettingsSection
                description="Providers are configured in Happy Agent itself. Switch off a model here to keep it out of the session pickers."
                rows="cards"
                title="Model providers"
            >
                {props.providers.map((provider) => (
                    <article
                        className="happy2-happy-agent-provider"
                        data-happy2-ui="happy-agent-provider"
                        data-status={provider.status}
                        key={provider.id}
                    >
                        <header className="happy2-happy-agent-provider__header">
                            <Box className="happy2-happy-agent-provider__identity">
                                <span
                                    className="happy2-happy-agent-provider__glyph"
                                    data-happy2-ui="happy-agent-provider-glyph"
                                >
                                    <Icon name="globe" size={16} />
                                </span>
                                <Box className="happy2-happy-agent-provider__naming">
                                    <span
                                        className="happy2-happy-agent-provider__name"
                                        data-happy2-ui="happy-agent-provider-name"
                                    >
                                        {provider.name}
                                    </span>
                                    <span
                                        className="happy2-happy-agent-provider__meta"
                                        data-happy2-ui="happy-agent-provider-meta"
                                    >
                                        {providerMeta(provider)}
                                    </span>
                                </Box>
                            </Box>
                            <Badge
                                label={STATUS_LABELS[provider.status]}
                                variant={STATUS_VARIANTS[provider.status]}
                            />
                        </header>
                        <Box className="happy2-happy-agent-provider__models">
                            {provider.models.map((model) => (
                                <Box
                                    className="happy2-happy-agent-provider__model"
                                    data-happy2-ui="happy-agent-provider-model"
                                    key={model.id}
                                >
                                    <Box className="happy2-happy-agent-provider__model-text">
                                        <Box className="happy2-happy-agent-provider__model-title">
                                            <span
                                                className="happy2-happy-agent-provider__model-name"
                                                data-happy2-ui="happy-agent-provider-model-name"
                                            >
                                                {model.name}
                                            </span>
                                            {model.isDefault ? (
                                                <Badge label="Default" variant="accent" />
                                            ) : null}
                                        </Box>
                                        <span
                                            className="happy2-happy-agent-provider__model-meta"
                                            data-happy2-ui="happy-agent-provider-model-meta"
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
                                    className="happy2-happy-agent-provider__models-empty"
                                    data-happy2-ui="happy-agent-provider-models-empty"
                                >
                                    This provider offers no models right now.
                                </span>
                            ) : null}
                        </Box>
                        {STATUS_HINTS[provider.status] ? (
                            <p
                                className="happy2-happy-agent-provider__hint"
                                data-happy2-ui="happy-agent-provider-hint"
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
