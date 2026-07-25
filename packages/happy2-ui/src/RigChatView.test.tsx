import { expect, it, vi } from "vitest";
import type { RigMenusSnapshot, RigTranscriptEntry } from "happy2-state";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/badge.css";
import "./styles/button.css";
import "./styles/menu.css";
import "./styles/command-palette.css";
import "./styles/composer.css";
import "./styles/rig-chat.css";
import "./styles/rig-usage.css";
import "./styles/rig-activity.css";
import "./styles/rig-status.css";
import { RigChatView } from "./RigChatView";
import type { RigCommandId } from "./RigCommandPalette";
import { createRenderer } from "./testing";

const menus: RigMenusSnapshot = {
    modelOptions: [
        { providerId: "codex", modelId: "gpt", name: "GPT", disabled: false, current: true },
    ],
    effortOptions: [{ level: "medium", label: "Medium", current: true, isDefault: true }],
    permissionModeOptions: [{ mode: "auto", label: "Auto", current: true }],
    serviceTierOptions: [{ tier: null, label: "Standard", current: true }],
    currentProviderId: "codex",
    currentModelId: "gpt",
    currentEffort: "medium",
    currentPermissionMode: "auto",
    currentServiceTier: undefined,
};

const entries: readonly RigTranscriptEntry[] = [
    { id: "u1", kind: "user", text: "Hello", images: [] },
    { id: "a1", kind: "agentText", text: "Hi there", streaming: false },
];

const noop = () => undefined;

function typeInto(textarea: HTMLTextAreaElement, value: string) {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(textarea: HTMLTextAreaElement) {
    textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
}

it("opens the slash-command palette from the composer and runs a command", async () => {
    const commands: RigCommandId[] = ["new", "compact", "abort", "fork"];
    const invoked: RigCommandId[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    commands={commands}
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onCommand={(id) => invoked.push(id)}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={noop}
                    onServiceTierChange={noop}
                    pendingUserInputs={[]}
                    running={false}
                    subtitle="~/happy2"
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    // No palette while the draft is empty.
    expect(view.container.querySelector('[data-happy2-ui="rig-chat-palette"]')).toBeNull();

    const textarea = view.$('[data-happy2-ui="composer-textarea"]').element as HTMLTextAreaElement;

    // A leading slash opens the palette listing all four wired commands.
    typeInto(textarea, "/");
    await vi.waitFor(() =>
        expect(view.container.querySelector('[data-happy2-ui="rig-chat-palette"]')).not.toBeNull(),
    );
    expect(view.container.querySelectorAll('[data-happy2-ui="rig-command-item"]').length).toBe(4);

    // Typing narrows by query; "/com" leaves only compact.
    typeInto(textarea, "/com");
    await vi.waitFor(() =>
        expect(view.container.querySelectorAll('[data-happy2-ui="rig-command-item"]').length).toBe(
            1,
        ),
    );
    expect(
        view.container
            .querySelector('[data-happy2-ui="rig-command-item"]')!
            .getAttribute("data-command-id"),
    ).toBe("compact");

    // Selecting invokes the command and clears the draft, closing the palette.
    (view.$('[data-command-id="compact"]').element as HTMLButtonElement).click();
    await vi.waitFor(() => expect(invoked).toEqual(["compact"]));
    await vi.waitFor(() =>
        expect(view.container.querySelector('[data-happy2-ui="rig-chat-palette"]')).toBeNull(),
    );
    expect(textarea.value).toBe("");

    await view.screenshot("RigChatView.slash.test");
}, 120_000);

it("routes a `!`-prefixed draft to shell mode instead of sending a message", async () => {
    const sent: string[] = [];
    const shellRuns: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={(text) => sent.push(text)}
                    onShellRun={(command) => shellRuns.push(command)}
                    onServiceTierChange={noop}
                    pendingUserInputs={[]}
                    running={false}
                    subtitle="~/happy2"
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    const textarea = view.$('[data-happy2-ui="composer-textarea"]').element as HTMLTextAreaElement;

    // A `!`-prefixed draft runs a shell command (leading `!` stripped) and clears.
    // Retry the Enter until the draft has propagated to the composer's send guard.
    typeInto(textarea, "!ls -la");
    await vi.waitFor(() => {
        pressEnter(textarea);
        expect(shellRuns).toEqual(["ls -la"]);
    });
    expect(sent).toEqual([]);
    await vi.waitFor(() => expect(textarea.value).toBe(""));

    // A normal draft still sends as a message.
    typeInto(textarea, "hello there");
    await vi.waitFor(() => {
        pressEnter(textarea);
        expect(sent).toEqual(["hello there"]);
    });
    expect(shellRuns).toEqual(["ls -la"]);

    await view.screenshot("RigChatView.shell.test");
}, 120_000);

it("previews queued steering messages above the composer", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={noop}
                    onServiceTierChange={noop}
                    pendingUserInputs={[]}
                    queuedMessages={[
                        { id: "q1", text: "Update the changelog." },
                        { id: "q2", text: "Then push." },
                    ]}
                    running
                    subtitle="~/happy2"
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    expect(view.$('[data-happy2-ui="rig-chat-steering-title"]').element.textContent).toContain(
        "esc to send now",
    );
    const items = view.container.querySelectorAll('[data-happy2-ui="rig-chat-steering-item"]');
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toBe("Update the changelog.");
    expect(items[1]!.textContent).toBe("Then push.");
}, 120_000);

it("opens the @-mention autocomplete and inserts the chosen file path", async () => {
    const files = [
        { fileName: "rigChatStore.ts", path: "packages/happy2-state/src/rig/rigChatStore.ts" },
        { fileName: "rigTypes.ts", path: "packages/happy2-state/src/rig/rigTypes.ts" },
    ];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onFilesSearch={(query) =>
                        Promise.resolve(files.filter((file) => file.path.includes(query)))
                    }
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={noop}
                    onServiceTierChange={noop}
                    pendingUserInputs={[]}
                    running={false}
                    subtitle="~/happy2"
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    const textarea = view.$('[data-happy2-ui="composer-textarea"]').element as HTMLTextAreaElement;

    // No mention popover until an `@` token is typed.
    expect(view.container.querySelector('[data-happy2-ui="rig-chat-mention"]')).toBeNull();

    // Typing `@rig` opens the popover with both matching files.
    typeInto(textarea, "look at @rig");
    await vi.waitFor(() =>
        expect(
            view.container.querySelectorAll('[data-happy2-ui="rig-file-mention-item"]').length,
        ).toBe(2),
    );

    // Narrowing to `@rigTypes` leaves one candidate.
    typeInto(textarea, "look at @rigTypes");
    await vi.waitFor(() =>
        expect(
            view.container.querySelectorAll('[data-happy2-ui="rig-file-mention-item"]').length,
        ).toBe(1),
    );

    // Selecting inserts the full path and closes the popover.
    (
        view.$('[data-path="packages/happy2-state/src/rig/rigTypes.ts"]')
            .element as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
        expect(view.container.querySelector('[data-happy2-ui="rig-chat-mention"]')).toBeNull(),
    );
    expect(textarea.value).toBe("look at @packages/happy2-state/src/rig/rigTypes.ts ");

    await view.screenshot("RigChatView.mention.test");
}, 120_000);

it("exposes reasoning and turn-compaction view toggles that reflect state", async () => {
    const events: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    compactTurns={false}
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onReasoningToggle={() => events.push("reasoning")}
                    onSend={noop}
                    onServiceTierChange={noop}
                    onTurnCompactToggle={() => events.push("compact")}
                    pendingUserInputs={[]}
                    running={false}
                    showReasoning
                    subtitle="~/happy2"
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    const reasoning = view.$('[data-happy2-ui="rig-chat-reasoning-toggle"]')
        .element as HTMLButtonElement;
    const compact = view.$('[data-happy2-ui="rig-chat-compact-toggle"]')
        .element as HTMLButtonElement;

    // Pressed state mirrors the props: reasoning on, compaction off.
    expect(reasoning.getAttribute("aria-pressed")).toBe("true");
    expect(compact.getAttribute("aria-pressed")).toBe("false");

    reasoning.click();
    compact.click();
    expect(events).toEqual(["reasoning", "compact"]);
}, 120_000);

it("swaps the transcript for the usage panel while the usage view is open", async () => {
    const events: string[] = [];
    const usage = {
        currentProviderId: "openai",
        groups: [
            {
                modelId: "gpt-x",
                providerId: "openai",
                inputTokens: 100,
                outputTokens: 40,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 140,
                cost: 0.3,
            },
        ],
        totalTokens: 140,
        totalCost: 0.3,
        quotas: [],
    };
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    entries={entries}
                    menus={menus}
                    onAbort={noop}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={noop}
                    onServiceTierChange={noop}
                    onUsageToggle={() => events.push("usage")}
                    pendingUserInputs={[]}
                    running={false}
                    subtitle="~/happy2"
                    title="Session"
                    usage={usage}
                    usageOpen
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    // Panel is shown in place of the transcript, with the toggle marked pressed.
    expect(view.container.querySelector('[data-happy2-ui="rig-usage-panel"]')).not.toBeNull();
    expect(view.container.querySelector('[data-happy2-ui="rig-entry-user"]')).toBeNull();
    expect(
        view.$('[data-happy2-ui="rig-chat-usage-toggle"]').element.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(view.$('[data-happy2-ui="rig-usage-totals"]').element.textContent).toContain("140");

    (view.$('[data-happy2-ui="rig-chat-usage-toggle"]').element as HTMLButtonElement).click();
    expect(events).toEqual(["usage"]);
}, 120_000);

it("swaps the transcript for the activity panel while the activity view is open", async () => {
    const events: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "900px", height: "600px" }}>
                <RigChatView
                    activityOpen
                    entries={entries}
                    goal={{
                        objective: "Match the TUI feature-for-feature.",
                        status: "active",
                        createdAt: 1000,
                        updatedAt: 2000,
                    }}
                    menus={menus}
                    now={64_000}
                    onAbort={noop}
                    onActivityToggle={() => events.push("activity")}
                    onAnswerInput={noop}
                    onEffortChange={noop}
                    onModelChange={noop}
                    onPermissionModeChange={noop}
                    onSend={noop}
                    onServiceTierChange={noop}
                    pendingUserInputs={[]}
                    running={false}
                    subtitle="~/happy2"
                    tasks={[
                        {
                            id: "t1",
                            subject: "Wire the panel",
                            description: "",
                            status: "in_progress",
                            blockedBy: [],
                            blocks: [],
                        },
                    ]}
                    title="Session"
                />
            </div>
        ),
        { width: 960, height: 640, padding: 0 },
    );
    await view.ready();

    expect(view.container.querySelector('[data-happy2-ui="rig-activity-panel"]')).not.toBeNull();
    expect(view.container.querySelector('[data-happy2-ui="rig-entry-user"]')).toBeNull();
    expect(
        view.$('[data-happy2-ui="rig-chat-activity-toggle"]').element.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(view.container.textContent).toContain("Match the TUI feature-for-feature.");

    (view.$('[data-happy2-ui="rig-chat-activity-toggle"]').element as HTMLButtonElement).click();
    expect(events).toEqual(["activity"]);
}, 120_000);
