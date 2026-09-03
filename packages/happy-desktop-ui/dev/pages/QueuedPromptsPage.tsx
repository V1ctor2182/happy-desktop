import { type ComposerSnapshot, type ConversationEntry } from "happy-desktop-state";
import { ConversationView } from "../../src/ConversationView";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and page header share this value. */
export const componentNumber = "C-280";

const noop = () => undefined;

const COMPOSER: ComposerSnapshot = {
    agentUserIds: [],
    attachments: [],
    capabilities: { commands: [], mentions: false, shellMode: false },
    focused: false,
    mentionCandidates: [],
    revision: 0,
    scopeId: "queued-prompts",
    submission: { status: "idle" },
    text: "",
};

function message(
    id: string,
    author: "agent" | "you",
    text: string,
    delivery: "pending_queue" | "pending_steering" | "sent" = "sent",
): ConversationEntry {
    return {
        delivery,
        kind: "message",
        message: {
            attachments: [],
            changePts: id,
            chatId: "queued-prompts",
            createdAt: "2026-09-02T10:14:00.000Z",
            id,
            reactions: [],
            sender:
                author === "you"
                    ? {
                          displayName: "You",
                          id: "happy-agent:owner",
                          kind: "human",
                          username: "you",
                      }
                    : {
                          agentRole: "default",
                          displayName: "Happy",
                          id: "happy-agent:agent",
                          kind: "agent",
                          username: "happy",
                      },
            sequence: id,
            text,
        },
        source: "server",
    };
}

const ENTRIES: readonly ConversationEntry[] = [
    message("01", "you", "Audit the authentication refresh path."),
    message(
        "02",
        "agent",
        "I found the stale-token branch and I’m tracing its reconnect behavior now.",
    ),
    message("03", "you", "Then update the provider status copy.", "pending_queue"),
    message("04", "you", "Use this detail in the current run too.", "pending_steering"),
];

export function QueuedPromptsPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Queued and steering prompts remain visibly ordered beneath the live activity line with their exact pending state."
            title="Pending prompts"
        >
            <Specimen
                detail="one queued prompt and one steering prompt wait beneath current activity without reading as accepted history"
                label="Active run"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        border: "1px solid var(--divider)",
                        borderRadius: "8px",
                        display: "flex",
                        height: "420px",
                        overflow: "hidden",
                        width: "720px",
                    }}
                >
                    <ConversationView
                        activityTreatment="focused"
                        composer={COMPOSER}
                        composerPlaceholder="Message Happy…"
                        conversationId="queued-prompts"
                        elapsedMs={38_000}
                        entries={ENTRIES}
                        motion="calm-typed"
                        onComposerSend={noop}
                        onComposerValueChange={noop}
                        running
                        style={{ flex: "1 1 auto", minWidth: 0 }}
                        viewerId="happy-agent:owner"
                        workingPhase="callingTools"
                        workingLabel="Inspecting provider state"
                    />
                </div>
                <DimensionRule label="720 × 420 · queued and steering prompts" />
            </Specimen>
        </ComponentPage>
    );
}
