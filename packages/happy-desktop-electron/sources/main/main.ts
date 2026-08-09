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
    type WebContents,
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
    type DesktopBrowserProxyTarget,
    type DesktopBrowserStatus,
    type DesktopMediaPreview,
    type DesktopPreviewNavigation,
    type DesktopPreviewNavigationStep,
} from "../shared/desktopContract";
import {
    mediaPreviewAddressAllowed,
    mediaPreviewNavigationAllowed,
    mediaPreviewResolve,
    mediaPreviewTitle,
} from "./mediaPreviewWindow";
import { localRigConnectorCreate, rigInstallVerifierCreate } from "./localRig";
import { LocalOnboarding } from "./localOnboarding";
import { NotesStore } from "./notesStore";
import {
    noteApplyRequestValidate,
    noteIdValidate,
    noteTitleOptionalValidate,
    noteTitleValidate,
} from "./notesIpcValidation";
import {
    desktopBrowserProxyTargetValidate,
    rigTerminalInputValidate,
    rigTerminalSizeValidate,
} from "./rigIpcValidation";
import { RigInstallTerminalManager } from "./rigInstallTerminal";
import { htmlPreviewProxyCreate, type HtmlPreviewProxyHandle } from "./htmlPreviewProxy";
import { rigBrowserProxyCreate, type RigBrowserProxyHandle } from "./rigBrowserProxy";
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
app.commandLine.appendSwitch("disable-quic");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");

let runtime: DesktopRuntime;
let desktopConfigStore: DesktopConfigStore;
let desktopWindowStateStore: DesktopWindowStateStore;
let rigInstallManager: RigInstallTerminalManager;
let onboarding: LocalOnboarding;
let notesStore: NotesStore;
let quitting = false;
let happyBrowserUserAgent = "";
let browserProxy: RigBrowserProxyHandle | undefined;
let htmlPreviewProxy: HtmlPreviewProxyHandle | undefined;
let browserProxyConnectionId: number | undefined;
/**
 * Which machine and session the live tunnel was built for. Held beside the
 * handle rather than inside it because the proxy itself is only a socket: what
 * makes one tunnel the wrong one for a request is the Rig it was opened on.
 */
let browserProxyTarget: DesktopBrowserProxyTarget | undefined;
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

/** The one native folder chooser, shared by the renderer's request and first-run setup. */
async function directoryPickShow(owner: BrowserWindow | undefined): Promise<string | undefined> {
    const options: OpenDialogOptions = {
        buttonLabel: "Choose",
        properties: ["openDirectory", "createDirectory"],
        title: "Choose a Rig working directory",
    };
    const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
}

/**
 * Which document is presenting Happy. It advances on every main-frame navigation
 * or reload, on a renderer that is lost or crashes, and on a window that is
 * replaced, so a `webContents` id — which survives all of those — is never the
 * whole answer to "is this still the reader who asked?".
 */
let presentationEpoch = 0;

function presentationAdvance(): void {
    presentationEpoch += 1;
}

/** The presenting document's identity: which renderer, and which of its lives. */
function presentationIdentity(): string {
    const window = windowLifecycle.get();
    const presenting = window && !window.isDestroyed() ? window.webContents.id : undefined;
    return `${presenting ?? "none"}:${presentationEpoch}`;
}

/**
 * Only the window that is actually presenting Happy right now may drive first-run
 * setup. Every one of these operations installs software, writes durable choices,
 * or opens a native picker, so a renderer that has been replaced — a reload, a
 * topology change, a window that lost its turn — must not be able to reach them
 * with a preload it still holds. Which step may run is checked separately and
 * authoritatively by first-run setup itself, against the stage it is on.
 */
function onboardingSenderRequire(sender: Electron.WebContents): void {
    const presenting = windowLifecycle.get();
    if (!presenting || presenting.isDestroyed() || presenting.webContents !== sender)
        throw new Error("First-run setup is not being presented by this window.");
}

function browserSessionGet() {
    return electronSession.fromPartition(happyBrowserPartition, { cache: true });
}

async function browserProxyFailClosed(): Promise<void> {
    browserProxy?.close();
    browserProxy = undefined;
    browserProxyConnectionId = undefined;
    browserProxyTarget = undefined;
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
 * The daemon tunnel a browser tab's traffic goes through, opened on the Rig the
 * session belongs to.
 *
 * A session on a machine this host is peered with is tunnelled on that
 * machine's own client, so the page loads against that machine's network and
 * its checkout. The session is looked up there too, which is the point: a
 * session identity means something only on the Rig that minted it, and asking
 * the host for it would find some unrelated conversation of the same name or
 * nothing at all.
 */
function browserProxyOpen(target: DesktopBrowserProxyTarget): Promise<Duplex> {
    return runtime.openHttpProxy(target.sessionId, target.nodeId);
}

function browserProxyApply(target: DesktopBrowserProxyTarget): Promise<void> {
    return browserProxySerial(async () => {
        const snapshot = runtime.get();
        if (snapshot.phase !== "ready" || snapshot.mode !== "local")
            throw new Error("The local Rig daemon is unavailable.");
        if (
            browserProxyTarget?.sessionId === target.sessionId &&
            browserProxyTarget.nodeId === target.nodeId &&
            browserProxyConnectionId === snapshot.connectionId
        )
            return;

        await browserProxyFailClosed();
        const connectionId = snapshot.connectionId;
        const candidate = await rigBrowserProxyCreate({
            sessionId: target.sessionId,
            openHttpProxy: () => browserProxyOpen(target),
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
            browserProxyTarget = target;
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
            htmlPreviewLifecyclePublish(window, guest);
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
        // Only the main process observes a guest's response code. The renderer
        // needs it to tell a served error page from a blank failed navigation.
        guest.on("did-navigate", (_navigation, url, status, statusText) => {
            if (window.isDestroyed()) return;
            window.webContents.send(desktopIpc.browserStatusChanged, {
                guestId: guest.id,
                url,
                status,
                statusText,
            } satisfies DesktopBrowserStatus);
        });
    });
}

/**
 * Publishes the life of a preview guest's main-frame document as one ordered
 * stream, numbered by navigation.
 *
 * A preview reloads in place whenever the file behind it changes, so a guest
 * outlives many documents and its id says nothing about which one an event
 * belongs to. Only this process sees the whole sequence — the start, the
 * response code, the finish, the failure, the lost renderer — so it is the only
 * place that can put those in one order and stamp each with the navigation it
 * came from. The renderer then ignores anything older than the document it is
 * on, and cannot be told by a slow answer from a previous revision that the
 * page it is showing is broken.
 *
 * The counter is monotonic per guest and never restarts: a reload is a new
 * navigation, and the number only ever goes up while the guest exists.
 */
function htmlPreviewLifecyclePublish(window: BrowserWindow, guest: WebContents): void {
    let navigation = 0;
    const publish = (step: DesktopPreviewNavigationStep): void => {
        if (window.isDestroyed() || guest.isDestroyed()) return;
        window.webContents.send(desktopIpc.previewNavigationChanged, {
            guestId: guest.id,
            navigationId: navigation,
            ...step,
        } satisfies DesktopPreviewNavigation);
    };
    guest.on("did-start-navigation", (details) => {
        // A fragment or a history entry inside the same document is not a new
        // page, and the document on screen keeps whatever it already said.
        if (!details.isMainFrame || details.isSameDocument) return;
        navigation += 1;
        publish({ phase: "started", url: details.url });
    });
    guest.on("did-navigate", (_event, url, status, statusText) => {
        publish({ phase: "responded", url, status, statusText });
    });
    guest.on("did-finish-load", () => {
        publish({ phase: "loaded", url: guest.getURL() });
    });
    guest.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
        // ERR_ABORTED is how Chromium reports a load this guest replaced or
        // stopped itself, which is the superseding navigation's business.
        if (!isMainFrame || code === -3) return;
        publish({ phase: "failed", url: validatedURL, code, description });
    });
    guest.on("render-process-gone", (_event, details) => {
        publish({ phase: "gone", url: guest.getURL(), reason: details.reason });
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
    const ownerId = window.webContents.id;
    // A document is not a window. The same `webContents` survives a reload and a
    // main-frame navigation, so setup's idea of who it is working for advances
    // with the document rather than with the window: work started by the page
    // that was here a moment ago is not owed to the page that replaced it.
    window.webContents.on("did-start-navigation", (details) => {
        if (details.isMainFrame) presentationAdvance();
    });
    presentationAdvance();
    const cleanup = () => {
        presentationAdvance();
        rigInstallManager?.closeOwner(ownerId);
        onboarding?.installAbandoned(ownerId);
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
    return windowLifecycle.synchronize(desktopWindowTarget(snapshot).key, (bounds) =>
        localWindowCreate(bounds ?? restoredBounds),
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
                localRigConnector: connector,
                // A hosted local renderer and the Vite development renderer both
                // call the loopback proxy cross-origin. Only their exact,
                // build-owned origin receives CORS access.
                ...(rendererOrigin ? { rendererOrigin } : {}),
                ...(htmlPreviewProxy ? { htmlPreview: htmlPreviewProxy } : {}),
            },
        );
        // Notes live in the user's home rather than in this app's private data
        // directory: the Markdown beside each note is meant to be found by an
        // agent working on this machine, and an application-support path is not
        // somewhere anyone would look.
        notesStore = new NotesStore();
        notesStore.subscribe(() => {
            const window = windowLifecycle.get();
            if (window && !window.isDestroyed()) window.webContents.send(desktopIpc.notesChanged);
        });
        // A finished install is checked by running the newly installed command,
        // never by connecting: the runtime is the only owner of the user's
        // daemon, and it is the one asked to try again once Rig is really there.
        rigInstallManager = new RigInstallTerminalManager(rigInstallVerifierCreate(), {
            verified: () => void runtime.retry().catch(() => undefined),
        });
        // First-run setup follows the runtime rather than owning a connection of
        // its own: the daemon is started, connected, and left running by the
        // runtime alone, and setup only reads its state and asks it to try again.
        onboarding = await LocalOnboarding.create({
            directoryPick: () => directoryPickShow(windowLifecycle.get()),
            installer: rigInstallManager,
            // Which window setup is working for. A native picker outlives the
            // window that opened it, so setup reads this again before it acts on
            // what came back.
            presentation: presentationIdentity,
            recordPath: join(desktopRoot, "local-onboarding.json"),
            runtime,
        });
        onboarding.subscribe((snapshot) => {
            const window = windowLifecycle.get();
            if (window && !window.isDestroyed())
                window.webContents.send(desktopIpc.onboardingChanged, snapshot);
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
        ipcMain.handle(desktopIpc.runtimeGet, () => runtime.get());
        ipcMain.handle(desktopIpc.desktopConfigGet, () => desktopConfigStore.get());
        ipcMain.handle(desktopIpc.desktopConfigWrite, (_event, config: unknown) =>
            desktopConfigStore.write(config),
        );
        ipcMain.handle(desktopIpc.browserProxyApply, (_event, target: unknown) =>
            browserProxyApply(desktopBrowserProxyTargetValidate(target)),
        );
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
                buttonLabel: "Add",
                // No `createDirectory`: what is chosen here becomes a project,
                // and Rig only accepts the top level of a Git repository — so a
                // folder made in this dialog could only ever be refused.
                properties: ["openDirectory"],
                title: "Choose a project folder",
            };
            const result = owner
                ? await dialog.showOpenDialog(owner, options)
                : await dialog.showOpenDialog(options);
            return result.canceled ? undefined : result.filePaths[0];
        });
        ipcMain.handle(desktopIpc.onboardingGet, (event) => {
            onboardingSenderRequire(event.sender);
            return onboarding.get();
        });
        ipcMain.handle(desktopIpc.onboardingRigInstall, (event, cols: unknown, rows: unknown) => {
            onboardingSenderRequire(event.sender);
            const size = rigTerminalSizeValidate(cols, rows);
            onboarding.rigInstall({
                cols: size.cols,
                emit: (installEvent) => {
                    if (!event.sender.isDestroyed())
                        event.sender.send(desktopIpc.rigInstallEvent, installEvent);
                },
                ownerId: event.sender.id,
                rows: size.rows,
            });
        });
        ipcMain.handle(desktopIpc.onboardingProjectChoose, (event) => {
            onboardingSenderRequire(event.sender);
            return onboarding.projectChoose();
        });
        ipcMain.handle(desktopIpc.onboardingProfileCreate, (event, input: unknown) => {
            onboardingSenderRequire(event.sender);
            if (
                !input ||
                typeof input !== "object" ||
                typeof (input as { name?: unknown }).name !== "string" ||
                typeof (input as { email?: unknown }).email !== "string"
            )
                throw new Error("That profile is invalid.");
            const profile = input as { readonly email: string; readonly name: string };
            return onboarding.profileCreate({ email: profile.email, name: profile.name });
        });
        ipcMain.handle(desktopIpc.onboardingMurmurChoose, (event, input: unknown) => {
            onboardingSenderRequire(event.sender);
            if (
                !input ||
                typeof input !== "object" ||
                typeof (input as { enabled?: unknown }).enabled !== "boolean"
            )
                throw new Error("That Murmur choice is invalid.");
            const choice = input as { readonly enabled: boolean; readonly profileId?: unknown };
            if (!choice.enabled) return onboarding.murmurChoose({ enabled: false });
            if (typeof choice.profileId !== "string")
                throw new Error("Choose a profile for Murmur.");
            return onboarding.murmurChoose({ enabled: true, profileId: choice.profileId });
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
    void Promise.all([runtime.close(), desktopWindowStateStore?.flush()]).finally(() => {
        browserProxy?.close();
        browserProxy = undefined;
        htmlPreviewProxy?.close();
        htmlPreviewProxy = undefined;
        rigInstallManager?.[Symbol.dispose]();
        onboarding?.[Symbol.dispose]();
        // The preview window belongs to this application, not to the desktop, so
        // it goes when the application does rather than keeping it alive.
        if (mediaPreviewWindow && !mediaPreviewWindow.isDestroyed()) mediaPreviewWindow.destroy();
        mediaPreviewWindow = undefined;
        mediaPreviewSubject = undefined;
        quitting = true;
        app.quit();
    });
});
