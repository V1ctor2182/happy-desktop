import { useState } from "react";
import "./styles.css";
import { expect, it } from "vitest";
import type { ComposerSnapshot, ConversationEntry } from "happy2-state";
import { ConversationView } from "./ConversationView";
import { createRenderer } from "./testing";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
    for (let index = 0; index < 8; index += 1) await nextFrame();
};

function composer(): ComposerSnapshot {
    return {
        scopeId: "conversation-1",
        text: "",
        attachments: [],
        revision: 0,
        submission: { status: "idle" },
        focused: false,
        capabilities: { shellMode: true, commands: [], mentions: true },
        mentionCandidates: [],
        agentUserIds: [],
    };
}

function messageEntry(id: string, text: string, agent: boolean): ConversationEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: "conversation-1",
            sequence: id,
            changePts: id,
            sender: agent
                ? { id: "rig:agent", displayName: "Rig", username: "rig", kind: "agent" }
                : { id: "rig:owner", displayName: "Ada", username: "ada", kind: "human" },
            kind: agent ? "automated" : "user",
            automated: false,
            audience: agent ? "people" : "agents",
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

function toolEntry(id: string): ConversationEntry {
    return {
        kind: "agentActivity",
        id,
        sequence: id,
        activity: {
            kind: "tool",
            tool: {
                toolCallId: id,
                toolName: "bash",
                arguments: { command: "pnpm test" },
                status: "success",
                display: "pnpm test",
                failed: false,
                presentation: {
                    type: "execCommand",
                    command: "pnpm test",
                    output: Array.from({ length: 40 }, (_, line) => `output line ${line}`).join(
                        "\n",
                    ),
                },
            },
        },
    };
}

/** A realistic mixed history: prompts, replies, and expandable tool activity. */
function history(count: number): ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    for (let index = 0; index < count; index += 1) {
        if (index % 3 === 0)
            entries.push(messageEntry(`m${index}`, `Prompt number ${index}`, false));
        else if (index % 3 === 1) entries.push(toolEntry(`t${index}`));
        else
            entries.push(
                messageEntry(
                    `a${index}`,
                    `Reply number ${index}. ${"Some longer body text. ".repeat(4)}`,
                    true,
                ),
            );
    }
    return entries;
}

/** Every pair of mounted virtual rows whose painted boxes overlap vertically. */
function overlaps(list: HTMLElement): string[] {
    const rows = [
        ...list.querySelectorAll<HTMLElement>(
            '[data-happy2-ui="message-list-virtual"] > [data-index]',
        ),
    ].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    const found: string[] = [];
    for (let index = 1; index < rows.length; index += 1) {
        const above = rows[index - 1]!.getBoundingClientRect();
        const below = rows[index]!.getBoundingClientRect();
        if (below.top < above.bottom - 0.5)
            found.push(
                `${rows[index - 1]!.dataset.index}/${rows[index]!.dataset.index} by ${(
                    above.bottom - below.top
                ).toFixed(2)}px`,
            );
    }
    return found;
}

function view(entries: readonly ConversationEntry[], width = 900, height = 520) {
    const renderer = createRenderer();
    renderer.render(
        () => (
            <ConversationView
                composer={composer()}
                data-testid="repro"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                title="Repro"
                viewerId="rig:owner"
            />
        ),
        { width, height },
    );
    return renderer;
}

it("expanding a tool row must not overlap its neighbours", async () => {
    const renderer = view(history(60));
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;
    expect(overlaps(list), "baseline").toEqual([]);

    const header = list.querySelector<HTMLElement>('[data-happy2-ui="agent-activity-header"]');
    expect(header, "an expandable activity row is mounted").not.toBeNull();
    header!.click();
    await settle();
    expect(overlaps(list), "after expanding an activity row").toEqual([]);
});

it("scrolling a mixed virtualized history must not overlap rows", async () => {
    const renderer = view(history(120));
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;

    const seen: string[] = [];
    for (const top of [0, 400, 1200, 2400, 600, 0]) {
        list.scrollTop = top;
        list.dispatchEvent(new Event("scroll"));
        await settle();
        seen.push(...overlaps(list).map((entry) => `scrollTop ${top}: ${entry}`));
    }
    expect(seen, "overlaps while scrolling").toEqual([]);
});

it("narrowing the surface must not overlap rows that reflow taller", async () => {
    const renderer = view(history(60), 900, 520);
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;
    expect(overlaps(list), "baseline").toEqual([]);

    const surface = renderer.$('[data-testid="repro"]').element as HTMLElement;
    surface.style.width = "360px";
    await settle();
    expect(overlaps(list), "after narrowing").toEqual([]);
});

it("settling a streaming run must not overlap rows when keys change", async () => {
    const base = history(60);
    // While running: streaming blocks are keyed by run id.
    const streaming: ConversationEntry[] = [
        ...base,
        messageEntry("run-9:stream:0", "Partial reply while streaming…", true),
        toolEntry("run-9:stream:1"),
    ];
    // After settling: the same content is re-keyed by durable message id and a
    // turn divider is inserted, exactly as rigConversationBuild does.
    const settled: ConversationEntry[] = [
        ...base,
        messageEntry("msg-77:0", "Partial reply while streaming… done.", true),
        toolEntry("call-77"),
        {
            kind: "notice",
            id: "turn-divider:62",
            variant: "divider",
            level: "info",
            text: "2 tools · +12 −3",
            sequence: "63",
        },
    ];
    const renderer = createRenderer();
    let entries = streaming;
    let rerender!: () => void;
    function Surface() {
        const [, bump] = useState(0);
        rerender = () => bump((value) => value + 1);
        return (
            <ConversationView
                composer={composer()}
                data-testid="repro"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                title="Repro"
                viewerId="rig:owner"
            />
        );
    }
    renderer.render(Surface, { width: 900, height: 520 });
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;
    expect(overlaps(list), "while streaming").toEqual([]);

    entries = settled;
    rerender();
    await settle();
    expect(overlaps(list), "after the run settles and keys change").toEqual([]);
});

it("switching sessions must not carry stale measurements into the new list", async () => {
    // Session A is a long history of tall activity rows; session B is short
    // messages. Cloud remounts the list per conversation (`key=`); local does not.
    const sessionA = history(120);
    const sessionB = Array.from({ length: 120 }, (_, index) =>
        messageEntry(`b${index}`, `Short ${index}`, false),
    );
    const renderer = createRenderer();
    let entries = sessionA;
    let rerender!: () => void;
    function Surface() {
        const [, bump] = useState(0);
        rerender = () => bump((value) => value + 1);
        return (
            <ConversationView
                composer={composer()}
                data-testid="repro"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                title="Repro"
                viewerId="rig:owner"
            />
        );
    }
    renderer.render(Surface, { width: 900, height: 520 });
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;
    list.scrollTop = 1500;
    list.dispatchEvent(new Event("scroll"));
    await settle();
    expect(overlaps(list), "session A").toEqual([]);

    entries = sessionB;
    rerender();
    await settle();
    expect(overlaps(list), "after switching to session B").toEqual([]);
});

it("keeps row DOM identity when one entry's content changes", async () => {
    const base = history(60);
    const renderer = createRenderer();
    let entries = base;
    let rerender!: () => void;
    function Surface() {
        const [, bump] = useState(0);
        rerender = () => bump((value) => value + 1);
        return (
            <ConversationView
                composer={composer()}
                data-testid="repro"
                entries={entries}
                onComposerSend={() => undefined}
                onComposerValueChange={() => undefined}
                title="Repro"
                viewerId="rig:owner"
            />
        );
    }
    renderer.render(Surface, { width: 900, height: 520 });
    await renderer.ready();
    await settle();
    const list = renderer.$('[data-testid="repro"] [data-happy2-ui="message-list"]')
        .element as HTMLElement;
    const rowOf = (index: number) =>
        list.querySelector<HTMLElement>(
            `[data-happy2-ui="message-list-virtual"] > [data-index="${index}"]`,
        );
    const mounted = [
        ...list.querySelectorAll<HTMLElement>(
            '[data-happy2-ui="message-list-virtual"] > [data-index]',
        ),
    ];
    expect(mounted.length, "rows are virtualized, not all mounted").toBeLessThan(base.length);
    const targetIndex = Number(mounted[Math.floor(mounted.length / 2)]!.dataset.index);
    const before = rowOf(targetIndex);
    const siblingBefore = rowOf(targetIndex + 1);
    expect(before).not.toBeNull();

    // Change exactly one entry's text; every other entry keeps its reference.
    const changed = base.slice();
    const at = changed[targetIndex]!;
    changed[targetIndex] =
        at.kind === "message"
            ? { ...at, message: { ...at.message, text: `${at.message.text} (edited)` } }
            : at;
    entries = changed;
    rerender();
    await settle();

    expect(rowOf(targetIndex), "the changed row keeps its DOM node").toBe(before);
    expect(rowOf(targetIndex + 1), "its sibling keeps its DOM node").toBe(siblingBefore);
    expect(overlaps(list), "no overlap after a single-field update").toEqual([]);
});
