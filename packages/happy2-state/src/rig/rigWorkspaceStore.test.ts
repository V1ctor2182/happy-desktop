import { describe, expect, it } from "vitest";
import { rigClientCreate } from "./rigClient.js";
import {
    rigWorkspaceStoreCreate,
    type RigConversationSnapshot,
    type RigWorkspaceStore,
} from "./rigWorkspaceStore.js";
import { createFakeRigTransport, fakeRigSession } from "../testing/fake-rig.js";
import type { RigSessionId } from "./rigTypes.js";

/** Drains the deep chain of promise continuations behind async chat acquisition. */
async function flush(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function conversationReady(workspace: RigWorkspaceStore): RigConversationSnapshot {
    const conversation = workspace.get().conversation;
    expect(conversation.type).toBe("ready");
    if (conversation.type !== "ready") throw new Error("Expected a ready conversation.");
    return conversation.value;
}

describe("rigWorkspaceStore", () => {
    it("hydrates the conversation list and materializes the selected conversation", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a", { title: "Alpha" }));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);

        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        const list = workspace.get().list.conversations;
        expect(list.type).toBe("ready");
        expect(list.type === "ready" && list.value.map((row) => row.id)).toEqual(["session-a"]);
        expect(list.type === "ready" && list.value[0]!.title).toBe("Alpha");
        expect(workspace.get().conversation.type).toBe("unloaded");

        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        expect(conversationReady(workspace).conversationId).toBe("session-a");
        expect(conversationReady(workspace).session.type).toBe("ready");
        expect(fake.sessionSubscriberCount).toBe(1);

        unsubscribe();
        expect(fake.sessionSubscriberCount).toBe(0);
        workspace[Symbol.dispose]();
    });

    it("switches the conversation lease on selection and disposes the previous one", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        fake.sessionSet(fakeRigSession("session-b"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);

        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();
        expect(conversationReady(workspace).conversationId).toBe("session-a");

        workspace.conversationSelect("session-b" as RigSessionId);
        await flush();
        expect(conversationReady(workspace).conversationId).toBe("session-b");
        // Only the currently-selected conversation holds a live subscription.
        expect(fake.sessionSubscriberCount).toBe(1);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("returns a referentially stable snapshot across no-op notifications", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        const before = workspace.get();
        // Re-selecting the already-selected conversation is a no-op: same reference.
        workspace.conversationSelect("session-a" as RigSessionId);
        expect(workspace.get()).toBe(before);
        expect(workspace.get().conversation).toBe(before.conversation);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("drives the daemon from composer output instead of a view-owned draft", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        workspace.composerTextUpdate("ship it");
        expect(conversationReady(workspace).composer.text).toBe("ship it");
        workspace.composerTextSubmit();
        expect(conversationReady(workspace).composer.submission.status).toBe("pending");
        await flush();

        // The confirmed submission clears the draft without any React state.
        expect(conversationReady(workspace).composer.text).toBe("");
        expect(conversationReady(workspace).composer.submission.status).toBe("idle");
        expect(
            fake.calls
                .filter((call) => call.operation === "messageSubmit")
                .map((call) => call.text),
        ).toEqual(["ship it"]);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("opens panels from composer commands and the usage panel action", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        fake.usageSet("session-a" as RigSessionId, {
            currentProviderId: "openai",
            groups: [],
            totalTokens: 42,
            totalCost: 0,
            quotas: [],
        });
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        expect(conversationReady(workspace).usagePanelOpen).toBe(false);
        workspace.usagePanelOpen();
        expect(conversationReady(workspace).usagePanelOpen).toBe(true);
        await flush();
        expect(conversationReady(workspace).usage?.totalTokens).toBe(42);

        workspace.usagePanelClose();
        expect(conversationReady(workspace).usagePanelOpen).toBe(false);

        // `/tasks` opens the activity panel idempotently through the composer.
        workspace.composerCommandInvoke("tasks");
        expect(conversationReady(workspace).activityPanelOpen).toBe(true);
        workspace.composerCommandInvoke("tasks");
        expect(conversationReady(workspace).activityPanelOpen).toBe(true);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("rejects conversation actions when nothing is selected", async () => {
        const fake = createFakeRigTransport();
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        await expect(workspace.runAbort()).rejects.toThrow(/No local conversation/);
        // Composer actions without a selection are inert, not a crash.
        workspace.composerTextUpdate("ignored");
        expect(workspace.get().conversation.type).toBe("unloaded");

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("surfaces acquisition failure with the selected id and retries successfully", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        fake.failNext("modelsRead", new Error("catalog unavailable"));
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        expect(workspace.get().list.selectedId).toBe("session-a");
        const failed = workspace.get().conversation;
        expect(failed.type).toBe("error");
        expect(failed.type === "error" && failed.error.message).toBe("catalog unavailable");

        workspace.conversationRetry();
        expect(workspace.get().conversation.type).toBe("loading");
        await flush();

        expect(conversationReady(workspace).conversationId).toBe("session-a");
        expect(fake.calls.filter((call) => call.operation === "modelsRead")).toHaveLength(2);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("re-selects the same failed conversation by starting a new acquisition", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        fake.failNext("modelsRead");
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();
        expect(workspace.get().conversation.type).toBe("error");

        workspace.conversationSelect("session-a" as RigSessionId);
        expect(workspace.get().conversation.type).toBe("loading");
        await flush();

        expect(conversationReady(workspace).conversationId).toBe("session-a");
        expect(fake.calls.filter((call) => call.operation === "modelsRead")).toHaveLength(2);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("ignores a late acquisition for a conversation that is no longer selected", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        fake.sessionSet(fakeRigSession("session-b"));
        const catalogGate = fake.deferNext("modelsRead");
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        workspace.conversationSelect("session-a" as RigSessionId);
        expect(workspace.get().conversation.type).toBe("loading");
        workspace.conversationSelect("session-b" as RigSessionId);
        expect(workspace.get().list.selectedId).toBe("session-b");
        expect(workspace.get().conversation.type).toBe("loading");

        catalogGate.release();
        await flush();

        expect(conversationReady(workspace).conversationId).toBe("session-b");
        expect(fake.sessionSubscriberCount).toBe(1);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("rejects the stale first response in an @a -> @ab -> @a mention race", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        const firstGate = fake.deferNext("filesSearch");
        workspace.composerTextUpdate("@a");

        fake.filesSet("session-a" as RigSessionId, [
            { fileName: "ab-new.ts", path: "src/ab-new.ts" },
        ]);
        workspace.composerTextUpdate("@ab");
        await flush();
        expect(
            conversationReady(workspace).composer.mentionCandidates.map((item) => item.id),
        ).toEqual(["src/ab-new.ts"]);

        fake.filesSet("session-a" as RigSessionId, [
            { fileName: "a-new.ts", path: "src/a-new.ts" },
        ]);
        workspace.composerTextUpdate("@a");
        await flush();
        expect(
            conversationReady(workspace).composer.mentionCandidates.map((item) => item.id),
        ).toEqual(["src/a-new.ts"]);

        fake.filesSet("session-a" as RigSessionId, [
            { fileName: "a-stale.ts", path: "src/a-stale.ts" },
        ]);
        firstGate.release();
        await flush();

        expect(
            conversationReady(workspace).composer.mentionCandidates.map((item) => item.id),
        ).toEqual(["src/a-new.ts"]);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("ignores a mention response after its conversation is released", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        fake.sessionSet(fakeRigSession("session-b"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        let notifications = 0;
        const unsubscribe = workspace.subscribe(() => {
            notifications += 1;
        });
        await flush();
        workspace.conversationSelect("session-a" as RigSessionId);
        await flush();

        const searchGate = fake.deferNext("filesSearch");
        workspace.composerTextUpdate("@a");
        workspace.conversationSelect("session-b" as RigSessionId);
        await flush();
        const before = workspace.get();
        const notificationsBefore = notifications;
        expect(conversationReady(workspace).conversationId).toBe("session-b");

        fake.filesSet("session-a" as RigSessionId, [
            { fileName: "a-late.ts", path: "src/a-late.ts" },
        ]);
        searchGate.release();
        await flush();

        expect(workspace.get()).toBe(before);
        expect(notifications).toBe(notificationsBefore);
        expect(conversationReady(workspace).conversationId).toBe("session-b");

        unsubscribe();
        workspace[Symbol.dispose]();
    });
});
