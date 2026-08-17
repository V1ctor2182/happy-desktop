import { execFile as execFileCallback } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import {
    basename,
    delimiter,
    dirname,
    isAbsolute,
    join,
    normalize,
    relative,
    resolve,
    sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalRigOnboardingInspection } from "@slopus/rig-connect";
import type { HealthResponse } from "@slopus/rig/types";
import {
    RigDaemonClient,
    rigDaemonPathsResolve,
    rigDaemonTokenRead,
    type RigDaemonPaths,
} from "./rigDaemonClient";

const discoveryMarker = "__HAPPY2_RIG_PATH__=";
const nodePathMarker = "__HAPPY2_NODE_PATH__=";
const nodeVersionMarker = "__HAPPY2_NODE_VERSION__=";
const discoveryCommand =
    `printf '${discoveryMarker}%s\\0' "$(command -v rig 2>/dev/null)"; ` +
    `printf '${nodePathMarker}%s\\0' "$(command -v node 2>/dev/null)"; ` +
    `printf '${nodeVersionMarker}%s\\0' "$(node --version 2>/dev/null)"; ` +
    `/usr/bin/env -0`;
const maximumOutputBytes = 1024 * 1024;
const bundledRigSpecifier = "@slopus/rig/dist/main.js";
const bundledRigRelativePath = join("node_modules", "@slopus", "rig", "dist", "main.js");
const packageRequire = createRequire(import.meta.url);

/**
 * How the probe runs the user's shell: as a login shell *and* an interactive
 * one. Login alone is not enough. zsh reads `.zshrc` only when interactive, and
 * that is where people actually keep their API keys, tokens, and the PATH
 * entries added by version managers and installers. A login-only shell reports
 * an environment the user has never seen, and the daemon Happy starts from it
 * then runs agents without those variables.
 */
const discoveryShellArguments = ["-l", "-i", "-c", discoveryCommand] as const;

export type RigExecutableSource = "global" | "bundled";

export interface RigExecutableSelection {
    readonly executablePath: string;
    readonly source: RigExecutableSource;
}

export interface RigLaunchContext {
    readonly executablePath: string;
    readonly executableSource: RigExecutableSource;
    readonly environment: NodeJS.ProcessEnv;
    readonly shell: string;
}

export interface LocalRigConnection {
    readonly client: RigDaemonClient;
    readonly version: string;
    rigInstallationInspect(signal: AbortSignal): Promise<LocalRigOnboardingInspection>;
    close(): void;
}

/**
 * Runs Rig's read-only native installation inspection for the onboarding
 * resolver. Exit status 2 is still a completed inspection: Rig uses it for an
 * incompatible or unavailable data directory while keeping JSON on stdout.
 */
function rigInstallationInspect(
    launch: RigLaunchContext,
    signal: AbortSignal,
): Promise<LocalRigOnboardingInspection> {
    return new Promise((resolvePromise, reject) => {
        execFileCallback(
            launch.executablePath,
            ["inspect", "--json"],
            {
                encoding: "utf8",
                env: launch.environment,
                maxBuffer: maximumOutputBytes,
                signal,
                timeout: 30_000,
            },
            (error, stdout) => {
                if (error && error.code !== 2) {
                    reject(error);
                    return;
                }
                try {
                    resolvePromise(JSON.parse(stdout) as LocalRigOnboardingInspection);
                } catch (parseError) {
                    reject(
                        new Error("The discovered rig command returned an invalid inspection.", {
                            cause: parseError,
                        }),
                    );
                }
            },
        );
    });
}

export interface LocalRigConnector {
    connect(): Promise<LocalRigConnection>;
}

export class RigCommandMissingError extends Error {
    constructor() {
        super(
            "Happy could not find an executable Rig command in the login shell or its bundled dependency.",
        );
        this.name = "RigCommandMissingError";
    }
}

export interface RigProcessResult {
    readonly stdout: string;
    readonly stderr: string;
}

export interface RigProcessHost {
    execFile(
        executable: string,
        arguments_: readonly string[],
        options: { readonly env?: NodeJS.ProcessEnv },
    ): Promise<RigProcessResult>;
}

const defaultProcessHost: RigProcessHost = {
    execFile: (executable, arguments_, options) =>
        new Promise((resolvePromise, reject) => {
            execFileCallback(
                executable,
                [...arguments_],
                {
                    encoding: "utf8",
                    env: options.env,
                    maxBuffer: maximumOutputBytes,
                    timeout: 30_000,
                },
                (error, stdout, stderr) => {
                    if (error) reject(error);
                    else resolvePromise({ stdout, stderr });
                },
            );
        }),
};

/**
 * Finds the command that should own the local daemon.
 *
 * The login shell's reported command and every command reconstructed from its
 * PATH are considered in order. Package-local commands and commands inside
 * Happy's own dependency tree are skipped so a dependency from this or another
 * checkout cannot masquerade as the user's global Rig.
 */
export async function rigExecutableFind(
    loginShellCommand: string | undefined,
    loginShellEnvironment: NodeJS.ProcessEnv,
    bundledExecutableFind: () => string | undefined = rigBundledExecutableFind,
): Promise<RigExecutableSelection | undefined> {
    const bundledExecutable = bundledExecutableFind();
    const bundledCanonicalPath = bundledExecutable
        ? await executableCanonicalPath(bundledExecutable)
        : undefined;
    const happyDependencyRoots = await happyDependencyRootsFind(bundledExecutable);

    for (const candidatePath of rigExecutableCandidates(
        loginShellCommand,
        loginShellEnvironment.PATH,
        loginShellEnvironment.PWD,
    )) {
        const canonicalPath = await executableCanonicalPath(candidatePath);
        if (
            !canonicalPath ||
            isCheckoutPackageBinExecutable(candidatePath) ||
            isCheckoutPackageBinExecutable(canonicalPath) ||
            isHappyOwnedExecutable(
                candidatePath,
                canonicalPath,
                bundledCanonicalPath,
                happyDependencyRoots,
            )
        )
            continue;
        return { executablePath: normalize(candidatePath), source: "global" };
    }

    if (bundledExecutable && bundledCanonicalPath)
        return { executablePath: normalize(bundledExecutable), source: "bundled" };
    return undefined;
}

/**
 * Locates Happy Desktop's own Rig without consulting the user's PATH.
 *
 * Release builds put production dependencies under Resources, while the normal
 * Electron build puts the dependency in an unpacked ASAR tree. Development uses
 * the package resolver directly.
 */
export function rigBundledExecutableFind(): string | undefined {
    const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string })
        .resourcesPath;
    if (resourcesPath) {
        const resourceExecutable = join(resourcesPath, bundledRigRelativePath);
        if (existsSync(resourceExecutable)) return resourceExecutable;
    }

    try {
        const resolvedExecutable = packageRequire.resolve(bundledRigSpecifier);
        if (resolvedExecutable.includes(`${sep}app.asar${sep}`)) {
            const unpackedExecutable = resolvedExecutable.replace(
                `${sep}app.asar${sep}`,
                `${sep}app.asar.unpacked${sep}`,
            );
            return existsSync(unpackedExecutable) ? unpackedExecutable : undefined;
        }
        return existsSync(resolvedExecutable) ? resolvedExecutable : undefined;
    } catch {
        return undefined;
    }
}

/** Resolves Rig and its environment through the user's configured login shell. */
export async function rigLoginEnvironmentDiscover(
    host: RigProcessHost = defaultProcessHost,
    environment: NodeJS.ProcessEnv = process.env,
    configuredShell?: string,
): Promise<RigLaunchContext> {
    const shell = loginShellResolve(environment, configuredShell);
    const result = await host.execFile(shell, [...discoveryShellArguments], {
        env: minimalShellEnvironment(environment),
    });
    const parsed = discoveryOutputParse(result.stdout);
    const executable = await rigExecutableFind(parsed.command, parsed.environment);
    if (!executable) throw new RigCommandMissingError();
    return {
        executablePath: executable.executablePath,
        executableSource: executable.source,
        environment: parsed.environment,
        shell,
    };
}

/**
 * What local mode can use from the user's login shell and Happy's bundled
 * fallback, without deciding whether either installation is protocol-compatible.
 * Both may be absent: that is the answer first-run setup exists to act on, not a
 * failure.
 */
export interface LocalRuntimeProbe {
    readonly environment: NodeJS.ProcessEnv;
    readonly nodeCommand?: string;
    /** Exactly what `node --version` printed, for example `v22.11.0`. */
    readonly nodeVersion?: string;
    readonly rigCommand?: string;
    readonly shell: string;
}

/**
 * Reads Node and Rig out of the user's real login shell in one pass, so what
 * Happy sees is what the person would see in a terminal — version managers,
 * shell profiles, and all. It never throws for a missing command; only a shell
 * that cannot be run or cannot describe its own environment is an error.
 */
export async function localRuntimeProbe(
    host: RigProcessHost = defaultProcessHost,
    environment: NodeJS.ProcessEnv = process.env,
    configuredShell?: string,
): Promise<LocalRuntimeProbe> {
    const shell = loginShellResolve(environment, configuredShell);
    const result = await host.execFile(shell, [...discoveryShellArguments], {
        env: minimalShellEnvironment(environment),
    });
    const parsed = discoveryOutputParse(result.stdout);
    const executable = await rigExecutableFind(parsed.command, parsed.environment);
    return {
        environment: parsed.environment,
        ...(parsed.nodeCommand ? { nodeCommand: parsed.nodeCommand } : {}),
        ...(parsed.nodeVersion ? { nodeVersion: parsed.nodeVersion } : {}),
        ...(executable ? { rigCommand: executable.executablePath } : {}),
        shell,
    };
}

/**
 * What one check of an installed Rig produced: the version it reported, and a
 * release for whatever the check had to hold open.
 */
export interface RigInstallVerification {
    readonly version: string;
    close(): void;
}

/**
 * Proof that an executable global `rig` command exists, and nothing more than
 * that.
 * A finished installation is verified through this rather than through the
 * connector, because starting or connecting the user's daemon is the desktop
 * runtime's alone: two owners for one daemon is exactly the thing that produces
 * a second daemon, or a connection nobody closes.
 */
export interface RigInstallVerifier {
    connect(): Promise<RigInstallVerification>;
}

/**
 * Checks the login shell's `rig` and asks it for its version. It runs the
 * command and reads its output — it never starts a daemon, connects to one, or
 * writes anything.
 */
export function rigInstallVerifierCreate(
    options: {
        readonly host?: RigProcessHost;
        readonly environment?: NodeJS.ProcessEnv;
        readonly configuredShell?: string;
    } = {},
): RigInstallVerifier {
    const host = options.host ?? defaultProcessHost;
    return {
        async connect(): Promise<RigInstallVerification> {
            const launch = await rigLoginEnvironmentDiscover(
                host,
                options.environment ?? process.env,
                options.configuredShell,
            );
            if (launch.executableSource !== "global")
                throw new Error(
                    "The login shell still resolves Happy's bundled Rig; the global Rig installation was not found.",
                );
            const result = await host.execFile(launch.executablePath, ["--version"], {
                env: launch.environment,
            });
            return { version: rigVersionParse(result.stdout), close: () => undefined };
        },
    };
}

/** Attaches to the shared daemon first, discovering and starting Rig only when absent. */
export function localRigConnectorCreate(
    options: {
        readonly debug?: (message: string) => void;
        readonly host?: RigProcessHost;
        readonly environment?: NodeJS.ProcessEnv;
        readonly configuredShell?: string;
        readonly wait?: (milliseconds: number) => Promise<void>;
        readonly clientCreate?: (input: {
            readonly socketPath: string;
            readonly token: string;
        }) => RigDaemonClient;
    } = {},
): LocalRigConnector {
    const host = options.host ?? defaultProcessHost;
    const wait = options.wait ?? delay;
    const baseEnvironment = options.environment ?? process.env;
    const clientCreate = options.clientCreate ?? ((input) => new RigDaemonClient(input));
    const debug = options.debug ?? (() => undefined);
    const launchDiscover = async (): Promise<RigLaunchContext> => {
        const launch = await rigLoginEnvironmentDiscover(
            host,
            baseEnvironment,
            options.configuredShell,
        );
        debug(`Rig executable: ${launch.executablePath} (${launch.shell})`);
        return launch;
    };
    return {
        async connect(): Promise<LocalRigConnection> {
            const defaultDaemonPaths = rigDaemonPathsResolve(baseEnvironment);
            const runningDaemon = await sharedDaemonAttach(defaultDaemonPaths, clientCreate, wait);
            if (runningDaemon)
                return localRigConnectionCreate(
                    runningDaemon,
                    launchContextLazy(launchDiscover),
                    wait,
                );

            const launch = await launchDiscover();
            const discoveredDaemonPaths = rigDaemonPathsResolve(launch.environment);
            let daemon = await sharedDaemonAttach(discoveredDaemonPaths, clientCreate, wait);
            if (!daemon) {
                // The daemon is shared, so this process is not necessarily the
                // one that gets to start it: another Happy, a terminal, or an
                // editor can win the race and leave `rig daemon start` exiting
                // nonzero over a socket that is already correct. What the
                // command said is evidence; the daemon that actually answers is
                // the verdict.
                let startError: unknown;
                try {
                    await host.execFile(launch.executablePath, ["daemon", "start"], {
                        env: launch.environment,
                    });
                } catch (error) {
                    startError = error;
                }
                try {
                    daemon = await sharedDaemonAttach(
                        discoveredDaemonPaths,
                        clientCreate,
                        wait,
                        10_000,
                    );
                    if (!daemon)
                        throw new Error("Timed out while waiting for the shared Rig daemon.");
                } catch (waitError) {
                    if (!startError) throw waitError;
                    throw new Error(
                        `Rig daemon could not be started: ${errorMessage(startError)}`,
                        { cause: startError },
                    );
                }
            }
            return localRigConnectionCreate(daemon, async () => launch, wait);
        },
    };
}

/** Canonicalizes a cwd while retaining inaccessible Rig history paths. */
export async function rigWorkingDirectoryCanonicalize(workingDirectory: string): Promise<string> {
    return pathCanonicalizeOrSelf(workingDirectory);
}

async function pathCanonicalizeOrSelf(pathName: string): Promise<string> {
    const absolutePath = normalize(isAbsolute(pathName) ? pathName : resolve(pathName));
    try {
        return await realpath(absolutePath);
    } catch {
        return absolutePath;
    }
}

function rigExecutableCandidates(
    loginShellCommand: string | undefined,
    pathEnvironment: string | undefined,
    shellWorkingDirectory?: string,
): readonly string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];
    const addCandidate = (candidatePath: string): void => {
        const normalizedPath = normalize(candidatePath);
        if (seen.has(normalizedPath)) return;
        seen.add(normalizedPath);
        candidates.push(normalizedPath);
    };

    const reportedCommand = loginShellCommand?.trim();
    if (reportedCommand) addCandidate(reportedCommand);
    if (!pathEnvironment) return candidates;

    const absoluteWorkingDirectory =
        shellWorkingDirectory && isAbsolute(shellWorkingDirectory)
            ? resolve(shellWorkingDirectory)
            : undefined;
    for (const pathEntry of pathEnvironment.split(delimiter)) {
        let binDirectory: string;
        if (!pathEntry) {
            if (!absoluteWorkingDirectory) continue;
            binDirectory = absoluteWorkingDirectory;
        } else if (isAbsolute(pathEntry)) {
            binDirectory = normalize(pathEntry);
        } else {
            if (!absoluteWorkingDirectory) continue;
            binDirectory = resolve(absoluteWorkingDirectory, pathEntry);
        }
        addCandidate(join(binDirectory, "rig"));
    }
    return candidates;
}

async function executableCanonicalPath(executablePath: string): Promise<string | undefined> {
    if (!(await isExecutableFile(executablePath))) return undefined;
    try {
        return await realpath(executablePath);
    } catch {
        return undefined;
    }
}

async function isExecutableFile(executablePath: string): Promise<boolean> {
    try {
        await access(executablePath, constants.X_OK);
        return (await stat(executablePath)).isFile();
    } catch {
        return false;
    }
}

async function happyDependencyRootsFind(
    bundledExecutable: string | undefined,
): Promise<readonly string[]> {
    const roots = new Set<string>([join(happyPackageDirectoryFind(), "node_modules")]);
    if (bundledExecutable) {
        for (const root of nodeModulesRootsFind(bundledExecutable)) roots.add(root);
    }
    return Promise.all([...roots].map((root) => pathCanonicalizeOrSelf(root)));
}

function isHappyOwnedExecutable(
    apparentPath: string,
    canonicalPath: string,
    bundledCanonicalPath: string | undefined,
    happyDependencyRoots: readonly string[],
): boolean {
    if (bundledCanonicalPath === canonicalPath) return true;
    return happyDependencyRoots.some(
        (root) => pathIsWithin(apparentPath, root) || pathIsWithin(canonicalPath, root),
    );
}

function isCheckoutPackageBinExecutable(pathName: string): boolean {
    const marker = `${sep}node_modules${sep}.bin${sep}`;
    const markerIndex = normalize(pathName).indexOf(marker);
    if (markerIndex < 0) return false;

    // A user may keep their home directory itself in Git. That does not turn a
    // global package installed below it into a checkout dependency, so the
    // checkout search stops before that ambient repository boundary. A real
    // project-local shim finds its nearer `.git` first.
    const homeDirectory = normalize(userInfo().homedir);
    let directory = normalize(pathName).slice(0, markerIndex);
    while (directory !== homeDirectory) {
        if (existsSync(join(directory, ".git"))) return true;
        const parent = dirname(directory);
        if (parent === directory) return false;
        directory = parent;
    }
    return false;
}

function happyPackageDirectoryFind(): string {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    return basename(moduleDirectory) === "main" && basename(dirname(moduleDirectory)) === "sources"
        ? dirname(dirname(moduleDirectory))
        : dirname(moduleDirectory);
}

function nodeModulesRootsFind(pathName: string): readonly string[] {
    const segments = normalize(pathName).split(sep);
    const roots: string[] = [];
    for (const [index, segment] of segments.entries()) {
        if (segment !== "node_modules") continue;
        roots.push(segments.slice(0, index + 1).join(sep) || sep);
    }
    return roots;
}

function pathIsWithin(pathName: string, root: string): boolean {
    const relation = relative(root, pathName);
    return (
        relation === "" ||
        (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
    );
}

export function rigVersionParse(versionOutput: string): string {
    const match = /^\s*Rig\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/u.exec(versionOutput);
    if (!match?.[1]) throw new Error("The discovered rig command returned an invalid version.");
    return match[1];
}

export function discoveryOutputParse(shellOutput: string): {
    readonly command?: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly nodeCommand?: string;
    readonly nodeVersion?: string;
} {
    const markerIndex = shellOutput.indexOf(discoveryMarker);
    if (markerIndex < 0)
        throw new Error("The login shell did not return a machine-readable Rig environment.");
    const records = shellOutput.slice(markerIndex).split("\0");
    const pathRecord = records.shift() ?? "";
    const command = pathRecord.slice(discoveryMarker.length).trim();
    if (command && (!isAbsolute(command) || command.includes("\n")))
        throw new Error("The login shell returned an invalid Rig executable path.");
    let nodeCommand: string | undefined;
    let nodeVersion: string | undefined;
    const environment: NodeJS.ProcessEnv = {};
    for (const record of records) {
        // The probe's own markers ride the same NUL-separated stream as the
        // environment, and each is answered by the shell whether or not the
        // command exists, so an empty value means "absent" rather than "unasked".
        if (record.startsWith(nodePathMarker)) {
            const candidate = record.slice(nodePathMarker.length).trim();
            if (candidate && (!isAbsolute(candidate) || candidate.includes("\n")))
                throw new Error("The login shell returned an invalid Node executable path.");
            if (candidate) nodeCommand = candidate;
            continue;
        }
        if (record.startsWith(nodeVersionMarker)) {
            const candidate = record.slice(nodeVersionMarker.length).trim();
            if (/^v?\d+\.\d+\.\d+/u.test(candidate)) nodeVersion = candidate;
            continue;
        }
        const separator = record.indexOf("=");
        if (separator <= 0) continue;
        const key = record.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
        environment[key] = record.slice(separator + 1);
    }
    if (!environment.PATH) throw new Error("The login shell environment did not include PATH.");
    return {
        ...(command ? { command } : {}),
        environment,
        ...(nodeCommand ? { nodeCommand } : {}),
        ...(nodeVersion ? { nodeVersion } : {}),
    };
}

function loginShellResolve(environment: NodeJS.ProcessEnv, configuredShell?: string): string {
    const shell = configuredShell ?? environment.SHELL ?? userInfo().shell;
    if (!shell || !isAbsolute(shell))
        throw new Error("The user's configured login shell is unavailable.");
    return shell;
}

function minimalShellEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
        HOME: environment.HOME,
        LOGNAME: environment.LOGNAME,
        PATH: environment.PATH,
        SHELL: environment.SHELL,
        TMPDIR: environment.TMPDIR,
        USER: environment.USER,
    };
}

interface RigDaemonAttachment {
    readonly client: RigDaemonClient;
    readonly health: HealthResponse;
}

async function localRigConnectionCreate(
    daemon: RigDaemonAttachment,
    launchContextGet: () => Promise<RigLaunchContext>,
    wait: (milliseconds: number) => Promise<void>,
): Promise<LocalRigConnection> {
    // The daemon owns its own lifecycle and may legitimately outlive an
    // installed CLI update. Protocol requests remain the compatibility
    // boundary; its version is informational and must never block startup.
    const health = await readyHealthWait(daemon.client, daemon.health, wait);
    return {
        client: daemon.client,
        version: health.identity.version,
        rigInstallationInspect: async (signal) =>
            rigInstallationInspect(await launchContextGet(), signal),
        // ProtocolHttpClient is request-scoped and owns no persistent socket.
        // Stream and terminal leases are closed by their IPC owners, so closing
        // the connection deliberately does not stop the normal user daemon.
        close: () => undefined,
    };
}

function launchContextLazy(
    discover: () => Promise<RigLaunchContext>,
): () => Promise<RigLaunchContext> {
    let task: Promise<RigLaunchContext> | undefined;
    return async () => {
        const activeTask = (task ??= discover());
        try {
            return await activeTask;
        } catch (error) {
            if (task === activeTask) task = undefined;
            throw error;
        }
    };
}

/**
 * Opens the shared daemon at one exact endpoint. Every attach — before
 * discovery, after discovery, and after startup — comes through this function.
 * A timeout merely repeats the same token/socket attempt while a newly started
 * daemon creates its endpoint.
 */
async function sharedDaemonAttach(
    paths: RigDaemonPaths,
    create: (input: { readonly socketPath: string; readonly token: string }) => RigDaemonClient,
    wait: (milliseconds: number) => Promise<void>,
    timeoutMilliseconds = 0,
): Promise<RigDaemonAttachment | undefined> {
    const deadline = Date.now() + timeoutMilliseconds;
    let attemptAllowed = true;
    while (attemptAllowed) {
        const token = await rigDaemonTokenRead(paths.tokenPath);
        if (token) {
            const client = create({ socketPath: paths.socketPath, token });
            try {
                return { client, health: await client.health() };
            } catch {
                // A stale token or socket is indistinguishable from a daemon
                // still binding its endpoint. Startup retries this exact path.
            }
        }
        attemptAllowed = Date.now() < deadline;
        if (attemptAllowed) await wait(50);
    }
    return undefined;
}

async function readyHealthWait(
    client: RigDaemonClient,
    initialHealth: HealthResponse,
    wait: (milliseconds: number) => Promise<void>,
): Promise<Extract<HealthResponse, { readonly status: "ready" }>> {
    const deadline = Date.now() + 10_000;
    let knownHealth: HealthResponse | undefined = initialHealth;
    while (Date.now() < deadline) {
        const health = knownHealth ?? (await client.health());
        knownHealth = undefined;
        if (health.status === "ready") return health;
        if (health.status === "error")
            throw new Error(`Rig daemon could not start: ${health.error}`);
        await wait(50);
    }
    throw new Error("The shared Rig daemon did not become ready.");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
