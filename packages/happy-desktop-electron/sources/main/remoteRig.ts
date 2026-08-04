import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { RigDaemonClient } from "./rigDaemonClient";

const sshCommand = "/usr/bin/ssh";

/**
 * Reads only Rig's own default endpoints for the logged-in user: the daemon's
 * Unix socket and the token beside it. The command is fixed so that reaching a
 * machine never becomes a way to run arbitrary shell text on it.
 */
const remoteEndpointsCommand =
    'root="${TMPDIR:-/tmp}/rig-$(id -u)"; printf "%s\\n%s\\n" "$root/server.sock" "$(cat "$root/token")"';

export interface RemoteRigConnection {
    readonly client: RigDaemonClient;
    readonly version: string;
    close(): void;
}

/**
 * A machine is named the way the reader already reaches it: an SSH destination,
 * `host` or `user@host`, resolved through their own SSH configuration. There is no
 * endpoint to publish and no token to copy out of the remote machine by hand.
 */
export interface RemoteRigConnector {
    connect(destination: string): Promise<RemoteRigConnection>;
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
 * Opens an authenticated Rig connection through OpenSSH: it asks the machine
 * where its daemon listens, forwards that Unix socket to a private local one, and
 * then speaks the ordinary daemon protocol over the forwarded socket. Because the
 * transport ends in a Unix socket, a remote daemon and this machine's own are the
 * same client to everything above. The remote token never travels past this
 * process, and the local socket is removed when the connection closes.
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
            // A short name on purpose: a Unix socket path is capped near 104 bytes,
            // and the application-support root already spends most of that budget.
            const localSocket = join(directory, `${randomBytes(6).toString("hex")}.sock`);
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

/** The short name a reader recognizes the machine by when none was given. */
export function remoteRigLabelDerive(destination: string): string {
    return destination.split("@").pop() ?? destination;
}

/**
 * Waits for OpenSSH to publish the forwarded socket, and reports the SSH error
 * text rather than a timeout when the connection itself is what failed.
 */
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
