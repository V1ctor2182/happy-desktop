import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

import { electronEntrypointResolve } from "./paths.js";

export interface GymSmokeResult {
    readonly platform: NodeJS.Platform;
    readonly arch: NodeJS.Architecture;
    readonly welcomeVisible: boolean;
    readonly windowTitle: string;
}

/**
 * Launches the built desktop app with fresh user data and no Happy Agent, and
 * proves the shell reaches its first rendered screen. This is the platform
 * validation available before Happy Agent itself runs on the host: the full
 * workload gym needs a daemon, but a shell that boots to its welcome deck has
 * proven the main process, the preload boundary, and the renderer on this
 * platform.
 */
export async function gymSmokeRun(): Promise<GymSmokeResult> {
    const root = await mkdtemp(join(tmpdir(), "hdg-smoke-"));
    const userData = join(root, "user-data");
    const home = join(root, "home");
    await Promise.all([mkdir(userData), mkdir(home)]);
    const entrypoint = electronEntrypointResolve();
    const app = await electron.launch({
        args: [`--user-data-dir=${userData}`, entrypoint.main],
        env: smokeEnvironment(home),
        executablePath: entrypoint.executable,
        timeout: 60_000,
    });
    try {
        const page = await app.firstWindow();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForSelector("body", { timeout: 30_000 });
        // Without a daemon or an installed agent the app must still stand up
        // its onboarding, not crash or hang on a blank window.
        await page
            .locator('[data-happy-desktop-ui="welcome-screen"]')
            .waitFor({ state: "visible", timeout: 30_000 });
        return {
            platform: process.platform,
            arch: process.arch,
            welcomeVisible: true,
            windowTitle: await page.title(),
        };
    } finally {
        await app.close().catch(() => undefined);
        await rm(root, { force: true, recursive: true });
    }
}

/**
 * The host's own environment with every route to an existing Happy home
 * severed: `HOME`/`USERPROFILE` and `HAPPY_HOME_DIR` point into the disposable
 * smoke root, and the exact daemon overrides are dropped. Discovery then
 * honestly finds nothing, which is exactly the first launch this smoke
 * validates — and it can never attach to a developer's live daemon.
 */
function smokeEnvironment(home: string): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value === undefined) continue;
        if (name === "HAPPY_AGENT_SERVER_SOCKET_PATH" || name === "HAPPY_AGENT_SERVER_TOKEN_PATH")
            continue;
        if (name === "HAPPY_HOME_DIR") continue;
        environment[name] = value;
    }
    environment.HOME = home;
    environment.USERPROFILE = home;
    environment.HAPPY_HOME_DIR = join(home, ".happy");
    return environment;
}
