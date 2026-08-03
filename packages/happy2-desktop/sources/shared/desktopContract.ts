export type DesktopMode = "local" | "cloud";

/** Appearance source the Electron shell applies to every local renderer and guest. */
export type DesktopAppearanceMode = "dark" | "light" | "system";

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
 * Where local first-run setup currently stands. The stage is always derived from
 * what this machine actually has — a Node runtime, the global `rig` command, a
 * connected daemon — plus the choices already recorded durably, so a restart, a
 * reinstall that keeps user data, or an interrupted install resumes at the same
 * stage or at the nearest truthful earlier one rather than at a remembered step
 * that may no longer be true.
 */
export type LocalOnboardingStage =
    /** The login-shell probe has not answered yet. */
    | "checking"
    /** No Node runtime; Happy cannot install one, so the person is asked to. */
    | "nodeMissing"
    /** Node is present, `rig` is not, and no install has been confirmed yet. */
    | "rigMissing"
    /** The confirmed `npm install --global @slopus/rig` is running in a real PTY. */
    | "rigInstalling"
    /** That install ended without a usable `rig`; its output stays on screen. */
    | "rigInstallFailed"
    /** `rig` exists; the normal user daemon is being started or connected to. */
    | "connecting"
    /** The daemon could not be reached; the desktop runtime carries the reason. */
    | "connectFailed"
    /** Local mode works; the Happy Cloud questions have not been answered. */
    | "cloud"
    /** Cloud was joined; the optional encrypted profile has not been decided. */
    | "profile"
    /** Everything else is settled and this Rig has no project yet. */
    | "project"
    | "complete";

/** The Node runtime the user's login shell resolves, when it resolves one. */
export interface LocalOnboardingNode {
    readonly path: string;
    /** As `node --version` reported it, for example `v22.11.0`. */
    readonly version: string;
}

/** The globally installed Rig command the user's login shell resolves. */
export interface LocalOnboardingRig {
    readonly path: string;
    /** Version of the running daemon, once one has been connected to. */
    readonly version?: string;
}

/**
 * What the person chose about Happy Cloud. The three answers are independent on
 * purpose: joining is one decision, letting other devices drive this machine is
 * another, and storing end-to-end encrypted session blobs so phones can read a
 * conversation is a third that can be declined while still joining.
 */
export interface LocalOnboardingCloudChoice {
    readonly joined: boolean;
    readonly remoteControl: boolean;
    readonly mobileSessions: boolean;
}

/** The install terminal as the window is allowed to see it. */
export interface LocalOnboardingInstall {
    readonly terminalId: string;
    readonly command: "npm install --global @slopus/rig";
    readonly running: boolean;
    /** Why the install ended unusable, once it has. */
    readonly message?: string;
}

export interface LocalOnboardingSnapshot {
    readonly stage: LocalOnboardingStage;
    readonly node?: LocalOnboardingNode;
    readonly rig?: LocalOnboardingRig;
    /**
     * True when the connected Rig holds no project of its own yet. Rig publishes
     * no first-run flag, so this is read from its catalog: an empty catalog is
     * the only observable evidence that this is a fresh Rig.
     */
    readonly rigFresh?: boolean;
    readonly install?: LocalOnboardingInstall;
    readonly cloud?: LocalOnboardingCloudChoice;
    /** Whether the optional encrypted Happy Profile was created; absent until asked. */
    readonly profileCreated?: boolean;
    /** The Git folder opened as the first project, once one has been. */
    readonly projectPath?: string;
    /** True while this process is doing the current stage's work. */
    readonly busy: boolean;
    /** Displayable detail for the current stage: why it failed, or what to do. */
    readonly message?: string;
}

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
 * One file a window of its own is showing, as that window is allowed to see it:
 * an address on one of this process's own Rig proxies, and the workspace path
 * read back out of it. Never a daemon endpoint, a token, or a path on disk the
 * window could read for itself.
 *
 * Whether it is a picture or a recording is not carried here either. The window
 * decides that from the path it was given, which came out of the address this
 * process already validated — a separately supplied kind would be a second claim
 * about one file, and the only thing a second claim can do is disagree.
 */
export interface DesktopMediaPreview {
    readonly url: string;
    readonly path: string;
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
 * One step in the life of one main-frame document inside an HTML preview guest.
 *
 * A preview reloads in place whenever the file behind it changes, so one guest
 * shows many documents and its `webContents` id identifies the guest, never the
 * page. `navigationId` is what identifies the page: it is monotonic per guest,
 * counts up once for every new document the main frame starts loading, and is
 * stamped on every step of that document's life.
 *
 * The steps are published by the main process on one channel, in the order that
 * process observed them, so a view never has to guess whether a response code
 * belongs to the document it is showing or to the one before it.
 */
export type DesktopPreviewNavigationStep =
    | {
          /** A new document has begun loading in the main frame. */
          readonly phase: "started";
          readonly url: string;
      }
    | {
          /** The document committed, with the response the server gave for it. */
          readonly phase: "responded";
          readonly url: string;
          /** `-1` for a navigation that is not HTTP. */
          readonly status: number;
          readonly statusText: string;
      }
    | {
          /** The document and everything it pulled in finished loading. */
          readonly phase: "loaded";
          readonly url: string;
      }
    | {
          /** The main frame's load failed outright; nothing committed. */
          readonly phase: "failed";
          readonly url: string;
          readonly code: number;
          readonly description: string;
      }
    | {
          /** The process drawing the page ended. */
          readonly phase: "gone";
          readonly url: string;
          readonly reason: string;
      };

export type DesktopPreviewNavigation = DesktopPreviewNavigationStep & {
    readonly guestId: number;
    readonly navigationId: number;
};

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
 * One plugin package installed on the machine running Rig, as the daemon
 * describes it.
 *
 * This is the package rather than what it contributes, which is why it is not
 * part of the application catalog. An application is a destination, pinned into
 * navigation for as long as a window is open; a package exists whether or not it
 * contributes any application at all, and is only ever read by the one screen
 * that is about packages.
 *
 * `contributions` carries the labels of this package's own applications, taken
 * from the same description the package arrived in. It is denormalized on
 * purpose: a package must be renderable from this object alone, never by joining
 * it against a separately delivered application list that may be a frame ahead
 * of it or behind it.
 *
 * Nothing here is an address this side could fetch. `directory` and
 * `dataDirectory` are paths on the daemon's machine, reported so a reader can be
 * told where a package lives, not so the renderer can open them.
 */
export interface DesktopPluginPackage {
    /** The plugin's folder name, which is the daemon's identity for the package. */
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    /** Who publishes the package, exactly as its own manifest names them. */
    readonly author: string;
    /** The one shelf the package declared for itself, from Rig's closed set. */
    readonly category: DesktopPluginCategory;
    /**
     * The package's own mark, once its bytes have been read and checked. It is
     * absent while it has not been read yet and stays absent when the daemon has
     * none to give, so a package without one is drawn with a generated mark and
     * nothing here is ever invented to fill the gap.
     */
    readonly icon?: DesktopPluginIcon;
    /** Whether the package's own code is up, stopped, or failed to start. */
    readonly status: "running" | "stopped" | "failed";
    /** The package's own words about the state it is in, when it offered any. */
    readonly statusMessage?: string;
    readonly error?: string;
    /** Where Rig installed the package's code, on the daemon's machine. */
    readonly directory: string;
    /** The folder the package writes to, on the daemon's machine. */
    readonly dataDirectory: string;
    readonly logAvailable: boolean;
    /** The labels of the applications this package contributes, in its own order. */
    readonly contributions: readonly string[];
}

/**
 * The shelf a package declared for itself: Rig's own closed set, restated here
 * rather than imported, so the renderer's contract does not depend on the daemon
 * client. A package that declares none is `other`, which Rig fills in.
 */
export type DesktopPluginCategory =
    | "automation"
    | "collaboration"
    | "data"
    | "developer-tools"
    | "media"
    | "productivity"
    | "utilities"
    | "other";

/**
 * One package's mark, as bytes already fetched under this process's own
 * credentials and already checked against the exact media type and size the
 * catalog declared for them.
 *
 * Only bytes cross. No path on the daemon's machine and no address the renderer
 * could fetch for itself is ever put here: a mark the renderer could ask for
 * would be a second way to reach the daemon, and an unauthenticated one.
 *
 * `generation` is the content hash the catalog declared for these bytes. It is
 * carried so a mark can be recognized as the same mark without comparing bytes,
 * which is what lets a decoded mark be kept across readings instead of being
 * rebuilt for every frame.
 */
export interface DesktopPluginIcon {
    readonly bytes: Uint8Array;
    readonly generation: string;
    readonly mediaType: "image/png";
}

/**
 * A folder Rig found where a package should be but could not read as one. It is
 * not a package and does not become one until the reason is fixed, so it is
 * reported beside the packages rather than among them.
 */
export interface DesktopPluginPackageFailure {
    readonly folder: string;
    readonly error: string;
}

/**
 * Everything this machine can say about the plugin packages installed on it.
 *
 * It is a separate reading from the application catalog and travels on its own
 * channel, because the two have different readers and different lifetimes: the
 * applications are pinned navigation a window follows the whole time it is open,
 * and this is one screen's subject, followed only while that screen is up.
 *
 * `error` is the feed's own failure, in words a reader may be shown. It never
 * empties `packages`: whatever was last read stays readable, and `connection` is
 * how a surface says that reading is old.
 */
export interface DesktopPluginInventory {
    /** Every installed package in the daemon's order, whatever each one is doing. */
    readonly packages: readonly DesktopPluginPackage[];
    /** Folders the daemon could not read as packages, and why. */
    readonly failures: readonly DesktopPluginPackageFailure[];
    readonly connection: DesktopPluginConnectionState;
    /** True until the first inventory has been received, so "none" is not claimed early. */
    readonly loading: boolean;
    /** Why the feed itself last failed, when it has; what is held stays held. */
    readonly error?: string;
}

/**
 * One inventory reading with the projection it belongs to named on it.
 *
 * A window opens a projection, may close it, and may open another one, while
 * readings for the closed one are still in the channel: a message already handed
 * to the transport is delivered whatever has happened since. The token is how a
 * reading that belongs to a projection nobody is on any more is recognized as
 * such, instead of being taken for the current one and counted as the newest
 * thing the machine said. It is opaque, and it never reaches the renderer.
 */
export interface DesktopPluginInventoryFrame {
    readonly token: string;
    readonly inventory: DesktopPluginInventory;
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
    /**
     * Makes Chromium's preferred color scheme follow Happy's selection, so
     * previews, browser guests, plugin frames, and auxiliary windows agree with
     * the application tree instead of independently following macOS.
     */
    appearanceSet(mode: DesktopAppearanceMode): void;
    browserProxyApply(sessionId: string): Promise<void>;
    /** The current plugin application catalog, without waiting for the next change. */
    pluginApplicationsGet(): Promise<DesktopPluginCatalog>;
    pluginApplicationsSubscribe(listener: (catalog: DesktopPluginCatalog) => void): () => void;
    /**
     * Follows the packages installed on this machine, for the one screen that
     * reads them.
     *
     * Unlike the application catalog there is no separate read: subscribing is
     * what starts the machine being projected at all, and the opening reading
     * arrives through the listener. Asking and following cannot be two steps,
     * because a change between them would be a frame nobody was told about.
     * Releasing the last subscription stops the work entirely.
     */
    pluginInventorySubscribe(listener: (inventory: DesktopPluginInventory) => void): () => void;
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
     * The ordered life of every HTML preview guest in this window. A view claims
     * the steps carrying its own guest id and follows one navigation at a time.
     */
    previewNavigationSubscribe(listener: (step: DesktopPreviewNavigation) => void): () => void;
    /**
     * Reports how many conversations are waiting for the person, for the mark on
     * the Dock icon. One-way and fire-and-forget: the window states what it is
     * showing and the shell paints it, so nothing above this line has to wait on
     * or reconcile with the operating system.
     */
    dockUnreadSet(count: number): void;
    /**
     * Shows the file at one address in a window outside this one, reusing the
     * preview window if it is already open. Rejected unless the address is the
     * media route of a Rig proxy this process is currently running.
     */
    mediaPreviewOpen(url: string): Promise<void>;
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
    /** Where local first-run setup stands, without waiting for its next change. */
    onboardingGet(): Promise<LocalOnboardingSnapshot>;
    onboardingSubscribe(listener: (snapshot: LocalOnboardingSnapshot) => void): () => void;
    /**
     * The person's explicit confirmation to install Rig. This process opens the
     * PTY and runs the fixed command; the window only draws it and forwards
     * keystrokes through `rigInstallInput`/`rigInstallResize`.
     */
    onboardingRigInstall(cols: number, rows: number): Promise<void>;
    onboardingCloudSubmit(choice: LocalOnboardingCloudChoice): Promise<void>;
    onboardingProfileSubmit(create: boolean): Promise<void>;
    /**
     * Opens the native folder picker, requires a Git repository root, and opens
     * it as this Rig's first project. Picking, validating, and registering all
     * happen in the main process; the window never learns a path it did not
     * already receive in a snapshot.
     */
    onboardingProjectChoose(): Promise<void>;
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

/**
 * The whole capability of the window that shows one file.
 *
 * It is deliberately not `HappyDesktopBridge`: a window whose only job is to
 * show one picture or play one recording has no business reading notes, writing
 * preferences, choosing a topology, or hosting a plugin, so it is handed a
 * bridge that cannot do any of them rather than the application's and a promise
 * not to use it.
 */
export interface HappyMediaPreviewBridge {
    /** What this window was opened for; it has not been sent anything yet. */
    mediaPreviewGet(): Promise<DesktopMediaPreview | undefined>;
    /** Fires when the window is pointed at a different file. */
    mediaPreviewSubscribe(listener: (preview: DesktopMediaPreview | undefined) => void): () => void;
    /** Closes this window from inside it. */
    mediaPreviewClose(): Promise<void>;
}

export const desktopIpc = {
    /** Renderer → main only: the appearance source inherited by local web contents. */
    appearanceSet: "happy2:appearance:set",
    browserProxyApply: "happy2:browser:proxy-apply",
    browserOpenRequested: "happy2:browser:open-requested",
    browserStatusChanged: "happy2:browser:status-changed",
    previewNavigationChanged: "happy2:html-preview:navigation-changed",
    directoryPick: "happy2:directory:pick",
    mediaPreviewChanged: "happy2:media-preview:changed",
    mediaPreviewClose: "happy2:media-preview:close",
    mediaPreviewGet: "happy2:media-preview:get",
    mediaPreviewOpen: "happy2:media-preview:open",
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
    onboardingChanged: "happy2:onboarding:changed",
    onboardingCloudSubmit: "happy2:onboarding:cloud-submit",
    onboardingGet: "happy2:onboarding:get",
    onboardingProfileSubmit: "happy2:onboarding:profile-submit",
    onboardingProjectChoose: "happy2:onboarding:project-choose",
    onboardingRigInstall: "happy2:onboarding:rig-install",
    /** Withdraws one host operation the application's View no longer wants. */
    pluginAppCancel: "happy2:plugins:app-cancel",
    /** One host operation, on behalf of the application at the given origin. */
    pluginAppRequest: "happy2:plugins:app-request",
    pluginApplicationsChanged: "happy2:plugins:changed",
    pluginApplicationsGet: "happy2:plugins:get",
    /** One reading, named with the projection it belongs to. */
    pluginInventoryChanged: "happy2:plugins:inventory-changed",
    /**
     * Starts following what is installed under a projection the window names,
     * answering with the reading as it stands under that same name.
     */
    pluginInventoryFollow: "happy2:plugins:inventory-follow",
    /** Stops following one projection, named so a late one cannot close a later. */
    pluginInventoryUnfollow: "happy2:plugins:inventory-unfollow",
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

/**
 * Query the preview window is loaded with, so the renderer entry mounts only the
 * file instead of the whole application. It is a property of the window's own
 * address rather than something asked for over the bridge, so the first frame is
 * already the right one.
 */
export const mediaPreviewView = { key: "view", value: "media-preview" } as const;

/**
 * Launch argument that tells the preload it is loading the preview window, so
 * the reduced bridge is chosen before the page exists rather than inferred from
 * an address the page could later change.
 */
export const mediaPreviewArgument = "--happy2-media-preview";
