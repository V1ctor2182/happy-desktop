import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Runs the desktop against a throwaway home directory instead of the real one,
 * so first-run setup can be replayed as often as you like without touching the
 * Rig you actually work in.
 *
 * Only two levers reach the daemon, and both are deliberate. `localRig.ts` runs
 * the discovery command in a login shell with `minimalShellEnvironment`, which
 * keeps HOME, LOGNAME, PATH, SHELL, TMPDIR, and USER and drops everything else —
 * so pointing `RIG_SERVER_DIRECTORY` at a sandbox would be thrown away before
 * the shell ever saw it. What survives is enough:
 *
 *   HOME    moves ~/.happy/rig (the daemon's own state), ~/.happy/desktop
 *           (the desktop's config), and ~/.happy2/notes.
 *   TMPDIR  moves the socket, because `rigDaemonPathsResolve` falls back to
 *           `<tmpdir>/rig-<uid>/server.sock` — which is what makes this a
 *           different daemon rather than the global one wearing a new hat.
 *
 * A sandbox HOME also means a sandbox shell profile, and the app reads Rig out
 * of the user's real login shell on purpose. `--no-rig` uses that rather than
 * fighting it: the profile takes Homebrew's bin off PATH and links `node` back
 * in, so the shell honestly answers that Rig is not installed while Node still
 * is — which exercises the missing-global-prerequisite screen without letting
 * Happy install anything.
 */

const workspace = resolve(import.meta.dirname, "..");

const options = { name: "default", noRig: false, reset: false };
for (const argument of process.argv.slice(2)) {
    if (argument === "--reset") options.reset = true;
    else if (argument === "--no-rig") options.noRig = true;
    else if (argument.startsWith("--name=")) options.name = argument.slice("--name=".length);
    else {
        console.error(`Unknown option: ${argument}`);
        console.error(
            "Usage: node scripts/dev-desktop-sandbox.mjs [--reset] [--no-rig] [--name=x]",
        );
        process.exit(2);
    }
}

const home = join(workspace, ".happy-sandbox", options.name);
const temporary = join(home, "tmp");

// macOS refuses a unix socket path over 104 bytes, and the daemon's is
// `<TMPDIR>/rig-<uid>/server.sock`. Better to say so here than to watch the
// daemon fail to bind for reasons that look like nothing at all.
const socketPath = join(temporary, `rig-${process.getuid?.() ?? 0}`, "server.sock");
if (socketPath.length > 100) {
    console.error(
        `The sandbox socket path is ${socketPath.length} bytes, which macOS will refuse:`,
    );
    console.error(`  ${socketPath}`);
    console.error("Move the checkout somewhere shorter, or use a shorter --name.");
    process.exit(1);
}

if (options.reset) {
    // Whatever is still listening on the old socket belongs to the sandbox
    // being thrown away, so it is stopped before its directory disappears
    // underneath it.
    try {
        execFileSync("rig", ["daemon", "stop"], {
            env: { ...process.env, HOME: home, TMPDIR: temporary },
            stdio: "ignore",
        });
    } catch {
        // No sandbox daemon was running, which is the ordinary case.
    }
    rmSync(home, { force: true, recursive: true });
}

mkdirSync(temporary, { recursive: true });

if (options.noRig) {
    const binary = join(home, "bin");
    mkdirSync(binary, { recursive: true });
    const node = execFileSync(process.env.SHELL ?? "/bin/zsh", ["-l", "-c", "command -v node"], {
        encoding: "utf8",
    }).trim();
    rmSync(join(binary, "node"), { force: true });
    if (node) symlinkSync(node, join(binary, "node"));
    // Written to both names because the profile that runs depends on the login
    // shell, and `-l -c` is non-interactive: zsh reads .zprofile and bash reads
    // .bash_profile, while neither reads an rc file here.
    const profile = `export PATH="${binary}:\${PATH//\\/opt\\/homebrew\\/bin/}"\n`;
    writeFileSync(join(home, ".zprofile"), profile);
    writeFileSync(join(home, ".bash_profile"), profile);
} else {
    rmSync(join(home, ".zprofile"), { force: true });
    rmSync(join(home, ".bash_profile"), { force: true });
}

console.log("Happy Desktop development: Electron, sandboxed");
console.log(`  home    ${home}`);
console.log(`  socket  ${socketPath}`);
if (options.noRig) console.log("  rig     hidden from the login shell");

const portless = join(workspace, "node_modules", ".bin", "portless");
const portlessArguments = ["run", "--name", `happy-desktop-sandbox-${options.name}`];
if (process.env.PORT) portlessArguments.push("--app-port", process.env.PORT);
portlessArguments.push("pnpm", "--filter", "happy-desktop-electron", "dev:electron");

const portlessEnvironment = {
    ...process.env,
    HOME: home,
    TMPDIR: temporary,
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
