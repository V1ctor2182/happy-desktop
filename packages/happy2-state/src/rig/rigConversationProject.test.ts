import { describe, expect, it } from "vitest";
import { fakeRigSession, fakeRigSummary } from "../testing/fake-rig.js";
import {
    rigAgentAuthor,
    rigConversationBuild,
    rigConversationSummaryProject,
    rigOwnerAuthor,
} from "./rigConversationProject.js";
import type { RigSessionId } from "./rigTypes.js";

describe("rig conversation projection", () => {
    it("projects a session row with its directory and live activity marker", () => {
        const idle = rigConversationSummaryProject(
            fakeRigSummary("s1", { title: "Fix the parser", updatedAt: 4_000 }),
        );
        expect(idle).toMatchObject({
            id: "s1",
            title: "Fix the parser",
            subtitle: "/workspace",
            activity: "idle",
            updatedAt: 4_000,
        });

        const running = rigConversationSummaryProject(
            fakeRigSummary("s2", { status: "running", lastMessageAt: 9_000 }),
        );
        expect(running).toMatchObject({ activity: "running", updatedAt: 9_000 });
        // A session with no title still names itself rather than rendering blank.
        expect(running.title).toBe("Session s2");
    });

    it("renders streaming output as an ordinary message carrying a generation status", () => {
        const entries = rigConversationBuild({
            sessionId: "s1" as RigSessionId,
            session: fakeRigSession("s1", {
                messages: [
                    {
                        id: "u1",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "hello" }],
                    },
                ],
            }),
            streaming: { runId: "r1", blocks: [{ kind: "text", text: "Wor" }] },
            ephemeral: [],
            showReasoning: false,
            compactTurns: false,
            pendingUserInputs: [
                {
                    requestId: "q1",
                    questions: [
                        {
                            id: "which",
                            header: "Branch",
                            question: "Which branch?",
                            multiSelect: false,
                            required: true,
                            options: [{ label: "main", description: "the trunk" }],
                        },
                    ],
                },
            ],
        });

        expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "request"]);
        expect(entries[0]).toMatchObject({
            kind: "message",
            message: { sender: rigOwnerAuthor, text: "hello" },
        });
        expect(entries[1]).toMatchObject({
            kind: "message",
            message: {
                sender: rigAgentAuthor,
                text: "Wor",
                generationStatus: "streaming",
            },
        });
        expect(entries[2]).toMatchObject({
            kind: "request",
            request: { kind: "userInput", requestId: "q1" },
        });
        // Ordering keys are assigned positionally so the shared helpers can sort.
        expect(
            entries.map((entry) =>
                entry.kind === "message" ? entry.message.sequence : entry.sequence,
            ),
        ).toEqual(["00000001", "00000002", "00000003"]);
    });
});
