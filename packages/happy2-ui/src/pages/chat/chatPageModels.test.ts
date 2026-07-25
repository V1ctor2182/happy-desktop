import { expect, it } from "vitest";
import type { AgentTurnStatus, AgentTurnTraceSummary } from "happy2-state";
import {
    messagesGrouped,
    traceStepsShown,
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
it("streams the steps of a running turn and folds away a finished one", () => {
    const running = message({ id: "a", agentTrace: trace("t1", "running") });
    const finished = message({ id: "b", agentTrace: trace("t1", "complete") });
    expect(traceStepsShown(running, { traces: {}, expandedMessageIds: [] })).toBe(true);
    expect(traceStepsShown(finished, { traces: {}, expandedMessageIds: [] })).toBe(false);
    expect(traceStepsShown(finished, { traces: {}, expandedMessageIds: ["b"] })).toBe(true);
});
it("shows no steps for a message that never ran a turn", () => {
    expect(traceStepsShown(message({ id: "u" }), { traces: {}, expandedMessageIds: ["u"] })).toBe(
        false,
    );
});
