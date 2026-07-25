import { RigChatView } from "../../src/RigChatView";
import { ComponentPage, Specimen } from "../kit";
import { rigMenus, rigTranscriptEntries, rigUserInput } from "./rigChatFixtures";

const noop = () => undefined;

const MENTION_FILES = [
    { fileName: "rigChatStore.ts", path: "packages/happy2-state/src/rig/rigChatStore.ts" },
    { fileName: "RigChatView.tsx", path: "packages/happy2-ui/src/RigChatView.tsx" },
    { fileName: "AppRigView.tsx", path: "packages/happy2-app/src/AppRigView.tsx" },
];

const searchFiles = (query: string) =>
    Promise.resolve(
        MENTION_FILES.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())),
    );

export function RigChatViewPage() {
    return (
        <ComponentPage
            number="C-154"
            summary="Assembled Rig chat surface: header with title/status/controls, scrolling transcript, pending input prompt, and a composer with send/stop."
            title="RigChatView"
        >
            <Specimen
                detail="running session with a pending user-input prompt above the composer"
                label="Running with prompt"
                number="01"
                stage="surface"
            >
                <div
                    style={{ width: "960px", height: "640px", border: "1px solid var(--divider)" }}
                >
                    <RigChatView
                        elapsedMs={42_000}
                        entries={rigTranscriptEntries}
                        menus={rigMenus}
                        onAbort={noop}
                        onAnswerInput={noop}
                        onEffortChange={noop}
                        onModelChange={noop}
                        onPermissionModeChange={noop}
                        onSend={noop}
                        onShellRun={noop}
                        onServiceTierChange={noop}
                        pendingUserInputs={[rigUserInput]}
                        queuedMessages={[
                            { id: "q1", text: "Also update the changelog once tests pass." },
                            { id: "q2", text: "Then push the branch." },
                        ]}
                        running
                        subtitle="~/happy2"
                        title="Fix token rotation race"
                    />
                </div>
            </Specimen>

            <Specimen detail="idle session, no prompts" label="Idle" number="02" stage="surface">
                <div
                    style={{ width: "960px", height: "560px", border: "1px solid var(--divider)" }}
                >
                    <RigChatView
                        commands={["new", "compact", "abort", "fork"]}
                        compactTurns={false}
                        entries={rigTranscriptEntries.slice(0, 5)}
                        menus={rigMenus}
                        onAbort={noop}
                        onAnswerInput={noop}
                        onCommand={noop}
                        onEffortChange={noop}
                        onFilesSearch={searchFiles}
                        onModelChange={noop}
                        onPermissionModeChange={noop}
                        onReasoningToggle={noop}
                        onSend={noop}
                        onServiceTierChange={noop}
                        onTurnCompactToggle={noop}
                        pendingUserInputs={[]}
                        running={false}
                        showReasoning
                        subtitle="~/happy2"
                        title="Fix token rotation race"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="usage panel open in place of the transcript, driven by the `/usage` poll"
                label="Usage open"
                number="03"
                stage="surface"
            >
                <div
                    style={{ width: "960px", height: "560px", border: "1px solid var(--divider)" }}
                >
                    <RigChatView
                        entries={rigTranscriptEntries.slice(0, 5)}
                        menus={rigMenus}
                        onAbort={noop}
                        onAnswerInput={noop}
                        onEffortChange={noop}
                        onModelChange={noop}
                        onPermissionModeChange={noop}
                        onSend={noop}
                        onServiceTierChange={noop}
                        onUsageToggle={noop}
                        pendingUserInputs={[]}
                        running={false}
                        subtitle="~/happy2"
                        title="Fix token rotation race"
                        usage={{
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
                            ],
                            totalTokens: 260_500,
                            totalCost: 1.42,
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
                                        {
                                            kind: "fiveHour",
                                            usedPercent: 42,
                                            resetsAt: Date.UTC(2026, 6, 25, 17, 0, 0),
                                        },
                                    ],
                                },
                            ],
                        }}
                        usageOpen
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
