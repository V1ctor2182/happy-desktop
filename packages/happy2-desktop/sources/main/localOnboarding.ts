import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
    DesktopRuntimeSnapshot,
    LocalOnboardingCloudChoice,
    LocalOnboardingSnapshot,
    RigInstallTerminalEvent,
} from "../shared/desktopContract";
import { localRuntimeProbe, type LocalRuntimeProbe } from "./localRig";
import { rigInstallCommand } from "./rigInstallTerminal";

const recordVersion = 1;
/**
 * How often the machine is re-examined while setup is waiting on something the
 * person does outside Happy — installing Node, or installing Rig themselves
 * after ours failed. Rig's daemon has no channel for "a command appeared in your
 * shell", so this is the stopgap poll the reactivity rule allows; it runs only
 * on those stages and stops the moment setup moves past them.
 */
const waitingPollMs = 3_000;

/** The decisions first-run setup writes down, and nothing it can observe instead. */
export interface LocalOnboardingRecord {
    readonly cloud?: LocalOnboardingCloudChoice;
    readonly profileCreated?: boolean;
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
        const cloud = cloudParse(parsed.cloud);
        return {
            ...(cloud ? { cloud } : {}),
            ...(typeof parsed.profileCreated === "boolean"
                ? { profileCreated: parsed.profileCreated }
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
 * live login-shell probe, the desktop runtime's own state, and the durable
 * record, so a restart, a reinstall that kept user data, an interrupted install,
 * or a Rig that was removed all resume at the truthful stage rather than at the
 * one setup happened to leave off at. The daemon is never started or stopped
 * here — the desktop runtime owns that, and it deliberately leaves the user's
 * normal daemon running when Happy exits.
 */
export class LocalOnboarding implements Disposable {
    private closed = false;
    private install?: InstallState;
    private listeners = new Set<(snapshot: LocalOnboardingSnapshot) => void>();
    private busy = false;
    private message?: string;
    private poll?: ReturnType<typeof setInterval>;
    private probing?: Promise<void>;
    private probed?: LocalRuntimeProbe;
    private rigFresh?: boolean;
    private runtimeUnsubscribe?: () => void;
    private snapshotValue: LocalOnboardingSnapshot = { busy: true, stage: "checking" };

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
     */
    rigInstall(input: {
        readonly ownerId: number;
        readonly cols: number;
        readonly rows: number;
        readonly emit: (event: RigInstallTerminalEvent) => void;
    }): void {
        if (this.closed) throw new Error("First-run setup is closed.");
        if (this.install?.running) return;
        const opened = this.options.installer.open(input.ownerId, (event) => {
            input.emit(event);
            if (event.type !== "exited" || this.install?.terminalId !== event.terminalId) return;
            this.install = {
                ownerId: input.ownerId,
                terminalId: event.terminalId,
                running: false,
                ...(event.verified ? {} : { message: installFailureMessage(event.message) }),
            };
            // A verified install means the command exists and the daemon
            // answered, so the machine is re-examined rather than assumed.
            void this.probeRun();
        });
        this.install = { ownerId: input.ownerId, terminalId: opened.terminalId, running: true };
        this.message = undefined;
        this.options.installer.confirm(input.ownerId, opened.terminalId, input.cols, input.rows);
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

    async cloudSubmit(choice: LocalOnboardingCloudChoice): Promise<void> {
        const normalized: LocalOnboardingCloudChoice = choice.joined
            ? {
                  joined: true,
                  remoteControl: choice.remoteControl,
                  mobileSessions: choice.mobileSessions,
              }
            : { joined: false, remoteControl: false, mobileSessions: false };
        await this.recordWrite({
            ...this.record,
            cloud: normalized,
            // Declining Happy Cloud settles the profile question with it: there
            // is nothing for an encrypted profile to exist in.
            ...(normalized.joined ? {} : { profileCreated: false }),
        });
    }

    async profileSubmit(create: boolean): Promise<void> {
        await this.recordWrite({ ...this.record, profileCreated: create });
    }

    /**
     * Asks for a folder, requires it to be the root of a Git repository, and
     * opens it as this Rig's first project. Rig registers a project when work is
     * started in a directory, so opening the folder starts that project's first
     * chat rather than writing a project row behind the daemon's back.
     */
    async projectChoose(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.message = undefined;
        this.publish();
        try {
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
            if (!client) {
                this.message = "Rig is not connected yet. It will be ready in a moment.";
                return;
            }
            await client.createSession({
                cwd: path,
                archiveOnIdle: false,
                permissionMode: "auto",
                trackUnread: true,
            });
            this.rigFresh = false;
            await this.recordWrite({ ...this.record, projectPath: path });
        } catch (error) {
            this.message = `Happy could not open that project: ${displayError(error)}`;
        } finally {
            this.busy = false;
            this.publish();
        }
    }

    [Symbol.dispose](): void {
        if (this.closed) return;
        this.closed = true;
        this.pollStop();
        this.runtimeUnsubscribe?.();
        this.runtimeUnsubscribe = undefined;
        this.listeners.clear();
    }

    /** Re-examines the machine now; concurrent callers share one probe. */
    private probeRun(): Promise<void> {
        if (this.closed) return Promise.resolve();
        this.probing ??= (async () => {
            try {
                this.probed = await (this.options.probe ?? localRuntimeProbe)();
            } catch (error) {
                this.message = displayError(error);
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
        // A connected daemon proves the command exists even if the probe has not
        // answered yet, and an installed command with no daemon is exactly what
        // the runtime retries; asking it to try again is the only nudge setup
        // gives the connection.
        if (
            this.probed?.rigCommand &&
            (runtime.phase === "installRequired" || runtime.phase === "error") &&
            !this.install?.running
        )
            void this.options.runtime.retry().catch(() => undefined);
        if (runtime.phase === "ready" && this.rigFresh === undefined) void this.freshnessRead();
        this.publish();
    }

    /**
     * Reads whether this Rig holds any project of its own. Rig publishes no
     * first-run flag, so an empty project catalog is the only truthful evidence
     * that it has never been used; its automatic home project is not one the
     * person opened.
     */
    private async freshnessRead(): Promise<void> {
        const client = this.options.runtime.localClient();
        if (!client) return;
        try {
            const catalog = await client.listCatalog();
            this.rigFresh = !catalog.projects.some(
                (project) => project.kind !== "home" && project.archivedAt === undefined,
            );
        } catch {
            // A catalog that cannot be read says nothing about freshness; the
            // next runtime change asks again.
            return;
        }
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
            busy: this.busy || stage === "checking",
            ...(this.record.cloud ? { cloud: this.record.cloud } : {}),
            ...(this.install ? { install: this.installSnapshot(this.install) } : {}),
            ...(message ? { message } : {}),
            ...(node ? { node } : {}),
            ...(this.record.profileCreated === undefined
                ? {}
                : { profileCreated: this.record.profileCreated }),
            ...(this.record.projectPath ? { projectPath: this.record.projectPath } : {}),
            ...(rig ? { rig } : {}),
            ...(this.rigFresh === undefined ? {} : { rigFresh: this.rigFresh }),
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
        if (!this.record.cloud) return "cloud";
        if (this.record.cloud.joined && this.record.profileCreated === undefined) return "profile";
        // A Rig that already has projects has nothing to open for the first
        // time; only a fresh one is asked for a first project.
        if (!this.record.projectPath && this.rigFresh !== false) return "project";
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
        if (stage === "rigInstallFailed") return this.install?.message;
        if (stage === "connectFailed" && runtime.phase === "error") return runtime.message;
        return undefined;
    }

    /**
     * Keeps the waiting poll running for exactly the stages that wait on the
     * person doing something outside Happy, and stops it everywhere else so a
     * finished setup does no work.
     */
    private pollSynchronize(stage: LocalOnboardingSnapshot["stage"]): void {
        const waiting =
            stage === "nodeMissing" || stage === "rigMissing" || stage === "rigInstallFailed";
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
