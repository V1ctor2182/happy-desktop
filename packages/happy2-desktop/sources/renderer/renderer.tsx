import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { App, DesktopStartupScreen, rigRouterCreate, type RigRouter } from "happy2-app";
import type { DesktopUpdateSnapshot, HappyDesktopBridge } from "../shared/desktopContract";
import { desktopStartRequestFromValues, desktopStartupValues } from "./desktopStartupModel";
import { desktopRuntimeStoreCreate, type DesktopRuntimeStore } from "./runtimeStore";
import { rigSessionStoreCreate, type RigSessionStore } from "./rigSessionStore";
import { startupValuesStoreCreate, type StartupValuesStore } from "./startupValuesStore";
import { browserDevBridgeCreate } from "./browserDevBridge";

function desktopAction(operation: Promise<void>): void {
    void operation.catch(() => undefined);
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
function RigBoundary(props: { router: RigRouter; store: RigSessionStore }) {
    const session = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
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
                clock: session.clock,
                connection: session.connection,
                host: session.host,
                workspace: session.workspace,
            }}
            key={session.connectionId}
            router={props.router}
        />
    );
}

function DesktopRenderer(props: {
    bridge: HappyDesktopBridge;
    rigRouter: RigRouter;
    rigSession: RigSessionStore;
    startupValues: StartupValuesStore;
    store: DesktopRuntimeStore;
}) {
    const snapshot = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
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

    return <RigBoundary router={props.rigRouter} store={props.rigSession} />;
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
    createRoot(document.getElementById("root")!).render(
        <DesktopRenderer
            bridge={bridge}
            rigRouter={rigRouter}
            rigSession={rigSessionStoreCreate(bridge, runtimeStore, {
                conversationOpen: (sessionId) =>
                    void rigRouter.navigate({
                        params: { chatId: sessionId },
                        to: "/chats/$chatId",
                    }),
            })}
            startupValues={startupValuesStoreCreate()}
            store={runtimeStore}
        />,
    );
} else {
    createRoot(document.getElementById("root")!).render(
        <App cookieAuth platform="web" serverUrl="/" />,
    );
}
