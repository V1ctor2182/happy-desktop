import type { ComposerSnapshot } from "happy2-state";
import { AppShell } from "../../src/AppShell";
import { Box } from "../../src/Box";
import { ComposerModelControl } from "../../src/ComposerModelControl";
import {
    ComposerFooterBar,
    ConversationDock,
    FloatingConversationDock,
} from "../../src/ConversationDock";
import { RigControlMenu, RigSessionControls } from "../../src/RigSessionControls";
import { Sidebar } from "../../src/Sidebar";
import { rigComposerModelControlProps } from "../../src/rigComposerModelControl";
import { ComponentPage, FullScreenSpecimen, Specimen } from "../kit";
import { rigMenus } from "./rigChatFixtures";

const commands = [
    { id: "usage", label: "/usage", description: "Token usage for the session." },
    { id: "tasks", label: "/tasks", description: "Show the session task list." },
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

const noop = () => undefined;

const chatItems = [
    { kind: "label" as const, label: "happy2" },
    { kind: "item" as const, id: "happy2|ses_a", label: "Local settings", icon: "check" as const },
    { kind: "item" as const, id: "happy2|ses_b", label: "Panel expansion" },
    { kind: "separator" as const },
    { kind: "label" as const, label: "happy2 · worktree-3" },
    { kind: "item" as const, id: "wt3|ses_c", label: "Provider catalog" },
];

function dock(value: string) {
    return (
        <ConversationDock
            composer={composer({ text: value })}
            composerControls={
                <ComposerModelControl
                    {...rigComposerModelControlProps(rigMenus, {
                        onEffortChange: noop,
                        onModelChange: noop,
                    })}
                />
            }
            composerFooterControl={
                <ComposerFooterBar
                    leading={
                        <RigSessionControls
                            fields={["permission", "tier"]}
                            menuPlacement="above"
                            menus={rigMenus}
                            onEffortChange={noop}
                            onModelChange={noop}
                            onPermissionModeChange={noop}
                            onServiceTierChange={noop}
                        />
                    }
                    trailing={
                        <RigControlMenu
                            items={chatItems}
                            label="Chat"
                            menuAlign="end"
                            menuPlacement="above"
                            menuWidth={280}
                            onSelect={noop}
                            value="Local settings"
                        />
                    }
                />
            }
            composerPlaceholder="Message Happy…"
            onComposerSend={noop}
            onComposerValueChange={noop}
        />
    );
}

/** Long monospace body so the gradient has real content to fade out. */
function panelBody() {
    return (
        <Box
            style={{
                display: "flex",
                flex: "1 1 0%",
                flexDirection: "column",
                minHeight: "0",
                overflowY: "auto",
            }}
        >
            <Box
                style={{
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    fontFamily: "var(--happy2-font-mono)",
                    fontSize: "12px",
                    gap: "4px",
                    lineHeight: "18px",
                    padding: "16px",
                }}
            >
                {Array.from({ length: 60 }, (_, index) => (
                    <span key={index}>
                        {`${String(index + 1).padStart(3, "0")}  packages/happy2-ui/src/ConversationDock.tsx`}
                    </span>
                ))}
            </Box>
        </Box>
    );
}

export function FloatingConversationDockPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-167"
            summary="The composer floated over a surface that owns its own scrolling. The dock leaves the flow so the surface keeps its full height, and a masked gradient fades passing content out instead of slicing it."
            title="Floating conversation dock"
        >
            <Specimen
                detail="The dock over a scrolling body: the surface keeps its height and fades under the gradient"
                label="Floating dock"
                number="01"
                stage="surface"
            >
                <Box
                    style={{
                        position: "relative",
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        background: "var(--surface)",
                        height: "420px",
                        width: "100%",
                    }}
                >
                    {panelBody()}
                    <FloatingConversationDock>{dock("")}</FloatingConversationDock>
                </Box>
            </Specimen>
            <FullScreenSpecimen
                detail="The expanded workspace panel: it covers the workspace column, the sidebar stays, and the dock floats at the bottom"
                label="Expanded panel with the dock"
                number="02"
            >
                <AppShell
                    onPanelMaximizedChange={noop}
                    panel={panelBody()}
                    panelFooter={<FloatingConversationDock>{dock("")}</FloatingConversationDock>}
                    panelFooterFloating
                    panelMaximizable
                    panelMaximized
                    panelResizable
                    sidebar={
                        <Sidebar
                            activeItemId="happy2"
                            brand
                            onItemSelect={noop}
                            sections={[
                                {
                                    id: "projects",
                                    label: "This Mac",
                                    items: [
                                        { id: "happy2", kind: "project", label: "happy2" },
                                        {
                                            id: "wt3",
                                            kind: "workspace",
                                            label: "worktree-3",
                                            depth: 1,
                                        },
                                    ],
                                },
                            ]}
                        />
                    }
                >
                    <Box style={{ display: "flex", flex: "1 1 0%" }} />
                </AppShell>
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="Docked at its ordinary width for comparison: the dock belongs only to the expanded panel"
                label="Docked panel"
                number="03"
            >
                <AppShell
                    onPanelMaximizedChange={noop}
                    panel={panelBody()}
                    panelMaximizable
                    panelResizable
                    sidebar={
                        <Sidebar
                            activeItemId="happy2"
                            brand
                            onItemSelect={noop}
                            sections={[
                                {
                                    id: "projects",
                                    label: "This Mac",
                                    items: [{ id: "happy2", kind: "project", label: "happy2" }],
                                },
                            ]}
                        />
                    }
                >
                    <Box style={{ display: "flex", flex: "1 1 0%" }} />
                </AppShell>
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
