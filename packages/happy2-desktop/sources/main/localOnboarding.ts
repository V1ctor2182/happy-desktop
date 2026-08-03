import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
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

/**
 * Reads the durable record, treating anything unreadable as "nothing decided
 * yet".
 *
 * A record written by the first revision of this feature is migrated rather than
 * discarded: it recorded the same three answers under names that claimed the
 * cloud work had already happened, and the answers themselves were truthful, so
 * someone who already answered is not asked again after an update. The migrated
 * shape is persisted by the next successful write.
 *
 * Validation is all-or-nothing on purpose. A record is a set of answers that
 * were only ever written together, so a file that disagrees with itself was not
 * written by this feature — and the safe reading of a file setup cannot account
 * for is that nothing has been decided, not that some of it can be kept. Keeping
 * fragments is the one failure that skips a question instead of repeating it.
 */
export async function localOnboardingRecordRead(
    path: string,
): Promise<LocalOnboardingRecord | undefined> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(parsed)) return undefined;
        if (parsed.version === recordVersion)
            return recordParse(parsed, "cloudRequested", "profileRequested");
        if (parsed.version === 1) return recordParse(parsed, "cloud", "profileCreated");
        return undefined;
    } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}

/**
 * Reads one stored record, whichever names its version used, and refuses it
 * whole unless every part of it is a shape and a combination this feature could
 * actually have written.
 */
function recordParse(
    parsed: Record<string, unknown>,
    cloudKey: string,
    profileKey: string,
): LocalOnboardingRecord | undefined {
    const allowed = new Set(["version", cloudKey, profileKey, "projectPath"]);
    for (const key of Object.keys(parsed)) if (!allowed.has(key)) return undefined;

    const cloudValue = parsed[cloudKey];
    const cloudRequested = cloudValue === undefined ? undefined : cloudParse(cloudValue);
    if (cloudValue !== undefined && !cloudRequested) return undefined;

    const profileValue = parsed[profileKey];
    if (profileValue !== undefined && typeof profileValue !== "boolean") return undefined;
    const profileRequested = profileValue as boolean | undefined;

    const pathValue = parsed.projectPath;
    if (pathValue !== undefined && (typeof pathValue !== "string" || !pathValue)) return undefined;
    const projectPath = pathValue as string | undefined;

    // The questions are asked in one order and each answer is written with the
    // one before it, so these combinations are the only ones that can exist.
    // A profile answer with no cloud answer, or a project opened before either
    // was settled, describes a path through setup that does not exist.
    if (profileRequested !== undefined && !cloudRequested) return undefined;
    if (cloudRequested && !cloudRequested.joined && profileRequested !== false) return undefined;
    if (profileRequested === true && !cloudRequested?.joined) return undefined;
    if (projectPath !== undefined && (!cloudRequested || profileRequested === undefined))
        return undefined;

    return {
        ...(cloudRequested ? { cloudRequested } : {}),
        ...(profileRequested === undefined ? {} : { profileRequested }),
        ...(projectPath === undefined ? {} : { projectPath }),
        version: recordVersion,
    };
}

/**
 * Writes the record atomically, and only for a reader who is still the one being
 * written for.
 *
 * The prepared copy is put down beside the record and made authoritative by a
 * rename, so an interrupted write leaves the previous answers intact. That
 * rename is the instant the answer becomes this machine's, so `authorized` is
 * asked immediately before it and nowhere else: a document, a window, or a Rig
 * may have been replaced while the bytes were being written, and answers given
 * to a reader who has since gone must not be committed on their successor's
 * behalf. Saying who a write is for is not optional, because a write with nobody
 * to answer for it is the thing this exists to prevent.
 *
 * The temporary name is random rather than counted, so two writers — including
 * two copies of Happy sharing a home directory — cannot pick the same one, and
 * it is created exclusively so an existing file is never written through. Every
 * path out of here that did not commit takes the temporary file with it, and a
 * failure to tidy up never replaces the failure worth reporting.
 */
export async function localOnboardingRecordWrite(
    path: string,
    record: LocalOnboardingRecord,
    authorized: () => boolean,
): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    let committed = false;
    try {
        await handle.writeFile(`${JSON.stringify(record, undefined, 2)}\n`);
        await handle.close();
        // The last look, taken with the bytes already on disk and nothing left to
        // do but make them the record.
        if (!authorized()) return false;
        await rename(temporary, path);
        committed = true;
        return true;
    } finally {
        await handle.close().catch(() => undefined);
        // Whatever went wrong, or whoever went away, the half-written copy is not
        // left lying beside the record — and tidying up is never allowed to
        // become the error that gets reported.
        if (!committed) await rm(temporary, { force: true }).catch(() => undefined);
    }
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
    /**
     * Identity of the window currently presenting setup. It is read again at
     * every step of a long operation, so work started by a window that has since
     * been replaced stops instead of finishing on behalf of a reader who is no
     * longer there.
     */
    readonly presentation?: () => string;
}

/**
 * One durable action's claim on the reader and the machine it was started for.
 * `current` is asked again at every boundary the action crosses, because none of
 * what it captured is guaranteed to still be true on the other side of an await.
 */
interface LocalOnboardingWork {
    current(): boolean;
    readonly generation: string;
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
    /**
     * Which question the probe in flight is answering. Anything that makes the
     * machine's facts obsolete advances it, so an answer to the previous
     * question is discarded rather than installed as if it were current.
     */
    private probeEpoch = 0;
    private probeRunId = 0;
    private freshness: LocalOnboardingFreshness = "checking";
    /** The runtime connection the current freshness answer was read from. */
    private freshnessConnection?: number;
    /** The discovered `rig` path a connection retry has already been asked for. */
    private retryRequestedFor?: string;
    private runtimeKey?: string;
    /** Durable work runs one at a time, so two clicks cannot interleave writes. */
    private durableQueue: Promise<void> = Promise.resolve();
    /**
     * Whether a durable action has been admitted and not yet finished. It is set
     * before this method returns, so a second call in the same tick is refused
     * rather than queued behind the first.
     */
    private durablePending = false;
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
        // The first look at the machine is the same decision as every later one:
        // it happens because Happy is being asked to run here, not because this
        // object was constructed.
        onboarding.refresh();
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
        // Who asked for this install, and against which runtime. Nothing here
        // awaits, but the PTY is a real side effect on the machine and it is
        // started only for the reader and the runtime that are current when it
        // starts — never on behalf of a document that has already gone.
        const generation = this.generation();
        this.message = undefined;
        // The attempt being retried is over. Releasing it before opening another
        // keeps one terminal per reader at a time, so "run it again" works as
        // often as someone is willing to press it.
        this.installRelease();
        let terminalId: string;
        try {
            terminalId = this.options.installer.open(input.ownerId, (event) => {
                input.emit(event);
                if (event.type !== "exited" || this.install?.terminalId !== event.terminalId)
                    return;
                // A verified install has nothing left to show and nothing left
                // to account for, so its record goes with it; a failed one keeps
                // its reason on screen with the retry.
                this.install = event.verified
                    ? undefined
                    : {
                          ownerId: input.ownerId,
                          terminalId: event.terminalId,
                          running: false,
                          message: installFailureMessage(event.message),
                      };
                // What the last probe found is exactly what this install set out
                // to change, so it stops being an answer here — before the
                // runtime is handed the news and before anything is drawn.
                // Otherwise the moment between "installed" and "examined" reads
                // as a machine with no Rig on it, and offers to install it again.
                if (event.verified) this.probeInvalidate();
                this.publish();
                // The command may exist now, so the machine is examined again
                // rather than assumed either way.
                void this.probeRun();
            }).terminalId;
        } catch (error) {
            this.installFailed(input.ownerId, undefined, displayError(error));
            return;
        }
        this.install = { ownerId: input.ownerId, terminalId, running: true };
        this.message = undefined;
        if (this.generation() !== generation) {
            this.installRelease();
            this.publish();
            return;
        }
        try {
            this.options.installer.confirm(input.ownerId, terminalId, input.cols, input.rows);
        } catch (error) {
            // Nothing was spawned, so the terminal is released rather than left
            // as an installation this process would keep counting against the
            // window's budget.
            this.installerClose(input.ownerId, terminalId);
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
        this.installRelease();
        void this.probeRun();
    }

    /** Lets go of the terminal setup is holding, if it is holding one. */
    private installRelease(): void {
        const install = this.install;
        this.install = undefined;
        if (install && !install.running) this.installerClose(install.ownerId, install.terminalId);
    }

    private installerClose(ownerId: number, terminalId: string): void {
        try {
            this.options.installer.close(ownerId, terminalId);
        } catch {
            // The manager already let go of it; there is nothing to release.
        }
    }

    /**
     * Records what the person wants from Happy Cloud. It writes a preference and
     * nothing else: no account is created, no machine is enrolled, and nothing
     * is sent anywhere, because rig-connect exposes no enrolment to call.
     */
    async cloudSubmit(choice: LocalOnboardingCloudChoice): Promise<void> {
        const cloudRequested: LocalOnboardingCloudChoice = choice.joined
            ? {
                  joined: true,
                  remoteControl: choice.remoteControl,
                  mobileSessions: choice.mobileSessions,
              }
            : { joined: false, remoteControl: false, mobileSessions: false };
        await this.durable(
            "Happy could not save your Happy Cloud choices",
            ["cloud"],
            async (working) => {
                // The answer belongs to the reader who gave it and to the setup
                // they were looking at; a document or a machine that has been
                // replaced since is not owed their answer.
                if (!working.current()) return;
                await this.recordWrite(
                    {
                        ...this.record,
                        cloudRequested,
                        // Declining Happy Cloud settles the profile question with
                        // it: there is nothing for an encrypted profile to exist
                        // in.
                        ...(cloudRequested.joined ? {} : { profileRequested: false }),
                    },
                    working.current,
                );
            },
        );
    }

    /** Records whether a Happy Profile is wanted. No profile is created here. */
    async profileSubmit(request: boolean): Promise<void> {
        await this.durable(
            "Happy could not save your Happy Profile choice",
            ["profile"],
            async (working) => {
                if (!working.current()) return;
                await this.recordWrite(
                    { ...this.record, profileRequested: request },
                    working.current,
                );
            },
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
        await this.durable("Happy could not open that project", ["project"], async (working) => {
            // Which Rig said it was unused. Every conclusion below belongs to
            // this connection alone: a Rig that has since been replaced answered
            // a different question, and its successor's answer is not this one's
            // to overwrite.
            const connection = this.freshnessConnection;
            const mine = () => working.current() && this.freshnessConnection === connection;
            const picked = await this.options.directoryPick();
            // A cancelled picker, a replaced window, a reloaded document, and a
            // replaced connection are all the same outcome here: nothing was
            // asked for, so nothing is said about it.
            if (!picked || !mine()) return;
            const path = await pathCanonicalize(picked);
            const root = await (this.options.gitRootRead ?? gitRootRead)(path);
            if (!mine()) return;
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
            // Last look before the one thing here that changes someone else's
            // state.
            if (!mine()) return;
            try {
                await client.createSession({
                    cwd: path,
                    archiveOnIdle: false,
                    permissionMode: "auto",
                    trackUnread: true,
                });
            } catch (error) {
                // Rig may have committed the project before the answer was lost,
                // so nothing may be concluded from this — least of all that it is
                // safe to ask again. Freshness stops being an answer and that Rig
                // is asked afresh; the step comes back only if its own catalog
                // still says it is unused. If the connection is already gone, its
                // failure is not the successor's to inherit either.
                if (!mine()) return;
                this.freshnessInvalidate();
                this.message = `Happy could not confirm whether that project was opened: ${displayError(error)} Nothing has been repeated; Happy is asking Rig what actually happened.`;
                return;
            }
            // The Rig this succeeded against now holds a project of its own,
            // which is exactly what freshness means for that Rig — and only for
            // it. A connection that replaced it has already been asked its own
            // question, and this answer is not about it.
            if (!mine()) return;
            this.freshness = "used";
            try {
                await this.recordWrite({ ...this.record, projectPath: path }, mine);
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

    /**
     * Admits one durable action and runs it alone.
     *
     * Admission is synchronous and happens before any microtask: the stage is
     * checked, a second request while one is outstanding is refused rather than
     * queued, and `busy` is true by the time this returns. The stage is then
     * checked again inside the task, because the world may have moved between
     * being admitted and being run — and a step that is no longer current is
     * abandoned silently rather than carried out late.
     */
    private durable(
        failure: string,
        stages: readonly LocalOnboardingSnapshot["stage"][],
        action: (working: LocalOnboardingWork) => Promise<void>,
    ): Promise<void> {
        this.stageRequire(...stages);
        if (this.durablePending)
            throw new Error("First-run setup is still working on the previous request.");
        // Who asked, captured while they are still the one asking.
        const generation = this.generation();
        const working: LocalOnboardingWork = {
            current: () =>
                !this.closed &&
                this.generation() === generation &&
                stages.includes(this.snapshotValue.stage),
            generation,
        };
        this.durablePending = true;
        this.busy = true;
        this.message = undefined;
        this.publish();
        const run = this.durableQueue.then(async () => {
            try {
                if (!working.current()) return;
                await action(working);
            } catch (error) {
                // A failure belongs to whoever asked for the work. If they have
                // been replaced, the setup now on screen is not theirs to put an
                // error on, so it is dropped with the request it came from.
                if (working.current()) this.message = `${failure}: ${displayError(error)}`;
            } finally {
                this.durablePending = false;
                this.busy = false;
                this.publish();
            }
        });
        this.durableQueue = run.catch(() => undefined);
        return run;
    }

    /**
     * Who setup is working for right now: the window presenting it and the Rig
     * connection behind it. A long operation reads this again before it does
     * anything irreversible, so work started for one reader and one Rig never
     * lands on another.
     */
    private generation(): string {
        return `${this.options.presentation?.() ?? "window"}|${runtimeIdentity(
            this.options.runtime.get(),
        )}`;
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

    /**
     * Re-examines the machine now; concurrent callers share one probe.
     *
     * A probe that was already in flight when its question stopped being the
     * current one is not the answer to the new one: it started before whatever
     * changed the machine, so its result is dropped and a fresh probe is what
     * anyone waiting gets.
     */
    private probeRun(): Promise<void> {
        if (this.closed) return Promise.resolve();
        this.probeRetryStop();
        if (this.probing) return this.probing;
        const epoch = this.probeEpoch;
        const runId = (this.probeRunId += 1);
        this.probing = (async () => {
            try {
                const probed = await (this.options.probe ?? localRuntimeProbe)();
                if (epoch !== this.probeEpoch) return;
                this.probed = probed;
                this.probeMessage = undefined;
                this.probeRetryMs = undefined;
            } catch (error) {
                if (epoch !== this.probeEpoch) return;
                // A probe that failed says nothing about the machine, and what
                // the last one found may already be false, so the facts are
                // dropped rather than shown as if they were current.
                this.probed = undefined;
                this.retryRequestedFor = undefined;
                this.probeMessage = `Happy could not examine this machine: ${displayError(error)}`;
                this.probeRetrySchedule();
            } finally {
                if (this.probeRunId === runId) this.probing = undefined;
                if (epoch === this.probeEpoch) this.refresh();
            }
        })();
        return this.probing;
    }

    /**
     * Drops what the machine was last known to be, and disowns the probe in
     * flight so its answer to the old question cannot arrive as an answer to the
     * new one. With no facts, no stage offers to change the machine.
     */
    private probeInvalidate(): void {
        this.probeEpoch += 1;
        this.probing = undefined;
        this.probed = undefined;
        this.probeMessage = undefined;
        this.retryRequestedFor = undefined;
        this.probeRetryStop();
    }

    private refresh(): void {
        if (this.closed) return;
        const runtime = this.options.runtime.get();
        const local = runtimeLocal(runtime);
        const previous = this.runtimeKey;
        const key = `${local ? "local" : "away"}:${runtimeIdentity(runtime)}`;
        this.runtimeKey = key;
        if (!local) {
            // Happy is being run somewhere else. Local setup has no opinion about
            // a machine nobody asked about, and no business examining it, asking
            // its daemon to start, or waiting for anything on it.
            this.probeRetryStop();
            this.retryRequestedFor = undefined;
            this.freshnessSynchronize(runtime);
            this.publish();
            return;
        }
        if (key !== previous) {
            // Each of these is new evidence about the machine rather than about
            // the connection: being asked to run here at all, a runtime that says
            // the command is missing, and a connection that was replaced can each
            // mean a different `rig` than the one the last probe found.
            const arrived = previous === undefined || previous.startsWith("away:");
            if (arrived || runtime.phase === "installRequired" || runtime.phase === "ready")
                void this.probeRun();
        }
        this.connectionNudge(runtime);
        this.freshnessSynchronize(runtime);
        this.publish();
    }

    /**
     * Drops the current freshness answer and asks the connected Rig again. It is
     * used where Happy stopped being able to vouch for what it last read — an
     * ambiguous write being the case that matters, since the alternative to
     * asking again is guessing about someone else's data.
     */
    private freshnessInvalidate(): void {
        this.freshness = "checking";
        this.freshnessConnection = undefined;
        this.freshnessSynchronize(this.options.runtime.get());
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

    /**
     * Commits answers for a reader who is still the one giving them. The write
     * is abandoned at the last moment if they are not, and nothing is remembered
     * or published on their successor's behalf.
     */
    private async recordWrite(
        record: LocalOnboardingRecord,
        authorized: () => boolean,
    ): Promise<boolean> {
        const committed = await localOnboardingRecordWrite(
            this.options.recordPath,
            record,
            authorized,
        );
        if (!committed) return false;
        this.record = record;
        this.message = undefined;
        this.publish();
        return true;
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
        const stage = this.stageDerive({
            local: runtimeLocal(runtime),
            node: !!node,
            probed: !!probe,
            ready,
            rig: !!rig,
        });
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
        readonly local: boolean;
        readonly node: boolean;
        readonly rig: boolean;
        readonly ready: boolean;
        readonly probed: boolean;
    }): LocalOnboardingSnapshot["stage"] {
        if (!facts.local) return "inactive";
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

/**
 * Whether Happy is being asked to run on this machine. Choosing has not asked
 * for anything yet, a ready runtime says which mode it is in, and every other
 * phase is working on a request that names one.
 */
function runtimeLocal(runtime: DesktopRuntimeSnapshot): boolean {
    if (runtime.phase === "choosing") return false;
    if (runtime.phase === "ready") return runtime.mode === "local";
    return runtime.request.mode === "local";
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

/**
 * One stored Happy Cloud answer. It is exactly three booleans — no more, no
 * fewer — and declining to join settles the other two with it, so a record that
 * declines while asking for remote control is not an answer this feature gave.
 */
function cloudParse(value: unknown): LocalOnboardingCloudChoice | undefined {
    if (!isRecord(value)) return undefined;
    const keys = Object.keys(value);
    if (
        keys.length !== 3 ||
        typeof value.joined !== "boolean" ||
        typeof value.remoteControl !== "boolean" ||
        typeof value.mobileSessions !== "boolean"
    )
        return undefined;
    if (!value.joined && (value.remoteControl || value.mobileSessions)) return undefined;
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
