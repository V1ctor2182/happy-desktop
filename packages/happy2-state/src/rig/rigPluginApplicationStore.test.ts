import { describe, expect, it } from "vitest";
import {
    rigPluginApplicationStoreCreate,
    rigPluginApplicationStoreNoop,
    type RigPluginApplication,
    type RigPluginApplicationSource,
    type RigPluginApplicationSourceReading,
} from "./rigPluginApplicationStore.js";

interface FakeSource extends RigPluginApplicationSource {
    /** How many times a follower has been attached over the source's whole life. */
    readonly starts: () => number;
    /** How many of those followers are still attached. */
    readonly following: () => boolean;
    readonly announce: (reading: RigPluginApplicationSourceReading) => void;
    readonly fail: (error: unknown) => void;
}

function fakeSource(): FakeSource {
    let starts = 0;
    let listener: ((reading: RigPluginApplicationSourceReading) => void) | undefined;
    let onError: ((error: unknown) => void) | undefined;
    return {
        subscribe(next, error) {
            starts += 1;
            listener = next;
            onError = error;
            return () => {
                listener = undefined;
                onError = undefined;
            };
        },
        starts: () => starts,
        following: () => listener !== undefined,
        announce: (reading) => listener?.(reading),
        fail: (error) => onError?.(error),
    };
}

function application(
    id: string,
    generation: string,
    extra: Partial<RigPluginApplication> = {},
): RigPluginApplication {
    return {
        id,
        generation,
        pluginId: id.split(":")[0] ?? id,
        title: id,
        label: id,
        order: 0,
        status: "ready",
        source: `happy-plugin://${generation}/index.html`,
        ...extra,
    };
}

function live(applications: readonly RigPluginApplication[]): RigPluginApplicationSourceReading {
    return { applications, packages: [], packageFailures: [], connection: "live", loading: false };
}

describe("rigPluginApplicationStore", () => {
    it("follows the catalog only while something is watching it", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });

        expect(source.following()).toBe(false);
        expect(store.get()).toEqual({
            applications: [],
            packages: [],
            packageFailures: [],
            connection: "connecting",
            loading: true,
        });

        const first = store.subscribe(() => undefined);
        const second = store.subscribe(() => undefined);
        expect(source.starts()).toBe(1);

        first();
        expect(source.following()).toBe(true);
        second();
        expect(source.following()).toBe(false);
    });

    it("follows again for a later watcher after the last one left", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });

        store.subscribe(() => undefined)();
        expect(source.following()).toBe(false);

        store.subscribe(() => undefined);
        expect(source.starts()).toBe(2);
        expect(source.following()).toBe(true);
    });

    it("ignores a watcher released twice, so a sibling keeps the feed", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });

        const release = store.subscribe(() => undefined);
        store.subscribe(() => undefined);
        release();
        release();

        expect(source.following()).toBe(true);
    });

    it("keeps the identity of an application the reconnect brought back unchanged", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });
        store.subscribe(() => undefined);

        const stable = application("usage:main", "gen-1");
        const replaced = application("inbox:main", "gen-1");
        source.announce(live([stable, replaced]));
        const before = store.get().applications;

        // The gap: the feed drops, then returns with one application unchanged,
        // one behind new code, and one gone entirely.
        source.announce({
            applications: before,
            packages: [],
            packageFailures: [],
            connection: "reconnecting",
            loading: false,
        });
        source.announce(live([stable, application("inbox:main", "gen-2")]));

        const after = store.get().applications;
        expect(after.map((entry) => `${entry.id}@${entry.generation}`)).toEqual([
            "usage:main@gen-1",
            "inbox:main@gen-2",
        ]);
        expect(after[0]).toBe(before[0]);
        expect(after[1]).not.toBe(before[1]);
    });

    it("keeps what it holds visible while the feed is away", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });
        store.subscribe(() => undefined);

        source.announce(live([application("usage:main", "gen-1")]));
        source.announce({
            applications: store.get().applications,
            packages: [],
            packageFailures: [],
            connection: "reconnecting",
            loading: false,
        });

        expect(store.get().connection).toBe("reconnecting");
        expect(store.get().applications).toHaveLength(1);
        expect(store.get().loading).toBe(false);
    });

    it("reports a feed failure without emptying the list or staying in loading", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });
        store.subscribe(() => undefined);

        source.announce(live([application("usage:main", "gen-1")]));
        source.fail(new Error("catalog unreachable"));

        expect(store.get().applications).toHaveLength(1);
        expect(store.get().loading).toBe(false);
        expect(store.get().error).toBeDefined();
    });

    it("tells its watchers each time the catalog changes", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });
        let seen = 0;
        store.subscribe(() => {
            seen += 1;
        });

        source.announce(live([application("usage:main", "gen-1")]));
        source.announce(live([application("usage:main", "gen-2")]));

        expect(seen).toBe(2);
    });

    it("lets go of the feed and goes quiet once disposed", () => {
        const source = fakeSource();
        const store = rigPluginApplicationStoreCreate({ source });
        let seen = 0;
        store.subscribe(() => {
            seen += 1;
        });

        store[Symbol.dispose]();
        expect(source.following()).toBe(false);

        source.announce(live([application("usage:main", "gen-1")]));
        expect(seen).toBe(0);
        expect(store.get().applications).toEqual([]);

        store.subscribe(() => undefined);
        expect(source.following()).toBe(false);
    });

    it("reads as settled and empty where no host can mount applications", () => {
        expect(rigPluginApplicationStoreNoop.get()).toEqual({
            applications: [],
            connection: "closed",
            loading: false,
        });
        rigPluginApplicationStoreNoop.subscribe(() => undefined)();
        rigPluginApplicationStoreNoop[Symbol.dispose]();
    });
});
