import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const portless = join(workspace, "node_modules", ".bin", "portless");
const lan = process.argv.includes("--lan");
const childEnvironment = {
    ...process.env,
    // Desktop development is loopback-only by default. Portless persists the
    // last proxy's LAN mode and TLDs, so these settings must be explicit.
    PORTLESS_LAN: lan ? "1" : "0",
    PORTLESS_TLD: lan ? "local" : "localhost",
};
if (!lan) delete childEnvironment.PORTLESS_LAN_IP;
console.log("Happy Desktop development: Electron");
console.log(`  Portless: ${lan ? "LAN (.local)" : "loopback (.localhost)"}`);

const portlessArguments = ["run", "--name", "happy-desktop-electron"];
if (process.env.PORT) portlessArguments.push("--app-port", process.env.PORT);
portlessArguments.push("pnpm", "--filter", "happy-desktop-electron", "dev:electron");

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
