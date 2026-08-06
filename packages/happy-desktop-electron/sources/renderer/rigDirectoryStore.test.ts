import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeSnapshot, HappyDesktopBridge } from "../shared/desktopContract";
import type { RigConnectionHandle, RigSession } from "./rigConnection";
import type { DesktopRuntimeStore } from "./runtimeStore";

const { connectionOpen } = vi.hoisted(() => ({ connectionOpen: vi.fn() }));
vi.mock("./rigConnection", () => ({ rigConnectionOpen: connectionOpen }));

const { rigDirectoryStoreCreate } = await import("./rigDirectoryStore");

const READY: DesktopRuntimeSnapshot = {
    phase: "ready",
    activeTarget: {
        authentication: "rig",
        detail: "",
        id: "local",
        kind: "local",
        label: "This Mac",
        mode: "local",
        rigHttpUrl: "http://127.0.0.1:9999",
        rigVersion: "0.0.136",
    },
    activeTargetId: "local",
    connectionId: 1,
    mode: "local",
    targets: [],
    update: { status: "idle" },
};

/**
 * A session as far as this store can tell it apart from a real one: it reads the
 * workspace and nothing else. Standing in for one matters because a daemon this
 * build has refused still answers the legacy endpoints well enough to produce it.
 */
function sessionStub(): RigSession {
    return {
        connection: {
            get: () => ({
                attempt: 0,
                connection: "connected",
                daemon: "ready",
            }),
            subscribe: () => () => undefined,
        },
        workspace: {
            get: () => ({
                list: { projects: { type: "loading" } },
                projectAdd: { pending: false },
            }),
            subscribe: () => () => undefined,
        },
    } as unknown as RigSession;
}

/** The desktop runtime held at `ready`, which is all this store reads from it. */
function runtimeStub(): DesktopRuntimeStore {
    const listeners = new Set<() => void>();
    return {
        get: () => READY,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/**
 * Opens the store on connections whose verdicts the test drives, and hands back
 * the levers: what each connection reports and the `changed` call that is the
 * only way it tells the store anything.
 */
function fixtureCreate() {
    const connections = new Map<
        string,
        { changed: () => void; failure?: string; session?: RigSession }
    >();
    const bridge = {
        browserOpenSubscribe: () => () => undefined,
    } as unknown as HappyDesktopBridge;
    connectionOpen.mockImplementation(
        (input: { rigId: string; deps: { changed: () => void } }): RigConnectionHandle => {
            const state = { changed: input.deps.changed };
            connections.set(input.rigId, state);
            return {
                dispose: vi.fn(),
                failure: () => connections.get(input.rigId)?.failure,
                get: () => connections.get(input.rigId)?.session,
            };
        },
    );
    const store = rigDirectoryStoreCreate(bridge, runtimeStub(), {
        conversationOpen: vi.fn(),
        groupOpen: vi.fn(),
        listOpen: vi.fn(),
        modelPreferencePersistence: {} as never,
    });
    store.subscribe(() => undefined);
    return {
        local: () => store.get().rigs.find((rig) => rig.id === "local"),
        /** Replaces what the connection reports; anything omitted is now absent. */
        report(next: { failure?: string; session?: RigSession }, id = "local") {
            const state = connections.get(id);
            if (!state) throw new Error(`No connection was opened for ${id}.`);
            state.failure = next.failure;
            state.session = next.session;
            state.changed();
        },
    };
}

beforeEach(() => {
    connectionOpen.mockReset();
});

describe("rig directory rows", () => {
    it("shows the refusal even though a legacy daemon supplied a session", () => {
        const fixture = fixtureCreate();

        fixture.report({
            failure:
                "The Rig server protocol is version 4, but this rig-connect build requires at least version 6.",
            session: sessionStub(),
        });

        const local = fixture.local();
        expect(local?.status).toBe("error");
        expect(local?.message).toContain("version 4");
        // The regression this guards: a row that says its projects are merely on
        // their way is a row that spins forever behind a daemon nothing will read.
        expect(local?.projectsStatus).toBe("error");
    });

    it("clears the refusal once the machine becomes readable", () => {
        const fixture = fixtureCreate();
        fixture.report({ failure: "Rig is too old." });
        expect(fixture.local()?.status).toBe("error");

        fixture.report({ session: sessionStub() });

        const local = fixture.local();
        expect(local?.status).toBe("connected");
        expect(local?.message).toBeUndefined();
        expect(local?.session).toBeDefined();
    });
});
