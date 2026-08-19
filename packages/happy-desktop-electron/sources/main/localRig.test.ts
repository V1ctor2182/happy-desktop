import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RigDaemonClient } from "./rigDaemonClient";
import {
    discoveryOutputParse,
    localRigConnectorCreate,
    rigExecutableFind,
    rigLoginEnvironmentDiscover,
    type RigProcessHost,
} from "./localRig";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
});

async function writeExecutable(executablePath: string): Promise<string> {
    await mkdir(dirname(executablePath), { recursive: true });
    await writeFile(executablePath, "#!/bin/sh\n", { mode: 0o755 });
    return executablePath;
}

describe("Rig executable selection", () => {
    it("uses an executable global reported by the login shell", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-rig-selection-"));
        directories.push(root);
        const globalExecutable = await writeExecutable(join(root, "global bin", "rig"));

        await expect(
            rigExecutableFind(globalExecutable, { PATH: dirname(globalExecutable) }),
        ).resolves.toEqual({
            executablePath: globalExecutable,
        });
    });

    it("does not fall back to a package-local Rig", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-rig-selection-"));
        directories.push(root);
        const happyShim = await writeExecutable(
            join(root, "Happy Desktop", "node_modules", ".bin", "rig"),
        );

        await expect(rigExecutableFind(happyShim, { PATH: dirname(happyShim) })).resolves.toBe(
            undefined,
        );
    });

    it("skips a package shim, including a symlinked shim directory, and finds global Rig later", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-rig-selection-"));
        directories.push(root);
        const dependencyDirectory = join(root, "Happy Desktop", "node_modules", ".bin");
        const happyShim = await writeExecutable(join(dependencyDirectory, "rig"));
        const linkedDependencyDirectory = join(root, "linked package bin");
        await symlink(dependencyDirectory, linkedDependencyDirectory, "dir");
        const apparentShim = join(linkedDependencyDirectory, "rig");
        const globalExecutable = await writeExecutable(join(root, "global bin", "rig"));

        await expect(
            rigExecutableFind(apparentShim, {
                PATH: `${linkedDependencyDirectory}:${dirname(globalExecutable)}`,
            }),
        ).resolves.toEqual({
            executablePath: globalExecutable,
        });
        expect(happyShim).not.toBe(globalExecutable);
    });

    it("keeps a global symlink when its installation path contains spaces", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-rig-selection-"));
        directories.push(root);
        const globalTarget = await writeExecutable(
            join(
                root,
                "global installation",
                "lib",
                "node_modules",
                "@slopus",
                "rig",
                "dist",
                "main.js",
            ),
        );
        const apparentGlobal = join(root, "global bin with spaces", "rig");
        await mkdir(dirname(apparentGlobal), { recursive: true });
        await symlink(globalTarget, apparentGlobal);

        await expect(
            rigExecutableFind(apparentGlobal, { PATH: dirname(apparentGlobal) }),
        ).resolves.toEqual({
            executablePath: apparentGlobal,
        });
    });

    it("accepts a global node_modules/.bin shim outside Happy's dependency tree", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-rig-selection-"));
        directories.push(root);
        const globalShim = await writeExecutable(
            join(root, "yarn global", "node_modules", ".bin", "rig"),
        );

        await expect(rigExecutableFind(globalShim, { PATH: dirname(globalShim) })).resolves.toEqual(
            {
                executablePath: globalShim,
            },
        );
    });
});

describe("normal Rig discovery", () => {
    it("uses the login shell machine record without running the discovered executable", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-local-rig-"));
        directories.push(root);
        const executablePath = await writeExecutable(join(root, "Volta installation", "rig"));
        const host: RigProcessHost = {
            execFile: vi.fn().mockResolvedValue({
                stdout: `shell banner\n__HAPPY2_RIG_PATH__=${executablePath}\0PATH=${dirname(
                    executablePath,
                )}:/usr/bin\0VOLTA_HOME=/opt/volta\0`,
                stderr: "",
            }),
        };

        const result = await rigLoginEnvironmentDiscover(
            host,
            { HOME: "/Users/ada", SHELL: "/bin/zsh" },
            "/bin/zsh",
        );

        expect(result).toEqual({
            executablePath,
            environment: {
                PATH: `${dirname(executablePath)}:/usr/bin`,
                VOLTA_HOME: "/opt/volta",
            },
            shell: "/bin/zsh",
        });
        // Discovery is one login-shell call and nothing else: what it reports is
        // what the shell resolved. The connector starts that exact global command.
        expect(host.execFile).toHaveBeenCalledTimes(1);
        const [program, arguments_] = vi.mocked(host.execFile).mock.calls[0]!;
        expect(program).toBe("/bin/zsh");
        expect(arguments_.slice(0, 3)).toEqual(["-l", "-i", "-c"]);
    });

    it("distinguishes missing and malformed-path results", async () => {
        expect(() => discoveryOutputParse("__HAPPY2_RIG_PATH__=\0PATH=/usr/bin\0")).not.toThrow();
        expect(() =>
            discoveryOutputParse("__HAPPY2_RIG_PATH__=relative/rig\0PATH=/usr/bin\0"),
        ).toThrow("invalid Rig executable path");
        const host: RigProcessHost = {
            execFile: vi.fn(async () => ({
                stdout: "__HAPPY2_RIG_PATH__=\0PATH=/usr/bin\0",
                stderr: "",
            })),
        };
        await expect(
            rigLoginEnvironmentDiscover(host, { SHELL: "/bin/zsh" }, "/bin/zsh"),
        ).rejects.toThrow("global Rig command");
    });

    it("connects to an exact daemon named by RIG_SERVER_SOCKET_PATH and RIG_SERVER_TOKEN_PATH, never discovering or starting Rig", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-local-rig-"));
        directories.push(root);
        const tokenPath = join(root, "token");
        const socketPath = join(root, "server.sock");
        await writeFile(tokenPath, "existing-token\n");
        const host: RigProcessHost = {
            execFile: vi.fn(async () => {
                throw new Error("A running daemon must not trigger command discovery.");
            }),
        };
        const health = vi.fn().mockResolvedValue({
            status: "ready",
            healthy: true,
            ready: true,
            version: { daemon: "0.2.19", protocol: 17 },
        });
        const clientCreate = vi.fn(() => ({ health }) as unknown as RigDaemonClient);
        const wait = vi.fn(async () => undefined);
        const connector = localRigConnectorCreate({
            host,
            environment: {
                RIG_SERVER_SOCKET_PATH: socketPath,
                RIG_SERVER_TOKEN_PATH: tokenPath,
                SHELL: "/bin/zsh",
            },
            configuredShell: "/bin/zsh",
            clientCreate,
            wait,
        });

        const connection = await connector.connect();

        expect(connection.version).toBe("0.2.19");
        expect(clientCreate).toHaveBeenCalledWith({
            socketPath,
            token: "existing-token",
        });
        expect(health).toHaveBeenCalledOnce();
        expect(host.execFile).not.toHaveBeenCalled();
        expect(wait).not.toHaveBeenCalled();
    });

    it("starts only an absent daemon and reports the running daemon's version", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-local-rig-"));
        directories.push(root);
        const tokenPath = join(root, "token");
        const socketPath = join(root, "server.sock");
        const executablePath = await writeExecutable(join(root, "global bin", "rig"));
        const environment = {
            PATH: `${dirname(executablePath)}:/usr/bin`,
            RIG_SERVER_TOKEN_PATH: tokenPath,
            RIG_SERVER_SOCKET_PATH: socketPath,
        };
        const host: RigProcessHost = {
            execFile: vi.fn(async (program) => {
                if (program === "/bin/zsh")
                    return {
                        stdout: `__HAPPY2_RIG_PATH__=${executablePath}\0${Object.entries(
                            environment,
                        )
                            .map(([key, environmentValue]) => `${key}=${environmentValue}\0`)
                            .join("")}`,
                        stderr: "",
                    };
                await writeFile(tokenPath, "token\n");
                return { stdout: "Daemon is running.\n", stderr: "" };
            }),
        };
        const health = vi.fn().mockResolvedValue({
            status: "ready",
            healthy: true,
            ready: true,
            version: { daemon: "0.0.45", protocol: 17 },
        });
        const connector = localRigConnectorCreate({
            host,
            environment: { HAPPY_HOME_DIR: join(root, "happy-home"), SHELL: "/bin/zsh" },
            configuredShell: "/bin/zsh",
            wait: async () => undefined,
            clientCreate: () => ({ health }) as unknown as RigDaemonClient,
        });

        const connection = await connector.connect();
        expect(connection.version).toBe("0.0.45");
        connection.close();
        expect(host.execFile).toHaveBeenCalledWith(executablePath, ["daemon", "start"], {
            env: environment,
        });

        health.mockRejectedValueOnce(new Error("stale socket")).mockResolvedValueOnce({
            status: "ready",
            healthy: true,
            ready: true,
            version: { daemon: "0.0.45", protocol: 17 },
        });
        await connector.connect();
        expect(
            vi
                .mocked(host.execFile)
                .mock.calls.filter(
                    ([program, arguments_]) =>
                        program === executablePath && arguments_[0] === "daemon",
                ),
        ).toHaveLength(2);

        // A daemon older than the installed command is still the daemon this
        // machine is running, and protocol requests — not a version string — are
        // the compatibility boundary. Its version is reported, never refused.
        health.mockResolvedValue({
            status: "ready",
            healthy: true,
            ready: true,
            version: { daemon: "0.0.32", protocol: 17 },
        });
        expect((await connector.connect()).version).toBe("0.0.32");
    });
});
