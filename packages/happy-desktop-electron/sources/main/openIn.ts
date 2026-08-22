import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    { id: "iterm", label: "iTerm", bundleIds: ["com.googlecode.iterm2"] },
    { id: "ghostty", label: "Ghostty", bundleIds: ["com.mitchellh.ghostty"] },
    { id: "warp", label: "Warp", bundleIds: ["dev.warp.Warp-Stable"] },
    { id: "vscode", label: "VS Code", bundleIds: ["com.microsoft.VSCode"] },
    { id: "cursor", label: "Cursor", bundleIds: ["com.todesktop.230313mzl4w4u92"] },
    { id: "zed", label: "Zed", bundleIds: ["dev.zed.Zed"] },
    { id: "sublime-text", label: "Sublime Text", bundleIds: ["com.sublimetext.4"] },
    { id: "xcode", label: "Xcode", bundleIds: ["com.apple.dt.Xcode"] },
    {
        id: "intellij",
        label: "IntelliJ IDEA",
        bundleIds: ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    },
    {
        id: "pycharm",
        label: "PyCharm",
        bundleIds: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    },
    { id: "webstorm", label: "WebStorm", bundleIds: ["com.jetbrains.WebStorm"] },
    { id: "rustrover", label: "RustRover", bundleIds: ["com.jetbrains.rustrover"] },
    { id: "goland", label: "GoLand", bundleIds: ["com.jetbrains.goland"] },
    { id: "datagrip", label: "DataGrip", bundleIds: ["com.jetbrains.datagrip"] },
    { id: "android-studio", label: "Android Studio", bundleIds: ["com.google.android.studio"] },
    {
        id: "sourcetree",
        label: "Sourcetree",
        // The direct download and the App Store build ship different ids.
        bundleIds: ["com.torusknot.SourceTreeNotMAS", "com.torusknot.SourceTree"],
    },
    { id: "fork", label: "Fork", bundleIds: ["com.DanPristupov.Fork"] },
    { id: "tower", label: "Tower", bundleIds: ["com.fournova.Tower3"] },
    { id: "github-desktop", label: "GitHub Desktop", bundleIds: ["com.github.GitHubClient"] },
    { id: "antigravity", label: "Antigravity", bundleIds: ["com.google.antigravity"] },
];

export interface OpenInTarget {
    readonly id: string;
    readonly label: string;
    /**
     * The application's own macOS icon as a PNG data URL, taken from the
     * installed bundle. It is the picture of the thing being launched, so the
     * menu is recognizable at a glance instead of a column of words; absent only
     * when the system declines to render one.
     */
    readonly iconUrl?: string;
}

/** How long a detection result is reused before the applications are looked up again. */
const DETECT_TTL_MS = 60_000;

interface DetectedApp {
    readonly bundleId: string;
    readonly path: string;
    readonly iconUrl?: string;
}

let detected:
    | { readonly at: number; readonly value: Promise<ReadonlyMap<string, DetectedApp>> }
    | undefined;

/** 64px covers a 16px menu row and a 24px trigger at 2× with room to spare. */
const ICON_SIZE = 64;

/**
 * The `.icns` an application bundle ships, if it has one: the icon named by
 * `CFBundleIconFile`, or the only one in `Resources` when the plist points
 * somewhere else. An application built against an asset catalog has neither and
 * simply appears in the menu without a picture.
 */
async function icnsPathRead(bundlePath: string): Promise<string | undefined> {
    const resources = join(bundlePath, "Contents", "Resources");
    try {
        const { stdout } = await execFileAsync(
            "/usr/bin/plutil",
            [
                "-extract",
                "CFBundleIconFile",
                "raw",
                "-o",
                "-",
                join(bundlePath, "Contents", "Info.plist"),
            ],
            { timeout: 4_000 },
        );
        const named = stdout.trim();
        if (named.length > 0) {
            const path = join(resources, named.endsWith(".icns") ? named : `${named}.icns`);
            if (existsSync(path)) return path;
        }
    } catch {
        // No plist key, or an unreadable bundle. The directory listing below is
        // the answer either way.
    }
    try {
        const entries = await readdir(resources);
        const found = entries.find((entry) => entry.endsWith(".icns"));
        return found === undefined ? undefined : join(resources, found);
    } catch {
        return undefined;
    }
}

/**
 * The installed bundle's own icon as a PNG data URL.
 *
 * The artwork is read out of the bundle rather than drawn by us: these are other
 * people's icons, and an application that ships a new one gets it here for free.
 * `sips` converts the `.icns` in a subprocess, so the scan needs no window, GUI
 * session, or icon service and never blocks this process's own work.
 *
 * A failure is not worth reporting: the entry simply appears without a picture.
 */
async function iconRead(bundlePath: string): Promise<string | undefined> {
    const icns = await icnsPathRead(bundlePath);
    if (icns === undefined) return undefined;
    const output = join(
        tmpdir(),
        `happy-open-in-${createHash("sha1").update(icns).digest("hex")}.png`,
    );
    try {
        await execFileAsync(
            "/usr/bin/sips",
            [
                "-s",
                "format",
                "png",
                "--resampleHeightWidth",
                String(ICON_SIZE),
                String(ICON_SIZE),
                icns,
                "--out",
                output,
            ],
            { timeout: 10_000 },
        );
        const png = await readFile(output);
        return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
        return undefined;
    } finally {
        await rm(output, { force: true });
    }
}

/**
 * Asks Spotlight which of the known bundle ids resolve to an installed
 * application, and returns the first bundle id that does for each app, together
 * with the bundle path and its icon.
 *
 * Spotlight rather than a filesystem scan because an application bundle is not
 * required to live in /Applications, and rather than launching each candidate to
 * see whether it exists, which is what listing them is meant to avoid. It can be
 * stale in both directions, so a launch still reports its own failure: the menu
 * is a prediction, not a guarantee.
 */
async function appsDetect(): Promise<ReadonlyMap<string, DetectedApp>> {
    const entries = await Promise.all(
        OPEN_IN_APPS.map(async (candidate) => {
            for (const bundleId of candidate.bundleIds) {
                try {
                    const { stdout } = await execFileAsync(
                        "/usr/bin/mdfind",
                        [`kMDItemCFBundleIdentifier == '${bundleId}'`],
                        { timeout: 4_000 },
                    );
                    // Several copies of one application can be indexed (a
                    // release beside a beta, or a stale Trash entry); the first
                    // hit is the one LaunchServices also picks for `open -b`.
                    const path = stdout.split("\n")[0]?.trim();
                    if (path === undefined || path.length === 0) continue;
                    return [
                        candidate.id,
                        { bundleId, path, iconUrl: await iconRead(path) },
                    ] as const;
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

function detectedRead(): Promise<ReadonlyMap<string, DetectedApp>> {
    const now = Date.now();
    if (detected && now - detected.at < DETECT_TTL_MS) return detected.value;
    const value = appsDetect();
    detected = { at: now, value };
    return value;
}

/**
 * The applications currently installed, in the fixed order above so the menu
 * does not reshuffle itself between openings, each carrying its own icon. Finder
 * and Terminal ship with the system, but they are detected like everything else
 * rather than assumed.
 */
export async function openInTargetsRead(): Promise<readonly OpenInTarget[]> {
    if (process.platform !== "darwin") return [];
    const installed = await detectedRead();
    return OPEN_IN_APPS.filter((candidate) => installed.has(candidate.id)).map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        iconUrl: installed.get(candidate.id)?.iconUrl,
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
    const target = OPEN_IN_APPS.find((candidate) => candidate.id === targetId);
    if (!target) throw new Error("That application is not one this app can open projects in.");
    const bundleId = (await detectedRead()).get(target.id)?.bundleId;
    if (bundleId === undefined) throw new Error(`${target.label} does not appear to be installed.`);
    try {
        await execFileAsync("/usr/bin/open", ["-b", bundleId, directory], { timeout: 10_000 });
    } catch {
        throw new Error(`${target.label} could not open this project.`);
    }
}
