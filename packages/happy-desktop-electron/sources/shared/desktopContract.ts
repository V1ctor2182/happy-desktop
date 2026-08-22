import type {
    DesktopProfilerRequest,
    DesktopProfilerSnapshot,
    DesktopReactDevtoolsCommand,
    DesktopReactDevtoolsMessage,
} from "./desktopProfiler";

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
 * Machine-local desktop preferences. Appearance and explicit title motion
 * belong here because they must survive every window and Rig lifetime. Model
 * ids are provider-qualified because the same model can be offered through more
 * than one account/provider.
 */
export interface DesktopConfig {
    readonly appearance: DesktopAppearanceMode;
    readonly defaultModel?: DesktopDefaultModel;
    readonly defaultEffort: string;
    readonly defaultPermissionMode: DesktopPermissionMode;
    readonly lastPickedModel?: DesktopModelIdentity;
    readonly modelPreferences: readonly DesktopModelPreference[];
    readonly titleShimmerEnabled?: boolean;
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

/**
 * One Happy Agent version this machine can run: either published for this
 * platform, already downloaded here, or both. `downloaded` is what decides
 * whether choosing it needs the network.
 */
export interface DesktopDaemonVersion {
    readonly downloaded: boolean;
    readonly prerelease: boolean;
    readonly version: string;
}

/** The machine-local Happy Agent installation and the daemon currently serving it. */
export interface DesktopDaemonSnapshot {
    readonly availableVersion?: string;
    readonly error?: string;
    readonly installation: "missing" | "installed";
    readonly installedVersion?: string;
    readonly managed: boolean;
    readonly message?: string;
    readonly operation: "idle" | "checking" | "downloading" | "upgrading";
    readonly runtime: "stopped" | "starting" | "ready";
    readonly updateAvailable: boolean;
    /**
     * Every version that can be chosen, newest first. Empty until the first
     * catalog read answers; a version downloaded here always appears, even when
     * GitHub no longer lists it.
     */
    readonly versions: readonly DesktopDaemonVersion[];
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
          /**
           * Another attempt is running right now, started from this failure. The
           * failure stays published so the window can keep the screen the person
           * is reading and put the waiting on its retry control instead.
           */
          retrying?: boolean;
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

/** One native keyboard event relayed from an embedded browser/preview guest. */
export interface DesktopGuestKeyEvent {
    readonly altKey: boolean;
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly isComposing: boolean;
    readonly key: string;
    readonly location: number;
    readonly metaKey: boolean;
    readonly repeat: boolean;
    readonly shiftKey: boolean;
    readonly type: "keydown" | "keyup";
}

export type DesktopDebugTargetStatus =
    | "stopped"
    | "starting"
    | "running"
    | "stopping"
    | "unavailable"
    | "error";

/** One live debugger attachment point owned by the native shell. */
export interface DesktopDebugTargetSnapshot {
    readonly error?: string;
    readonly status: DesktopDebugTargetStatus;
    readonly url?: string;
}

/** The three runtimes an external CDP client can attach to from Dev Tools. */
export interface DesktopDebugSnapshot {
    readonly daemonConnected: boolean;
    readonly daemon: DesktopDebugTargetSnapshot;
    readonly main: DesktopDebugTargetSnapshot;
    readonly renderer: DesktopDebugTargetSnapshot;
    readonly supported: boolean;
}

/** Native renderer profiling is separate from debugger endpoint lifetimes. */
export type DesktopProfilerStartRequest = DesktopProfilerRequest;

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
    /** Node is present but the global `rig` command is unavailable. */
    | "rigMissing"
    /** Happy Agent is not installed yet; the renderer may ask the shell to download it. */
    | "daemonDownload"
    /** `rig` exists; the normal user daemon is being started or connected to. */
    | "connecting"
    /** The daemon could not be reached; the desktop runtime carries the reason. */
    | "connectFailed"
    /**
     * Rig is installed and working, but no coding assistant on this machine is
     * signed in, so it has nothing to run a session with. Kept apart from
     * `connectFailed` because nothing is broken: this is the last ordinary step
     * of setting the machine up, and it clears itself the moment an assistant is
     * signed in.
     */
    | "providersMissing"
    /** Rig requires a human identity before it can finish setup. */
    | "profileRequired"
    /** Rig Connect is resolving the daemon-owned onboarding status. */
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
    /** The Git folder most recently opened as a project, for display only. */
    readonly projectPath?: string;
    /** True while this process is doing the current stage's work. */
    readonly busy: boolean;
    /** Displayable detail for the current stage: why it failed, or what to do. */
    readonly message?: string;
    /**
     * The coding assistants Rig looked for and found no credentials for, in the
     * order it named them. Present only at `providersMissing`.
     */
    readonly providers?: readonly string[];
    /** An attempt to reach Rig is running, started from a failed stage. */
    readonly retrying?: boolean;
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

/** Which local session's network a browser guest browses through. */
export interface DesktopBrowserProxyTarget {
    readonly sessionId: string;
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

/**
 * A request to move through this window's navigation stack, from the inputs an
 * OS offers: the mouse's side buttons, the trackpad swipe, the menu items. Only
 * the main process sees them, and none says *where* to go — only which
 * direction. The window holds the stack and decides what that lands on.
 */
export type DesktopNavigationStep = {
    readonly direction: "back" | "forward";
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
    /**
     * Where a file the reader dropped, picked, or pasted actually lives on this
     * machine, when it lives anywhere. A file the browser only holds in memory —
     * a pasted screenshot — has no path and answers undefined.
     *
     * It is what lets an attachment be copied where it is going instead of read
     * into the renderer, expanded to base64, and pushed back out through a JSON
     * body every hop holds whole. A video is the case that makes that plain.
     */
    attachmentSourcePath(file: File): string | undefined;
    /** Points this window's browser guests at one local Rig session's network boundary. */
    browserProxyApply(target: DesktopBrowserProxyTarget): Promise<void>;
    browserOpenSubscribe(listener: (url: string) => void): () => void;
    browserStatusSubscribe(listener: (status: DesktopBrowserStatus) => void): () => void;
    /**
     * Relays Command keyboard input while an isolated browser or HTML preview
     * guest owns focus. The renderer dispatches it through the same window
     * shortcut path as native host input.
     */
    guestKeySubscribe(listener: (event: DesktopGuestKeyEvent) => void): () => void;
    /**
     * The ordered life of every HTML preview guest in this window. A view claims
     * the steps carrying its own guest id and follows one navigation at a time.
     */
    previewNavigationSubscribe(listener: (step: DesktopPreviewNavigation) => void): () => void;
    /** Back and Forward, as asked for by the mouse, the trackpad, or the menu. */
    navigationStepSubscribe(listener: (step: DesktopNavigationStep) => void): () => void;
    /**
     * Reports how many conversations are waiting for the person, for the mark on
     * the Dock icon. One-way and fire-and-forget: the window states what it is
     * showing and the shell paints it, so nothing above this line has to wait on
     * or reconcile with the operating system.
     */
    dockUnreadSet(count: number): void;
    /**
     * Fires every time zoom is asked for, with the whole-number percentage the
     * window is now at — including when the answer is the one it was already
     * showing, because ⌘0 at 100% and ⌘− against the floor are exactly the
     * moments the reader needs telling that the command landed.
     *
     * The View menu owns zooming, not the page, so the value is pushed from the
     * main process rather than inferred here. There is nothing to ask for before
     * the first one arrives: a window nobody has zoomed has nothing to report.
     */
    zoomSubscribe(listener: (percent: number) => void): () => void;
    /**
     * Shows the file at one address in a window outside this one, reusing the
     * preview window if it is already open. Rejected unless the address is the
     * media route of a Rig proxy this process is currently running.
     */
    mediaPreviewOpen(url: string): Promise<void>;
    directoryPick(): Promise<string | undefined>;
    desktopConfigGet(): Promise<DesktopConfig>;
    desktopConfigWrite(config: DesktopConfig): Promise<void>;
    /** Asks now for what the background check would otherwise find later. */
    daemonCheck(): Promise<void>;
    daemonDownload(): Promise<void>;
    daemonGet(): Promise<DesktopDaemonSnapshot>;
    daemonSubscribe(listener: (snapshot: DesktopDaemonSnapshot) => void): () => void;
    daemonUpgrade(): Promise<void>;
    /** Installs one exact version if needed, then runs the daemon on it. */
    daemonVersionSelect(version: string): Promise<void>;
    debugGet(): Promise<DesktopDebugSnapshot>;
    debugAllStart(): Promise<DesktopDebugSnapshot>;
    debugAllStop(): Promise<DesktopDebugSnapshot>;
    debugMainInspectorStart(): Promise<DesktopDebugSnapshot>;
    debugMainInspectorStop(): Promise<DesktopDebugSnapshot>;
    debugRendererInspectorStart(): Promise<DesktopDebugSnapshot>;
    debugRendererInspectorStop(): Promise<DesktopDebugSnapshot>;
    debugDaemonInspectorStart(): Promise<DesktopDebugSnapshot>;
    debugDaemonInspectorStop(): Promise<DesktopDebugSnapshot>;
    debugSubscribe(listener: (snapshot: DesktopDebugSnapshot) => void): () => void;
    profilerGet(): Promise<DesktopProfilerSnapshot>;
    profilerStart(request?: DesktopProfilerStartRequest): Promise<DesktopProfilerSnapshot>;
    profilerStop(): Promise<DesktopProfilerSnapshot>;
    profilerSubscribe(listener: (snapshot: DesktopProfilerSnapshot) => void): () => void;
    /** Private typed Wall transport used by the profile renderer bootstrap. */
    profilerReactMessage(message: DesktopReactDevtoolsMessage): void;
    profilerReactSubscribe(listener: (command: DesktopReactDevtoolsCommand) => void): () => void;
    noteApply(request: DesktopNoteApplyRequest): Promise<DesktopNoteSummary>;
    noteCreate(title?: string): Promise<DesktopNoteContent>;
    noteRead(id: string): Promise<DesktopNoteContent>;
    noteRemove(id: string): Promise<void>;
    noteRename(id: string, title: string): Promise<DesktopNoteSummary>;
    notesList(): Promise<readonly DesktopNoteSummary[]>;
    /** Fires whenever the collection changes, including edits made outside Happy. */
    notesSubscribe(listener: () => void): () => void;
    applicationMenuOpen(): Promise<void>;
    /** Where local first-run setup stands, without waiting for its next change. */
    onboardingGet(): Promise<LocalOnboardingSnapshot>;
    onboardingSubscribe(listener: (snapshot: LocalOnboardingSnapshot) => void): () => void;
    onboardingProfileCreate(input: {
        readonly email: string;
        readonly name: string;
    }): Promise<void>;
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
    topologySelect(topologyId: string): Promise<void>;
    updateInstall(): Promise<void>;
    windowStateGet(): Promise<DesktopWindowState>;
    windowStateSubscribe(listener: (state: DesktopWindowState) => void): () => void;
    subscribe(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
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
    guestKey: "happy2:guest:key",
    previewNavigationChanged: "happy2:html-preview:navigation-changed",
    /** Main → renderer: the reader asked to go back or forward. */
    navigationStep: "happy2:navigation:step",
    directoryPick: "happy2:directory:pick",
    mediaPreviewChanged: "happy2:media-preview:changed",
    mediaPreviewClose: "happy2:media-preview:close",
    mediaPreviewGet: "happy2:media-preview:get",
    mediaPreviewOpen: "happy2:media-preview:open",
    /** Renderer → main only: the number of conversations waiting for the person. */
    dockUnreadSet: "happy2:dock:unread-set",
    /** Main → renderer only: the window's zoom, every time the View menu is used. */
    zoomChanged: "happy2:zoom:changed",
    desktopConfigGet: "happy2:desktop-config:get",
    desktopConfigWrite: "happy2:desktop-config:write",
    daemonChanged: "happy2:daemon:changed",
    daemonCheck: "happy2:daemon:check",
    daemonDownload: "happy2:daemon:download",
    daemonGet: "happy2:daemon:get",
    daemonUpgrade: "happy2:daemon:upgrade",
    daemonVersionSelect: "happy2:daemon:version-select",
    debugAllStart: "happy2:debug:all-start",
    debugAllStop: "happy2:debug:all-stop",
    debugChanged: "happy2:debug:changed",
    debugDaemonInspectorStart: "happy2:debug:daemon-inspector-start",
    debugDaemonInspectorStop: "happy2:debug:daemon-inspector-stop",
    debugGet: "happy2:debug:get",
    debugMainInspectorStart: "happy2:debug:main-inspector-start",
    debugMainInspectorStop: "happy2:debug:main-inspector-stop",
    debugRendererInspectorStart: "happy2:debug:renderer-inspector-start",
    debugRendererInspectorStop: "happy2:debug:renderer-inspector-stop",
    profilerGet: "happy2:profiler:get",
    profilerStart: "happy2:profiler:start",
    profilerStop: "happy2:profiler:stop",
    profilerChanged: "happy2:profiler:changed",
    profilerReactCommand: "happy2:profiler:react-command",
    profilerReactMessage: "happy2:profiler:react-message",
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
    onboardingProfileCreate: "happy2:onboarding:profile-create",
    onboardingProjectChoose: "happy2:onboarding:project-choose",
    runtimeChanged: "happy2:runtime:changed",
    runtimeGet: "happy2:runtime:get",
    runtimeReset: "happy2:runtime:reset",
    runtimeRetry: "happy2:runtime:retry",
    runtimeStart: "happy2:runtime:start",
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
