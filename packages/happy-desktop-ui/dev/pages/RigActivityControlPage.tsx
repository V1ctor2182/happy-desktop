import type { ReactNode } from "react";
import type { ConversationDelegationChild } from "happy-desktop-state";
import { AgentWorkingStatus } from "../../src/AgentWorkingStatus";
import { DelegatedAgentActivity } from "../../src/DelegatedAgentActivity";
import { RigActivityControl } from "../../src/RigActivityControl";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-264";

const NOW = 1_700_000_000_000;
const noop = () => undefined;

const runningChild = {
    sessionId: "activity-control-child",
    parentToolCallId: "activity-control-spawn",
    description: "Keep the transcript activity row aligned",
    taskName: "activity_row",
    modelId: "openai/gpt-5.6-terra",
    status: "running",
    createdAt: NOW - 115_000,
    activeSince: NOW - 115_000,
    totalTokens: 144_347,
} satisfies ConversationDelegationChild;

function TranscriptMeasure(props: { children: ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0", width: "720px" }}>
            <AgentWorkingStatus
                active
                className="happy2-conversation-turn-status"
                elapsedMs={28_000}
                motion="calm"
                phase="thinking"
            />
            <DelegatedAgentActivity child={runningChild} now={NOW} />
            {props.children}
        </div>
    );
}

export function RigActivityControlPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="A muted live-work entry beneath the latest transcript message: aligned with the turn status and delegated-agent rows, free of generic labels and status dots, and hidden when no agent or terminal remains active."
            title="RigActivityControl"
        >
            <Specimen
                detail="active agents and a background terminal · the compact entry uses the same live spinner as the main turn"
                label="Agents + terminal"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <TranscriptMeasure>
                        <RigActivityControl
                            agents={2}
                            backgroundTerminals={1}
                            onClick={noop}
                            spinnerFrame={3}
                        />
                    </TranscriptMeasure>
                    <DimensionRule label="720 px wide · 24 px row · turn-status text start" />
                </div>
            </Specimen>

            <Specimen
                detail="one long-running terminal is enough to keep the row visible after the parent turn completes"
                label="Terminal only"
                number="02"
                stage="surface"
            >
                <TranscriptMeasure>
                    <RigActivityControl backgroundTerminals={1} onClick={noop} spinnerFrame={3} />
                </TranscriptMeasure>
            </Specimen>

            <Specimen
                detail="settled agents and no live terminal produce no transcript entry"
                label="Settled — no row"
                number="03"
                stage="surface"
            >
                <TranscriptMeasure>
                    <RigActivityControl onClick={noop} />
                    <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
                        No live agents or terminals.
                    </span>
                </TranscriptMeasure>
            </Specimen>
        </ComponentPage>
    );
}
