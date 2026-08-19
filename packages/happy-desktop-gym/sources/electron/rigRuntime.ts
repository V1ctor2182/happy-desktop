import { execFile } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

import { gymRigLauncherWrite, gymRunProfileWrite, rigEntrypointResolve } from "./paths.js";
import { GymHappyAgentClient } from "./happyAgentProtocol.js";
import type { GymInferenceServer, GymRunPaths, RigRuntime } from "./types.js";

const execFileAsync = promisify(execFile);

export interface StartedRigRuntime extends RigRuntime {
    readonly client: GymHappyAgentClient;
}

export async function rigRuntimeCreate(
    paths: GymRunPaths,
    inference: GymInferenceServer,
): Promise<StartedRigRuntime> {
    const rigEntrypoint = rigEntrypointResolve(paths.workspaceRoot);
    const command = await gymRigLauncherWrite(paths, rigEntrypoint);
    await Promise.all(
        [
            join(paths.home, "happy", "config"),
            join(paths.home, ".config"),
            join(paths.home, ".cache"),
            join(paths.home, ".local", "share"),
            join(paths.home, ".local", "state"),
        ].map((directory) => mkdir(directory, { recursive: true })),
    );
    const environment = environmentCreate(paths, inference);
    await gymRunProfileWrite(paths, environment);
    // Electron/Playwright can terminate its Node controller before ordinary
    // finally cleanup runs (for example, a host GUI launch abort). A detached
    // Rig from that attempt still owns this run's socket and retains the old
    // inference endpoint. Stop only this isolated run's daemon before starting
    // its next lifetime so a retry cannot silently attach to stale transport.
    await execFileAsync(command, ["daemon", "stop"], {
        cwd: paths.workspace,
        env: environment,
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
    }).catch(() => undefined);
    await unlink(paths.socketPath).catch(() => undefined);
    const runtime = new LocalRigRuntime(paths, command, environment, inference);
    await runtime.start();
    return runtime;
}

class LocalRigRuntime implements StartedRigRuntime {
    readonly #paths: GymRunPaths;
    readonly #inference: GymInferenceServer;
    readonly #environment: Record<string, string>;
    readonly #command: string;
    #token = "";
    #client: GymHappyAgentClient | undefined;

    constructor(
        paths: GymRunPaths,
        command: string,
        environment: Record<string, string>,
        inference: GymInferenceServer,
    ) {
        this.#paths = paths;
        this.#command = command;
        this.#environment = environment;
        this.#inference = inference;
    }

    get command(): string {
        return this.#command;
    }

    get environment(): Record<string, string> {
        return this.#environment;
    }

    get socketPath(): string {
        return this.#paths.socketPath;
    }

    get tokenPath(): string {
        return join(this.#paths.rigServer, "token");
    }

    get token(): string {
        if (!this.#token) throw new Error("Rig runtime has not started.");
        return this.#token;
    }

    get client(): GymHappyAgentClient {
        if (this.#client === undefined) throw new Error("Rig runtime has not started.");
        return this.#client;
    }

    async start(): Promise<void> {
        await execFileAsync(this.#command, ["daemon", "start"], {
            cwd: this.#paths.workspace,
            env: this.#environment,
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
        });
        await waitForToken(this.tokenPath, 30_000);
        this.#token = (await readFile(this.tokenPath, "utf8")).trim();
        if (!this.#token) throw new Error("Rig daemon wrote an empty authentication token.");
        this.#client = new GymHappyAgentClient(this.socketPath, this.#token);
        await waitForHealth(this.#client, 30_000);
    }

    async stop(): Promise<void> {
        await execFileAsync(this.#command, ["daemon", "stop"], {
            cwd: this.#paths.workspace,
            env: this.#environment,
            timeout: 15_000,
            maxBuffer: 2 * 1024 * 1024,
        }).catch(() => undefined);
        this.#client = undefined;
        this.#token = "";
        await unlink(this.socketPath).catch(() => undefined);
        await this.#inference.stop().catch(() => undefined);
    }
}

function environmentCreate(
    paths: GymRunPaths,
    inference: GymInferenceServer,
): Record<string, string> {
    const safeSystemPath = "/usr/bin:/bin:/usr/sbin:/sbin";
    return {
        HOME: paths.home,
        LANG: "C.UTF-8",
        LOGNAME: "happy-desktop-gym",
        PATH: `${paths.bin}:${safeSystemPath}`,
        SHELL: "/bin/zsh",
        TERM: "xterm-256color",
        USER: "happy-desktop-gym",
        XDG_CACHE_HOME: join(paths.home, ".cache"),
        XDG_CONFIG_HOME: join(paths.home, ".config"),
        XDG_DATA_HOME: join(paths.home, ".local", "share"),
        XDG_STATE_HOME: join(paths.home, ".local", "state"),
        RIG_CONFIGURATION_DIRECTORY: join(paths.home, "happy", "config"),
        RIG_DISABLE_HAPPY_SYNC: "1",
        RIG_GYM_DISPLAY_WORKSPACE: "/workspace",
        RIG_GYM_HOME_PATH: paths.home,
        RIG_GYM_INFERENCE_URL: inference.url,
        RIG_GYM_PROVIDER_OVERRIDES: "codex",
        RIG_GYM_RUNTIME: "just-bash",
        RIG_GYM_TOKEN: inference.token,
        RIG_GYM_WORKSPACE_PATH: paths.rigWorkspacePath,
        RIG_MODEL: "openai/gpt-5.6-sol",
        RIG_PERMISSION_MODE: "full_access",
        RIG_PROVIDER: "codex",
        RIG_SERVER_DIRECTORY: paths.rigServer,
        RIG_SERVER_SOCKET_PATH: paths.socketPath,
        TMPDIR: paths.tmp,
        OPENAI_API_KEY: "happy-desktop-gym-local-only",
    };
}

async function waitForToken(path: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const token = (await readFile(path, "utf8")).trim();
            if (token) return;
        } catch {
            // The detached daemon is still starting.
        }
        await delay(100);
    }
    throw new Error(`Timed out waiting for the isolated Rig token at ${path}.`);
}

async function waitForHealth(client: GymHappyAgentClient, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await client.health();
            return;
        } catch (error) {
            lastError = error;
        }
        await delay(100);
    }
    throw new Error(`Timed out waiting for isolated Rig health: ${String(lastError)}`);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
