import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Runs the desktop against a Rig started from a chosen checkout instead of the
 * global one on PATH, so a change made in that checkout is what the desktop
 * connects to.
 *
 * Setting both `RIG_SERVER_SOCKET_PATH` and `RIG_SERVER_TOKEN_PATH` names one
 * exact daemon to `localRig.ts`, which then connects to it over `/v0` and
 * never discovers or starts another Rig, and never falls back to the login
 * shell's `rig` if that exact daemon cannot be reached. So this script starts
 * the checkout's own isolated daemon first, then launches Electron with those
 * two paths pointing straight at it.
 *
 * The checkout's own `pnpm dev` isolates its daemon under
 * `<checkout>/.rig-dev/.happy` (see `configureDevelopmentEnvironment.ts` in
 * the Rig repository); this script only has to know that path, not
 * reimplement it.
 */

const workspace = resolve(import.meta.dirname, "..");

const options = devOptionsParse(process.argv.slice(2));
if (options.help || !options.rigPath) {
    console.log(`Happy Desktop development against a custom Rig checkout

Usage:
  pnpm dev:custom-rig <path-to-rig-checkout> [--debug] [--lan] [--profile]

Starts that checkout's own isolated Rig daemon (via its "pnpm dev daemon
start"), then runs Electron against it instead of the global Rig.
`);
    process.exit(options.help ? 0 : 2);
}

const rigPath = resolve(options.rigPath);
if (!existsSync(join(rigPath, "packages", "rig-dev", "package.json"))) {
    console.error(`Not a Rig checkout: ${rigPath}`);
    console.error('Expected to find "packages/rig-dev/package.json" underneath it.');
    process.exit(1);
}

console.log(`Happy Desktop development: Electron against custom Rig at ${rigPath}`);
// pnpm forwards these trailing arguments through the chained "dev" scripts by
// appending them to each resolved command line in turn; a "--" separator
// would itself be forwarded the same way and reach Rig's own CLI as a literal
// (and invalid) argument.
//
// A daemon already running there is whatever this checkout last built, not
// necessarily what it looks like now — "daemon start" attaches to a matching
// one instead of replacing it, so a source change made since it was started
// would otherwise go unseen. Stopping first (a no-op if none is running)
// means every run of this script talks to a daemon built from the current
// source.
console.log("  stopping any daemon already running for this checkout (pnpm dev daemon stop)...");
execFileSync("pnpm", ["dev", "daemon", "stop"], { cwd: rigPath, stdio: "inherit" });
console.log("  starting that checkout's isolated Rig daemon (pnpm dev daemon start)...");
execFileSync("pnpm", ["dev", "daemon", "start"], { cwd: rigPath, stdio: "inherit" });

const rigHome = join(rigPath, ".rig-dev", ".happy");
const socketPath = join(rigHome, "agent", "server.sock");
const tokenPath = join(rigHome, "agent", "token");
if (!existsSync(tokenPath)) {
    console.error(`Rig daemon did not start: no token was written at ${tokenPath}`);
    console.error("Check the output above.");
    process.exit(1);
}
console.log(`  socket  ${socketPath}`);
console.log(`  stop it later with:  (cd ${rigPath} && pnpm dev daemon stop)`);

const debug = options.debug || process.env.HAPPY2_DESKTOP_DEBUG === "1";
const childEnvironment = {
    ...process.env,
    RIG_SERVER_SOCKET_PATH: socketPath,
    RIG_SERVER_TOKEN_PATH: tokenPath,
    // Desktop development is loopback-only by default. Portless persists the
    // last proxy's LAN mode and TLDs, so these settings must be explicit.
    PORTLESS_LAN: options.lan ? "1" : "0",
    PORTLESS_TLD: options.lan ? "local" : "localhost",
    ...(debug ? { HAPPY2_DESKTOP_DEBUG: "1" } : {}),
};
if (options.profile) {
    childEnvironment.HAPPY2_DESKTOP_PROFILE = "1";
    childEnvironment.HAPPY2_DESKTOP_PROFILE_MODE = "development";
} else {
    delete childEnvironment.HAPPY2_DESKTOP_PROFILE;
    delete childEnvironment.HAPPY2_DESKTOP_PROFILE_MODE;
}
if (!options.lan) delete childEnvironment.PORTLESS_LAN_IP;
if (debug) console.log("  inspector URLs will be printed by Electron");

const portless = join(workspace, "node_modules", ".bin", "portless");
const portlessArguments = ["run", "--name", "happy-desktop-electron-custom-rig"];
if (process.env.PORT) portlessArguments.push("--app-port", process.env.PORT);
portlessArguments.push(
    "pnpm",
    "--filter",
    "happy-desktop-electron",
    options.profile ? "dev:electron:profile" : "dev:electron",
);

const child = spawn(portless, portlessArguments, {
    cwd: workspace,
    env: childEnvironment,
    stdio: "inherit",
});

const signals = ["SIGHUP", "SIGINT", "SIGTERM"];
for (const signal of signals) process.on(signal, () => child.kill(signal));

const exitCode = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
});
process.exitCode = exitCode;

function devOptionsParse(argumentsList) {
    let debug = false;
    let lan = false;
    let profile = false;
    let help = false;
    let rigPath;
    for (const argument of argumentsList) {
        if (argument === "--debug") debug = true;
        else if (argument === "--lan") lan = true;
        else if (argument === "--profile") profile = true;
        else if (argument === "--help" || argument === "-h") help = true;
        else if (!argument.startsWith("-") && rigPath === undefined) rigPath = argument;
        else {
            console.error(`Unknown option: ${argument}`);
            console.error(
                "Usage: pnpm dev:custom-rig <path-to-rig-checkout> [--debug] [--lan] [--profile]",
            );
            process.exit(2);
        }
    }
    return { debug, help, lan, profile, rigPath };
}
