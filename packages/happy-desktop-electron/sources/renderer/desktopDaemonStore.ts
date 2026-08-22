import type { AppRigDaemonSnapshot, AppRigDaemonStore } from "happy-desktop-app";
import type { DesktopDaemonSnapshot, HappyDesktopBridge } from "../shared/desktopContract";

const initial: AppRigDaemonSnapshot = {
    managed: true,
    operation: "checking",
    runtime: "stopped",
    updateAvailable: false,
    versions: [],
};

/** Adapts the narrow native daemon bridge into the settings surface store. */
export function desktopDaemonStoreCreate(bridge: HappyDesktopBridge): AppRigDaemonStore {
    const listeners = new Set<() => void>();
    let snapshot = initial;
    let unsubscribe: (() => void) | undefined;
    let eventReceived = false;

    const publish = (next: AppRigDaemonSnapshot): void => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const set = (next: DesktopDaemonSnapshot): void => publish(daemonProject(next));

    const fail = (error: unknown): void =>
        publish({ ...snapshot, error: displayError(error), operation: "idle" });
    const busy = (): boolean =>
        snapshot.operation === "upgrading" || snapshot.operation === "downloading";

    return {
        daemonCheck() {
            if (busy() || snapshot.operation === "checking") return;
            publish({ ...snapshot, error: undefined, operation: "checking" });
            void bridge.daemonCheck().catch(fail);
        },
        daemonUpgrade() {
            if (busy()) return;
            publish({ ...snapshot, error: undefined, operation: "upgrading" });
            void bridge.daemonUpgrade().catch(fail);
        },
        daemonVersionSelect(version) {
            if (busy() || version === snapshot.installedVersion) return;
            publish({ ...snapshot, error: undefined, operation: "upgrading" });
            void bridge.daemonVersionSelect(version).catch(fail);
        },
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                eventReceived = false;
                unsubscribe = bridge.daemonSubscribe((next) => {
                    eventReceived = true;
                    set(next);
                });
                void bridge.daemonGet().then(
                    (next) => {
                        if (!eventReceived) set(next);
                    },
                    (error: unknown) =>
                        publish({
                            ...snapshot,
                            error: displayError(error),
                            operation: "idle",
                        }),
                );
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                unsubscribe?.();
                unsubscribe = undefined;
            };
        },
    };
}

function daemonProject(snapshot: DesktopDaemonSnapshot): AppRigDaemonSnapshot {
    return {
        ...(snapshot.availableVersion ? { availableVersion: snapshot.availableVersion } : {}),
        ...(snapshot.error ? { error: snapshot.error } : {}),
        ...(snapshot.installedVersion ? { installedVersion: snapshot.installedVersion } : {}),
        ...(snapshot.message ? { message: snapshot.message } : {}),
        managed: snapshot.managed,
        operation: snapshot.operation,
        runtime: snapshot.runtime,
        updateAvailable: snapshot.updateAvailable,
        versions: snapshot.versions,
    };
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
