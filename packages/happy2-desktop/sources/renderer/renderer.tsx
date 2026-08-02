import { useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import {
    App,
    DesktopStartupScreen,
    rigRouterConversationOpen,
    rigRouterGroupOpen,
    rigRouterCreate,
    type AppRigUpdate,
    type RigRouter,
} from "happy2-app";
import {
    RIG_DEFAULT_THINKING_LEVEL,
    appearanceStoreCreate,
    notesSessionStoreCreate,
    rigNavigationOrderStoreCreate,
    rigSettingsStoreCreate,
    type AppearanceStore,
    type NotesSessionStore,
    type RigNavigationOrderStore,
    type RigSettingsStore,
    type RigWindowStore,
} from "happy2-state";
import {
    CodeHighlightWorkers,
    ThemeScope,
    type BrowserContentRenderer,
    type HtmlPreviewRenderer,
    type RigPluginApplicationContentRenderer,
} from "happy2-ui";
import type {
    DesktopConfig,
    DesktopUpdateSnapshot,
    HappyDesktopBridge,
} from "../shared/desktopContract";
import { desktopStartRequestFromValues, desktopStartupValues } from "./desktopStartupModel";
import { dockUnreadPublish } from "./dockUnread";
import { desktopRuntimeStoreCreate, type DesktopRuntimeStore } from "./runtimeStore";
import { rigDirectoryStoreCreate, type RigDirectoryStore } from "./rigDirectoryStore";
import { startupValuesStoreCreate, type StartupValuesStore } from "./startupValuesStore";
import { browserDevBridgeCreate } from "./browserDevBridge";
import { localWebBuild } from "./localWebBuild";
import {
    localWebUpdateStoreCreate,
    type LocalWebUpdateSnapshot,
    type LocalWebUpdateStore,
} from "./localWebUpdateStore";
import { windowStateStoreCreate } from "./windowStateStore";
import { DesktopBrowserView } from "./desktopBrowserView";
import { DesktopHtmlPreviewView } from "./desktopHtmlPreviewView";
import { DesktopPluginApplicationView } from "./desktopPluginApplicationView";
import { desktopModelSettingsCreate } from "./desktopModelSettings";
import { desktopNavigationOrderPersistence } from "./desktopNavigationOrder";

const desktopBrowserContentRender: BrowserContentRenderer = (props) => (
    <DesktopBrowserView {...props} />
);

const desktopHtmlPreviewRender: HtmlPreviewRenderer = (props) => (
    <DesktopHtmlPreviewView {...props} />
);

/**
 * Mounts a plugin application against this window's bridge. A generation is a
 * lifetime, so the frame is keyed by it: replaced plugin code is a new frame
 * rather than a navigation inside the old one.
 */
function desktopPluginApplicationRenderCreate(
    bridge: HappyDesktopBridge,
): RigPluginApplicationContentRenderer {
    return (props) => (
        <DesktopPluginApplicationView
            {...props}
            bridge={bridge}
            key={`${props.applicationId} ${props.generation}`}
        />
    );
}

function desktopAction(operation: Promise<void>): void {
    void operation.catch(() => undefined);
}

interface WorkspaceUpdate {
    readonly action: "install" | "refresh";
    readonly snapshot: AppRigUpdate;
}

function workspaceUpdate(
    native: DesktopUpdateSnapshot,
    hosted: LocalWebUpdateSnapshot,
): WorkspaceUpdate | undefined {
    if (
        native.status === "available" ||
        native.status === "downloading" ||
        native.status === "downloaded"
    )
        return {
            action: "install",
            snapshot: {
                action: "restart",
                ...(native.availableVersion ? { version: native.availableVersion } : {}),
                ...(native.message ? { detail: native.message } : {}),
                status: native.status,
            },
        };
    if (hosted.status !== "available") return undefined;
    const version =
        hosted.version !== localWebBuild?.version
            ? hosted.version
            : `build ${hosted.buildId.slice(0, 7)}`;
    return {
        action: "refresh",
        snapshot: { action: "refresh", status: "downloaded", version },
    };
}

function ChoosingScreen(props: {
    bridge: HappyDesktopBridge;
    update: DesktopUpdateSnapshot;
    values: StartupValuesStore;
}) {
    const values = useSyncExternalStore(props.values.subscribe, props.values.get, props.values.get);
    return (
        <DesktopStartupScreen
            onChange={props.values.change}
            onInstallUpdate={() => desktopAction(props.bridge.updateInstall())}
            onSubmit={() =>
                desktopAction(props.bridge.runtimeStart(desktopStartRequestFromValues(values)))
            }
            phase="choosing"
            update={props.update}
            values={values}
        />
    );
}

/**
 * Mounts the local workspace under its router once a connection exists. The
 * router owns which conversation is open, so the stores of a new connection are
 * handed to it as route context rather than as props to a screen.
 */
/**
 * Renders the whole desktop tree in the selected appearance. The store outlives
 * every daemon connection and every startup phase, so the startup screens and the
 * workspace are one themed subtree rather than two.
 */
function DesktopAppearance(props: { appearance: AppearanceStore; children: ReactNode }) {
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    return <ThemeScope mode={appearance.mode}>{props.children}</ThemeScope>;
}

/**
 * Mounts the workspace router as soon as this window has a Rig directory to
 * render. Which Rig is on screen — and whether it has connected yet — is the
 * directory's business and the URL's, not this boundary's, so a machine that is
 * still connecting no longer holds the whole window on a startup screen.
 */
function RigBoundary(props: {
    appearance: AppearanceStore;
    bridge: HappyDesktopBridge;
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    pluginApplicationContent?: RigPluginApplicationContentRenderer;
    notes: NotesSessionStore;
    platform: "desktop" | "web";
    router: RigRouter;
    navigationOrder: RigNavigationOrderStore;
    rigs: RigDirectoryStore;
    settings: RigSettingsStore;
    update?: WorkspaceUpdate;
    windowState: RigWindowStore;
}) {
    const update = props.update;
    return (
        <RouterProvider
            context={{
                appearance: props.appearance,
                browserContent: props.browserContent,
                // A development window says which checkout it came from; the
                // packaged product supplies nothing and shows nothing.
                buildIdentity: props.bridge.buildIdentity,
                htmlPreview: props.htmlPreview,
                pluginApplicationContent: props.pluginApplicationContent,
                ...(update
                    ? {
                          onUpdateApply: () => {
                              if (update.action === "install")
                                  desktopAction(props.bridge.updateInstall());
                              else window.location.reload();
                          },
                          update: update.snapshot,
                      }
                    : {}),
                navigationOrder: props.navigationOrder,
                notes: props.notes,
                platform: props.platform,
                rigs: props.rigs,
                settings: props.settings,
                windowState: props.windowState,
            }}
            router={props.router}
        />
    );
}

function DesktopRenderer(props: {
    appearance: AppearanceStore;
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    pluginApplicationContent?: RigPluginApplicationContentRenderer;
    bridge: HappyDesktopBridge;
    navigationOrder: RigNavigationOrderStore;
    notes: NotesSessionStore;
    platform: "desktop" | "web";
    rigRouter: RigRouter;
    rigs: RigDirectoryStore;
    settings: RigSettingsStore;
    startupValues: StartupValuesStore;
    store: DesktopRuntimeStore;
    localWebUpdate: LocalWebUpdateStore;
    windowState: RigWindowStore;
}) {
    const snapshot = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
    const hostedUpdate = useSyncExternalStore(
        props.localWebUpdate.subscribe,
        props.localWebUpdate.get,
        props.localWebUpdate.get,
    );
    if (!snapshot)
        return (
            <DesktopStartupScreen
                message="Reading desktop settings…"
                onChange={() => undefined}
                onSubmit={() => undefined}
                phase="starting"
                values={desktopStartupValues()}
            />
        );
    if (snapshot.phase === "choosing")
        return (
            <ChoosingScreen
                bridge={props.bridge}
                update={snapshot.update}
                values={props.startupValues}
            />
        );
    if (snapshot.phase === "starting")
        return (
            <DesktopStartupScreen
                message={snapshot.message}
                onChange={() => undefined}
                onInstallUpdate={() => desktopAction(props.bridge.updateInstall())}
                onSubmit={() => undefined}
                phase="starting"
                update={snapshot.update}
                values={desktopStartupValues(snapshot.request)}
            />
        );
    if (snapshot.phase === "installRequired")
        return (
            <DesktopStartupScreen
                error={`Rig is required for local mode. Install it with: ${snapshot.command}`}
                onChange={() => undefined}
                onChangeMode={() => desktopAction(props.bridge.runtimeReset())}
                onRetry={() => desktopAction(props.bridge.runtimeRetry())}
                onSubmit={() => undefined}
                phase="error"
                update={snapshot.update}
                values={desktopStartupValues(snapshot.request)}
            />
        );
    if (snapshot.phase === "error")
        return (
            <DesktopStartupScreen
                error={snapshot.message}
                onChange={() => undefined}
                onChangeMode={() => desktopAction(props.bridge.runtimeReset())}
                onInstallUpdate={() => desktopAction(props.bridge.updateInstall())}
                onRetry={
                    snapshot.retryable
                        ? () => desktopAction(props.bridge.runtimeRetry())
                        : undefined
                }
                onSubmit={() => undefined}
                phase="error"
                update={snapshot.update}
                values={desktopStartupValues(snapshot.request)}
            />
        );

    const active = snapshot.activeTarget;
    // Main replaces the bundled renderer with a sandboxed, no-preload window for
    // cloud targets. This guard prevents a stale/racing local renderer from ever
    // opening cross-origin API transports while that window handoff completes.
    if (active.mode === "cloud")
        return (
            <DesktopStartupScreen
                message="Opening your cloud Happy workspace…"
                onChange={() => undefined}
                onSubmit={() => undefined}
                phase="starting"
                update={snapshot.update}
                values={desktopStartupValues({ mode: "cloud", serverUrl: active.serverUrl })}
            />
        );

    return (
        <RigBoundary
            appearance={props.appearance}
            bridge={props.bridge}
            browserContent={props.browserContent}
            htmlPreview={props.htmlPreview}
            pluginApplicationContent={props.pluginApplicationContent}
            navigationOrder={props.navigationOrder}
            notes={props.notes}
            platform={props.platform}
            router={props.rigRouter}
            rigs={props.rigs}
            settings={props.settings}
            update={workspaceUpdate(snapshot.update, hostedUpdate)}
            windowState={props.windowState}
        />
    );
}

// Browser-local dev mode is signalled by a CSP-safe meta tag the dev server
// injects (an inline script would be blocked by the page's script-src policy).
const browserLocal =
    document.querySelector('meta[name="happy2-browser-local"]')?.getAttribute("content") === "1";
const bridge = window.happyDesktop ?? (browserLocal ? browserDevBridgeCreate() : undefined);
const root = createRoot(document.getElementById("root")!);
if (bridge) {
    const desktopBridge = bridge;
    const start = (config: DesktopConfig): void => {
        const runtimeStore = desktopRuntimeStoreCreate(desktopBridge);
        // The local router outlives any single daemon connection, so it is created
        // here and the session store navigates through it when a conversation it
        // created should be opened.
        const rigRouter = rigRouterCreate();
        // Appearance is chosen for the window, not for one connection, so the store is
        // created here beside the router and outlives both.
        const appearance = appearanceStoreCreate();
        const modelSettings = desktopModelSettingsCreate(desktopBridge, config);
        // Defaults and model picker memory belong to the desktop, not one daemon.
        // The state stores stay synchronous while the bridge persists their typed
        // snapshots through the main process.
        const settings = rigSettingsStoreCreate(modelSettings.initialSettings);
        settings.subscribe(() => modelSettings.settingsChanged(settings.get()));
        // The reader's notes are files in their home directory, so they belong to the
        // window rather than to any Rig: the main process stores them, and this store
        // outlives every daemon connection the window makes.
        const notes = notesSessionStoreCreate(desktopBridge);
        // How the reader arranged the sidebar's pinned rows. It is the window's
        // for the same reason the notes are: those rows are here whether or not
        // any machine is reachable, so the arrangement must outlive every
        // connection this window makes.
        const navigationOrder = rigNavigationOrderStoreCreate(desktopNavigationOrderPersistence());
        // Every Rig in this window, each with its own product stores. The router is
        // told to resolve its address again whenever the set of connected Rigs
        // changes, so a machine that connects after the URL already named it opens
        // the addressed conversation without the reader navigating twice.
        const rigs = rigDirectoryStoreCreate(desktopBridge, runtimeStore, {
            conversationOpen: (rigId, location) =>
                rigRouterConversationOpen(rigRouter, rigId, location),
            groupOpen: (rigId, groupId) => rigRouterGroupOpen(rigRouter, rigId, groupId),
            modelPreferencePersistence: modelSettings.preferencePersistence,
        });
        let materialized = "";
        rigs.subscribe(() => {
            const current = rigs
                .get()
                .rigs.map((rig) => `${rig.id}:${rig.session ? "up" : "down"}`)
                .join(",");
            if (current === materialized) return;
            materialized = current;
            void rigRouter.invalidate();
        });
        // What is waiting for the person is a fact about the whole window, not
        // about the screen that happens to be open, so the Dock is marked from
        // the same directory the sidebar reads rather than from any one Rig.
        dockUnreadPublish(rigs, (count) => desktopBridge.dockUnreadSet(count));
        // This window renders the Rig tree directly rather than through `App`, so
        // it has to start the highlighting pool itself: without this the file
        // viewer and every diff in the primary desktop surface tokenize on the
        // main thread, which is exactly where a large file must not be parsed.
        root.render(
            <DesktopAppearance appearance={appearance}>
                <CodeHighlightWorkers>
                    <DesktopRenderer
                        appearance={appearance}
                        browserContent={browserLocal ? undefined : desktopBrowserContentRender}
                        htmlPreview={browserLocal ? undefined : desktopHtmlPreviewRender}
                        pluginApplicationContent={
                            browserLocal
                                ? undefined
                                : desktopPluginApplicationRenderCreate(desktopBridge)
                        }
                        bridge={desktopBridge}
                        navigationOrder={navigationOrder}
                        notes={notes}
                        // Only the Electron window hides its title bar; the browser
                        // development server renders the same tree with web chrome.
                        platform={browserLocal ? "web" : "desktop"}
                        rigRouter={rigRouter}
                        rigs={rigs}
                        localWebUpdate={localWebUpdateStoreCreate(localWebBuild)}
                        settings={settings}
                        startupValues={startupValuesStoreCreate()}
                        store={runtimeStore}
                        windowState={windowStateStoreCreate(desktopBridge)}
                    />
                </CodeHighlightWorkers>
            </DesktopAppearance>,
        );
    };
    void desktopBridge.desktopConfigGet().then(start, (error: unknown) => {
        console.error("Could not read desktop model settings.", error);
        start({
            defaultEffort: RIG_DEFAULT_THINKING_LEVEL,
            defaultPermissionMode: "auto",
            modelPreferences: [],
            version: 1,
        });
    });
} else {
    root.render(<App cookieAuth platform="web" serverUrl="/" />);
}
