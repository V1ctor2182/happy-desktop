import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
    _electron as electron,
    type ElectronApplication,
    type Locator,
    type Page,
} from "playwright";

import { gymGoldReplayMaterialRead, type GymGoldReplayMaterial } from "./goldReplay.js";
import { gymLiveToolMutationLineCount } from "./inferenceServer.js";
import { electronEntrypointResolve } from "./paths.js";
import { gymProfilerArtifactReferenceRead } from "./profilerArtifacts.js";
import type { RigSessionStreamEvent, RigSessionStreamHandle } from "./rigProtocol.js";
import type { StartedRigRuntime } from "./rigRuntime.js";
import type {
    ElectronRunResult,
    GymProfilerArtifactReference,
    GymManifest,
    GymMeasurement,
    GymProject,
    GymRunPaths,
    GymScenarioMark,
    GymWorkloadName,
} from "./types.js";

interface GymProfilerBridge {
    profilerStart(request: { readonly durationMs: number }): Promise<GymProfilerSnapshot>;
    profilerStop(): Promise<GymProfilerSnapshot>;
}

interface GymProfilerArtifact {
    readonly bytes: number;
    readonly finishedAt: number;
    readonly partial: boolean;
    readonly path: string;
    readonly sessionId: string;
}

interface GymProfilerSnapshot {
    readonly artifact?: GymProfilerArtifact;
    readonly error?: string;
    readonly sessionId?: string;
    readonly startedAt?: number;
    readonly status:
        | "stopped"
        | "starting"
        | "running"
        | "stopping"
        | "partial"
        | "error"
        | "unavailable";
}

interface MixedSessionTarget {
    readonly id: string;
    readonly projectId?: string;
    readonly route: string;
    readonly scopeRoute: string;
    readonly workspaceId?: string;
    readonly workspace: boolean;
}

interface MixedSubmission {
    readonly baselineEventCount: number;
    readonly liveTool?: boolean;
    readonly marker: string;
    readonly prompt: string;
    readonly route: string;
    readonly baselineCursor?: string;
    readonly runId: string;
    readonly sessionId: string;
    readonly submittedAt: string;
}

interface SessionRunBarrier {
    readonly durationMs: number;
    readonly eventCount: number;
    readonly eventTypes: readonly string[];
    readonly finished: boolean;
    readonly sessionId: string;
    readonly streamObserved: boolean;
    readonly toolCallObserved: boolean;
}

type SessionRunEventObserver = (
    event: Record<string, unknown>,
    observedAt: string,
) => void | Promise<void>;

interface PreAttachedSessionStream {
    readonly events: readonly RigSessionStreamEvent[];
    readonly handle: RigSessionStreamHandle;
    readonly ready: Promise<void>;
    cursorCreate(): SessionStreamCursor;
}

interface SessionStreamCursor extends AsyncIterableIterator<RigSessionStreamEvent> {
    close(): void;
}

interface FileSequenceMeasurement {
    readonly durationsMs: readonly number[];
    readonly firstMs?: number;
    readonly loadingObserved: readonly boolean[];
    readonly paths: readonly string[];
    readonly reason?: string;
    readonly status: "ok" | "skipped";
    readonly warmMs?: number;
    readonly markdownFencedCodeObserved?: boolean;
}

interface ChangedFileStatsMeasurement {
    readonly deletions: string;
    readonly insertions: string;
    readonly path: string;
    readonly selectors: {
        readonly deletions: string;
        readonly insertions: string;
    };
}

interface DiffSelectionSample {
    readonly anchorConnected: boolean;
    readonly atMs: 0 | 100 | 500 | 1_000 | 2_000;
    readonly focusConnected: boolean;
    readonly inside: boolean;
    readonly length: number;
    readonly observedAtMs: number;
    readonly text: string;
}

interface DiffSelectionTimelineEvent {
    readonly anchorConnected: boolean;
    readonly focusConnected: boolean;
    readonly kind: "mutation" | "selectionchange";
    readonly tMs: number;
    readonly text: string;
}

interface DiffSelectionStabilityObservation {
    readonly finalMode?: string;
    readonly initialMode?: string;
    readonly selectionSamples: readonly DiffSelectionSample[];
    readonly selectionTimeline: readonly DiffSelectionTimelineEvent[];
    readonly stableViewMutated: boolean;
}

interface DiffSelectionMeasurement {
    readonly afterLength: number;
    readonly beforeLength: number;
    readonly durationMs: number;
    readonly inputMode: "native-dom-range";
    readonly path: string;
    readonly selectionSamples: readonly DiffSelectionSample[];
    readonly selectionTimeline: readonly DiffSelectionTimelineEvent[];
    readonly stableViewMutationObserved: boolean;
    readonly stableViewNodesPreserved: boolean;
    readonly stable: boolean;
}

interface ScrollInteractionMeasurement {
    readonly actualFraction: number;
    readonly clientHeight: number;
    readonly durationMs: number;
    readonly longTaskCount: number;
    readonly longTaskDurationMs: number;
    readonly maxScrollTop: number;
    readonly requestedFraction: number;
    readonly renderedRows: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly virtualized: boolean;
    readonly historyLoaderObserved?: boolean;
    readonly historyScrollHeightBefore?: number;
    readonly historyScrollHeightAfter?: number;
}

interface TranscriptViewportMeasurement {
    readonly clientHeight: number;
    readonly renderedRows: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly virtualized: boolean;
}

interface ScrollStabilityFrame {
    readonly anchorOffset?: number;
    readonly anchorIndex?: number;
    readonly anchorSource: "row" | "text";
    readonly bottomDistance: number;
    readonly clientHeight: number;
    readonly clientWidth: number;
    readonly elapsedMs: number;
    readonly firstRowBottom?: number;
    readonly firstRowTop?: number;
    readonly panelWidth?: number;
    readonly rowOverlapCount: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly sidebarWidth?: number;
    readonly statusGap?: number;
    readonly windowWidth: number;
}

interface ScrollStabilityPhase {
    readonly action:
        | "composer-grow"
        | "composer-shrink"
        | "panel-resize"
        | "panel-toggle"
        | "sidebar-resize"
        | "sidebar-toggle"
        | "stream-send"
        | "window-resize";
    readonly anchorIndex?: number;
    readonly anchorOffset?: number;
    readonly anchorMode: "following" | "parked";
    readonly anchorBreakCount: number;
    readonly frames: readonly ScrollStabilityFrame[];
    readonly layoutChangeObserved: boolean;
    readonly maxBottomDistance: number;
    readonly maxRowOverlapCount: number;
    readonly nonMonotonicAnchorCorrections: number;
    readonly stable: boolean;
    readonly textAnchorObserved: boolean;
}

interface ScrollStabilityMeasurement {
    readonly composerGrowth: ScrollStabilityPhase;
    readonly composerParkedGrowth: ScrollStabilityPhase;
    readonly composerParkedShrink: ScrollStabilityPhase;
    readonly composerShrink: ScrollStabilityPhase;
    readonly panelParkedResize: ScrollStabilityPhase;
    readonly panelParkedToggle: ScrollStabilityPhase;
    readonly panelResize: ScrollStabilityPhase;
    readonly sidebarParkedResize: ScrollStabilityPhase;
    readonly sidebarParkedToggle: ScrollStabilityPhase;
    readonly stable: boolean;
    readonly windowParkedResize: ScrollStabilityPhase;
}

interface StreamingScrollPhase extends ScrollStabilityPhase {
    readonly scrollTopMax?: number;
    readonly scrollTopMin?: number;
    readonly scrollTopSpread?: number;
    readonly statusGapMax?: number;
    readonly statusGapMin?: number;
    readonly statusGapSpread?: number;
    readonly statusObserved: boolean;
}

interface StreamingScrollMeasurement {
    readonly following: StreamingScrollPhase;
    readonly parked: StreamingScrollPhase;
    readonly stable: boolean;
    readonly unstick: StreamingScrollPhase;
}

export async function electronWorkloadsRun(options: {
    readonly paths: GymRunPaths;
    readonly manifest: GymManifest;
    readonly runtime: StartedRigRuntime;
    readonly projects: readonly GymProject[];
    readonly sessionIds: readonly string[];
    readonly clusterSessionIds: readonly string[];
    readonly workload: GymWorkloadName;
    readonly uiTrace: boolean;
}): Promise<ElectronRunResult> {
    const startedAt = new Date().toISOString();
    const entrypoint = electronEntrypointResolve(options.paths.workspaceRoot);
    const app = await electron.launch({
        // Electron reads userData from this command-line switch before app
        // startup; an environment label alone would not isolate app.getPath().
        args: [`--user-data-dir=${options.paths.electronUserData}`, entrypoint.main],
        cwd: options.paths.workspaceRoot,
        env: {
            ...options.runtime.environment,
            // The optimized profile is a checked-in Electron build flavor. Do
            // not point the gym at the Vite dev server: its timings include
            // development-only transforms and are not representative.
            HAPPY2_DESKTOP_PROFILE: "1",
            HAPPY2_DESKTOP_PROFILE_MODE: "optimized",
            HAPPY_DESKTOP_GYM_PROFILE: options.manifest.profile,
            HAPPY_DESKTOP_GYM_ELECTRON_USER_DATA: options.paths.electronUserData,
        },
        executablePath: entrypoint.executable,
        timeout: 60_000,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("body", { timeout: 30_000 });

    const workloads =
        options.workload === "all"
            ? ([
                  "boot",
                  "catalog-switch",
                  "long-transcript",
                  "long-chat-scroll",
                  "session-switch-load",
                  "file-switch-warm",
                  "highlight-warm",
                  "changed-files-warm",
                  "streaming",
                  "mixed-replay",
                  "memory-idle",
              ] as const)
            : [options.workload];
    const samples: GymMeasurement[] = [];
    const artifacts: string[] = [];
    let nativeProfilerRunning = false;
    let nativeProfilerAvailable = false;
    try {
        await completeOnboarding(page);
        // Let the final onboarding-to-workspace transition settle before the
        // native profiler attaches. Otherwise its route replacement callback
        // can close the capture before React's profiling handshake arrives.
        await page.waitForTimeout(500);
        for (const workload of workloads) {
            const uiTraceArtifact = join(options.paths.artifacts, `${workload}.zip`);
            let uiTraceStarted = false;
            if (options.uiTrace) {
                await page.context().tracing.start({
                    screenshots: true,
                    snapshots: true,
                    sources: false,
                });
                uiTraceStarted = true;
            }
            const sampleStarted = performance.now();
            const sampleStartedAt = new Date().toISOString();
            let measurementResult: GymMeasurement;
            try {
                measurementResult = await workloadRun(workload, page, app, {
                    ...options,
                    profilerStart: async () => {
                        const started = await nativeProfilerStart(page).catch((error: unknown) => ({
                            status: "unavailable",
                            reason: error instanceof Error ? error.message : String(error),
                        }));
                        nativeProfilerRunning =
                            started.status === "running" || started.status === "starting";
                        nativeProfilerAvailable = nativeProfilerRunning;
                    },
                    profilerActive: () => nativeProfilerAvailable,
                });
            } catch (error) {
                measurementResult = measurement(
                    workload,
                    sampleStarted,
                    {
                        error: error instanceof Error ? error.message : String(error),
                        status: "failed",
                    },
                    [],
                    sampleStartedAt,
                );
            }
            const stopped = nativeProfilerRunning ? await nativeProfilerStop(page) : undefined;
            nativeProfilerRunning = false;
            nativeProfilerAvailable = false;
            let sampleProfilerArtifacts: readonly GymProfilerArtifactReference[] = [];
            if (stopped?.artifact?.path) {
                const reference = await gymProfilerArtifactReferenceRead(stopped.artifact.path);
                sampleProfilerArtifacts = [reference];
                for (const path of [
                    reference.manifestPath,
                    reference.reportPath,
                    reference.metricsPath,
                    reference.tracePath,
                    ...reference.reactBackendProfilePaths,
                ]) {
                    if (!artifacts.includes(path)) artifacts.push(path);
                }
            }
            samples.push({ ...measurementResult, profilerArtifacts: sampleProfilerArtifacts });
            if (uiTraceStarted) {
                await page
                    .context()
                    .tracing.stop({ path: uiTraceArtifact })
                    .catch(() => undefined);
                uiTraceStarted = false;
                if (await fileExists(uiTraceArtifact)) artifacts.push(uiTraceArtifact);
            }
        }
    } finally {
        if (nativeProfilerRunning) {
            await nativeProfilerStop(page).catch(() => undefined);
        }
        await app.close();
    }
    return {
        workload: options.workload,
        startedAt,
        finishedAt: new Date().toISOString(),
        samples,
        artifacts,
    };
}

async function nativeProfilerStart(page: Page): Promise<GymProfilerSnapshot> {
    return page.evaluate(async () => {
        const bridge = (window as Window & { readonly happyDesktop?: GymProfilerBridge })
            .happyDesktop;
        if (!bridge)
            return {
                status: "unavailable",
            };
        return bridge.profilerStart({ durationMs: 10 * 60_000 });
    });
}

/**
 * Every run receives fresh Electron user data so it cannot accidentally read
 * the operator's settings. That also means the real Welcome/onboarding flow is
 * present on the first launch. Drive only the public controls here; the gym
 * must exercise the same renderer and IPC boundary as a person, not seed
 * desktop settings behind the app.
 */
async function completeOnboarding(page: Page): Promise<void> {
    const deadline = Date.now() + 45_000;
    // The welcome deck mounts after the renderer's first paint. Waiting for its
    // owned action avoids treating a not-yet-mounted button as proof that no
    // onboarding exists (which would leave the later workload on the welcome
    // screen and make every session route look broken).
    await page
        .locator('[data-happy-desktop-ui="welcome-screen"]')
        .waitFor({ state: "visible", timeout: 5_000 })
        .catch(() => undefined);
    let welcomeClicked = await clickButtonIfVisible(page, "Go Happy");
    let sawOnboarding = false;
    const clickIfVisible = async (label: string | RegExp): Promise<boolean> => {
        return clickButtonIfVisible(page, label);
    };

    while (Date.now() < deadline) {
        if (!welcomeClicked) {
            const welcomeAction = page
                .locator('[data-happy-desktop-ui="welcome-screen"] .happy2-welcome-screen__action')
                .first();
            if (
                (await welcomeAction.count()) > 0 &&
                (await welcomeAction.isVisible().catch(() => false))
            ) {
                await welcomeAction.click();
                welcomeClicked = true;
                continue;
            }
        }
        const onboarding = page.locator('[data-testid="local-onboarding-screen"]');
        const onboardingVisible =
            (await onboarding.count()) > 0 &&
            (await onboarding
                .first()
                .isVisible()
                .catch(() => false));
        if (onboardingVisible) sawOnboarding = true;
        if (sawOnboarding && !onboardingVisible) {
            // The screen is removed only after the main process has accepted
            // the last answer and the workspace gate can mount.
            return;
        }
        if (
            (await page.getByRole("button", { name: "Create profile" }).count()) > 0 &&
            (await page
                .getByRole("button", { name: "Create profile" })
                .first()
                .isVisible()
                .catch(() => false))
        ) {
            const name = page.locator('input[type="text"]').first();
            const email = page.locator('input[type="email"]').first();
            await name.waitFor({ state: "visible", timeout: 5_000 });
            await email.waitFor({ state: "visible", timeout: 5_000 });
            await name.fill("Happy Desktop Gym");
            await email.fill("gym@example.invalid");
            await clickIfVisible("Create profile");
            continue;
        }
        if (await clickIfVisible("Not now")) continue;
        if (
            (await page.getByRole("button", { name: /Choose a folder/ }).count()) > 0 ||
            (await page.getByRole("button", { name: /Install the CLI/ }).count()) > 0
        ) {
            throw new Error(
                "Happy onboarding requires a native project chooser or Rig install; the isolated Gym could not continue through the public UI.",
            );
        }
        if (!sawOnboarding && !welcomeClicked) return;
        await page.waitForTimeout(250);
    }
    const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
    throw new Error(`Timed out completing Happy onboarding: ${bodyText.slice(0, 500)}`);
}

async function clickButtonIfVisible(page: Page, label: string | RegExp): Promise<boolean> {
    const button = page.getByRole("button", { name: label }).first();
    if ((await button.count()) === 0 || !(await button.isVisible().catch(() => false)))
        return false;
    await button.click();
    await page.waitForTimeout(150);
    return true;
}

async function nativeProfilerStop(page: Page): Promise<GymProfilerSnapshot | undefined> {
    return page
        .evaluate(async () => {
            const bridge = (window as Window & { readonly happyDesktop?: GymProfilerBridge })
                .happyDesktop;
            if (!bridge) return undefined;
            return bridge.profilerStop();
        })
        .catch(() => undefined);
}

async function workloadRun(
    workload: Exclude<GymWorkloadName, "all">,
    page: Page,
    app: ElectronApplication,
    options: {
        readonly paths: GymRunPaths;
        readonly manifest: GymManifest;
        readonly runtime: StartedRigRuntime;
        readonly projects: readonly GymProject[];
        readonly sessionIds: readonly string[];
        readonly clusterSessionIds: readonly string[];
        profilerStart(): Promise<void>;
        profilerActive(): boolean;
    },
): Promise<GymMeasurement> {
    const started = performance.now();
    const scenarioStartedAt = new Date().toISOString();
    const marks: GymScenarioMark[] = [];
    const mark = (name: string): Promise<void> =>
        scenarioMark(page, marks, started, `${workload}:${name}`);
    const finish = async (details: Record<string, unknown>): Promise<GymMeasurement> => {
        await mark("scenario-end");
        return measurement(workload, started, details, marks, scenarioStartedAt);
    };

    await mark("scenario-start");
    if (workload === "boot") {
        await options.profilerStart();
        await mark("profiler-started");
        await page.waitForSelector("body");
        await mark("boot-ready");
        return finish(await performanceCapture(page, app, options.profilerActive()));
    }
    if (workload === "mixed-replay") {
        const material = await gymGoldReplayMaterialRead(options.paths.workspaceRoot);
        const targets = await mixedSessionTargetsRead(options.clusterSessionIds, options.runtime);
        if (targets.length < 3) {
            return finish({
                reason: `Mixed replay needs three durable sessions; found ${targets.length}.`,
                status: "skipped",
            });
        }
        await options.profilerStart();
        await mark("profiler-started");
        return finish(await mixedReplayRun(page, app, options, material, targets, mark));
    }
    if (workload === "long-chat-scroll" || workload === "session-switch-load") {
        const targets = await mixedSessionTargetsRead(options.clusterSessionIds, options.runtime);
        if (targets.length < 3) {
            return finish({
                reason: `${workload} needs three durable sessions; found ${targets.length}.`,
                status: "skipped",
            });
        }
        const material = await gymGoldReplayMaterialRead(options.paths.workspaceRoot);
        await options.profilerStart();
        await mark("profiler-started");
        return finish(
            workload === "long-chat-scroll"
                ? await longChatScrollRun(page, app, options, material, targets, mark)
                : await sessionSwitchLoadRun(page, app, options, material, targets, mark),
        );
    }
    const location = await firstSessionLocation(
        options.sessionIds,
        options.runtime,
        workload === "file-switch-warm" || workload === "highlight-warm",
    );
    if (workload === "catalog-switch") {
        const project = options.projects[0];
        if (project === undefined)
            return finish({ reason: "No seeded project.", status: "skipped" });
        await options.profilerStart();
        await mark("profiler-started");
        await navigateRoute(page, `/chats/local/${project.id}`);
        for (const candidate of options.projects.slice(0, 4)) {
            await navigateRoute(page, `/chats/local/${candidate.id}`);
        }
        await mark("catalog-ready");
        return finish({
            projectsVisited: Math.min(options.projects.length, 4),
            ...(await performanceCapture(page, app, options.profilerActive())),
        });
    }
    if (location === undefined)
        return finish({ reason: "No seeded session location.", status: "skipped" });
    await navigateRoute(page, location.route);
    await waitForSessionUiReady(page, location.route, location.sessionId);
    await mark("route-ready");
    await options.profilerStart();
    await mark("profiler-started");
    if (workload === "long-transcript") {
        await waitForAny(page, [
            '[data-happy-desktop-ui="conversation"]',
            '[data-happy-desktop-ui="composer"]',
        ]);
        await page.locator("body").evaluate((body) => {
            for (const element of body.querySelectorAll<HTMLElement>(
                '[data-happy-desktop-ui="conversation"], [data-happy-desktop-ui="conversation-scroll"]',
            )) {
                element.scrollTop = element.scrollHeight;
                element.scrollTop = 0;
            }
        });
        await mark("transcript-ready");
        return finish(await performanceCapture(page, app, options.profilerActive()));
    }
    if (
        workload === "file-switch-warm" ||
        workload === "highlight-warm" ||
        workload === "changed-files-warm"
    ) {
        const details = await fileSwitch(
            page,
            workload === "highlight-warm"
                ? "highlight"
                : workload === "changed-files-warm"
                  ? "changed"
                  : "document",
        );
        await mark("file-switch-complete");
        return finish({
            ...details,
            ...(workload === "highlight-warm"
                ? { cacheEvidence: cacheEvidence("highlight-cache", details) }
                : {}),
            ...(await performanceCapture(page, app, options.profilerActive())),
        });
    }
    if (workload === "streaming") {
        const composer = page.locator('[data-happy-desktop-ui="composer-textarea"]').first();
        await composer.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
        if ((await composer.count()) === 0 || !(await composer.isVisible().catch(() => false))) {
            return finish({ reason: "The composer is not mounted.", status: "skipped" });
        }
        const streamingScroll = await streamingScrollRun(page, composer, mark);
        if (!streamingScroll.stable) {
            throw new Error(
                `Real streaming scroll stability failed: ${JSON.stringify(streamingScroll)}`,
            );
        }
        await mark("stream-complete");
        return finish({
            streamingScroll,
            ...(await performanceCapture(page, app, options.profilerActive())),
        });
    }
    if (workload === "memory-idle") {
        const before = await performanceCapture(page, app, options.profilerActive());
        for (let index = 0; index < 3; index += 1) {
            await navigateRoute(page, location.route);
            await waitForAny(page, ["body"]);
            await mark(`memory-cycle-${index + 1}`);
        }
        const after = await performanceCapture(page, app, options.profilerActive());
        return finish({ before, after });
    }
    return finish({ reason: "No implementation for workload.", status: "skipped" });
}

async function fileSwitch(
    page: Page,
    mode: "changed" | "document" | "highlight",
): Promise<FileSequenceMeasurement> {
    const paths =
        mode === "highlight"
            ? ["README.md", "src/long-transcript.md", "README.md"]
            : mode === "changed"
              ? [
                    "src/changes/modified/deep/large-modified.md",
                    "src/changes/added/deep/added-large.md",
                    "src/changes/renamed/renamed-source.ts",
                    "src/changes/modified/deep/large-modified.md",
                    "src/changes/added/deep/added-large.md",
                ]
              : ["README.md", "src/long-transcript.md", "README.md"];
    const sequence = await fileSwitchSequence(
        page,
        paths,
        undefined,
        mode === "changed" ? "changed" : "all",
    );
    if (mode === "highlight" && sequence.status === "ok") {
        if (!sequence.markdownFencedCodeObserved) {
            throw new Error(
                "Highlight lane completed without observing the README Markdown fenced-code Pierre barrier.",
            );
        }
    }
    return sequence;
}

async function fileSwitchSequence(
    page: Page,
    paths: readonly string[],
    onInteraction?: (
        path: string,
        index: number,
        durationMs: number,
        timestamps: { readonly finishedAt: string; readonly startedAt: string },
    ) => Promise<void>,
    scope: "all" | "changed" = "all",
    beforeOpen?: (path: string, index: number) => Promise<void>,
    afterOpen?: (path: string, index: number) => Promise<void>,
): Promise<FileSequenceMeasurement> {
    const showPanel = page.locator('button[aria-label="Show panel"]').first();
    if (await showPanel.isVisible().catch(() => false)) await showPanel.click();
    const filesTab = page.getByText("Files", { exact: true }).first();
    await filesTab.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    if ((await filesTab.count()) === 0 || !(await filesTab.isVisible().catch(() => false)))
        return {
            durationsMs: [],
            loadingObserved: [],
            paths,
            reason: "Files tab unavailable",
            status: "skipped",
        };
    await filesTab.click();
    const scopeButton = page
        .locator('[data-happy-desktop-ui="file-browser-scope"]')
        .filter({ hasText: scope === "all" ? "All files" : "Changed" })
        .first();
    if ((await scopeButton.count()) > 0) await scopeButton.click().catch(() => undefined);
    if (scope === "changed") {
        const listFiles = page.locator('button[aria-label="List files"]').first();
        if (
            (await listFiles.count()) > 0 &&
            (await listFiles.getAttribute("aria-pressed")) !== "true"
        )
            await listFiles.click().catch(() => undefined);
    }
    try {
        await page.waitForSelector('[data-happy-desktop-ui="file-tree"][data-virtualized]', {
            timeout: 20_000,
        });
    } catch (error) {
        const browserText = await page
            .locator('[data-happy-desktop-ui="file-browser"]')
            .innerText()
            .catch(() => "");
        throw new Error(
            `File tree did not mount for ${scope} scope: ` +
                `${error instanceof Error ? error.message : String(error)} ` +
                `browser=${browserText.slice(0, 1_000)}`,
        );
    }
    const durations: number[] = [];
    const loadingObserved: boolean[] = [];
    const seenPaths = new Set<string>();
    let markdownFencedCodeObserved = false;
    for (const [index, path] of paths.entries()) {
        const row = await fileTreeRowEnsureMounted(page, path);
        if (row === undefined) {
            return {
                durationsMs: durations,
                loadingObserved,
                paths,
                reason: `File row not visible: ${path}`,
                status: "skipped",
            };
        }
        const started = performance.now();
        const startedAt = new Date().toISOString();
        const warmReturn = seenPaths.has(path);
        const loadingObserverKey = `__happyDesktopGymFileLoadingObserver_${String(index)}`;
        await fileLoadingObserverStart(page, loadingObserverKey);
        let observedLoading = false;
        let beforeOpenDurationMs = 0;
        try {
            await row.click();
            if (beforeOpen !== undefined) {
                const beforeOpenStarted = performance.now();
                await beforeOpen(path, index);
                beforeOpenDurationMs = performance.now() - beforeOpenStarted;
            }
            const contentSelector =
                scope === "changed"
                    ? '[data-happy-desktop-ui="changed-file-diff-body"]'
                    : '[data-happy-desktop-ui="file-editor"]';
            await page.waitForSelector(contentSelector, { timeout: 20_000 });
            await page.waitForFunction(
                (expected) => {
                    const tab = [
                        ...document.querySelectorAll(
                            '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                        ),
                    ].find((candidate) => candidate.textContent?.includes(expected) === true);
                    const pane = tab?.closest('[data-happy-desktop-ui="tabbed-pane"]');
                    return (
                        pane !== null &&
                        (pane
                            ?.querySelector('[data-happy-desktop-ui="file-editor-name"]')
                            ?.textContent?.includes(expected) === true ||
                            pane
                                ?.querySelector('[data-happy-desktop-ui="changed-file-diff"]')
                                ?.getAttribute("aria-label")
                                ?.includes(expected) === true)
                    );
                },
                path.split("/").at(-1) ?? path,
                { timeout: 30_000 },
            );
            await afterOpen?.(path, index);
            if (scope === "all" && /\.(?:md|markdown|mdx)$/iu.test(path)) {
                const fenced = path === "README.md";
                await markdownCompletionBarrier(page, fenced, path.split("/").at(-1) ?? path);
                markdownFencedCodeObserved ||= fenced;
            }
            observedLoading = await fileLoadingObserverStop(page, loadingObserverKey);
        } catch (error) {
            await fileLoadingObserverStop(page, loadingObserverKey).catch(() => undefined);
            throw error;
        }
        loadingObserved.push(observedLoading);
        if (warmReturn && observedLoading) {
            throw new Error(
                `Warm file revisit displayed Loading file… for ${path} at sequence index ${index}.`,
            );
        }
        seenPaths.add(path);
        const durationMs = Math.max(0, performance.now() - started - beforeOpenDurationMs);
        const finishedAt = new Date().toISOString();
        durations.push(durationMs);
        await onInteraction?.(path, index, durationMs, { finishedAt, startedAt });
    }
    return {
        durationsMs: durations,
        firstMs: durations[0],
        loadingObserved,
        paths,
        status: "ok",
        warmMs: durations.at(-1),
        markdownFencedCodeObserved,
    };
}

async function fileLoadingObserverStart(page: Page, key: string): Promise<void> {
    await page.evaluate((observerKey) => {
        type FileLoadingObserverState = {
            readonly observer: MutationObserver;
            observed: boolean;
        };
        const windowWithObserver = window as Window & {
            __happyDesktopGymFileLoadingObservers?: Record<
                string,
                FileLoadingObserverState | undefined
            >;
        };
        const observers = (windowWithObserver.__happyDesktopGymFileLoadingObservers ??= {});
        observers[observerKey]?.observer.disconnect();
        const state: FileLoadingObserverState = {
            observed: false,
            observer: new MutationObserver(() => {
                const selectedTab = document.querySelector<HTMLElement>(
                    '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                );
                const pane = selectedTab?.closest<HTMLElement>(
                    '[data-happy-desktop-ui="tabbed-pane"]',
                );
                state.observed ||=
                    pane?.querySelector('[data-happy-desktop-ui="file-preview-loading"]') !==
                        null || pane?.textContent?.includes("Loading file…") === true;
            }),
        };
        const selectedTab = document.querySelector<HTMLElement>(
            '[data-happy-desktop-ui="tab"][aria-selected="true"]',
        );
        const pane = selectedTab?.closest<HTMLElement>('[data-happy-desktop-ui="tabbed-pane"]');
        state.observed =
            pane?.querySelector('[data-happy-desktop-ui="file-preview-loading"]') !== null ||
            pane?.textContent?.includes("Loading file…") === true;
        observers[observerKey] = state;
        state.observer.observe(document.documentElement ?? document, {
            attributes: true,
            attributeFilter: ["aria-selected", "data-happy-desktop-ui"],
            characterData: true,
            childList: true,
            subtree: true,
        });
    }, key);
}

async function fileLoadingObserverStop(page: Page, key: string): Promise<boolean> {
    return page.evaluate((observerKey) => {
        type FileLoadingObserverState = {
            readonly observer: MutationObserver;
            observed: boolean;
        };
        const windowWithObserver = window as Window & {
            __happyDesktopGymFileLoadingObservers?: Record<
                string,
                FileLoadingObserverState | undefined
            >;
        };
        const observers = windowWithObserver.__happyDesktopGymFileLoadingObservers;
        const state = observers?.[observerKey];
        if (state === undefined) return false;
        state.observer.disconnect();
        delete observers?.[observerKey];
        return state.observed;
    }, key);
}

async function fileTreeRowEnsureMounted(page: Page, path: string): Promise<Locator | undefined> {
    const row = page.locator(`[data-happy-desktop-ui="file-tree-row"][data-path="${path}"]`);
    const tree = page.locator('[data-happy-desktop-ui="file-tree"][data-virtualized]').first();
    for (let fraction = 0; fraction <= 1 && (await row.count()) === 0; fraction += 0.1) {
        await tree
            .evaluate(async (element, offset) => {
                const scroll = element as HTMLElement;
                scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * offset;
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }, fraction)
            .catch(() => undefined);
    }
    if ((await row.count()) === 0) {
        await row.waitFor({ state: "attached", timeout: 5_000 }).catch(() => undefined);
    }
    if ((await row.count()) === 0) return undefined;
    await row.scrollIntoViewIfNeeded().catch(() => undefined);
    return row;
}

async function changedFileStatsBarrier(
    page: Page,
    path: string,
    expectedInsertions: number,
    expectedDeletions: number,
): Promise<ChangedFileStatsMeasurement> {
    const row = await fileTreeRowEnsureMounted(page, path);
    if (row === undefined) {
        throw new Error(`Changed-file virtual row did not mount for ${path}.`);
    }
    const expected = {
        deletions: `−${String(expectedDeletions)}`,
        insertions: `+${String(expectedInsertions)}`,
        path,
    };
    try {
        await page.waitForFunction(
            ({ deletions, insertions, path: expectedPath }) => {
                const row = [
                    ...document.querySelectorAll<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-row"][data-path]',
                    ),
                ].find((candidate) => candidate.dataset.path === expectedPath);
                if (row === undefined) return false;
                // The data attributes are the explicit contract when present. The
                // class selectors keep this gym compatible with the currently
                // shipped FileTree, which exposes the same two spans under the
                // file-tree-stat marker.
                const insertion =
                    row.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-insertions"]',
                    ) ?? row.querySelector<HTMLElement>(".happy2-file-tree__stat-added");
                const deletion =
                    row.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-deletions"]',
                    ) ?? row.querySelector<HTMLElement>(".happy2-file-tree__stat-deleted");
                return (
                    insertion?.textContent?.trim() === insertions &&
                    deletion?.textContent?.trim() === deletions
                );
            },
            expected,
            { timeout: 90_000 },
        );
    } catch (error) {
        const actual = await page
            .evaluate((expectedPath) => {
                const row = [
                    ...document.querySelectorAll<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-row"][data-path]',
                    ),
                ].find((candidate) => candidate.dataset.path === expectedPath);
                const insertion =
                    row?.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-insertions"]',
                    ) ?? row?.querySelector<HTMLElement>(".happy2-file-tree__stat-added");
                const deletion =
                    row?.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="file-tree-deletions"]',
                    ) ?? row?.querySelector<HTMLElement>(".happy2-file-tree__stat-deleted");
                return {
                    rowText: row?.textContent?.trim(),
                    insertion: insertion?.textContent?.trim(),
                    deletion: deletion?.textContent?.trim(),
                    summary: document
                        .querySelector('[data-happy-desktop-ui="file-browser-summary"]')
                        ?.textContent?.trim(),
                };
            }, path)
            .catch(() => undefined);
        throw new Error(
            `Changed-file stats barrier timed out for ${path}: ` +
                `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)} ` +
                `${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const observed = await page.evaluate((expectedPath) => {
        const row = [
            ...document.querySelectorAll<HTMLElement>(
                '[data-happy-desktop-ui="file-tree-row"][data-path]',
            ),
        ].find((candidate) => candidate.dataset.path === expectedPath);
        if (row === undefined) return undefined;
        const insertion =
            row.querySelector<HTMLElement>('[data-happy-desktop-ui="file-tree-insertions"]') ??
            row.querySelector<HTMLElement>(".happy2-file-tree__stat-added");
        const deletion =
            row.querySelector<HTMLElement>('[data-happy-desktop-ui="file-tree-deletions"]') ??
            row.querySelector<HTMLElement>(".happy2-file-tree__stat-deleted");
        if (insertion === null || deletion === null) return undefined;
        return {
            deletions: deletion.textContent?.trim() ?? "",
            insertions: insertion.textContent?.trim() ?? "",
            selectors: {
                deletions:
                    deletion.getAttribute("data-happy-desktop-ui") ??
                    ".happy2-file-tree__stat-deleted",
                insertions:
                    insertion.getAttribute("data-happy-desktop-ui") ??
                    ".happy2-file-tree__stat-added",
            },
        };
    }, path);
    if (observed === undefined) {
        throw new Error(`Changed-file stats disappeared after the barrier for ${path}.`);
    }
    return { ...observed, path };
}

async function changedFileSelectionBarrier(
    page: Page,
    path: string,
    alreadyOpen = false,
): Promise<DiffSelectionMeasurement> {
    if (!alreadyOpen) {
        const row = await fileTreeRowEnsureMounted(page, path);
        if (row === undefined)
            throw new Error(`Changed-file virtual row did not mount for ${path}.`);
        await row.click();
    }
    const started = performance.now();
    const observation = await diffSelectionStabilityObserve(page, path);
    const before = observation.selectionSamples[0];
    const after = observation.selectionSamples.at(-1);
    if (before === undefined || after === undefined || before.length < 2)
        throw new Error(`Changed-file diff selection did not start for ${path}.`);
    const stableViewNodesPreserved =
        observation.selectionSamples.length === 5 &&
        observation.selectionSamples.every(
            (sample) =>
                sample.text === before.text &&
                sample.length === before.length &&
                sample.inside &&
                sample.anchorConnected &&
                sample.focusConnected,
        );
    if (
        observation.initialMode !== observation.finalMode ||
        observation.stableViewMutated ||
        !stableViewNodesPreserved
    ) {
        throw new Error(
            `Settled changed-file diff identity was unstable for ${path}: ` +
                `mode=${String(observation.finalMode)} expectedMode=${observation.initialMode} ` +
                `stableViewMutation=${String(observation.stableViewMutated)} ` +
                `nodesPreserved=${String(stableViewNodesPreserved)} ` +
                `before=${String(before.length)} after=${String(after.length)}.`,
        );
    }
    return {
        afterLength: after.length,
        beforeLength: before.length,
        durationMs: performance.now() - started,
        inputMode: "native-dom-range",
        path,
        selectionSamples: observation.selectionSamples,
        selectionTimeline: observation.selectionTimeline,
        stable: stableViewNodesPreserved,
        stableViewMutationObserved: observation.stableViewMutated,
        stableViewNodesPreserved,
    };
}

async function diffSelectionStabilityObserve(
    page: Page,
    path: string,
): Promise<DiffSelectionStabilityObservation> {
    const expectedFileName = path.split("/").at(-1) ?? path;
    return page.evaluate(
        async ({ expected }) =>
            new Promise<DiffSelectionStabilityObservation>((resolve, reject) => {
                const sampleTimes = [0, 100, 500, 1_000, 2_000] as const;
                const samples: DiffSelectionSample[] = [];
                const timeline: DiffSelectionTimelineEvent[] = [];
                let completed = false;
                let diff: HTMLElement | undefined;
                let documentObserver: MutationObserver | undefined;
                let stableObserver: MutationObserver | undefined;
                let selectedAt = 0;
                let initialMode: string | undefined;
                let stableViewMutated = false;
                let selectionStarted = false;
                let staged = false;
                const selectionAbort = new AbortController();
                let stageTimeout = 0;

                documentObserver = new MutationObserver(() => {
                    if (staged || completed) return;
                    const selectedTab = document.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                    );
                    const pane = selectedTab?.closest<HTMLElement>(
                        '[data-happy-desktop-ui="tabbed-pane"]',
                    );
                    const candidateDiff = pane?.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="changed-file-diff"]',
                    );
                    if (candidateDiff?.getAttribute("aria-label")?.includes(expected) !== true)
                        return;
                    const renderer = candidateDiff.querySelector<HTMLElement>("diffs-container");
                    const candidateRoot = renderer?.shadowRoot;
                    if (
                        renderer === null ||
                        renderer === undefined ||
                        candidateRoot === null ||
                        candidateRoot === undefined
                    )
                        return;
                    let target:
                        | {
                              readonly end: number;
                              readonly start: number;
                              readonly text: Text;
                          }
                        | undefined;
                    for (const line of candidateRoot.querySelectorAll<HTMLElement>(
                        "[data-code] [data-line][data-line-index]",
                    )) {
                        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                        while (walker.nextNode()) {
                            const text = walker.currentNode as Text;
                            const start = text.data.search(/\S/u);
                            if (start < 0 || text.data.length - start < 2) continue;
                            target = {
                                end: Math.min(text.data.length, start + 16),
                                start,
                                text,
                            };
                            break;
                        }
                        if (target !== undefined) break;
                    }
                    if (target === undefined) return;
                    staged = true;
                    diff = candidateDiff;
                    initialMode = candidateDiff.dataset.mode;
                    documentObserver?.disconnect();
                    {
                        const settledTarget = target;
                        const selection = window.getSelection();
                        if (selection === null) return;
                        selectionStarted = true;
                        selectedAt = performance.now();
                        document.addEventListener(
                            "selectionchange",
                            () => {
                                if (timeline.length >= 64) return;
                                const current = window.getSelection();
                                const anchor = current?.anchorNode;
                                const focus = current?.focusNode;
                                timeline.push({
                                    anchorConnected:
                                        anchor !== null &&
                                        anchor !== undefined &&
                                        anchor.isConnected &&
                                        candidateRoot.contains(anchor),
                                    focusConnected:
                                        focus !== null &&
                                        focus !== undefined &&
                                        focus.isConnected &&
                                        candidateRoot.contains(focus),
                                    kind: "selectionchange",
                                    tMs: Math.max(0, performance.now() - selectedAt),
                                    text: current?.toString() ?? "",
                                });
                            },
                            { signal: selectionAbort.signal },
                        );
                        stableObserver = new MutationObserver(() => {
                            stableViewMutated = true;
                            if (timeline.length >= 64) return;
                            const current = window.getSelection();
                            const anchor = current?.anchorNode;
                            const focus = current?.focusNode;
                            timeline.push({
                                anchorConnected:
                                    anchor !== null &&
                                    anchor !== undefined &&
                                    anchor.isConnected &&
                                    candidateRoot.contains(anchor),
                                focusConnected:
                                    focus !== null &&
                                    focus !== undefined &&
                                    focus.isConnected &&
                                    candidateRoot.contains(focus),
                                kind: "mutation",
                                tMs: Math.max(0, performance.now() - selectedAt),
                                text: current?.toString() ?? "",
                            });
                        });
                        stableObserver.observe(candidateRoot, {
                            characterData: true,
                            childList: true,
                            subtree: true,
                        });
                        renderer.dispatchEvent(
                            new PointerEvent("pointerdown", {
                                bubbles: true,
                                button: 0,
                                composed: true,
                                pointerId: 1,
                                pointerType: "mouse",
                            }),
                        );
                        selection.setBaseAndExtent(
                            settledTarget.text,
                            settledTarget.start,
                            settledTarget.text,
                            settledTarget.end,
                        );
                        document.dispatchEvent(new Event("selectionchange"));
                        renderer.dispatchEvent(
                            new PointerEvent("pointerup", {
                                bubbles: true,
                                button: 0,
                                composed: true,
                                pointerId: 1,
                                pointerType: "mouse",
                            }),
                        );
                        for (const atMs of sampleTimes) {
                            if (atMs === 0) {
                                const current = window.getSelection();
                                const anchor = current?.anchorNode;
                                const focus = current?.focusNode;
                                const anchorConnected =
                                    anchor !== null &&
                                    anchor !== undefined &&
                                    anchor.isConnected &&
                                    candidateRoot.contains(anchor);
                                const focusConnected =
                                    focus !== null &&
                                    focus !== undefined &&
                                    focus.isConnected &&
                                    candidateRoot.contains(focus);
                                const text = current?.toString() ?? "";
                                samples.push({
                                    anchorConnected,
                                    atMs,
                                    focusConnected,
                                    inside: anchorConnected && focusConnected,
                                    length: text.length,
                                    observedAtMs: Math.max(0, performance.now() - selectedAt),
                                    text,
                                });
                                continue;
                            }
                            window.setTimeout(() => {
                                const current = window.getSelection();
                                const anchor = current?.anchorNode;
                                const focus = current?.focusNode;
                                const anchorConnected =
                                    anchor !== null &&
                                    anchor !== undefined &&
                                    anchor.isConnected &&
                                    candidateRoot.contains(anchor);
                                const focusConnected =
                                    focus !== null &&
                                    focus !== undefined &&
                                    focus.isConnected &&
                                    candidateRoot.contains(focus);
                                const text = current?.toString() ?? "";
                                samples.push({
                                    anchorConnected,
                                    atMs,
                                    focusConnected,
                                    inside: anchorConnected && focusConnected,
                                    length: text.length,
                                    observedAtMs: Math.max(0, performance.now() - selectedAt),
                                    text,
                                });
                                if (atMs !== 2_000 || completed) return;
                                completed = true;
                                documentObserver?.disconnect();
                                stableObserver?.disconnect();
                                selectionAbort.abort();
                                window.clearTimeout(stageTimeout);
                                resolve({
                                    finalMode: diff?.dataset.mode,
                                    initialMode,
                                    selectionSamples: samples,
                                    selectionTimeline: timeline,
                                    stableViewMutated,
                                });
                            }, atMs);
                        }
                    }
                });
                documentObserver.observe(document.documentElement ?? document, {
                    attributes: true,
                    attributeFilter: [
                        "aria-selected",
                        "data-happy-desktop-gym-selection-arm",
                        "data-mode",
                    ],
                    childList: true,
                    subtree: true,
                });
                stageTimeout = window.setTimeout(() => {
                    if (selectionStarted || completed) return;
                    completed = true;
                    documentObserver?.disconnect();
                    stableObserver?.disconnect();
                    selectionAbort.abort();
                    reject(
                        new Error(`Selectable settled diff text did not appear for ${expected}.`),
                    );
                }, 30_000);
                document.documentElement?.toggleAttribute("data-happy-desktop-gym-selection-arm");
                document.documentElement?.toggleAttribute("data-happy-desktop-gym-selection-arm");
            }),
        { expected: expectedFileName },
    );
}

async function markdownCompletionBarrier(
    page: Page,
    requireFence: boolean,
    expectedTabLabel: string,
): Promise<void> {
    try {
        await page.waitForFunction(
            (expected) => {
                const tab = [
                    ...document.querySelectorAll(
                        '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                    ),
                ].find((candidate) => candidate.textContent?.includes(expected) === true);
                const pane = tab?.closest('[data-happy-desktop-ui="tabbed-pane"]');
                return pane?.querySelector('[data-happy-desktop-ui="markdown-document"]') !== null;
            },
            expectedTabLabel,
            { timeout: 90_000 },
        );
    } catch (error) {
        const state = await page
            .evaluate((expected) => {
                const tabs = [
                    ...document.querySelectorAll(
                        '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                    ),
                ].map((tab) => tab.textContent?.trim());
                const tab = [
                    ...document.querySelectorAll(
                        '[data-happy-desktop-ui="tab"][aria-selected="true"]',
                    ),
                ].find((candidate) => candidate.textContent?.includes(expected) === true);
                const pane = tab?.closest('[data-happy-desktop-ui="tabbed-pane"]');
                return {
                    activeTabs: tabs,
                    editorName: pane?.querySelector('[data-happy-desktop-ui="file-editor-name"]')
                        ?.textContent,
                    editorText: pane
                        ?.querySelector('[data-happy-desktop-ui="file-editor"]')
                        ?.textContent?.slice(0, 500),
                    markdownCount:
                        pane?.querySelectorAll('[data-happy-desktop-ui="markdown-document"]')
                            .length ?? 0,
                };
            }, expectedTabLabel)
            .catch(() => undefined);
        throw new Error(
            `Markdown completion barrier did not mount for ${expectedTabLabel}: ${JSON.stringify(state)}; ` +
                `${error instanceof Error ? error.message : String(error)}`,
        );
    }
    await page.waitForFunction(
        ({ expected, mustHaveFence }) => {
            const tab = [
                ...document.querySelectorAll('[data-happy-desktop-ui="tab"][aria-selected="true"]'),
            ].find((candidate) => candidate.textContent?.includes(expected) === true);
            const pane = tab?.closest('[data-happy-desktop-ui="tabbed-pane"]');
            const documentRoot = pane?.querySelector('[data-happy-desktop-ui="markdown-document"]');
            const fence = documentRoot?.querySelector(
                '[data-happy-desktop-ui="markdown-document-code"]',
            );
            const renderer = fence?.querySelector("diffs-container") as HTMLElement | null;
            if (!mustHaveFence) return (documentRoot?.textContent?.trim().length ?? 0) > 0;
            return (
                fence !== null &&
                renderer !== null &&
                (renderer.shadowRoot?.textContent?.trim().length ?? 0) > 0
            );
        },
        { expected: expectedTabLabel, mustHaveFence: requireFence },
        { timeout: 90_000 },
    );
}

async function concurrentSubmissions(
    client: StartedRigRuntime["client"],
    material: GymGoldReplayMaterial,
    targets: readonly MixedSessionTarget[],
    label: string,
): Promise<{
    readonly collectors: ReadonlyMap<string, PreAttachedSessionStream>;
    readonly durationMs: number;
    readonly submissions: readonly MixedSubmission[];
}> {
    const baselineResults = await Promise.all(
        targets.map(async (target) => (await client.events(target.id)).events),
    );
    const collectors = new Map<string, PreAttachedSessionStream>();
    await Promise.all(
        targets.map(async (target, index) => {
            const baseline = baselineResults[index] ?? [];
            collectors.set(
                target.id,
                await sessionStreamCollectorCreate(
                    client,
                    target.id,
                    eventCursorRead(baseline.at(-1)),
                ),
            );
        }),
    );
    const started = performance.now();
    const submissions = await Promise.all(
        targets.map(async (target, index): Promise<MixedSubmission> => {
            const materialMessage = material.messages[index % material.messages.length]!;
            const baseline = baselineResults[index] ?? [];
            const baselineEventCount = baseline.length;
            const marker = `gym-${label}-${String(index + 1)}-${target.id.slice(-6)}-e${baselineEventCount}`;
            const prompt = `${materialMessage.text}\n\n[${marker}]`;
            const submittedAt = new Date().toISOString();
            const submitted = await client.submitMessage(target.id, prompt);
            if (submitted.runId === undefined) {
                throw new Error(`Rig did not return a run id for ${label} session ${target.id}.`);
            }
            return {
                baselineEventCount,
                baselineCursor: eventCursorRead(baseline.at(-1)),
                marker,
                prompt,
                route: target.route,
                runId: submitted.runId,
                sessionId: target.id,
                submittedAt,
            };
        }),
    );
    return { collectors, durationMs: performance.now() - started, submissions };
}

async function sessionStreamCollectorCreate(
    client: StartedRigRuntime["client"],
    sessionId: string,
    after: string | undefined,
): Promise<PreAttachedSessionStream> {
    const events: RigSessionStreamEvent[] = [];
    const cursorWakeups = new Set<() => void>();
    const handle = client.sessionStream(sessionId, after, async (event) => {
        events.push(event);
        for (const wake of cursorWakeups) wake();
    });
    // Do not submit until the daemon has accepted this SSE connection. The
    // `after` cursor is still the recovery boundary for events that arrive
    // between the durable snapshot and hello.
    await handle.ready;
    const cursorCreate = (): SessionStreamCursor => {
        let index = 0;
        let closed = false;
        let wakeup: (() => void) | undefined;
        const notify = (): void => {
            const resolve = wakeup;
            wakeup = undefined;
            resolve?.();
        };
        const close = (): void => {
            if (closed) return;
            closed = true;
            cursorWakeups.delete(notify);
            notify();
        };
        const cursor: SessionStreamCursor = {
            async next(): Promise<IteratorResult<RigSessionStreamEvent>> {
                if (index < events.length) {
                    return { done: false, value: events[index++]! };
                }
                if (closed) return { done: true, value: undefined };
                await new Promise<void>((resolve) => {
                    wakeup = resolve;
                });
                return this.next();
            },
            async return(): Promise<IteratorResult<RigSessionStreamEvent>> {
                close();
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator](): SessionStreamCursor {
                return this;
            },
            close,
        };
        cursorWakeups.add(notify);
        return cursor;
    };
    return {
        events,
        handle,
        ready: handle.ready,
        cursorCreate,
    };
}

async function longChatScrollRun(
    page: Page,
    app: ElectronApplication,
    options: {
        readonly runtime: StartedRigRuntime;
        readonly sessionIds: readonly string[];
        profilerActive(): boolean;
    },
    material: GymGoldReplayMaterial,
    targets: readonly MixedSessionTarget[],
    mark: (name: string) => Promise<void>,
): Promise<Record<string, unknown>> {
    const before = await performanceCapture(page, app, options.profilerActive());
    const submission = await concurrentSubmissions(
        options.runtime.client,
        material,
        targets,
        "long-chat-scroll",
    );
    await mark("concurrent-submissions-accepted");
    const barriers = submission.submissions.map((entry) =>
        sessionRunBarrierWait(
            options.runtime.client,
            entry,
            undefined,
            submission.collectors.get(entry.sessionId),
        ),
    );
    const target = targets[0]!;
    await navigateRoute(page, target.route);
    await waitForSessionUiReady(page, target.route, target.id);
    const initialViewport = await transcriptViewportRead(page);
    await mark("virtualized-transcript-ready");
    const scrollInteractions = await transcriptScrollSequence(
        page,
        [1, 0, 0.78, 0.22, 0.92, 0.08, 0.64, 0],
        mark,
    );
    const historyInteractions = scrollInteractions.filter(
        (interaction) => interaction.requestedFraction === 0,
    );
    const historyGrowthObserved = historyInteractions.some(
        (interaction) =>
            interaction.historyLoaderObserved === true ||
            (interaction.historyScrollHeightAfter ?? 0) >
                (interaction.historyScrollHeightBefore ?? Number.POSITIVE_INFINITY),
    );
    if (!historyGrowthObserved) {
        throw new Error(
            "Long-chat scroll did not observe the real earlier-transcript loader or scroll-height growth.",
        );
    }
    const durableBarriers = await Promise.all(barriers);
    await mark("durable-stream-barriers-complete");
    const finalViewport = await transcriptViewportRead(page);
    const after = await performanceCapture(page, app, options.profilerActive());
    return {
        after,
        before,
        durableBarriers,
        finalViewport,
        goldReplay: goldReplayDetails(material),
        responsiveness: responsivenessDetails(options.profilerActive()),
        scrollInteractions,
        historyGrowthObserved,
        submissions: {
            count: submission.submissions.length,
            concurrent: true,
            durationMs: submission.durationMs,
            runIds: submission.submissions.map((entry) => entry.runId),
        },
        transcript: {
            initialViewport,
            virtualizationExercised:
                initialViewport.virtualized &&
                initialViewport.scrollHeight > initialViewport.clientHeight,
        },
    };
}

async function sessionSwitchLoadRun(
    page: Page,
    app: ElectronApplication,
    options: {
        readonly runtime: StartedRigRuntime;
        readonly sessionIds: readonly string[];
        profilerActive(): boolean;
    },
    material: GymGoldReplayMaterial,
    targets: readonly MixedSessionTarget[],
    mark: (name: string) => Promise<void>,
): Promise<Record<string, unknown>> {
    const before = await performanceCapture(page, app, options.profilerActive());
    const submission = await concurrentSubmissions(
        options.runtime.client,
        material,
        targets,
        "session-switch-load",
    );
    await mark("concurrent-submissions-accepted");
    const barriers = submission.submissions.map((entry) =>
        sessionRunBarrierWait(
            options.runtime.client,
            entry,
            undefined,
            submission.collectors.get(entry.sessionId),
        ),
    );
    const sessionSwitches = await sessionSwitchSequence(
        page,
        targets,
        [0, 1, 2, 0, 3, 1, 2, 0, 2, 3, 1, 0],
        mark,
        "load-session-switch",
    );
    const durableBarriers = await Promise.all(barriers);
    await mark("durable-stream-barriers-complete");
    const after = await performanceCapture(page, app, options.profilerActive());
    return {
        after,
        before,
        durableBarriers,
        goldReplay: goldReplayDetails(material),
        responsiveness: responsivenessDetails(options.profilerActive()),
        sessionSwitches,
        submissions: {
            count: submission.submissions.length,
            concurrent: true,
            durationMs: submission.durationMs,
            runIds: submission.submissions.map((entry) => entry.runId),
        },
    };
}

async function sessionSwitchSequence(
    page: Page,
    targets: readonly MixedSessionTarget[],
    indexes: readonly number[],
    mark: (name: string) => Promise<void>,
    markPrefix: string,
    onInteraction?: (interaction: Record<string, unknown>) => void,
): Promise<readonly Record<string, unknown>[]> {
    const interactions: Array<Record<string, unknown>> = [];
    if (targets.length === 0) return interactions;
    // Mixed replay has already opened every clustered session while taking its
    // UI baseline. The focused session-switch workload may not have, so route
    // only genuinely missing tabs once before the measured click sequence.
    // Re-routing an already materialized tab during active streams creates an
    // unrelated workspace-projection lifetime boundary.
    for (const target of targets) {
        const tab = page.locator(`[data-happy-desktop-ui="tab"][data-tab-id="${target.id}"]`);
        if ((await tab.count()) > 0) continue;
        await navigateRoute(page, target.route);
        await waitForSessionUiReady(page, target.route, target.id);
    }
    for (const [interactionIndex, targetIndex] of indexes.entries()) {
        const target = targets[targetIndex % targets.length]!;
        const started = performance.now();
        const startedAt = new Date().toISOString();
        const tab = page.locator(`[data-happy-desktop-ui="tab"][data-tab-id="${target.id}"]`);
        await tab.waitFor({ state: "visible", timeout: 20_000 });
        if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
        try {
            await page.waitForFunction(
                (expected) =>
                    document
                        .querySelector(`[data-happy-desktop-ui="tab"][data-tab-id="${expected}"]`)
                        ?.getAttribute("aria-selected") === "true" &&
                    document.querySelector('[data-happy-desktop-ui="conversation-view"]') !== null,
                target.id,
                { timeout: 30_000 },
            );
        } catch (error) {
            const state = await page
                .evaluate((expected) => {
                    const tabs = [
                        ...document.querySelectorAll<HTMLElement>(
                            '[data-happy-desktop-ui="tab"][data-tab-id]',
                        ),
                    ].map((tab) => ({
                        id: tab.dataset.tabId,
                        selected: tab.getAttribute("aria-selected"),
                        text: tab.textContent?.trim(),
                    }));
                    return {
                        conversationMounted:
                            document.querySelector(
                                '[data-happy-desktop-ui="conversation-view"]',
                            ) !== null,
                        expected,
                        hash: location.hash,
                        tabs,
                    };
                }, target.id)
                .catch(() => undefined);
            throw new Error(
                `Session tab ${target.id} did not become active at interaction ${String(
                    interactionIndex + 1,
                )}: state=${JSON.stringify(state)}; ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        const latencyMs = performance.now() - started;
        const finishedAt = new Date().toISOString();
        interactions.push({
            finishedAt,
            interaction: interactionIndex + 1,
            latencyMs,
            route: target.route,
            sessionId: target.id,
            startedAt,
            workspace: target.workspace,
        });
        onInteraction?.(interactions.at(-1)!);
        await mark(`${markPrefix}-${interactionIndex + 1}`);
    }
    return interactions;
}

async function transcriptViewportRead(page: Page): Promise<TranscriptViewportMeasurement> {
    await page.waitForSelector('[data-happy-desktop-ui="message-list"]', {
        state: "attached",
        timeout: 90_000,
    });
    return page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-happy-desktop-ui="message-list"]');
        const content = document.querySelector<HTMLElement>(
            '[data-happy-desktop-ui="message-list-content"]',
        );
        const virtual = document.querySelector<HTMLElement>(
            '[data-happy-desktop-ui="message-list-virtual"]',
        );
        if (!list || !content) throw new Error("The conversation message list did not mount.");
        return {
            clientHeight: list.clientHeight,
            renderedRows:
                virtual?.querySelectorAll(".happy2-message-list__virtual-row[data-index]").length ??
                0,
            scrollHeight: list.scrollHeight,
            scrollTop: list.scrollTop,
            virtualized:
                content.dataset.virtualized !== undefined &&
                virtual !== null &&
                virtual.querySelector(".happy2-message-list__virtual-row[data-index]") !== null,
        };
    });
}

async function transcriptScrollSequence(
    page: Page,
    fractions: readonly number[],
    mark: (name: string) => Promise<void>,
    onInteraction?: (
        interaction: ScrollInteractionMeasurement & { readonly index: number },
    ) => void,
): Promise<readonly ScrollInteractionMeasurement[]> {
    const interactions: ScrollInteractionMeasurement[] = [];
    let historyLoadAttempted = false;
    for (const [index, requestedFraction] of fractions.entries()) {
        const startedAt = new Date().toISOString();
        const measurement = await page.evaluate(async (fraction) => {
            const list = document.querySelector<HTMLElement>(
                '[data-happy-desktop-ui="message-list"]',
            );
            const content = document.querySelector<HTMLElement>(
                '[data-happy-desktop-ui="message-list-content"]',
            );
            const virtual = document.querySelector<HTMLElement>(
                '[data-happy-desktop-ui="message-list-virtual"]',
            );
            if (!list || !content) throw new Error("The conversation message list did not mount.");
            const started = performance.now();
            const observedLongTasks: PerformanceEntry[] = [];
            let longTaskObserver: PerformanceObserver | undefined;
            if (
                typeof PerformanceObserver !== "undefined" &&
                PerformanceObserver.supportedEntryTypes.includes("longtask")
            ) {
                longTaskObserver = new PerformanceObserver((entryList) => {
                    observedLongTasks.push(...entryList.getEntries());
                });
                longTaskObserver.observe({ buffered: true, type: "longtask" });
            }
            const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
            const historyScrollHeightBefore = list.scrollHeight;
            list.scrollTop = maxScrollTop * fraction;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (longTaskObserver !== undefined) {
                observedLongTasks.push(...longTaskObserver.takeRecords());
                longTaskObserver.disconnect();
            }
            const finished = performance.now();
            const longTasks = observedLongTasks.filter(
                (entry) =>
                    entry.startTime < finished && entry.startTime + entry.duration >= started,
            );
            return {
                actualFraction: maxScrollTop === 0 ? 0 : list.scrollTop / maxScrollTop,
                clientHeight: list.clientHeight,
                durationMs: finished - started,
                longTaskCount: longTasks.length,
                longTaskDurationMs: longTasks.reduce((total, entry) => total + entry.duration, 0),
                maxScrollTop,
                requestedFraction: fraction,
                renderedRows:
                    virtual?.querySelectorAll(".happy2-message-list__virtual-row[data-index]")
                        .length ?? 0,
                scrollHeight: list.scrollHeight,
                scrollTop: list.scrollTop,
                virtualized:
                    content.dataset.virtualized !== undefined &&
                    virtual !== null &&
                    virtual.querySelector(".happy2-message-list__virtual-row[data-index]") !== null,
                historyLoaderObserved: false,
                historyScrollHeightBefore,
                historyScrollHeightAfter: list.scrollHeight,
            };
        }, requestedFraction);
        if (
            requestedFraction === 0 &&
            !historyLoadAttempted &&
            measurement.historyScrollHeightBefore !== undefined
        ) {
            historyLoadAttempted = true;
            const beforeHeight = measurement.historyScrollHeightBefore;
            await page
                .waitForFunction(
                    (before) => {
                        const list = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="message-list"]',
                        );
                        const conversation = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="conversation-view"]',
                        );
                        return (
                            list !== null &&
                            (list.scrollHeight > before ||
                                conversation?.textContent?.includes("Loading earlier messages") ===
                                    true)
                        );
                    },
                    beforeHeight,
                    { timeout: 15_000 },
                )
                .catch(() => undefined);
            const history = await page.evaluate((before) => {
                const list = document.querySelector<HTMLElement>(
                    '[data-happy-desktop-ui="message-list"]',
                );
                const conversation = document.querySelector<HTMLElement>(
                    '[data-happy-desktop-ui="conversation-view"]',
                );
                const text = conversation?.textContent ?? "";
                return {
                    after: list?.scrollHeight ?? before,
                    loader: text.includes("Loading earlier messages"),
                };
            }, beforeHeight);
            measurement.historyLoaderObserved = history.loader || history.after > beforeHeight;
            measurement.historyScrollHeightAfter = history.after;
        }
        const finishedAt = new Date().toISOString();
        const timestampedMeasurement = { ...measurement, finishedAt, startedAt };
        interactions.push(timestampedMeasurement);
        onInteraction?.({ ...timestampedMeasurement, index: index + 1 });
        await mark(`transcript-scroll-${index + 1}`);
    }
    return interactions;
}

async function scrollListToFraction(page: Page, fraction: number): Promise<void> {
    await page.evaluate(
        (requestedFraction) =>
            new Promise<void>((resolve, reject) => {
                const started = performance.now();
                let consecutiveFrames = 0;
                const browserWindow = window as Window & {
                    __happyDesktopGymSettleScrollFraction?: () => void;
                };
                browserWindow.__happyDesktopGymSettleScrollFraction = () => {
                    const list = document.querySelector<HTMLElement>(
                        '[data-happy-desktop-ui="message-list"]',
                    );
                    if (!list) {
                        delete browserWindow.__happyDesktopGymSettleScrollFraction;
                        reject(new Error("The conversation message list did not mount."));
                        return;
                    }
                    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
                    const target = maxScrollTop * requestedFraction;
                    if (Math.abs(list.scrollTop - target) <= 8) {
                        consecutiveFrames += 1;
                    } else {
                        /*
                         * This is precondition setup, not measured compensation:
                         * reapply only while late virtual measurements settle,
                         * and stop writing before the interaction begins.
                         */
                        list.scrollTop = target;
                        list.dispatchEvent(new Event("scroll"));
                        consecutiveFrames = 0;
                    }
                    if (consecutiveFrames >= 3) {
                        delete browserWindow.__happyDesktopGymSettleScrollFraction;
                        resolve();
                        return;
                    }
                    if (performance.now() - started > 10_000) {
                        delete browserWindow.__happyDesktopGymSettleScrollFraction;
                        reject(
                            new Error(
                                `The conversation did not settle at scroll fraction ${requestedFraction}.`,
                            ),
                        );
                        return;
                    }
                    requestAnimationFrame(browserWindow.__happyDesktopGymSettleScrollFraction!);
                };
                browserWindow.__happyDesktopGymSettleScrollFraction();
            }),
        fraction,
    );
}

async function scrollStabilityCapture(
    page: Page,
    action: () => Promise<void>,
): Promise<readonly ScrollStabilityFrame[]> {
    const framesPromise = page.evaluate(
        () =>
            new Promise<ScrollStabilityFrame[]>((resolve) => {
                const frames: ScrollStabilityFrame[] = [];
                const started = performance.now();
                let frameHandle = 0;
                let timerHandle = 0;
                let stopped = false;
                const listAtStart = document.querySelector<HTMLElement>(
                    '[data-happy-desktop-ui="message-list"]',
                );
                const listRectAtStart = listAtStart?.getBoundingClientRect();
                let textAnchor:
                    | {
                          readonly extent: number;
                          readonly index: number | undefined;
                          readonly node: Node;
                          readonly offset: number;
                      }
                    | undefined;
                if (listAtStart && listRectAtStart) {
                    const x = listRectAtStart.left + listRectAtStart.width / 2;
                    for (const inset of [8, 20, 32, 48, 72, 104]) {
                        const position = document.caretPositionFromPoint?.(
                            x,
                            listRectAtStart.bottom - inset,
                        );
                        if (!position || !listAtStart.contains(position.offsetNode)) continue;
                        const parent =
                            position.offsetNode instanceof Element
                                ? position.offsetNode
                                : position.offsetNode.parentElement;
                        const row = parent?.closest<HTMLElement>(
                            ".happy2-message-list__virtual-row[data-index]",
                        );
                        const index = Number.parseInt(row?.dataset.index ?? "", 10);
                        const textLength =
                            position.offsetNode.nodeType === Node.TEXT_NODE
                                ? (position.offsetNode.textContent?.length ?? 0)
                                : 0;
                        textAnchor = {
                            extent: textLength > 0 ? 1 : 0,
                            index: Number.isFinite(index) ? index : undefined,
                            node: position.offsetNode,
                            offset:
                                textLength > 0
                                    ? Math.min(position.offset, textLength - 1)
                                    : position.offset,
                        };
                        break;
                    }
                }
                const browserWindow = window as Window & {
                    __happyDesktopGymScrollStabilityFrameCount?: () => number;
                    __happyDesktopGymSampleScrollStability?: () => void;
                    __happyDesktopGymStopScrollStability?: () => void;
                };
                browserWindow.__happyDesktopGymScrollStabilityFrameCount = () => frames.length;
                browserWindow.__happyDesktopGymSampleScrollStability = () => {
                    /*
                     * rAF itself runs before the frame's ResizeObserver delivery.
                     * Measure from the following task so this records geometry
                     * the browser was able to paint, not an internal pre-layout
                     * state that TanStack corrects before presentation.
                     */
                    timerHandle = window.setTimeout(() => {
                        if (stopped) return;
                        const list = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="message-list"]',
                        );
                        const virtual = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="message-list-virtual"]',
                        );
                        const panel = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="app-shell-panel"]',
                        );
                        const sidebar = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="app-shell-sidebar"]',
                        );
                        const statusLine = document.querySelector<HTMLElement>(
                            '[data-happy-desktop-ui="conversation-status-line"]',
                        );
                        if (list) {
                            const listRect = list.getBoundingClientRect();
                            const statusRect = statusLine?.getBoundingClientRect();
                            const rows = virtual
                                ? [
                                      ...virtual.querySelectorAll<HTMLElement>(
                                          ".happy2-message-list__virtual-row[data-index]",
                                      ),
                                  ]
                                      .map((row) => {
                                          const rect = row.getBoundingClientRect();
                                          return {
                                              bottom: rect.bottom,
                                              index: Number.parseInt(row.dataset.index ?? "", 10),
                                              top: rect.top,
                                          };
                                      })
                                      .filter(
                                          (row) =>
                                              Number.isFinite(row.index) &&
                                              row.bottom > listRect.top &&
                                              row.top < listRect.bottom,
                                      )
                                      .sort((left, right) => left.top - right.top)
                                : [];
                            let rowOverlapCount = 0;
                            for (let index = 1; index < rows.length; index += 1) {
                                if (rows[index - 1]!.bottom > rows[index]!.top + 1)
                                    rowOverlapCount += 1;
                            }
                            const first = rows[0];
                            const edge = rows.at(-1);
                            let anchorIndex = edge?.index;
                            let anchorOffset =
                                edge === undefined ? undefined : listRect.bottom - edge.bottom;
                            let anchorSource: ScrollStabilityFrame["anchorSource"] = "row";
                            if (textAnchor?.node.isConnected) {
                                const maximumOffset =
                                    textAnchor.node.nodeType === Node.TEXT_NODE
                                        ? (textAnchor.node.textContent?.length ?? 0)
                                        : textAnchor.node.childNodes.length;
                                const range = document.createRange();
                                const offset = Math.min(
                                    textAnchor.offset,
                                    Math.max(0, maximumOffset - textAnchor.extent),
                                );
                                range.setStart(textAnchor.node, offset);
                                if (textAnchor.extent > 0)
                                    range.setEnd(textAnchor.node, offset + textAnchor.extent);
                                else range.collapse(true);
                                const rect =
                                    range.getClientRects()[0] ?? range.getBoundingClientRect();
                                if (rect.height > 0 || rect.width > 0) {
                                    anchorIndex = textAnchor.index;
                                    anchorOffset = listRect.bottom - rect.top;
                                    anchorSource = "text";
                                }
                            }
                            frames.push({
                                anchorIndex,
                                anchorOffset,
                                anchorSource,
                                bottomDistance: Math.max(
                                    0,
                                    list.scrollHeight - list.scrollTop - list.clientHeight,
                                ),
                                clientHeight: list.clientHeight,
                                clientWidth: list.clientWidth,
                                elapsedMs: performance.now() - started,
                                firstRowBottom: first?.bottom,
                                firstRowTop: first?.top,
                                panelWidth: panel?.getBoundingClientRect().width ?? 0,
                                rowOverlapCount,
                                scrollHeight: list.scrollHeight,
                                scrollTop: list.scrollTop,
                                sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
                                statusGap:
                                    statusRect && statusRect.height > 0
                                        ? listRect.bottom - statusRect.bottom
                                        : undefined,
                                windowWidth: window.innerWidth,
                            });
                        }
                        if (!stopped)
                            frameHandle = requestAnimationFrame(
                                browserWindow.__happyDesktopGymSampleScrollStability!,
                            );
                    }, 0);
                };
                browserWindow.__happyDesktopGymStopScrollStability = () => {
                    if (stopped) return;
                    stopped = true;
                    cancelAnimationFrame(frameHandle);
                    clearTimeout(timerHandle);
                    delete browserWindow.__happyDesktopGymScrollStabilityFrameCount;
                    delete browserWindow.__happyDesktopGymSampleScrollStability;
                    delete browserWindow.__happyDesktopGymStopScrollStability;
                    resolve(frames);
                };
                frameHandle = requestAnimationFrame(
                    browserWindow.__happyDesktopGymSampleScrollStability,
                );
            }),
    );
    try {
        await page.waitForFunction(
            () => {
                const browserWindow = window as Window & {
                    __happyDesktopGymScrollStabilityFrameCount?: () => number;
                };
                return (browserWindow.__happyDesktopGymScrollStabilityFrameCount?.() ?? 0) > 0;
            },
            undefined,
            { timeout: 5_000 },
        );
        await action();
        await page.waitForTimeout(300);
    } finally {
        await page.evaluate(() => {
            const browserWindow = window as Window & {
                __happyDesktopGymStopScrollStability?: () => void;
            };
            browserWindow.__happyDesktopGymStopScrollStability?.();
        });
    }
    return framesPromise;
}

function scrollStabilityPhaseBuild(
    action: ScrollStabilityPhase["action"],
    anchorMode: ScrollStabilityPhase["anchorMode"],
    frames: readonly ScrollStabilityFrame[],
): ScrollStabilityPhase {
    const first = frames[0];
    const maxBottomDistance = frames.reduce(
        (maximum, frame) => Math.max(maximum, frame.bottomDistance),
        0,
    );
    const maxRowOverlapCount = frames.reduce(
        (maximum, frame) => Math.max(maximum, frame.rowOverlapCount),
        0,
    );
    let anchorBreakCount = 0;
    let nonMonotonicAnchorCorrections = 0;
    if (anchorMode === "following") {
        let anchorWasBroken = false;
        for (const frame of frames) {
            if (frame.bottomDistance > 8) {
                anchorBreakCount += 1;
                anchorWasBroken = true;
            } else if (anchorWasBroken) {
                nonMonotonicAnchorCorrections += 1;
                anchorWasBroken = false;
            }
        }
    }
    const parkedAnchorStable =
        anchorMode !== "parked" ||
        (first?.anchorIndex !== undefined &&
            frames.every(
                (frame) =>
                    frame.anchorIndex === first.anchorIndex &&
                    frame.anchorOffset !== undefined &&
                    first.anchorOffset !== undefined &&
                    Math.abs(frame.anchorOffset - first.anchorOffset) <= 2,
            ));
    const listWidths = frames.map((frame) => frame.clientWidth);
    const listHeights = frames.map((frame) => frame.clientHeight);
    const panelWidths = frames.flatMap((frame) =>
        frame.panelWidth === undefined ? [] : [frame.panelWidth],
    );
    const sidebarWidths = frames.flatMap((frame) =>
        frame.sidebarWidth === undefined ? [] : [frame.sidebarWidth],
    );
    const windowWidths = frames.map((frame) => frame.windowWidth);
    const scrollHeights = frames.map((frame) => frame.scrollHeight);
    const layoutChangeObserved =
        action === "panel-resize" || action === "panel-toggle"
            ? Math.max(...listWidths) - Math.min(...listWidths) >= 24 &&
              panelWidths.length > 0 &&
              Math.max(...panelWidths) - Math.min(...panelWidths) >= 24
            : action === "sidebar-resize" || action === "sidebar-toggle"
              ? Math.max(...listWidths) - Math.min(...listWidths) >= 24 &&
                sidebarWidths.length > 0 &&
                Math.max(...sidebarWidths) - Math.min(...sidebarWidths) >= 24
              : action === "window-resize"
                ? Math.max(...listWidths) - Math.min(...listWidths) >= 24 &&
                  Math.max(...windowWidths) - Math.min(...windowWidths) >= 24
                : action === "stream-send"
                  ? Math.max(...scrollHeights) - Math.min(...scrollHeights) >= 24
                  : Math.max(...listHeights) - Math.min(...listHeights) >= 16;
    const parkedReaderObserved = anchorMode !== "parked" || (first?.bottomDistance ?? 0) > 8;
    const textAnchorObserved =
        anchorMode !== "parked" || frames.every((frame) => frame.anchorSource === "text");
    const stable =
        frames.length >= 2 &&
        layoutChangeObserved &&
        parkedReaderObserved &&
        textAnchorObserved &&
        maxRowOverlapCount === 0 &&
        (anchorMode === "following"
            ? maxBottomDistance <= 8 && nonMonotonicAnchorCorrections === 0
            : parkedAnchorStable);
    return {
        action,
        anchorIndex: first?.anchorIndex,
        anchorMode,
        anchorOffset: first?.anchorOffset,
        anchorBreakCount,
        frames,
        layoutChangeObserved,
        maxBottomDistance,
        maxRowOverlapCount,
        nonMonotonicAnchorCorrections,
        stable,
        textAnchorObserved,
    };
}

async function scrollStabilityRun(
    page: Page,
    mark: (name: string) => Promise<void>,
): Promise<ScrollStabilityMeasurement> {
    await page.waitForSelector('[data-happy-desktop-ui="message-list"]', {
        state: "visible",
        timeout: 30_000,
    });
    await page.waitForSelector('[data-happy-desktop-ui="message-list-virtual"]', {
        state: "attached",
        timeout: 30_000,
    });
    const showPanel = page.locator('button[aria-label="Show panel"]').first();
    if (await showPanel.isVisible().catch(() => false)) await showPanel.click();
    const handle = page.locator(
        '[data-happy-desktop-ui="app-shell-resize-handle"][data-edge="left"]',
    );
    await handle.waitFor({ state: "visible", timeout: 30_000 });
    const splitterDragCapture = async (
        splitter: Locator,
        deltas: readonly number[],
    ): Promise<readonly ScrollStabilityFrame[]> => {
        const handleBox = await splitter.boundingBox();
        if (handleBox === null) throw new Error("The splitter resize handle has no layout box.");
        const handleX = handleBox.x + handleBox.width / 2;
        const handleY = handleBox.y + handleBox.height / 2;
        return scrollStabilityCapture(page, async () => {
            await page.mouse.move(handleX, handleY);
            await page.mouse.down();
            try {
                for (const delta of deltas) {
                    await page.mouse.move(handleX + delta, handleY);
                    await page.waitForTimeout(16);
                }
            } finally {
                await page.mouse.up();
            }
        });
    };
    await scrollListToFraction(page, 1);
    const panelResize = scrollStabilityPhaseBuild(
        "panel-resize",
        "following",
        await splitterDragCapture(handle, [24, 48, 72, 96, 120, 144, 120, 96]),
    );
    await mark("scroll-stability-panel-resize");

    const composer = page.locator('[data-happy-desktop-ui="composer-textarea"]').first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    const originalComposerValue = await composer.inputValue();
    const multilineComposerValue = [
        "Gym scroll stability line one",
        "Gym scroll stability line two",
        "Gym scroll stability line three",
        "Gym scroll stability line four",
    ].join("\n");
    await scrollListToFraction(page, 1);
    const composerGrowth = scrollStabilityPhaseBuild(
        "composer-grow",
        "following",
        await scrollStabilityCapture(page, async () => {
            await composer.fill(multilineComposerValue);
        }),
    );
    await mark("scroll-stability-composer-grow");
    const composerShrink = scrollStabilityPhaseBuild(
        "composer-shrink",
        "following",
        await scrollStabilityCapture(page, async () => {
            await composer.fill(originalComposerValue);
        }),
    );
    await mark("scroll-stability-composer-shrink");

    await scrollListToFraction(page, 0.5);
    const panelParkedResize = scrollStabilityPhaseBuild(
        "panel-resize",
        "parked",
        await splitterDragCapture(handle, [-24, -48, -72, -96, -120, -96, -48, 0]),
    );
    await mark("scroll-stability-parked-panel-resize");
    const sidebarHandle = page
        .locator('[data-happy-desktop-ui="app-shell-resize-handle"][data-edge="right"]')
        .first();
    await sidebarHandle.waitFor({ state: "visible", timeout: 30_000 });
    const sidebarParkedResize = scrollStabilityPhaseBuild(
        "sidebar-resize",
        "parked",
        await splitterDragCapture(sidebarHandle, [24, 48, 72, 96, 72, 48, 24, 0]),
    );
    await mark("scroll-stability-parked-sidebar-resize");
    const sidebarCollapse = page
        .locator('[data-happy-desktop-ui="app-shell-sidebar-collapse"]')
        .first();
    await sidebarCollapse.waitFor({ state: "visible", timeout: 30_000 });
    const sidebarParkedToggle = scrollStabilityPhaseBuild(
        "sidebar-toggle",
        "parked",
        await scrollStabilityCapture(page, async () => {
            await sidebarCollapse.click();
            const sidebarReveal = page
                .locator('[data-happy-desktop-ui="app-shell-reveal-button"]')
                .first();
            await sidebarReveal.waitFor({ state: "visible", timeout: 5_000 });
            await page.waitForTimeout(80);
            await sidebarReveal.click();
            await sidebarCollapse.waitFor({ state: "visible", timeout: 5_000 });
        }),
    );
    await mark("scroll-stability-parked-sidebar-toggle");
    const hidePanel = page.locator('button[aria-label="Hide panel"]').first();
    await hidePanel.waitFor({ state: "visible", timeout: 30_000 });
    const panelParkedToggle = scrollStabilityPhaseBuild(
        "panel-toggle",
        "parked",
        await scrollStabilityCapture(page, async () => {
            await hidePanel.click();
            const panelReveal = page.locator('button[aria-label="Show panel"]').first();
            await panelReveal.waitFor({ state: "visible", timeout: 5_000 });
            await page.waitForTimeout(80);
            await panelReveal.click();
            await hidePanel.waitFor({ state: "visible", timeout: 5_000 });
        }),
    );
    await mark("scroll-stability-parked-panel-toggle");
    const originalWindowSize = await page.evaluate(() => ({
        height: window.outerHeight,
        width: window.outerWidth,
    }));
    const windowParkedResize = scrollStabilityPhaseBuild(
        "window-resize",
        "parked",
        await scrollStabilityCapture(page, async () => {
            for (const delta of [20, 40, 60, 80, 100, 120, 100, 80, 60, 40, 20, 0]) {
                await page.evaluate(
                    ({ delta, height, width }) => window.resizeTo(width - delta, height),
                    { ...originalWindowSize, delta },
                );
                await page.waitForTimeout(16);
            }
            await page.waitForTimeout(550);
        }),
    );
    await mark("scroll-stability-parked-window-resize");
    const composerParkedGrowth = scrollStabilityPhaseBuild(
        "composer-grow",
        "parked",
        await scrollStabilityCapture(page, async () => {
            await composer.fill(multilineComposerValue);
        }),
    );
    await mark("scroll-stability-parked-grow");
    const composerParkedShrink = scrollStabilityPhaseBuild(
        "composer-shrink",
        "parked",
        await scrollStabilityCapture(page, async () => {
            await composer.fill(originalComposerValue);
        }),
    );
    await mark("scroll-stability-parked-shrink");
    await scrollListToFraction(page, 1);
    const phases = [
        panelResize,
        panelParkedResize,
        panelParkedToggle,
        sidebarParkedResize,
        sidebarParkedToggle,
        windowParkedResize,
        composerGrowth,
        composerShrink,
        composerParkedGrowth,
        composerParkedShrink,
    ];
    const measurement = {
        composerGrowth,
        composerParkedGrowth,
        composerParkedShrink,
        composerShrink,
        panelParkedResize,
        panelParkedToggle,
        panelResize,
        sidebarParkedResize,
        sidebarParkedToggle,
        stable: phases.every((phase) => phase.stable),
        windowParkedResize,
    };
    if (!measurement.stable) {
        throw new Error(
            `Transcript scroll stability failed: ${JSON.stringify(
                phases.map((phase) => ({
                    action: phase.action,
                    anchorMode: phase.anchorMode,
                    anchorBreakCount: phase.anchorBreakCount,
                    layoutChangeObserved: phase.layoutChangeObserved,
                    ...(phase.stable ? {} : { frames: phase.frames }),
                    maxBottomDistance: phase.maxBottomDistance,
                    maxRowOverlapCount: phase.maxRowOverlapCount,
                    nonMonotonicAnchorCorrections: phase.nonMonotonicAnchorCorrections,
                    stable: phase.stable,
                })),
            )}`,
        );
    }
    return measurement;
}

function streamingScrollPhaseBuild(
    anchorMode: ScrollStabilityPhase["anchorMode"],
    frames: readonly ScrollStabilityFrame[],
): StreamingScrollPhase {
    const base = scrollStabilityPhaseBuild("stream-send", anchorMode, frames);
    const statusGaps = frames.flatMap((frame) =>
        frame.statusGap === undefined ? [] : [frame.statusGap],
    );
    const statusGapMin = statusGaps.length > 0 ? Math.min(...statusGaps) : undefined;
    const statusGapMax = statusGaps.length > 0 ? Math.max(...statusGaps) : undefined;
    const statusGapSpread =
        statusGapMin === undefined || statusGapMax === undefined
            ? undefined
            : statusGapMax - statusGapMin;
    const scrollTops = frames.map((frame) => frame.scrollTop);
    const scrollTopMin = Math.min(...scrollTops);
    const scrollTopMax = Math.max(...scrollTops);
    const scrollTopSpread = scrollTopMax - scrollTopMin;
    const statusObserved = anchorMode === "parked" || statusGaps.length >= 2;
    return {
        ...base,
        stable:
            base.stable &&
            (anchorMode !== "parked" || scrollTopSpread <= 2) &&
            statusObserved &&
            (anchorMode === "parked" ||
                (statusGapMin !== undefined &&
                    statusGapMin >= 8 &&
                    statusGapSpread !== undefined &&
                    statusGapSpread <= 8)),
        scrollTopMax,
        scrollTopMin,
        scrollTopSpread,
        statusGapMax,
        statusGapMin,
        statusGapSpread,
        statusObserved,
    };
}

async function streamingScrollRun(
    page: Page,
    composer: Locator,
    mark: (name: string) => Promise<void>,
): Promise<StreamingScrollMeasurement> {
    const run = async (
        anchorMode: ScrollStabilityPhase["anchorMode"],
        ordinal: number,
    ): Promise<StreamingScrollPhase> => {
        await scrollListToFraction(page, anchorMode === "following" ? 1 : 0.5);
        /*
         * The helper writes scrollTop in page context. Let the browser deliver
         * that real scroll and TanStack's scroll-end notification before a
         * later keyboard action; a human cannot wheel and press Enter in the
         * same JavaScript task either.
         */
        await page.waitForTimeout(200);
        const marker = `gym-mixed-replay-stream-${anchorMode}-${String(ordinal)}-${Date.now().toString(36)}`;
        await composer.fill(`Exercise real ${anchorMode} streaming. [${marker}]`);
        const runningStatus = page.locator(
            '[data-happy-desktop-ui="sidebar-item"][data-active][data-status="working"]',
        );
        const frames = await scrollStabilityCapture(page, async () => {
            await composer.press("Enter");
            await runningStatus.waitFor({ state: "visible", timeout: 30_000 });
            if (anchorMode === "following") {
                await page.waitForFunction(
                    (scriptMarker) =>
                        document
                            .querySelector('[data-happy-desktop-ui="conversation-view"]')
                            ?.textContent?.includes(`script=${String(scriptMarker)}`) === true,
                    marker,
                    { timeout: 90_000 },
                );
            }
            await runningStatus.waitFor({ state: "hidden", timeout: 90_000 });
        });
        const phase = streamingScrollPhaseBuild(anchorMode, frames);
        await mark(`streaming-scroll-${anchorMode}`);
        return phase;
    };
    const following = await run("following", 1);
    const parked = await run("parked", 2);
    await scrollListToFraction(page, 1);
    await page.waitForTimeout(200);
    const unstickMarker = `gym-mixed-replay-stream-unstick-3-${Date.now().toString(36)}`;
    await composer.fill(`Exercise real mid-stream unstick. [${unstickMarker}]`);
    const runningStatus = page.locator(
        '[data-happy-desktop-ui="sidebar-item"][data-active][data-status="working"]',
    );
    await composer.press("Enter");
    await runningStatus.waitFor({ state: "visible", timeout: 30_000 });
    const list = page.locator('[data-happy-desktop-ui="message-list"]').first();
    const listBox = await list.boundingBox();
    if (!listBox) throw new Error("The streaming transcript has no wheel target.");
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, -Math.max(800, listBox.height * 2));
    await page.waitForFunction(
        () => {
            const element = document.querySelector<HTMLElement>(
                '[data-happy-desktop-ui="message-list"]',
            );
            return (
                element !== null &&
                element.scrollHeight - element.scrollTop - element.clientHeight > 100
            );
        },
        undefined,
        { timeout: 5_000 },
    );
    await page.waitForTimeout(100);
    const unstickFrames = await scrollStabilityCapture(page, async () => {
        await runningStatus.waitFor({ state: "hidden", timeout: 90_000 });
    });
    const unstick = streamingScrollPhaseBuild("parked", unstickFrames);
    await mark("streaming-scroll-unstick");
    return {
        following,
        parked,
        stable: following.stable && parked.stable && unstick.stable,
        unstick,
    };
}

function goldReplayDetails(material: GymGoldReplayMaterial): Record<string, unknown> {
    return {
        durationMs: material.durationMs,
        frameCount: material.frameCount,
        id: material.id,
        label: material.label,
        messageCount: material.messages.length,
        messageSources: material.messages.map((message) => message.source),
        path: material.path,
        replayMode: "gold-submitted-message-patterns-through-real-rig",
    };
}

function responsivenessDetails(nativeProfilerActive: boolean): Record<string, string> {
    return nativeProfilerActive
        ? {
              longTasks:
                  "See the unchanged Chromium timeline, paint, input, and React timestamp evidence referenced by profilerArtifacts.",
              metrics:
                  "See the unchanged native raw metrics samples referenced by profilerArtifacts.",
              source: "happy-desktop-native",
          }
        : {
              longTasks: "Bounded browser long-task entries and CDP fallback.",
              metrics: "Renderer metrics are included in the before/after captures.",
              source: "gym-cdp-fallback",
          };
}

async function mixedReplayRun(
    page: Page,
    app: ElectronApplication,
    options: {
        readonly manifest: GymManifest;
        readonly paths: GymRunPaths;
        readonly runtime: StartedRigRuntime;
        readonly projects: readonly GymProject[];
        readonly sessionIds: readonly string[];
        profilerActive(): boolean;
    },
    material: GymGoldReplayMaterial,
    targets: readonly MixedSessionTarget[],
    mark: (name: string) => Promise<void>,
): Promise<Record<string, unknown>> {
    const before = await performanceCapture(page, app, options.profilerActive());
    const overlapStarted = performance.now();
    const overlapEvents: Array<Record<string, unknown>> = [];
    const overlapEvent = (kind: string, details: Record<string, unknown> = {}): void => {
        overlapEvents.push({
            kind,
            ...details,
            timestamp: new Date().toISOString(),
            elapsedMs: performance.now() - overlapStarted,
        });
    };
    await mark("baseline-captured");

    const baselineMessages = new Map<string, number>();
    const baselineEvents = new Map<string, number>();
    const baselineCursors = new Map<string, string | undefined>();
    for (const target of targets) {
        await navigateRoute(page, target.route);
        await waitForSessionUiReady(page, target.route, target.id);
        baselineMessages.set(
            target.id,
            await page.locator('[data-happy-desktop-ui="message"]').count(),
        );
    }
    await mark("session-baselines-captured");
    await Promise.all(
        targets.map(async (target) => {
            const events = (await options.runtime.client.events(target.id)).events;
            baselineEvents.set(target.id, events.length);
            baselineCursors.set(target.id, eventCursorRead(events.at(-1)));
        }),
    );
    const collectors = new Map<string, PreAttachedSessionStream>();
    await Promise.all(
        targets.map(async (target) => {
            collectors.set(
                target.id,
                await sessionStreamCollectorCreate(
                    options.runtime.client,
                    target.id,
                    baselineCursors.get(target.id),
                ),
            );
        }),
    );

    // The prepared runtime mounts the actual ready managed worktree at
    // /workspace. Pick a clustered workspace session so the real agent tool
    // mutation lands in the same checkout that the foreground UI renders.
    const liveToolTargetIndex = Math.max(
        0,
        targets.findIndex((target) => target.workspace),
    );
    const liveToolTarget = targets[liveToolTargetIndex]!;
    const liveToolProjectId =
        liveToolTarget.projectId ??
        options.projects.find((project) =>
            liveToolTarget.workspaceId === undefined
                ? false
                : project.worktreeIds.includes(liveToolTarget.workspaceId),
        )?.id;
    if (liveToolTarget.workspaceId === undefined || liveToolProjectId === undefined) {
        throw new Error("Mixed replay target is not a managed workspace with a project owner.");
    }
    const watchedBefore = await options.runtime.client.gitWatch([
        { projectId: liveToolProjectId, workspaceId: liveToolTarget.workspaceId },
    ]);
    overlapEvent("git-watch-registered", {
        phase: "before-tool",
        projectId: liveToolProjectId,
        workspaceId: liveToolTarget.workspaceId,
        snapshotCount: Array.isArray(watchedBefore.snapshots)
            ? watchedBefore.snapshots.length
            : undefined,
    });
    const liveToolMarker = "Gym live tool mutation · mixed replay";
    const liveToolLineCount = gymLiveToolMutationLineCount(options.manifest.profile);
    const liveFilePath = join(
        options.paths.rigWorkspacePath,
        "src/changes/modified/deep/large-modified.md",
    );
    const baselineLiveFileLines = (await readFile(liveFilePath, "utf8"))
        .trimEnd()
        .split("\n").length;
    const expectedChangedLines = baselineLiveFileLines + liveToolLineCount;
    const liveFileMutationBarrier = waitForFileMutation(
        liveFilePath,
        liveToolMarker,
        expectedChangedLines,
    );
    const submissionStarted = performance.now();
    const submissions = await Promise.all(
        targets.map(async (target, index): Promise<MixedSubmission> => {
            const materialMessage = material.messages[index % material.messages.length]!;
            const baselineEventCount = baselineEvents.get(target.id) ?? 0;
            const marker = `gym-mixed-replay-${String(index + 1)}-${target.id.slice(-6)}-e${baselineEventCount}`;
            const liveTool = index === liveToolTargetIndex;
            const submittedAt = new Date().toISOString();
            const prompt =
                `${materialMessage.text}\n\n[${marker}]` +
                (liveTool ? "\n\n[gym-mixed-replay-live-tool]" : "");
            const submitted = await options.runtime.client.submitMessage(target.id, prompt);
            if (submitted.runId === undefined) {
                throw new Error(
                    `Rig did not return a run id for mixed replay session ${target.id}.`,
                );
            }
            return {
                baselineEventCount,
                baselineCursor: baselineCursors.get(target.id),
                liveTool,
                marker,
                prompt,
                route: target.route,
                runId: submitted.runId,
                sessionId: target.id,
                submittedAt,
            };
        }),
    );
    const submissionDurationMs = performance.now() - submissionStarted;
    overlapEvent("turns-submitted", {
        count: submissions.length,
        liveToolSessionId: liveToolTarget.id,
        runIds: submissions.map((submission) => submission.runId),
    });
    await mark("concurrent-submissions-accepted");

    // Each barrier drains one ordered cursor over the append-only buffer fed by
    // the real session SSE stream. The server `after` cursor is the recovery
    // boundary; the run id and lifecycle sequence are the acceptance boundary.
    // The NDJSON artifact preserves every observed event/timestamp unchanged.
    const seenRunEvents = new Set<string>();
    const durableBarriers = submissions.map((submission) => {
        overlapEvent("durable-barrier-start", {
            runId: submission.runId,
            sessionId: submission.sessionId,
        });
        return sessionRunBarrierWait(
            options.runtime.client,
            submission,
            async (event, observedAt) => {
                const eventId =
                    typeof event.eventId === "string"
                        ? event.eventId
                        : `${submission.runId}:${JSON.stringify(event)}`;
                if (seenRunEvents.has(eventId)) return;
                seenRunEvents.add(eventId);
                const eventData = isRecord(event.data) ? event.data : undefined;
                const nested = isRecord(eventData?.event) ? eventData.event : undefined;
                await appendFile(
                    options.paths.streamLog,
                    `${JSON.stringify({
                        kind: "session-event",
                        event,
                        eventId,
                        observedAt,
                        runId: submission.runId,
                        sessionId: submission.sessionId,
                        sessionEventTimestamp: event.createdAt,
                    })}\n`,
                    "utf8",
                );
                overlapEvent("stream-event", {
                    createdAt: event.createdAt,
                    eventId: typeof event.eventId === "string" ? event.eventId : undefined,
                    eventType: typeof event.type === "string" ? event.type : "unknown",
                    nestedType: typeof nested?.type === "string" ? nested.type : undefined,
                    observedAt,
                    runId: submission.runId,
                    sessionId: submission.sessionId,
                });
            },
            collectors.get(submission.sessionId),
        );
    });

    overlapEvent("ui-lane-start", {
        foregroundSessionId: targets[0]?.id,
        liveToolSessionId: liveToolTarget.id,
    });
    const uiDriver = (async (): Promise<{
        readonly changedFiles: FileSequenceMeasurement;
        readonly changedFileStats: ChangedFileStatsMeasurement;
        readonly changedFileSelection: DiffSelectionMeasurement;
        readonly changedFileUiSummary: string;
        readonly documentSequence: FileSequenceMeasurement;
        readonly highlightSequence: FileSequenceMeasurement;
        readonly historyGrowthObserved: boolean;
        readonly initialTranscriptViewport: TranscriptViewportMeasurement;
        readonly longChatScrollInteractions: readonly ScrollInteractionMeasurement[];
        readonly scrollStability: ScrollStabilityMeasurement;
        readonly sessionSwitches: readonly Record<string, unknown>[];
        readonly streamUiInteractions: readonly Record<string, unknown>[];
    }> => {
        const routeIndexes = targets.length >= 4 ? [0, 1, 2, 0, 3, 2, 1, 0] : [0, 1, 2, 0, 1, 2, 0];
        const sessionSwitches = await sessionSwitchSequence(
            page,
            targets,
            routeIndexes,
            mark,
            "session-switch",
            (interaction) => overlapEvent("session-switch", interaction),
        );
        await mark("session-switches-complete");

        const scrollTarget = targets[0]!;
        await navigateRoute(page, scrollTarget.route);
        await waitForSessionUiReady(page, scrollTarget.route, scrollTarget.id);
        const initialTranscriptViewport = await transcriptViewportRead(page);
        overlapEvent("transcript-ready", { ...initialTranscriptViewport });
        const longChatScrollInteractions = await transcriptScrollSequence(
            page,
            [1, 0, 0.78, 0.22, 0.92, 0.08, 0.64, 0],
            mark,
            (interaction) => overlapEvent("transcript-scroll", { ...interaction }),
        );
        const historyGrowthObserved = longChatScrollInteractions.some(
            (interaction) =>
                interaction.requestedFraction === 0 &&
                (interaction.historyLoaderObserved === true ||
                    (interaction.historyScrollHeightAfter ?? 0) >
                        (interaction.historyScrollHeightBefore ?? Number.POSITIVE_INFINITY)),
        );
        await mark("long-chat-scroll-complete");
        const scrollStability = await scrollStabilityRun(page, mark);
        overlapEvent("scroll-stability-complete", {
            stable: scrollStability.stable,
            panelResizeFrames: scrollStability.panelResize.frames.length,
            panelParkedResizeFrames: scrollStability.panelParkedResize.frames.length,
            composerGrowthFrames: scrollStability.composerGrowth.frames.length,
            composerShrinkFrames: scrollStability.composerShrink.frames.length,
        });

        // Keep this checkout foregrounded while the isolated tool mutates its
        // deterministic file. The Changed-files projection is the UI/event
        // barrier for Git watcher → Rig scanner → SSE → Happy reconciliation.
        await navigateRoute(page, liveToolTarget.route);
        await waitForSessionUiReady(page, liveToolTarget.route, liveToolTarget.id);
        const changedPaths = [
            "src/changes/modified/deep/large-modified.md",
            "src/changes/added/deep/added-large.md",
            "src/changes/renamed/renamed-source.ts",
            "src/changes/modified/deep/large-modified.md",
            "src/changes/added/deep/added-large.md",
        ];
        // Ensure the first open sees the live mutation before the cold
        // plain-to-highlight selection barrier starts. Otherwise the worker
        // may finish the pre-mutation document before the range is staged.
        await liveFileMutationBarrier;
        let changedFileSelection: DiffSelectionMeasurement | undefined;
        const changedFileInteraction = async (
            path: string,
            index: number,
            durationMs: number,
            timestamps: { readonly finishedAt: string; readonly startedAt: string },
        ): Promise<void> => {
            overlapEvent("changed-file-switch", {
                durationMs,
                ...timestamps,
                index: index + 1,
                path,
                sessionId: liveToolTarget.id,
            });
            await mark(`changed-file-${index + 1}-${fileMark(path)}-${durationMs.toFixed(0)}ms`);
        };
        const firstChangedFile = await fileSwitchSequence(
            page,
            changedPaths.slice(0, 1),
            changedFileInteraction,
            "changed",
            async (path, index) => {
                if (index === 0)
                    changedFileSelection = await changedFileSelectionBarrier(page, path, true);
            },
        );
        // `changedFiles` ends on added-large.md. Re-open the exact modified
        // row after the real tool mutation so the virtualized row itself,
        // rather than the currently selected diff body or aggregate summary,
        // proves Git watcher → Rig → SSE → UI reconciliation.
        const changedFileStats = await changedFileStatsBarrier(
            page,
            changedPaths[0]!,
            expectedChangedLines,
            16,
        );
        if (changedFileSelection === undefined)
            throw new Error("Cold changed-file selection barrier did not run.");
        const remainingChangedFiles = await fileSwitchSequence(
            page,
            changedPaths.slice(1),
            (path, index, durationMs, timestamps) =>
                changedFileInteraction(path, index + 1, durationMs, timestamps),
            "changed",
        );
        const changedFiles: FileSequenceMeasurement = {
            durationsMs: [...firstChangedFile.durationsMs, ...remainingChangedFiles.durationsMs],
            firstMs: firstChangedFile.firstMs,
            loadingObserved: [
                ...firstChangedFile.loadingObserved,
                ...remainingChangedFiles.loadingObserved,
            ],
            paths: [...firstChangedFile.paths, ...remainingChangedFiles.paths],
            ...(firstChangedFile.reason === undefined && remainingChangedFiles.reason === undefined
                ? {}
                : { reason: firstChangedFile.reason ?? remainingChangedFiles.reason }),
            status:
                firstChangedFile.status === "ok" && remainingChangedFiles.status === "ok"
                    ? "ok"
                    : "skipped",
            warmMs: remainingChangedFiles.warmMs,
        };
        const changedFileUiSummary =
            (await page
                .locator('[data-happy-desktop-ui="file-browser-summary"]')
                .textContent()
                .catch(() => "")) ?? "";
        overlapEvent("file-reconciled", {
            changedPath: changedPaths[0],
            changedFileUiSummary,
            changedFileStats,
            expectedChangedLines,
            lineMutation: liveToolLineCount,
            sessionId: liveToolTarget.id,
        });

        const documentPaths = [
            "src/long-transcript.md",
            "docs/large/large-001.md",
            "src/long-transcript.md",
            "docs/large/large-001.md",
            "src/long-transcript.md",
        ];
        const documentSequence = await fileSwitchSequence(
            page,
            documentPaths,
            async (path, index, durationMs, timestamps) => {
                overlapEvent("document-switch", {
                    durationMs,
                    ...timestamps,
                    index: index + 1,
                    path,
                    sessionId: liveToolTarget.id,
                });
                await mark(
                    `document-cache-${index + 1}-${fileMark(path)}-${durationMs.toFixed(0)}ms`,
                );
            },
        );
        const pierreHighlightPaths = [
            "README.md",
            "src/long-transcript.md",
            "README.md",
            "src/long-transcript.md",
            "README.md",
        ];
        const highlightSequence = await fileSwitchSequence(
            page,
            pierreHighlightPaths,
            async (path, index, durationMs, timestamps) => {
                overlapEvent("highlight-switch", {
                    durationMs,
                    ...timestamps,
                    index: index + 1,
                    path,
                    sessionId: liveToolTarget.id,
                });
                await mark(
                    `highlight-cache-${index + 1}-${fileMark(path)}-${durationMs.toFixed(0)}ms`,
                );
            },
        );
        if (highlightSequence.status === "ok" && !highlightSequence.markdownFencedCodeObserved) {
            throw new Error(
                "Mixed replay highlight lane completed without observing the README Markdown fenced-code Pierre barrier.",
            );
        }
        await mark("cache-sequences-complete");

        const streamUiInteractions: Array<Record<string, unknown>> = [];
        for (const submission of submissions) {
            const targetStarted = performance.now();
            const targetStartedAt = new Date().toISOString();
            await navigateRoute(page, submission.route);
            await waitForSessionUiReady(page, submission.route, submission.sessionId);
            await waitForReplayMarker(page, submission.marker);
            const latencyMs = performance.now() - targetStarted;
            const interaction = {
                baselineEventCount: submission.baselineEventCount,
                baselineMessageCount: baselineMessages.get(submission.sessionId),
                finishedAt: new Date().toISOString(),
                latencyMs,
                marker: submission.marker,
                messageCount: await page.locator('[data-happy-desktop-ui="message"]').count(),
                runId: submission.runId,
                sessionId: submission.sessionId,
                startedAt: targetStartedAt,
            };
            streamUiInteractions.push(interaction);
            overlapEvent("stream-visible", interaction);
            await mark(`stream-visible-${submission.sessionId.slice(-6)}`);
        }
        await mark("streams-visible");
        return {
            changedFiles,
            changedFileStats,
            changedFileSelection,
            changedFileUiSummary,
            documentSequence,
            historyGrowthObserved,
            highlightSequence,
            initialTranscriptViewport,
            longChatScrollInteractions,
            scrollStability,
            sessionSwitches,
            streamUiInteractions,
        };
    })();
    const [ui, durableResults] = await Promise.all([uiDriver, Promise.all(durableBarriers)]);
    overlapEvent("ui-lane-complete", {
        changedFileStatus: ui.changedFiles.status,
        sessionSwitchCount: ui.sessionSwitches.length,
    });
    await mark("durable-stream-barriers-complete");

    const liveToolResult = durableResults[liveToolTargetIndex]!;
    if (!liveToolResult.toolCallObserved) {
        throw new Error(
            `Mixed replay did not observe the required real tool call in ${liveToolTarget.id}; ` +
                `eventTypes=${liveToolResult.eventTypes.join(",")}`,
        );
    }
    const liveFile = await readFile(liveFilePath, "utf8");
    const liveFileLines = liveFile.trimEnd().split("\n").length;
    const liveFileMutationObserved =
        liveFileLines >= expectedChangedLines && liveFile.includes(liveToolMarker);
    if (!liveFileMutationObserved) {
        throw new Error(
            `Mixed replay tool mutation did not reach the visible checkout: ` +
                `path=${liveFilePath} lines=${liveFileLines} expected=${expectedChangedLines}`,
        );
    }
    const watchedAfter = await options.runtime.client.gitWatch([
        { projectId: liveToolProjectId, workspaceId: liveToolTarget.workspaceId },
    ]);
    overlapEvent("git-watch-registered", {
        phase: "after-tool",
        projectId: liveToolProjectId,
        workspaceId: liveToolTarget.workspaceId,
        snapshotCount: Array.isArray(watchedAfter.snapshots)
            ? watchedAfter.snapshots.length
            : undefined,
    });
    const uiStart = overlapEvents.find((event) => event.kind === "ui-lane-start");
    const uiEnd = overlapEvents.find((event) => event.kind === "ui-lane-complete");
    const uiStartMs = typeof uiStart?.elapsedMs === "number" ? uiStart.elapsedMs : 0;
    const uiEndMs =
        typeof uiEnd?.elapsedMs === "number" ? uiEnd.elapsedMs : Number.POSITIVE_INFINITY;
    const streamEventsDuringUi = overlapEvents.filter(
        (event) =>
            event.kind === "stream-event" &&
            typeof event.elapsedMs === "number" &&
            event.elapsedMs >= uiStartMs &&
            event.elapsedMs <= uiEndMs,
    );
    if (streamEventsDuringUi.length === 0) {
        throw new Error(
            "Mixed replay did not overlap durable streams with the foreground UI lane.",
        );
    }

    const after = await performanceCapture(page, app, options.profilerActive());
    const responsiveness = responsivenessDetails(options.profilerActive());
    return {
        after,
        cacheEvidence: {
            changedFiles: cacheEvidence("changed-files", ui.changedFiles),
            document: cacheEvidence("document-cache", ui.documentSequence),
            highlight: cacheEvidence("highlight-cache", ui.highlightSequence),
        },
        changedFiles: ui.changedFiles,
        changedFileStats: ui.changedFileStats,
        changedFileSelection: ui.changedFileSelection,
        changedFileUiSummary: ui.changedFileUiSummary,
        durableBarriers: durableResults,
        goldReplay: goldReplayDetails(material),
        longChatScroll: {
            initialViewport: ui.initialTranscriptViewport,
            interactions: ui.longChatScrollInteractions,
            historyGrowthObserved: ui.historyGrowthObserved,
            virtualizationExercised:
                ui.initialTranscriptViewport.virtualized &&
                ui.initialTranscriptViewport.scrollHeight >
                    ui.initialTranscriptViewport.clientHeight,
        },
        scrollStability: ui.scrollStability,
        liveToolMutation: {
            changedLinesBeforeTool: baselineLiveFileLines,
            expectedChangedLines,
            lineCount: liveToolLineCount,
            path: liveFilePath,
            sessionId: liveToolTarget.id,
            toolCallObserved: liveToolResult.toolCallObserved,
            mutationObserved: liveFileMutationObserved,
            usedWorkspace: liveToolTarget.workspace,
        },
        overlap: {
            eventCount: overlapEvents.length,
            events: overlapEvents,
            streamEventsDuringUi: streamEventsDuringUi.length,
            uiLane: "promise-coordinated-with-durable-barriers",
        },
        responsiveness,
        streamArtifact: options.paths.streamLog,
        sessionSwitches: ui.sessionSwitches,
        streamUiInteractions: ui.streamUiInteractions,
        submissions: {
            count: submissions.length,
            concurrent: true,
            durationMs: submissionDurationMs,
            liveToolSessionId: liveToolTarget.id,
            runIds: submissions.map((submission) => submission.runId),
        },
        before,
    };
}

async function mixedSessionTargetsRead(
    sessionIds: readonly string[],
    runtime: StartedRigRuntime,
): Promise<readonly MixedSessionTarget[]> {
    const targets = await Promise.all(
        sessionIds.map(async (id): Promise<MixedSessionTarget | undefined> => {
            const session = (await runtime.client.getSession(id)).session;
            const location = sessionLocation(session);
            return location === undefined
                ? undefined
                : {
                      id,
                      projectId: location.projectId,
                      route: location.route,
                      scopeRoute: location.scopeRoute,
                      workspaceId: location.workspaceId,
                      workspace: location.workspace,
                  };
        }),
    );
    return targets
        .filter((target): target is MixedSessionTarget => target !== undefined)
        .slice(0, 4);
}

async function sessionRunBarrierWait(
    client: StartedRigRuntime["client"],
    submission: MixedSubmission,
    onEvent?: SessionRunEventObserver,
    preAttached?: PreAttachedSessionStream,
): Promise<SessionRunBarrier> {
    const started = performance.now();
    const collector =
        preAttached ??
        (await sessionStreamCollectorCreate(
            client,
            submission.sessionId,
            submission.baselineCursor,
        ));
    const cursor = collector.cursorCreate();
    let eventCount = 0;
    let streamObserved = false;
    const eventTypes = new Set<string>();
    let toolCallObserved = false;
    let messageSubmittedSeen = false;
    let runStartedSeen = false;
    let firstAgentEventSeen = false;
    let settled = false;
    const seenEventIds = new Set<string>();
    const barrier = new Promise<SessionRunBarrier>((resolve, reject) => {
        const processEvent = async (streamEvent: RigSessionStreamEvent): Promise<void> => {
            if (settled) return;
            const eventId =
                streamEvent.id ?? `${submission.sessionId}:${JSON.stringify(streamEvent.data)}`;
            if (seenEventIds.has(eventId)) return;
            seenEventIds.add(eventId);
            const event: Record<string, unknown> = {
                ...streamEvent.data,
                ...(streamEvent.id === undefined
                    ? {}
                    : { eventId: streamEvent.id, id: streamEvent.id }),
            };
            if (eventRunId(event) !== submission.runId) return;
            eventCount += 1;
            const type = typeof event.type === "string" ? event.type : "unknown";
            const eventData = isRecord(event.data) ? event.data : undefined;
            const nestedEvent = isRecord(eventData?.event) ? eventData.event : undefined;
            const nestedType = typeof nestedEvent?.type === "string" ? nestedEvent.type : undefined;
            eventTypes.add(type);
            if (type === "message_submitted") messageSubmittedSeen = true;
            if (type === "run_started") runStartedSeen = true;
            if (type === "agent_event" || type === "agent_message") {
                firstAgentEventSeen = true;
                streamObserved = true;
            }
            if (
                type === "tool_call" ||
                type === "tool_result" ||
                (type === "agent_event" &&
                    (nestedType === "toolcall_start" ||
                        nestedType === "toolcall_delta" ||
                        nestedType === "toolcall_end" ||
                        nestedType === "tool_execution_start" ||
                        nestedType === "tool_execution_progress" ||
                        nestedType === "tool_execution_status" ||
                        nestedType === "tool_execution_end"))
            ) {
                toolCallObserved = true;
            }
            await onEvent?.(event, streamEvent.receivedAt);
            if (type === "run_error") {
                settled = true;
                reject(
                    new Error(
                        `Rig mixed replay run ${submission.runId} failed in ${submission.sessionId}: ${JSON.stringify(event).slice(0, 2_000)}`,
                    ),
                );
                collector.handle.close();
                return;
            }
            if (type === "run_finished") {
                settled = true;
                if (!messageSubmittedSeen || !runStartedSeen || !firstAgentEventSeen) {
                    reject(
                        new Error(
                            `Rig stream barrier for ${submission.runId} violated the submitted→started→agent→finished sequence.`,
                        ),
                    );
                    collector.handle.close();
                    cursor.close();
                    return;
                }
                resolve({
                    durationMs: performance.now() - started,
                    eventCount,
                    eventTypes: [...eventTypes],
                    finished: true,
                    sessionId: submission.sessionId,
                    streamObserved,
                    toolCallObserved,
                });
                collector.handle.close();
                cursor.close();
            }
        };
        void (async () => {
            for await (const streamEvent of cursor) {
                await processEvent(streamEvent);
                if (settled) break;
            }
        })().catch((error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
            collector.handle.close();
            cursor.close();
        });
        const timeout = setTimeout(() => {
            settled = true;
            reject(
                new Error(
                    `Timed out waiting for durable mixed replay run ${submission.runId} in ${submission.sessionId}.`,
                ),
            );
            collector.handle.close();
            cursor.close();
        }, 90_000);
        timeout.unref?.();
        void collector.handle.done
            .then(() => {
                if (settled) return;
                settled = true;
                reject(
                    new Error(
                        `Rig session stream ended before run ${submission.runId} finished in ${submission.sessionId}.`,
                    ),
                );
                cursor.close();
            })
            .catch((error: unknown) => {
                if (settled) return;
                settled = true;
                reject(error);
                cursor.close();
            })
            .finally(() => {
                clearTimeout(timeout);
            });
    });
    return barrier;
}

async function waitForSessionUiReady(page: Page, route: string, sessionId?: string): Promise<void> {
    await page.waitForFunction((expected) => location.hash === `#${expected}`, route, {
        timeout: 10_000,
    });
    try {
        if (sessionId !== undefined) {
            const tab = page
                .locator(`[data-happy-desktop-ui="tab"][data-tab-id="${sessionId}"]`)
                .first();
            await tab.waitFor({ state: "visible", timeout: 20_000 });
            if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
            await page.waitForFunction(
                (expected) =>
                    document
                        .querySelector(`[data-happy-desktop-ui="tab"][data-tab-id="${expected}"]`)
                        ?.getAttribute("aria-selected") === "true",
                sessionId,
                { timeout: 20_000 },
            );
        }
        await page
            .locator('[data-happy-desktop-ui="conversation-view"]')
            .waitFor({ state: "attached", timeout: 20_000 });
    } catch (error) {
        throw new Error(
            `Session UI did not mount for ${route} at ${page.url()}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function waitForReplayMarker(page: Page, marker: string): Promise<void> {
    try {
        await page.waitForSelector('[data-happy-desktop-ui="message-list"]', {
            state: "attached",
            timeout: 90_000,
        });
        await page.locator('[data-happy-desktop-ui="message-list"]').evaluate(async (element) => {
            const list = element as HTMLElement;
            list.scrollTop = list.scrollHeight;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        await page.waitForFunction(
            (expected) =>
                document
                    .querySelector('[data-happy-desktop-ui="message-list"]')
                    ?.textContent?.includes(expected) === true,
            marker,
            {
                timeout: 90_000,
            },
        );
    } catch (error) {
        const conversation = await page
            .locator('[data-happy-desktop-ui="conversation-view"]')
            .innerText()
            .catch(() => "");
        throw new Error(
            `Timed out waiting for replay marker ${marker}: ` +
                `${error instanceof Error ? error.message : String(error)} ` +
                `conversation=${conversation.slice(0, 1_000)}`,
        );
    }
}

function eventRunId(event: Record<string, unknown>): string | undefined {
    const data = event.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
    const runId = (data as Record<string, unknown>).runId;
    return typeof runId === "string" ? runId : undefined;
}

function eventCursorRead(event: Record<string, unknown> | undefined): string | undefined {
    if (event === undefined) return undefined;
    const id = event.id ?? event.eventId;
    return typeof id === "string" ? id : undefined;
}

function cacheEvidence(name: string, sequence: FileSequenceMeasurement): Record<string, unknown> {
    const loadingObserved = sequence.loadingObserved;
    const warmInteractionIndexes = sequence.paths.flatMap((path, index) =>
        sequence.paths.slice(0, index).includes(path) ? [index] : [],
    );
    const warmLoadingObserved = warmInteractionIndexes.map(
        (index) => loadingObserved[index] === true,
    );
    if (sequence.status !== "ok" || sequence.durationsMs.length < 3) {
        return {
            evidence: "unavailable",
            loadingObserved,
            name,
            reason: sequence.reason ?? "A→B→A sequence did not complete.",
            status: sequence.status,
            warmLoadingObserved,
            warmNoLoading:
                warmLoadingObserved.length > 0 &&
                warmLoadingObserved.every((observed) => !observed),
        };
    }
    if (name === "highlight-cache" && !sequence.markdownFencedCodeObserved) {
        return {
            evidence: "unavailable",
            loadingObserved,
            name,
            reason: "Highlight sequence did not observe the Markdown fenced-code Pierre barrier.",
            status: sequence.status,
            warmLoadingObserved,
            warmNoLoading:
                warmLoadingObserved.length > 0 &&
                warmLoadingObserved.every((observed) => !observed),
        };
    }
    const coldMs = sequence.durationsMs[0]!;
    const warmReturns = sequence.durationsMs.filter(
        (_, index) => index > 0 && sequence.paths[index] === sequence.paths[0],
    );
    const warmMs = Math.min(...warmReturns);
    return {
        coldMs,
        evidence: "A→B→A UI interaction latency; cache hit is inferred from the warm return.",
        loadingObserved,
        ...(sequence.markdownFencedCodeObserved
            ? {
                  markdownFencedCodeObserved: true,
                  markdownRenderer: "Pierre Diffs via MarkdownDocument fenced block",
              }
            : {}),
        name,
        path: sequence.paths[0],
        status: sequence.status,
        warmLoadingObserved,
        warmNoLoading:
            warmLoadingObserved.length > 0 && warmLoadingObserved.every((observed) => !observed),
        warmNoLoadingEvidence:
            warmLoadingObserved.length > 0
                ? "MutationObserver saw no Loading file… face on repeated paths."
                : "No repeated path was present in this sequence.",
        warmSamples: warmReturns,
        warmFaster: warmMs <= coldMs,
        warmMs,
        warmVsColdDeltaMs: warmMs - coldMs,
        warmVsColdRatio: coldMs === 0 ? undefined : warmMs / coldMs,
    };
}

function fileMark(path: string): string {
    return path.replaceAll("/", "-").replaceAll(".", "-");
}

async function performanceCapture(
    page: Page,
    app: ElectronApplication,
    nativeProfilerActive: boolean,
): Promise<Record<string, unknown>> {
    const details: Record<string, unknown> = {};
    if (!nativeProfilerActive) {
        // The app-owned profiler is authoritative whenever its bridge is
        // running. Keep this bounded snapshot only for ordinary builds or a
        // missing bridge; otherwise Gym would collect the same heap/DOM/process
        // data a second time.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable").catch(() => undefined);
        const heap = await cdp.send("Runtime.getHeapUsage").catch(() => undefined);
        const dom = await cdp.send("Memory.getDOMCounters").catch(() => undefined);
        const metrics = await cdp.send("Performance.getMetrics").catch(() => undefined);
        if (heap !== undefined) details.heap = heap;
        if (dom !== undefined) details.dom = dom;
        if (metrics !== undefined) details.rendererMetrics = metrics;
        details.appMetrics = await app
            .evaluate(({ app: electronApp }) => ({
                processMemory: { ...process.memoryUsage() },
                appMetrics: electronApp.getAppMetrics(),
            }))
            .catch(() => undefined);
    } else {
        details.profiler = "happy-desktop-native";
    }
    details.url = page.url();
    details.title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText();
    details.textLength = bodyText.length;
    details.bodyText = bodyText.slice(0, 1_000);
    return details;
}

async function firstSessionLocation(
    sessionIds: readonly string[],
    runtime: StartedRigRuntime,
    preferWorkspace = false,
): Promise<{ readonly route: string; readonly sessionId: string } | undefined> {
    const ids = preferWorkspace ? [...sessionIds.slice(1), ...sessionIds.slice(0, 1)] : sessionIds;
    for (const id of ids) {
        const session = (await runtime.client.getSession(id)).session;
        const location = sessionLocation(session);
        if (location === undefined) continue;
        if (!preferWorkspace || location.workspace) return { route: location.route, sessionId: id };
    }
    return undefined;
}

function sessionLocation(session: { readonly id: string; readonly scope?: unknown }):
    | {
          readonly projectId?: string;
          readonly route: string;
          readonly scopeRoute: string;
          readonly workspace: boolean;
          readonly workspaceId?: string;
      }
    | undefined {
    const scope = isRecord(session.scope) ? session.scope : undefined;
    if (scope?.kind === "workspace" && typeof scope.workspaceId === "string") {
        return {
            route: `/chats/local/${scope.workspaceId}/${session.id}`,
            scopeRoute: `/chats/local/${scope.workspaceId}`,
            projectId: typeof scope.projectId === "string" ? scope.projectId : undefined,
            workspaceId: scope.workspaceId,
            workspace: true,
        };
    }
    if (scope?.kind === "project" && typeof scope.projectId === "string") {
        return {
            route: `/chats/local/${scope.projectId}/${session.id}`,
            scopeRoute: `/chats/local/${scope.projectId}`,
            projectId: scope.projectId,
            workspace: false,
        };
    }
    return undefined;
}

async function navigateRoute(page: Page, path: string): Promise<void> {
    await page.evaluate((nextPath) => {
        window.location.hash = nextPath;
    }, path);
    await page.waitForFunction((expected) => location.hash === `#${expected}`, path, {
        timeout: 10_000,
    });
}

async function waitForAny(page: Page, selectors: readonly string[]): Promise<void> {
    const timeout = Math.max(1_000, Math.floor(20_000 / Math.max(1, selectors.length)));
    for (const selector of selectors) {
        try {
            await page.locator(selector).first().waitFor({ state: "visible", timeout });
            return;
        } catch {
            // Try the next surface selector.
        }
    }
    throw new Error(`None of the expected workload selectors mounted: ${selectors.join(", ")}`);
}

function measurement(
    name: string,
    started: number,
    details: Record<string, unknown>,
    marks: readonly GymScenarioMark[] = [],
    startedAt?: string,
): GymMeasurement {
    const durationMs = performance.now() - started;
    const finishedAtMilliseconds = Date.now();
    const finishedAt = new Date(finishedAtMilliseconds).toISOString();
    const scenarioStartedAt =
        startedAt ??
        new Date(finishedAtMilliseconds - Math.max(0, Math.round(durationMs))).toISOString();
    const resultMarks = [...marks];
    if (!resultMarks.some((mark) => mark.name.endsWith(":scenario-start"))) {
        resultMarks.unshift({
            elapsedMs: 0,
            name: `${name}:scenario-start`,
            timestamp: scenarioStartedAt,
        });
    }
    if (!resultMarks.some((mark) => mark.name.endsWith(":scenario-end"))) {
        resultMarks.push({
            elapsedMs: durationMs,
            name: `${name}:scenario-end`,
            timestamp: finishedAt,
        });
    }
    return {
        details,
        durationMs,
        finishedAt,
        marks: resultMarks,
        name,
        profilerArtifacts: [],
        startedAt: scenarioStartedAt,
    };
}

async function scenarioMark(
    page: Page,
    marks: GymScenarioMark[],
    started: number,
    name: string,
): Promise<void> {
    marks.push({
        elapsedMs: performance.now() - started,
        name,
        timestamp: new Date().toISOString(),
    });
    await page
        .evaluate((markName) => {
            performance.mark(markName);
        }, name)
        .catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

async function waitForFileMutation(
    path: string,
    marker: string,
    minimumLines: number,
): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        try {
            const content = await readFile(path, "utf8");
            if (content.includes(marker) && content.trimEnd().split("\n").length >= minimumLines) {
                return;
            }
        } catch {
            // The managed checkout can be briefly unavailable while Rig
            // materializes the worktree; keep the barrier alive until its
            // explicit deadline.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for the real tool mutation at ${path}; marker=${marker}`);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await import("node:fs/promises").then(({ access }) => access(path));
        return true;
    } catch {
        return false;
    }
}
