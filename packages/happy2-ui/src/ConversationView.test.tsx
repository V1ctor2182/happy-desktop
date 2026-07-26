import { expect, it } from "vitest";
import {
    UserError,
    type ComposerSnapshot,
    type ConversationEntry,
    type ConversationMessageEntry,
} from "happy2-state";
import "./styles.css";
import { ConversationView } from "./ConversationView";
import { createRenderer } from "./testing";

const commands = [
    { id: "usage", label: "/usage", description: "Token usage for the session." },
    { id: "compact", label: "/compact", description: "Compact the conversation." },
];

function composer(overrides: Partial<ComposerSnapshot> = {}): ComposerSnapshot {
    return {
        scopeId: "conversation-1",
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

function message(id: string, text: string): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: "conversation-1",
            sequence: id,
            changePts: id,
            sender: {
                id: "rig:owner",
                displayName: "Ada Lovelace",
                username: "ada",
                kind: "human",
            },
            kind: "user",
            automated: false,
            audience: "agents",
            agentUserIds: [],
            text,
            revision: 0,
            mentions: [],
            attachments: [],
            reactions: [],
            receipts: [],
            expiryMode: "none",
            createdAt: "2026-07-25T09:41:00.000Z",
        },
    };
}

const entries: readonly ConversationEntry[] = [
    message("m1", "Refresh the token rotation."),
    {
        kind: "agentActivity",
        id: "tool-1",
        sequence: "2",
        activity: {
            kind: "tool",
            tool: {
                toolCallId: "tool-1",
                toolName: "bash",
                arguments: {},
                status: "running",
                failed: false,
            },
        },
    },
];

it("holds the conversation surface geometry, live status, and composer dock", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer({ text: "ship it" })}
                data-testid="conversation"
                elapsedMs={92_000}
                entries={entries}
                onAbort={() => undefined}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                queued={[{ id: "q1", text: "Also update the changelog" }]}
                running
                subtitle="~/happy2"
                title="Fix token rotation race"
                viewerId="rig:owner"
            />
        ),
        { width: 900, height: 620 },
    );
    await view.ready();

    // The surface fills its allocated region exactly.
    const surface = view.$('[data-testid="conversation"]');
    expect(surface.bounds().width).toBe(900);
    expect(surface.bounds().height).toBe(620);
    expect(surface.computedStyle("display")).toBe("flex");
    expect(surface.computedStyle("flex-direction")).toBe("column");

    // The header is the shared 56px surface header row.
    const header = view.$('[data-testid="conversation"] [data-happy2-ui="channel-header"]');
    expect(header.bounds().height).toBe(56);
    expect(header.bounds().y).toBe(surface.bounds().y);

    // A running conversation shows its live status and elapsed time.
    const status = view.$('[data-happy2-ui="conversation-status"]');
    expect(status.element.getAttribute("data-running")).toBe("");
    expect(view.$('[data-happy2-ui="conversation-elapsed"]').element.textContent).toBe("1m 32s");

    // Queued steering messages preview above the dock.
    expect(view.$('[data-happy2-ui="conversation-queued-item"]').element.textContent).toBe(
        "Also update the changelog",
    );

    // The dock owns the composer, whose one trailing control stops the run or
    // sends. This draft has something to say, so it stays a send control and
    // what it sends steers the run already under way.
    const dock = view.$('[data-happy2-ui="conversation-dock"]');
    expect(dock.computedStyle("display")).toBe("flex");
    expect(view.container.querySelectorAll('[data-action="stop"]').length).toBe(0);
    expect(
        view
            .$('[data-testid="conversation"] .happy2-composer__send')
            .element.getAttribute("aria-label"),
    ).toBe("Send message");
    // The draft comes from the composer snapshot, never from local view state.
    expect((view.$("textarea").element as HTMLTextAreaElement).value).toBe("ship it");
    // The dock sits at the bottom of the surface, below the entry list.
    expect(Math.round(dock.bounds().y + dock.bounds().height)).toBe(
        Math.round(surface.bounds().y + surface.bounds().height),
    );

    await view.screenshot("ConversationView.test");
});

it("opens the command palette for a slash draft and never sends it", async () => {
    const sent: string[] = [];
    const invoked: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer({ text: "/com", commandQuery: "com" })}
                data-testid="palette-open"
                entries={entries}
                onCommandInvoke={(id) => invoked.push(id)}
                onComposerSend={() => sent.push("sent")}
                onComposerValueChange={() => undefined}
                title="Fix token rotation race"
            />
        ),
        { width: 900, height: 520 },
    );
    await view.ready();

    const palette = view.$('[data-happy2-ui="conversation-palette"]');
    expect(palette.computedStyle("display")).toBe("flex");
    // Only the matching command is listed.
    const items = view.container.querySelectorAll('[data-happy2-ui="rig-command-item"]');
    expect(items).toHaveLength(1);
    expect((items[0] as HTMLElement).dataset.commandId).toBe("compact");

    // Enter cannot send a command draft: the send control is disabled.
    const send = view.$('[data-testid="palette-open"] .happy2-composer__send');
    expect((send.element as HTMLButtonElement).disabled).toBe(true);
    expect(sent).toEqual([]);

    (items[0] as HTMLElement).click();
    expect(invoked).toEqual(["compact"]);

    await view.screenshot("ConversationView.palette.test");
});

it("shows an empty state and a shell hint without a command palette", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer({ text: "!ls -la", shellCommand: "ls -la" })}
                data-testid="empty"
                entries={[]}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                title="New session"
            />
        ),
        { width: 900, height: 420 },
    );
    await view.ready();

    expect(
        view.$('[data-happy2-ui="conversation-empty"] [data-happy2-ui="empty-state-title"]').element
            .textContent,
    ).toBe("Nothing here yet");
    expect(view.container.querySelector('[data-happy2-ui="conversation-palette"]')).toBeNull();
    // A shell draft is sendable: `!ls -la` runs rather than being blocked like
    // an open command draft.
    expect(
        (view.$('[data-testid="empty"] .happy2-composer__send').element as HTMLButtonElement)
            .disabled,
    ).toBe(false);

    await view.screenshot("ConversationView.empty.test");
});

it("surfaces a failed submission beside the composer and retries it", async () => {
    let retries = 0;
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer({
                    text: "ship it",
                    revision: 3,
                    submission: {
                        status: "failed",
                        revision: 3,
                        error: new UserError("Rig is temporarily unavailable."),
                    },
                })}
                data-testid="failed-submission"
                entries={entries}
                onComposerSend={() => {
                    retries += 1;
                }}
                onComposerValueChange={() => undefined}
                title="Fix token rotation race"
            />
        ),
        { width: 900, height: 560 },
    );
    await view.ready();

    const error = view.$('[data-testid="conversation-submission-error"]');
    expect(error.element.textContent).toContain("Message not sent");
    expect(error.element.textContent).toContain("Rig is temporarily unavailable.");
    const retry = error.element.querySelector("button");
    expect(retry?.textContent).toContain("Retry");
    (retry as HTMLButtonElement).click();
    expect(retries).toBe(1);

    await view.screenshot("ConversationView.submissionError.test");
});

it("centers the entry column and the composer dock on one shared measure", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer()}
                composerControls={
                    <button data-testid="settings-trigger" type="button">
                        Settings
                    </button>
                }
                data-testid="measured"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                queued={[{ id: "q1", text: "Also update the changelog" }]}
                title="Fix token rotation race"
                viewerId="rig:owner"
            />
        ),
        // Wider than the 880px measure, so centering is observable.
        { width: 1240, height: 620 },
    );
    await view.ready();

    const surface = view.$('[data-testid="measured"]');
    const scrollport = view.$('[data-testid="measured"] [data-happy2-ui="message-list"]');
    const column = view.$('[data-testid="measured"] [data-happy2-ui="message-list-content"]');
    const dock = view.$('[data-testid="measured"] [data-happy2-ui="conversation-dock"]');
    const dockInner = view.$('[data-testid="measured"] .happy2-conversation__dock-inner');

    // The scrollport stays full-bleed with no spacing of its own.
    expect(scrollport.bounds().width).toBe(1240);
    for (const side of ["top", "right", "bottom", "left"] as const) {
        expect(scrollport.computedStyle(`margin-${side}`)).toBe("0px");
        expect(scrollport.computedStyle(`padding-${side}`)).toBe("0px");
    }

    // The inner column caps at the shared measure and centers in the surface.
    expect(column.bounds().width).toBe(880);
    const columnCenter = column.bounds().x + column.bounds().width / 2;
    expect(columnCenter).toBeCloseTo(surface.bounds().x + surface.bounds().width / 2, 1);

    // The dock bar spans the surface, while its contents land on the same center
    // line as the column: the shared 880px measure plus the cloud dock's 12px/20px
    // interior insets, so both stacks ground the composer identically.
    expect(dock.bounds().width).toBe(1240);
    expect(dockInner.bounds().width).toBe(912);
    expect(dockInner.computedStyle("padding-left")).toBe("12px");
    expect(dockInner.computedStyle("padding-right")).toBe("20px");
    expect(dockInner.bounds().x + dockInner.bounds().width / 2).toBeCloseTo(columnCenter, 1);

    // Composer controls live in the composer toolbar, not the channel header.
    const trigger = view.$('[data-testid="settings-trigger"]');
    expect(
        view
            .$('[data-testid="measured"] [data-happy2-ui="composer-toolbar"]')
            .element.contains(trigger.element),
    ).toBe(true);
    expect(
        view
            .$('[data-testid="measured"] [data-happy2-ui="channel-header"]')
            .element.contains(trigger.element),
    ).toBe(false);

    await view.screenshot("ConversationView.measure.test");
});

it("hosts an owner overlay above the whole conversation", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <ConversationView
                composer={composer()}
                data-testid="overlaid"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                overlay={<div data-testid="owner-overlay">settings</div>}
                title="Fix token rotation race"
            />
        ),
        { width: 900, height: 520 },
    );
    await view.ready();

    const overlay = view.$('[data-testid="owner-overlay"]');
    expect(view.$('[data-testid="overlaid"]').element.contains(overlay.element)).toBe(true);
});
