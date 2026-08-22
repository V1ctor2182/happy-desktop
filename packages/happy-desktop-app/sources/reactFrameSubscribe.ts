interface ReactExternalStore {
    subscribe(listener: () => void): () => void;
}

type StoreSubscribe = ReactExternalStore["subscribe"];

/** One render-frame queue shared by every coalesced React store adapter. */
const pending = new Set<() => void>();
let cancelFrame: (() => void) | undefined;

function frameSchedule(run: () => void): () => void {
    if (typeof globalThis.requestAnimationFrame === "function") {
        const frame = globalThis.requestAnimationFrame(run);
        return () => globalThis.cancelAnimationFrame(frame);
    }
    // Server rendering and DOM-light test environments have no animation
    // frames. A task still preserves the important property here: one React
    // notification for a synchronous burst, with the latest snapshot behind it.
    const timeout = globalThis.setTimeout(run, 0);
    return () => globalThis.clearTimeout(timeout);
}

function frameFlush(): void {
    cancelFrame = undefined;
    const jobs = [...pending];
    pending.clear();
    for (const job of jobs) job();
}

function frameRequest(job: () => void): void {
    pending.add(job);
    cancelFrame ??= frameSchedule(frameFlush);
}

function frameWithdraw(job: () => void): void {
    pending.delete(job);
    if (pending.size > 0 || cancelFrame === undefined) return;
    cancelFrame();
    cancelFrame = undefined;
}

const subscribeByStore = new WeakMap<ReactExternalStore, StoreSubscribe>();

/**
 * Returns one stable, frame-coalesced React subscription for a synchronous
 * product store.
 *
 * The source store still applies and announces every update synchronously.
 * React is told once before the next paint and reads the source's newest
 * snapshot then, so a burst of transcript deltas cannot enqueue one urgent
 * render per delta and monopolize the main thread. Caching by store also lets
 * multiple React surfaces share one source subscription without changing the
 * store's lifetime on ordinary renders.
 */
export function reactFrameSubscribe(store: ReactExternalStore): StoreSubscribe {
    const cached = subscribeByStore.get(store);
    if (cached) return cached;

    const listeners = new Set<() => void>();
    let sourceUnsubscribe: (() => void) | undefined;
    const publish = (): void => {
        for (const listener of listeners) listener();
    };
    const sourceChanged = (): void => frameRequest(publish);
    const subscribe: StoreSubscribe = (listener) => {
        listeners.add(listener);
        if (listeners.size === 1) sourceUnsubscribe = store.subscribe(sourceChanged);
        return () => {
            listeners.delete(listener);
            if (listeners.size > 0) return;
            sourceUnsubscribe?.();
            sourceUnsubscribe = undefined;
            frameWithdraw(publish);
        };
    };
    subscribeByStore.set(store, subscribe);
    return subscribe;
}
