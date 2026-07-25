import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { RigSessionId, RigSessionSummary } from "happy2-state";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/button.css";
import "./styles/empty-state.css";
import "./styles/rig-chat.css";
import { RigSessionListPanel } from "./RigSessionListPanel";
import { createRenderer } from "./testing";

const now = 1_700_000_000_000;
const brand = (value: string) => value as RigSessionId;

function session(id: string, overrides: Partial<RigSessionSummary>): RigSessionSummary {
    return {
        id: brand(id),
        cwd: "/w",
        displayCwd: "~/w",
        providerId: "codex",
        modelId: "m",
        permissionMode: "auto",
        status: "idle",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

const alpha = session("ses_alpha0000000", {
    title: "Alpha work",
    status: "running",
    lastMessageAt: now - 30_000,
});
const beta = session("ses_beta00000000", {
    recap: "Beta recap",
    status: "completed",
    updatedAt: now - 3_600_000,
});
const gamma = session("ses_gamma0000000", { status: "error", updatedAt: now - 90_000_000 });

it("renders chronological rows, selection highlight, status tones and relative time", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "320px", height: "440px" }}>
                <RigSessionListPanel
                    data-testid="list"
                    now={now}
                    onCreate={() => undefined}
                    onSelect={() => undefined}
                    selectedId={beta.id}
                    sessions={[alpha, beta, gamma]}
                />
            </div>
        ),
        { width: 360, height: 480, padding: 16 },
    );
    await view.ready();

    const rows = view.container.querySelectorAll(
        '[data-testid="list"] [data-happy2-ui="rig-session-row"]',
    );
    expect(rows.length).toBe(3);

    // Title falls back to recap then id prefix.
    expect(
        view.$('[data-session-id="ses_alpha0000000"] [data-happy2-ui="rig-session-row-title"]')
            .element.textContent,
    ).toBe("Alpha work");
    expect(
        view.$('[data-session-id="ses_beta00000000"] [data-happy2-ui="rig-session-row-title"]')
            .element.textContent,
    ).toBe("Beta recap");
    expect(
        view.$('[data-session-id="ses_gamma0000000"] [data-happy2-ui="rig-session-row-title"]')
            .element.textContent,
    ).toBe("Session ses_gamm");

    // Selected row highlighted.
    const betaRow = view.$('[data-session-id="ses_beta00000000"]').element;
    expect(betaRow.getAttribute("aria-current")).toBe("true");
    expect(betaRow.hasAttribute("data-selected")).toBe(true);
    expect(
        view.$('[data-session-id="ses_alpha0000000"]').element.hasAttribute("data-selected"),
    ).toBe(false);

    // Status tones: running=active(orange), completed=done(green), error=red.
    expect(
        view
            .$('[data-session-id="ses_alpha0000000"] [data-happy2-ui="rig-session-row-status"]')
            .computedStyle("background-color"),
    ).toBe("rgb(255, 149, 0)");
    expect(
        view
            .$('[data-session-id="ses_beta00000000"] [data-happy2-ui="rig-session-row-status"]')
            .computedStyle("background-color"),
    ).toBe("rgb(52, 199, 89)");
    expect(
        view
            .$('[data-session-id="ses_gamma0000000"] [data-happy2-ui="rig-session-row-status"]')
            .computedStyle("background-color"),
    ).toBe("rgb(255, 59, 48)");

    // Relative time from lastMessageAt/updatedAt.
    expect(
        view.$('[data-session-id="ses_alpha0000000"] [data-happy2-ui="rig-session-row-time"]')
            .element.textContent,
    ).toBe("just now");
    expect(
        view.$('[data-session-id="ses_beta00000000"] [data-happy2-ui="rig-session-row-time"]')
            .element.textContent,
    ).toBe("1h ago");

    await view.screenshot("RigSessionListPanel.test");
}, 120_000);

it("preserves row DOM identity for unchanged sessions across a reordered update", async () => {
    function Harness() {
        const [reordered, setReordered] = useState(false);
        const sessions = reordered ? [gamma, alpha, beta] : [alpha, beta, gamma];
        return (
            <div style={{ width: "320px", height: "440px" }}>
                <button data-testid="reorder" onClick={() => setReordered(true)} type="button">
                    reorder
                </button>
                <RigSessionListPanel
                    data-testid="list"
                    now={now}
                    onCreate={() => undefined}
                    onSelect={() => undefined}
                    sessions={sessions}
                />
            </div>
        );
    }
    const view = createRenderer();
    view.render(() => <Harness />, { width: 360, height: 520, padding: 16 });
    await view.ready();

    const alphaRow = view.container.querySelector('[data-session-id="ses_alpha0000000"]');
    (view.$('[data-testid="reorder"]').element as HTMLButtonElement).click();
    await vi.waitFor(() => {
        const rows = view.container.querySelectorAll('[data-happy2-ui="rig-session-row"]');
        expect(rows[0]!.getAttribute("data-session-id")).toBe("ses_gamma0000000");
    });

    const alphaRowAfter = view.container.querySelector('[data-session-id="ses_alpha0000000"]');
    expect(alphaRowAfter, "unchanged session keyed by id keeps its DOM node").toBe(alphaRow);
    expect(view.container.querySelectorAll('[data-happy2-ui="rig-session-row"]').length).toBe(3);
}, 120_000);
