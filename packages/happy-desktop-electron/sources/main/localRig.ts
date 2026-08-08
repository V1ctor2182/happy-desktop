import { execFile as execFileCallback } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve } from "node:path";
import { userInfo } from "node:os";
import type { HealthResponse } from "@slopus/rig/types";
import { RigDaemonClient, rigDaemonPathsResolve, rigDaemonTokenRead } from "./rigDaemonClient";

const discoveryMarker = "__HAPPY2_RIG_PATH__=";
const nodePathMarker = "__HAPPY2_NODE_PATH__=";
const nodeVersionMarker = "__HAPPY2_NODE_VERSION__=";
const discoveryCommand =
    `printf '${discoveryMarker}%s\\0' "$(command -v rig 2>/dev/null)"; ` +
    `printf '${nodePathMarker}%s\\0' "$(command -v node 2>/dev/null)"; ` +
    `printf '${nodeVersionMarker}%s\\0' "$(node --version 2>/dev/null)"; ` +
    `/usr/bin/env -0`;
const maximumOutputBytes = 1024 * 1024;

/**
 * How the probe runs the user's shell: as a login shell *and* an interactive
 * one. Login alone is not enough. zsh reads `.zshrc` only when interactive, and
 * that is where people actually keep their API keys, tokens, and the PATH
 * entries added by version managers and installers. A login-only shell reports
 * an environment the user has never seen, and the daemon Happy starts from it
 * then runs agents without those variables.
 */
const discoveryShellArguments = ["-l", "-i", "-c", discoveryCommand] as const;

export interface RigLoginEnvironment {
    readonly command: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly shell: string;
}

export interface LocalRigConnection {
    readonly client: RigDaemonClient;
    readonly command: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly version: string;
    close(): void;
}

export interface LocalRigConnector {
    connect(): Promise<LocalRigConnection>;
}

export class RigCommandMissingError extends Error {
    constructor() {
        super("Rig is not installed in the login-shell environment.");
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

/** Resolves Rig and its environment through the user's configured login shell. */
export async function rigLoginEnvironmentDiscover(
    host: RigProcessHost = defaultProcessHost,
    environment: NodeJS.ProcessEnv = process.env,
    configuredShell?: string,
): Promise<RigLoginEnvironment> {
    const shell = loginShellResolve(environment, configuredShell);
    const result = await host.execFile(shell, [...discoveryShellArguments], {
        env: minimalShellEnvironment(environment),
    });
    const parsed = discoveryOutputParse(result.stdout);
    if (!parsed.command) throw new RigCommandMissingError();
    return {
        command: parsed.command,
        environment: parsed.environment,
        shell,
    };
}

/**
 * What the user's login shell resolves for the two commands local mode depends
 * on, without deciding anything about them. Either may be absent: that is the
 * answer first-run setup exists to act on, not a failure.
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
    return {
        environment: parsed.environment,
        ...(parsed.nodeCommand ? { nodeCommand: parsed.nodeCommand } : {}),
        ...(parsed.nodeVersion ? { nodeVersion: parsed.nodeVersion } : {}),
        ...(parsed.command ? { rigCommand: parsed.command } : {}),
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
 * Proof that a usable `rig` command exists, and nothing more than that. A
 * finished installation is verified through this rather than through the
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
            const login = await rigLoginEnvironmentDiscover(
                host,
                options.environment ?? process.env,
                options.configuredShell,
            );
            const result = await host.execFile(login.command, ["--version"], {
                env: login.environment,
            });
            return { version: rigVersionParse(result.stdout), close: () => undefined };
        },
    };
}

/** Connects to the normal daemon, starting it through the discovered command if absent. */
export function localRigConnectorCreate(
    options: {
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
    return {
        async connect(): Promise<LocalRigConnection> {
            const login = await rigLoginEnvironmentDiscover(
                host,
                baseEnvironment,
                options.configuredShell,
            );
            const paths = rigDaemonPathsResolve(login.environment);
            let connection = await daemonProbe(paths.socketPath, paths.tokenPath, clientCreate);
            if (!connection) {
                // The daemon is shared, so this process is not necessarily the
                // one that gets to start it: another Happy, a terminal, or an
                // editor can win the race and leave `rig daemon start` exiting
                // nonzero over a socket that is already correct. What the
                // command said is evidence; the daemon that actually answers is
                // the verdict.
                let startError: unknown;
                try {
                    await host.execFile(login.command, ["daemon", "start"], {
                        env: login.environment,
                    });
                } catch (error) {
                    startError = error;
                }
                try {
                    connection = await daemonWait(
                        paths.socketPath,
                        paths.tokenPath,
                        clientCreate,
                        wait,
                    );
                } catch (waitError) {
                    if (!startError) throw waitError;
                    throw new Error(
                        `Rig daemon could not be started: ${errorMessage(startError)}`,
                        { cause: startError },
                    );
                }
            }
            // The daemon owns its own lifecycle and may legitimately outlive an
            // installed CLI update. Protocol requests remain the compatibility
            // boundary; its version is informational and must never block startup.
            const health = await readyHealthWait(connection.client, wait);
            return {
                client: connection.client,
                command: login.command,
                environment: login.environment,
                version: health.identity.version,
                // ProtocolHttpClient is request-scoped and owns no persistent
                // socket. Stream and terminal leases are closed by their IPC
                // owners, so closing the connection deliberately does not stop
                // the normal user daemon.
                close: () => undefined,
            };
        },
    };
}

/** Canonicalizes an existing cwd while retaining inaccessible Rig history paths. */
export async function rigWorkingDirectoryCanonicalize(value: string): Promise<string> {
    const absolute = normalize(isAbsolute(value) ? value : resolve(value));
    try {
        return await realpath(absolute);
    } catch {
        return absolute;
    }
}

export function rigVersionParse(value: string): string {
    const match = /^\s*Rig\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/u.exec(value);
    if (!match?.[1]) throw new Error("The discovered rig command returned an invalid version.");
    return match[1];
}

export function discoveryOutputParse(value: string): {
    readonly command?: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly nodeCommand?: string;
    readonly nodeVersion?: string;
} {
    const markerIndex = value.indexOf(discoveryMarker);
    if (markerIndex < 0)
        throw new Error("The login shell did not return a machine-readable Rig environment.");
    const records = value.slice(markerIndex).split("\0");
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

async function daemonProbe(
    socketPath: string,
    tokenPath: string,
    create: (input: { readonly socketPath: string; readonly token: string }) => RigDaemonClient,
): Promise<{ readonly client: RigDaemonClient; readonly health: HealthResponse } | undefined> {
    const token = await rigDaemonTokenRead(tokenPath);
    if (!token) return undefined;
    const client = create({ socketPath, token });
    try {
        return { client, health: await client.health() };
    } catch {
        return undefined;
    }
}

async function daemonWait(
    socketPath: string,
    tokenPath: string,
    create: (input: { readonly socketPath: string; readonly token: string }) => RigDaemonClient,
    wait: (milliseconds: number) => Promise<void>,
): Promise<{ readonly client: RigDaemonClient; readonly health: HealthResponse }> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const connection = await daemonProbe(socketPath, tokenPath, create);
        if (connection) return connection;
        await wait(50);
    }
    throw new Error("Timed out while waiting for the normal Rig daemon.");
}

async function readyHealthWait(
    client: RigDaemonClient,
    wait: (milliseconds: number) => Promise<void>,
): Promise<Extract<HealthResponse, { readonly status: "ready" }>> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const health = await client.health();
        if (health.status === "ready") return health;
        if (health.status === "error")
            throw new Error(`Rig daemon could not start: ${health.error}`);
        await wait(50);
    }
    throw new Error("The normal Rig daemon did not become ready.");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
