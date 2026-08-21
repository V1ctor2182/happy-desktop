import type {
    DesktopConfig,
    DesktopDebugSnapshot,
    DesktopNoteApplyRequest,
    DesktopNoteContent,
    DesktopNoteSummary,
    DesktopRuntimeSnapshot,
    DesktopStartRequest,
    HappyDesktopBridge,
} from "../shared/desktopContract";
import type {
    DesktopProfilerRequest,
    DesktopProfilerSnapshot,
    DesktopReactDevtoolsCommand,
    DesktopReactDevtoolsMessage,
} from "../shared/desktopProfiler";

const endpoint = "/__happy2_local_rig";

const unsupportedDebugSnapshot: DesktopDebugSnapshot = {
    daemon: { status: "stopped" },
    daemonConnected: false,
    main: { status: "stopped" },
    renderer: { status: "stopped" },
    supported: false,
};

const unsupportedProfilerSnapshot: DesktopProfilerSnapshot = {
    capabilities: {
        liveDebuggerAttach: false,
        nativeTrace: false,
        processMetrics: false,
        reactAttribution: false,
        reactDevtoolsProfiling: false,
        rendererMetrics: false,
    },
    status: "unavailable",
};

function nativeDebugUnavailable(): never {
    throw new Error("Debugger attachment is available in the Electron desktop window.");
}

function nativeProfilerUnavailable(): never {
    throw new Error("Profiler capture is available in the Electron desktop window.");
}

interface DevResponse<Value> {
    error?: string;
    value?: Value;
}

async function request<Value>(action: string, input?: unknown): Promise<Value> {
    const response = await fetch(endpoint, {
        body: JSON.stringify({ action, input }),
        headers: { "content-type": "application/json" },
        method: "POST",
    });
    const result = (await response.json()) as DevResponse<Value>;
    if (!response.ok || result.error) throw new Error(result.error ?? "Local Rig request failed.");
    return result.value as Value;
}

/**
 * Creates the same renderer capability as the preload bridge, backed by the local
 * Vite server. The renderer reaches the daemon's health over the dev server's
 * `${endpoint}/health` route (advertised as `rigHttpUrl` in the runtime snapshot),
 * while machine-local file operations use the exact endpoint and the remaining
 * native-only operations degrade explicitly.
 */
export function browserDevBridgeCreate(): HappyDesktopBridge {
    return {
        // A normal browser exposes no native preferred-color-scheme override;
        // the application tree itself is already controlled by ThemeScope.
        appearanceSet: () => undefined,
        // A browser tab is told nothing about where a dropped file came from,
        // so every attachment here travels by value.
        attachmentSourcePath: () => undefined,
        browserProxyApply: async () => undefined,
        browserOpenSubscribe: () => () => undefined,
        browserStatusSubscribe: () => () => undefined,
        // Browser-local mode has no isolated Electron guest to relay from.
        guestKeySubscribe: () => () => undefined,
        // A browser tab hosts no preview guest, so no navigation is ever
        // reported and the subscription is a well-behaved no-op.
        previewNavigationSubscribe: () => () => undefined,
        // A browser tab already has the real thing — its own Back and Forward
        // buttons, and the trackpad gesture the browser drives from them — which
        // the window's own stack listens for directly. Nothing has to be relayed
        // through here, so the subscription is a well-behaved no-op.
        navigationStepSubscribe: () => () => undefined,
        // A browser tab has no Dock icon to mark, so the count goes nowhere
        // rather than the window branching on where it is running.
        dockUnreadSet: () => undefined,
        // The browser zooms the tab itself and draws its own read-out for it,
        // so there is nothing here to announce and no second bubble to add.
        zoomSubscribe: () => () => undefined,
        // A browser tab has no window of its own to open a file in, so it
        // offers none and the control is absent rather than present and broken.
        mediaPreviewOpen: async () => {
            throw new Error("This window cannot open a separate preview window.");
        },
        directoryPick: async () => undefined,
        desktopConfigGet: () => request<DesktopConfig>("desktopConfigGet"),
        desktopConfigWrite: (config) => request<void>("desktopConfigWrite", config),
        daemonDownload: async () => {
            throw new Error("Happy Agent downloads are available in the Electron desktop window.");
        },
        daemonGet: async () => ({
            installation: "installed",
            managed: false,
            operation: "idle",
            runtime: "ready",
            updateAvailable: false,
        }),
        daemonSubscribe: () => () => undefined,
        daemonUpgrade: async () => {
            throw new Error("Happy Agent updates are available in the Electron desktop window.");
        },
        debugGet: async () => unsupportedDebugSnapshot,
        debugAllStart: async () => nativeDebugUnavailable(),
        debugAllStop: async () => nativeDebugUnavailable(),
        debugMainInspectorStart: async () => nativeDebugUnavailable(),
        debugMainInspectorStop: async () => nativeDebugUnavailable(),
        debugRendererInspectorStart: async () => nativeDebugUnavailable(),
        debugRendererInspectorStop: async () => nativeDebugUnavailable(),
        debugDaemonInspectorStart: async () => nativeDebugUnavailable(),
        debugDaemonInspectorStop: async () => nativeDebugUnavailable(),
        debugSubscribe: () => () => undefined,
        profilerGet: async () => unsupportedProfilerSnapshot,
        profilerStart: async (_request?: DesktopProfilerRequest) => nativeProfilerUnavailable(),
        profilerStop: async () => nativeProfilerUnavailable(),
        profilerSubscribe: () => () => undefined,
        profilerReactMessage: (_message: DesktopReactDevtoolsMessage) => undefined,
        profilerReactSubscribe: (_listener: (command: DesktopReactDevtoolsCommand) => void) => () =>
            undefined,
        applicationMenuOpen: async () => undefined,
        noteApply: (apply: DesktopNoteApplyRequest) =>
            request<DesktopNoteSummary>("noteApply", apply),
        noteCreate: (title) => request<DesktopNoteContent>("noteCreate", title),
        noteRead: (id) => request<DesktopNoteContent>("noteRead", id),
        noteRemove: (id) => request<void>("noteRemove", id),
        noteRename: (id, title) => request<DesktopNoteSummary>("noteRename", { id, title }),
        notesList: () => request<readonly DesktopNoteSummary[]>("notesList"),
        // The development bridge has no push channel, so a change made outside
        // this window is picked up the next time the surface reads.
        notesSubscribe: () => () => undefined,
        // Browser-local development runs against a machine that already has Rig
        // and a daemon, and it has no native picker or PTY to run setup with, so
        // it reports setup as finished rather than presenting steps it cannot
        // truthfully perform.
        onboardingGet: async () => ({ busy: false, freshness: "used", stage: "complete" }) as const,
        onboardingSubscribe: () => () => undefined,
        onboardingProfileCreate: async () => undefined,
        onboardingProjectChoose: async () => undefined,
        runtimeGet: async () => {
            const snapshot = await request<DesktopRuntimeSnapshot>("runtimeGet");
            if (snapshot.phase !== "ready" || snapshot.activeTarget.mode !== "local")
                return snapshot;
            return {
                ...snapshot,
                activeTarget: {
                    ...snapshot.activeTarget,
                    rigHttpUrl: new URL(
                        snapshot.activeTarget.rigHttpUrl,
                        window.location.origin,
                    ).toString(),
                },
            };
        },
        runtimeReset: async () => undefined,
        runtimeRetry: async () => undefined,
        runtimeStart: async (_request: DesktopStartRequest) => undefined,
        topologySelect: async () => undefined,
        updateInstall: async () => undefined,
        // A browser tab has no native window chrome to reserve a lane for, so it
        // is permanently the windowed arrangement.
        windowStateGet: async () => ({ fullScreen: false }),
        windowStateSubscribe: () => () => undefined,
        subscribe(_listener: (snapshot: DesktopRuntimeSnapshot) => void) {
            return () => undefined;
        },
    };
}
