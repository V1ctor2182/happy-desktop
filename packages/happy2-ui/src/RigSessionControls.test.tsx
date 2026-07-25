import { expect, it, vi } from "vitest";
import type { RigMenusSnapshot, RigModelSelection } from "happy2-state";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/badge.css";
import "./styles/menu.css";
import "./styles/rig-chat.css";
import { RigSessionControls } from "./RigSessionControls";
import { createRenderer } from "./testing";

const menus: RigMenusSnapshot = {
    modelOptions: [
        {
            providerId: "codex",
            modelId: "gpt-5.6-sol",
            name: "GPT Sol",
            disabled: false,
            current: true,
        },
        {
            providerId: "claude",
            modelId: "opus-4-8",
            name: "Opus",
            disabled: false,
            current: false,
        },
    ],
    effortOptions: [
        { level: "medium", label: "Medium", current: true, isDefault: true },
        { level: "high", label: "High", current: false, isDefault: false },
    ],
    permissionModeOptions: [
        { mode: "auto", label: "Auto", current: true },
        { mode: "read_only", label: "Read only", current: false },
    ],
    serviceTierOptions: [
        { tier: null, label: "Standard", current: true },
        { tier: "fast", label: "Fast", current: false },
    ],
    currentProviderId: "codex",
    currentModelId: "gpt-5.6-sol",
    currentEffort: "medium",
    currentPermissionMode: "auto",
    currentServiceTier: undefined,
};

it("opens a control menu, selects an option, and closes on outside pointer-down", async () => {
    const selections: RigModelSelection[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ padding: "40px", width: "620px", height: "260px" }}>
                <RigSessionControls
                    data-testid="controls"
                    menus={menus}
                    onEffortChange={() => undefined}
                    onModelChange={(selection) => selections.push(selection)}
                    onPermissionModeChange={() => undefined}
                    onServiceTierChange={() => undefined}
                />
            </div>
        ),
        { width: 700, height: 340, padding: 0 },
    );
    await view.ready();

    // Trigger shows the current value.
    expect(
        view.$('[data-testid="rig-control-model"] [data-happy2-ui="rig-control-value"]').element
            .textContent,
    ).toBe("GPT Sol");

    const trigger = view.$(
        '[data-testid="rig-control-model"] [data-happy2-ui="rig-control-trigger"]',
    ).element as HTMLButtonElement;
    expect(
        view.container.querySelector('[data-testid="rig-control-model"] [data-happy2-ui="menu"]'),
    ).toBeNull();

    trigger.click();
    await vi.waitFor(() =>
        expect(
            view.container.querySelector(
                '[data-testid="rig-control-model"] [data-happy2-ui="menu"]',
            ),
        ).not.toBeNull(),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Current option carries a check icon in its leading slot.
    expect(
        view.container.querySelector(
            '[data-testid="rig-control-model"] [data-item-id="codex gpt-5.6-sol"] [data-happy2-ui="menu-item-icon"] [data-name="check"]',
        ),
    ).not.toBeNull();

    // Choose the non-current model → parsed provider/model reported, menu closes.
    (
        view.$('[data-testid="rig-control-model"] [data-item-id="claude opus-4-8"]')
            .element as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(selections.length).toBe(1));
    expect(selections[0]).toEqual({ providerId: "claude", modelId: "opus-4-8" });
    await vi.waitFor(() =>
        expect(
            view.container.querySelector(
                '[data-testid="rig-control-model"] [data-happy2-ui="menu"]',
            ),
        ).toBeNull(),
    );

    // Reopen, then dismiss by clicking the transparent backdrop.
    trigger.click();
    await vi.waitFor(() =>
        expect(
            view.container.querySelector(
                '[data-testid="rig-control-model"] [data-happy2-ui="menu"]',
            ),
        ).not.toBeNull(),
    );
    (
        view.$('[data-testid="rig-control-model"] [data-happy2-ui="rig-control-backdrop"]')
            .element as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
        expect(
            view.container.querySelector(
                '[data-testid="rig-control-model"] [data-happy2-ui="menu"]',
            ),
        ).toBeNull(),
    );

    await view.screenshot("RigSessionControls.test");
}, 120_000);
