import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeTheme,
    screen,
    session as electronSession,
    shell,
    type BrowserWindowConstructorOptions,
    type MenuItemConstructorOptions,
    type OpenDialogOptions,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DesktopRuntime } from "./desktopRuntime";
import { desktopInstanceMenuTargets } from "./applicationMenu";
import {
    desktopWindowTarget,
    localWebNavigationAllowed,
    remoteNavigationAllowed,
    rendererNavigationAllowed,
} from "./navigation";
import { desktopFlavor } from "./desktopFlavor";
import { dockBadgeApply, dockBadgeClear, dockUnreadCountRead } from "./dockBadge";
import { desktopUpdaterCreate } from "./updater";
import { DesktopWindowLifecycle, type DesktopWindowBounds } from "./windowLifecycle";
import { desktopStartRequestValidate, desktopTopologyIdValidate } from "./runtimeValidation";
import {
    buildIdentityArgument,
    desktopIpc,
    happyBrowserPartition,
    happyHtmlPreviewPartition,
    mediaPreviewArgument,
    mediaPreviewView,
    type DesktopGuestStatus,
    type DesktopMediaPreview,
    type RemoteRigAddRequest,
} from "../shared/desktopContract";
import {
    mediaPreviewAddressAllowed,
    mediaPreviewNavigationAllowed,
    mediaPreviewResolve,
    mediaPreviewTitle,
} from "./mediaPreviewWindow";
import {
    PluginApplicationHost,
    pluginApplicationSchemeRegister,
    pluginAppCancelParse,
    pluginAppRequestParse,
    pluginOriginHost,
} from "./pluginApplicationHost";
import { localRigConnectorCreate } from "./localRig";
import { NotesStore } from "./notesStore";
import {
    noteApplyRequestValidate,
    noteIdValidate,
    noteTitleOptionalValidate,
    noteTitleValidate,
} from "./notesIpcValidation";
import { rigTerminalInputValidate, rigTerminalSizeValidate } from "./rigIpcValidation";
import { RigInstallTerminalManager } from "./rigInstallTerminal";
import { htmlPreviewProxyCreate, type HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigBrowserProxyCreate, type RigBrowserProxyHandle } from "./rigBrowserProxy";
import { RemoteRigManager } from "./remoteRigManager";
import { desktopConfigPath, DesktopConfigStore } from "./desktopConfig";
import { DesktopWindowStateStore } from "./windowState";
import { desktopBuildIdentityRead } from "./buildIdentity";

if (process.platform !== "darwin") {
    console.error("Happy Place desktop is available only on macOS.");
    app.exit(1);
}
const buildIdentity = desktopBuildIdentityRead(app.isPackaged, app.getAppPath());
/*
 * A development build says so everywhere the system can name an application. The
 * menu bar and the About item read the application name, which is otherwise
 * literally "Electron" while running unpackaged — a window that claims to be
 * Electron tells the reader nothing about which of their checkouts it came from.
 */
const applicationName = buildIdentity ? "Happy Dev" : "Happy";
app.setName(applicationName);
/*
 * Each checkout is its own installation of the app. Everything below is keyed on
 * the user-data directory — the single-instance lock above all — so sharing one
 * would mean the second checkout's window silently quitting into the first
 * checkout's window instead of opening, which is precisely what someone running
 * two builds side by side is trying to avoid. Separate directories also keep one
 * worktree's settings, window geometry, and saved instances out of another's.
 */
if (buildIdentity) app.setPath("userData", `${app.getPath("userData")}-${buildIdentity.label}`);
// Only now is this process identifiable, so only now can it claim to be the one.
if (!app.requestSingleInstanceLock()) app.quit();

const dirname = fileURLToPath(new URL(".", import.meta.url));
const builtApplicationIconPath = join(dirname, "renderer", "app-icon.png");
const sourceApplicationIconPath = join(dirname, "..", "public", "app-icon.png");
const applicationIconPath = existsSync(builtApplicationIconPath)
    ? builtApplicationIconPath
    : existsSync(sourceApplicationIconPath)
      ? sourceApplicationIconPath
      : undefined;
/*
 * The title carries the checkout as well, because that is what Mission Control,
 * the Window menu, and the app switcher's window list have room to show. The
 * ordinary checkout on the default branch is simply "Happy Dev": it is the one
 * window with nothing to distinguish it from, and naming it twice says nothing.
 */
const windowTitle =
    buildIdentity && buildIdentity.label !== "dev"
        ? `${applicationName} — ${buildIdentity.label}`
        : applicationName;
function windowBackgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f5f5f5";
}
const developmentRendererOrigin = process.env.VITE_DEV_SERVER_URL
    ? new URL(process.env.VITE_DEV_SERVER_URL).origin
    : undefined;
const updateCheckIntervalMs = 15 * 60 * 1000;
const titleBarHeight = 40;
const macosTrafficLightSize = 14;
const macosWindowChrome = {
    titleBarStyle: "hidden",
    trafficLightPosition: {
        x: 14,
        y: (titleBarHeight - macosTrafficLightSize) / 2,
    },
} as const;

nativeTheme.themeSource = "system";
// Chromium learns its schemes once, before it starts, so the bundle origin has
// to be declared here rather than when the first plugin appears.
pluginApplicationSchemeRegister();
app.commandLine.appendSwitch("disable-quic");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");

let runtime: DesktopRuntime;
let desktopConfigStore: DesktopConfigStore;
let desktopWindowStateStore: DesktopWindowStateStore;
let rigInstallManager: RigInstallTerminalManager;
let remoteRigManager: RemoteRigManager;
let notesStore: NotesStore;
let pluginApplications: PluginApplicationHost;
let quitting = false;
let happyBrowserUserAgent = "";
let browserProxy: RigBrowserProxyHandle | undefined;
let htmlPreviewProxy: HtmlPreviewProxyHandle | undefined;
let browserProxyConnectionId: number | undefined;
let browserProxyOperation = Promise.resolve();
const windowLifecycle = new DesktopWindowLifecycle<BrowserWindow>();
const unavailableBrowserProxy = "http://127.0.0.1:9";
/*
 * The one window a file is shown in outside the application. There is exactly
 * one because a reader looking at a file is looking at a file: opening another
 * points this window at the new one rather than accumulating windows nobody
 * asked for and nobody will close.
 */
let mediaPreviewWindow: BrowserWindow | undefined;
let mediaPreviewSubject: DesktopMediaPreview | undefined;

function browserSessionGet() {
    return electronSession.fromPartition(happyBrowserPartition, { cache: true });
}

async function browserProxyFailClosed(): Promise<void> {
    browserProxy?.close();
    browserProxy = undefined;
    browserProxyConnectionId = undefined;
    const browserSession = browserSessionGet();
    await browserSession.setProxy({
        mode: "fixed_servers",
        proxyBypassRules: "<-loopback>",
        proxyRules: unavailableBrowserProxy,
    });
    await browserSession.closeAllConnections();
}

function browserProxySerial<T>(work: () => Promise<T>): Promise<T> {
    const next = browserProxyOperation.then(work, work);
    browserProxyOperation = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

/**
 * The daemon tunnel a browser tab's traffic goes through. The session belongs to
 * exactly one Rig; this machine's daemon is tried first, and a session it does
 * not own is opened on whichever connected remote machine does, so a browser tab
 * in a remote workspace works the way one in the local workspace does.
 */
function browserProxyOpen(sessionId: string): Promise<Duplex> {
    return runtime.openHttpProxy(sessionId).catch(() => remoteRigManager.openHttpProxy(sessionId));
}

function browserProxyApply(sessionId: string): Promise<void> {
    return browserProxySerial(async () => {
        const snapshot = runtime.get();
        if (snapshot.phase !== "ready" || snapshot.mode !== "local")
            throw new Error("The local Rig daemon is unavailable.");
        if (
            browserProxy?.sessionId === sessionId &&
            browserProxyConnectionId === snapshot.connectionId
        )
            return;

        await browserProxyFailClosed();
        const connectionId = snapshot.connectionId;
        const candidate = await rigBrowserProxyCreate({
            sessionId,
            openHttpProxy: () => browserProxyOpen(sessionId),
        });
        const current = runtime.get();
        if (
            current.phase !== "ready" ||
            current.mode !== "local" ||
            current.connectionId !== connectionId
        ) {
            candidate.close();
            throw new Error("The local Rig connection changed while opening the browser.");
        }
        try {
            const browserSession = browserSessionGet();
            await browserSession.setProxy({
                mode: "fixed_servers",
                proxyBypassRules: "<-loopback>",
                proxyRules: `http://127.0.0.1:${String(candidate.port)}`,
            });
            await browserSession.closeAllConnections();
            browserProxy = candidate;
            browserProxyConnectionId = connectionId;
        } catch (error) {
            candidate.close();
            await browserProxyFailClosed();
            throw error;
        }
    });
}

function browserWebUrl(candidate: string, allowBlank = false): string | undefined {
    if (allowBlank && candidate === "about:blank") return candidate;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" || parsed.protocol === "https:"
            ? parsed.href
            : undefined;
    } catch {
        return undefined;
    }
}

function browserOpenPublish(window: BrowserWindow, candidate: string): void {
    const url = browserWebUrl(candidate);
    if (!url || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(desktopIpc.browserOpenRequested, url);
}

/**
 * Keeps Chromium's true engine/version while removing the Electron/app tokens
 * that make sites serve an embedded-shell variant.
 */
function browserUserAgent(defaultUserAgent: string): string {
    return defaultUserAgent
        .replace(/\sElectron\/\S+/giu, "")
        .replace(/\sHappy(?:%20|\s)Place(?:%20|\s)Desktop\/\S+/giu, "")
        .replace(/\s{2,}/gu, " ")
        .trim();
}

async function browserSessionConfigure(): Promise<void> {
    const browserSession = browserSessionGet();
    happyBrowserUserAgent = browserUserAgent(browserSession.getUserAgent());
    browserSession.setUserAgent(happyBrowserUserAgent, app.getLocale());
    await browserProxyFailClosed();

    const permissionLabels = new Map<string, string>([
        ["clipboard-read", "read the clipboard"],
        ["display-capture", "share the screen"],
        ["geolocation", "use your location"],
        ["media", "use the camera or microphone"],
        ["midi", "use MIDI devices"],
        ["notifications", "show notifications"],
        ["pointerLock", "capture the pointer"],
    ]);
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const label = permissionLabels.get(permission);
        const requestingUrl = browserWebUrl(details.requestingUrl || webContents.getURL());
        if (!label || !requestingUrl) {
            callback(false);
            return;
        }
        const requestingOrigin = new URL(requestingUrl).origin;
        const host = webContents.hostWebContents;
        const owner = host ? BrowserWindow.fromWebContents(host) : undefined;
        const options = {
            buttons: ["Don't Allow", "Allow"],
            cancelId: 0,
            defaultId: 0,
            detail: `${requestingOrigin} wants to ${label}.`,
            message: "Website permission",
            noLink: true,
            type: "question" as const,
        };
        void (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options))
            .then((result) => callback(result.response === 1))
            .catch(() => callback(false));
    });
}

function htmlPreviewSessionGet() {
    return electronSession.fromPartition(happyHtmlPreviewPartition, { cache: false });
}

/**
 * Points the preview profile at Happy's own HTML preview proxy and walls it off
 * from everything else.
 *
 * A workspace document runs its own scripts, and a page in a checkout may name
 * any address in the world — a tracker, an endpoint it was told to call, a
 * script from a CDN. Loopback is deliberately *not* bypassed, so every request
 * such a page makes, including the one for the document itself, arrives at the
 * preview proxy: it answers for the document's own folder and refuses the rest
 * of the internet. A preview therefore shows what the file contains, and can
 * neither call home nor reach anything Happy is signed in to.
 */
async function htmlPreviewSessionConfigure(): Promise<void> {
    const previewSession = htmlPreviewSessionGet();
    await previewSession.setProxy({
        mode: "fixed_servers",
        proxyBypassRules: "<-loopback>",
        proxyRules: htmlPreviewProxy
            ? `http://127.0.0.1:${String(htmlPreviewProxy.port)}`
            : unavailableBrowserProxy,
    });
    previewSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
    );
    previewSession.setPermissionCheckHandler(() => false);
    await previewSession.closeAllConnections();
}

/**
 * Whether an address is one of this process's own preview sites. The proxy
 * publishes each document folder under `.localhost`, which is loopback by
 * specification, so a page keeps the secure context it would have when served
 * for real.
 */
function htmlPreviewUrl(candidate: string): string | undefined {
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" &&
            parsed.port === "" &&
            parsed.hostname.endsWith(".localhost")
            ? parsed.href
            : undefined;
    } catch {
        return undefined;
    }
}

app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || authInfo.host !== "127.0.0.1") return;
    // Both loopback proxies this process runs are credentialed, and the
    // credentials never leave it: the port says which one is asking.
    if (authInfo.port === browserProxy?.port) {
        event.preventDefault();
        callback(browserProxy.username, browserProxy.password);
        return;
    }
    if (authInfo.port === htmlPreviewProxy?.port) {
        event.preventDefault();
        callback(htmlPreviewProxy.username, htmlPreviewProxy.password);
    }
});

function browserGuestAttach(window: BrowserWindow): void {
    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
        const previewGuest = params.partition === happyHtmlPreviewPartition;
        const allowed = previewGuest
            ? htmlPreviewUrl(params.src) !== undefined
            : params.partition === happyBrowserPartition && browserWebUrl(params.src, true);
        if (!allowed) {
            event.preventDefault();
            return;
        }
        // Guest pages never inherit a preload or Node privilege from the app.
        delete webPreferences.preload;
        webPreferences.contextIsolation = true;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.nodeIntegrationInWorker = false;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
    });
    window.webContents.on("did-attach-webview", (_event, guest) => {
        // Only the main process observes a guest's response code. Every embedded
        // view needs it to tell a refused response from a page: the browser to
        // separate a served error page from a blank failed navigation, a preview
        // to know the document it asked for is not there at all.
        guest.on("did-navigate", (_navigation, url, status, statusText) => {
            if (window.isDestroyed()) return;
            window.webContents.send(desktopIpc.guestStatusChanged, {
                guestId: guest.id,
                url,
                status,
                statusText,
            } satisfies DesktopGuestStatus);
        });
        if (guest.session === htmlPreviewSessionGet()) {
            // A preview is one page of one file. Following a link out of it, or
            // opening a window from it, is browsing, and browsing is the browser
            // tab's job — so the guest stays on the document it was opened with.
            guest.setWindowOpenHandler(({ url }) => {
                browserOpenPublish(window, url);
                return { action: "deny" };
            });
            const stayOnPreview = (event: Electron.Event, candidate: string) => {
                if (htmlPreviewUrl(candidate) === undefined) event.preventDefault();
            };
            guest.on("will-navigate", stayOnPreview);
            guest.on("will-redirect", stayOnPreview);
            return;
        }
        guest.setUserAgent(happyBrowserUserAgent);
        guest.setWindowOpenHandler(({ url }) => {
            browserOpenPublish(window, url);
            return { action: "deny" };
        });
        const navigationGuard = (event: Electron.Event, candidate: string) => {
            if (!browserWebUrl(candidate, true)) event.preventDefault();
        };
        guest.on("will-navigate", navigationGuard);
        guest.on("will-redirect", navigationGuard);
    });
}

function windowOptions(
    bounds: DesktopWindowBounds | undefined,
    webPreferences: BrowserWindowConstructorOptions["webPreferences"],
): BrowserWindowConstructorOptions {
    return {
        backgroundColor: windowBackgroundColor(),
        title: windowTitle,
        width: bounds?.width ?? 1100,
        height: bounds?.height ?? 760,
        ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
        minWidth: 720,
        minHeight: 480,
        ...(applicationIconPath ? { icon: applicationIconPath } : {}),
        show: false,
        ...macosWindowChrome,
        webPreferences,
    };
}

/**
 * Keeps the window wearing the name this build was given. Every page here
 * carries the same `<title>`, and Chromium hands it to the window on load, which
 * would put one identical name on every checkout's window — exactly the
 * confusion this title exists to prevent.
 *
 * Refusing the page's title is not enough on its own: the name is also applied
 * around navigation, when no title event is emitted to refuse. So the window is
 * renamed again at each point a load can have overwritten it, which is cheap and
 * leaves no ordering to get wrong.
 */
function windowTitleHold(window: BrowserWindow): void {
    const hold = () => {
        if (!window.isDestroyed()) window.setTitle(windowTitle);
    };
    window.on("page-title-updated", (event) => {
        event.preventDefault();
        hold();
    });
    window.webContents.on("did-finish-load", hold);
    window.webContents.on("did-navigate", hold);
    window.webContents.on("did-navigate-in-page", hold);
    hold();
}

function windowGeometryRemember(window: BrowserWindow): void {
    const remember = () => {
        if (!window.isDestroyed()) desktopWindowStateStore.remember(window.getNormalBounds());
    };
    window.on("move", remember);
    window.on("resize", remember);
    remember();
}

function localWindowCreate(bounds?: DesktopWindowBounds) {
    const hostedOrigin =
        desktopFlavor.kind === "local-web" ? desktopFlavor.rendererOrigin : undefined;
    const developmentUrl = hostedOrigin ? undefined : process.env.VITE_DEV_SERVER_URL;
    const rendererPath = join(dirname, "renderer", "index.html");
    const hostedUrl = hostedOrigin ? `${hostedOrigin}/?desktop=1&mode=local` : undefined;
    const rendererUrl = hostedUrl ?? developmentUrl ?? pathToFileURL(rendererPath).toString();
    const window = new BrowserWindow({
        ...windowOptions(bounds, {
            // The build a window runs is fixed for its whole life, so the preload
            // is handed it as a launch argument rather than made to ask for it:
            // the shell can then render its identity in the first frame.
            ...(buildIdentity
                ? {
                      additionalArguments: [
                          `${buildIdentityArgument}${JSON.stringify(buildIdentity)}`,
                      ],
                  }
                : {}),
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(dirname, "preload.cjs"),
            sandbox: true,
            webviewTag: true,
        }),
    });
    windowTitleHold(window);
    windowGeometryRemember(window);
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (browserWebUrl(url)) browserOpenPublish(window, url);
        else if (url.startsWith("mailto:")) void shell.openExternal(url);
        return { action: "deny" };
    });
    browserGuestAttach(window);
    const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
        const allowed = hostedOrigin
            ? localWebNavigationAllowed(url, hostedOrigin)
            : rendererNavigationAllowed(url, rendererUrl, developmentUrl !== undefined);
        if (!allowed) event.preventDefault();
    };
    window.webContents.on("will-navigate", preventUntrustedNavigation);
    window.webContents.on("will-redirect", preventUntrustedNavigation);
    // A mounted plugin application is its own bundle and nothing else. Its frame
    // may navigate inside the generation it was mounted for and nowhere else —
    // not onto the web, and not onto the generation that replaced it.
    window.webContents.on("will-frame-navigate", (details) => {
        if (details.isMainFrame) return;
        const leavingBundle = pluginOriginHost(details.frame?.url ?? "") !== undefined;
        const enteringBundle = pluginOriginHost(details.url) !== undefined;
        if (!leavingBundle && !enteringBundle) return;
        if (!pluginApplications.originAllows(details.url)) details.preventDefault();
    });
    const ownerId = window.webContents.id;
    const cleanup = () => {
        rigInstallManager?.closeOwner(ownerId);
        // The mark on the Dock belongs to the window that reported it. This one
        // is going away — reloaded, gone, or replaced — so it takes its own mark
        // with it, unless another window is already presenting and has set its
        // own; wiping that would leave the icon lying about the live window.
        const presenting = windowLifecycle.get();
        if (!presenting || presenting.webContents.id === ownerId) dockBadgeClear();
    };
    window.webContents.on("render-process-gone", cleanup);
    window.webContents.on("destroyed", cleanup);
    // macOS full screen hides the traffic lights without changing anything the
    // renderer can query, so the window tells it directly and the shell drops the
    // lane it reserves for them.
    const windowStatePublish = () => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(desktopIpc.windowStateChanged, {
            fullScreen: window.isFullScreen(),
        });
    };
    window.on("enter-full-screen", windowStatePublish);
    window.on("leave-full-screen", windowStatePublish);
    window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) cleanup();
    });
    return {
        load: () =>
            hostedUrl
                ? window.loadURL(hostedUrl)
                : developmentUrl
                  ? window.loadURL(developmentUrl)
                  : window.loadFile(rendererPath),
        window,
    };
}

function remoteWindowCreate(url: string, bounds?: DesktopWindowBounds) {
    // This is deliberately a separate WebContents from the local shell. Access,
    // its identity providers, and the remote Happy deployment never receive the
    // preload bridge or any native credential/runtime capability.
    const window = new BrowserWindow({
        ...windowOptions(bounds, {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        }),
    });
    windowTitleHold(window);
    windowGeometryRemember(window);
    window.webContents.setWindowOpenHandler(({ url: candidate }) => {
        if (remoteNavigationAllowed(candidate)) void shell.openExternal(candidate);
        return { action: "deny" };
    });
    const preventUntrustedNavigation = (event: Electron.Event, candidate: string) => {
        if (!remoteNavigationAllowed(candidate)) event.preventDefault();
    };
    window.webContents.on("will-navigate", preventUntrustedNavigation);
    window.webContents.on("will-redirect", preventUntrustedNavigation);
    return { load: () => window.loadURL(url), window };
}

/**
 * Every Rig proxy this process is currently running. A file may be shown in a
 * window of its own only if its address is on one of them, which is what keeps a
 * privileged window pointed at this machine's own Rigs and nothing else.
 */
function mediaPreviewBases(): readonly (string | undefined)[] {
    const snapshot = runtime.get();
    return [
        snapshot.phase === "ready" && snapshot.activeTarget.authentication === "rig"
            ? snapshot.activeTarget.rigHttpUrl
            : undefined,
        ...(remoteRigManager?.get() ?? []).map((rig) => rig.rigHttpUrl),
    ];
}

/**
 * Keeps the preview window named after the file rather than after the bundle.
 * Every page in this build carries the same `<title>`, which Chromium would
 * otherwise hand to the window and put one generic name on a window whose whole
 * job is to say which file it is showing.
 */
function mediaPreviewNameHold(window: BrowserWindow): void {
    const hold = () => {
        if (window.isDestroyed()) return;
        window.setTitle(
            mediaPreviewSubject ? mediaPreviewTitle(mediaPreviewSubject.path) : windowTitle,
        );
    };
    window.on("page-title-updated", (event) => {
        event.preventDefault();
        hold();
    });
    window.webContents.on("did-finish-load", hold);
    window.webContents.on("did-navigate", hold);
    hold();
}

/**
 * The window one file is shown in, outside the application window.
 *
 * It is the same renderer document, loaded with the view it should mount, so it
 * inherits the page's Content-Security-Policy, context isolation, and sandbox
 * rather than being a second, laxer boundary. It is launched with the argument
 * that makes the preload hand it the preview bridge instead of the
 * application's, so it can ask this process for the file, close itself, and
 * nothing else. It hosts no plugin bundle and no browser guest, opens no window,
 * and cannot leave the one document it was opened with.
 */
function mediaPreviewWindowCreate(): BrowserWindow {
    const hostedOrigin =
        desktopFlavor.kind === "local-web" ? desktopFlavor.rendererOrigin : undefined;
    const developmentUrl = hostedOrigin ? undefined : process.env.VITE_DEV_SERVER_URL;
    const rendererPath = join(dirname, "renderer", "index.html");
    const address = (base: string): string => {
        const url = new URL(base);
        url.searchParams.set(mediaPreviewView.key, mediaPreviewView.value);
        return url.toString();
    };
    const rendererUrl = hostedOrigin
        ? address(`${hostedOrigin}/?desktop=1&mode=local`)
        : developmentUrl
          ? address(developmentUrl)
          : address(pathToFileURL(rendererPath).toString());
    const window = new BrowserWindow({
        backgroundColor: windowBackgroundColor(),
        title: windowTitle,
        width: 1100,
        height: 760,
        minWidth: 480,
        minHeight: 360,
        ...(applicationIconPath ? { icon: applicationIconPath } : {}),
        show: false,
        webPreferences: {
            additionalArguments: [mediaPreviewArgument],
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(dirname, "preload.cjs"),
            sandbox: true,
        },
    });
    mediaPreviewNameHold(window);
    // A preview window opens no windows and goes nowhere: a link inside it
    // would be a link inside a picture or a recording, which does not exist.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const stay = (event: Electron.Event, candidate: string) => {
        if (!mediaPreviewNavigationAllowed(candidate, rendererUrl)) event.preventDefault();
    };
    window.webContents.on("will-navigate", stay);
    window.webContents.on("will-redirect", stay);
    window.once("ready-to-show", () => {
        if (window.isDestroyed()) return;
        // Maximized rather than macOS full screen: full screen would take the
        // file to a Space of its own and hide the window it was opened from,
        // which is the opposite of looking at a file beside the work it belongs to.
        window.maximize();
        window.show();
    });
    window.on("closed", () => {
        if (mediaPreviewWindow === window) {
            mediaPreviewWindow = undefined;
            mediaPreviewSubject = undefined;
        }
    });
    // A window that never loaded is not a window showing a file. It is
    // retired rather than shown empty, so the next open builds a live one instead
    // of reusing a blank frame that would answer nothing it is sent.
    const failed = () => {
        if (mediaPreviewWindow === window) {
            mediaPreviewWindow = undefined;
            mediaPreviewSubject = undefined;
        }
        if (!window.isDestroyed()) window.destroy();
    };
    window.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
        // Only the document failing counts, and only when it failed rather than
        // was superseded: an aborted load (-3) is a load that was replaced.
        if (isMainFrame && code !== -3) failed();
    });
    // A renderer that died leaves a frame that can still be raised and sent
    // files, and would answer none of them. It retires on the same path as a
    // document that never arrived.
    window.webContents.on("render-process-gone", failed);
    void window.loadURL(rendererUrl).catch(failed);
    return window;
}

/** Points the preview window at `preview`, opening it the first time. */
function mediaPreviewShow(preview: DesktopMediaPreview): void {
    mediaPreviewSubject = preview;
    const existing = mediaPreviewWindow;
    if (existing && !existing.isDestroyed()) {
        existing.setTitle(mediaPreviewTitle(preview.path));
        if (!existing.webContents.isDestroyed())
            existing.webContents.send(desktopIpc.mediaPreviewChanged, preview);
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return;
    }
    mediaPreviewWindow = mediaPreviewWindowCreate();
}

/**
 * Retires the preview window once the address behind it can no longer be served.
 * The file is addressed on a Rig proxy, so a Rig that goes away takes the
 * window with it rather than leaving a frame around a request that will now fail.
 */
function mediaPreviewRevalidate(): void {
    const window = mediaPreviewWindow;
    if (!window || window.isDestroyed()) return;
    const subject = mediaPreviewSubject;
    if (subject && mediaPreviewAddressAllowed(subject.url, mediaPreviewBases())) return;
    mediaPreviewSubject = undefined;
    mediaPreviewWindow = undefined;
    window.destroy();
}

function windowSynchronize(snapshot: ReturnType<DesktopRuntime["get"]>): BrowserWindow {
    const restoredBounds = desktopWindowStateStore.restore(
        screen.getAllDisplays(),
        screen.getPrimaryDisplay(),
    );
    if (desktopFlavor.kind === "local-web")
        return windowLifecycle.synchronize("local-web", (bounds) =>
            localWindowCreate(bounds ?? restoredBounds),
        );
    const target = desktopWindowTarget(snapshot);
    // A cloud window is deliberately given no bridge, so it can never report a
    // count and can never take one down. The local window it replaces is
    // destroyed only once the cloud window is on screen, by which point the
    // lifecycle already names the replacement and that window's own teardown
    // rightly declines to repaint over it — so the count it was showing is
    // retired here instead, when the destination is known.
    if (target.kind === "cloud") {
        dockBadgeClear();
        // A local window's explicit selection must not leak into a hosted
        // window, whose appearance is owned by that deployment.
        nativeTheme.themeSource = "system";
    }
    return windowLifecycle.synchronize(target.key, (bounds) =>
        target.kind === "cloud"
            ? remoteWindowCreate(target.url, bounds ?? restoredBounds)
            : localWindowCreate(bounds ?? restoredBounds),
    );
}

function applicationMenuInstall(snapshot: ReturnType<DesktopRuntime["get"]>): void {
    const targets = desktopInstanceMenuTargets(snapshot);
    const instances: MenuItemConstructorOptions[] = targets.map((target) => ({
        label: target.label,
        type: "checkbox",
        checked: target.active,
        click: () => void runtime.topologySelect(target.id).catch(() => undefined),
    }));
    if (instances.length === 0) instances.push({ label: "No saved instances", enabled: false });
    instances.push(
        { type: "separator" },
        {
            label: "Choose or Add Instance…",
            accelerator: "CmdOrCtrl+Shift+I",
            click: () => void runtime.reset().catch(() => undefined),
        },
    );
    const template: MenuItemConstructorOptions[] = [
        {
            // macOS reads the bold first menu from this label. Left to the
            // default it is the running binary's name — "Electron" in any build
            // that is not packaged — which names the toolkit rather than the app.
            label: applicationName,
            role: "appMenu",
            submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
            ],
        },
        ...(desktopFlavor.kind === "local-web"
            ? []
            : [{ label: "Instances", submenu: instances } as MenuItemConstructorOptions]),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

void app
    .whenReady()
    .then(async () => {
        if (!app.isPackaged && applicationIconPath) app.dock?.setIcon(applicationIconPath);
        await browserSessionConfigure();
        htmlPreviewProxy = await htmlPreviewProxyCreate();
        await htmlPreviewSessionConfigure();
        pluginApplications = new PluginApplicationHost({
            onChange: (catalog) => {
                const window = windowLifecycle.get();
                if (window && !window.isDestroyed())
                    window.webContents.send(desktopIpc.pluginApplicationsChanged, catalog);
            },
        });
        const desktopRoot = join(app.getPath("userData"), "desktop");
        desktopWindowStateStore = await DesktopWindowStateStore.create(
            join(desktopRoot, "window-state.json"),
        );
        desktopConfigStore = await DesktopConfigStore.create(desktopConfigPath());
        const connector = localRigConnectorCreate();
        const rendererOrigin =
            desktopFlavor.kind === "local-web"
                ? desktopFlavor.rendererOrigin
                : developmentRendererOrigin;
        runtime = await DesktopRuntime.create(
            {
                root: desktopRoot,
            },
            {
                localOnly: desktopFlavor.kind === "local-web",
                localRigConnector: connector,
                // A hosted local renderer and the Vite development renderer both
                // call the loopback proxy cross-origin. Only their exact,
                // build-owned origin receives CORS access.
                ...(rendererOrigin ? { rendererOrigin } : {}),
                ...(htmlPreviewProxy ? { htmlPreview: htmlPreviewProxy } : {}),
            },
        );
        remoteRigManager = await RemoteRigManager.create(join(desktopRoot, "remote-rigs.json"), {
            ...(rendererOrigin ? { rendererOrigin } : {}),
            ...(htmlPreviewProxy ? { htmlPreview: htmlPreviewProxy } : {}),
        });
        remoteRigManager.subscribe((rigs) => {
            const window = windowLifecycle.get();
            if (window && !window.isDestroyed())
                window.webContents.send(desktopIpc.remoteRigChanged, rigs);
            mediaPreviewRevalidate();
        });
        // Notes live in the user's home rather than in this app's private data
        // directory: the Markdown beside each note is meant to be found by an
        // agent working on this machine, and an application-support path is not
        // somewhere anyone would look.
        notesStore = new NotesStore();
        notesStore.subscribe(() => {
            const window = windowLifecycle.get();
            if (window && !window.isDestroyed()) window.webContents.send(desktopIpc.notesChanged);
        });
        rigInstallManager = new RigInstallTerminalManager(connector, {
            verified: () => void runtime.retry().catch(() => undefined),
        });
        const updater = desktopUpdaterCreate({
            packaged: app.isPackaged,
            update: (snapshot) => runtime.updateSet(snapshot),
        });
        runtime.subscribe((snapshot) => {
            if (
                browserProxyConnectionId !== undefined &&
                (snapshot.phase !== "ready" ||
                    snapshot.mode !== "local" ||
                    snapshot.connectionId !== browserProxyConnectionId)
            )
                void browserProxySerial(browserProxyFailClosed);
            // Bundles belong to the daemon that served them, so the plugin
            // subscription follows the active local Rig exactly: another machine,
            // a reconnect onto a new proxy, or no local Rig at all retires every
            // cached generation rather than carrying it across.
            pluginApplications.endpointSet(
                snapshot.phase === "ready" && snapshot.activeTarget.authentication === "rig"
                    ? snapshot.activeTarget.rigHttpUrl
                    : undefined,
            );
            mediaPreviewRevalidate();
            const previous = windowLifecycle.get();
            const window = windowSynchronize(snapshot);
            applicationMenuInstall(snapshot);
            if (
                window === previous &&
                (desktopFlavor.kind === "local-web" ||
                    desktopWindowTarget(snapshot).kind === "local")
            )
                window.webContents.send(desktopIpc.runtimeChanged, snapshot);
        });
        // The runtime may already be ready by the time the subscription above is
        // installed, and its first snapshot is not replayed.
        {
            const snapshot = runtime.get();
            pluginApplications.endpointSet(
                snapshot.phase === "ready" && snapshot.activeTarget.authentication === "rig"
                    ? snapshot.activeTarget.rigHttpUrl
                    : undefined,
            );
        }
        ipcMain.handle(desktopIpc.runtimeGet, () => runtime.get());
        ipcMain.handle(desktopIpc.pluginApplicationsGet, () => pluginApplications.get());
        ipcMain.handle(desktopIpc.pluginAppRequest, (_event, raw: unknown) => {
            const request = pluginAppRequestParse(raw);
            if (!request) throw new Error("The plugin application request is invalid.");
            return pluginApplications.appRequest(
                request.origin,
                request.requestId,
                request.request,
            );
        });
        ipcMain.handle(desktopIpc.pluginAppCancel, (_event, raw: unknown) => {
            const cancellation = pluginAppCancelParse(raw);
            if (!cancellation) throw new Error("The plugin application request is invalid.");
            pluginApplications.appCancel(cancellation.origin, cancellation.requestId);
        });
        ipcMain.handle(desktopIpc.desktopConfigGet, () => desktopConfigStore.get());
        ipcMain.handle(desktopIpc.desktopConfigWrite, (_event, config: unknown) =>
            desktopConfigStore.write(config),
        );
        ipcMain.handle(desktopIpc.remoteRigGet, () => remoteRigManager.get());
        ipcMain.handle(desktopIpc.remoteRigAdd, (_event, request: unknown) => {
            const value = request as RemoteRigAddRequest | undefined;
            if (
                !value ||
                typeof value !== "object" ||
                typeof value.destination !== "string" ||
                (value.label !== undefined && typeof value.label !== "string")
            )
                throw new Error("The remote Rig destination is invalid.");
            return remoteRigManager.add(value);
        });
        ipcMain.handle(desktopIpc.remoteRigRemove, (_event, id: unknown) => {
            if (typeof id !== "string") throw new Error("The remote Rig identity is invalid.");
            return remoteRigManager.remove(id);
        });
        ipcMain.handle(desktopIpc.remoteRigConnect, (_event, id: unknown) => {
            if (typeof id !== "string") throw new Error("The remote Rig identity is invalid.");
            return remoteRigManager.connect(id);
        });
        ipcMain.handle(desktopIpc.remoteRigDisconnect, (_event, id: unknown) => {
            if (typeof id !== "string") throw new Error("The remote Rig identity is invalid.");
            return remoteRigManager.disconnect(id);
        });
        ipcMain.handle(desktopIpc.browserProxyApply, (_event, sessionId: unknown) => {
            if (typeof sessionId !== "string" || sessionId.length === 0)
                throw new Error("The Rig browser session identity is invalid.");
            return browserProxyApply(sessionId);
        });
        ipcMain.handle(desktopIpc.applicationMenuOpen, () => {
            Menu.getApplicationMenu()?.popup();
        });
        // `nativeTheme` is Chromium's preferred-color-scheme source for every
        // WebContents in this process, including webview guests and nested
        // frames. Only the currently presented local window may choose it.
        ipcMain.on(desktopIpc.appearanceSet, (event, raw: unknown) => {
            const presenting = windowLifecycle.get();
            if (!presenting || presenting.webContents !== event.sender) return;
            if (raw !== "dark" && raw !== "light" && raw !== "system") return;
            nativeTheme.themeSource = raw;
            const background = windowBackgroundColor();
            presenting.setBackgroundColor(background);
            if (mediaPreviewWindow && !mediaPreviewWindow.isDestroyed())
                mediaPreviewWindow.setBackgroundColor(background);
        });
        ipcMain.handle(desktopIpc.notesList, () => notesStore.list());
        ipcMain.handle(desktopIpc.noteCreate, (_event, title: unknown) => {
            const validated = noteTitleOptionalValidate(title);
            return notesStore.create(validated === undefined ? {} : { title: validated });
        });
        ipcMain.handle(desktopIpc.noteRead, (_event, id: unknown) =>
            notesStore.read(noteIdValidate(id)),
        );
        ipcMain.handle(desktopIpc.noteApply, (_event, request: unknown) => {
            const validated = noteApplyRequestValidate(request);
            return notesStore.applyUpdates(validated.id, validated);
        });
        ipcMain.handle(desktopIpc.noteRename, (_event, id: unknown, title: unknown) =>
            notesStore.rename(noteIdValidate(id), noteTitleValidate(title)),
        );
        ipcMain.handle(desktopIpc.noteRemove, (_event, id: unknown) =>
            notesStore.remove(noteIdValidate(id)),
        );
        // One-way: the window states what is waiting and the shell marks the
        // icon. Only the window this shell is currently presenting may do so, so
        // a superseded renderer still shutting down cannot repaint over the one
        // that replaced it, and a malformed count is dropped rather than guessed.
        ipcMain.on(desktopIpc.dockUnreadSet, (event, raw: unknown) => {
            const presenting = windowLifecycle.get();
            if (!presenting || presenting.webContents !== event.sender) return;
            const count = dockUnreadCountRead(raw);
            if (count !== undefined) dockBadgeApply(count);
        });
        ipcMain.handle(desktopIpc.mediaPreviewOpen, (event, raw: unknown) => {
            // Only the window this shell is presenting opens a preview window, so
            // a superseded renderer still shutting down cannot put one on screen
            // after the window that asked for it is gone.
            const presenting = windowLifecycle.get();
            if (!presenting || presenting.webContents !== event.sender)
                throw new Error("This window cannot open a preview window.");
            // The renderer names the file; this process decides whether that
            // name is one of its own Rig's, so a window is never opened onto an
            // address this build is not already serving.
            const preview = mediaPreviewResolve(raw, mediaPreviewBases());
            if (!preview) throw new Error("That file is not served by a Rig in this window.");
            mediaPreviewShow(preview);
        });
        ipcMain.handle(desktopIpc.mediaPreviewGet, (event) =>
            mediaPreviewWindow &&
            !mediaPreviewWindow.isDestroyed() &&
            mediaPreviewWindow.webContents === event.sender
                ? mediaPreviewSubject
                : undefined,
        );
        ipcMain.handle(desktopIpc.mediaPreviewClose, (event) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window && window === mediaPreviewWindow) window.close();
        });
        ipcMain.handle(desktopIpc.directoryPick, async (event) => {
            const owner = BrowserWindow.fromWebContents(event.sender);
            const options: OpenDialogOptions = {
                buttonLabel: "Choose",
                properties: ["openDirectory", "createDirectory"],
                title: "Choose a Rig working directory",
            };
            const result = owner
                ? await dialog.showOpenDialog(owner, options)
                : await dialog.showOpenDialog(options);
            return result.canceled ? undefined : result.filePaths[0];
        });
        ipcMain.handle(desktopIpc.runtimeStart, (_event, request: unknown) =>
            runtime.start(desktopStartRequestValidate(request)),
        );
        ipcMain.handle(desktopIpc.runtimeRetry, () => runtime.retry());
        ipcMain.handle(desktopIpc.runtimeReset, () => runtime.reset());
        ipcMain.handle(desktopIpc.topologySelect, (_event, topologyId: unknown) =>
            runtime.topologySelect(desktopTopologyIdValidate(topologyId)),
        );
        ipcMain.handle(desktopIpc.rigInstallOpen, (event) =>
            rigInstallManager.open(event.sender.id, (installEvent) => {
                if (!event.sender.isDestroyed())
                    event.sender.send(desktopIpc.rigInstallEvent, installEvent);
            }),
        );
        ipcMain.handle(
            desktopIpc.rigInstallConfirm,
            (event, terminalId: unknown, cols: unknown, rows: unknown) => {
                const size = rigTerminalSizeValidate(cols, rows);
                if (typeof terminalId !== "string")
                    throw new Error("The Rig installation terminal identity is invalid.");
                rigInstallManager.confirm(event.sender.id, terminalId, size.cols, size.rows);
            },
        );
        ipcMain.handle(desktopIpc.rigInstallInput, (event, terminalId: unknown, data: unknown) => {
            if (typeof terminalId !== "string")
                throw new Error("The Rig installation terminal identity is invalid.");
            rigInstallManager.input(event.sender.id, terminalId, rigTerminalInputValidate(data));
        });
        ipcMain.handle(
            desktopIpc.rigInstallResize,
            (event, terminalId: unknown, cols: unknown, rows: unknown) => {
                const size = rigTerminalSizeValidate(cols, rows);
                if (typeof terminalId !== "string")
                    throw new Error("The Rig installation terminal identity is invalid.");
                rigInstallManager.resize(event.sender.id, terminalId, size.cols, size.rows);
            },
        );
        ipcMain.handle(desktopIpc.rigInstallClose, (event, terminalId: unknown) => {
            if (typeof terminalId !== "string")
                throw new Error("The Rig installation terminal identity is invalid.");
            rigInstallManager.close(event.sender.id, terminalId);
        });
        ipcMain.handle(desktopIpc.updateInstall, () => updater.install());
        ipcMain.handle(desktopIpc.windowStateGet, (event) => ({
            fullScreen: BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
        }));
        windowSynchronize(runtime.get());
        applicationMenuInstall(runtime.get());
        const updateCheck = () => void updater.check().catch(() => undefined);
        const updateCheckInterval = setInterval(updateCheck, updateCheckIntervalMs);
        updateCheckInterval.unref();
        app.once("will-quit", () => clearInterval(updateCheckInterval));
        updateCheck();
        app.on("activate", () => {
            if (!windowLifecycle.get()) windowSynchronize(runtime.get());
        });
    })
    .catch((error: unknown) => {
        dialog.showErrorBox(
            "Happy could not start",
            error instanceof Error ? error.message : "The desktop runtime failed to initialize.",
        );
        app.quit();
    });

app.on("second-instance", () => {
    const window = windowLifecycle.get();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
});

app.on("before-quit", (event) => {
    if (quitting || !runtime) return;
    event.preventDefault();
    void Promise.all([
        runtime.close(),
        remoteRigManager?.[Symbol.asyncDispose](),
        desktopWindowStateStore?.flush(),
    ]).finally(() => {
        browserProxy?.close();
        browserProxy = undefined;
        htmlPreviewProxy?.close();
        htmlPreviewProxy = undefined;
        rigInstallManager?.[Symbol.dispose]();
        // The preview window belongs to this application, not to the desktop, so
        // it goes when the application does rather than keeping it alive.
        if (mediaPreviewWindow && !mediaPreviewWindow.isDestroyed()) mediaPreviewWindow.destroy();
        mediaPreviewWindow = undefined;
        mediaPreviewSubject = undefined;
        quitting = true;
        app.quit();
    });
});
