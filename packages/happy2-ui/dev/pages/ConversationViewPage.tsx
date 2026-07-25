import type { ComposerSnapshot } from "happy2-state";
import { ConversationView } from "../../src/ConversationView";
import { Button } from "../../src/Button";
import { ComposerModelControl } from "../../src/ComposerModelControl";
import { RigSessionControls } from "../../src/RigSessionControls";
import { rigComposerModelControlProps } from "../../src/rigComposerModelControl";
import { ComponentPage, Specimen } from "../kit";
import { conversationEntries, rigMenus } from "./rigChatFixtures";

const commands = [
    { id: "usage", label: "/usage", description: "Token usage for the session." },
    { id: "tasks", label: "/tasks", description: "Show the session task list." },
    { id: "compact", label: "/compact", description: "Compact the conversation." },
    { id: "abort", label: "/abort", description: "Stop the current run." },
];

function composer(overrides: Partial<ComposerSnapshot> = {}): ComposerSnapshot {
    return {
        scopeId: "ses_alpha01234567",
        text: "",
        attachments: [],
        revision: 0,
        submission: { status: "idle" },
        focused: false,
        capabilities: { shellMode: true, commands, mentions: true },
        mentionCandidates: [],
        agentUserIds: [],
        ...overrides,
    };
}

export function ConversationViewPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-154"
            summary="The assembled conversation surface: channel header with live status and owner controls, the shared entry list, an optional owner panel, and the shared composer with its command palette."
            title="ConversationView"
        >
            <Specimen
                detail="running conversation with queued steering"
                label="Primary"
                number="01"
                stage="app"
            >
                <div style={{ width: "980px", height: "660px", display: "flex" }}>
                    <ConversationView
                        composer={composer({ text: "Now run the migration" })}
                        elapsedMs={92_000}
                        composerControls={
                            <>
                                <ComposerModelControl
                                    {...rigComposerModelControlProps(rigMenus, {
                                        onEffortChange: () => undefined,
                                        onModelChange: () => undefined,
                                    })}
                                />
                                <Button
                                    aria-label="Session settings"
                                    icon="settings"
                                    iconOnly
                                    size="small"
                                    variant="ghost"
                                />
                            </>
                        }
                        entries={conversationEntries}
                        onAbort={() => undefined}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        queued={[{ id: "q1", text: "Also update the changelog" }]}
                        running
                        subtitle="~/happy2"
                        title="Fix token rotation race"
                        viewerId="rig:owner"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="an open `/` command palette above the composer"
                label="Command palette"
                number="02"
                stage="app"
            >
                <div style={{ width: "980px", height: "520px", display: "flex" }}>
                    <ConversationView
                        composer={composer({ text: "/com", commandQuery: "com" })}
                        entries={conversationEntries.slice(0, 3)}
                        onCommandInvoke={() => undefined}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        subtitle="~/happy2"
                        title="Fix token rotation race"
                        viewerId="rig:owner"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="an idle conversation with nothing in it yet"
                label="Empty"
                number="03"
                stage="app"
            >
                <div style={{ width: "980px", height: "420px", display: "flex" }}>
                    <ConversationView
                        composer={composer()}
                        entries={[]}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        subtitle="~/scratch"
                        title="New session"
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
