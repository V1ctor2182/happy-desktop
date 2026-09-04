import { type ComposerSnapshot, type ConversationEntry } from "happy-desktop-state";
import { ConversationView } from "../../src/ConversationView";
import { QueuedPromptList, type QueuedPrompt } from "../../src/QueuedPromptList";
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
    message("05", "you", "Finally, write the release note.", "pending_queue"),
];

const PROMPTS: readonly QueuedPrompt[] = [
    { id: "q1", text: "Then update the provider status copy.", delivery: "queue" },
    { id: "q2", text: "Use this detail in the current run too.", delivery: "steer" },
    {
        id: "q3",
        text: "Finally, write the release note, mention the refresh fix, the provider status copy, and the new queue controls, and keep it under a hundred words.",
        delivery: "queue",
    },
];

export function QueuedPromptsPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Prompts sent during a run wait in a list docked above the composer, each still the reader's to send into the current run, take back, or edit."
            title="Queued prompts"
        >
            <Specimen
                detail="two queued prompts and one steering prompt wait above the composer while the transcript keeps only what has happened"
                label="Active run"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        border: "1px solid var(--divider)",
                        borderRadius: "8px",
                        display: "flex",
                        height: "480px",
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
                        onQueuedPromptEdit={noop}
                        onQueuedPromptRemove={noop}
                        onQueuedPromptSteer={noop}
                        running
                        style={{ flex: "1 1 auto", minWidth: 0 }}
                        viewerId="happy-agent:owner"
                        workingPhase="callingTools"
                        workingLabel="Inspecting provider state"
                    />
                </div>
                <DimensionRule label="720 × 480 · queue docked above the composer" />
            </Specimen>
            <Specimen
                detail="the list alone: a waiting row offers Send now, an in-flight row states it, a long prompt keeps to one line"
                label="Rows"
                number="02"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <QueuedPromptList
                        items={PROMPTS}
                        onEdit={noop}
                        onRemove={noop}
                        onSteer={noop}
                    />
                </div>
                <DimensionRule label="560 wide · 36px rows · 16px radius" />
            </Specimen>
            <Specimen
                detail="without an owner willing to change the queue, the rows only report it"
                label="Read only"
                number="03"
                stage="surface"
            >
                <div style={{ width: "560px" }}>
                    <QueuedPromptList items={PROMPTS.slice(0, 2)} />
                </div>
                <DimensionRule label="560 wide · no Send now or remove controls" />
            </Specimen>
        </ComponentPage>
    );
}
