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
import { appearanceStoreCreate, type AppearanceStore, type RigWindowStore } from "happy2-state";
import { ThemeScope, type BrowserContentRenderer } from "happy2-ui";
import type { DesktopUpdateSnapshot, HappyDesktopBridge } from "../shared/desktopContract";
import { desktopStartRequestFromValues, desktopStartupValues } from "./desktopStartupModel";
import { desktopRuntimeStoreCreate, type DesktopRuntimeStore } from "./runtimeStore";
import { rigSessionStoreCreate, type RigSessionStore } from "./rigSessionStore";
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
import { remoteRigStoreCreate, type RemoteRigStore } from "./remoteRigStore";

const desktopBrowserContentRender: BrowserContentRenderer = (props) => (
    <DesktopBrowserView {...props} />
);

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

function RigBoundary(props: {
    appearance: AppearanceStore;
    bridge: HappyDesktopBridge;
    browserContent?: BrowserContentRenderer;
    platform: "desktop" | "web";
    router: RigRouter;
    remoteRigs: RemoteRigStore;
    store: RigSessionStore;
    update?: WorkspaceUpdate;
    windowState: RigWindowStore;
}) {
    const session = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
    const update = props.update;
    if (!session)
        return (
            <DesktopStartupScreen
                message="Connecting to your local Rig daemon…"
                onChange={() => undefined}
                onSubmit={() => undefined}
                phase="starting"
                values={desktopStartupValues({ mode: "local" })}
            />
        );
    return (
        <RouterProvider
            context={{
                appearance: props.appearance,
                browserContent: props.browserContent,
                clock: session.clock,
                connection: session.connection,
                host: session.host,
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
                platform: props.platform,
                remoteRigs: props.remoteRigs,
                windowState: props.windowState,
                workspace: session.workspace,
            }}
            key={session.connectionId}
            router={props.router}
        />
    );
}

function DesktopRenderer(props: {
    appearance: AppearanceStore;
    browserContent?: BrowserContentRenderer;
    bridge: HappyDesktopBridge;
    platform: "desktop" | "web";
    rigRouter: RigRouter;
    remoteRigs: RemoteRigStore;
    rigSession: RigSessionStore;
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
            platform={props.platform}
            router={props.rigRouter}
            remoteRigs={props.remoteRigs}
            store={props.rigSession}
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
if (bridge) {
    const runtimeStore = desktopRuntimeStoreCreate(bridge);
    // The local router outlives any single daemon connection, so it is created
    // here and the session store navigates through it when a conversation it
    // created should be opened.
    const rigRouter = rigRouterCreate();
    // Appearance is chosen for the window, not for one connection, so the store is
    // created here beside the router and outlives both.
    const appearance = appearanceStoreCreate();
    createRoot(document.getElementById("root")!).render(
        <DesktopAppearance appearance={appearance}>
            <DesktopRenderer
                appearance={appearance}
                browserContent={browserLocal ? undefined : desktopBrowserContentRender}
                bridge={bridge}
                // Only the Electron window hides its title bar; the browser
                // development server renders the same tree with web chrome.
                platform={browserLocal ? "web" : "desktop"}
                rigRouter={rigRouter}
                remoteRigs={remoteRigStoreCreate(bridge)}
                rigSession={rigSessionStoreCreate(bridge, runtimeStore, {
                    conversationOpen: (location) => rigRouterConversationOpen(rigRouter, location),
                    groupOpen: (groupId) => rigRouterGroupOpen(rigRouter, groupId),
                })}
                localWebUpdate={localWebUpdateStoreCreate(localWebBuild)}
                startupValues={startupValuesStoreCreate()}
                store={runtimeStore}
                windowState={windowStateStoreCreate(bridge)}
            />
        </DesktopAppearance>,
    );
} else {
    createRoot(document.getElementById("root")!).render(
        <App cookieAuth platform="web" serverUrl="/" />,
    );
}
