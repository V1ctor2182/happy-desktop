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
import { desktopUpdaterCreate } from "./updater";
import { DesktopWindowLifecycle, type DesktopWindowBounds } from "./windowLifecycle";
import { desktopStartRequestValidate, desktopTopologyIdValidate } from "./runtimeValidation";
import {
    desktopIpc,
    happyBrowserPartition,
    happyHtmlPreviewPartition,
    type DesktopBrowserStatus,
    type RemoteRigAddRequest,
} from "../shared/desktopContract";
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

if (process.platform !== "darwin") {
    console.error("Happy Place desktop is available only on macOS.");
    app.exit(1);
}
if (!app.requestSingleInstanceLock()) app.quit();

const dirname = fileURLToPath(new URL(".", import.meta.url));
const builtApplicationIconPath = join(dirname, "renderer", "app-icon.png");
const sourceApplicationIconPath = join(dirname, "..", "public", "app-icon.png");
const applicationIconPath = existsSync(builtApplicationIconPath)
    ? builtApplicationIconPath
    : existsSync(sourceApplicationIconPath)
      ? sourceApplicationIconPath
      : undefined;
const windowBackgroundColor = nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f5f5f5";
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

function windowOptions(
    bounds: DesktopWindowBounds | undefined,
    webPreferences: BrowserWindowConstructorOptions["webPreferences"],
): BrowserWindowConstructorOptions {
    return {
        backgroundColor: windowBackgroundColor,
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
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(dirname, "preload.cjs"),
            sandbox: true,
            webviewTag: true,
        }),
    });
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
        quitting = true;
        app.quit();
    });
});
