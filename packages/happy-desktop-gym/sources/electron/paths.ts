import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import type { GymOwnerMarker, GymProfile, GymRunPaths } from "./types.js";

const OWNER_MARKER = ".happy-desktop-gym-owner.json";
const RUNS_DIRECTORY = ".context/happy-desktop-gym/runs";
const SAFE_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SAFE_PROFILE_ENVIRONMENT = new Set([
    "HOME",
    "LANG",
    "LOGNAME",
    "OPENAI_API_KEY",
    "PATH",
    "RIG_CONFIGURATION_DIRECTORY",
    "RIG_DISABLE_HAPPY_SYNC",
    "RIG_GYM_DISPLAY_WORKSPACE",
    "RIG_GYM_HOME_PATH",
    "RIG_GYM_INFERENCE_URL",
    "RIG_GYM_PROVIDER_OVERRIDES",
    "RIG_GYM_RUNTIME",
    "RIG_GYM_TOKEN",
    "RIG_GYM_WORKSPACE_PATH",
    "RIG_MODEL",
    "RIG_PERMISSION_MODE",
    "RIG_PROVIDER",
    "RIG_SERVER_DIRECTORY",
    "RIG_SERVER_SOCKET_PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
]);

export function workspaceRootResolve(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export async function gymRunPathsCreate(
    profile: GymProfile,
    requestedRoot?: string,
    requestedArtifactDirectory?: string,
): Promise<{ readonly paths: GymRunPaths; readonly marker: GymOwnerMarker }> {
    const workspaceRoot = workspaceRootResolve();
    const runId = randomUUID();
    const root = resolve(
        workspaceRoot,
        requestedRoot ?? join(RUNS_DIRECTORY, `${profile}-${runId}`),
    );
    assertSafeRunRoot(root, workspaceRoot);
    const artifacts = artifactDirectoryResolve(root, workspaceRoot, requestedArtifactDirectory);
    let rootExisted = true;
    try {
        await access(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") rootExisted = false;
        else throw error;
    }
    if (rootExisted) {
        throw new Error(`Refusing to use an existing Gym root without a fresh run path: ${root}`);
    }
    await assertArtifactDirectoryFresh(artifacts, requestedArtifactDirectory !== undefined);
    await mkdir(root, { recursive: true });

    const socketPath = join(workspaceRoot, ".context", `g-${runId.slice(0, 8)}.sock`);
    try {
        await access(socketPath);
        throw new Error(`Refusing to reuse an existing Gym socket path: ${socketPath}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const marker: GymOwnerMarker = {
        kind: "happy-desktop-gym-run",
        schemaVersion: 1,
        runId,
        profile,
        createdAt: new Date().toISOString(),
        artifactDirectory: artifacts,
        socketPath,
    };
    const paths: GymRunPaths = {
        workspaceRoot,
        root,
        home: join(root, "home"),
        tmp: join(root, "tmp"),
        workspace: join(root, "workspace"),
        rigServer: join(root, "rig-server"),
        socketPath,
        electronUserData: join(root, "electron-user-data"),
        rigWorkspacePath: join(root, "workspace"),
        bin: join(root, "bin"),
        artifacts,
        marker: join(root, OWNER_MARKER),
        manifest: join(root, "manifest.json"),
        inferenceLog: join(root, "inference.ndjson"),
        streamLog: join(root, "stream-events.ndjson"),
        cluster: join(root, "session-cluster.json"),
    };
    await Promise.all([
        mkdir(paths.home, { recursive: true }),
        mkdir(paths.tmp, { recursive: true }),
        mkdir(paths.workspace, { recursive: true }),
        mkdir(paths.rigServer, { recursive: true }),
        mkdir(paths.electronUserData, { recursive: true }),
        mkdir(paths.bin, { recursive: true }),
        mkdir(paths.artifacts, { recursive: true }),
    ]);
    await writeFile(paths.marker, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    return { paths, marker };
}

export async function gymRunMarkerRead(root: string): Promise<GymOwnerMarker> {
    const marker = await readOwnerMarker(resolve(workspaceRootResolve(), root));
    if (marker === undefined) {
        throw new Error(`The requested path is not an owned Gym run: ${root}`);
    }
    return marker;
}

export async function gymRunPathsRead(root: string): Promise<GymRunPaths> {
    const rootPath = resolve(workspaceRootResolve(), root);
    const marker = await gymRunMarkerRead(rootPath);
    const workspaceRoot = workspaceRootResolve();
    assertSafeRunRoot(rootPath, workspaceRoot);
    const socketPath = marker.socketPath ?? join(rootPath, "rig-server", "server.sock");
    socketPathValidate(socketPath, workspaceRoot, rootPath);
    return {
        workspaceRoot,
        root: rootPath,
        home: join(rootPath, "home"),
        tmp: join(rootPath, "tmp"),
        workspace: join(rootPath, "workspace"),
        rigServer: join(rootPath, "rig-server"),
        socketPath,
        electronUserData: join(rootPath, "electron-user-data"),
        rigWorkspacePath: join(rootPath, "workspace"),
        bin: join(rootPath, "bin"),
        artifacts: artifactDirectoryResolve(rootPath, workspaceRoot, marker.artifactDirectory),
        marker: join(rootPath, OWNER_MARKER),
        manifest: join(rootPath, "manifest.json"),
        inferenceLog: join(rootPath, "inference.ndjson"),
        streamLog: join(rootPath, "stream-events.ndjson"),
        cluster: join(rootPath, "session-cluster.json"),
    };
}

export function gymRunPathsWithRigWorkspace(
    paths: GymRunPaths,
    rigWorkspacePath: string,
): GymRunPaths {
    return { ...paths, rigWorkspacePath };
}

export async function gymRunClean(root: string): Promise<void> {
    const resolved = resolve(workspaceRootResolve(), root);
    const marker = await gymRunMarkerRead(resolved);
    assertSafeRunRoot(resolved, workspaceRootResolve());
    if (marker.kind !== "happy-desktop-gym-run" || marker.schemaVersion !== 1) {
        throw new Error(`Unsupported Gym ownership marker at ${resolved}`);
    }
    const workspaceRoot = workspaceRootResolve();
    const socketPath = marker.socketPath ?? join(resolved, "rig-server", "server.sock");
    socketPathValidate(socketPath, workspaceRoot, resolved);
    await unlink(socketPath).catch(() => undefined);
    await rm(resolved, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
}

export async function gymRunProfileWrite(
    paths: GymRunPaths,
    values: Readonly<Record<string, string>>,
): Promise<void> {
    const unsafe = Object.keys(values).find((name) => !SAFE_PROFILE_ENVIRONMENT.has(name));
    if (unsafe !== undefined) {
        throw new Error(`Refusing to persist non-isolated Gym environment variable: ${unsafe}`);
    }
    const lines = [
        "# Generated by happy-desktop-gym. This profile is disposable and run-owned.",
        `export PATH=${shellQuote(`${paths.bin}:${SAFE_SYSTEM_PATH}`)}`,
        ...Object.entries(values)
            .filter(([name]) => name !== "PATH")
            .map(([name, value]) => `export ${name}=${shellQuote(value)}`),
        "",
    ];
    await Promise.all([
        writeFile(join(paths.home, ".zprofile"), lines.join("\n"), "utf8"),
        writeFile(join(paths.home, ".bash_profile"), lines.join("\n"), "utf8"),
    ]);
}

export async function gymRigLauncherWrite(
    paths: GymRunPaths,
    rigEntrypoint: string,
): Promise<string> {
    const launcher = join(paths.bin, "rig");
    await symlink(process.execPath, join(paths.bin, "node")).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    const source = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const allowed = new Set(${JSON.stringify([...SAFE_PROFILE_ENVIRONMENT])});
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => allowed.has(name)),
);
const result = spawnSync(process.execPath, [${JSON.stringify(rigEntrypoint)}, ...process.argv.slice(2)], {
  env: environment,
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
`;
    await writeFile(launcher, source, { encoding: "utf8", mode: 0o755 });
    return launcher;
}

export function electronEntrypointResolve(workspaceRoot = workspaceRootResolve()): {
    readonly executable: string;
    readonly main: string;
} {
    return {
        executable:
            process.env.HAPPY_DESKTOP_ELECTRON_EXECUTABLE?.trim() ||
            join(
                workspaceRoot,
                "packages",
                "happy-desktop-electron",
                "node_modules",
                ".bin",
                process.platform === "win32" ? "electron.cmd" : "electron",
            ),
        main: join(workspaceRoot, "packages", "happy-desktop-electron", "dist", "main.js"),
    };
}

export function rigEntrypointResolve(workspaceRoot = workspaceRootResolve()): string {
    const configured = process.env.HAPPY_DESKTOP_RIG_ENTRYPOINT?.trim();
    return (
        configured ||
        join(
            workspaceRoot,
            "packages",
            "happy-desktop-electron",
            "node_modules",
            "@slopus",
            "rig",
            "dist",
            "main.js",
        )
    );
}

function artifactDirectoryResolve(root: string, workspaceRoot: string, requested?: string): string {
    const directory = resolve(root, requested ?? "artifacts");
    const workspaceContext = resolve(workspaceRoot, ".context");
    if (!pathWithin(root, directory) && !pathWithin(workspaceContext, directory)) {
        throw new Error(
            "Gym artifacts must stay inside the run root or the workspace .context directory.",
        );
    }
    return directory;
}

function socketPathValidate(socketPath: string, workspaceRoot: string, root: string): void {
    const workspaceContext = resolve(workspaceRoot, ".context");
    if (
        !pathWithin(workspaceContext, socketPath) &&
        !pathWithin(join(root, "rig-server"), socketPath)
    ) {
        throw new Error(
            "Gym socket paths must stay inside the run .rig-server directory or .context.",
        );
    }
}

function pathWithin(parent: string, candidate: string): boolean {
    const value = relative(resolve(parent), resolve(candidate));
    return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function assertArtifactDirectoryFresh(directory: string, requested: boolean): Promise<void> {
    if (!requested) return;
    try {
        const entries = await readdir(directory);
        if (entries.length > 0) {
            throw new Error(
                `Refusing to populate a pre-existing nonempty Gym artifact directory: ${directory}`,
            );
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

function assertSafeRunRoot(root: string, workspaceRoot: string): void {
    const normalized = resolve(root);
    const forbidden = new Set([
        resolve("/"),
        resolve(homedir()),
        workspaceRoot,
        resolve(workspaceRoot, "packages"),
    ]);
    if (forbidden.has(normalized)) {
        throw new Error(`Refusing to use a broad or source directory as a Gym root: ${root}`);
    }
    if (!isAbsolute(normalized) || normalized.length < 8) {
        throw new Error(`Gym root must be an explicit absolute directory: ${root}`);
    }
}

async function readOwnerMarker(root: string): Promise<GymOwnerMarker | undefined> {
    try {
        await access(join(root, OWNER_MARKER));
        const parsed = JSON.parse(
            await readFile(join(root, OWNER_MARKER), "utf8"),
        ) as Partial<GymOwnerMarker>;
        if (
            parsed.kind !== "happy-desktop-gym-run" ||
            parsed.schemaVersion !== 1 ||
            typeof parsed.runId !== "string" ||
            typeof parsed.profile !== "string" ||
            typeof parsed.createdAt !== "string" ||
            (parsed.artifactDirectory !== undefined &&
                typeof parsed.artifactDirectory !== "string") ||
            (parsed.socketPath !== undefined && typeof parsed.socketPath !== "string")
        ) {
            throw new Error(`Invalid Gym ownership marker at ${root}`);
        }
        return parsed as GymOwnerMarker;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
