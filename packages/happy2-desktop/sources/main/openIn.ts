import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The applications a project directory can be handed to. The renderer only ever
 * names one of these ids: it never sends a bundle id, an executable, a flag, or
 * an argument, so nothing it says can become part of a command line. Everything
 * that does reach the command line is the fixed data below.
 *
 * Editions are several bundle ids behind one id — PyCharm Professional and
 * Community are one entry to the reader, and the first one installed wins.
 */
interface OpenInApp {
    readonly id: string;
    readonly label: string;
    readonly bundleIds: readonly string[];
}

const OPEN_IN_APPS: readonly OpenInApp[] = [
    { id: "finder", label: "Finder", bundleIds: ["com.apple.finder"] },
    { id: "terminal", label: "Terminal", bundleIds: ["com.apple.Terminal"] },
    { id: "vscode", label: "VS Code", bundleIds: ["com.microsoft.VSCode"] },
    { id: "cursor", label: "Cursor", bundleIds: ["com.todesktop.230313mzl4w4u92"] },
    { id: "xcode", label: "Xcode", bundleIds: ["com.apple.dt.Xcode"] },
    {
        id: "pycharm",
        label: "PyCharm",
        bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    },
    { id: "goland", label: "GoLand", bundleIds: ["com.jetbrains.goland"] },
    { id: "datagrip", label: "DataGrip", bundleIds: ["com.jetbrains.datagrip"] },
    { id: "android-studio", label: "Android Studio", bundleIds: ["com.google.android.studio"] },
    {
        id: "sourcetree",
        label: "Sourcetree",
        // The direct download and the App Store build ship different ids.
        bundleIds: ["com.torusknot.SourceTreeNotMAS", "com.torusknot.SourceTree"],
    },
    { id: "antigravity", label: "Antigravity", bundleIds: ["com.google.antigravity"] },
];

export interface OpenInTarget {
    readonly id: string;
    readonly label: string;
}

/** How long a detection result is reused before the applications are looked up again. */
const DETECT_TTL_MS = 60_000;

let detected:
    | { readonly at: number; readonly value: Promise<ReadonlyMap<string, string>> }
    | undefined;

/**
 * Asks Spotlight which of the known bundle ids resolve to an installed
 * application, and returns the first bundle id that does for each app.
 *
 * Spotlight rather than a filesystem scan because an application bundle is not
 * required to live in /Applications, and rather than launching each candidate to
 * see whether it exists, which is what listing them is meant to avoid. It can be
 * stale in both directions, so a launch still reports its own failure: the menu
 * is a prediction, not a guarantee.
 */
async function appsDetect(): Promise<ReadonlyMap<string, string>> {
    const entries = await Promise.all(
        OPEN_IN_APPS.map(async (app) => {
            for (const bundleId of app.bundleIds) {
                try {
                    const { stdout } = await execFileAsync(
                        "/usr/bin/mdfind",
                        [`kMDItemCFBundleIdentifier == '${bundleId}'`],
                        { timeout: 4_000 },
                    );
                    if (stdout.trim().length > 0) return [app.id, bundleId] as const;
                } catch {
                    // A failed query is indistinguishable from "not installed"
                    // for this purpose, and neither is worth reporting: the app
                    // simply does not appear in the menu.
                }
            }
            return undefined;
        }),
    );
    return new Map(entries.filter((entry) => entry !== undefined));
}

function detectedRead(): Promise<ReadonlyMap<string, string>> {
    const now = Date.now();
    if (detected && now - detected.at < DETECT_TTL_MS) return detected.value;
    const value = appsDetect();
    detected = { at: now, value };
    return value;
}

/**
 * The applications currently installed, in the fixed order above so the menu
 * does not reshuffle itself between openings. Finder and Terminal ship with the
 * system, but they are detected like everything else rather than assumed.
 */
export async function openInTargetsRead(): Promise<readonly OpenInTarget[]> {
    if (process.platform !== "darwin") return [];
    const installed = await detectedRead();
    return OPEN_IN_APPS.filter((app) => installed.has(app.id)).map((app) => ({
        id: app.id,
        label: app.label,
    }));
}

/**
 * Opens `directory` in the named application.
 *
 * `open -b` identifies the application through LaunchServices, so it survives
 * being renamed, moved, or installed somewhere unusual — unlike `-a`, which
 * matches on a display name that any of those can change. The argument array is
 * passed to `execFile` directly: there is no shell, so there is no quoting to
 * get wrong.
 *
 * The caller is responsible for `directory` being a project root it has
 * independently authorized; this function does not take the renderer's word for
 * a path any more than it takes its word for an application.
 */
export async function openInRun(targetId: string, directory: string): Promise<void> {
    if (process.platform !== "darwin")
        throw new Error("Opening a project in another application is only supported on macOS.");
    const app = OPEN_IN_APPS.find((candidate) => candidate.id === targetId);
    if (!app) throw new Error("That application is not one this app can open projects in.");
    const bundleId = (await detectedRead()).get(app.id);
    if (bundleId === undefined) throw new Error(`${app.label} does not appear to be installed.`);
    try {
        await execFileAsync("/usr/bin/open", ["-b", bundleId, directory], { timeout: 10_000 });
    } catch {
        throw new Error(`${app.label} could not open this project.`);
    }
}
