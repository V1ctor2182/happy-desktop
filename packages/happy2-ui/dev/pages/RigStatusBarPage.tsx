import type { RigMenusSnapshot } from "happy2-state";
import { RigStatusBar } from "../../src/RigStatusBar";
import { ComponentPage, Specimen } from "../kit";

const menus: RigMenusSnapshot = {
    modelOptions: [
        {
            providerId: "openai",
            modelId: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            disabled: false,
            current: true,
        },
    ],
    effortOptions: [{ level: "high", label: "High", current: true, isDefault: false }],
    permissionModeOptions: [{ mode: "workspace_write", label: "Workspace write", current: true }],
    serviceTierOptions: [{ tier: null, label: "Standard", current: true }],
    currentProviderId: "openai",
    currentModelId: "gpt-5.6-sol",
    currentEffort: "high",
    currentPermissionMode: "workspace_write",
    currentServiceTier: undefined,
};

export function RigStatusBarPage() {
    return (
        <ComponentPage
            number="C-158"
            summary="Rig footer / status bar (`#renderForter`): dim `·`-separated model+reasoning, cwd, `queued N`, and permission mode, plus inline background-terminal and subagent running summaries."
            title="RigStatusBar"
        >
            <Specimen
                detail="model+reasoning, cwd, queued count, and permission mode"
                label="Primary"
                number="01"
                stage="surface"
            >
                <div style={{ width: "760px" }}>
                    <RigStatusBar cwd="~/happy2" menus={menus} queuedCount={2} />
                </div>
            </Specimen>

            <Specimen
                detail="with inline running background-terminal and subagent summaries"
                label="With monitors"
                number="02"
                stage="surface"
            >
                <div style={{ width: "760px" }}>
                    <RigStatusBar
                        backgroundCount={3}
                        cwd="~/happy2"
                        menus={menus}
                        runningSubagentCount={1}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
