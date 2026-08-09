import type {
    DesktopConfig,
    DesktopNoteApplyRequest,
    DesktopNoteContent,
    DesktopNoteSummary,
    DesktopRuntimeSnapshot,
    DesktopStartRequest,
    HappyDesktopBridge,
    RigInstallTerminalEvent,
} from "../shared/desktopContract";

const endpoint = "/__happy2_local_rig";

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
        browserProxyApply: async () => undefined,
        browserOpenSubscribe: () => () => undefined,
        browserStatusSubscribe: () => () => undefined,
        // A browser tab hosts no preview guest, so no navigation is ever
        // reported and the subscription is a well-behaved no-op.
        previewNavigationSubscribe: () => () => undefined,
        // A browser tab has no Dock icon to mark, so the count goes nowhere
        // rather than the window branching on where it is running.
        dockUnreadSet: () => undefined,
        // A browser tab has no window of its own to open a file in, so it
        // offers none and the control is absent rather than present and broken.
        mediaPreviewOpen: async () => {
            throw new Error("This window cannot open a separate preview window.");
        },
        directoryPick: async () => undefined,
        desktopConfigGet: () => request<DesktopConfig>("desktopConfigGet"),
        desktopConfigWrite: (config) => request<void>("desktopConfigWrite", config),
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
        onboardingRigInstall: async () => undefined,
        onboardingProfileCreate: async () => undefined,
        onboardingMurmurChoose: async () => undefined,
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
        rigInstallOpen: () => request("unsupported"),
        rigInstallConfirm: async () => undefined,
        rigInstallInput: async () => undefined,
        rigInstallResize: async () => undefined,
        rigInstallClose: async () => undefined,
        topologySelect: async () => undefined,
        updateInstall: async () => undefined,
        // A browser tab has no native window chrome to reserve a lane for, so it
        // is permanently the windowed arrangement.
        windowStateGet: async () => ({ fullScreen: false }),
        windowStateSubscribe: () => () => undefined,
        subscribe(_listener: (snapshot: DesktopRuntimeSnapshot) => void) {
            return () => undefined;
        },
        rigInstallSubscribe(_listener: (event: RigInstallTerminalEvent) => void) {
            return () => undefined;
        },
    };
}
