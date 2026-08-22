import { execFile } from "node:child_process";
import type {
    DesktopDaemonSnapshot,
    DesktopDaemonVersion,
    DesktopRuntimeSnapshot,
} from "../shared/desktopContract";
import {
    happyAgentBinaryDownloaded,
    happyAgentBinarySelect,
    happyAgentBinarySelected,
    type HappyAgentBinary,
} from "./happyAgentBinaryConfig";
import {
    happyAgentBinaryPath,
    happyDaemonPaths,
    type HappyDaemonPaths,
} from "./happyAgentBinaryPaths";
import {
    happyAgentReleaseInstall,
    happyAgentReleaseLatest,
    happyAgentReleasesList,
    happyAgentReleaseVersion,
    type HappyAgentRelease,
    type HappyAgentReleaseSummary,
} from "./happyAgentRelease";

const DAEMON_COMMAND_TIMEOUT_MS = 75_000;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface DesktopDaemonControllerOptions {
    readonly environment?: NodeJS.ProcessEnv;
    readonly launchEnvironment?: () => Promise<NodeJS.ProcessEnv>;
    readonly managed?: boolean;
    readonly paths?: HappyDaemonPaths;
}

/** Owns the downloaded Happy Agent selection and its renderer-facing live state. */
export class DesktopDaemonController {
    private latestRelease?: HappyAgentRelease;
    private readonly listeners = new Set<(snapshot: DesktopDaemonSnapshot) => void>();
    private operation = Promise.resolve();
    private publishedCatalog: readonly HappyAgentReleaseSummary[] = [];
    private snapshotValue: DesktopDaemonSnapshot;

    private constructor(
        private readonly paths: HappyDaemonPaths,
        private readonly launchEnvironmentRead: () => Promise<NodeJS.ProcessEnv>,
        private readonly managed: boolean,
        selected: HappyAgentBinary | undefined,
    ) {
        this.snapshotValue = {
            installation: selected ? "installed" : "missing",
            ...(selected ? { installedVersion: selected.version } : {}),
            managed,
            operation: "idle",
            runtime: "stopped",
            updateAvailable: false,
            versions: [],
        };
    }

    static async create(
        options: DesktopDaemonControllerOptions = {},
    ): Promise<DesktopDaemonController> {
        const paths = options.paths ?? happyDaemonPaths(options.environment ?? process.env);
        const selected = await happyAgentBinarySelected(paths);
        return new DesktopDaemonController(
            paths,
            options.launchEnvironment ?? (async () => options.environment ?? process.env),
            options.managed ?? true,
            selected,
        );
    }

    get(): DesktopDaemonSnapshot {
        return this.snapshotValue;
    }

    subscribe(listener: (snapshot: DesktopDaemonSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    selectedBinary(): Promise<HappyAgentBinary | undefined> {
        return happyAgentBinarySelected(this.paths);
    }

    launchEnvironment(): Promise<NodeJS.ProcessEnv> {
        return this.launchEnvironmentRead();
    }

    checkForUpdate(): Promise<void> {
        return this.serial(async () => {
            if (!this.managed) return;
            const selected = await happyAgentBinarySelected(this.paths);
            this.publish({
                ...installationProject(this.snapshotValue, selected),
                error: undefined,
                message: "Checking for Happy Agent updates…",
                operation: "checking",
            });
            try {
                const [release, catalog] = await Promise.all([
                    happyAgentReleaseLatest(),
                    happyAgentReleasesList(),
                ]);
                this.latestRelease = release;
                this.publishedCatalog = catalog;
                const installedVersion = selected?.version;
                const updateAvailable =
                    installedVersion !== undefined &&
                    versionNewer(release.version, installedVersion);
                this.publish({
                    ...this.snapshotValue,
                    availableVersion: release.version,
                    error: undefined,
                    message: updateAvailable
                        ? `Happy Agent ${release.version} is available.`
                        : installedVersion
                          ? "Happy Agent is up to date."
                          : "Happy Agent is ready to download.",
                    operation: "idle",
                    updateAvailable,
                    versions: await this.versionsProject(),
                });
            } catch (error) {
                this.publish({
                    ...this.snapshotValue,
                    error: displayError(error),
                    message: undefined,
                    operation: "idle",
                    versions: await this.versionsProject(),
                });
                throw error;
            }
        });
    }

    download(): Promise<void> {
        return this.install("downloading", undefined);
    }

    upgrade(): Promise<void> {
        return this.install("upgrading", undefined);
    }

    /**
     * Runs the daemon on one exact version, downloading it first when this
     * machine does not already hold it. Unlike an upgrade this may move
     * backwards, so the requested version is installed whether or not it is
     * newer than the one selected now.
     */
    versionSelect(version: string): Promise<void> {
        return this.install("upgrading", version);
    }

    runtimeSet(runtime: DesktopRuntimeSnapshot): void {
        const state =
            runtime.phase === "ready"
                ? "ready"
                : runtime.phase === "starting"
                  ? "starting"
                  : "stopped";
        if (this.snapshotValue.runtime === state) return;
        this.publish({ ...this.snapshotValue, runtime: state });
    }

    /**
     * `version` names an exact release to run; without one this installs the
     * latest release, which is what an update and a first download both mean.
     */
    private install(
        operation: "downloading" | "upgrading",
        version: string | undefined,
    ): Promise<void> {
        return this.serial(async () => {
            if (!this.managed) throw new Error("This Happy Agent is managed outside Happy.");
            this.publish({
                ...this.snapshotValue,
                error: undefined,
                message:
                    version !== undefined
                        ? `Preparing Happy Agent ${version}…`
                        : operation === "upgrading"
                          ? "Preparing the Happy Agent update…"
                          : "Preparing Happy Agent…",
                operation,
            });
            try {
                const selected = await this.binaryPrepare(operation, version, (message) =>
                    this.publish({ ...this.snapshotValue, message, operation }),
                );
                const availableVersion = this.latestRelease?.version;
                const updateAvailable =
                    availableVersion !== undefined &&
                    versionNewer(availableVersion, selected.version);
                this.publish({
                    ...this.snapshotValue,
                    ...(availableVersion ? { availableVersion } : {}),
                    error: undefined,
                    installation: "installed",
                    installedVersion: selected.version,
                    message: `Starting Happy Agent ${selected.version}…`,
                    operation,
                    runtime: "starting",
                    updateAvailable,
                });
                await daemonCommandRun(selected.path, "reload", await this.launchEnvironmentRead());
                this.publish({
                    ...this.snapshotValue,
                    error: undefined,
                    installation: "installed",
                    installedVersion: selected.version,
                    message: updateAvailable
                        ? `Happy Agent ${availableVersion} is available.`
                        : "Happy Agent is up to date.",
                    operation: "idle",
                    runtime: "ready",
                    updateAvailable,
                    versions: await this.versionsProject(),
                });
            } catch (error) {
                const selected = await happyAgentBinarySelected(this.paths).catch(() => undefined);
                this.publish({
                    ...installationProject(this.snapshotValue, selected),
                    error: displayError(error),
                    message: undefined,
                    operation: "idle",
                    versions: await this.versionsProject(),
                });
                throw error;
            }
        });
    }

    /**
     * Leaves this machine holding the requested version and having selected it.
     * A version already downloaded here is selected without touching the
     * network; that is the whole point of keeping the earlier versions.
     */
    private async binaryPrepare(
        operation: "downloading" | "upgrading",
        version: string | undefined,
        onStatus: (message: string) => void,
    ): Promise<HappyAgentBinary> {
        if (version !== undefined) {
            if (!(await happyAgentBinaryDownloaded(this.paths)).includes(version)) {
                return happyAgentReleaseInstall(
                    await happyAgentReleaseVersion(version),
                    this.paths,
                    {
                        onStatus,
                    },
                );
            }
            onStatus(`Switching to Happy Agent ${version}.`);
            await happyAgentBinarySelect(this.paths, version);
            return { path: happyAgentBinaryPath(this.paths, version), version };
        }
        const release =
            operation === "upgrading" || this.latestRelease === undefined
                ? await happyAgentReleaseLatest()
                : this.latestRelease;
        this.latestRelease = release;
        const installed = await happyAgentBinarySelected(this.paths);
        if (installed !== undefined && !versionNewer(release.version, installed.version)) {
            return installed;
        }
        return happyAgentReleaseInstall(release, this.paths, { onStatus });
    }

    /**
     * What the picker may offer: everything GitHub published for this platform,
     * plus everything already on disk. A version kept here after GitHub stopped
     * listing it is still runnable, so it stays selectable.
     */
    private async versionsProject(): Promise<readonly DesktopDaemonVersion[]> {
        const downloaded = await happyAgentBinaryDownloaded(this.paths).catch((): string[] => []);
        const rows = new Map<string, DesktopDaemonVersion>();
        for (const summary of this.publishedCatalog) {
            rows.set(summary.version, {
                downloaded: downloaded.includes(summary.version),
                prerelease: summary.prerelease,
                version: summary.version,
            });
        }
        for (const version of downloaded) {
            if (!rows.has(version))
                rows.set(version, { downloaded: true, prerelease: false, version });
        }
        return [...rows.values()].sort((left, right) =>
            versionNewer(left.version, right.version)
                ? -1
                : versionNewer(right.version, left.version)
                  ? 1
                  : 0,
        );
    }

    private publish(snapshot: DesktopDaemonSnapshot): void {
        this.snapshotValue = snapshot;
        for (const listener of this.listeners) listener(snapshot);
    }

    private serial(work: () => Promise<void>): Promise<void> {
        const next = this.operation.then(work, work);
        this.operation = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }
}

function installationProject(
    snapshot: DesktopDaemonSnapshot,
    selected: HappyAgentBinary | undefined,
): DesktopDaemonSnapshot {
    const { installedVersion: _installedVersion, ...current } = snapshot;
    return selected
        ? { ...current, installation: "installed", installedVersion: selected.version }
        : { ...current, installation: "missing" };
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
                timeout: DAEMON_COMMAND_TIMEOUT_MS,
            },
            (error, _stdout, stderr) => {
                if (error === null) resolve();
                else reject(stderr.trim() ? new Error(stderr.trim(), { cause: error }) : error);
            },
        );
    });
}

function versionNewer(candidate: string, current: string): boolean {
    const left = versionParse(candidate);
    const right = versionParse(current);
    for (let index = 0; index < 3; index += 1) {
        const comparison = compareBigInt(left.core[index]!, right.core[index]!);
        if (comparison !== 0) return comparison > 0;
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        return left.prerelease.length === 0 && right.prerelease.length > 0;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftIdentifier = left.prerelease[index];
        const rightIdentifier = right.prerelease[index];
        if (leftIdentifier === undefined) return false;
        if (rightIdentifier === undefined) return true;
        if (leftIdentifier === rightIdentifier) continue;
        const leftNumeric = /^\d+$/u.test(leftIdentifier);
        const rightNumeric = /^\d+$/u.test(rightIdentifier);
        if (leftNumeric && rightNumeric) {
            return compareBigInt(BigInt(leftIdentifier), BigInt(rightIdentifier)) > 0;
        }
        if (leftNumeric !== rightNumeric) return !leftNumeric;
        return leftIdentifier > rightIdentifier;
    }
    return false;
}

function versionParse(version: string): {
    readonly core: readonly [bigint, bigint, bigint];
    readonly prerelease: readonly string[];
} {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
    if (!match) throw new Error(`Happy Agent version is invalid: ${version}`);
    return {
        core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
        prerelease: match[4]?.split(".") ?? [],
    };
}

function compareBigInt(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function displayError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
