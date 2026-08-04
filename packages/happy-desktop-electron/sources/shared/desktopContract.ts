export type DesktopMode = "local";

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

export type DesktopStartRequest = { mode: "local" };

export type DesktopTopology = {
    id: string;
    mode: "local";
};

export interface DesktopTopologyTarget {
    detail: string;
    id: string;
    kind: "local" | "remote";
    label: string;
    mode: DesktopMode;
}

export type DesktopActiveTarget = DesktopTopologyTarget & {
    authentication: "rig";
    mode: "local";
    rigVersion: string;
    /**
     * Loopback base URL of the main process's Rig HTTP proxy. The renderer's
     * connection loader probes `${rigHttpUrl}/health` directly; this is the
     * only channel the renderer uses to reach the local daemon.
     */
    rigHttpUrl: string;
};

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
    /** The local runtime is not active yet, so setup has nothing to inspect. */
    | "inactive"
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
    /** Whether this Rig has ever been used is still being read from it. */
    | "examining"
    /** Everything else is settled and this Rig is demonstrably unused. */
    | "project"
    | "complete";

/**
 * How much is known about whether the connected Rig has been used before.
 *
 * It is deliberately not a boolean with an absent third case: "not read yet"
 * and "could not be read" are different from "this Rig is new", and only the
 * last of them may ever lead to Happy registering anything in someone's Rig.
 */
export type LocalOnboardingFreshness =
    /** No authoritative answer yet for the Rig currently connected. */
    | "checking"
    /** This Rig holds no project of its own: it has never been used.  */
    | "fresh"
    /** This Rig already holds projects, archived or not. */
    | "used"
    /** Its catalog could not be read, so nothing may be concluded from it. */
    | "error";

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
     * Whether the Rig connected right now has ever been used. Rig publishes no
     * first-run flag, so this is read from its catalog and is re-read for every
     * connection: a replaced Rig data directory is a different answer, and a
     * remembered one would let setup skip or repeat itself untruthfully.
     */
    readonly freshness: LocalOnboardingFreshness;
    readonly install?: LocalOnboardingInstall;
    /** The Git folder most recently opened as a project, for display only. */
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

export interface HappyDesktopBridge {
    /**
     * This window's development identity, absent in a packaged build. It is a
     * plain value rather than a call because the window is one build for its
     * whole life: the shell has it before the first frame and it never changes.
     */
    readonly buildIdentity?: DesktopBuildIdentity;
    /**
     * Makes Chromium's preferred color scheme follow Happy's selection, so
     * previews, browser guests, and auxiliary windows agree with
     * the application tree instead of independently following macOS.
     */
    appearanceSet(mode: DesktopAppearanceMode): void;
    browserProxyApply(sessionId: string): Promise<void>;
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
 * preferences or choosing a topology, so it is handed a
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
    onboardingGet: "happy2:onboarding:get",
    onboardingProjectChoose: "happy2:onboarding:project-choose",
    onboardingRigInstall: "happy2:onboarding:rig-install",
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
