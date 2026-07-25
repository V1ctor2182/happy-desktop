import { ConversationEntryView } from "../../src/ConversationEntryView";
import { ComponentPage, Specimen } from "../kit";
import { conversationEntries, rigUserInput } from "./rigChatFixtures";

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
        </ComponentPage>
    );
}
