import { describe, expect, it } from "vitest";
import type {
    GlobalEventQueueEntry,
    ModelCatalog,
    ProtocolSession,
    SessionEvent,
    SessionSummary,
    SubagentSummary,
} from "@slopus/rig-client-runtime/dist/protocol/index.js";
import type { AgentSnapshot } from "@slopus/rig-client-runtime/dist/agent/index.js";
import {
    rigCatalogProject,
    rigDisplayCwd,
    rigGlobalEventProject,
    rigSessionEventProject,
    rigSessionProject,
    rigSessionSummaryProject,
    rigShellResultProject,
    rigSubagentProject,
} from "./rigProjection";

const HOME = "/Users/dev";

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
    return {
        id: "agent-1",
        providerId: "openai",
        modelId: "gpt-x",
        status: "idle",
        messages: [],
        queue: [],
        tools: [],
        ...overrides,
    };
}

function session(overrides: Partial<ProtocolSession> = {}): ProtocolSession {
    return {
        id: "session-1",
        agentId: "agent-1",
        cwd: `${HOME}/work`,
        providerId: "openai",
        permissionMode: "auto",
        modelId: "gpt-x",
        secretIds: [],
        projectSecretIds: [],
        sessionSecretIds: [],
        modelLocked: false,
        models: [
            {
                id: "gpt-x",
                name: "GPT X",
                thinkingLevels: ["low", "high"],
                defaultThinkingLevel: "low",
            },
        ],
        status: "idle",
        titleStatus: "ready",
        agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
        snapshot: snapshot(),
        pendingUserInputs: [],
        mcpServers: [],
        tasks: [],
        ...overrides,
    };
}

function envelope<T extends SessionEvent["type"]>(type: T, data: unknown): SessionEvent {
    return {
        id: "event-1",
        sessionId: "session-1",
        createdAt: 5_000,
        type,
        data,
    } as SessionEvent;
}

describe("rigDisplayCwd", () => {
    it("renders a home-relative path and leaves outside paths untouched", () => {
        expect(rigDisplayCwd(`${HOME}/work/app`, HOME)).toBe("~/work/app");
        expect(rigDisplayCwd(HOME, HOME)).toBe("~");
        expect(rigDisplayCwd("/etc/hosts", HOME)).toBe("/etc/hosts");
    });
});

describe("rigCatalogProject", () => {
    it("maps providerId to id and defaults service tiers", () => {
        const catalog: ModelCatalog = {
            defaultModelId: "gpt-x",
            defaultProviderId: "openai",
            models: [
                {
                    id: "gpt-x",
                    name: "GPT X",
                    thinkingLevels: ["low"],
                    defaultThinkingLevel: "low",
                },
            ],
            providers: [
                {
                    providerId: "openai",
                    models: [
                        {
                            id: "gpt-x",
                            name: "GPT X",
                            thinkingLevels: ["low"],
                            defaultThinkingLevel: "low",
                        },
                    ],
                    disabledReason: "not_authenticated",
                },
            ],
        };
        const projected = rigCatalogProject(catalog);
        expect(projected.providers[0]!.id).toBe("openai");
        expect(projected.providers[0]!.serviceTiers).toEqual([]);
        expect(projected.providers[0]!.disabledReason).toBe("not_authenticated");
    });
});

describe("rigSessionProject", () => {
    it("projects messages, tool results, and file-diff presentations", () => {
        const projected = rigSessionProject(
            session({
                title: "Build",
                snapshot: snapshot({
                    messages: [
                        { role: "user", id: "m1", blocks: [{ type: "text", text: "hi" }] },
                        {
                            role: "agent",
                            id: "m2",
                            blocks: [
                                { type: "thinking", thinking: "hmm", redacted: false },
                                {
                                    type: "tool_call",
                                    id: "t1",
                                    name: "edit",
                                    arguments: { path: "a" },
                                },
                                {
                                    type: "tool_result",
                                    toolCallId: "t1",
                                    toolName: "edit",
                                    rendered: [],
                                    display: "Edited a",
                                    presentation: {
                                        type: "file_diff",
                                        files: [
                                            {
                                                path: "a",
                                                kind: "update",
                                                hunks: [
                                                    {
                                                        oldStart: 1,
                                                        newStart: 1,
                                                        lines: [{ kind: "add", text: "x" }],
                                                    },
                                                ],
                                                added: 1,
                                                deleted: 0,
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    ],
                }),
            }),
            HOME,
        );
        expect(projected.displayCwd).toBe("~/work");
        expect(projected.title).toBe("Build");
        expect(projected.messages).toHaveLength(2);
        const agentBlocks = projected.messages[1]!.blocks;
        expect(agentBlocks[1]).toMatchObject({ type: "toolCall", name: "edit" });
        expect(agentBlocks[2]).toMatchObject({
            type: "toolResult",
            display: "Edited a",
            failed: false,
            presentation: { type: "fileDiff" },
        });
    });

    it("projects the steering queue to non-internal user text previews", () => {
        const projected = rigSessionProject(
            session({
                snapshot: snapshot({
                    queue: [
                        {
                            id: "q1",
                            message: {
                                role: "user",
                                id: "u1",
                                blocks: [{ type: "text", text: "push it" }],
                            },
                        },
                        {
                            id: "q2",
                            message: {
                                role: "user",
                                id: "u2",
                                internal: true,
                                blocks: [{ type: "text", text: "internal" }],
                            },
                        },
                        {
                            id: "q3",
                            message: {
                                role: "system",
                                id: "s1",
                                blocks: [{ type: "text", text: "sys" }],
                            },
                        },
                    ],
                }),
            }),
            HOME,
        );
        expect(projected.queuedMessages).toEqual([{ id: "q1", text: "push it" }]);
    });
});

describe("rigSessionSummaryProject", () => {
    it("projects the list summary with a home-relative cwd", () => {
        const summary: SessionSummary = {
            id: "session-1",
            cwd: `${HOME}/work`,
            providerId: "openai",
            modelId: "gpt-x",
            permissionMode: "auto",
            status: "running",
            titleStatus: "ready",
            createdAt: 10,
            updatedAt: 20,
            lastMessageAt: 25,
            title: "Hello",
        };
        expect(rigSessionSummaryProject(summary, HOME)).toMatchObject({
            id: "session-1",
            displayCwd: "~/work",
            status: "running",
            lastMessageAt: 25,
            title: "Hello",
        });
    });
});

describe("rigSubagentProject", () => {
    it("brands session ids and preserves optional fields", () => {
        const sub: SubagentSummary = {
            agentId: "a",
            createdAt: 1,
            depth: 1,
            description: "worker",
            id: "sub-1",
            modelId: "gpt-x",
            parentSessionId: "session-1",
            status: "running",
            updatedAt: 2,
            totalTokens: 42,
        };
        expect(rigSubagentProject(sub)).toMatchObject({
            id: "sub-1",
            parentSessionId: "session-1",
            totalTokens: 42,
        });
    });
});

describe("rigSessionEventProject", () => {
    it("projects streaming agent text deltas", () => {
        const projected = rigSessionEventProject(
            envelope("agent_event", {
                runId: "r1",
                event: {
                    type: "text_delta",
                    contentIndex: 0,
                    delta: "he",
                    partial: { content: [] },
                },
            }),
            HOME,
        );
        expect(projected).toMatchObject({
            type: "agent_event",
            runId: "r1",
            event: { type: "text_delta", text: "he" },
        });
    });

    it("lifts nested background-process changes to a session-level event", () => {
        const projected = rigSessionEventProject(
            envelope("agent_event", {
                runId: "r1",
                event: {
                    type: "background_processes_changed",
                    running: 1,
                    processes: [{ sessionId: 7, command: "sleep", cwd: "/x", status: "running" }],
                },
            }),
            HOME,
        );
        expect(projected).toMatchObject({
            type: "background_processes_changed",
            processes: [{ id: 7, command: "sleep" }],
        });
    });

    it("projects a session reset from its agent snapshot", () => {
        const projected = rigSessionEventProject(
            envelope("session_reset", {
                snapshot: snapshot({ messages: [{ role: "user", id: "m1", blocks: [] }] }),
            }),
            HOME,
        );
        expect(projected).toMatchObject({ type: "session_reset", messages: [{ id: "m1" }] });
    });

    it("carries the provider id from the snapshot on model_changed", () => {
        const projected = rigSessionEventProject(
            envelope("model_changed", {
                modelId: "gpt-y",
                effort: "high",
                snapshot: snapshot({ providerId: "anthropic" }),
            }),
            HOME,
        );
        expect(projected).toMatchObject({
            type: "model_changed",
            modelId: "gpt-y",
            providerId: "anthropic",
            effort: "high",
        });
    });

    it("projects shell command started and finished events", () => {
        expect(
            rigSessionEventProject(
                envelope("shell_command_started", {
                    commandId: "c1",
                    command: "ls",
                    sessionId: 3,
                }),
                HOME,
            ),
        ).toMatchObject({ type: "shell_command_started", commandId: "c1", command: "ls" });
        expect(
            rigSessionEventProject(
                envelope("shell_command_finished", {
                    commandId: "c1",
                    command: "ls",
                    output: "a\n",
                    exitCode: 0,
                    timedOut: false,
                }),
                HOME,
            ),
        ).toMatchObject({
            type: "shell_command_finished",
            commandId: "c1",
            output: "a\n",
            exitCode: 0,
        });
    });

    it("drops events without a chat projection", () => {
        expect(rigSessionEventProject(envelope("abort_requested", {}), HOME)).toBeUndefined();
    });
});

describe("rigShellResultProject", () => {
    it("projects a finished command result with its captured output", () => {
        expect(
            rigShellResultProject({
                status: "finished",
                command: "ls",
                commandId: "c1",
                output: "a\n",
                exitCode: 0,
                timedOut: false,
                eventId: "e1",
            }),
        ).toEqual({
            command: "ls",
            commandId: "c1",
            output: "a\n",
            exitCode: 0,
            timedOut: false,
        });
    });

    it("maps a still-running detached command to an empty result with the background id", () => {
        expect(
            rigShellResultProject({
                status: "running",
                command: "sleep 100",
                commandId: "c2",
                sessionId: 9,
                eventId: "e2",
            }),
        ).toEqual({
            command: "sleep 100",
            commandId: "c2",
            output: "",
            exitCode: null,
            timedOut: false,
            backgroundProcessId: 9,
        });
    });
});

describe("rigGlobalEventProject", () => {
    it("projects session_created using the envelope time and drops other entries", () => {
        const created: GlobalEventQueueEntry = {
            cursor: 3,
            event: envelope("session_created", { session: session() }),
        };
        expect(rigGlobalEventProject(created, HOME)).toMatchObject({
            cursor: 3,
            type: "session_created",
            session: { id: "session-1", createdAt: 5_000 },
        });
        const titled: GlobalEventQueueEntry = {
            cursor: 4,
            event: envelope("session_title_changed", { status: "ready", title: "t" }),
        };
        expect(rigGlobalEventProject(titled, HOME)).toBeUndefined();
    });
});
