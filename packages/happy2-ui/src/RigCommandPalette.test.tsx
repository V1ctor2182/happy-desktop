import { expect, it, vi } from "vitest";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/badge.css";
import "./styles/button.css";
import "./styles/command-palette.css";
import "./styles/rig-chat.css";
import { RigCommandPalette, type RigCommandId } from "./RigCommandPalette";
import { createRenderer } from "./testing";

const commands: RigCommandId[] = [
    "model",
    "effort",
    "permissions",
    "fast",
    "usage",
    "tasks",
    "agents",
    "goal",
    "ps",
    "new",
    "compact",
    "abort",
    "fork",
];

it("lists wired commands, filters by query, and invokes + closes on selection", async () => {
    const invoked: RigCommandId[] = [];
    let closed = 0;
    const view = createRenderer();
    view.render(
        () => (
            <RigCommandPalette
                autoFocus={false}
                commands={commands}
                data-testid="palette"
                onClose={() => {
                    closed += 1;
                }}
                onCommand={(id) => invoked.push(id)}
                onQueryChange={() => undefined}
                query=""
            />
        ),
        { width: 560, height: 460, padding: 16 },
    );
    view.render(
        () => (
            <RigCommandPalette
                autoFocus={false}
                commands={commands}
                data-testid="filtered"
                onClose={() => undefined}
                onCommand={() => undefined}
                onQueryChange={() => undefined}
                query="model"
            />
        ),
        { width: 560, height: 260, padding: 16 },
    );
    await view.ready();

    // All thirteen wired commands are listed.
    expect(
        view.container.querySelectorAll(
            '[data-testid="palette"] [data-happy2-ui="rig-command-item"]',
        ).length,
    ).toBe(13);

    // The "model" query narrows to the model command only.
    const filtered = view.container.querySelectorAll(
        '[data-testid="filtered"] [data-happy2-ui="rig-command-item"]',
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.getAttribute("data-command-id")).toBe("model");

    // Selecting a command invokes it and closes the palette.
    (
        view.$('[data-testid="palette"] [data-command-id="compact"]').element as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(invoked).toEqual(["compact"]));
    expect(closed).toBe(1);

    await view.screenshot("RigCommandPalette.test");
}, 120_000);
