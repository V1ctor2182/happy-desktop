import type { ChatElement, CompactionElement } from "@slopus/rig-connect";
import { expect, it } from "vitest";
import { rigConnectConversationProject } from "./rigConnectConversationProject.js";

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
    const [entry] = rigConnectConversationProject({
        elements: [element],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [],
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

    const projected = rigConnectConversationProject({
        elements: [completed, groupEnd],
        sessionId: "s1",
        showReasoning: false,
        ephemeral: [],
        pendingUserInputs: [],
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
