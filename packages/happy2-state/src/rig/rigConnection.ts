/**
 * Minimal Rig daemon health as observed over the injected HTTP probe. This is
 * deliberately a small subset of Rig's protocol health: connection tracking only
 * needs the liveness status and version, never the model catalog or sessions.
 */
export type RigDaemonHealth =
    | { readonly status: "starting"; readonly version: string }
    | { readonly status: "ready"; readonly version: string }
    | { readonly status: "error"; readonly version: string; readonly message: string };

/** Immutable connection surface: whether the transport reaches the daemon and how healthy it is. */
export interface RigConnectionSnapshot {
    /** Transport reachability, independent of daemon health. */
    readonly connection: "connecting" | "connected" | "disconnected";
    /** Daemon liveness reported by the last successful probe. */
    readonly daemon: "unknown" | "starting" | "ready" | "error";
    /** Daemon version from the last successful probe, when known. */
    readonly version?: string;
    /** Human-readable error detail for a daemon error or a probe failure. */
    readonly message?: string;
    /** Consecutive failed reconnect attempts; zero while connected. */
    readonly attempt: number;
}

export interface RigConnectionStore {
    get(): RigConnectionSnapshot;
    subscribe(listener: () => void): () => void;
    /** Cancels any pending backoff and probes immediately, resetting the attempt count. */
    retry(): void;
    [Symbol.dispose](): void;
}

export interface RigConnectionLoaderOptions {
    /**
     * Injected daemon health fetch. Transport, URL, and credentials are owned by
     * the caller so this state package never sees a socket or token.
     */
    readonly probe: () => Promise<RigDaemonHealth>;
    /** Poll interval, in milliseconds, while a probe has succeeded (connected). */
    readonly heartbeatMs?: number;
    /** Reconnect delay for the given zero-based failure index, in milliseconds. */
    readonly backoff?: (attempt: number) => number;
    readonly now?: () => number;
    readonly setTimer?: (handler: () => void, milliseconds: number) => unknown;
    readonly clearTimer?: (handle: unknown) => void;
}

const DEFAULT_HEARTBEAT_MS = 2_000;

function defaultBackoff(attempt: number): number {
    return Math.min(5_000, 250 * 2 ** Math.min(attempt, 5));
}

function snapshotsEqual(left: RigConnectionSnapshot, right: RigConnectionSnapshot): boolean {
    return (
        left.connection === right.connection &&
        left.daemon === right.daemon &&
        left.version === right.version &&
        left.message === right.message &&
        left.attempt === right.attempt
    );
}

/**
 * Owns the reliability contract for one HTTP connection to a Rig daemon: it
 * probes on the first subscriber, heartbeats to detect drops, and reconnects
 * with capped exponential backoff. The constructor opens no timers or transport;
 * all timing is injectable so tests drive it deterministically. Realtime health
 * is a delivery hint — the durable snapshot is only ever the last probe result.
 */
export function rigConnectionLoaderCreate(options: RigConnectionLoaderOptions): RigConnectionStore {
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const backoff = options.backoff ?? defaultBackoff;
    const setTimer =
        options.setTimer ?? ((handler, milliseconds) => setTimeout(handler, milliseconds));
    const clearTimer =
        options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    const listeners = new Set<() => void>();
    let snapshot: RigConnectionSnapshot = {
        connection: "connecting",
        daemon: "unknown",
        attempt: 0,
    };
    let active = false;
    let disposed = false;
    let timer: unknown;
    // Invalidates in-flight probes when the loader stops, disposes, or retries so
    // a late resolution cannot revive or corrupt a newer connection lifetime.
    let generation = 0;

    const publish = (next: RigConnectionSnapshot): void => {
        if (snapshotsEqual(snapshot, next)) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const cancelTimer = (): void => {
        if (timer !== undefined) {
            clearTimer(timer);
            timer = undefined;
        }
    };

    const schedule = (handler: () => void, milliseconds: number): void => {
        cancelTimer();
        timer = setTimer(() => {
            timer = undefined;
            handler();
        }, milliseconds);
    };

    const probeNow = (): void => {
        cancelTimer();
        const current = ++generation;
        void options.probe().then(
            (health) => {
                if (disposed || !active || current !== generation) return;
                publish({
                    connection: "connected",
                    daemon: health.status,
                    version: health.version,
                    ...(health.status === "error" ? { message: health.message } : {}),
                    attempt: 0,
                });
                // Keep polling on every success: while starting to observe the
                // ready transition, and while ready to detect a silent drop.
                schedule(probeNow, heartbeatMs);
            },
            (error: unknown) => {
                if (disposed || !active || current !== generation) return;
                const previous = snapshot.attempt;
                publish({
                    connection: "disconnected",
                    daemon: "unknown",
                    message: error instanceof Error ? error.message : String(error),
                    attempt: previous + 1,
                });
                schedule(probeNow, backoff(previous));
            },
        );
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) {
                active = true;
                probeNow();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    active = false;
                    generation += 1;
                    cancelTimer();
                }
            };
        },
        retry() {
            if (disposed) return;
            generation += 1;
            cancelTimer();
            publish({ connection: "connecting", daemon: "unknown", attempt: 0 });
            if (active) probeNow();
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            active = false;
            generation += 1;
            cancelTimer();
        },
    };
}
