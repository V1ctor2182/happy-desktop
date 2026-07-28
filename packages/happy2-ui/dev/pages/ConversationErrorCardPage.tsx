import { type CSSProperties } from "react";
import type { ConversationEntry } from "happy2-state";
import { ConversationErrorCard } from "../../src/ConversationErrorCard";
import { ConversationEntryView } from "../../src/ConversationEntryView";
import { TurnSummary } from "../../src/TurnSummary";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const transcript: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    width: "760px",
};

const failedTurn: readonly ConversationEntry[] = [
    {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id: "failed-turn:message",
            chatId: "ses_failedturn",
            sequence: "1",
            changePts: "1",
            sender: {
                id: "rig:agent",
                displayName: "Happy",
                username: "happy",
                kind: "agent",
                agentRole: "default",
            },
            kind: "automated",
            automated: false,
            audience: "people",
            agentUserIds: [],
            text: "I finished the available portion of the migration and preserved the current work.",
            generationStatus: "failed",
            revision: 0,
            mentions: [],
            attachments: [],
            reactions: [],
            receipts: [],
            expiryMode: "none",
            createdAt: "2026-07-25T09:41:00.000Z",
        },
    },
    {
        kind: "notice",
        id: "failed-turn:error",
        sequence: "2",
        variant: "notice",
        level: "error",
        title: "Run failed",
        text: "You've hit your session limit · resets 1:10am (America/Los_Angeles)",
    },
    {
        kind: "turnStatus",
        id: "failed-turn:status",
        sequence: "3",
        status: "failed",
        durationMs: 482_000,
        copyText:
            "I finished the available portion of the migration and preserved the current work.",
    },
];

export function ConversationErrorCardPage() {
    return (
        <ComponentPage
            number="C-166"
            summary="A bubble-aligned error explanation that carries a failed turn's reason while the surrounding response and completion footer remain neutral."
            title="Conversation error card"
        >
            <Specimen
                detail="exact provider reason · neutral settled duration immediately below"
                label="Failed turn"
                number="01"
                stage="surface"
            >
                <div style={transcript}>
                    <ConversationErrorCard
                        reason="You've hit your session limit · resets 1:10am (America/Los_Angeles)"
                        title="Run failed"
                    />
                    <TurnSummary
                        className="happy2-conversation-turn-status"
                        copyText="I completed the available portion before the provider stopped."
                        durationMs={482_000}
                        status="complete"
                    />
                </div>
            </Specimen>
            <Specimen
                detail="long infrastructure reason wraps inside the 640px bubble cap"
                label="Detailed reason"
                number="02"
                stage="surface"
            >
                <div style={transcript}>
                    <ConversationErrorCard
                        reason="The provider connection closed while the response was streaming. Your partial response is preserved above, and you can continue this turn after the connection is available again."
                        title="Connection interrupted"
                    />
                    <DimensionRule label="760 px row · 640 px maximum bubble" />
                </div>
            </Specimen>
            <Specimen
                detail="failed assistant text settles without a red terminal dot; the reason and neutral footer follow in turn order"
                label="Integrated failed turn"
                number="03"
                stage="surface"
            >
                <div data-testid="failed-turn" style={transcript}>
                    {failedTurn.map((entry) => (
                        <ConversationEntryView
                            entry={entry}
                            key={entry.kind === "message" ? entry.message.id : entry.id}
                        />
                    ))}
                </div>
            </Specimen>
        </ComponentPage>
    );
}
