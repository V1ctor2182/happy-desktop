import {
    entriesMerge,
    rigConversationAttachTurnTraces,
    type ComposerSnapshot,
    type ConversationEntry,
} from "happy2-state";
import { ConversationView } from "../../src/ConversationView";
import { Button } from "../../src/Button";
import { ComposerModelControl } from "../../src/ComposerModelControl";
import { RigSessionControls } from "../../src/RigSessionControls";
import { rigComposerModelControlProps } from "../../src/rigComposerModelControl";
import { ComponentPage, Specimen } from "../kit";
import { conversationEntries, rigMenus } from "./rigChatFixtures";

const baseUserMessage = conversationEntries.find(
    (entry) => entry.kind === "message" && entry.message.sender?.kind === "human",
);
const baseTool = conversationEntries.find(
    (entry) => entry.kind === "agentActivity" && entry.activity.kind === "tool",
);
if (baseUserMessage?.kind !== "message" || baseTool?.kind !== "agentActivity")
    throw new Error("Conversation fixtures require user and tool entries");

const toolOnlySource: readonly ConversationEntry[] = [
    {
        ...baseUserMessage,
        message: {
            ...baseUserMessage.message,
            id: "tool-only:user",
            sequence: "1",
            changePts: "1",
            text: "Inspect the workspace and stop without a prose response.",
        },
    },
    {
        ...baseTool,
        id: "tool-only:tool",
        sequence: "2",
    },
];

const toolOnlyTurn = entriesMerge(
    [],
    rigConversationAttachTurnTraces(toolOnlySource, {
        expandedTurnIds: new Set(),
        durations: new Map([["tool-only:user", 123_000]]),
    }),
);

const expandedToolOnlyTurn = entriesMerge(
    [],
    rigConversationAttachTurnTraces(toolOnlySource, {
        expandedTurnIds: new Set(["tool-only:user"]),
        durations: new Map([["tool-only:user", 123_000]]),
    }),
);

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
                detail="running conversation · empty draft, so the send control stops the run"
                label="Primary"
                number="01"
                stage="app"
            >
                <div style={{ width: "980px", height: "660px", display: "flex" }}>
                    <ConversationView
                        composer={composer({ text: "" })}
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

            <Specimen
                detail="a delegated session keeps its transcript and configuration visible while its composer explains that replies belong in the parent"
                label="Read-only subagent"
                number="04"
                stage="app"
            >
                <div style={{ width: "980px", height: "440px", display: "flex" }}>
                    <ConversationView
                        composer={composer()}
                        composerControls={
                            <ComposerModelControl
                                {...rigComposerModelControlProps(rigMenus, {
                                    disabled: true,
                                    onEffortChange: () => undefined,
                                    onModelChange: () => undefined,
                                })}
                            />
                        }
                        composerDisabled
                        composerFooterControl={
                            <RigSessionControls
                                disabled
                                fields={["permission", "tier"]}
                                menuPlacement="above"
                                menus={rigMenus}
                                onEffortChange={() => undefined}
                                onModelChange={() => undefined}
                                onPermissionModeChange={() => undefined}
                                onServiceTierChange={() => undefined}
                                variant="ghost"
                            />
                        }
                        composerPlaceholder="Subagent chats are read-only"
                        entries={conversationEntries.slice(0, 3)}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        subtitle="~/happy2"
                        title="Subagent"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="a collapsed tool-only section synthesizes one faint empty assistant result before its footer"
                label="Tool-only turn"
                number="05"
                stage="app"
            >
                <div style={{ width: "980px", height: "440px", display: "flex" }}>
                    <ConversationView
                        agentAuthor={{
                            id: "rig:agent",
                            displayName: "Happy",
                            username: "happy",
                            kind: "agent",
                            agentRole: "default",
                        }}
                        composer={composer()}
                        data-testid="tool-only-turn"
                        entries={toolOnlyTurn}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        subtitle="~/happy2"
                        title="Tool-only turn"
                        viewerId="rig:owner"
                    />
                </div>
            </Specimen>

            <Specimen
                detail="expanded mode preserves the original tool row order and omits the collapsed-only placeholder"
                label="Tool-only turn expanded"
                number="06"
                stage="app"
            >
                <div style={{ width: "980px", height: "480px", display: "flex" }}>
                    <ConversationView
                        agentAuthor={{
                            id: "rig:agent",
                            displayName: "Happy",
                            username: "happy",
                            kind: "agent",
                            agentRole: "default",
                        }}
                        composer={composer()}
                        data-testid="tool-only-turn-expanded"
                        entries={expandedToolOnlyTurn}
                        expandedTurnIds={new Set(["tool-only:user"])}
                        onComposerSend={() => undefined}
                        onComposerValueChange={() => undefined}
                        subtitle="~/happy2"
                        title="Tool-only turn expanded"
                        viewerId="rig:owner"
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
