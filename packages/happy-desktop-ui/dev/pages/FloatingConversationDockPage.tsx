import type { ComposerSnapshot } from "happy-desktop-state";
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
import { videoClipWide } from "./videoClips";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-167";

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

const imagePreview = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="#172554"/><circle cx="116" cy="44" r="24" fill="#fbbf24"/><path d="M0 132 54 70l34 38 22-22 50 50v24H0Z" fill="#22d3ee"/><path d="M0 144 54 82l34 38 22-22 50 50v12H0Z" fill="#f472b6"/></svg>',
)}`;

function attachmentFixtures(): ComposerSnapshot["attachments"] {
    return [
        {
            kind: "workspaceFile",
            id: "attachment:image",
            name: "reference.png",
            size: 842_137,
            mediaType: "image/png",
            file: new File([], "reference.png", { type: "image/png" }),
            previewUrl: imagePreview,
        },
        {
            kind: "workspaceFile",
            id: "attachment:video",
            name: "walkthrough.webm",
            size: 8_231_091,
            mediaType: "video/webm",
            file: new File([], "walkthrough.webm", { type: "video/webm" }),
            previewUrl: videoClipWide,
        },
        {
            kind: "workspaceFile",
            id: "attachment:file",
            name: "requirements.pdf",
            size: 124_928,
            mediaType: "application/pdf",
            file: new File([], "requirements.pdf", { type: "application/pdf" }),
        },
    ];
}

const chatItems = [
    { kind: "label" as const, label: "happy2" },
    { kind: "item" as const, id: "happy2|ses_a", label: "Local settings", icon: "check" as const },
    { kind: "item" as const, id: "happy2|ses_b", label: "Panel expansion" },
    { kind: "separator" as const },
    { kind: "label" as const, label: "happy2 · worktree-3" },
    { kind: "item" as const, id: "wt3|ses_c", label: "Provider catalog" },
];

function dock(
    value: string,
    unavailable?: string,
    attachments: ComposerSnapshot["attachments"] = [],
) {
    return (
        <ConversationDock
            composer={composer({ attachments, text: value })}
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
                            variant="ghost"
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
                            variant="ghost"
                            onSelect={noop}
                            value="Local settings"
                        />
                    }
                />
            }
            composerPlaceholder="Message Happy…"
            onComposerAttachmentRemove={noop}
            onComposerAttachmentsSelect={noop}
            onComposerSend={noop}
            onComposerValueChange={noop}
            submitDisabled={unavailable !== undefined}
            unavailable={unavailable}
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
                        {`${String(index + 1).padStart(3, "0")}  packages/happy-desktop-ui/src/ConversationDock.tsx`}
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
            number={componentNumber}
            summary="The composer at a surface edge: either fully overlaid or reserving only its input height, with the same masked gradient fading content into it."
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
                detail="The expanded workspace panel: the input reserves only its own height while the 72px fade floats over the content above it"
                label="Expanded panel with the dock"
                number="02"
            >
                <AppShell
                    onPanelMaximizedChange={noop}
                    panel={panelBody()}
                    panelFooter={
                        <FloatingConversationDock placement="footer">
                            {dock("")}
                        </FloatingConversationDock>
                    }
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
            <Specimen
                detail="known Rig offline · the draft remains editable while submission is unavailable"
                label="Rig offline"
                number="04"
                stage="surface"
            >
                <Box
                    style={{
                        background: "var(--surface)",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: "260px",
                        justifyContent: "flex-end",
                    }}
                >
                    {dock(
                        "Keep this draft here until the Rig reconnects.",
                        "Rig is offline. The draft is preserved.",
                    )}
                </Box>
            </Specimen>
            <Specimen
                detail="56px image, video, and file previews · removable · above the text"
                label="Draft attachments"
                number="05"
                stage="surface"
            >
                <Box
                    style={{
                        background: "var(--surface)",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: "240px",
                        justifyContent: "flex-end",
                        width: "520px",
                    }}
                >
                    {dock(
                        "Compare these before making the change.",
                        undefined,
                        attachmentFixtures(),
                    )}
                </Box>
            </Specimen>
        </ComponentPage>
    );
}
