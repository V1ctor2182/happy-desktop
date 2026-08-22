import type { ReactNode } from "react";
import type { HappyAgentMenusSnapshot } from "happy-desktop-state";
import {
    HappyAgentCreateSessionDialog,
    type HappyAgentCreateSessionDestination,
} from "../../src/HappyAgentCreateSessionDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-238";

/** Desktop canvas the dialog is reviewed on, and the Electron minimum window. */
const FRAME = { height: "640px", width: "1000px" };
const MINIMUM_WINDOW = { height: "480px", width: "720px" };

/** The dialog is fixed to the window it is in, so a specimen gives it one. */
function frame(children: ReactNode, size: { height: string; width: string } = FRAME) {
    return (
        <div
            style={{
                background: "var(--groupped-background)",
                border: "1px solid var(--surface-pressed-overlay)",
                borderRadius: "8px",
                height: size.height,
                overflow: "hidden",
                position: "relative",
                transform: "translateZ(0)",
                width: size.width,
            }}
        >
            {children}
        </div>
    );
}

const DESTINATIONS: readonly HappyAgentCreateSessionDestination[] = [
    { displayPath: "~/Developer/happy2", id: "prj_happy2", label: "happy2" },
    {
        displayPath: "~/Happy/Workspaces/happy2/global-create-modal",
        id: "wt_create",
        label: "global-create-modal",
        parentLabel: "happy2",
    },
    { displayPath: "~/Developer/happy-agent", id: "prj_happy_agent", label: "happy-agent" },
    { displayPath: "~", id: "prj_home", label: "Home" },
];

const MENUS: HappyAgentMenusSnapshot = {
    currentEffort: "high",
    currentModelId: "opus-5",
    currentPermissionMode: "auto",
    currentProviderId: "anthropic",
    effortOptions: [
        { current: false, isDefault: false, label: "Low", level: "low" },
        { current: false, isDefault: true, label: "Medium", level: "medium" },
        { current: true, isDefault: false, label: "High", level: "high" },
        { current: false, isDefault: false, label: "Extra high", level: "xhigh" },
    ],
    modelOptions: [
        {
            current: true,
            disabled: false,
            modelId: "opus-5",
            name: "Claude Opus 5",
            providerId: "anthropic",
        },
        {
            current: false,
            disabled: false,
            modelId: "sonnet-5",
            name: "Claude Sonnet 5",
            providerId: "anthropic",
        },
        {
            current: false,
            disabled: true,
            modelId: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            providerId: "codex",
        },
    ],
    permissionModeOptions: [
        { current: true, label: "Auto", mode: "auto" },
        { current: false, label: "Workspace write", mode: "workspace_write" },
        { current: false, label: "Read only", mode: "read_only" },
        { current: false, label: "Full access", mode: "full_access" },
    ],
    serviceTierOptions: [
        { current: true, label: "Standard", tier: null },
        { current: false, label: "Fast", tier: "fast" },
    ],
};

const LONG_TASK = [
    "Move the create experience out of the workspace body and mount it once at the",
    "application shell, so it answers from the conversation, Usage, Inbox, Notes and",
    "Project routes alike.",
    "",
    "Keep the draft while the surface behind it changes, clear it only once a session",
    "has actually started, and prove the whole thing at 720×480 and 1280×800 in both",
    "appearances before calling it done.",
].join("\n");

const HANDLERS = {
    onClose: () => {},
    onDestinationSelect: () => {},
    onEffortChange: () => {},
    onKeepOpenChange: () => {},
    onModelChange: () => {},
    onPermissionModeChange: () => {},
    onServiceTierChange: () => {},
    onSubmit: () => {},
    onTextChange: () => {},
} as const;

export function HappyAgentCreateSessionDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="The window's global Create: the task, where it runs, and how the session that does it is configured."
            title="HappyAgentCreateSessionDialog"
        >
            <Specimen
                detail="640px · empty task · destination and configuration ready"
                label="Opened"
                number="01"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="prj_happy2"
                        destinations={DESTINATIONS}
                        keepOpen={false}
                        menus={MENUS}
                        text=""
                    />,
                )}
                <DimensionRule label="modal large 640px · task field 160px" />
            </Specimen>
            <Specimen
                detail="a written task in a worktree · the commit is live"
                label="Written"
                number="02"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="wt_create"
                        destinations={DESTINATIONS}
                        keepOpen
                        menus={MENUS}
                        text="Rebase onto origin/main and rerun the focused checks for the packages this touched."
                    />,
                )}
            </Specimen>
            <Specimen
                detail="a task longer than the field · the field scrolls, the card does not move"
                label="Long task"
                number="03"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="prj_happy2"
                        destinations={DESTINATIONS}
                        keepOpen={false}
                        menus={MENUS}
                        text={LONG_TASK}
                    />,
                )}
            </Specimen>
            <Specimen
                detail="the session is being started · the choices go inert and the commit says so, while the task keeps its caret and Cancel stays live"
                label="Starting"
                number="04"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="prj_happy2"
                        destinations={DESTINATIONS}
                        keepOpen={false}
                        menus={MENUS}
                        submitting
                        text="Add the missing provider row to the usage surface."
                    />,
                )}
            </Specimen>
            <Specimen
                detail="the start failed · the task is kept and the reason is stated"
                label="Failed"
                number="05"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="wt_create"
                        destinations={DESTINATIONS}
                        error="The daemon could not prepare that workspace: git worktree add failed."
                        keepOpen={false}
                        menus={MENUS}
                        text="Add the missing provider row to the usage surface."
                    />,
                )}
            </Specimen>
            <Specimen
                detail="the machine has not answered yet · nothing to choose and nothing to start"
                label="Reading projects"
                number="06"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinations={[]}
                        destinationsLoading
                        keepOpen={false}
                        text=""
                    />,
                )}
            </Specimen>
            <Specimen
                detail="a machine with no project · the task can be written but not started"
                label="No project"
                number="07"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinations={[]}
                        keepOpen={false}
                        text="Look at why the daemon lists nothing."
                    />,
                )}
            </Specimen>
            <Specimen
                detail="the 720×480 Electron minimum · header and footer stay, the body scrolls · the field caps itself against the window rather than this frame, so in a real 480px window it gives up lines to keep the project in view"
                label="Minimum window"
                number="08"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="prj_happy2"
                        destinations={DESTINATIONS}
                        keepOpen={false}
                        menus={MENUS}
                        text="Reduce the panel's first paint to one layout pass."
                    />,
                    MINIMUM_WINDOW,
                )}
                <DimensionRule label="720 × 480 minimum window" />
            </Specimen>
            <Specimen
                detail="known Happy Agent offline · task and choices stay editable · only starting the session is unavailable"
                label="Happy Agent offline"
                number="09"
                stage="app"
            >
                {frame(
                    <HappyAgentCreateSessionDialog
                        {...HANDLERS}
                        destinationId="prj_happy2"
                        destinations={DESTINATIONS}
                        keepOpen={false}
                        menus={MENUS}
                        submitDisabledReason="Happy Agent is offline. The draft is preserved."
                        text="Keep this task ready until the Happy Agent reconnects."
                    />,
                )}
            </Specimen>
        </ComponentPage>
    );
}
