export type DesktopMode = "local" | "cloud";

/** Access granted to a newly created local Rig session. */
export type DesktopPermissionMode = "auto" | "workspace_write" | "read_only" | "full_access";

/** One provider-qualified model identity in desktop preferences. */
export interface DesktopModelIdentity {
    readonly providerId: string;
    readonly modelId: string;
}

/** The explicit model and effort a new desktop session starts with. */
export interface DesktopDefaultModel extends DesktopModelIdentity {
    readonly effort?: string;
}

/** The choices most recently made while using one provider-qualified model. */
export interface DesktopModelPreference extends DesktopModelIdentity {
    readonly lastEffort?: string;
    /** `standard` names the provider's ordinary tier; every other value is a catalog tier. */
    readonly lastSpeed: string;
}

/**
 * Machine-local desktop preferences. Model ids are provider-qualified because
 * the same model can be offered through more than one account/provider.
 */
export interface DesktopConfig {
    readonly defaultModel?: DesktopDefaultModel;
    readonly defaultEffort: string;
    readonly defaultPermissionMode: DesktopPermissionMode;
    readonly lastPickedModel?: DesktopModelIdentity;
    readonly modelPreferences: readonly DesktopModelPreference[];
    readonly version: 1;
}

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

/**
 * What a development build calls itself. A packaged Happy reports none: only a
 * build run from a checkout has to be told apart from the other one beside it.
 */
export interface DesktopBuildIdentity {
    readonly branch: string;
    /** Short name for this checkout: its worktree directory, its branch, or "dev". */
    readonly label: string;
    /** Absolute path of the checkout, which is the detail worth copying. */
    readonly path: string;
}

/** Launch argument prefix carrying `DesktopBuildIdentity` JSON into the preload. */
export const buildIdentityArgument = "--happy2-build-identity=";

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

/**
 * HTTP result of one committed browser-guest navigation. Only the main process
 * sees a guest's response code, so it forwards it to the renderer keyed by the
 * guest's `webContents` id; a renderer tab claims the events for its own guest.
 */
export interface DesktopBrowserStatus {
    readonly guestId: number;
    readonly url: string;
    readonly status: number;
    readonly statusText: string;
}

/**
 * One local plugin application as the renderer is allowed to see it.
 *
 * The renderer never learns the daemon endpoint, its token, the plugin's folder
 * on disk, or any address it could fetch itself. It receives an identity to
 * navigate to, a label to draw, and — only once the whole bundle is cached and
 * still current — the isolated origin its view may be pointed at. `generation`
 * is carried through so a click, a mount, and an action all name the same code;
 * a changed generation is a replacement, never an update in place.
 */
export interface DesktopPluginApplication {
    /** Stable navigation identity: `<plugin folder>:<authored application id>`. */
    readonly id: string;
    /** Opaque identity of the running plugin process that declared this bundle. */
    readonly generation: string;
    readonly pluginId: string;
    readonly title: string;
    readonly label: string;
    readonly order: number;
    /**
     * `loading` while the bundle is being prefetched, `ready` once every declared
     * resource is cached, `error` when the bundle could not be completed. Only a
     * `ready` application carries a `source`.
     */
    readonly status: "loading" | "ready" | "error";
    readonly error?: string;
    /** Entry address on this generation's isolated origin, present only when ready. */
    readonly source?: string;
}

/** Where the catalog subscription itself is, so a surface can say why it is empty. */
export type DesktopPluginConnectionState = "connecting" | "live" | "reconnecting" | "closed";

export interface DesktopPluginCatalog {
    /** Every contributed application in the daemon's navigation order. */
    readonly applications: readonly DesktopPluginApplication[];
    readonly connection: DesktopPluginConnectionState;
    /** True until the first catalog has been received, so "none" is not claimed early. */
    readonly loading: boolean;
}

/**
 * One host operation a mounted plugin application asked for, as the MCP Apps
 * host received it from that application's own frame.
 *
 * The set is closed and each member carries only what that operation takes.
 * Which application and which generation is asking is never in here: it is the
 * origin the message arrived on, which the browser stamps and a page cannot
 * choose for itself.
 */
export type DesktopPluginAppRequest =
    | { readonly kind: "toolCall"; readonly name: string; readonly arguments: unknown }
    | { readonly kind: "resourceRead"; readonly uri: string }
    | { readonly kind: "storageGet"; readonly key: string }
    | { readonly kind: "storageSet"; readonly key: string; readonly value: unknown }
    | { readonly kind: "storageDelete"; readonly key: string }
    | { readonly kind: "storageList" };

export interface HappyDesktopBridge {
    /**
     * This window's development identity, absent in a packaged build. It is a
     * plain value rather than a call because the window is one build for its
     * whole life: the shell has it before the first frame and it never changes.
     */
    readonly buildIdentity?: DesktopBuildIdentity;
    browserProxyApply(sessionId: string): Promise<void>;
    /** The current plugin application catalog, without waiting for the next change. */
    pluginApplicationsGet(): Promise<DesktopPluginCatalog>;
    pluginApplicationsSubscribe(listener: (catalog: DesktopPluginCatalog) => void): () => void;
    /**
     * Performs one host operation for the plugin application mounted at `origin`.
     * The window reads that origin from the message event the request arrived in,
     * so the page never names which application it is.
     */
    pluginAppRequest(
        origin: string,
        requestId: string,
        request: DesktopPluginAppRequest,
    ): Promise<unknown>;
    /**
     * Withdraws the operation started under `requestId` for the application at
     * `origin`. The window sends this when a View cancels its JSON-RPC request,
     * so the work behind it stops instead of running on unwatched.
     */
    pluginAppCancel(origin: string, requestId: string): Promise<void>;
    browserOpenSubscribe(listener: (url: string) => void): () => void;
    browserStatusSubscribe(listener: (status: DesktopBrowserStatus) => void): () => void;
    /**
     * Reports how many conversations are waiting for the person, for the mark on
     * the Dock icon. One-way and fire-and-forget: the window states what it is
     * showing and the shell paints it, so nothing above this line has to wait on
     * or reconcile with the operating system.
     */
    dockUnreadSet(count: number): void;
    directoryPick(): Promise<string | undefined>;
    desktopConfigGet(): Promise<DesktopConfig>;
    desktopConfigWrite(config: DesktopConfig): Promise<void>;
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
    browserStatusChanged: "happy2:browser:status-changed",
    directoryPick: "happy2:directory:pick",
    /** Renderer → main only: the number of conversations waiting for the person. */
    dockUnreadSet: "happy2:dock:unread-set",
    desktopConfigGet: "happy2:desktop-config:get",
    desktopConfigWrite: "happy2:desktop-config:write",
    applicationMenuOpen: "happy2:application-menu:open",
    noteApply: "happy2:notes:apply",
    noteCreate: "happy2:notes:create",
    noteRead: "happy2:notes:read",
    noteRemove: "happy2:notes:remove",
    noteRename: "happy2:notes:rename",
    notesChanged: "happy2:notes:changed",
    notesList: "happy2:notes:list",
    /** Withdraws one host operation the application's View no longer wants. */
    pluginAppCancel: "happy2:plugins:app-cancel",
    /** One host operation, on behalf of the application at the given origin. */
    pluginAppRequest: "happy2:plugins:app-request",
    pluginApplicationsChanged: "happy2:plugins:changed",
    pluginApplicationsGet: "happy2:plugins:get",
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

/**
 * Scheme the main process serves cached plugin bundles on. Each generation gets
 * its own opaque host under it, so two generations are two origins and nothing
 * a replaced bundle left behind is reachable from the one that replaced it.
 */
export const happyPluginScheme = "happy-plugin";

/**
 * In-memory Chromium profile used only by rendered HTML file previews. It is
 * deliberately not persistent and not the browser's: a previewed page keeps no
 * cookies or storage between sessions, and can reach nothing the browser tabs
 * are logged into.
 */
export const happyHtmlPreviewPartition = "happy2-html-preview";
