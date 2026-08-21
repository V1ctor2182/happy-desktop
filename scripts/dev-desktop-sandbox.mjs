import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/*
 * Runs the desktop against a throwaway Happy installation so first-run setup
 * can be replayed as often as you like without touching the Happy Agent you
 * actually work in. The ordinary mode also replaces HOME. `--real-home` keeps
 * HOME intact so subscription discovery can exercise the credentials already
 * used by Claude, Codex, and Grok on this machine.
 *
 * The whole sandbox lives under the host temporary directory. Its explicit
 * HAPPY_HOME_DIR keeps the daemon, distribution, desktop configuration, notes,
 * token, and short Unix socket together under one disposable root. Ordinary
 * mode also moves HOME there so onboarding cannot read the user's files.
 *
 * `--real-home` keeps only HOME unchanged so provider credential paths still
 * resolve from the real home while Happy itself remains in the sandbox.
 *
 * A sandbox HOME also means a sandbox shell profile, and the app reads the
 * machine's Node and coding assistants out of the user's real login shell on
 * purpose. `--no-node` uses that rather than fighting it: the profile takes
 * Homebrew's bin off PATH, so the shell honestly answers that no Node runtime is
 * installed — which exercises the missing-prerequisite screen without letting
 * Happy install anything.
 */

const workspace = resolve(import.meta.dirname, "..");

const options = { name: "default", noNode: false, realHome: false, reset: false };
for (const argument of process.argv.slice(2)) {
    if (argument === "--reset") options.reset = true;
    else if (argument === "--no-node") options.noNode = true;
    else if (argument === "--real-home") options.realHome = true;
    else if (argument.startsWith("--name=")) options.name = argument.slice("--name=".length);
    else {
        console.error(`Unknown option: ${argument}`);
        console.error(
            "Usage: node scripts/dev-desktop-sandbox.mjs [--reset] [--no-node] [--real-home] [--name=x]",
        );
        process.exit(2);
    }
}
if (options.realHome && options.noNode) {
    console.error("--real-home and --no-node cannot be combined.");
    process.exit(2);
}
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u.test(options.name)) {
    console.error("--name must contain 1–32 letters, numbers, underscores, or dashes.");
    process.exit(2);
}

/*
 * A development Electron already running takes the whole application's
 * single-instance lock, and that lock is the application's rather than this
 * home's: a second one calls `app.quit()` before it opens anything, exits 0, and
 * says nothing at all. Every part of this script still works — portless binds,
 * Vite serves, the main bundle builds — so the only visible symptom is a window
 * that never appears, which reads exactly like the sandbox being broken.
 *
 * So it is checked here, where there is somewhere to say it. A second sandbox is
 * not something to allow either: the lock would stop it just the same.
 */
const developmentElectron = "node_modules/.pnpm/electron@";
const running = (() => {
    try {
        // Deliberately every checkout rather than this one: the lock is the
        // application's, so a development Happy running out of another worktree
        // stops this one exactly as surely as one running out of here.
        return execFileSync("pgrep", ["-f", developmentElectron], { encoding: "utf8" }).trim();
    } catch {
        // pgrep exits non-zero when nothing matches, which is the ordinary case.
        return "";
    }
})();
if (running) {
    console.error("A development Happy is already running, and only one can be.");
    console.error("Quit that window first, or stop it with:");
    console.error(`  pkill -f ${developmentElectron}`);
    process.exit(1);
}

const home = join(tmpdir(), "hds", options.name);
const happyHome = join(home, ".happy");
const temporary = join(home, "tmp");

// macOS refuses a unix socket path over 104 bytes, and the daemon's is
// `<HOME>/.happy/agent/server.sock`. Better to say so here than to watch the
// daemon fail to bind for reasons that look like nothing at all.
const socketPath = join(happyHome, "agent", "server.sock");
const socketPathBytes = Buffer.byteLength(socketPath);
if (socketPathBytes > 103) {
    console.error(`The sandbox socket path is ${socketPathBytes} bytes, which macOS will refuse:`);
    console.error(`  ${socketPath}`);
    console.error("Use a shorter TMPDIR or --name.");
    process.exit(1);
}

if (options.reset) {
    // Whatever is still listening on the old socket belongs to the sandbox
    // being thrown away, so it is stopped before its directory disappears
    // underneath it. The agent that can stop it is the one Happy installed into
    // this sandbox — there is no global command to fall back on — so it is asked
    // through its own binary, under the same HOME it was started with.
    for (const agent of sandboxAgentBinaries(home)) {
        try {
            execFileSync(agent, ["stop"], {
                env: sandboxEnvironment(),
                stdio: "ignore",
            });
        } catch {
            // No sandbox daemon was running, which is the ordinary case.
        }
    }
    rmSync(home, { force: true, recursive: true });
}

/** Every agent version this sandbox has installed, newest last. */
function sandboxAgentBinaries(sandboxHome) {
    const versions = join(sandboxHome, ".happy", "dist", "version");
    let entries;
    try {
        entries = readdirSync(versions, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(versions, entry.name, "happy-agent"))
        .filter((path) => existsSync(path));
}

function sandboxEnvironment() {
    const environment = { ...process.env, HAPPY_HOME_DIR: happyHome, TMPDIR: temporary };
    delete environment.HAPPY_AGENT_SERVER_SOCKET_PATH;
    delete environment.HAPPY_AGENT_SERVER_TOKEN_PATH;
    if (!options.realHome) {
        environment.HOME = home;
    }
    return environment;
}

mkdirSync(temporary, { recursive: true });

if (options.noNode) {
    // Written to both names because the profile that runs depends on the login
    // shell, and `-l -c` is non-interactive: zsh reads .zprofile and bash reads
    // .bash_profile, while neither reads an rc file here.
    const profile = `export PATH="\${PATH//\\/opt\\/homebrew\\/bin/}"\n`;
    writeFileSync(join(home, ".zprofile"), profile);
    writeFileSync(join(home, ".bash_profile"), profile);
} else {
    rmSync(join(home, ".zprofile"), { force: true });
    rmSync(join(home, ".bash_profile"), { force: true });
}

console.log("Happy Desktop development: Electron, sandboxed");
console.log(`  home        ${options.realHome ? process.env.HOME : home}`);
console.log(`  happy home  ${happyHome}`);
console.log(`  socket      ${socketPath}`);
if (options.noNode) console.log("  node    hidden from the login shell");

const portless = join(workspace, "node_modules", ".bin", "portless");
const portlessArguments = ["run", "--name", `happy-desktop-sandbox-${options.name}`];
if (process.env.PORT) portlessArguments.push("--app-port", process.env.PORT);
portlessArguments.push("pnpm", "--filter", "happy-desktop-electron", "dev:electron");

const portlessEnvironment = {
    ...sandboxEnvironment(),
    PORTLESS_LAN: "0",
    PORTLESS_TLD: "localhost",
};
delete portlessEnvironment.PORTLESS_LAN_IP;

const child = spawn(portless, portlessArguments, {
    cwd: workspace,
    env: portlessEnvironment,
    stdio: "inherit",
});

const signals = ["SIGHUP", "SIGINT", "SIGTERM"];
for (const signal of signals) process.on(signal, () => child.kill(signal));

const exitCode = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code ?? 1));
});
process.exitCode = exitCode;
