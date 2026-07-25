import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { RigToolEntry, RigTranscriptEntry } from "happy2-state";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/diff-snippet.css";
import "./styles/rig-chat.css";
import { RigTranscript } from "./RigTranscript";
import { createRenderer } from "./testing";

const tool: RigToolEntry = {
    toolCallId: "tool-1",
    toolName: "bash",
    arguments: null,
    status: "success",
    failed: false,
    display: "done",
};

const baseEntries: readonly RigTranscriptEntry[] = [
    { id: "u", kind: "user", text: "Do the thing", images: [{ mediaType: "image/png", data: "" }] },
    { id: "th", kind: "thinking", text: "considering", streaming: false },
    { id: "ag", kind: "agentText", text: "Working on it", streaming: false },
    { id: "tool-1", kind: "tool", tool },
    { id: "sys", kind: "system", text: "reset" },
    { id: "warn", kind: "notice", level: "warning", title: "Retrying", text: "attempt 2" },
    { id: "err", kind: "notice", level: "error", title: "Run error", text: "boom" },
    {
        id: "shell:c1",
        kind: "shell",
        command: "ls -la",
        output: "file.txt\n",
        exitCode: 0,
        running: false,
        timedOut: false,
    },
    {
        id: "turn-1",
        kind: "turnSeparator",
        elapsedMs: 92_000,
        toolCount: 3,
        fileCount: 2,
        additions: 12,
        deletions: 4,
    },
];

it("renders every entry kind with the role prefix/color contract and activity line", async () => {
    const view = createRenderer();
    view.render(
        () => <RigTranscript data-testid="t" elapsedMs={5_000} entries={baseEntries} running />,
        { width: 720, height: 640, padding: 16 },
    );
    await view.ready();

    // User entry: bold `›` prefix on the input surface, image chip present.
    expect(
        view.$(
            '[data-testid="t"] [data-happy2-ui="rig-entry-user"] .happy2-rig-entry__prefix--user',
        ).element.textContent,
    ).toBe("›");
    expect(
        view.container.querySelector('[data-testid="t"] [data-happy2-ui="rig-entry-image-chip"]'),
    ).not.toBeNull();

    // Thinking + agent markdown blocks exist.
    expect(
        view.container.querySelector(
            '[data-testid="t"] [data-happy2-ui="rig-entry-thinking-markdown"]',
        ),
    ).not.toBeNull();
    expect(
        view.container.querySelector('[data-testid="t"] [data-happy2-ui="rig-entry-markdown"]'),
    ).not.toBeNull();

    // Tool call rendered.
    expect(
        view.container.querySelector('[data-testid="t"] [data-happy2-ui="rig-tool-call"]'),
    ).not.toBeNull();

    // Notice prefixes carry level colors: warning orange, error red.
    expect(
        view
            .$(
                '[data-testid="t"] [data-happy2-ui="rig-entry-notice"] .happy2-rig-entry__prefix[data-level="warning"]',
            )
            .computedStyle("color"),
    ).toBe("rgb(255, 149, 0)");
    const errorPrefix = view.container.querySelectorAll(
        '[data-testid="t"] .happy2-rig-entry__prefix[data-level="error"]',
    );
    expect(errorPrefix.length).toBe(1);

    // Shell entry: command, exit status, and captured output.
    expect(
        view.$('[data-testid="t"] [data-happy2-ui="rig-entry-shell-command"]').element.textContent,
    ).toBe("ls -la");
    expect(
        view.$('[data-testid="t"] [data-happy2-ui="rig-entry-shell-status"]').element.textContent,
    ).toBe("Exit 0");
    expect(
        view.$('[data-testid="t"] [data-happy2-ui="rig-entry-shell-output"]').element.textContent,
    ).toContain("file.txt");

    // Turn separator: rule with a stats label ("Worked for" only past 60s).
    const turnLabel = view.$('[data-testid="t"] [data-happy2-ui="rig-turn-separator-label"]')
        .element.textContent;
    expect(turnLabel).toBe("Worked for 1m 32s · 3 tools · 2 files · +12 −4");

    // Running → activity line with elapsed.
    expect(
        view.$('[data-testid="t"] [data-happy2-ui="rig-transcript-elapsed"]').element.textContent,
    ).toBe("5s");

    await view.screenshot("RigTranscript.test");
}, 120_000);

it("shows a rewind affordance on user entries only when onRewind is supplied", async () => {
    const rewound: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <RigTranscript
                data-testid="t"
                entries={baseEntries}
                onRewind={(id) => rewound.push(id)}
            />
        ),
        { width: 720, height: 640, padding: 16 },
    );
    // A second transcript without onRewind must not render the affordance.
    view.render(() => <RigTranscript data-testid="no-rewind" entries={baseEntries} />, {
        width: 720,
        height: 640,
        padding: 16,
    });
    await view.ready();

    const rewind = view.$('[data-testid="t"] [data-happy2-ui="rig-entry-rewind"]')
        .element as HTMLButtonElement;
    expect(rewind).not.toBeNull();
    expect(
        view.container.querySelector(
            '[data-testid="no-rewind"] [data-happy2-ui="rig-entry-rewind"]',
        ),
    ).toBeNull();

    rewind.click();
    await vi.waitFor(() => expect(rewound).toEqual(["u"]));

    await view.screenshot("RigTranscript.rewind.test");
}, 120_000);

it("keeps unchanged entry DOM nodes and child count stable across a streamed update", async () => {
    function Harness() {
        const [tick, setTick] = useState(0);
        const entries: RigTranscriptEntry[] = [
            { id: "tool-1", kind: "tool", tool },
            { id: "ag", kind: "agentText", text: `Streaming ${tick}`, streaming: true },
        ];
        return (
            <div>
                <button
                    data-testid="tick"
                    onClick={() => setTick((value) => value + 1)}
                    type="button"
                >
                    tick
                </button>
                <RigTranscript data-testid="t" entries={entries} />
            </div>
        );
    }
    const view = createRenderer();
    view.render(() => <Harness />, { width: 640, height: 320, padding: 16 });
    await view.ready();

    const toolNode = view.container.querySelector(
        '[data-testid="t"] [data-happy2-ui="rig-tool-call"]',
    );
    const childCount = view.container.querySelectorAll(
        '[data-testid="t"] [data-happy2-ui="rig-transcript-entries"] > *',
    ).length;
    expect(childCount).toBe(2);

    (view.$('[data-testid="tick"]').element as HTMLButtonElement).click();
    await vi.waitFor(() =>
        expect(
            view.$('[data-testid="t"] [data-happy2-ui="rig-entry-markdown"]').element.textContent,
        ).toContain("Streaming 1"),
    );

    // The tool row keyed by stable id must be the exact same DOM node.
    const toolNodeAfter = view.container.querySelector(
        '[data-testid="t"] [data-happy2-ui="rig-tool-call"]',
    );
    expect(toolNodeAfter, "tool row must not remount on sibling stream tick").toBe(toolNode);
    expect(
        view.container.querySelectorAll(
            '[data-testid="t"] [data-happy2-ui="rig-transcript-entries"] > *',
        ).length,
    ).toBe(2);
}, 120_000);
