import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import concurrently from "concurrently";

const workspace = resolve(import.meta.dirname, "..");
const portless = join(workspace, "node_modules", ".bin", "portless");
const portlessUrl = (name) =>
    execFileSync(portless, ["get", name], {
        cwd: workspace,
        encoding: "utf8",
    }).trim();

const sleep = (ms) => new Promise((wake) => setTimeout(wake, ms));

/** Claim a loopback port the OS is not using, so both hostnames have a known target. */
function freePort() {
    return new Promise((resolvePort, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolvePort(port));
        });
    });
}

/** Resolves true once this stack's own process accepts connections on its port. */
function listening(port) {
    return new Promise((resolveListening) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        const finish = (value) => {
            socket.destroy();
            resolveListening(value);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.setTimeout(1000, () => finish(false));
    });
}

/** HTTP status behind a portless hostname, or 0 when the proxy answers nothing at all. */
function status(url) {
    return new Promise((resolveStatus) => {
        // The portless certificate comes from its own local CA, which Node does not
        // read from the OS trust store. This only checks that the route resolves.
        const request = httpsGet(url, { rejectUnauthorized: false }, (response) => {
            response.resume();
            resolveStatus(response.statusCode ?? 0);
        });
        request.setTimeout(2000, () => request.destroy());
        request.once("error", () => resolveStatus(0));
    });
}

async function until(check, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await check()) return true;
        if (Date.now() >= deadline) return false;
        await sleep(500);
    }
}

/**
 * The proxy daemon is a long-lived root process shared by every project, so it can
 * outlive — and fall behind — the portless this repo installs. A daemon serving a
 * stale route table answers 502 for a perfectly healthy stack, so name that
 * mismatch instead of leaving it to look like an application failure.
 */
function daemonVersionSkew() {
    try {
        const repoVersion = execFileSync(portless, ["--version"], { encoding: "utf8" }).trim();
        // Ask the daemon process itself rather than PATH, which pnpm points back at
        // this repo's own portless.
        const pid = readFileSync(join(homedir(), ".portless", "proxy.pid"), "utf8").trim();
        const daemon = execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" })
            .trim()
            .split(/\s+/)
            .find((part) => part.endsWith("portless") || part.endsWith("cli.js"));
        if (!daemon) return undefined;
        const daemonVersion = execFileSync(process.execPath, [daemon, "--version"], {
            encoding: "utf8",
        }).trim();
        if (daemonVersion === repoVersion) return undefined;
        return (
            `The running proxy daemon is portless ${daemonVersion}; this repo installs ` +
            `${repoVersion}. Restarting alone will not fix a version mismatch:\n` +
            `  npm install -g portless@${repoVersion}`
        );
    } catch {
        // Diagnosis only. An unreadable daemon is not itself the failure.
    }
    return undefined;
}

/**
 * Every request the browser makes — app, API, and websockets — travels through the
 * portless hostname, so a hostname that does not reach this stack is a dead dev
 * environment. Wait for our own process first, then hold the proxy to the same
 * standard and fail the run when it cannot deliver.
 */
async function requireRoute(label, url, port) {
    if (!(await until(() => listening(port), 240_000)))
        throw new Error(`The ${label} process never listened on 127.0.0.1:${port}.`);
    let last = 0;
    const routed = await until(async () => {
        last = await status(url);
        return last > 0 && last < 500;
    }, 20_000);
    if (routed) return;
    throw new Error(
        `${url} answers ${last === 0 ? "nothing" : last}, but this stack's ${label} process ` +
            `is listening on 127.0.0.1:${port}.`,
    );
}

const apiPort = await freePort();
const webPort = await freePort();
const webUrl = portlessUrl("happy2");
const serverUrl = portlessUrl("happy2-api");

console.log(`Happy (2) development: web ${webUrl} · server ${serverUrl}`);

const { commands, result } = concurrently(
    [
        {
            // `--force` takes over the hostname from an orphaned dev stack instead of
            // leaving two stacks fighting over one route.
            command:
                `pnpm exec portless run --force --name happy2-api --app-port ${apiPort} ` +
                "node scripts/dev-server.mjs",
            name: "server",
            prefixColor: "magenta",
        },
        {
            command:
                `pnpm exec portless run --force --name happy2 --app-port ${webPort} ` +
                "node scripts/dev-web.mjs",
            name: "web",
            prefixColor: "cyan",
            env: {
                VITE_HAPPY2_SERVER_URL: serverUrl,
            },
        },
    ],
    {
        cwd: workspace,
        killOthersOn: ["failure", "success"],
        prefix: "[{color}{name}{/color}]",
    },
);

void (async () => {
    try {
        await Promise.all([
            requireRoute("server", serverUrl, apiPort),
            requireRoute("web", webUrl, webPort),
        ]);
    } catch (reason) {
        const skew = daemonVersionSkew();
        console.error(
            `\n${reason.message}\n` +
                "The portless proxy daemon is not serving this stack's routes.\n" +
                (skew ? `${skew}\n` : "") +
                "Restart the daemon, then run `pnpm dev` again:\n" +
                "  sudo launchctl kickstart -k system/sh.portless.proxy   # installed service\n" +
                "  sudo portless proxy stop                               # otherwise\n",
        );
        for (const command of commands) command.kill();
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 5000).unref();
    }
})();

try {
    await result;
} catch {
    process.exitCode = 1;
}
