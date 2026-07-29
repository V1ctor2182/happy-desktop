import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeTheme,
    session as electronSession,
    shell,
    type BrowserWindowConstructorOptions,
    type MenuItemConstructorOptions,
    type OpenDialogOptions,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { desktopIpc, happyBrowserPartition } from "../shared/desktopContract";
import { localRigConnectorCreate } from "./localRig";
import { rigTerminalInputValidate, rigTerminalSizeValidate } from "./rigIpcValidation";
import { RigInstallTerminalManager } from "./rigInstallTerminal";
import { rigBrowserProxyCreate, type RigBrowserProxyHandle } from "./rigBrowserProxy";
import { RemoteRigManager } from "./remoteRigManager";

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
app.commandLine.appendSwitch("disable-quic");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");

let runtime: DesktopRuntime;
let rigInstallManager: RigInstallTerminalManager;
let remoteRigManager: RemoteRigManager;
let quitting = false;
let happyBrowserUserAgent = "";
let browserProxy: RigBrowserProxyHandle | undefined;
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
            openHttpProxy: () => runtime.openHttpProxy(sessionId),
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

app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || authInfo.host !== "127.0.0.1" || authInfo.port !== browserProxy?.port)
        return;
    event.preventDefault();
    callback(browserProxy.username, browserProxy.password);
});

function browserGuestAttach(window: BrowserWindow): void {
    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
        if (params.partition !== happyBrowserPartition || !browserWebUrl(params.src, true)) {
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
    if (desktopFlavor.kind === "local-web")
        return windowLifecycle.synchronize("local-web", (bounds) => localWindowCreate(bounds));
    const target = desktopWindowTarget(snapshot);
    return windowLifecycle.synchronize(target.key, (bounds) =>
        target.kind === "cloud"
            ? remoteWindowCreate(target.url, bounds)
            : localWindowCreate(bounds),
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
        const desktopRoot = join(app.getPath("userData"), "desktop");
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
            },
        );
        remoteRigManager = await RemoteRigManager.create(
            join(desktopRoot, "remote-rigs.json"),
            rendererOrigin ? { rendererOrigin } : {},
        );
        remoteRigManager.subscribe((rigs) => {
            const window = windowLifecycle.get();
            if (window && !window.isDestroyed())
                window.webContents.send(desktopIpc.remoteRigChanged, rigs);
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
        ipcMain.handle(desktopIpc.remoteRigGet, () => remoteRigManager.get());
        ipcMain.handle(desktopIpc.remoteRigAdd, (_event, destination: unknown) => {
            if (typeof destination !== "string") throw new Error("The SSH destination is invalid.");
            return remoteRigManager.add(destination);
        });
        ipcMain.handle(desktopIpc.remoteRigRemove, (_event, id: unknown) => {
            if (typeof id !== "string") throw new Error("The remote Rig identity is invalid.");
            return remoteRigManager.remove(id);
        });
        ipcMain.handle(desktopIpc.remoteRigRetry, (_event, id: unknown) => {
            if (typeof id !== "string") throw new Error("The remote Rig identity is invalid.");
            remoteRigManager.retry(id);
        });
        ipcMain.handle(desktopIpc.browserProxyApply, (_event, sessionId: unknown) => {
            if (typeof sessionId !== "string" || sessionId.length === 0)
                throw new Error("The Rig browser session identity is invalid.");
            return browserProxyApply(sessionId);
        });
        ipcMain.handle(desktopIpc.applicationMenuOpen, () => {
            Menu.getApplicationMenu()?.popup();
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
    void Promise.all([runtime.close(), remoteRigManager?.[Symbol.asyncDispose]()]).finally(() => {
        browserProxy?.close();
        browserProxy = undefined;
        rigInstallManager?.[Symbol.dispose]();
        quitting = true;
        app.quit();
    });
});
