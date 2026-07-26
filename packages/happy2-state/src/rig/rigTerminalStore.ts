import type {
    TerminalDriver,
    TerminalDriverCreate,
    TerminalGridSnapshot,
} from "../modules/terminal/terminalState.js";
import { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";
import type { RigTransport } from "./rigTransport.js";
import type { RigSessionId, RigTerminalId } from "./rigTypes.js";

/**
 * One local terminal as a surface renders it. The grid is the whole visible
 * screen with colors already resolved, so a view paints it from this snapshot
 * without knowing anything about VT sequences or the wire protocol.
 */
export interface RigTerminalSnapshot {
    readonly status: "connecting" | "connected" | "disconnected" | "exited" | "error";
    /** The current renderable screen, once output or a recovery frame has arrived. */
    readonly grid?: TerminalGridSnapshot;
    readonly title: string;
    readonly cols: number;
    readonly rows: number;
    readonly exitCode: number | null;
    readonly error?: UserError;
}

export interface RigTerminalStore {
    get(): RigTerminalSnapshot;
    subscribe(listener: () => void): () => void;
    /** Sends typed input to the shell; buffered until the channel is attached. */
    terminalWrite(data: string): void;
    /** Reports the size the view can actually show, coalesced to the newest request. */
    terminalResize(cols: number, rows: number): void;
    /** Reattaches now instead of waiting out the driver's backoff. */
    terminalReconnect(): void;
}

/** A live terminal plus the lease that ends its process when the surface is done with it. */
export interface RigTerminalHandle extends RigTerminalStore, Disposable {}

export interface RigTerminalDeps {
    readonly transport: RigTransport;
    /**
     * Builds the driver that owns the terminal protocol and the VT emulator. It is
     * injected because that machinery is a browser/Node concern living in the app
     * layer; without it this package would depend on the emulator and the protocol
     * library, which is exactly what the driver boundary exists to prevent.
     */
    readonly driverCreate?: TerminalDriverCreate;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Opens one interactive terminal in a local session's working directory, running
 * the user's own login shell. Creating and stopping the terminal are ordinary
 * transport actions; the live screen, input, resize, and reconnect all ride an
 * injected driver over a byte channel this store never inspects.
 *
 * The store is deliberately the only thing that knows the terminal exists on the
 * daemon: disposing the handle stops the remote terminal as well as tearing the
 * driver down, so closing a tab kills its shell instead of leaving an orphaned
 * PTY attached to nothing. Because create is asynchronous, a close that races it
 * still stops the terminal the create returns, and input or a resize typed before
 * the channel exists is replayed once it does rather than dropped.
 */
export function rigTerminalOpen(
    deps: RigTerminalDeps,
    sessionId: RigSessionId,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
): RigTerminalHandle {
    let disposed = false;
    let stopRequested = false;
    let terminalId: RigTerminalId | undefined;
    let driver: TerminalDriver | undefined;
    let requestedSize = { cols, rows };
    const pendingWrites: string[] = [];

    const listeners = new Set<() => void>();
    let snapshot: RigTerminalSnapshot = {
        status: "connecting",
        title: "",
        cols,
        rows,
        exitCode: null,
    };
    const set = (next: Partial<RigTerminalSnapshot>): void => {
        snapshot = { ...snapshot, ...next };
        for (const listener of listeners) listener();
    };

    const stop = (): void => {
        if (stopRequested) return;
        // The intent is recorded before anything can return early, so a close that
        // races the in-flight create still prevents the terminal from attaching:
        // the create-completion path reads this flag and stops what it just made.
        stopRequested = true;
        driver?.close();
        driver = undefined;
        if (!terminalId) return;
        const stopping = terminalId;
        void deps.transport.terminalStop(sessionId, stopping).catch(() => undefined);
    };

    const store: RigTerminalHandle = {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        terminalWrite(data) {
            if (disposed || stopRequested || !data) return;
            if (driver) driver.write(data);
            else pendingWrites.push(data);
        },
        terminalResize(nextCols, nextRows) {
            if (disposed || (requestedSize.cols === nextCols && requestedSize.rows === nextRows))
                return;
            requestedSize = { cols: nextCols, rows: nextRows };
            driver?.resize(nextCols, nextRows);
        },
        terminalReconnect() {
            if (disposed || stopRequested || snapshot.status === "connected") return;
            driver?.reconnect();
        },
        [Symbol.dispose]() {
            if (disposed) return;
            stop();
            disposed = true;
            driver?.close();
            driver = undefined;
            listeners.clear();
        },
    };

    const driverCreate = deps.driverCreate;
    if (!driverCreate) {
        snapshot = {
            ...snapshot,
            status: "error",
            error: new UserError("Terminals are unavailable in this app."),
        };
        return store;
    }

    void deps.transport.terminalCreate(sessionId, cols, rows).then(
        (terminal) => {
            if (disposed || stopRequested) {
                void deps.transport.terminalStop(sessionId, terminal.id).catch(() => undefined);
                return;
            }
            terminalId = terminal.id;
            set({ exitCode: terminal.exitCode, cols: terminal.cols, rows: terminal.rows });
            driver = driverCreate({
                connect: () => deps.transport.terminalConnect(sessionId, terminal.id),
                // Seeded from the size the PTY was actually given rather than the
                // latest request, so the driver's idea of the applied size matches
                // the daemon's; a resize that raced create is replayed below
                // instead of collapsing into a no-op against a size never applied.
                cols: terminal.cols,
                rows: terminal.rows,
                replica: {
                    statusUpdate: (status) => {
                        if (!disposed && snapshot.status !== "exited")
                            set({ status, error: undefined });
                    },
                    gridUpdate: (grid) => {
                        if (disposed) return;
                        set({ grid, title: grid.title, cols: grid.cols, rows: grid.rows });
                    },
                    exit: (exitCode) => {
                        if (!disposed) set({ status: "exited", exitCode });
                    },
                    error: (message) => {
                        if (!disposed && snapshot.status !== "exited")
                            set({ status: "disconnected", error: new UserError(message) });
                    },
                },
            });
            for (const data of pendingWrites.splice(0)) driver.write(data);
            if (requestedSize.cols !== terminal.cols || requestedSize.rows !== terminal.rows)
                driver.resize(requestedSize.cols, requestedSize.rows);
        },
        (error: unknown) => {
            if (!disposed) set({ status: "error", error: rigUserError(error) });
        },
    );

    return store;
}
