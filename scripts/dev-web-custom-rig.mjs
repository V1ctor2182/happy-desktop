import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Starts a Rig checkout's isolated daemon and serves Happy Desktop's renderer
 * directly in a normal browser. Vite's browserLocalRigPlugin owns the
 * same-origin /__happy2_local_rig bridge, so the web app exercises the same
 * Happy Agent HTTP, SSE, and terminal proxy code as Electron without requiring
 * an Electron window.
 */

const workspace = resolve(import.meta.dirname, "..");
const options = optionsParse(process.argv.slice(2));

if (options.help || !options.rigPath) {
    console.log(`Happy Desktop browser development against a custom Rig checkout

Usage:
  pnpm dev:web:custom-rig <path-to-rig-checkout> [--port <port>] [--keep-daemon]

Starts the checkout's isolated Rig daemon, then serves Happy Desktop at
http://127.0.0.1:<port>. The renderer reaches the daemon through the
same-origin /__happy2_local_rig proxy.

The daemon is stopped when this command exits unless --keep-daemon is supplied.
`);
    process.exit(options.help ? 0 : 2);
}

const rigPath = resolve(options.rigPath);
if (!existsSync(join(rigPath, "packages", "rig-dev", "package.json"))) {
    console.error(`Not a Rig checkout: ${rigPath}`);
    console.error('Expected to find "packages/rig-dev/package.json" underneath it.');
    process.exit(1);
}

const rigHome = join(rigPath, ".rig-dev", ".happy");
const socketPath = join(rigHome, "agent", "server.sock");
const tokenPath = join(rigHome, "agent", "token");

console.log(`Happy Desktop browser development against ${rigPath}`);
console.log("  stopping the checkout's previous isolated daemon...");
rigCommand("stop");
console.log("  starting the checkout's current isolated daemon...");
rigCommand("start");

if (!existsSync(tokenPath)) {
    console.error(`Rig daemon did not write its token at ${tokenPath}`);
    process.exit(1);
}

console.log(`  app     http://127.0.0.1:${options.port}`);
console.log(`  proxy   http://127.0.0.1:${options.port}/__happy2_local_rig`);
console.log(`  socket  ${socketPath}`);

const child = spawn("pnpm", ["--filter", "happy-desktop-electron", "dev"], {
    cwd: workspace,
    env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: options.port,
        RIG_SERVER_SOCKET_PATH: socketPath,
        RIG_SERVER_TOKEN_PATH: tokenPath,
        VITE_HAPPY2_BROWSER_LOCAL: "1",
    },
    stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        child.kill(signal);
    });
}

const exitCode = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
        resolvePromise(stopping && signal !== null ? 0 : (code ?? 1)),
    );
});

if (!options.keepDaemon) {
    console.log("  stopping the checkout's isolated daemon...");
    rigCommand("stop");
}
process.exitCode = exitCode;

function rigCommand(action) {
    execFileSync("pnpm", ["dev", "daemon", action], {
        cwd: rigPath,
        stdio: "inherit",
    });
}

function optionsParse(argumentsList) {
    let help = false;
    let keepDaemon = false;
    let port = process.env.PORT ?? "5174";
    let rigPath;
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        if (argument === "--help" || argument === "-h") help = true;
        else if (argument === "--keep-daemon") keepDaemon = true;
        else if (argument === "--port") {
            const value = argumentsList[index + 1];
            if (value === undefined) optionFailure("--port requires a value.");
            port = value;
            index += 1;
        } else if (!argument.startsWith("-") && rigPath === undefined) rigPath = argument;
        else optionFailure(`Unknown option: ${argument}`);
    }
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535)
        optionFailure(`Invalid port: ${port}`);
    return { help, keepDaemon, port: String(parsedPort), rigPath };
}

function optionFailure(message) {
    console.error(message);
    console.error(
        "Usage: pnpm dev:web:custom-rig <path-to-rig-checkout> [--port <port>] [--keep-daemon]",
    );
    process.exit(2);
}
