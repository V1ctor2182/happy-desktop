import {
    HappyAgentApiError,
    type CloudDevice,
    type CloudDevicePlatform,
    type HappyAgentClient,
} from "@slopus/happy-agent-client";
import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { happyAgentUserError, referencesPreserve } from "./happyAgentSupport.js";

/** How often the roster is re-read while a surface is watching it. */
const POLL_INTERVAL_MS = 10_000;

/** One installation on the account's roster, as the surface lists it. */
export interface HappyAgentCloudDevice {
    /** The Happy Agent version this installation runs. */
    readonly agentVersion?: string;
    readonly architecture?: string;
    /** True for the installation this window is talking to. */
    readonly current: boolean;
    readonly id: string;
    /** When this installation last reached the account, in milliseconds. */
    readonly lastAccessedAt: number;
    /**
     * What the installation calls itself. Absent when its roster entry carries
     * no owner-decrypted metadata, which is a device this account can see but
     * cannot yet describe — never a device with no name.
     */
    readonly name?: string;
    readonly osVersion?: string;
    readonly platform?: CloudDevicePlatform;
    /** True while this window is waiting for the account to drop it. */
    readonly removing: boolean;
}

/**
 * What the last read of the roster established.
 *
 * `unavailable` is its own answer rather than a failure: Happy Agent names that
 * state itself when its link to the account is down, and it is the one outcome
 * the next poll is expected to clear on its own. Reporting it as a failure would
 * claim something is broken when the only true statement is that the roster is
 * not readable yet.
 */
export type HappyAgentCloudDevicesRead =
    | { readonly status: "loading" }
    | { readonly status: "ready" }
    | { readonly status: "unavailable" }
    | { readonly error: UserError; readonly status: "failed" };

export interface HappyAgentCloudDevicesSnapshot {
    /**
     * The roster, newest access first, with this installation always at the
     * head. Empty until a read answers; `read` says what an empty list means.
     */
    readonly devices: readonly HappyAgentCloudDevice[];
    /** What the last read established. */
    readonly read: HappyAgentCloudDevicesRead;
    /** Why the last removal was refused. Cleared by the next attempt. */
    readonly removeError?: UserError;
}

export interface HappyAgentCloudDevicesStore {
    get(): HappyAgentCloudDevicesSnapshot;
    subscribe(listener: () => void): () => void;
    /** Drops another installation from the account. The current one cannot be dropped. */
    deviceRemove(id: string): void;
    [Symbol.dispose](): void;
}

export interface HappyAgentCloudDevicesStoreDeps {
    readonly client: Pick<HappyAgentClient, "getCloudDevices" | "removeCloudDevice">;
}

const EMPTY: HappyAgentCloudDevicesSnapshot = { devices: [], read: { status: "loading" } };

/**
 * The devices signed into this Happy Social account.
 *
 * Happy Agent reports the roster on request and has no event for it, so the
 * store re-reads it while something is watching and stops the moment the last
 * subscriber leaves. That is the stopgap the reactivity contract allows for a
 * surface with no realtime channel; when the daemon grows a `cloud.devices`
 * event this follows it instead.
 *
 * The constructor opens nothing: the first subscriber starts the reads.
 */
export function happyAgentCloudDevicesStoreCreate(
    deps: HappyAgentCloudDevicesStoreDeps,
): HappyAgentCloudDevicesStore {
    const store = createStore<HappyAgentCloudDevicesSnapshot>()(() => EMPTY);
    const listeners = new Set<() => void>();
    let controller: AbortController | undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Removals in flight, so a poll landing mid-removal keeps the row busy. */
    const removing = new Set<string>();

    /**
     * Replaces the roster while keeping the reference of every row that did not
     * change, so a poll that finds nothing new re-renders nothing.
     */
    const devicesAdopt = (devices: readonly CloudDevice[]): void => {
        const current = store.getState();
        const next = referencesPreserve(current.devices, devicesProject(devices, removing));
        store.setState({ ...current, devices: next, read: { status: "ready" } }, true);
    };

    const read = async (active: AbortController): Promise<void> => {
        for (;;) {
            try {
                const response = await deps.client.getCloudDevices({ signal: active.signal });
                if (active.signal.aborted) return;
                devicesAdopt(response.devices);
            } catch (error: unknown) {
                if (active.signal.aborted) return;
                store.setState({ read: readFailure(error) }, false);
            }
            await new Promise<void>((resolve) => {
                if (active.signal.aborted) {
                    resolve();
                    return;
                }
                const settle = (): void => {
                    active.signal.removeEventListener("abort", settle);
                    if (timer !== undefined) clearTimeout(timer);
                    timer = undefined;
                    resolve();
                };
                timer = setTimeout(settle, POLL_INTERVAL_MS);
                active.signal.addEventListener("abort", settle, { once: true });
            });
            if (active.signal.aborted) return;
        }
    };

    const readEnsure = (): void => {
        if (disposed || listeners.size === 0 || controller !== undefined) return;
        const active = new AbortController();
        controller = active;
        void read(active).finally(() => {
            if (controller === active) controller = undefined;
        });
    };

    const readStop = (): void => {
        controller?.abort();
        controller = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            if (listeners.size === 1) readEnsure();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) readStop();
            };
        },
        deviceRemove(id) {
            const current = store.getState();
            const device = current.devices.find((candidate) => candidate.id === id);
            if (disposed || device === undefined || device.current || device.removing) return;
            removing.add(id);
            const { removeError: _cleared, ...rest } = current;
            store.setState({ ...rest, devices: devicesBusy(current.devices, removing) }, true);
            void deps.client.removeCloudDevice(id).then(
                (response) => {
                    removing.delete(id);
                    if (disposed) return;
                    // The mutation answers with the roster it left behind, so
                    // the removed row leaves without waiting for the next poll.
                    devicesAdopt(response.devices);
                },
                (error: unknown) => {
                    removing.delete(id);
                    if (disposed) return;
                    const latest = store.getState();
                    store.setState(
                        {
                            devices: devicesBusy(latest.devices, removing),
                            removeError: happyAgentUserError(error),
                        },
                        false,
                    );
                },
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            readStop();
            removing.clear();
            listeners.clear();
        },
    };
}

/**
 * The roster in the order it reads best: this installation first, then the rest
 * by how recently they reached the account. The daemon returns whatever order
 * its store gave it, and a list whose head moves as devices check in is not a
 * list anyone can keep their place in.
 */
function devicesProject(
    devices: readonly CloudDevice[],
    removing: ReadonlySet<string>,
): readonly HappyAgentCloudDevice[] {
    return devices
        .map((device): HappyAgentCloudDevice => {
            const metadata = device.metadata;
            return {
                current: device.current,
                id: device.id,
                lastAccessedAt: device.lastAccessedAt,
                removing: removing.has(device.id),
                ...(metadata === null
                    ? {}
                    : {
                          agentVersion: metadata.agentVersion,
                          architecture: metadata.architecture,
                          name: metadata.name,
                          osVersion: metadata.osVersion,
                          platform: metadata.platform,
                      }),
            };
        })
        .sort((left, right) => {
            if (left.current !== right.current) return left.current ? -1 : 1;
            return right.lastAccessedAt - left.lastAccessedAt;
        });
}

/** Re-marks which rows are busy without disturbing the identity of the others. */
function devicesBusy(
    devices: readonly HappyAgentCloudDevice[],
    removing: ReadonlySet<string>,
): readonly HappyAgentCloudDevice[] {
    return referencesPreserve(
        devices,
        devices.map((device) => {
            const busy = removing.has(device.id);
            return device.removing === busy ? device : { ...device, removing: busy };
        }),
    );
}

/**
 * Reads a failed roster request into the answer it actually carries.
 *
 * Happy Agent names a down account link `cloud_unavailable`, and answers 503
 * for the same condition under names this build may not know yet. Both are the
 * roster being unreadable for now, which the next poll clears; anything else is
 * a genuine failure and says so.
 */
function readFailure(error: unknown): HappyAgentCloudDevicesRead {
    if (error instanceof HappyAgentApiError) {
        if (error.code === "cloud_unavailable" || error.status === 503)
            return { status: "unavailable" };
    }
    return { error: happyAgentUserError(error), status: "failed" };
}

const UNAVAILABLE: HappyAgentCloudDevicesSnapshot = {
    devices: [],
    read: { status: "unavailable" },
};

/** A settled stand-in when this window has no account to read a roster from. */
export const happyAgentCloudDevicesStoreNoop: HappyAgentCloudDevicesStore = {
    get: () => UNAVAILABLE,
    subscribe: () => () => undefined,
    deviceRemove: () => undefined,
    [Symbol.dispose]: () => undefined,
};
