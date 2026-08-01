import type { RigProviderUsageEntry } from "happy2-state";
import { RigProviderUsagePage } from "../../src/pages/usage/RigProviderUsagePage";
import { ComponentPage, FullScreenSpecimen } from "../kit";

const providers: readonly RigProviderUsageEntry[] = [
    {
        providerId: "claude",
        checkedAt: 1_700_000_000_000,
        usage: {
            vendor: "claude",
            capturedAt: 1_700_000_000_000,
            planName: "Max 20×",
            exhausted: false,
            fiveHour: { usedPercent: 42, resetsAt: 1_700_007_200_000 },
            weekly: { usedPercent: 81, resetsAt: 1_700_400_000_000 },
        },
    },
    {
        providerId: "codex",
        checkedAt: 1_700_000_000_000,
        usage: {
            vendor: "codex",
            capturedAt: 1_699_999_400_000,
            planName: "Pro",
            exhausted: true,
            fiveHour: { usedPercent: 100, resetsAt: 1_700_003_000_000 },
            weekly: { usedPercent: 96 },
            credits: { available: true, unlimited: false, remainingCents: 1_450 },
        },
    },
    {
        providerId: "grok",
        checkedAt: 1_700_000_000_000,
        error: "The Grok account could not be read: the assistant is signed out.",
    },
];

const time = (capturedAt: number) =>
    capturedAt >= 1_700_000_000_000 ? "just now" : "10 minutes ago";

export function RigProviderUsageBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-015"
            summary="How much of each provider account's plan this machine has spent: one card per account, carrying the windows that vendor reports and whatever credit is left once they are gone."
            title="RigProviderUsagePage"
        >
            <FullScreenSpecimen
                detail="Three accounts: one with room, one spent with credits behind it, one that could not be read."
                label="Accounts"
                number="01"
            >
                <RigProviderUsagePage providers={providers} readingTime={time} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Before the first reading arrives, so an empty list is not claimed early."
                label="Loading"
                number="02"
            >
                <RigProviderUsagePage loading providers={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="No assistant is signed in on this machine."
                label="No accounts"
                number="03"
            >
                <RigProviderUsagePage providers={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The reading failed; what was already read stays legible beneath the banner."
                label="Read error"
                number="04"
            >
                <RigProviderUsagePage
                    error={{ name: "UserError", message: "The Rig stopped reporting usage." }}
                    providers={providers}
                    readingTime={time}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
