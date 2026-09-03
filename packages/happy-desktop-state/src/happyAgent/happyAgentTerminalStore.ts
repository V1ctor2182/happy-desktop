import type {
    TerminalColorScheme,
    TerminalDriver,
    TerminalDriverCreate,
    TerminalGridSnapshot,
} from "../modules/terminal/terminalState.js";
import type { HappyAgentClient } from "@slopus/happy-agent-client";
import { UserError } from "../types.js";
import type { HappyAgentHostServices } from "./happyAgentHostServices.js";
import { happyAgentUserError } from "./happyAgentSupport.js";
import type {
    HappyAgentGroupId,
    HappyAgentSessionId,
    HappyAgentTerminalId,
} from "./happyAgentTypes.js";

/**
 * One local terminal as a surface renders it. The grid is the whole visible
 * screen with colors already resolved, so a view paints it from this snapshot
 * without knowing anything about VT sequences or the wire protocol.
 */
export interface HappyAgentTerminalSnapshot {
    readonly status: "connecting" | "connected" | "disconnected" | "exited" | "error";
    /** The current renderable screen, once output or a recovery frame has arrived. */
    readonly grid?: TerminalGridSnapshot;
    readonly title: string;
    readonly cols: number;
    readonly rows: number;
    /**
     * The appearance this shell was started in, as the daemon settled it. It is
     * fixed for the terminal's whole life, so a view paints the grid in this
     * appearance rather than in whichever theme the window is showing now: the
     * colours the programs inside chose were chosen against this background.
     */
    readonly colorScheme: TerminalColorScheme;
    readonly exitCode: number | null;
    readonly error?: UserError;
}

export interface HappyAgentTerminalStore {
    get(): HappyAgentTerminalSnapshot;
    subscribe(listener: () => void): () => void;
    /** Sends typed input to the shell; buffered until the channel is attached. */
    terminalWrite(data: string): void;
    /** Reports the size the view can actually show, coalesced to the newest request. */
    terminalResize(cols: number, rows: number): void;
    /** Reattaches now instead of waiting out the driver's backoff. */
    terminalReconnect(): void;
}

/** A live terminal plus the lease that ends its process when the surface is done with it. */
export interface HappyAgentTerminalHandle extends HappyAgentTerminalStore, Disposable {}

export interface HappyAgentTerminalDeps {
    readonly client: Pick<HappyAgentClient, "getAgent" | "openTerminal" | "stopTerminal">;
    readonly hostServices: Pick<HappyAgentHostServices, "terminalConnect">;
    /**
     * The appearance to start this shell in, read once by whoever opens it. The
     * daemon settles it at creation and never changes it, so the theme the window
     * happens to be in later is none of this terminal's business.
     */
    readonly colorScheme: TerminalColorScheme;
    /**
     * Builds the driver that owns the terminal protocol and the VT emulator. It is
     * injected because that machinery is a browser/Node concern living in the app
     * layer; without it this package would depend on the emulator and the protocol
     * library, which is exactly what the driver boundary exists to prevent.
     */
    readonly driverCreate?: TerminalDriverCreate;
}

/** How a new terminal process starts. Omit `command` for an interactive shell. */
export interface HappyAgentTerminalOpenOptions {
    readonly command?: string;
    readonly cols?: number;
    readonly rows?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Opens one interactive terminal in a local session's working directory, running
 * the user's own login shell. Creating and stopping the terminal are ordinary
 * Happy Agent actions; the live screen, input, resize, and reconnect all ride an
 * injected driver over a byte channel this store never inspects.
 *
 * The store is deliberately the only thing that knows the terminal exists on the
 * daemon: disposing the handle stops the remote terminal as well as tearing the
 * driver down, so closing a tab kills its shell instead of leaving an orphaned
 * PTY attached to nothing. Because create is asynchronous, a close that races it
 * still stops the terminal the create returns, and input or a resize typed before
 * the channel exists is replayed once it does rather than dropped.
 */
export function happyAgentTerminalOpen(
    deps: HappyAgentTerminalDeps,
    sessionId: HappyAgentSessionId,
    options: HappyAgentTerminalOpenOptions = {},
): HappyAgentTerminalHandle {
    const cols = options.cols ?? DEFAULT_COLS;
    const rows = options.rows ?? DEFAULT_ROWS;
    let disposed = false;
    let stopRequested = false;
    let terminalId: HappyAgentTerminalId | undefined;
    let workspaceId: HappyAgentGroupId | undefined;
    let driver: TerminalDriver | undefined;
    let requestedSize = { cols, rows };
    const pendingWrites: string[] = [];

    const listeners = new Set<() => void>();
    let snapshot: HappyAgentTerminalSnapshot = {
        status: "connecting",
        title: "",
        cols,
        rows,
        colorScheme: deps.colorScheme,
        exitCode: null,
    };
    const set = (next: Partial<HappyAgentTerminalSnapshot>): void => {
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
        if (!terminalId || !workspaceId) return;
        const stopping = terminalId;
        void deps.client.stopTerminal(workspaceId, stopping).catch(() => undefined);
    };

    const store: HappyAgentTerminalHandle = {
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

    void deps.client
        .getAgent(sessionId)
        .then(({ agent }) => {
            workspaceId = agent.workspaceId as HappyAgentGroupId;
            return deps.client.openTerminal(agent.workspaceId, {
                cols,
                rows,
                colorScheme: deps.colorScheme,
                ...(options.command === undefined ? {} : { command: options.command }),
            });
        })
        .then(
            ({ terminal }) => {
                if (disposed || stopRequested) {
                    if (workspaceId)
                        void deps.client
                            .stopTerminal(workspaceId, terminal.id)
                            .catch(() => undefined);
                    return;
                }
                terminalId = terminal.id as HappyAgentTerminalId;
                set({
                    exitCode: terminal.exitCode,
                    cols: terminal.cols,
                    rows: terminal.rows,
                    // The daemon's settled scheme is the authority, not the request:
                    // it is what seeded the terminal the programs inside are talking to.
                    colorScheme: terminal.colorScheme,
                });
                driver = driverCreate({
                    connect: () =>
                        deps.hostServices.terminalConnect(
                            workspaceId!,
                            terminal.id as HappyAgentTerminalId,
                        ),
                    // Seeded from the size the PTY was actually given rather than the
                    // latest request, so the driver's idea of the applied size matches
                    // the daemon's; a resize that raced create is replayed below
                    // instead of collapsing into a no-op against a size never applied.
                    cols: terminal.cols,
                    rows: terminal.rows,
                    colorScheme: terminal.colorScheme,
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
                if (!disposed) set({ status: "error", error: happyAgentUserError(error) });
            },
        );

    return store;
}
