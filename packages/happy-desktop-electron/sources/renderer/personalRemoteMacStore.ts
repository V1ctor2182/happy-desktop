import type {
    DesktopPersonalRemoteMacMountWriteRequest,
    DesktopPersonalRemoteMacShareEnableRequest,
    DesktopPersonalRemoteMacSnapshot,
    HappyDesktopBridge,
} from "../shared/desktopContract";

export interface PersonalRemoteMacStore {
    get(): DesktopPersonalRemoteMacSnapshot | undefined;
    subscribe(listener: () => void): () => void;
    settingsSubscribe(listener: () => void): () => void;
    mountWrite(request: DesktopPersonalRemoteMacMountWriteRequest): Promise<void>;
    mountRemove(): Promise<void>;
    retry(): Promise<void>;
    shareEnable(request: DesktopPersonalRemoteMacShareEnableRequest): Promise<void>;
    shareDisable(): Promise<void>;
    shareRotate(): Promise<void>;
}

/** Synchronous renderer projection of the main-owned, credential-redacted feature. */
export function personalRemoteMacStoreCreate(bridge: HappyDesktopBridge): PersonalRemoteMacStore {
    let snapshot: DesktopPersonalRemoteMacSnapshot | undefined;
    let snapshotKey: string | undefined;
    const listeners = new Set<() => void>();
    let unsubscribe: (() => void) | undefined;
    let settingsSubscribers = 0;
    let settingsPoll: ReturnType<typeof setInterval> | undefined;
    const publish = (next: DesktopPersonalRemoteMacSnapshot) => {
        const nextKey = JSON.stringify(next);
        if (nextKey === snapshotKey) return;
        snapshot = next;
        snapshotKey = nextKey;
        for (const listener of listeners) listener();
    };
    const refresh = (): void => {
        void bridge.personalRemoteMacGet().then(publish, () => undefined);
    };
    const subscribe = (listener: () => void): (() => void) => {
        listeners.add(listener);
        if (listeners.size === 1) {
            unsubscribe = bridge.personalRemoteMacSubscribe(publish);
            refresh();
        }
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                unsubscribe?.();
                unsubscribe = undefined;
            }
        };
    };
    const act = async (operation: Promise<void>): Promise<void> => {
        try {
            await operation;
        } finally {
            await bridge.personalRemoteMacGet().then(publish, () => undefined);
        }
    };
    return {
        get: () => snapshot,
        subscribe,
        settingsSubscribe(listener) {
            const dispose = subscribe(listener);
            settingsSubscribers += 1;
            if (settingsSubscribers === 1) settingsPoll = setInterval(refresh, 3_000);
            return () => {
                settingsSubscribers -= 1;
                if (settingsSubscribers === 0 && settingsPoll !== undefined) {
                    clearInterval(settingsPoll);
                    settingsPoll = undefined;
                }
                dispose();
            };
        },
        mountWrite: (request) => act(bridge.personalRemoteMacMountWrite(request)),
        mountRemove: () => act(bridge.personalRemoteMacMountRemove()),
        retry: () => act(bridge.personalRemoteMacRetry()),
        shareEnable: (request) => act(bridge.personalRemoteMacShareEnable(request)),
        shareDisable: () => act(bridge.personalRemoteMacShareDisable()),
        shareRotate: () => act(bridge.personalRemoteMacShareRotate()),
    };
}
