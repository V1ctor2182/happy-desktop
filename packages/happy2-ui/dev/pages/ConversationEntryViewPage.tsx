import type { ConversationEntry, ConversationMessageEntry } from "happy2-state";
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

/** The row an expanded turn hangs "Hide traces" on: its first step. */
const expandedTurnLead = {
    kind: "agentActivity",
    id: "expanded-turn-lead",
    sequence: "expanded-turn-lead",
    activity: {
        kind: "tool",
        tool: {
            toolCallId: "expanded-turn-lead-call",
            toolName: "Read",
            arguments: { path: "src/mutex.ts" },
            status: "success",
            failed: false,
            display: "src/mutex.ts",
        },
    },
    agentTrace: {
        turnId: "turn-tool-only",
        agentUserId: "rig:agent",
        status: "complete",
        entryCount: 3,
        toolCallCount: 2,
        subagents: [],
        backgroundTerminals: [],
    },
} satisfies ConversationEntry;

const failureTurnAuthor = {
    id: "rig:agent",
    displayName: "Happy",
    kind: "agent",
    username: "happy",
} as const;

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
            <Specimen
                detail="an open turn carries the control on its first step, so a turn that answered nothing still folds back up"
                label="Expanded turn lead"
                number="04"
                stage="app"
            >
                <div style={{ width: "760px" }}>
                    <ConversationEntryView
                        activityAuthor={failureTurnAuthor}
                        data-testid="expanded-turn-lead"
                        entry={expandedTurnLead}
                        onTraceToggle={() => undefined}
                        traceOpen
                    />
                </div>
            </Specimen>
            <Specimen
                detail="a turn that failed before doing anything else still opens with the agent's identity"
                label="Failure-only turn"
                number="05"
                stage="app"
            >
                <div style={{ width: "760px" }}>
                    <ConversationEntryView
                        activityAuthor={failureTurnAuthor}
                        entry={{
                            kind: "notice",
                            id: "notice-retry-1",
                            variant: "notice",
                            level: "warning",
                            retry: { attempt: 1, maxAttempts: 10 },
                            text: "Claude API authentication failed (HTTP 401); retrying in 508 ms, attempt 1 of 10.",
                            sequence: "notice-retry-1",
                        }}
                    />
                    <ConversationEntryView
                        entry={{
                            kind: "notice",
                            id: "notice-retry-2",
                            variant: "notice",
                            level: "warning",
                            retry: { attempt: 2, maxAttempts: 10 },
                            text: "Claude API authentication failed (HTTP 401); retrying in 1.2 s, attempt 2 of 10.",
                            sequence: "notice-retry-2",
                        }}
                    />
                    <ConversationEntryView
                        entry={{
                            kind: "notice",
                            id: "notice-failure",
                            variant: "notice",
                            level: "error",
                            title: "Failure",
                            text: "Failed to authenticate. API Error: 401 OAuth access token has been revoked.",
                            sequence: "notice-failure",
                        }}
                    />
                    <ConversationEntryView
                        entry={{
                            kind: "turnStatus",
                            id: "turn-status:failure",
                            sequence: "turn-status",
                            status: "failed",
                            durationMs: 2_000,
                        }}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
