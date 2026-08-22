import type {
    ChatElement,
    CompactionElement,
    ToolCallElement,
} from "../happyAgentConnection/index.js";
import { expect, it } from "vitest";
import { happyAgentConversationProject } from "./happyAgentConversationProject.js";

const running: CompactionElement = {
    id: "compaction:c1",
    groupId: "g1",
    runId: "r1",
    createdAt: 1_000,
    kind: "compaction",
    compactionId: "c1",
    status: "running",
    estimatedTokensBefore: 249_234,
};

function compactionProject(element: CompactionElement) {
    const [entry] = happyAgentConversationProject({
        elements: [element],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [],
        answeredUserInputs: [],
        expandedGroupIds: new Set(),
        subagents: [],
    });
    if (entry?.kind !== "agentActivity" || entry.activity.kind !== "labeled")
        throw new Error("Compaction did not project to labeled activity.");
    return entry.activity;
}

it("projects humanized token subjects throughout compaction", () => {
    expect(compactionProject(running)).toEqual({
        kind: "labeled",
        label: "Compacting context",
        subject: "from 249k tokens",
        status: "running",
        mono: false,
    });

    expect(
        compactionProject({
            ...running,
            status: "completed",
            estimatedTokensAfter: 5_330,
        }),
    ).toEqual({
        kind: "labeled",
        label: "Compacted context",
        subject: "249k → 5.3k tokens",
        status: "success",
        mono: false,
    });
});

it("keeps a standalone manual compaction activity and completion time", () => {
    const completed: CompactionElement = {
        ...running,
        status: "completed",
        estimatedTokensAfter: 5_330,
    };
    const groupEnd: Extract<ChatElement, { kind: "group_end" }> = {
        id: "group-end:g1",
        groupId: "g1",
        runId: "r1",
        createdAt: 32_000,
        kind: "group_end",
        turnKind: "compaction",
        outcome: "success",
        reason: "completed",
        startedAt: 1_000,
        endedAt: 32_000,
        elapsedMs: 31_000,
        turnStartedAt: 1_000,
        turnElapsedMs: 31_000,
    };

    const projected = happyAgentConversationProject({
        elements: [completed, groupEnd],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [],
        answeredUserInputs: [],
        expandedGroupIds: new Set(),
        subagents: [],
    });

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({
        kind: "agentActivity",
        activity: {
            kind: "labeled",
            label: "Compacted context",
            subject: "249k → 5.3k tokens",
            status: "success",
        },
    });
    expect(projected[1]).toMatchObject({
        kind: "turnStatus",
        status: "complete",
        durationMs: 31_000,
    });
});

const askTool: ToolCallElement = {
    id: "tool:ask-1",
    groupId: "g1",
    runId: "r1",
    createdAt: 2_000,
    kind: "tool_call",
    toolCallId: "ask-1",
    name: "AskUserQuestion",
    arguments: {},
    argumentsComplete: true,
    status: "succeeded",
};

const questions = [
    {
        id: "choice",
        header: "Choose",
        question: "Which direction?",
        multiSelect: false,
        required: true,
        options: [{ label: "Native", description: "Keep it quiet." }],
    },
] as const;

it("pins a pending Ask User request to the end of the transcript, leaving no tool row", () => {
    const entries = happyAgentConversationProject({
        elements: [askTool],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [{ requestId: "ask-1", questions }],
        answeredUserInputs: [],
        expandedGroupIds: new Set(),
        subagents: [],
    });

    expect(entries).toEqual([
        {
            kind: "request",
            id: "request:ask-1",
            sequence: "00000001",
            request: {
                kind: "userInput",
                requestId: "ask-1",
                questions,
                status: "pending",
            },
        },
    ]);
});

it("keeps an answered Ask User request once and prefers it over a stale pending copy", () => {
    const entries = happyAgentConversationProject({
        elements: [askTool],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [{ requestId: "ask-1", questions }],
        answeredUserInputs: [
            {
                requestId: "ask-1",
                questions,
                answers: { choice: ["Native"] },
                createdAt: 1_900,
                resolvedAt: 2_100,
            },
        ],
        expandedGroupIds: new Set(),
        subagents: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
        kind: "request",
        id: "request:ask-1",
        sequence: "00000001",
        request: {
            kind: "userInput",
            requestId: "ask-1",
            status: "answered",
            answers: { choice: ["Native"] },
            createdAt: 1_900,
            resolvedAt: 2_100,
        },
    });
});

it("appends a pending request with no element of its own and drops an answered one", () => {
    const base = {
        elements: [],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [{ requestId: "ask-1", questions }],
        expandedGroupIds: new Set<string>(),
        subagents: [],
    } as const;

    expect(
        happyAgentConversationProject({
            ...base,
            answeredUserInputs: [],
        }),
    ).toHaveLength(1);
    expect(
        happyAgentConversationProject({
            ...base,
            pendingUserInputs: [],
            answeredUserInputs: [
                {
                    requestId: "ask-1",
                    questions,
                    answers: { choice: ["Native"] },
                    createdAt: 1_900,
                    resolvedAt: 2_100,
                },
            ],
        }),
    ).toEqual([]);
});
