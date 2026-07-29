import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { RigDaemonClient } from "./rigDaemonClient";
import type { LocalRigConnection } from "./localRig";

const sshCommand = "/usr/bin/ssh";
const remoteEndpointsCommand =
    'root="${TMPDIR:-/tmp}/rig-$(id -u)"; printf "%s\\n%s\\n" "$root/server.sock" "$(cat "$root/token")"';

export interface RemoteRigConnector {
    connect(destination: string): Promise<LocalRigConnection>;
}

export interface RemoteRigProcessHost {
    execFile(executable: string, arguments_: readonly string[]): Promise<string>;
    spawn(executable: string, arguments_: readonly string[]): ChildProcess;
}

const defaultHost: RemoteRigProcessHost = {
    execFile: (executable, arguments_) =>
        new Promise((resolve, reject) => {
            execFileCallback(
                executable,
                [...arguments_],
                { encoding: "utf8", maxBuffer: 64 * 1024, timeout: 30_000 },
                (error, stdout) => (error ? reject(error) : resolve(stdout)),
            );
        }),
    spawn: (executable, arguments_) =>
        spawn(executable, [...arguments_], { stdio: ["ignore", "ignore", "pipe"] }),
};

/**
 * Opens an authenticated Rig connection through OpenSSH. The remote command is
 * fixed, reads only Rig's default user daemon endpoints, and the resulting
 * private local socket is removed when the connection closes.
 */
export function remoteRigConnectorCreate(
    root: string,
    host: RemoteRigProcessHost = defaultHost,
): RemoteRigConnector {
    return {
        async connect(destinationValue) {
            const destination = sshDestinationValidate(destinationValue);
            const output = await host.execFile(sshCommand, [
                "-o",
                "BatchMode=yes",
                destination,
                remoteEndpointsCommand,
            ]);
            const [remoteSocket, token, extra] = output.split(/\r?\n/u);
            if (!remoteSocket?.startsWith("/") || !token || extra?.trim())
                throw new Error("The remote Rig daemon returned invalid default endpoints.");

            const directory = join(root, "ssh");
            await mkdir(directory, { mode: 0o700, recursive: true });
            const localSocket = join(directory, `${randomUUID()}.sock`);
            const tunnel = host.spawn(sshCommand, [
                "-N",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=3",
                "-o",
                "StreamLocalBindUnlink=yes",
                "-L",
                `${localSocket}:${remoteSocket}`,
                destination,
            ]);
            try {
                await forwardedSocketWait(localSocket, tunnel);
                const client = new RigDaemonClient({ socketPath: localSocket, token });
                const health = await client.health();
                if (health.status !== "ready")
                    throw new Error(
                        health.status === "error"
                            ? `Remote Rig daemon could not start: ${health.error}`
                            : "The remote Rig daemon is not ready.",
                    );
                let closed = false;
                return {
                    client,
                    command: sshCommand,
                    environment: {},
                    version: health.identity.version,
                    close() {
                        if (closed) return;
                        closed = true;
                        tunnel.kill();
                        void rm(localSocket, { force: true });
                    },
                };
            } catch (error) {
                tunnel.kill();
                await rm(localSocket, { force: true });
                throw error;
            }
        },
    };
}

export function sshDestinationValidate(value: string): string {
    const destination = value.trim();
    if (!/^(?:[A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(destination))
        throw new Error("Enter an SSH host or user@host configured for key authentication.");
    return destination;
}

async function forwardedSocketWait(path: string, tunnel: ChildProcess): Promise<void> {
    const deadline = Date.now() + 10_000;
    let stderr = "";
    tunnel.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });
    while (Date.now() < deadline) {
        if (tunnel.exitCode !== null)
            throw new Error(stderr.trim() || "The SSH connection closed before Rig was reached.");
        try {
            if ((await lstat(path)).isSocket()) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out while opening the SSH connection to Rig.");
}
