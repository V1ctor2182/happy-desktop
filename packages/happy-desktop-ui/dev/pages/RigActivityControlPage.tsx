import {
    rigAgentAuthor,
    rigOwnerAuthor,
    type ComposerSnapshot,
    type ConversationEntry,
} from "happy-desktop-state";
import { ConversationView } from "../../src/ConversationView";
import { RigActivityControl } from "../../src/RigActivityControl";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
import { conversationEntries } from "./rigChatFixtures";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-264";

const noop = () => undefined;

const COMPOSER: ComposerSnapshot = {
    agentUserIds: [],
    attachments: [],
    capabilities: { commands: [], mentions: false, shellMode: false },
    focused: false,
    mentionCandidates: [],
    revision: 0,
    scopeId: "activity-control",
    submission: { status: "idle" },
    text: "",
};

/** The same transcript, closed by a settled turn the way a finished run ends. */
const SETTLED_ENTRIES: readonly ConversationEntry[] = [
    ...conversationEntries,
    {
        kind: "turnStatus",
        id: "turn-1",
        sequence: "99",
        status: "complete",
        reason: "completed",
        copyText: "The change is applied and tests pass.",
        durationMs: 261_000,
    },
];

/**
 * The transcript this entry lives in, at a chosen width. The summary is never
 * shown on its own: it is the trailing half of the working-status line, so the
 * specimen renders the conversation the product renders.
 */
function TranscriptStage(props: {
    readonly agents?: number;
    readonly running?: boolean;
    readonly terminals?: number;
    readonly width: number;
}) {
    const activity =
        (props.agents ?? 0) + (props.terminals ?? 0) > 0 ? (
            <RigActivityControl
                agents={props.agents}
                backgroundTerminals={props.terminals}
                onClick={noop}
            />
        ) : undefined;
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                borderRadius: "8px",
                display: "flex",
                height: "320px",
                overflow: "hidden",
                width: `${String(props.width)}px`,
            }}
        >
            <ConversationView
                activityControl={activity}
                activityTreatment="focused"
                agentAuthor={rigAgentAuthor}
                composer={COMPOSER}
                composerPlaceholder="Message Happy…"
                conversationId="activity-control"
                elapsedMs={28_000}
                entries={props.running === false ? SETTLED_ENTRIES : conversationEntries}
                motion="calm-typed"
                onComposerSend={noop}
                onComposerValueChange={noop}
                running={props.running ?? true}
                style={{ flex: "1 1 auto", minWidth: 0 }}
                viewerId={rigOwnerAuthor.id}
                workingPhase="thinking"
            />
        </div>
    );
}

export function RigActivityControlPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="The live-work summary that closes the working-status line: quiet secondary type at the far end of the running turn, dropped whole onto its own line when the pane is too narrow, and absent when no agent or terminal remains active."
            title="RigActivityControl"
        >
            <Specimen
                detail="active agents and a background terminal end the turn's own status line — one loader, one line"
                label="On the status line"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <TranscriptStage agents={2} terminals={1} width={720} />
                    <DimensionRule label="720 px wide · one 32 px status line" />
                </div>
            </Specimen>

            <Specimen
                detail="too narrow for both, so the summary wraps whole and starts on the clock's column"
                label="Wrapped"
                number="02"
                stage="surface"
            >
                <TranscriptStage agents={2} terminals={1} width={320} />
            </Specimen>

            <Specimen
                detail="one long-running terminal outlives its turn, so it closes the settled “Completed in” line instead of opening a row beneath it"
                label="Settled turn"
                number="03"
                stage="surface"
            >
                <TranscriptStage running={false} terminals={1} width={720} />
            </Specimen>

            <Specimen
                detail="settled agents and no live terminal produce no summary at all"
                label="Nothing running"
                number="04"
                stage="surface"
            >
                <TranscriptStage running={false} width={720} />
            </Specimen>
        </ComponentPage>
    );
}
