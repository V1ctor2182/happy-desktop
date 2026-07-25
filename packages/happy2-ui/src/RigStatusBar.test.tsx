import { expect, it } from "vitest";
import type { RigMenusSnapshot } from "happy2-state";
import "./theme.css";
import "./styles/rig-status.css";
import { RigStatusBar } from "./RigStatusBar";
import { createRenderer } from "./testing";

const menus: RigMenusSnapshot = {
    modelOptions: [
        {
            providerId: "openai",
            modelId: "gpt",
            name: "GPT-5.6 Sol",
            disabled: false,
            current: true,
        },
    ],
    effortOptions: [{ level: "high", label: "High", current: true, isDefault: false }],
    permissionModeOptions: [{ mode: "workspace_write", label: "Workspace write", current: true }],
    serviceTierOptions: [{ tier: null, label: "Standard", current: true }],
    currentProviderId: "openai",
    currentModelId: "gpt",
    currentEffort: "high",
    currentPermissionMode: "workspace_write",
    currentServiceTier: undefined,
};

it("renders model, cwd, queued count, and lowercased permission mode", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "760px" }}>
                <RigStatusBar cwd="~/happy2" menus={menus} queuedCount={2} />
            </div>
        ),
        { width: 800, height: 120, padding: 12 },
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="rig-status-model"]').element.textContent).toContain(
        "GPT-5.6 Sol",
    );
    expect(view.$('[data-happy2-ui="rig-status-model"]').element.textContent).toContain("High");
    expect(view.$('[data-happy2-ui="rig-status-cwd"]').element.textContent).toBe("~/happy2");
    expect(view.$('[data-happy2-ui="rig-status-queued"]').element.textContent).toBe("queued 2");
    // Permission mode is lowercased in the footer.
    expect(view.$('[data-happy2-ui="rig-status-permission"]').element.textContent).toBe(
        "workspace write",
    );
    // No running monitors → no monitors row.
    expect(view.container.querySelector('[data-happy2-ui="rig-status-monitors"]')).toBeNull();

    await view.screenshot("RigStatusBar.test");
}, 120_000);

it("shows inline background-terminal and subagent running summaries", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "760px" }}>
                <RigStatusBar
                    backgroundCount={3}
                    cwd="~/happy2"
                    menus={menus}
                    runningSubagentCount={1}
                />
            </div>
        ),
        { width: 800, height: 140, padding: 12 },
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="rig-status-agents"]').element.textContent).toContain(
        "1 agent running · /agents to view",
    );
    expect(view.$('[data-happy2-ui="rig-status-background"]').element.textContent).toContain(
        "3 background terminals running · /ps to view · /stop to close",
    );
    // No queued messages → no queued segment.
    expect(view.container.querySelector('[data-happy2-ui="rig-status-queued"]')).toBeNull();
}, 120_000);
