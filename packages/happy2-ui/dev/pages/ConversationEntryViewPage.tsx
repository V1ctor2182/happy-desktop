import type { ConversationMessageEntry } from "happy2-state";
import { ConversationEntryView } from "../../src/ConversationEntryView";
import { ComponentPage, Specimen } from "../kit";
import { conversationEntries, rigUserInput } from "./rigChatFixtures";

const baseAgentMessage = conversationEntries.find(
    (entry): entry is ConversationMessageEntry =>
        entry.kind === "message" && entry.message.sender?.kind === "agent",
);
if (!baseAgentMessage) throw new Error("Conversation fixture requires an agent message");

const collapsedEmptyTurn: ConversationMessageEntry = {
    ...baseAgentMessage,
    message: {
        ...baseAgentMessage.message,
        id: "collapsed-empty-turn",
        sequence: "collapsed-empty-turn",
        changePts: "collapsed-empty-turn",
        text: "",
        generationStatus: "complete",
        agentTrace: {
            turnId: "turn-tool-only",
            agentUserId: "rig:agent",
            status: "complete",
            entryCount: 3,
            toolCallCount: 2,
            subagents: [],
            backgroundTerminals: [],
        },
    },
};

export function ConversationEntryViewPage() {
    return (
        <ComponentPage
            number="C-149"
            summary="Renders one ConversationEntry through the shared chat vocabulary: an authored message, one agent-activity row, a service notice, a section divider, or a request waiting on the reader."
            title="ConversationEntryView"
        >
            <Specimen
                detail="messages, activity, notices, and dividers in conversation order"
                label="Every entry kind"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        width: "760px",
                    }}
                >
                    {conversationEntries.map((entry) => (
                        <ConversationEntryView
                            entry={entry}
                            key={entry.kind === "message" ? entry.message.id : entry.id}
                            viewerId="rig:owner"
                        />
                    ))}
                </div>
            </Specimen>

            <Specimen
                detail="a request entry rendered in place, awaiting an answer"
                label="Request"
                number="02"
                stage="surface"
            >
                <div style={{ width: "760px" }}>
                    <ConversationEntryView
                        entry={{
                            kind: "request",
                            id: "request:req-1",
                            sequence: "1",
                            request: rigUserInput,
                        }}
                        onRequestAnswer={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="a collapsed tool-only turn keeps a faint italic summary instead of becoming an empty row"
                label="Collapsed turn without text"
                number="03"
                stage="app"
            >
                <div style={{ width: "760px" }}>
                    <ConversationEntryView
                        data-testid="collapsed-empty-turn"
                        entry={collapsedEmptyTurn}
                        onTraceToggle={() => undefined}
                        traceOpen={false}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
