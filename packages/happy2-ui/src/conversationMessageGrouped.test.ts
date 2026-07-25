import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "happy2-state";
import { conversationMessageGrouped } from "./conversationMessageGrouped";

const agent = (id: string, senderId: string): ConversationEntry => ({
    kind: "message",
    source: "server",
    delivery: "sent",
    message: {
        id,
        chatId: "s1",
        text: id,
        sender: { id: senderId, displayName: "Happy", username: "happy", kind: "agent" },
        kind: "automated",
        automated: false,
        audience: "people",
        agentUserIds: [],
        revision: 0,
        mentions: [],
        attachments: [],
        reactions: [],
        receipts: [],
        expiryMode: "none",
        createdAt: "",
        sequence: id,
        changePts: id,
    },
});

const tool = (id: string): ConversationEntry => ({
    kind: "agentActivity",
    id,
    sequence: id,
    activity: {
        kind: "tool",
        tool: {
            toolCallId: id,
            toolName: "bash",
            arguments: {},
            status: "success",
            display: "ok",
            failed: false,
        },
    },
});

describe("conversationMessageGrouped", () => {
    it("groups agent messages across tool rows", () => {
        const entries = [agent("a1", "agent"), tool("t1"), agent("a2", "agent")];
        expect(conversationMessageGrouped(entries, 2)).toBe(true);
    });

    it("does not group across different senders", () => {
        const entries = [agent("a1", "agent"), agent("a2", "human")];
        expect(conversationMessageGrouped(entries, 1)).toBe(false);
    });
});
