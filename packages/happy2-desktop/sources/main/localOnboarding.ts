import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
    DesktopRuntimeSnapshot,
    LocalOnboardingCloudChoice,
    LocalOnboardingFreshness,
    LocalOnboardingSnapshot,
    RigInstallTerminalEvent,
} from "../shared/desktopContract";
import { localRuntimeProbe, type LocalRuntimeProbe } from "./localRig";
import { rigInstallCommand } from "./rigInstallTerminal";

const recordVersion = 2;
/**
 * How often the machine is re-examined while setup is waiting on something the
 * person does outside Happy — installing Node, installing Rig themselves after
 * ours failed, or repairing a Rig that stopped answering. Rig's daemon has no
 * channel for "a command appeared in your shell", so this is the stopgap poll
 * the reactivity rule allows; it runs only on those stages and stops the moment
 * setup moves past them.
 */
const waitingPollMs = 3_000;
/**
 * A login shell that cannot be run at all leaves setup knowing nothing, which is
 * the one failure it must recover from by itself. It backs off from here to the
 * ceiling instead of asking again immediately.
 */
const probeRetryMinimumMs = 1_000;
const probeRetryMaximumMs = 30_000;

/** The decisions first-run setup writes down, and nothing it can observe instead. */
export interface LocalOnboardingRecord {
    /** What was asked for in Happy Cloud. Nothing has been enrolled or created. */
    readonly cloudRequested?: LocalOnboardingCloudChoice;
    /** Whether a Happy Profile was asked for. No profile has been created. */
    readonly profileRequested?: boolean;
    /** The last folder opened as a project, kept for display rather than for stages. */
    readonly projectPath?: string;
    readonly version: typeof recordVersion;
}

/** Reads the durable record, treating anything unreadable as "nothing decided yet". */
export async function localOnboardingRecordRead(
    path: string,
): Promise<LocalOnboardingRecord | undefined> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(parsed) || parsed.version !== recordVersion) return undefined;
        const cloudRequested = cloudParse(parsed.cloudRequested);
        return {
            ...(cloudRequested ? { cloudRequested } : {}),
            ...(typeof parsed.profileRequested === "boolean"
                ? { profileRequested: parsed.profileRequested }
                : {}),
            ...(typeof parsed.projectPath === "string" && parsed.projectPath
                ? { projectPath: parsed.projectPath }
                : {}),
            version: recordVersion,
        };
    } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}

export async function localOnboardingRecordWrite(
    path: string,
    record: LocalOnboardingRecord,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}

/** The daemon capability first-run setup needs, and no more of it. */
export interface LocalOnboardingDaemon {
    listCatalog(): Promise<{
        readonly projects: readonly { readonly archivedAt?: number; readonly kind: string }[];
    }>;
    createSession(request: Record<string, unknown>): Promise<unknown>;
}

/** The desktop runtime as first-run setup sees it: state to follow, never a connection to own. */
export interface LocalOnboardingRuntime {
    get(): DesktopRuntimeSnapshot;
    subscribe(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
    retry(): Promise<void>;
    localClient(): LocalOnboardingDaemon | undefined;
}

/** The installation-terminal manager, reduced to what setup asks of it. */
export interface LocalOnboardingInstaller {
    open(
        ownerId: number,
        emit: (event: RigInstallTerminalEvent) => void,
    ): { readonly terminalId: string };
    confirm(ownerId: number, terminalId: string, cols: number, rows: number): void;
    close(ownerId: number, terminalId: string): void;
}

export interface LocalOnboardingOptions {
    readonly recordPath: string;
    readonly runtime: LocalOnboardingRuntime;
    readonly installer: LocalOnboardingInstaller;
    readonly probe?: () => Promise<LocalRuntimeProbe>;
    /** Opens the native folder picker; resolves to undefined when cancelled. */
    readonly directoryPick: () => Promise<string | undefined>;
    readonly gitRootRead?: (path: string) => Promise<string | undefined>;
}

interface InstallState {
    readonly ownerId: number;
    readonly terminalId: string;
    running: boolean;
    message?: string;
}

/**
 * Owns local first-run setup: what this machine has, what the person decided,
 * and which stage those two facts put setup in.
 *
 * Nothing here is a remembered position. Every stage is derived again from a
 * live login-shell probe, the desktop runtime's own state, the connected Rig's
 * own catalog, and the durable record, so a restart, a reinstall that kept user
 * data, an interrupted install, a replaced Rig data directory, or a Rig that was
 * removed all resume at the truthful stage rather than at the one setup happened
 * to leave off at. The daemon is never started or stopped here — the desktop
 * runtime owns that, and it deliberately leaves the user's normal daemon running
 * when Happy exits.
 */
export class LocalOnboarding implements Disposable {
    private closed = false;
    private install?: InstallState;
    private listeners = new Set<(snapshot: LocalOnboardingSnapshot) => void>();
    private busy = false;
    private message?: string;
    /** Why the machine could not be examined at all, kept apart from step messages. */
    private probeMessage?: string;
    private poll?: ReturnType<typeof setInterval>;
    private probing?: Promise<void>;
    private probed?: LocalRuntimeProbe;
    private probeRetry?: ReturnType<typeof setTimeout>;
    private probeRetryMs?: number;
    private freshness: LocalOnboardingFreshness = "checking";
    /** The runtime connection the current freshness answer was read from. */
    private freshnessConnection?: number;
    /** The discovered `rig` path a connection retry has already been asked for. */
    private retryRequestedFor?: string;
    private runtimeKey?: string;
    /** Durable work runs one at a time, so two clicks cannot interleave writes. */
    private durableQueue: Promise<void> = Promise.resolve();
    private runtimeUnsubscribe?: () => void;
    private snapshotValue: LocalOnboardingSnapshot = {
        busy: true,
        freshness: "checking",
        stage: "checking",
    };

    private constructor(
        private readonly options: LocalOnboardingOptions,
        private record: LocalOnboardingRecord,
    ) {}

    static async create(options: LocalOnboardingOptions): Promise<LocalOnboarding> {
        const record = (await localOnboardingRecordRead(options.recordPath)) ?? {
            version: recordVersion,
        };
        const onboarding = new LocalOnboarding(options, record);
        onboarding.runtimeUnsubscribe = options.runtime.subscribe(() => onboarding.refresh());
        void onboarding.probeRun();
        return onboarding;
    }

    get(): LocalOnboardingSnapshot {
        return this.snapshotValue;
    }

    subscribe(listener: (snapshot: LocalOnboardingSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Runs the fixed global install in a real PTY after the person confirmed it.
     * The command, the shell, and the process all stay in this process; the
     * window receives output and reports the size it can draw.
     *
     * Opening and confirming are one step: a terminal that could not be spawned
     * is closed again and reported as a failure the person can retry, never left
     * behind as a running install with nothing behind it.
     */
    rigInstall(input: {
        readonly ownerId: number;
        readonly cols: number;
        readonly rows: number;
        readonly emit: (event: RigInstallTerminalEvent) => void;
    }): void {
        this.stageRequire("rigMissing", "rigInstallFailed");
        if (this.install?.running) return;
        this.message = undefined;
        let terminalId: string;
        try {
            terminalId = this.options.installer.open(input.ownerId, (event) => {
                input.emit(event);
                if (event.type !== "exited" || this.install?.terminalId !== event.terminalId)
                    return;
                this.install = {
                    ownerId: input.ownerId,
                    terminalId: event.terminalId,
                    running: false,
                    ...(event.verified ? {} : { message: installFailureMessage(event.message) }),
                };
                // A verified install means a usable `rig` command now exists, so
                // the machine is examined again rather than assumed.
                void this.probeRun();
            }).terminalId;
        } catch (error) {
            this.installFailed(input.ownerId, undefined, displayError(error));
            return;
        }
        this.install = { ownerId: input.ownerId, terminalId, running: true };
        this.message = undefined;
        try {
            this.options.installer.confirm(input.ownerId, terminalId, input.cols, input.rows);
        } catch (error) {
            // Nothing was spawned, so the terminal is released rather than left
            // as an installation this process would keep counting against the
            // window's budget.
            try {
                this.options.installer.close(input.ownerId, terminalId);
            } catch {
                // The manager already let go of it; there is nothing to release.
            }
            this.installFailed(input.ownerId, terminalId, displayError(error));
            return;
        }
        this.publish();
    }

    /**
     * The window that was watching an install is gone — reloaded, closed, or
     * crashed — and its PTY went with it. Nothing is running, so setup says so
     * and looks at the machine again rather than leaving a terminal on screen
     * that no process is behind.
     */
    installAbandoned(ownerId: number): void {
        if (this.closed || !this.install || this.install.ownerId !== ownerId) return;
        this.install = undefined;
        void this.probeRun();
    }

    /**
     * Records what the person wants from Happy Cloud. It writes a preference and
     * nothing else: no account is created, no machine is enrolled, and nothing
     * is sent anywhere, because rig-connect exposes no enrolment to call.
     */
    async cloudSubmit(choice: LocalOnboardingCloudChoice): Promise<void> {
        this.stageRequire("cloud");
        const cloudRequested: LocalOnboardingCloudChoice = choice.joined
            ? {
                  joined: true,
                  remoteControl: choice.remoteControl,
                  mobileSessions: choice.mobileSessions,
              }
            : { joined: false, remoteControl: false, mobileSessions: false };
        await this.durable("Happy could not save your Happy Cloud choices", () =>
            this.recordWrite({
                ...this.record,
                cloudRequested,
                // Declining Happy Cloud settles the profile question with it:
                // there is nothing for an encrypted profile to exist in.
                ...(cloudRequested.joined ? {} : { profileRequested: false }),
            }),
        );
    }

    /** Records whether a Happy Profile is wanted. No profile is created here. */
    async profileSubmit(request: boolean): Promise<void> {
        this.stageRequire("profile");
        await this.durable("Happy could not save your Happy Profile choice", () =>
            this.recordWrite({ ...this.record, profileRequested: request }),
        );
    }

    /**
     * Asks for a folder, requires it to be the root of a Git repository, and
     * opens it as this Rig's first project. Rig registers a project when work is
     * started in a directory, so opening the folder starts that project's first
     * chat rather than writing a project row behind the daemon's back — and it
     * happens only while this Rig is demonstrably unused, so an established Rig
     * is never written to on Happy's initiative.
     */
    async projectChoose(): Promise<void> {
        this.stageRequire("project");
        await this.durable("Happy could not open that project", async () => {
            const picked = await this.options.directoryPick();
            if (!picked) return;
            const path = await pathCanonicalize(picked);
            const root = await (this.options.gitRootRead ?? gitRootRead)(path);
            if (!root) {
                this.message =
                    "That folder is not a Git repository. Choose a folder with a Git repository in it, or run `git init` there first.";
                return;
            }
            if (root !== path) {
                this.message = `That folder is inside the Git repository at ${root}. Choose that folder instead.`;
                return;
            }
            const client = this.options.runtime.localClient();
            if (!client || this.freshness !== "fresh") {
                this.message = "Rig is not ready for a first project yet.";
                return;
            }
            await client.createSession({
                cwd: path,
                archiveOnIdle: false,
                permissionMode: "auto",
                trackUnread: true,
            });
            // This Rig now holds a project of its own, which is exactly what
            // freshness means; the next connection reads it again anyway.
            this.freshness = "used";
            try {
                await this.recordWrite({ ...this.record, projectPath: path });
            } catch {
                // The project is open in Rig, and Rig is what setup reads back.
                // The remembered path is for display alone, so failing to write
                // it must never be reported as a project that did not open.
                this.publish();
            }
        });
    }

    [Symbol.dispose](): void {
        if (this.closed) return;
        this.closed = true;
        this.pollStop();
        this.probeRetryStop();
        this.runtimeUnsubscribe?.();
        this.runtimeUnsubscribe = undefined;
        this.listeners.clear();
    }

    /** Refuses an action that does not belong to the stage setup is actually on. */
    private stageRequire(...stages: readonly LocalOnboardingSnapshot["stage"][]): void {
        if (this.closed) throw new Error("First-run setup is closed.");
        if (!stages.includes(this.snapshotValue.stage))
            throw new Error("That first-run setup step is not the current one.");
    }

    /** Runs one durable action at a time and reports its outcome in the snapshot. */
    private async durable(failure: string, action: () => Promise<void>): Promise<void> {
        const run = this.durableQueue.then(async () => {
            if (this.closed) return;
            this.busy = true;
            this.message = undefined;
            this.publish();
            try {
                await action();
            } catch (error) {
                this.message = `${failure}: ${displayError(error)}`;
            } finally {
                this.busy = false;
                this.publish();
            }
        });
        this.durableQueue = run.catch(() => undefined);
        return run;
    }

    /**
     * An install that never started. A terminal that was opened is reported as a
     * failed install so its step stays on screen with a retry; one that was never
     * opened has nothing to show, so the reason belongs to the step that offered
     * the install instead.
     */
    private installFailed(ownerId: number, terminalId: string | undefined, reason: string): void {
        const message = installFailureMessage(reason.endsWith(".") ? reason : `${reason}.`);
        this.install = terminalId ? { ownerId, terminalId, running: false, message } : undefined;
        this.message = terminalId ? undefined : message;
        this.publish();
    }

    /** Re-examines the machine now; concurrent callers share one probe. */
    private probeRun(): Promise<void> {
        if (this.closed) return Promise.resolve();
        this.probeRetryStop();
        this.probing ??= (async () => {
            try {
                this.probed = await (this.options.probe ?? localRuntimeProbe)();
                this.probeMessage = undefined;
                this.probeRetryMs = undefined;
            } catch (error) {
                // A probe that failed says nothing about the machine, and what
                // the last one found may already be false, so the facts are
                // dropped rather than shown as if they were current.
                this.probed = undefined;
                this.retryRequestedFor = undefined;
                this.probeMessage = `Happy could not examine this machine: ${displayError(error)}`;
                this.probeRetrySchedule();
            } finally {
                this.probing = undefined;
                this.refresh();
            }
        })();
        return this.probing;
    }

    private refresh(): void {
        if (this.closed) return;
        const runtime = this.options.runtime.get();
        const key = runtimeIdentity(runtime);
        if (key !== this.runtimeKey) {
            this.runtimeKey = key;
            // Both of these are new evidence about the machine rather than about
            // the connection: a runtime that says the command is missing, and a
            // connection that was replaced, can each mean a different `rig` than
            // the one the last probe found.
            if (runtime.phase === "installRequired" || runtime.phase === "ready")
                void this.probeRun();
        }
        this.connectionNudge(runtime);
        this.freshnessSynchronize(runtime);
        this.publish();
    }

    /**
     * Asks the runtime to connect once per newly discovered `rig` command. A
     * daemon that refuses is a truthful failure the person is shown, not
     * something to attempt again on every state change until it gives in.
     */
    private connectionNudge(runtime: DesktopRuntimeSnapshot): void {
        const command = this.probed?.rigCommand;
        if (!command) {
            this.retryRequestedFor = undefined;
            return;
        }
        if (runtime.phase !== "installRequired" && runtime.phase !== "error") return;
        if (this.install?.running || this.retryRequestedFor === command) return;
        this.retryRequestedFor = command;
        void this.options.runtime.retry().catch(() => undefined);
    }

    /**
     * Keeps freshness tied to the Rig that answered it. Anything other than a
     * live local connection means there is no Rig to be fresh, and a different
     * connection identity is a different Rig until its own catalog says
     * otherwise — a Rig whose data directory was replaced included.
     */
    private freshnessSynchronize(runtime: DesktopRuntimeSnapshot): void {
        if (runtime.phase !== "ready" || runtime.mode !== "local") {
            this.freshness = "checking";
            this.freshnessConnection = undefined;
            return;
        }
        if (this.freshnessConnection === runtime.connectionId) return;
        this.freshnessConnection = runtime.connectionId;
        this.freshness = "checking";
        void this.freshnessRead(runtime.connectionId);
    }

    /**
     * Reads whether this Rig holds any project of its own. Rig publishes no
     * first-run flag, so its project catalog is the only evidence available, and
     * it is read conservatively: any project that is not Rig's automatic home
     * project counts as prior use, archived or not, because someone archiving
     * their work does not make their Rig new again.
     */
    private async freshnessRead(connectionId: number): Promise<void> {
        const client = this.options.runtime.localClient();
        if (!client) {
            // The connection went away between the snapshot and this read; the
            // next runtime change asks its own connection.
            this.freshnessConnection = undefined;
            return;
        }
        let freshness: LocalOnboardingFreshness;
        try {
            const catalog = await client.listCatalog();
            freshness = catalog.projects.some((project) => project.kind !== "home")
                ? "used"
                : "fresh";
        } catch {
            // A catalog that cannot be read is not evidence of a new Rig, so
            // setup says so and asks nothing of it.
            freshness = "error";
        }
        if (this.closed || this.freshnessConnection !== connectionId) return;
        this.freshness = freshness;
        this.publish();
    }

    private async recordWrite(record: LocalOnboardingRecord): Promise<void> {
        await localOnboardingRecordWrite(this.options.recordPath, record);
        this.record = record;
        this.message = undefined;
        this.publish();
    }

    private publish(): void {
        if (this.closed) return;
        const snapshot = this.snapshotBuild();
        this.snapshotValue = snapshot;
        this.pollSynchronize(snapshot.stage);
        for (const listener of this.listeners) listener(snapshot);
    }

    private snapshotBuild(): LocalOnboardingSnapshot {
        const probe = this.probed;
        const runtime = this.options.runtime.get();
        const ready = runtime.phase === "ready" && runtime.mode === "local";
        const node =
            probe?.nodeCommand && probe.nodeVersion
                ? { path: probe.nodeCommand, version: probe.nodeVersion }
                : undefined;
        const rig = probe?.rigCommand
            ? {
                  path: probe.rigCommand,
                  ...(ready && runtime.activeTarget.authentication === "rig"
                      ? { version: runtime.activeTarget.rigVersion }
                      : {}),
              }
            : undefined;
        const stage = this.stageDerive({ node: !!node, rig: !!rig, ready, probed: !!probe });
        const message = this.messageFor(stage, runtime);
        return {
            busy: this.busy || stage === "checking" || stage === "examining",
            ...(this.record.cloudRequested ? { cloudRequested: this.record.cloudRequested } : {}),
            freshness: this.freshness,
            ...(this.install ? { install: this.installSnapshot(this.install) } : {}),
            ...(message ? { message } : {}),
            ...(node ? { node } : {}),
            ...(this.record.profileRequested === undefined
                ? {}
                : { profileRequested: this.record.profileRequested }),
            ...(this.record.projectPath ? { projectPath: this.record.projectPath } : {}),
            ...(rig ? { rig } : {}),
            stage,
        };
    }

    private stageDerive(facts: {
        readonly node: boolean;
        readonly rig: boolean;
        readonly ready: boolean;
        readonly probed: boolean;
    }): LocalOnboardingSnapshot["stage"] {
        if (!facts.probed) return "checking";
        if (!facts.node) return "nodeMissing";
        if (!facts.rig) {
            if (this.install?.running) return "rigInstalling";
            if (this.install) return "rigInstallFailed";
            return "rigMissing";
        }
        if (!facts.ready) {
            const runtime = this.options.runtime.get();
            return runtime.phase === "error" ? "connectFailed" : "connecting";
        }
        if (!this.record.cloudRequested) return "cloud";
        if (this.record.cloudRequested.joined && this.record.profileRequested === undefined)
            return "profile";
        // Only this Rig's own answer decides whether it needs a first project. A
        // remembered folder proves nothing about the Rig connected now, and a Rig
        // that cannot be read is not one Happy may write a project into.
        if (this.freshness === "checking") return "examining";
        if (this.freshness === "fresh") return "project";
        return "complete";
    }

    private installSnapshot(
        install: InstallState,
    ): NonNullable<LocalOnboardingSnapshot["install"]> {
        return {
            command: rigInstallCommand,
            running: install.running,
            terminalId: install.terminalId,
            ...(install.message ? { message: install.message } : {}),
        };
    }

    private messageFor(
        stage: LocalOnboardingSnapshot["stage"],
        runtime: DesktopRuntimeSnapshot,
    ): string | undefined {
        if (this.message) return this.message;
        if (stage === "checking") return this.probeMessage;
        if (stage === "rigInstallFailed") return this.install?.message;
        if (stage === "connectFailed" && runtime.phase === "error") return runtime.message;
        return undefined;
    }

    /**
     * Keeps the waiting poll running for exactly the stages that wait on the
     * person doing something outside Happy, and stops it everywhere else so a
     * finished setup does no work. A failed connection waits here too: the `rig`
     * it was connecting to may have been removed, and only another probe can
     * find that out.
     */
    private pollSynchronize(stage: LocalOnboardingSnapshot["stage"]): void {
        const waiting =
            stage === "nodeMissing" ||
            stage === "rigMissing" ||
            stage === "rigInstallFailed" ||
            stage === "connectFailed";
        if (waiting && !this.poll) {
            this.poll = setInterval(() => void this.probeRun(), waitingPollMs);
            this.poll.unref?.();
        } else if (!waiting) this.pollStop();
    }

    private pollStop(): void {
        if (!this.poll) return;
        clearInterval(this.poll);
        this.poll = undefined;
    }

    private probeRetrySchedule(): void {
        this.probeRetryMs = Math.min(
            this.probeRetryMs ? this.probeRetryMs * 2 : probeRetryMinimumMs,
            probeRetryMaximumMs,
        );
        this.probeRetry = setTimeout(() => {
            this.probeRetry = undefined;
            void this.probeRun();
        }, this.probeRetryMs);
        this.probeRetry.unref?.();
    }

    private probeRetryStop(): void {
        if (!this.probeRetry) return;
        clearTimeout(this.probeRetry);
        this.probeRetry = undefined;
    }
}

/** Identity of the runtime state setup reacts to: its phase, and which connection. */
function runtimeIdentity(runtime: DesktopRuntimeSnapshot): string {
    return runtime.phase === "ready" ? `ready:${runtime.connectionId}` : runtime.phase;
}

function installFailureMessage(message: string | undefined): string {
    return message
        ? `${message} Install Rig yourself with \`${rigInstallCommand}\` in a terminal, then Happy will pick it up.`
        : `The installation ended without a usable \`rig\` command. Install it yourself with \`${rigInstallCommand}\` in a terminal, then Happy will pick it up.`;
}

/** The repository root containing `path`, or undefined when it is not in one. */
async function gitRootRead(path: string): Promise<string | undefined> {
    try {
        const root = await new Promise<string>((resolvePromise, reject) => {
            execFileCallback(
                "git",
                ["rev-parse", "--show-toplevel"],
                { cwd: path, encoding: "utf8", timeout: 10_000 },
                (error, stdout) => {
                    if (error) reject(error);
                    else resolvePromise(stdout);
                },
            );
        });
        const trimmed = root.trim();
        return trimmed ? await pathCanonicalize(trimmed) : undefined;
    } catch {
        return undefined;
    }
}

async function pathCanonicalize(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        return path;
    }
}

function cloudParse(value: unknown): LocalOnboardingCloudChoice | undefined {
    if (
        !isRecord(value) ||
        typeof value.joined !== "boolean" ||
        typeof value.remoteControl !== "boolean" ||
        typeof value.mobileSessions !== "boolean"
    )
        return undefined;
    return {
        joined: value.joined,
        mobileSessions: value.mobileSessions,
        remoteControl: value.remoteControl,
    };
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
