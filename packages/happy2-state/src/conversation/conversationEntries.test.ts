import { describe, expect, it } from "vitest";
import { entriesMerge, entryCompare } from "./conversationEntries.js";
import type {
    ConversationAttachment,
    ConversationEntry,
    ConversationMessageEntry,
    ConversationToolCall,
} from "./conversationEntry.js";
import { entryKey } from "./conversationEntry.js";

function message(id: string, sequence: string, text: string): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: "conversation-1",
            sequence,
            changePts: sequence,
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
            createdAt: "2026-07-25T10:00:00.000Z",
        },
    };
}

function activity(id: string, sequence: string, status: "running" | "success"): ConversationEntry {
    return {
        kind: "agentActivity",
        id,
        sequence,
        activity: {
            kind: "tool",
            tool: {
                toolCallId: id,
                toolName: "bash",
                arguments: {},
                status,
                failed: false,
            },
        },
    };
}

describe("conversation entries", () => {
    it("keeps the reference of every unchanged entry across a rebuild", () => {
        const current = [message("m1", "1", "one"), activity("t1", "2", "running")];
        const rebuilt = [message("m1", "1", "one"), activity("t1", "2", "running")];

        const merged = entriesMerge(current, rebuilt);

        // Nothing rendered differently, so the whole list — and each row — is kept.
        expect(merged).toBe(current);
        expect(merged[0]).toBe(current[0]);
        expect(merged[1]).toBe(current[1]);
    });

    it("replaces only the entry whose payload changed", () => {
        const current = [message("m1", "1", "one"), activity("t1", "2", "running")];
        const rebuilt = [message("m1", "1", "one"), activity("t1", "2", "success")];

        const merged = entriesMerge(current, rebuilt);

        expect(merged).not.toBe(current);
        expect(merged[0]).toBe(current[0]);
        expect(merged[1]).not.toBe(current[1]);
        expect(merged[1]).toBe(rebuilt[1]);
    });

    it("orders by sequence and keeps an unconfirmed local message on screen", () => {
        const pending: ConversationMessageEntry = {
            ...message("local:1", "9", "sending"),
            source: "local",
            delivery: "sending",
            clientMutationId: "mutation-1",
        };
        const current = [message("m2", "2", "two"), pending];
        const rebuilt = [message("m2", "2", "two"), message("m1", "1", "one")];

        const merged = entriesMerge(current, rebuilt);

        expect(merged.map(entryKey)).toEqual(["m1", "m2", "local:1"]);
    });

    it("adopts the confirmed entry that consumed a local mutation", () => {
        const pending: ConversationMessageEntry = {
            ...message("local:1", "9", "hello"),
            source: "local",
            delivery: "sending",
            clientMutationId: "mutation-1",
        };
        const confirmed: ConversationMessageEntry = {
            ...message("m5", "5", "hello"),
            clientMutationId: "mutation-1",
        };

        const merged = entriesMerge([pending], [confirmed]);

        expect(merged.map(entryKey)).toEqual(["m5"]);
    });

    it("sorts a non-message entry by its own sequence", () => {
        expect(entryCompare(activity("t1", "2", "running"), message("m1", "1", "one"))).toBe(1);
        expect(entryCompare(message("m1", "1", "one"), activity("t1", "2", "running"))).toBe(-1);
    });
});

/** Builds a tool activity whose every rendered field can be varied per case. */
function tool(overrides: Partial<ConversationToolCall>): ConversationEntry {
    return {
        kind: "agentActivity",
        id: "t1",
        sequence: "2",
        activity: {
            kind: "tool",
            tool: {
                toolCallId: "t1",
                toolName: "bash",
                arguments: { command: "ls" },
                status: "running",
                failed: false,
                ...overrides,
            },
        },
    };
}

describe("tool activity equivalence", () => {
    // Every one of these fields is rendered, so a change to any of them must
    // replace the row. Retaining a stale row is worse than replacing a live one.
    const cases: readonly (readonly [string, Partial<ConversationToolCall>])[] = [
        ["toolName", { toolName: "python" }],
        ["arguments", { arguments: { command: "rm -rf /" } }],
        ["status", { status: "success" }],
        ["display", { display: "Listing files" }],
        ["failed", { failed: true }],
        ["failure", { failure: { kind: "execution_failed", message: "boom" } }],
        ["failure message", { failure: { kind: "execution_failed", message: "different" } }],
        [
            "review",
            {
                review: {
                    action: "run",
                    reason: "destructive",
                    decision: "ask",
                    risk: "high",
                    userAuthorization: "low",
                },
            },
        ],
        ["presentation", { presentation: { type: "execCommand", command: "ls", output: "a\nb" } }],
    ];

    for (const [label, overrides] of cases)
        it(`replaces the row when ${label} changes`, () => {
            const base = tool({});
            const merged = entriesMerge([base], [tool(overrides)]);
            expect(merged[0]).not.toBe(base);
        });

    it("keeps the row when a re-parsed snapshot is structurally identical", () => {
        // A producer that re-parses its session from the wire hands us fresh
        // objects every poll; reference equality would replace every row.
        const base = tool({
            failure: { kind: "interrupted" },
            review: {
                action: "run",
                reason: "destructive",
                decision: "ask",
                risk: "high",
                userAuthorization: "low",
            },
            presentation: { type: "execCommand", command: "ls", output: "a\nb" },
        });
        const reparsed = tool({
            failure: { kind: "interrupted" },
            review: {
                action: "run",
                reason: "destructive",
                decision: "ask",
                risk: "high",
                userAuthorization: "low",
            },
            presentation: { type: "execCommand", command: "ls", output: "a\nb" },
        });

        const merged = entriesMerge([base], [reparsed]);

        expect(merged[0]).toBe(base);
    });

    it("compares file diff bodies structurally, not by reference", () => {
        const diff = (text: string): ConversationEntry =>
            tool({
                presentation: {
                    type: "fileDiff",
                    files: [
                        {
                            path: "a.ts",
                            kind: "update",
                            hunks: [{ oldStart: 1, newStart: 1, lines: [{ kind: "add", text }] }],
                        },
                    ],
                },
            });

        // A changed diff line must replace the row.
        const base = diff("before");
        expect(entriesMerge([base], [diff("after")])[0]).not.toBe(base);
        // An identical diff line must keep it.
        expect(entriesMerge([base], [diff("before")])[0]).toBe(base);
    });

    it("compares nested tool arguments deeply", () => {
        const base = tool({ arguments: { a: [1, { b: "c" }] } });
        expect(entriesMerge([base], [tool({ arguments: { a: [1, { b: "c" }] } })])[0]).toBe(base);
        expect(entriesMerge([base], [tool({ arguments: { a: [1, { b: "d" }] } })])[0]).not.toBe(
            base,
        );
    });
});

describe("message attachment equivalence", () => {
    function withAttachments(
        attachments: readonly ConversationAttachment[],
    ): ConversationMessageEntry {
        const base = message("m1", "1", "look");
        return { ...base, message: { ...base.message, attachments } };
    }

    const image = (data: string): ConversationAttachment => ({
        kind: "inlineImage",
        id: "m1:image:0",
        mediaType: "image/png",
        data,
    });

    it("keeps the row when identical inline images are re-projected", () => {
        const base = withAttachments([image("AAAA")]);
        expect(entriesMerge([base], [withAttachments([image("AAAA")])])[0]).toBe(base);
    });

    it("replaces the row when an inline image's bytes change", () => {
        const base = withAttachments([image("AAAA")]);
        expect(entriesMerge([base], [withAttachments([image("BBBB")])])[0]).not.toBe(base);
    });

    it("replaces the row when an attachment is added", () => {
        const base = withAttachments([]);
        expect(entriesMerge([base], [withAttachments([image("AAAA")])])[0]).not.toBe(base);
    });
});
