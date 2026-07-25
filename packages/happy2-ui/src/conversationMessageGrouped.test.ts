import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "happy2-state";
import {
    conversationMessageGroupContinues,
    conversationMessageGrouped,
} from "./conversationMessageGrouped";

const agent = (id: string, senderId: string): ConversationEntry => ({
    kind: "message",
    id,
    sequence: id,
    message: {
        id,
        sessionId: "s1",
        text: id,
        sender: { id: senderId, displayName: "Happy", kind: "agent" },
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
            name: "bash",
            status: "complete",
            display: "ok",
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

describe("conversationMessageGroupContinues", () => {
    it("detects a following message from the same author", () => {
        const entries = [agent("a1", "agent"), tool("t1"), agent("a2", "agent")];
        expect(conversationMessageGroupContinues(entries, 0)).toBe(true);
        expect(conversationMessageGroupContinues(entries, 2)).toBe(false);
    });
});
