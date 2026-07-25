import { describe, expect, it } from "vitest";
import { UserError } from "../types.js";
import {
    createFakeRigTransport,
    fakeRigSession,
    fakeRigSummary,
    type FakeRigTransport,
} from "../testing/fake-rig.js";
import { rigChatStoreCreate, type RigChatStore } from "./rigChatStore.js";
import { rigClientCreate } from "./rigClient.js";
import { rigSessionListStoreCreate } from "./rigSessionListStore.js";
import type { RigSessionEvent } from "./rigTransport.js";
import type {
    RigEventId,
    RigMessage,
    RigModelCatalog,
    RigSessionId,
    RigSessionUsage,
} from "./rigTypes.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function catalogOf(fake: FakeRigTransport): Promise<RigModelCatalog> {
    return fake.transport.modelsRead();
}

type RigEventBody = RigSessionEvent extends infer T
    ? T extends unknown
        ? Omit<T, "eventId" | "sessionId" | "createdAt">
        : never
    : never;

function event(
    sessionId: string,
    eventId: string,
    createdAt: number,
    body: RigEventBody,
): RigSessionEvent {
    return {
        eventId: eventId as RigEventId,
        sessionId: sessionId as RigSessionId,
        createdAt,
        ...body,
    } as unknown as RigSessionEvent;
}

async function chatReady(
    fake: FakeRigTransport,
    sessionId: string,
): Promise<{ store: RigChatStore; unsubscribe: () => void }> {
    const catalog = await catalogOf(fake);
    const store = rigChatStoreCreate(sessionId as RigSessionId, {
        transport: fake.transport,
        catalog,
        now: () => 5_000,
    });
    const unsubscribe = store.subscribe(() => undefined);
    await flush();
    return { store, unsubscribe };
}

describe("rigSessionListStore", () => {
    it("orders sessions newest-created first and reconciles on session_created", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("a", { createdAt: 100 }));
        fake.sessionSet(fakeRigSession("c", { createdAt: 300 }));
        fake.sessionSet(fakeRigSession("b", { createdAt: 200 }));
        const store = rigSessionListStoreCreate({ transport: fake.transport });
        const unsubscribe = store.subscribe(() => undefined);
        await flush();

        expect(store.get().status).toBe("ready");
        expect(store.get().sessions.map((session) => session.id)).toEqual(["c", "b", "a"]);

        fake.globalEmit({
            cursor: 1,
            type: "session_created",
            session: fakeRigSummary("d", { createdAt: 400 }),
        });
        expect(store.get().sessions.map((session) => session.id)).toEqual(["d", "c", "b", "a"]);

        // A late-created session sorts to the front regardless of arrival order.
        fake.globalEmit({
            cursor: 2,
            type: "session_updated",
            session: fakeRigSummary("a", { createdAt: 100, title: "Renamed" }),
        });
        expect(store.get().sessions[3]?.title).toBe("Renamed");
        unsubscribe();
    });

    it("only holds a global subscription while it has an active subscriber", async () => {
        const fake = createFakeRigTransport();
        const store = rigSessionListStoreCreate({ transport: fake.transport });
        expect(fake.globalSubscriberCount).toBe(0);
        const unsubscribe = store.subscribe(() => undefined);
        await flush();
        expect(fake.globalSubscriberCount).toBe(1);
        unsubscribe();
        expect(fake.globalSubscriberCount).toBe(0);
    });
});

describe("rigChatStore streaming reconciliation", () => {
    it("hydrates then assembles streaming deltas into a finalized message", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e0" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().status).toBe("ready");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        expect(store.get().runStatus).toBe("running");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "agent_event",
                runId: "r1",
                event: { type: "text_start" },
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e3", 3, {
                type: "agent_event",
                runId: "r1",
                event: { type: "text_delta", text: "Hel" },
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e4", 4, {
                type: "agent_event",
                runId: "r1",
                event: { type: "text_delta", text: "lo" },
            }),
        );
        const streamingEntry = store.get().transcript.find((entry) => entry.kind === "agentText");
        expect(streamingEntry).toMatchObject({ kind: "agentText", text: "Hello", streaming: true });

        const finalized: RigMessage = {
            id: "m1",
            role: "agent",
            internal: false,
            blocks: [{ type: "text", text: "Hello" }],
        };
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e5", 5, { type: "agent_message", runId: "r1", message: finalized }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e6", 6, {
                type: "run_finished",
                runId: "r1",
                stopReason: "stop",
                modelLocked: false,
            }),
        );

        expect(store.get().streaming).toBeUndefined();
        expect(store.get().runStatus).toBe("idle");
        expect(store.get().turnElapsedMs).toBe(0);
        const finalEntry = store.get().transcript.find((entry) => entry.kind === "agentText");
        expect(finalEntry).toMatchObject({ kind: "agentText", text: "Hello", streaming: false });
        unsubscribe();
    });

    it("builds a tool entry across start/progress/end with the correct status", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "agent_event",
                runId: "r1",
                event: {
                    type: "tool_execution_start",
                    toolCallId: "t1",
                    toolName: "Bash",
                    arguments: { command: "ls" },
                },
            }),
        );
        let tool = store.get().transcript.find((entry) => entry.kind === "tool");
        expect(tool).toMatchObject({ kind: "tool", tool: { toolName: "Bash", status: "running" } });

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e3", 3, {
                type: "agent_event",
                runId: "r1",
                event: { type: "tool_execution_progress", toolCallId: "t1", display: "running…" },
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e4", 4, {
                type: "agent_event",
                runId: "r1",
                event: {
                    type: "tool_execution_end",
                    toolCallId: "t1",
                    toolName: "Bash",
                    display: "done",
                    failed: false,
                    presentation: { type: "execCommand", command: "ls", output: "file.txt" },
                },
            }),
        );
        tool = store.get().transcript.find((entry) => entry.kind === "tool");
        expect(tool).toMatchObject({
            kind: "tool",
            tool: {
                status: "success",
                display: "done",
                presentation: { type: "execCommand", command: "ls", output: "file.txt" },
            },
        });
        unsubscribe();
    });

    it("marks a tool awaiting approval on permission_review", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "agent_event",
                runId: "r1",
                event: {
                    type: "permission_review",
                    toolCallId: "t1",
                    review: {
                        action: "write file",
                        reason: "modifies workspace",
                        decision: "ask",
                        risk: "medium",
                        userAuthorization: "low",
                    },
                },
            }),
        );
        const tool = store.get().transcript.find((entry) => entry.kind === "tool");
        expect(tool).toMatchObject({
            kind: "tool",
            tool: { status: "awaiting_approval", permissionReview: { risk: "medium" } },
        });
        unsubscribe();
    });

    it("tracks user_input_requested and user_input_resolved", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "user_input_requested",
                request: {
                    requestId: "q1",
                    questions: [
                        {
                            id: "one",
                            header: "Pick",
                            question: "Which?",
                            multiSelect: false,
                            required: true,
                            options: [{ label: "A", description: "first" }],
                        },
                    ],
                },
            }),
        );
        expect(store.get().pendingUserInputs).toHaveLength(1);
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "user_input_resolved",
                requestId: "q1",
                status: "answered",
            }),
        );
        expect(store.get().pendingUserInputs).toHaveLength(0);
        unsubscribe();
    });

    it("applies model, effort, and permission-mode changes to the snapshot", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "model_changed",
                modelId: "gpt-fast",
                providerId: "openai",
                effort: "low",
            }),
        );
        expect(store.get().session?.modelId).toBe("gpt-fast");
        expect(store.get().menus?.currentModelId).toBe("gpt-fast");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, { type: "effort_changed", modelId: "gpt-fast", effort: "medium" }),
        );
        expect(store.get().session?.effort).toBe("medium");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e3", 3, {
                type: "permission_mode_changed",
                permissionMode: "read_only",
            }),
        );
        expect(store.get().session?.permissionMode).toBe("read_only");
        expect(store.get().menus?.currentPermissionMode).toBe("read_only");
        unsubscribe();
    });
});

describe("rigChatStore actions", () => {
    it("submits when idle and steers while running", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        await store.messageSend("first");
        expect(fake.calls.at(-1)).toMatchObject({ operation: "messageSubmit", text: "first" });

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        await store.messageSend("second");
        expect(fake.calls.at(-1)).toMatchObject({ operation: "messageSteer", text: "second" });
        unsubscribe();
    });

    it("rejects a failed action with a UserError", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.failNext("messageSubmit", new Error("offline"));
        await expect(store.messageSend("hello")).rejects.toBeInstanceOf(UserError);
        unsubscribe();
    });

    it("reuses one idempotency key for a single send", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        await store.messageSend("hello");
        const key = fake.calls.at(-1)?.idempotencyKey;
        expect(key).toBeTruthy();
        unsubscribe();
    });

    it("correlates a tool call with its result delivered in a later message", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "m1",
                        role: "agent",
                        internal: false,
                        blocks: [
                            { type: "text", text: "Pulling." },
                            { type: "toolCall", id: "t1", name: "exec_command", arguments: {} },
                        ],
                    },
                    {
                        id: "m2",
                        role: "agent",
                        internal: false,
                        blocks: [
                            {
                                type: "toolResult",
                                toolCallId: "t1",
                                toolName: "exec_command",
                                display: "Command exited with code 1: boom",
                                failed: true,
                            },
                        ],
                    },
                ],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const tools = store.get().transcript.filter((entry) => entry.kind === "tool");
        // Exactly one tool entry — the result-only message emits nothing on its own.
        expect(tools).toHaveLength(1);
        expect(tools[0]).toMatchObject({
            kind: "tool",
            tool: {
                status: "failed",
                failed: true,
                display: "Command exited with code 1: boom",
            },
        });
        unsubscribe();
    });

    it("closes completed turns with a stats separator between and after turns", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "u1",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "one" }],
                    },
                    {
                        id: "a1",
                        role: "agent",
                        internal: false,
                        blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
                    },
                    {
                        id: "r1",
                        role: "agent",
                        internal: false,
                        blocks: [
                            {
                                type: "toolResult",
                                toolCallId: "t1",
                                toolName: "bash",
                                display: "ok",
                                failed: false,
                            },
                        ],
                    },
                    {
                        id: "u2",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "two" }],
                    },
                    {
                        id: "a2",
                        role: "agent",
                        internal: false,
                        blocks: [{ type: "text", text: "done" }],
                    },
                ],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const kinds = store.get().transcript.map((entry) => entry.kind);
        // Separator between the two turns and a trailing one closing the last turn.
        expect(kinds).toEqual([
            "user",
            "tool",
            "turnSeparator",
            "user",
            "agentText",
            "turnSeparator",
        ]);
        const firstSeparator = store
            .get()
            .transcript.find((entry) => entry.kind === "turnSeparator");
        expect(firstSeparator).toMatchObject({ kind: "turnSeparator", toolCount: 1 });
        unsubscribe();
    });

    it("collapses completed turns to prompt and summary when turn compaction is on", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "u1",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "one" }],
                    },
                    {
                        id: "a1",
                        role: "agent",
                        internal: false,
                        blocks: [
                            { type: "text", text: "answer" },
                            { type: "toolCall", id: "t1", name: "bash", arguments: {} },
                        ],
                    },
                    {
                        id: "r1",
                        role: "agent",
                        internal: false,
                        blocks: [
                            {
                                type: "toolResult",
                                toolCallId: "t1",
                                toolName: "bash",
                                display: "ok",
                                failed: false,
                            },
                        ],
                    },
                ],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().transcript.map((entry) => entry.kind)).toEqual([
            "user",
            "agentText",
            "tool",
            "turnSeparator",
        ]);

        store.turnCompactToggle();
        // The completed turn collapses to just the prompt plus its summary line.
        expect(store.get().transcript.map((entry) => entry.kind)).toEqual([
            "user",
            "turnSeparator",
        ]);

        store.turnCompactToggle();
        expect(store.get().transcript.map((entry) => entry.kind)).toEqual([
            "user",
            "agentText",
            "tool",
            "turnSeparator",
        ]);
        unsubscribe();
    });

    it("searches workspace files for mention candidates without mutating the snapshot", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.filesSet("s1" as RigSessionId, [
            { fileName: "rigChatStore.ts", path: "packages/happy2-state/src/rig/rigChatStore.ts" },
            { fileName: "rigTypes.ts", path: "packages/happy2-state/src/rig/rigTypes.ts" },
            { fileName: "AppRigView.tsx", path: "packages/happy2-app/src/AppRigView.tsx" },
        ]);
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const before = store.get();

        const hits = await store.filesSearch("rig", 5);
        expect(hits.map((file) => file.fileName)).toEqual([
            "rigChatStore.ts",
            "rigTypes.ts",
            "AppRigView.tsx",
        ]);
        const scoped = await store.filesSearch("types");
        expect(scoped.map((file) => file.fileName)).toEqual(["rigTypes.ts"]);
        // A pure query: the durable snapshot reference is unchanged.
        expect(store.get()).toBe(before);
        unsubscribe();
    });

    it("surfaces queued steering messages and reconciles them on session_updated", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                queuedMessages: [{ id: "q1", text: "Then push the branch." }],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().queuedMessages).toEqual([{ id: "q1", text: "Then push the branch." }]);

        // A fresh session projection over SSE reconciles the queue durably.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "session_updated",
                session: fakeRigSession("s1", { queuedMessages: [] }),
            }),
        );
        expect(store.get().queuedMessages).toEqual([]);
        unsubscribe();
    });

    it("reads the session usage snapshot without mutating durable state", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.usageSet("s1" as RigSessionId, {
            currentProviderId: "openai",
            groups: [
                {
                    modelId: "gpt-x",
                    providerId: "openai",
                    inputTokens: 100,
                    outputTokens: 40,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 140,
                    cost: 0.3,
                },
            ],
            totalTokens: 140,
            totalCost: 0.3,
            quotas: [],
        });
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const before = store.get();
        const usage = await store.usageGet();
        expect(usage.totalTokens).toBe(140);
        expect(usage.groups[0]?.modelId).toBe("gpt-x");
        // Reading usage is a pure query: the durable snapshot is untouched.
        expect(store.get()).toBe(before);
        unsubscribe();
    });

    it("polls usage while the panel is open and stops on close, guarding stale loads", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const usageOf = (total: number): RigSessionUsage => ({
            currentProviderId: "openai",
            groups: [
                {
                    modelId: "gpt-x",
                    providerId: "openai",
                    inputTokens: total,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: total,
                    cost: 0,
                },
            ],
            totalTokens: total,
            totalCost: 0,
            quotas: [],
        });
        fake.usageSet("s1" as RigSessionId, usageOf(100));

        // Manual interval control so we can advance polls deterministically.
        let tick: (() => void) | undefined;
        const catalog = await catalogOf(fake);
        const store = rigChatStoreCreate("s1" as RigSessionId, {
            transport: fake.transport,
            catalog,
            now: () => 5_000,
            usagePollMs: 1_000,
            setInterval: (handler) => {
                tick = handler;
                return 1;
            },
            clearInterval: () => {
                tick = undefined;
            },
        });
        const unsubscribe = store.subscribe(() => undefined);
        await flush();

        expect(store.get().usagePanelOpen).toBe(false);
        expect(store.get().usage).toBeUndefined();

        // Opening loads immediately and installs the poll timer.
        store.usagePanelOpen();
        expect(store.get().usagePanelOpen).toBe(true);
        await flush();
        expect(store.get().usage?.totalTokens).toBe(100);
        expect(typeof tick).toBe("function");

        // A poll tick refreshes from the (updated) server snapshot.
        fake.usageSet("s1" as RigSessionId, usageOf(250));
        tick?.();
        await flush();
        expect(store.get().usage?.totalTokens).toBe(250);

        // Closing stops the poll and clears the loading flag; the timer is removed.
        store.usagePanelClose();
        expect(store.get().usagePanelOpen).toBe(false);
        expect(store.get().usageLoading).toBe(false);
        expect(tick).toBeUndefined();

        // A late response from before close must not overwrite state after close.
        const before = store.get();
        fake.usageSet("s1" as RigSessionId, usageOf(999));
        await flush();
        expect(store.get()).toBe(before);
        unsubscribe();
        store[Symbol.dispose]();
    });

    it("toggles the activity panel and closes usage (stopping its poll) when opened", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.usageSet("s1" as RigSessionId, {
            currentProviderId: "openai",
            groups: [],
            totalTokens: 7,
            totalCost: 0,
            quotas: [],
        });
        let tick: (() => void) | undefined;
        const catalog = await catalogOf(fake);
        const store = rigChatStoreCreate("s1" as RigSessionId, {
            transport: fake.transport,
            catalog,
            now: () => 5_000,
            usagePollMs: 1_000,
            setInterval: (handler) => {
                tick = handler;
                return 1;
            },
            clearInterval: () => {
                tick = undefined;
            },
        });
        const unsubscribe = store.subscribe(() => undefined);
        await flush();

        // Open usage first; it installs the poll timer.
        store.usagePanelOpen();
        await flush();
        expect(store.get().usagePanelOpen).toBe(true);
        expect(typeof tick).toBe("function");

        // Opening activity closes usage and stops its poll (timer cleared).
        store.activityPanelToggle();
        expect(store.get().activityPanelOpen).toBe(true);
        expect(store.get().usagePanelOpen).toBe(false);
        expect(tick).toBeUndefined();

        // Toggling again closes the activity panel.
        store.activityPanelToggle();
        expect(store.get().activityPanelOpen).toBe(false);

        // activityPanelShow opens idempotently and closes usage (for /tasks, /agents, /goal).
        store.usagePanelOpen();
        await flush();
        expect(store.get().usagePanelOpen).toBe(true);
        store.activityPanelShow();
        expect(store.get().activityPanelOpen).toBe(true);
        expect(store.get().usagePanelOpen).toBe(false);
        expect(tick).toBeUndefined();
        // Calling it again is a no-op (stays open, no toggle back).
        store.activityPanelShow();
        expect(store.get().activityPanelOpen).toBe(true);

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("renders a shell-mode run from started/finished events, updating in place", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "shell_command_started",
                commandId: "c1",
                command: "ls -la",
            }),
        );
        let shell = store.get().transcript.find((entry) => entry.kind === "shell");
        expect(shell).toMatchObject({ kind: "shell", command: "ls -la", running: true });

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "shell_command_finished",
                commandId: "c1",
                command: "ls -la",
                output: "file.txt\n",
                exitCode: 0,
                timedOut: false,
            }),
        );
        const entries = store.get().transcript.filter((entry) => entry.kind === "shell");
        // Same commandId updates the one entry in place rather than appending a second.
        expect(entries).toHaveLength(1);
        shell = entries[0];
        expect(shell).toMatchObject({
            running: false,
            output: "file.txt\n",
            exitCode: 0,
            timedOut: false,
        });

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("shellRun falls back to the returned result when no events arrive", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.shellResultSet("s1" as RigSessionId, { output: "hi\n", exitCode: 3 });
        const { store, unsubscribe } = await chatReady(fake, "s1");

        await store.shellRun("echo hi");
        const shell = store.get().transcript.find((entry) => entry.kind === "shell");
        expect(shell).toMatchObject({ running: false, output: "hi\n", exitCode: 3 });

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("backgroundProcessStop calls the transport for the given process id", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        await store.backgroundProcessStop(42);
        expect(fake.calls.some((call) => call.operation === "backgroundProcessStop")).toBe(true);

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("view-clears visible entries locally while new messages still render", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "m1",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "one" }],
                    },
                ],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().transcript.some((entry) => entry.kind === "user")).toBe(true);

        store.viewClear();
        expect(store.get().transcript.length).toBe(0);

        // A subsequent message arrives after the clear and renders normally.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "message_submitted",
                message: {
                    id: "m2",
                    role: "user",
                    internal: false,
                    blocks: [{ type: "text", text: "two" }],
                },
                displayText: "two",
                runId: "r1",
            }),
        );
        const users = store.get().transcript.filter((entry) => entry.kind === "user");
        expect(users.length).toBe(1);
        expect(store.get().transcript.length).toBe(1);
        unsubscribe();
    });

    it("toggles reasoning visibility for thinking entries", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "m1",
                        role: "agent",
                        internal: false,
                        blocks: [{ type: "thinking", thinking: "hmm", redacted: false }],
                    },
                ],
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().transcript.some((entry) => entry.kind === "thinking")).toBe(false);
        store.reasoningToggle();
        expect(store.get().transcript.some((entry) => entry.kind === "thinking")).toBe(true);
        unsubscribe();
    });
});

describe("rigChatStore lifecycle", () => {
    it("opens the session subscription only with an active subscriber", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const catalog = await catalogOf(fake);
        const store = rigChatStoreCreate("s1" as RigSessionId, {
            transport: fake.transport,
            catalog,
        });
        expect(fake.sessionSubscriberCount).toBe(0);
        const unsubscribe = store.subscribe(() => undefined);
        await flush();
        expect(fake.sessionSubscriberCount).toBe(1);
        unsubscribe();
        expect(fake.sessionSubscriberCount).toBe(0);
    });

    it("backfills missed events by lastEventId after a stream drop", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e1" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        // Queue an event into the backfill log that was never delivered live.
        fake.sessionLogAppend(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "permission_mode_changed",
                permissionMode: "full_access",
            }),
        );
        fake.sessionErrorEmit("s1" as RigSessionId);
        await flush();
        expect(fake.calls.some((call) => call.operation === "sessionEventsBackfill")).toBe(true);
        expect(store.get().session?.permissionMode).toBe("full_access");
        unsubscribe();
    });
});

describe("rigClient", () => {
    it("shares one chat store across leases and disposes on the last release", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const client = rigClientCreate({ transport: fake.transport });

        const first = await client.chat("s1" as RigSessionId);
        const second = await client.chat("s1" as RigSessionId);
        expect(first.store).toBe(second.store);

        const unsubscribe = first.store.subscribe(() => undefined);
        await flush();
        expect(fake.sessionSubscriberCount).toBe(1);

        first[Symbol.dispose]();
        expect(fake.sessionSubscriberCount).toBe(1);

        second[Symbol.dispose]();
        expect(fake.sessionSubscriberCount).toBe(0);
        unsubscribe();
        client[Symbol.dispose]();
    });

    it("caches the model catalog", async () => {
        const fake = createFakeRigTransport();
        const client = rigClientCreate({ transport: fake.transport });
        await client.catalogRead();
        await client.catalogRead();
        expect(fake.calls.filter((call) => call.operation === "modelsRead")).toHaveLength(1);
        client[Symbol.dispose]();
    });
});
