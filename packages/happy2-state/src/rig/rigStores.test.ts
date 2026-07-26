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
    ConversationActivityEntry,
    ConversationEntry,
    ConversationMessageEntry,
    ConversationToolCall,
} from "../conversation/conversationEntry.js";
import type { Loadable } from "../conversation/loadable.js";
import type { RigProjectGroup } from "./rigProjectGroupProject.js";
import type {
    RigEventId,
    RigSession,
    RigMessage,
    RigModelCatalog,
    RigSessionId,
    RigSessionUsage,
} from "./rigTypes.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The render shape of one conversation entry, used so kind-order assertions stay
 * readable: local messages carry their author, activity carries its variant.
 */
function entryShape(entry: ConversationEntry): string {
    if (entry.kind === "message")
        return entry.message.sender?.kind === "agent" ? "agentText" : "user";
    if (entry.kind === "agentActivity") return entry.activity.kind;
    if (entry.kind === "request") return "request";
    if (entry.kind === "turnStatus") return "turnStatus";
    return entry.variant === "divider" ? "divider" : "notice";
}

function shapesOf(store: RigChatStore): string[] {
    return store.get().entries.map(entryShape);
}

function entriesOfShape(store: RigChatStore, shape: string): readonly ConversationEntry[] {
    return store.get().entries.filter((entry) => entryShape(entry) === shape);
}

/** The agent's rendered text plus whether that row is still generating. */
function agentTexts(store: RigChatStore): { text: string; streaming: boolean }[] {
    return entriesOfShape(store, "agentText").map((entry) => ({
        text: (entry as ConversationMessageEntry).message.text,
        streaming: (entry as ConversationMessageEntry).message.generationStatus === "streaming",
    }));
}

function toolCalls(store: RigChatStore): ConversationToolCall[] {
    return entriesOfShape(store, "tool")
        .map(
            (entry) =>
                (entry as ConversationActivityEntry).activity as { tool: ConversationToolCall },
        )
        .map((activity) => activity.tool);
}

/** The loaded durable session, for assertions about daemon-applied settings. */
function sessionOf(store: RigChatStore): RigSession {
    const session = store.get().session;
    if (session.type !== "ready") throw new Error("The session is not loaded.");
    return session.value;
}

/** The project rows of a list snapshot, which must be loaded to assert on. */
function projectsOf(store: { get(): { projects: Loadable<readonly RigProjectGroup[]> } }) {
    const projects = store.get().projects;
    if (projects.type !== "ready") throw new Error("The list is not loaded.");
    return projects.value;
}

/** Every conversation row of a list snapshot, in project then session order. */
function rowsOf(store: { get(): { projects: Loadable<readonly RigProjectGroup[]> } }) {
    return projectsOf(store).flatMap((project) => [
        ...project.conversations,
        ...project.worktrees.flatMap((worktree) => worktree.conversations),
    ]);
}

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
    it("keeps the order the host listed sessions in and reconciles durable truth after a hint", async () => {
        const fake = createFakeRigTransport();
        // The host owns presentation order (it holds the user's durable
        // arrangement as a fractional index), so the list renders what the keys
        // say rather than re-sorting by recency: `c` is listed first despite
        // being the newest by nothing but its key.
        fake.sessionSet(fakeRigSession("c", { createdAt: 300, orderKey: "a0" }));
        fake.sessionSet(fakeRigSession("b", { createdAt: 200, orderKey: "a1" }));
        fake.sessionSet(fakeRigSession("a", { createdAt: 100, orderKey: "a2" }));
        const store = rigSessionListStoreCreate({ transport: fake.transport });
        const unsubscribe = store.subscribe(() => undefined);
        await flush();

        expect(store.get().projects.type).toBe("ready");
        expect(rowsOf(store).map((row) => row.id)).toEqual(["c", "b", "a"]);

        // A global event is only a delivery hint: the payload it carries is never
        // upserted, so a row appears exactly when the daemon durably has it.
        fake.globalEmit({
            cursor: "1",
            type: "session_created",
            session: fakeRigSummary("d", { createdAt: 400 }),
        });
        await flush();
        expect(rowsOf(store).map((row) => row.id)).toEqual(["c", "b", "a"]);

        fake.sessionSet(fakeRigSession("d", { createdAt: 400, orderKey: "a3" }));
        fake.globalEmit({
            cursor: "2",
            type: "session_created",
            session: fakeRigSummary("d", { createdAt: 400 }),
        });
        await flush();
        expect(rowsOf(store).map((row) => row.id)).toEqual(["c", "b", "a", "d"]);

        fake.sessionSet(fakeRigSession("a", { createdAt: 100, orderKey: "a2", title: "Renamed" }));
        fake.globalEmit({
            cursor: "3",
            type: "session_updated",
            session: fakeRigSummary("a", { createdAt: 100, title: "Renamed" }),
        });
        await flush();
        expect(rowsOf(store)[2]?.title).toBe("Renamed");
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

    it("preserves the snapshot and skips notification for an unchanged durable refresh", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("a", { title: "Alpha" }));
        const store = rigSessionListStoreCreate({ transport: fake.transport });
        let notifications = 0;
        const unsubscribe = store.subscribe(() => {
            notifications += 1;
        });
        await flush();

        const before = store.get();
        const projects = projectsOf(store);
        notifications = 0;
        await store.sessionsRefresh();

        expect(store.get()).toBe(before);
        expect(projectsOf(store)).toBe(projects);
        expect(notifications).toBe(0);
        unsubscribe();
    });
});

describe("rigChatStore streaming reconciliation", () => {
    it("preserves the snapshot and skips notification for an unchanged durable reconcile", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { title: "Alpha" }));
        const catalog = await catalogOf(fake);
        const store = rigChatStoreCreate("s1" as RigSessionId, {
            transport: fake.transport,
            catalog,
            now: () => 5_000,
        });
        let notifications = 0;
        const unsubscribe = store.subscribe(() => {
            notifications += 1;
        });
        await flush();

        const before = store.get();
        const entries = before.entries;
        notifications = 0;
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "session_title_changed",
                status: "ready",
                title: "Payload title is only a hint",
            }),
        );
        await flush();

        expect(store.get()).toBe(before);
        expect(store.get().entries).toBe(entries);
        expect(notifications).toBe(0);
        unsubscribe();
    });

    it("hydrates then assembles streaming deltas into a finalized message", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e0" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        expect(store.get().session.type).toBe("ready");

        fake.sessionSet(
            fakeRigSession("s1", {
                status: "running",
                lastEventId: "e1" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        await flush();
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
        expect(agentTexts(store)[0]).toEqual({ text: "Hello", streaming: true });

        const finalized: RigMessage = {
            id: "m1",
            role: "agent",
            internal: false,
            blocks: [{ type: "text", text: "Hello" }],
        };
        fake.sessionSet(
            fakeRigSession("s1", {
                status: "idle",
                messages: [finalized],
                lastEventId: "e6" as RigEventId,
            }),
        );
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
        await flush();

        expect(store.get().streaming).toBeUndefined();
        expect(store.get().runStatus).toBe("idle");
        expect(store.get().turnElapsedMs).toBe(0);
        expect(agentTexts(store)[0]).toEqual({ text: "Hello", streaming: false });

        // A reordered delta from the completed run cannot recreate a second row.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e3", 3, {
                type: "agent_event",
                runId: "r1",
                event: { type: "text_delta", text: " stale" },
            }),
        );
        expect(agentTexts(store)).toEqual([{ text: "Hello", streaming: false }]);
        await flush();
        expect(agentTexts(store)).toEqual([{ text: "Hello", streaming: false }]);
        unsubscribe();
    });

    it("keeps completed run ids retired and routes after delayed A to the active C run", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const completed = (id: string, text: string): RigMessage => ({
            id,
            role: "agent",
            internal: false,
            blocks: [{ type: "text", text }],
        });
        const a = completed("message-a", "A");
        const b = completed("message-b", "B");

        fake.sessionSet(fakeRigSession("s1", { status: "running" }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "a1", 1, { type: "run_started", runId: "run-a" }),
        );
        await flush();
        fake.sessionSet(fakeRigSession("s1", { status: "idle", messages: [a] }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "a2", 2, {
                type: "run_finished",
                runId: "run-a",
                stopReason: "stop",
                modelLocked: false,
            }),
        );
        await flush();

        fake.sessionSet(fakeRigSession("s1", { status: "running", messages: [a] }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "b1", 3, { type: "run_started", runId: "run-b" }),
        );
        await flush();
        fake.sessionSet(fakeRigSession("s1", { status: "idle", messages: [a, b] }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "b2", 4, {
                type: "run_finished",
                runId: "run-b",
                stopReason: "stop",
                modelLocked: false,
            }),
        );
        await flush();

        fake.sessionSet(fakeRigSession("s1", { status: "running", messages: [a, b] }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "c1", 5, { type: "run_started", runId: "run-c" }),
        );
        await flush();
        expect(store.get().runId).toBe("run-c");

        // A is older than the most recently completed B. Remembering only B
        // would let this delayed delta replace C and poison guarded actions.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "a-late", 6, {
                type: "agent_event",
                runId: "run-a",
                event: { type: "text_delta", text: "stale" },
            }),
        );
        await flush();
        expect(store.get().runId).toBe("run-c");
        expect(agentTexts(store).some(({ text }) => text.includes("stale"))).toBe(false);

        await store.messageSend("steer C");
        expect(fake.calls.at(-1)).toMatchObject({
            operation: "messageSteer",
            expectedRunId: "run-c",
        });
        await store.runAbort();
        expect(fake.calls.at(-1)).toMatchObject({
            operation: "runAbort",
            expectedRunId: "run-c",
        });
        unsubscribe();
    });

    it("shows a run-finished error as a notice without making it durable state", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e0" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "run_finished",
                runId: "r1",
                stopReason: "error",
                modelLocked: false,
                errorMessage: "Provider connection failed.",
            }),
        );
        await flush();

        // Why the run stopped exists only on this event: the durable session
        // records that it stopped, never the reason. So the text is rendered,
        // while the event stays a delivery hint — it advances no cursor and
        // adds nothing to the durable message log.
        expect(entriesOfShape(store, "notice")).toMatchObject([
            { level: "error", text: "Provider connection failed." },
        ]);
        expect(sessionOf(store).lastEventId).toBe("e0");
        expect(sessionOf(store).messages).toEqual([]);

        // Redelivery of the same failure must not stack a second notice.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "run_finished",
                runId: "r1",
                stopReason: "error",
                modelLocked: false,
                errorMessage: "Provider connection failed.",
            }),
        );
        await flush();
        expect(entriesOfShape(store, "notice")).toHaveLength(1);
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
        expect(toolCalls(store)[0]).toMatchObject({ toolName: "Bash", status: "running" });

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
        const tool = toolCalls(store)[0];
        expect(tool).toMatchObject({
            status: "success",
            display: "done",
            presentation: { type: "execCommand", command: "ls", output: "file.txt" },
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
        const tool = toolCalls(store)[0];
        expect(tool).toMatchObject({
            status: "awaitingApproval",
            review: { risk: "medium" },
        });
        unsubscribe();
    });

    it("tracks user_input_requested and user_input_resolved", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const request = {
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
        } as const;
        fake.sessionSet(
            fakeRigSession("s1", {
                pendingUserInputs: [request],
                lastEventId: "e1" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "user_input_requested",
                request,
            }),
        );
        await flush();
        expect(store.get().pendingUserInputs).toHaveLength(1);
        fake.sessionSet(
            fakeRigSession("s1", {
                pendingUserInputs: [],
                lastEventId: "e2" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "user_input_resolved",
                requestId: "q1",
                status: "answered",
            }),
        );
        await flush();
        expect(store.get().pendingUserInputs).toHaveLength(0);
        unsubscribe();
    });

    it("deduplicates a pending input answer and clears its request state on success", async () => {
        const fake = createFakeRigTransport();
        const request = {
            requestId: "q1",
            questions: [],
        } as const;
        fake.sessionSet(fakeRigSession("s1", { pendingUserInputs: [request] }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const gate = fake.deferNext("answerUserInput");
        const input = { requestId: "q1", answers: { choice: ["A"] } };

        const first = store.answerInput(input);
        const duplicate = store.answerInput(input);
        expect(duplicate).toBe(first);
        expect(store.get().requestSubmissions).toEqual([{ requestId: "q1", status: "pending" }]);
        expect(fake.calls.filter((call) => call.operation === "answerUserInput")).toHaveLength(1);

        gate.release();
        await first;
        expect(store.get().pendingUserInputs).toEqual([]);
        expect(store.get().requestSubmissions).toEqual([]);
        unsubscribe();
    });

    it("surfaces an input answer failure by request id and retries it successfully", async () => {
        const fake = createFakeRigTransport();
        const request = {
            requestId: "q1",
            questions: [],
        } as const;
        fake.sessionSet(fakeRigSession("s1", { pendingUserInputs: [request] }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const input = { requestId: "q1", answers: { choice: ["A"] } };

        fake.failNext("answerUserInput", new Error("Rig rejected the answer."));
        await expect(store.answerInput(input)).rejects.toThrow("Rig rejected the answer.");
        expect(store.get().requestSubmissions).toMatchObject([
            {
                requestId: "q1",
                status: "failed",
                error: { message: "Rig rejected the answer." },
            },
        ]);
        expect(store.get().pendingUserInputs).toEqual([request]);

        await store.answerInput(input);
        expect(fake.calls.filter((call) => call.operation === "answerUserInput")).toHaveLength(2);
        expect(store.get().pendingUserInputs).toEqual([]);
        expect(store.get().requestSubmissions).toEqual([]);
        unsubscribe();
    });

    it("applies model, effort, and permission-mode changes to the snapshot", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        fake.sessionSet(
            fakeRigSession("s1", {
                modelId: "gpt-fast",
                providerId: "openai",
                effort: "low",
                lastEventId: "e1" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "model_changed",
                modelId: "gpt-fast",
                providerId: "openai",
                effort: "low",
            }),
        );
        await flush();
        expect(sessionOf(store).modelId).toBe("gpt-fast");
        expect(store.get().menus?.currentModelId).toBe("gpt-fast");

        fake.sessionSet(
            fakeRigSession("s1", {
                modelId: "gpt-fast",
                effort: "medium",
                lastEventId: "e2" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, { type: "effort_changed", modelId: "gpt-fast", effort: "medium" }),
        );
        await flush();
        expect(sessionOf(store).effort).toBe("medium");

        fake.sessionSet(
            fakeRigSession("s1", {
                modelId: "gpt-fast",
                effort: "medium",
                permissionMode: "read_only",
                lastEventId: "e3" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e3", 3, {
                type: "permission_mode_changed",
                permissionMode: "read_only",
            }),
        );
        await flush();
        expect(sessionOf(store).permissionMode).toBe("read_only");
        expect(store.get().menus?.currentPermissionMode).toBe("read_only");
        unsubscribe();
    });
});

describe("rigChatStore durable hint reconciliation", () => {
    it("keeps durable messages, title, and config across out-of-order event payloads", async () => {
        const fake = createFakeRigTransport();
        const durableMessage: RigMessage = {
            id: "durable-message",
            role: "agent",
            internal: false,
            blocks: [{ type: "text", text: "Durable answer" }],
        };
        fake.sessionSet(
            fakeRigSession("s1", {
                title: "Durable title",
                modelId: "gpt-fast",
                effort: "medium",
                permissionMode: "full_access",
                messages: [durableMessage],
                lastEventId: "e10" as RigEventId,
            }),
        );
        const { store, unsubscribe } = await chatReady(fake, "s1");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e20", 20, {
                type: "session_updated",
                session: fakeRigSession("s1", {
                    title: "Payload title",
                    modelId: "gpt-default",
                    effort: "low",
                    permissionMode: "read_only",
                    messages: [
                        {
                            id: "payload-message",
                            role: "agent",
                            internal: false,
                            blocks: [{ type: "text", text: "Payload answer" }],
                        },
                    ],
                }),
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "session_title_changed",
                status: "ready",
                title: "Late stale title",
            }),
        );

        // Neither the newer nor the late older payload can mutate the snapshot.
        expect(agentTexts(store)).toEqual([{ text: "Durable answer", streaming: false }]);
        expect(sessionOf(store)).toMatchObject({
            title: "Durable title",
            modelId: "gpt-fast",
            effort: "medium",
            permissionMode: "full_access",
        });
        await flush();
        expect(agentTexts(store)).toEqual([{ text: "Durable answer", streaming: false }]);
        expect(sessionOf(store)).toMatchObject({
            title: "Durable title",
            modelId: "gpt-fast",
            effort: "medium",
            permissionMode: "full_access",
        });
        unsubscribe();
    });

    it("coalesces a burst of duplicate hints into one read plus one follow-up", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const readsBefore = fake.calls.filter((call) => call.operation === "sessionRead").length;
        const deferred = fake.deferNext("sessionRead");
        const duplicate = event("s1", "duplicate", 1, {
            type: "permission_mode_changed",
            permissionMode: "read_only",
        });

        for (let index = 0; index < 25; index += 1)
            fake.sessionEmit("s1" as RigSessionId, duplicate);

        expect(fake.calls.filter((call) => call.operation === "sessionRead")).toHaveLength(
            readsBefore + 1,
        );
        deferred.release();
        await flush();
        expect(fake.calls.filter((call) => call.operation === "sessionRead")).toHaveLength(
            readsBefore + 2,
        );
        expect(sessionOf(store).permissionMode).toBe("auto");
        unsubscribe();
    });

    it("does not add messages, tasks, or requests absent from the durable session", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e0" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "message_submitted",
                message: {
                    id: "phantom",
                    role: "user",
                    internal: false,
                    blocks: [{ type: "text", text: "Never persisted" }],
                },
                displayText: "Never persisted",
                runId: "r1",
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "tasks_changed",
                tasks: [
                    {
                        id: "phantom-task",
                        subject: "Not durable",
                        description: "Ignore this payload",
                        status: "pending",
                        blockedBy: [],
                        blocks: [],
                    },
                ],
            }),
        );
        await flush();

        expect(sessionOf(store).messages).toEqual([]);
        expect(store.get().tasks).toEqual([]);
        expect(store.get().pendingUserInputs).toEqual([]);
        expect(entriesOfShape(store, "user")).toEqual([]);
        unsubscribe();
    });

    it("changes lastEventId only from authoritative reads and never from reordered hints", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e5" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        const deferred = fake.deferNext("sessionRead");

        fake.sessionSet(fakeRigSession("s1"));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e99", 99, {
                type: "permission_mode_changed",
                permissionMode: "read_only",
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "permission_mode_changed",
                permissionMode: "full_access",
            }),
        );
        expect(sessionOf(store).lastEventId).toBe("e5");
        deferred.release();
        await flush();
        // An authoritative read with no cursor cannot erase the last verified one.
        expect(sessionOf(store).lastEventId).toBe("e5");

        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e6" as RigEventId }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e0", 0, {
                type: "permission_mode_changed",
                permissionMode: "read_only",
            }),
        );
        await flush();
        expect(sessionOf(store).lastEventId).toBe("e6");
        unsubscribe();
    });

    it("does not publish a reconciliation that resolves after disposal", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { title: "Before" }));
        const { store } = await chatReady(fake, "s1");
        const deferred = fake.deferNext("sessionRead");
        fake.sessionSet(fakeRigSession("s1", { title: "After" }));
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "session_title_changed",
                status: "ready",
                title: "After",
            }),
        );
        const beforeDispose = store.get();

        store[Symbol.dispose]();
        deferred.release();
        await flush();

        expect(store.get()).toBe(beforeDispose);
        expect(sessionOf(store).title).toBe("Before");
    });
});

describe("rigChatStore actions", () => {
    it("submits when idle and steers while running", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        await store.messageSend("first");
        expect(fake.calls.at(-1)).toMatchObject({ operation: "messageSubmit", text: "first" });

        fake.sessionSet(
            fakeRigSession("s1", {
                status: "running",
                lastEventId: "e1" as RigEventId,
            }),
        );
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, { type: "run_started", runId: "r1" }),
        );
        await flush();
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
        const tools = toolCalls(store);
        // Exactly one tool entry — the result-only message emits nothing on its own.
        expect(tools).toHaveLength(1);
        expect(tools[0]).toMatchObject({
            status: "failed",
            failed: true,
            display: "Command exited with code 1: boom",
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
        const kinds = shapesOf(store);
        expect(kinds).toEqual(["user", "tool", "user", "agentText"]);
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
        // The finished turn collapses to its final message, which carries the
        // turn summary behind "View trace".
        expect(shapesOf(store)).toEqual(["user", "agentText"]);
        expect(store.get().expandedTurnIds.has("u1")).toBe(false);

        store.turnTraceToggle("u1");
        expect(shapesOf(store)).toEqual(["user", "agentText", "tool"]);
        expect(store.get().expandedTurnIds.has("u1")).toBe(true);

        store.turnTraceToggle("u1");
        expect(shapesOf(store)).toEqual(["user", "agentText"]);
        unsubscribe();
    });

    it("searches workspace files for mention candidates without mutating the snapshot", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.filesSet("s1" as RigSessionId, [
            { fileName: "rigChatStore.ts", path: "packages/happy2-state/src/rig/rigChatStore.ts" },
            { fileName: "rigTypes.ts", path: "packages/happy2-state/src/rig/rigTypes.ts" },
            { fileName: "AppRigView.tsx", path: "packages/happy2-app/sources/AppRigView.tsx" },
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

        fake.sessionSet(
            fakeRigSession("s1", {
                queuedMessages: [],
                lastEventId: "e1" as RigEventId,
            }),
        );
        // The event is only a hint; the fresh durable session clears the queue.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "session_updated",
                session: fakeRigSession("s1", {
                    queuedMessages: [{ id: "payload-only", text: "Ignore me." }],
                }),
            }),
        );
        await flush();
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

    it("opens and closes the settings dialog without disturbing the panels", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        const { store, unsubscribe } = await chatReady(fake, "s1");

        expect(store.get().settingsOpen).toBe(false);
        store.settingsOpen();
        expect(store.get().settingsOpen).toBe(true);

        // Opening is idempotent: a second call does not emit a new snapshot.
        const opened = store.get();
        store.settingsOpen();
        expect(store.get()).toBe(opened);

        // The dialog is pure view state: it closes no panel and starts no work.
        store.activityPanelToggle();
        expect(store.get().activityPanelOpen).toBe(true);
        expect(store.get().settingsOpen).toBe(true);

        store.settingsClose();
        expect(store.get().settingsOpen).toBe(false);
        expect(store.get().activityPanelOpen).toBe(true);
        const closed = store.get();
        store.settingsClose();
        expect(store.get()).toBe(closed);

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("treats shell lifecycle event payloads as hints rather than transcript state", async () => {
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
        await flush();
        expect(entriesOfShape(store, "shell")).toEqual([]);

        unsubscribe();
        store[Symbol.dispose]();
    });

    it("shellRun falls back to the returned result when no events arrive", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1"));
        fake.shellResultSet("s1" as RigSessionId, { output: "hi\n", exitCode: 3 });
        const { store, unsubscribe } = await chatReady(fake, "s1");

        await store.shellRun("echo hi");
        const shell = entriesOfShape(store, "shell")[0];
        expect(shell).toMatchObject({
            activity: { running: false, output: "hi\n", exitCode: 3 },
        });

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
        expect(shapesOf(store)).toContain("user");

        store.viewClear();
        expect(store.get().entries.length).toBe(0);

        const secondMessage: RigMessage = {
            id: "m2",
            role: "user",
            internal: false,
            blocks: [{ type: "text", text: "two" }],
        };
        fake.sessionSet(
            fakeRigSession("s1", {
                messages: [
                    {
                        id: "m1",
                        role: "user",
                        internal: false,
                        blocks: [{ type: "text", text: "one" }],
                    },
                    secondMessage,
                ],
                lastEventId: "e1" as RigEventId,
            }),
        );
        // A subsequent durable message appears after the clear and renders normally.
        fake.sessionEmit(
            "s1" as RigSessionId,
            event("s1", "e1", 1, {
                type: "message_submitted",
                message: secondMessage,
                displayText: "two",
                runId: "r1",
            }),
        );
        await flush();
        const users = entriesOfShape(store, "user");
        expect(users.length).toBe(1);
        expect(store.get().entries.length).toBe(1);
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
        expect(shapesOf(store)).not.toContain("reasoning");
        store.reasoningToggle();
        expect(shapesOf(store)).toContain("reasoning");
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

    it("uses backfill only as a hint and reconciles the durable session after a drop", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("s1", { lastEventId: "e1" as RigEventId }));
        const { store, unsubscribe } = await chatReady(fake, "s1");
        // The missed payload is stale; the durable read carries the actual result.
        fake.sessionLogAppend(
            "s1" as RigSessionId,
            event("s1", "e2", 2, {
                type: "permission_mode_changed",
                permissionMode: "read_only",
            }),
        );
        fake.sessionSet(
            fakeRigSession("s1", {
                permissionMode: "full_access",
                lastEventId: "e2" as RigEventId,
            }),
        );
        fake.sessionErrorEmit("s1" as RigSessionId);
        await flush();
        expect(fake.calls.some((call) => call.operation === "sessionEventsBackfill")).toBe(true);
        expect(sessionOf(store).permissionMode).toBe("full_access");
        expect(sessionOf(store).lastEventId).toBe("e2");
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
