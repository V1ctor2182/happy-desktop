import { describe, expect, it } from "vitest";
import { rigPluginApplicationSourceCreate } from "./rigPluginApplicationSource";
import type { DesktopPluginApplication, DesktopPluginCatalog } from "../shared/desktopContract";
import type { RigPluginApplicationSourceReading } from "happy2-state";

/**
 * The projection the window renders plugin rows from, exercised exactly as the
 * shell drives it: a bridge that announces whole catalogs, and the real source
 * created over it.
 *
 * What matters here is identity rather than text. The shell re-announces its
 * entire catalog for any change in it, and rows are rendered from these objects,
 * so an application nobody touched has to come back as the object it already
 * was — otherwise every row in the sidebar looks new whenever one plugin
 * finishes preparing its code.
 */
function application(overrides: Partial<DesktopPluginApplication> = {}): DesktopPluginApplication {
    return {
        generation: "g1",
        id: "reporter:overview",
        label: "Accounts",
        order: 10,
        pluginId: "reporter",
        status: "ready",
        title: "Account overview",
        source: "happy-plugin://abc/index.html",
        ...overrides,
    };
}

function catalog(applications: readonly DesktopPluginApplication[]): DesktopPluginCatalog {
    return { applications, packages: [], packageFailures: [], connection: "live", loading: false };
}

function harness() {
    let announce: (value: DesktopPluginCatalog) => void = () => undefined;
    const readings: RigPluginApplicationSourceReading[] = [];
    const source = rigPluginApplicationSourceCreate({
        pluginApplicationsGet: () => new Promise(() => undefined),
        pluginApplicationsSubscribe: (listener) => {
            announce = listener;
            return () => undefined;
        },
    })!;
    const release = source.subscribe(
        (reading) => readings.push(reading),
        () => undefined,
    );
    return { announce: (value: DesktopPluginCatalog) => announce(value), readings, release };
}

describe("rigPluginApplicationSourceCreate", () => {
    it("keeps the object an unchanged application was already projected as", () => {
        const { announce, readings } = harness();
        const other = application({ id: "reporter:usage", label: "Usage", order: 20 });

        announce(catalog([application(), other]));
        announce(catalog([application(), other]));

        expect(readings).toHaveLength(2);
        expect(readings[1]!.applications[0]).toBe(readings[0]!.applications[0]);
        expect(readings[1]!.applications[1]).toBe(readings[0]!.applications[1]);
        // Nothing in the list changed, so the list itself is the same list.
        expect(readings[1]!.applications).toBe(readings[0]!.applications);
    });

    it("replaces only the application that changed", () => {
        const { announce, readings } = harness();
        const other = application({ id: "reporter:usage", label: "Usage", order: 20 });

        announce(catalog([application({ source: undefined, status: "loading" }), other]));
        announce(catalog([application(), other]));

        const before = readings[0]!.applications;
        const after = readings[1]!.applications;
        expect(after[0]).not.toBe(before[0]);
        expect(after[0]).toMatchObject({
            source: "happy-plugin://abc/index.html",
            status: "ready",
        });
        // Its neighbour was not touched, so its row has nothing to re-render.
        expect(after[1]).toBe(before[1]);
        expect(after).not.toBe(before);
    });

    it("treats a new generation of the same application as a different thing", () => {
        const { announce, readings } = harness();

        announce(catalog([application()]));
        announce(catalog([application({ generation: "g2" })]));

        // The id is where navigation points and survives; the generation is the
        // code, and replaced code is a replacement rather than an update.
        expect(readings[1]!.applications[0]).not.toBe(readings[0]!.applications[0]);
        expect(readings[1]!.applications[0]).toMatchObject({
            generation: "g2",
            id: "reporter:overview",
        });
    });

    it("does not resurrect an application the catalog stopped naming", () => {
        const { announce, readings } = harness();
        const first = application();

        announce(catalog([first]));
        announce(catalog([]));
        announce(catalog([first]));

        expect(readings[1]!.applications).toEqual([]);
        // It comes back as a fresh projection: it was gone, and what returned is
        // whatever the daemon is naming now rather than what was held before.
        expect(readings[2]!.applications[0]).not.toBe(readings[0]!.applications[0]);
        expect(readings[2]!.applications[0]).toEqual(readings[0]!.applications[0]);
    });

    it("reports the feed's own state alongside the projection", () => {
        const { announce, readings } = harness();

        announce({
            applications: [],
            packages: [],
            packageFailures: [],
            connection: "reconnecting",
            loading: false,
        });

        expect(readings[0]).toMatchObject({ connection: "reconnecting", loading: false });
    });
});
