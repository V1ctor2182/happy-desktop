export type DesktopMode = "local" | "cloud";

export type DesktopStartRequest =
    | { mode: "local" }
    | {
          mode: "cloud";
          serverUrl: string;
      };

export type DesktopTopology =
    | {
          id: string;
          mode: "local";
      }
    | {
          id: string;
          mode: "cloud";
          serverUrl: string;
      };

export interface DesktopTopologyTarget {
    detail: string;
    id: string;
    kind: "local" | "remote";
    label: string;
    mode: DesktopMode;
}

export type DesktopActiveTarget =
    | (DesktopTopologyTarget & {
          authentication: "rig";
          mode: "local";
          rigVersion: string;
          /**
           * Loopback base URL of the main process's Rig HTTP proxy. The renderer's
           * connection loader probes `${rigHttpUrl}/health` directly; this is the
           * only channel the renderer uses to reach the local daemon.
           */
          rigHttpUrl: string;
      })
    | (DesktopTopologyTarget & {
          authentication: "account";
          mode: "cloud";
          serverUrl: string;
      });

export interface DesktopUpdateSnapshot {
    availableVersion?: string;
    message?: string;
    status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
}

export type DesktopRuntimeSnapshot =
    | {
          phase: "choosing";
          targets: readonly DesktopTopologyTarget[];
          update: DesktopUpdateSnapshot;
      }
    | {
          phase: "starting";
          message: string;
          request: DesktopStartRequest;
          targets: readonly DesktopTopologyTarget[];
          update: DesktopUpdateSnapshot;
      }
    | {
          phase: "installRequired";
          command: "npm install --global @slopus/rig";
          message: string;
          request: Extract<DesktopStartRequest, { readonly mode: "local" }>;
          targets: readonly DesktopTopologyTarget[];
          update: DesktopUpdateSnapshot;
      }
    | {
          phase: "ready";
          activeTarget: DesktopActiveTarget;
          activeTargetId: string;
          connectionId: number;
          mode: DesktopMode;
          targets: readonly DesktopTopologyTarget[];
          update: DesktopUpdateSnapshot;
      }
    | {
          phase: "error";
          message: string;
          request: DesktopStartRequest;
          retryable: boolean;
          targets: readonly DesktopTopologyTarget[];
          update: DesktopUpdateSnapshot;
      };

/**
 * The window chrome the renderer cannot observe for itself. macOS full screen
 * hides the traffic lights without changing any CSS display mode, so the shell
 * would otherwise keep reserving the lane they left behind.
 */
export interface DesktopWindowState {
    readonly fullScreen: boolean;
}

/** An SSH destination — `host` or `user@host` — and the name to list it under. */
export interface RemoteRigAddRequest {
    readonly destination: string;
    readonly label?: string;
}

/**
 * One remembered machine as the renderer sees it. `connected` is the reader's
 * standing intent and `status` is where the connection actually is, so a machine
 * that is reachable again shows up without the reader asking twice. `rigHttpUrl`
 * is the loopback proxy the renderer opens its transports on; nothing the SSH
 * connection reads from the machine crosses this boundary.
 */
export interface RemoteRigSnapshot {
    readonly connected: boolean;
    readonly destination: string;
    readonly id: string;
    readonly label: string;
    readonly message?: string;
    readonly rigHttpUrl?: string;
    readonly status: "connecting" | "connected" | "disconnected" | "error";
    readonly version?: string;
}

export interface RigInstallTerminalOpenResponse {
    readonly terminalId: string;
    readonly command: "npm install --global @slopus/rig";
    readonly status: "awaitingConfirmation" | "running" | "exited";
}

export type RigInstallTerminalEvent =
    | { readonly type: "output"; readonly terminalId: string; readonly data: string }
    | {
          readonly type: "exited";
          readonly terminalId: string;
          readonly exitCode: number;
          readonly verified: boolean;
          readonly message?: string;
      };

/**
 * One note in this machine's collection. A note belongs to the machine rather
 * than to a Rig connection, so it travels over the desktop bridge instead of a
 * Rig's HTTP proxy and stays available whichever Rig the window is looking at.
 */
export interface DesktopNoteSummary {
    readonly id: string;
    readonly title: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly sequence: number;
    readonly excerpt: string;
}

export interface DesktopNoteContent {
    readonly note: DesktopNoteSummary;
    /** Complete collaborative state as one base64 Yjs update. */
    readonly state: string;
}

export interface DesktopNoteApplyRequest {
    readonly id: string;
    readonly updates: readonly string[];
    /**
     * The author's normalized Markdown after these updates. The editor's schema
     * lives with the editor, so the writer derives this and the main process
     * stores it beside the note without interpreting the collaborative bytes.
     */
    readonly markdown?: string;
    readonly title?: string;
}

export interface HappyDesktopBridge {
    browserProxyApply(sessionId: string): Promise<void>;
    browserOpenSubscribe(listener: (url: string) => void): () => void;
    directoryPick(): Promise<string | undefined>;
    noteApply(request: DesktopNoteApplyRequest): Promise<DesktopNoteSummary>;
    noteCreate(title?: string): Promise<DesktopNoteContent>;
    noteRead(id: string): Promise<DesktopNoteContent>;
    noteRemove(id: string): Promise<void>;
    noteRename(id: string, title: string): Promise<DesktopNoteSummary>;
    notesList(): Promise<readonly DesktopNoteSummary[]>;
    /** Fires whenever the collection changes, including edits made outside Happy. */
    notesSubscribe(listener: () => void): () => void;
    applicationMenuOpen(): Promise<void>;
    remoteRigAdd(request: RemoteRigAddRequest): Promise<void>;
    remoteRigConnect(id: string): Promise<void>;
    remoteRigDisconnect(id: string): Promise<void>;
    remoteRigGet(): Promise<readonly RemoteRigSnapshot[]>;
    remoteRigRemove(id: string): Promise<void>;
    remoteRigSubscribe(listener: (rigs: readonly RemoteRigSnapshot[]) => void): () => void;
    runtimeGet(): Promise<DesktopRuntimeSnapshot>;
    runtimeReset(): Promise<void>;
    runtimeRetry(): Promise<void>;
    runtimeStart(request: DesktopStartRequest): Promise<void>;
    rigInstallOpen(): Promise<RigInstallTerminalOpenResponse>;
    rigInstallConfirm(terminalId: string, cols: number, rows: number): Promise<void>;
    rigInstallInput(terminalId: string, data: string): Promise<void>;
    rigInstallResize(terminalId: string, cols: number, rows: number): Promise<void>;
    rigInstallClose(terminalId: string): Promise<void>;
    topologySelect(topologyId: string): Promise<void>;
    updateInstall(): Promise<void>;
    windowStateGet(): Promise<DesktopWindowState>;
    windowStateSubscribe(listener: (state: DesktopWindowState) => void): () => void;
    subscribe(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
    rigInstallSubscribe(listener: (event: RigInstallTerminalEvent) => void): () => void;
}

export const desktopIpc = {
    browserProxyApply: "happy2:browser:proxy-apply",
    browserOpenRequested: "happy2:browser:open-requested",
    directoryPick: "happy2:directory:pick",
    applicationMenuOpen: "happy2:application-menu:open",
    noteApply: "happy2:notes:apply",
    noteCreate: "happy2:notes:create",
    noteRead: "happy2:notes:read",
    noteRemove: "happy2:notes:remove",
    noteRename: "happy2:notes:rename",
    notesChanged: "happy2:notes:changed",
    notesList: "happy2:notes:list",
    remoteRigAdd: "happy2:remote-rig:add",
    remoteRigChanged: "happy2:remote-rig:changed",
    remoteRigConnect: "happy2:remote-rig:connect",
    remoteRigDisconnect: "happy2:remote-rig:disconnect",
    remoteRigGet: "happy2:remote-rig:get",
    remoteRigRemove: "happy2:remote-rig:remove",
    runtimeChanged: "happy2:runtime:changed",
    runtimeGet: "happy2:runtime:get",
    runtimeReset: "happy2:runtime:reset",
    runtimeRetry: "happy2:runtime:retry",
    runtimeStart: "happy2:runtime:start",
    rigInstallOpen: "happy2:rig-install:open",
    rigInstallConfirm: "happy2:rig-install:confirm",
    rigInstallInput: "happy2:rig-install:input",
    rigInstallResize: "happy2:rig-install:resize",
    rigInstallClose: "happy2:rig-install:close",
    rigInstallEvent: "happy2:rig-install:event",
    topologySelect: "happy2:topology:select",
    updateInstall: "happy2:update:install",
    windowStateChanged: "happy2:window-state:changed",
    windowStateGet: "happy2:window-state:get",
} as const;

/** Persistent, capability-isolated Chromium profile used only by embedded browser tabs. */
export const happyBrowserPartition = "persist:happy2-browser";
