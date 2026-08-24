/** The service-tier vocabulary Happy exposes to product state and UI. */
export type HappyAgentServiceTier = "fast";

/** The OpenAI/Codex tier name published by Happy Agent's wire contract. */
const HAPPY_AGENT_FAST_SERVICE_TIER = "priority";

/** Projects one daemon service tier into Happy's closed product vocabulary. */
export function happyAgentServiceTierFromWire(
    value: string | null | undefined,
): HappyAgentServiceTier | undefined {
    return value === HAPPY_AGENT_FAST_SERVICE_TIER ? "fast" : undefined;
}

/** Projects a daemon capability list without leaking unknown wire tiers. */
export function happyAgentServiceTiersFromWire(values: readonly string[]): HappyAgentServiceTier[] {
    return values.includes(HAPPY_AGENT_FAST_SERVICE_TIER) ? ["fast"] : [];
}

/** Projects Happy's service-tier selection into the daemon's wire vocabulary. */
export function happyAgentServiceTierToWire(
    value: HappyAgentServiceTier | undefined,
): "priority" | null {
    return value === "fast" ? HAPPY_AGENT_FAST_SERVICE_TIER : null;
}
