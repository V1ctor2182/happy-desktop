import { describe, expect, it } from "vitest";
import { rigClientCreate } from "./rigClient.js";
import { rigWorkspaceStoreCreate } from "./rigWorkspaceStore.js";
import { createFakeRigTransport, fakeRigSession } from "../testing/fake-rig.js";
import type { RigSessionId } from "./rigTypes.js";

/** Drains the deep chain of promise continuations behind async chat acquisition. */
async function flush(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe("rigWorkspaceStore", () => {
    it("hydrates the session list and materializes the chat store for the selection", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a", { title: "Alpha" }));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);

        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        expect(workspace.get().sessionList.status).toBe("ready");
        expect(workspace.get().sessionList.sessions.map((s) => s.id)).toEqual(["session-a"]);
        expect(workspace.get().chat).toBeUndefined();

        workspace.sessionSelect("session-a" as RigSessionId);
        await flush();

        expect(workspace.get().chat?.sessionId).toBe("session-a");
        expect(workspace.get().chat?.status).toBe("ready");
        expect(fake.sessionSubscriberCount).toBe(1);

        unsubscribe();
        expect(fake.sessionSubscriberCount).toBe(0);
        workspace[Symbol.dispose]();
    });

    it("switches the chat lease when the selection changes and disposes the previous one", async () => {
        const fake = createFakeRigTransport();
        fake.sessionSet(fakeRigSession("session-a"));
        fake.sessionSet(fakeRigSession("session-b"));
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);

        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        workspace.sessionSelect("session-a" as RigSessionId);
        await flush();
        expect(workspace.get().chat?.sessionId).toBe("session-a");

        workspace.sessionSelect("session-b" as RigSessionId);
        await flush();
        expect(workspace.get().chat?.sessionId).toBe("session-b");
        // Only the currently-selected chat holds a live subscription.
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
        workspace.sessionSelect("session-a" as RigSessionId);
        await flush();

        const before = workspace.get();
        // Re-selecting the already-selected session is a no-op: same reference.
        workspace.sessionSelect("session-a" as RigSessionId);
        expect(workspace.get()).toBe(before);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("opens and closes the usage panel on the active chat through the combined snapshot", async () => {
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
        workspace.sessionSelect("session-a" as RigSessionId);
        await flush();

        expect(workspace.get().chat?.usagePanelOpen).toBe(false);
        workspace.usagePanelOpen();
        expect(workspace.get().chat?.usagePanelOpen).toBe(true);
        await flush();
        expect(workspace.get().chat?.usage?.totalTokens).toBe(42);

        workspace.usagePanelClose();
        expect(workspace.get().chat?.usagePanelOpen).toBe(false);

        // activityPanelShow delegates and opens the activity panel idempotently.
        workspace.activityPanelShow();
        expect(workspace.get().chat?.activityPanelOpen).toBe(true);
        workspace.activityPanelShow();
        expect(workspace.get().chat?.activityPanelOpen).toBe(true);

        unsubscribe();
        workspace[Symbol.dispose]();
    });

    it("rejects chat actions when no session is selected", async () => {
        const fake = createFakeRigTransport();
        const client = rigClientCreate({ transport: fake.transport });
        const workspace = rigWorkspaceStoreCreate(client);
        const unsubscribe = workspace.subscribe(() => undefined);
        await flush();

        await expect(workspace.messageSend("hi")).rejects.toThrow(/No Rig session/);

        unsubscribe();
        workspace[Symbol.dispose]();
    });
});
