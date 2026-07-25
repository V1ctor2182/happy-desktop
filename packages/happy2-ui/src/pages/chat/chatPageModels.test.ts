import { expect, it } from "vitest";
import type { AgentTurnStatus, AgentTurnTraceSummary } from "happy2-state";
import {
    messagesGrouped,
    turnsCollapse,
    type LiveChatMessage,
    type WorkspaceEntry,
} from "./chatPageModels";
function message(values: Partial<LiveChatMessage> = {}): LiveChatMessage {
    return {
        kind: "message",
        id: values.id ?? "m",
        own: false,
        renderKey: values.id ?? "m",
        conversationId: "chat-1",
        author: "Maya Johnson",
        body: "text",
        time: "9:00",
        ...values,
    };
}
function trace(turnId: string, status: AgentTurnStatus): AgentTurnTraceSummary {
    return {
        turnId,
        agentUserId: "agent-1",
        status,
        entryCount: 3,
        subagents: [],
        backgroundTerminals: [],
    };
}
function entryIds(entries: readonly WorkspaceEntry[]): string[] {
    return entries.map((entry) => entry.id);
}
it("groups consecutive same-author manual messages", () => {
    const list: WorkspaceEntry[] = [message({ id: "a" }), message({ id: "b" })];
    expect(messagesGrouped(list, 1, list[1] as LiveChatMessage)).toBe(true);
});
it("never folds an automated message into a preceding manual run", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", automated: false }),
        message({ id: "b", automated: true }),
    ];
    /* The automated follow-up must start a new group so its meta row (and the
       Automated marker that only the lead row renders) is not swallowed. */
    expect(messagesGrouped(list, 1, list[1] as LiveChatMessage)).toBe(false);
});
it("never folds a manual message into a preceding automated run", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", automated: true }),
        message({ id: "b", automated: false }),
    ];
    expect(messagesGrouped(list, 1, list[1] as LiveChatMessage)).toBe(false);
});
it("groups consecutive automated messages from the same author", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", automated: true }),
        message({ id: "b", automated: true }),
    ];
    expect(messagesGrouped(list, 1, list[1] as LiveChatMessage)).toBe(true);
});
it("does not group across different authors regardless of automation", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", author: "Maya Johnson", automated: true }),
        message({ id: "b", author: "Nora Kim", automated: true }),
    ];
    expect(messagesGrouped(list, 1, list[1] as LiveChatMessage)).toBe(false);
});
it("keeps every message of a running turn visible", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", agentTrace: trace("t1", "running") }),
        message({ id: "b", agentTrace: trace("t1", "running") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["a", "b"]);
});
it("collapses a completed turn to its last message with body text", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", body: "thinking", agentTrace: trace("t1", "complete") }),
        message({ id: "b", body: "final answer", agentTrace: trace("t1", "complete") }),
        message({ id: "c", body: "", agentTrace: trace("t1", "complete") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["b"]);
});
it("collapses a completed turn with no body text to its last message", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", body: "", agentTrace: trace("t1", "complete") }),
        message({ id: "b", body: "   ", agentTrace: trace("t1", "complete") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["b"]);
});
it("collapses a failed turn like a completed one", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", body: "partial", agentTrace: trace("t1", "failed") }),
        message({ id: "b", body: "", agentTrace: trace("t1", "failed") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["a"]);
});
it("collapses turns independently and leaves plain messages untouched", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "u", body: "hi" }),
        message({ id: "a1", body: "step", agentTrace: trace("t1", "complete") }),
        message({ id: "a2", body: "answer 1", agentTrace: trace("t1", "complete") }),
        message({ id: "b1", body: "step", agentTrace: trace("t2", "complete") }),
        message({ id: "b2", body: "answer 2", agentTrace: trace("t2", "complete") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["u", "a2", "b2"]);
});
it("does not merge adjacent messages from different turns", () => {
    const list: WorkspaceEntry[] = [
        message({ id: "a", body: "one", agentTrace: trace("t1", "complete") }),
        message({ id: "b", body: "two", agentTrace: trace("t2", "complete") }),
    ];
    expect(entryIds(turnsCollapse(list))).toEqual(["a", "b"]);
});
