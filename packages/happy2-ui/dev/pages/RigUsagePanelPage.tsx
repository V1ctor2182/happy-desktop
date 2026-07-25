import type { RigSessionUsage } from "happy2-state";
import { RigUsagePanel } from "../../src/RigUsagePanel";
import { ComponentPage, Specimen } from "../kit";

// Fixed reset time keeps the blueprint deterministic and screenshot-safe.
const RESET = Date.UTC(2026, 6, 25, 17, 0, 0);

const usage: RigSessionUsage = {
    currentProviderId: "openai",
    groups: [
        {
            modelId: "gpt-5.6-sol",
            providerId: "openai",
            inputTokens: 128_400,
            outputTokens: 24_100,
            cacheReadTokens: 96_000,
            cacheWriteTokens: 12_000,
            totalTokens: 260_500,
            reasoningTokens: 8_200,
            cost: 1.42,
        },
        {
            modelId: "sonnet-5",
            providerId: "anthropic",
            inputTokens: 32_000,
            outputTokens: 9_800,
            cacheReadTokens: 4_000,
            cacheWriteTokens: 1_200,
            totalTokens: 47_000,
            cost: 0.31,
        },
    ],
    totalTokens: 307_500,
    totalCost: 1.73,
    context: {
        modelId: "gpt-5.6-sol",
        providerId: "openai",
        totalTokens: 184_200,
        approximate: true,
    },
    quotas: [
        {
            providerId: "openai",
            windows: [
                { kind: "fiveHour", usedPercent: 42, resetsAt: RESET },
                { kind: "weekly", usedPercent: 93, resetsAt: RESET },
            ],
        },
    ],
};

export function RigUsagePanelPage() {
    return (
        <ComponentPage
            number="C-156"
            summary="Rig session usage (`/usage`): per-model token/cost table, session totals, context-window occupancy, and provider rate-limit windows."
            title="RigUsagePanel"
        >
            <Specimen
                detail="a session with two models, context usage, and quota windows"
                label="Populated"
                number="01"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigUsagePanel usage={usage} />
                </div>
            </Specimen>

            <Specimen
                detail="first load in flight, no snapshot yet"
                label="Loading"
                number="02"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <RigUsagePanel loading />
                </div>
            </Specimen>

            <Specimen detail="load failed" label="Error" number="03" stage="surface">
                <div style={{ width: "560px" }}>
                    <RigUsagePanel error="Usage is unavailable for this session." />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
