import "./styles.css";
import { expect, it } from "vitest";
import { ConversationSettingsModal } from "./ConversationSettingsModal";
import { createRenderer } from "./testing";

type Change = [string, boolean];

function view(overrides: { showReasoning?: boolean; usageOpen?: boolean } = {}) {
    const changes: Change[] = [];
    const closed: string[] = [];
    const renderer = createRenderer();
    renderer.render(
        () => (
            <ConversationSettingsModal
                activityOpen={false}
                controls={
                    <button data-testid="session-control" type="button">
                        Access
                    </button>
                }
                data-testid="settings"
                onActivityOpenChange={(value) => changes.push(["activity", value])}
                onClose={() => closed.push("closed")}
                onShowReasoningChange={(value) => changes.push(["reasoning", value])}
                onUsageOpenChange={(value) => changes.push(["usage", value])}
                showReasoning={overrides.showReasoning ?? false}
                usageOpen={overrides.usageOpen ?? false}
            />
        ),
        { width: 900, height: 620 },
    );
    return { renderer, changes, closed };
}

it("hosts every session preference on the shared modal card", async () => {
    const { renderer } = view({ showReasoning: true });
    await renderer.ready();

    // It is a real modal-class surface: one overlay hosting one medium card.
    const overlay = renderer.$('[data-happy2-ui="modal-overlay"]');
    expect(overlay.computedStyle("position")).toBe("fixed");
    const dialog = renderer.$('[data-happy2-ui="modal-dialog"]');
    expect(dialog.element.getAttribute("data-size")).toBe("medium");
    expect(dialog.bounds().width).toBe(480);

    // Each preference renders as a switch reflecting the supplied value.
    const reasoning = renderer.$('[data-testid="conversation-settings-reasoning"]');
    expect(reasoning.element.getAttribute("aria-checked")).toBe("true");
    expect(
        renderer
            .$('[data-testid="conversation-settings-usage"]')
            .element.getAttribute("aria-checked"),
    ).toBe("false");
    expect(
        renderer
            .$('[data-testid="conversation-settings-activity"]')
            .element.getAttribute("aria-checked"),
    ).toBe("false");

    // The owner-supplied session controls are hosted in their own group.
    expect(renderer.container.querySelector('[data-testid="session-control"]')).not.toBeNull();
    expect(
        renderer.container.querySelectorAll('[data-happy2-ui="conversation-settings-group"]'),
    ).toHaveLength(3);

    await renderer.screenshot("ConversationSettingsModal.test");
});

it("reports every toggle and close intent to its owner", async () => {
    const { renderer, changes, closed } = view();
    await renderer.ready();

    for (const name of ["reasoning", "usage", "activity"])
        (
            renderer.$(`[data-testid="conversation-settings-${name}"]`).element as HTMLElement
        ).click();

    // Every control is controlled: an unchecked switch asks to become checked
    // and nothing changes until the owner supplies a new value.
    expect(changes).toEqual([
        ["reasoning", true],
        ["usage", true],
        ["activity", true],
    ]);
    expect(
        renderer
            .$('[data-testid="conversation-settings-reasoning"]')
            .element.getAttribute("aria-checked"),
        "the switch stays controlled by props",
    ).toBe("false");

    (renderer.$(".happy2-modal__close").element as HTMLButtonElement).click();
    expect(closed).toEqual(["closed"]);
});

it("omits the session group when the owner supplies no controls", async () => {
    const renderer = createRenderer();
    renderer.render(
        () => (
            <ConversationSettingsModal
                activityOpen
                data-testid="no-controls"
                onActivityOpenChange={() => undefined}
                onClose={() => undefined}
                onShowReasoningChange={() => undefined}
                onUsageOpenChange={() => undefined}
                showReasoning={false}
                usageOpen
            />
        ),
        { width: 900, height: 560 },
    );
    await renderer.ready();

    expect(
        renderer.container.querySelectorAll('[data-happy2-ui="conversation-settings-group"]'),
    ).toHaveLength(2);
});
