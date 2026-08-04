import type { RigWindowSnapshot, RigWindowStore } from "happy-desktop-state";
import type { DesktopWindowState, HappyDesktopBridge } from "../shared/desktopContract";

const windowed: RigWindowSnapshot = { fullScreen: false };

/**
 * One coarse bridge subscription owns the window's chrome state for the whole
 * renderer. The main process pushes every full-screen transition, and the
 * initial read fills in the state the window already had when this surface
 * mounted; a push that arrives first wins over that read.
 */
export function windowStateStoreCreate(bridge: HappyDesktopBridge): RigWindowStore {
    let snapshot: RigWindowSnapshot = windowed;
    let bridgeUnsubscribe: (() => void) | undefined;
    let eventReceived = false;
    const listeners = new Set<() => void>();
    const publish = (next: DesktopWindowState) => {
        if (snapshot.fullScreen === next.fullScreen) return;
        snapshot = { fullScreen: next.fullScreen };
        for (const listener of listeners) listener();
    };
    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                eventReceived = false;
                bridgeUnsubscribe = bridge.windowStateSubscribe((next) => {
                    eventReceived = true;
                    publish(next);
                });
                void bridge
                    .windowStateGet()
                    .then((initial) => {
                        if (!eventReceived) publish(initial);
                    })
                    .catch(() => undefined);
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    bridgeUnsubscribe?.();
                    bridgeUnsubscribe = undefined;
                }
            };
        },
    };
}
