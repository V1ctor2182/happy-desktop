import { execFile } from "node:child_process";
import type {
    DesktopDaemonInstall,
    DesktopDaemonRestartReason,
    DesktopDrainComponent,
} from "../shared/desktopContract";
import type { HappyAgentBinary } from "./happyAgentBinaryConfig";
import type { HappyDaemonPaths } from "./happyAgentBinaryPaths";
import { RigDaemonClient, rigDaemonTokenRead, type DrainWaitingFor } from "./rigDaemonClient";

/**
 * How long the running daemon is given to finish the work it already admitted.
 *
 * It is generous on purpose: what is being waited for is somebody's agent
 * finishing a tool call or an inference, and cutting that short to install an
 * update is the one thing this whole flow exists to avoid.
 */
const DRAIN_TIMEOUT_MS = 15 * 60_000;
const DRAIN_POLL_MS = 400;
/**
 * How long a drain runs before the window offers to cut it short. Short enough
 * that nobody is stuck watching an agent they do not care about finish, long
 * enough that an ordinary drain simply completes and never offers the choice.
 */
const KILLABLE_AFTER_MS = 10_000;
/** After the daemon accepts a shutdown, how long its process may take to go. */
const EXIT_TIMEOUT_MS = 60_000;
const EXIT_POLL_MS = 100;
/**
 * How long a killed daemon is given to exit on its own before the signal stops
 * being a request. Asking first is not politeness — the daemon closes its
 * database and its sockets on the way out — but "now" has to mean now.
 */
const KILL_GRACE_MS = 5_000;
const START_TIMEOUT_MS = 120_000;
const START_POLL_MS = 250;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface HappyAgentRestartOptions {
    readonly binary: HappyAgentBinary;
    readonly environment: NodeJS.ProcessEnv;
    /** Aborted to stop waiting for the drain and take the daemon down now. */
    readonly killSignal: AbortSignal;
    readonly paths: HappyDaemonPaths;
    readonly reason: DesktopDaemonRestartReason;
    /** Every step of the restart, as it becomes true. */
    readonly onStep: (step: DesktopDaemonInstall) => void;
}

/**
 * Drains the running daemon, stops it, and starts the selected version.
 *
 * Every fact reported along the way comes from the daemon: it publishes its own
 * drain mode and names the components still holding work open, so this reports
 * what it is told rather than estimating from elapsed time. A daemon that is not
 * running is not an error — there is simply nothing to drain, and the version is
 * started directly.
 */
export async function happyAgentRestartRun(options: HappyAgentRestartOptions): Promise<void> {
    const { reason } = options;
    const version = options.binary.version;
    const client = await daemonClientOpen(options.paths);
    if (client !== undefined) {
        options.onStep({ killable: false, phase: "draining", reason, version, waitingFor: [] });
        await client.drain();
        await drainAwait(client, options.killSignal, (waitingFor, killable) =>
            options.onStep({ killable, phase: "draining", reason, version, waitingFor }),
        );
        const killed = options.killSignal.aborted;
        options.onStep({ killed, phase: "stopping", reason, version });
        await daemonStop(client, killed);
    }
    options.onStep({ phase: "starting", reason, version });
    await daemonCommandRun(options.binary.path, "reload", options.environment);
    await readyAwait(options.paths);
    options.onStep({ phase: "reconnecting", reason, version });
}

/**
 * Takes the daemon down and waits for its process to actually go.
 *
 * A killed daemon is asked to stop the same way — it still has a database and
 * sockets to close — but it is not given the long wait, and the signal escalates
 * if it does not take the hint.
 */
async function daemonStop(client: RigDaemonClient, killed: boolean): Promise<void> {
    const { pid } = await client.shutdown();
    if (!killed) {
        await processExitAwait(pid, EXIT_TIMEOUT_MS);
        return;
    }
    try {
        await processExitAwait(pid, KILL_GRACE_MS);
    } catch {
        process.kill(pid, "SIGKILL");
        await processExitAwait(pid, KILL_GRACE_MS);
    }
}

/**
 * A client for the daemon currently running, or nothing when none answers.
 *
 * An unreachable daemon is deliberately indistinguishable from a stopped one
 * here: either way there is no process holding work that must be allowed to
 * finish, which is the only question this step is asking.
 */
async function daemonClientOpen(paths: HappyDaemonPaths): Promise<RigDaemonClient | undefined> {
    const token = await rigDaemonTokenRead(paths.tokenPath);
    if (!token) return undefined;
    const client = new RigDaemonClient({ socketPath: paths.socketPath, token });
    try {
        await client.health();
        return client;
    } catch {
        return undefined;
    }
}

/**
 * Follows the daemon's own drain report until it is holding nothing open, or
 * until someone stops waiting.
 *
 * Whether the wait may be cut short is decided here rather than in the window,
 * because this is what knows when the drain actually started, and it is
 * recomputed on every poll instead of by a timer of its own.
 */
async function drainAwait(
    client: RigDaemonClient,
    killSignal: AbortSignal,
    onWaiting: (waitingFor: readonly DesktopDrainComponent[], killable: boolean) => void,
): Promise<void> {
    const started = Date.now();
    const deadline = started + DRAIN_TIMEOUT_MS;
    for (;;) {
        if (killSignal.aborted) return;
        const health = await client.health().catch(() => undefined);
        // The daemon stopped answering mid-drain, which is the same outcome the
        // drain was waiting for: nothing of its work is still running.
        if (health === undefined) return;
        const waitingFor = health.drainWaitingFor ?? [];
        if (waitingFor.length === 0) return;
        onWaiting(waitingFor.map(drainComponentProject), Date.now() - started >= KILLABLE_AFTER_MS);
        if (Date.now() >= deadline) {
            throw new Error(
                `Happy Agent was still finishing ${waitingSummary(waitingFor)} after 15 minutes.`,
            );
        }
        await killableDelay(DRAIN_POLL_MS, killSignal);
    }
}

/**
 * The daemon's own drain report, as this process publishes it. The shapes match
 * field for field, so this copies rather than interprets.
 */
function drainComponentProject(component: DrainWaitingFor): DesktopDrainComponent {
    return {
        count: component.count,
        name: component.name,
        ...(component.agents
            ? { agents: component.agents.map((agent) => ({ id: agent.id, stage: agent.stage })) }
            : {}),
        ...(component.truncated ? { truncated: true } : {}),
    };
}

function waitingSummary(waitingFor: readonly DrainWaitingFor[]): string {
    return waitingFor
        .map((component) => `${String(component.count)} in ${component.name}`)
        .join(", ");
}

/** Waits for the exact process the daemon named to leave. */
async function processExitAwait(pid: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (processExists(pid)) {
        if (Date.now() >= deadline) {
            throw new Error("Happy Agent accepted the shutdown but did not exit.");
        }
        await delay(EXIT_POLL_MS);
    }
}

/** Waits until a daemon is answering and has finished loading. */
async function readyAwait(paths: HappyDaemonPaths): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
        const token = await rigDaemonTokenRead(paths.tokenPath);
        if (token) {
            const client = new RigDaemonClient({ socketPath: paths.socketPath, token });
            const health = await client.health().catch(() => undefined);
            if (health?.ready === true && health.draining !== true) return;
        }
        if (Date.now() >= deadline) {
            throw new Error("The new Happy Agent did not answer after starting.");
        }
        await delay(START_POLL_MS);
    }
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !(error instanceof Error && "code" in error && error.code === "ESRCH");
    }
}

function daemonCommandRun(
    executable: string,
    command: "reload",
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            executable,
            [command],
            {
                encoding: "utf8",
                env: environment,
                maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
                timeout: START_TIMEOUT_MS,
            },
            (error, _stdout, stderr) => {
                if (error === null) resolve();
                else reject(stderr.trim() ? new Error(stderr.trim(), { cause: error }) : error);
            },
        );
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A poll interval that ends early when someone stops waiting for the drain. */
function killableDelay(milliseconds: number, killSignal: AbortSignal): Promise<void> {
    if (killSignal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const settle = (): void => {
            clearTimeout(timer);
            killSignal.removeEventListener("abort", settle);
            resolve();
        };
        const timer = setTimeout(settle, milliseconds);
        killSignal.addEventListener("abort", settle, { once: true });
    });
}
