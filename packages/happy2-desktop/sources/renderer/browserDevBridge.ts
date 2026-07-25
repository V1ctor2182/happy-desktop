import type {
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
 * so host operations are the only surface this bridge stubs.
 */
export function browserDevBridgeCreate(): HappyDesktopBridge {
    return {
        directoryPick: async () => undefined,
        applicationMenuOpen: async () => undefined,
        runtimeGet: () => request("runtimeGet"),
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
        subscribe(_listener: (snapshot: DesktopRuntimeSnapshot) => void) {
            return () => undefined;
        },
        rigInstallSubscribe(_listener: (event: RigInstallTerminalEvent) => void) {
            return () => undefined;
        },
    };
}
