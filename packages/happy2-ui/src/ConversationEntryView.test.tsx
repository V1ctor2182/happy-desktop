import { expect, it } from "vitest";
import type { ConversationEntry, ConversationMessageEntry } from "happy2-state";
import "./styles.css";
import { ConversationEntryView } from "./ConversationEntryView";
import { createRenderer } from "./testing";

function message(
    id: string,
    author: "you" | "agent",
    text: string,
    generationStatus?: "streaming" | "complete",
): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: "conversation-1",
            sequence: id,
            changePts: id,
            sender:
                author === "you"
                    ? {
                          id: "rig:owner",
                          displayName: "Ada Lovelace",
                          username: "ada",
                          kind: "human",
                      }
                    : {
                          id: "rig:agent",
                          displayName: "Rig",
                          username: "rig",
                          kind: "agent",
                          agentRole: "default",
                      },
            kind: author === "you" ? "user" : "automated",
            automated: false,
            audience: author === "you" ? "agents" : "people",
            agentUserIds: [],
            text,
            ...(generationStatus ? { generationStatus } : {}),
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

const activity: ConversationEntry = {
    kind: "agentActivity",
    id: "tool-1",
    sequence: "3",
    activity: {
        kind: "tool",
        tool: {
            toolCallId: "tool-1",
            toolName: "bash",
            arguments: { command: "pnpm test" },
            status: "success",
            failed: false,
            display: "Ran pnpm test",
            presentation: { type: "execCommand", command: "pnpm test", output: "ok" },
        },
    },
};

const notice: ConversationEntry = {
    kind: "notice",
    id: "notice-1",
    sequence: "4",
    variant: "notice",
    level: "warning",
    title: "Retrying",
    text: "Attempt 2 of 3.",
};

const divider: ConversationEntry = {
    kind: "notice",
    id: "divider-1",
    sequence: "5",
    variant: "divider",
    level: "info",
    text: "3 tools · 1 file",
};

const request: ConversationEntry = {
    kind: "request",
    id: "request-1",
    sequence: "6",
    request: {
        kind: "userInput",
        requestId: "req-1",
        questions: [
            {
                id: "approach",
                header: "Approach",
                question: "How should the migration run?",
                multiSelect: false,
                required: true,
                options: [
                    { label: "In one transaction", description: "Atomic." },
                    { label: "In batches", description: "Lower contention." },
                ],
            },
        ],
    },
};

it("routes every entry kind to its shared chat component", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "620px" }}>
                <ConversationEntryView
                    data-testid="mine"
                    entry={message("m1", "you", "Refresh the token rotation.")}
                    viewerId="rig:owner"
                />
                <ConversationEntryView
                    data-testid="theirs"
                    entry={message("m2", "agent", "Switching to a blocking lock.", "complete")}
                    viewerId="rig:owner"
                />
                <ConversationEntryView data-testid="activity" entry={activity} />
                <ConversationEntryView className="probe-notice" entry={notice} />
                <ConversationEntryView className="probe-divider" entry={divider} />
            </div>
        ),
        { width: 660, height: 560, padding: 16 },
    );
    await view.ready();

    // An authored message is a Message, and the reader's own message takes the
    // own treatment while the agent's takes the agent badge.
    const mine = view.$('[data-testid="mine"]');
    expect(mine.element.getAttribute("data-happy2-ui")).toBe("message");
    expect(mine.element.getAttribute("data-own")).toBe("");
    expect(view.container.querySelector('[data-testid="theirs"][data-own]')).toBeNull();
    expect(
        view.$('[data-testid="theirs"] [data-happy2-ui="message-author"]').element.textContent,
    ).toBe("Rig");

    // Agent activity is one AgentActivityRow, not a message bubble.
    expect(view.$('[data-testid="activity"]').element.getAttribute("data-happy2-ui")).toBe(
        "agent-activity-row",
    );
    expect(
        view.$('[data-testid="activity"] [data-happy2-ui="agent-activity-verb"]').element
            .textContent,
    ).toBe("Ran");

    // A notice is a SystemNotice; a divider is a DayDivider.
    expect(view.$(".probe-notice").element.getAttribute("data-happy2-ui")).toBe("system-notice");
    expect(view.$('.probe-notice [data-happy2-ui="system-notice-text"]').element.textContent).toBe(
        "Retrying: Attempt 2 of 3.",
    );
    const dividerElement = view.$(".probe-divider");
    expect(dividerElement.element.getAttribute("data-happy2-ui")).toBe("day-divider");
    expect(dividerElement.element.getAttribute("role")).toBe("separator");
    expect(view.$('.probe-divider [data-happy2-ui="day-divider-label"]').element.textContent).toBe(
        "3 tools · 1 file",
    );

    await view.screenshot("ConversationEntryView.test");
});

it("renders a pending request as an answerable prompt and reports its answer", async () => {
    const answered: { requestId: string; answers: Record<string, string[]> }[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "620px" }}>
                <ConversationEntryView
                    data-testid="request"
                    entry={request}
                    onRequestAnswer={(requestId, answers) => answered.push({ requestId, answers })}
                />
            </div>
        ),
        { width: 660, height: 360, padding: 16 },
    );
    await view.ready();

    const prompt = view.$('[data-testid="request"]');
    expect(prompt.element.getAttribute("data-happy2-ui")).toBe("rig-user-input");
    const options = view.container.querySelectorAll(
        '[data-testid="request"] [data-happy2-ui="rig-user-input-option"]',
    );
    expect(options).toHaveLength(2);

    (options[1]!.querySelector("input") as HTMLInputElement).click();
    view.container
        .querySelector<HTMLElement>('[data-testid="request"] [data-action="submit"]')
        ?.click();
    expect(answered).toEqual([{ requestId: "req-1", answers: { approach: ["In batches"] } }]);

    await view.screenshot("ConversationEntryView.request.test");
});

it("streams an in-place agent reply rather than a separate live row", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "620px" }}>
                <ConversationEntryView
                    data-testid="streaming"
                    entry={message("m3", "agent", "Working on it", "streaming")}
                    viewerId="rig:owner"
                />
            </div>
        ),
        { width: 660, height: 200, padding: 16 },
    );
    await view.ready();

    // The streaming reply is an ordinary message carrying a generation status,
    // so it settles in place when the run finishes instead of being replaced.
    const streaming = view.$('[data-testid="streaming"]');
    expect(streaming.element.getAttribute("data-happy2-ui")).toBe("message");
    expect(
        view.container
            .querySelector('[data-testid="streaming"] [data-generation-marker]')
            ?.getAttribute("data-generation-marker"),
    ).toBe("streaming");

    await view.screenshot("ConversationEntryView.streaming.test");
});

it("renders an inline local image attachment and reports opens", async () => {
    // A local session has no upload step: the bytes travel with the message.
    // This behaviour existed before the transcript was unified and must survive.
    const base = message("m-img", "you", "look at this");
    const withImage: ConversationMessageEntry = {
        ...base,
        message: {
            ...base.message,
            attachments: [
                {
                    kind: "inlineImage",
                    id: "m-img:image:0",
                    mediaType: "image/png",
                    data: PIXEL_PNG,
                },
            ],
        },
    };
    const opened: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "640px" }}>
                <ConversationEntryView
                    entry={withImage}
                    onImageOpen={(messageId, attachmentId) =>
                        opened.push(`${messageId}/${attachmentId}`)
                    }
                    viewerId="rig:owner"
                />
            </div>
        ),
        { width: 680, height: 420, padding: 12 },
    );
    await view.ready();

    const image = view.container.querySelector(
        '[data-happy2-ui="message-media"] img',
    ) as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe(`data:image/png;base64,${PIXEL_PNG}`);

    (
        view.container.querySelector('[data-happy2-ui="message-media"] button') as HTMLButtonElement
    ).click();
    expect(opened).toEqual(["m-img/m-img:image:0"]);

    await view.screenshot("ConversationEntryView.inlineImage");
}, 120_000);

it("renders an inline image as noninteractive media without an open handler", async () => {
    const base = message("m-static-img", "you", "look at this");
    const withImage: ConversationMessageEntry = {
        ...base,
        message: {
            ...base.message,
            attachments: [
                {
                    kind: "inlineImage",
                    id: "m-static-img:image:0",
                    mediaType: "image/png",
                    data: PIXEL_PNG,
                },
            ],
        },
    };
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "640px" }}>
                <ConversationEntryView entry={withImage} viewerId="rig:owner" />
            </div>
        ),
        { width: 680, height: 420, padding: 12 },
    );
    await view.ready();

    const item = view.$('[data-media-id="m-static-img:image:0"]');
    expect(item.element.tagName).toBe("DIV");
    expect(item.element.getAttribute("role")).toBeNull();
    expect(item.element.getAttribute("tabindex")).toBeNull();
    expect(item.element.querySelector("img")).not.toBeNull();

    await view.screenshot("ConversationEntryView.inlineImageStatic");
}, 120_000);

it("skips a durable file attachment when no URL resolver is supplied", async () => {
    const base = message("m-file", "you", "see attached");
    const withFile: ConversationMessageEntry = {
        ...base,
        message: {
            ...base.message,
            attachments: [
                {
                    kind: "file",
                    file: {
                        id: "file-1",
                        kind: "photo",
                        contentType: "image/png",
                        size: 100,
                        uploadedByUserId: "u1",
                        createdAt: "2026-07-25T10:00:00.000Z",
                    },
                },
            ],
        },
    };
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "640px" }}>
                <ConversationEntryView entry={withFile} viewerId="rig:owner" />
            </div>
        ),
        { width: 680, height: 320, padding: 12 },
    );
    await view.ready();

    // Without a resolver there is no fetchable URL; rendering a broken image
    // would be worse than rendering none.
    expect(view.container.querySelector('[data-happy2-ui="message-media"]')).toBeNull();
}, 120_000);

it("resolves a durable photo attachment through the supplied URL resolver", async () => {
    const base = message("m-file", "you", "see attached");
    const withFile: ConversationMessageEntry = {
        ...base,
        message: {
            ...base.message,
            attachments: [
                {
                    kind: "file",
                    file: {
                        id: "file-1",
                        kind: "photo",
                        originalName: "shot.png",
                        contentType: "image/png",
                        size: 100,
                        width: 40,
                        height: 20,
                        uploadedByUserId: "u1",
                        createdAt: "2026-07-25T10:00:00.000Z",
                    },
                },
            ],
        },
    };
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "640px" }}>
                <ConversationEntryView
                    attachmentUrl={(fileId) => `https://files.test/${fileId}`}
                    entry={withFile}
                    viewerId="rig:owner"
                />
            </div>
        ),
        { width: 680, height: 320, padding: 12 },
    );
    await view.ready();

    const image = view.container.querySelector(
        '[data-happy2-ui="message-media"] img',
    ) as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe("https://files.test/file-1");
    expect(image!.getAttribute("alt")).toBe("shot.png");
}, 120_000);

// 1x1 transparent PNG — enough for a real decode without a fixture file.
const PIXEL_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

it("renders a service line as a left-aligned assistant-turn hint", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div
                data-testid="stage"
                style={{
                    background: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    width: "100%",
                }}
            >
                <ConversationEntryView
                    data-testid="agent-message"
                    entry={message("m1", "agent", "Switching to a blocking lock.", "complete")}
                />
                <ConversationEntryView className="probe-hint" entry={notice} />
            </div>
        ),
        { width: 660, height: 300 },
    );
    await view.ready();

    const hint = view.$(".probe-hint");
    const text = view.$('.probe-hint [data-happy2-ui="system-notice-text"]');
    expect(hint.element.getAttribute("data-align")).toBe("start");
    expect(hint.computedStyle("justify-content")).toBe("flex-start");
    expect(text.computedStyle("text-align")).toBe("left");

    // The hint is quiet: secondary text, not the primary body color, and it
    // keeps the tighter vertical rhythm of a follow-up rather than a banner.
    expect(text.computedStyle("color")).toBe(
        view
            .$('[data-testid="agent-message"] [data-happy2-ui="message-time"]')
            .computedStyle("color"),
    );
    expect(hint.computedStyle("padding-top")).toBe("4px");
    expect(hint.computedStyle("padding-bottom")).toBe("4px");

    // It reads as part of the turn: its text starts on the same column as the
    // agent message body above it, rather than centered in the surface.
    const body = view.$('[data-testid="agent-message"] [data-happy2-ui="message-body"]');
    expect(text.bounds().x).toBeCloseTo(body.bounds().x, 0);
    const stage = view.$('[data-testid="stage"]');
    expect(hint.bounds().x + hint.bounds().width / 2).toBeCloseTo(
        stage.bounds().x + stage.bounds().width / 2,
        1,
    );
    expect(text.bounds().x + text.bounds().width / 2).not.toBeCloseTo(
        stage.bounds().x + stage.bounds().width / 2,
        1,
    );

    await view.screenshot("ConversationEntryView.hint.test");
});
