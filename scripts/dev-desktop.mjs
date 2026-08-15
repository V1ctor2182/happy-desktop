import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const portless = join(workspace, "node_modules", ".bin", "portless");
const options = devOptionsParse(process.argv.slice(2));
if (options.help) {
    console.log(`Happy Desktop development

Usage:
  pnpm dev [--debug] [--lan] [--profile]

The profile flavor preloads the dormant React profiler and keeps collection
stopped until Settings → Dev Tools → React renderer profile is started.
`);
    process.exit(0);
}

const debug = options.debug || process.env.HAPPY2_DESKTOP_DEBUG === "1";
const childEnvironment = {
    ...process.env,
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
console.log(
    `Happy Desktop development: Electron${options.profile ? " (React profile)" : ""}${debug ? " (debug)" : ""}`,
);
console.log(`  Portless: ${options.lan ? "LAN (.local)" : "loopback (.localhost)"}`);
if (debug) console.log("  inspector URLs will be printed by Electron");

const portlessArguments = ["run", "--name", "happy-desktop-electron"];
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

const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = exitCode;

function devOptionsParse(argumentsList) {
    let debug = false;
    let lan = false;
    let profile = false;
    let help = false;
    for (const argument of argumentsList) {
        if (argument === "--debug") debug = true;
        else if (argument === "--lan") lan = true;
        else if (argument === "--profile") profile = true;
        else if (argument === "--help" || argument === "-h") help = true;
        else {
            console.error(`Unknown option: ${argument}`);
            console.error("Usage: pnpm dev [--debug] [--lan] [--profile]");
            process.exit(2);
        }
    }
    return { debug, help, lan, profile };
}
