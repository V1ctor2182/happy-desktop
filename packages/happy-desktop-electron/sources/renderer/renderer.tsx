import { useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import {
    DesktopStartupScreen,
    rigRouterConversationOpen,
    rigRouterGroupOpen,
    rigRouterListOpen,
    rigRouterCreate,
    type AppRigUpdate,
    type AppRigDebugStore,
    type AppRigProfilerStore,
    type RigRouter,
} from "happy-desktop-app";
import {
    RIG_DEFAULT_THINKING_LEVEL,
    appearanceStoreCreate,
    experimentsStoreCreate,
    titleShimmerStoreCreate,
    welcomeStoreCreate,
    rigNavigationOrderStoreCreate,
    rigSidebarCollapseStoreCreate,
    rigSettingsStoreCreate,
    type AppearanceStore,
    type ExperimentsStore,
    type WelcomeStore,
    type RigNavigationOrderStore,
    type RigSidebarCollapseStore,
    type RigSettingsStore,
    type TitleShimmerStore,
    type RigWindowStore,
} from "happy-desktop-state";
import {
    CodeHighlightWorkers,
    LocalOnboardingScreen,
    SetupPage,
    ThemeScope,
    WelcomeScreen,
    type WelcomeSlide,
    type BrowserContentRenderer,
    type HtmlPreviewRenderer,
    type MediaWindowOpener,
} from "happy-desktop-ui";
import {
    mediaPreviewView,
    type DesktopConfig,
    type DesktopGuestKeyEvent,
    type DesktopRuntimeSnapshot,
    type DesktopUpdateSnapshot,
    type HappyDesktopBridge,
} from "../shared/desktopContract";
import { desktopStartRequestFromValues, desktopStartupValues } from "./desktopStartupModel";
import { dockUnreadPublish } from "./dockUnread";
import { desktopRuntimeStoreCreate, type DesktopRuntimeStore } from "./runtimeStore";
import {
    localOnboardingStoreCreate,
    localOnboardingView,
    type LocalOnboardingStore,
} from "./localOnboardingStore";
import { LOCAL_RIG_ID, rigDirectoryStoreCreate, type RigDirectoryStore } from "./rigDirectoryStore";
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
import { desktopPreferencesCreate } from "./desktopPreferences";
import { desktopDebugStoreCreate } from "./desktopDebugStore";
import { desktopProfilerStoreCreate } from "./desktopProfilerStore";
import { desktopExperimentsPersistence } from "./desktopExperiments";
import { desktopWelcomePersistence } from "./desktopWelcome";
import { desktopNavigationOrderPersistence } from "./desktopNavigationOrder";
import { desktopSidebarCollapsePersistence } from "./desktopSidebarCollapse";
import { DesktopBootGate } from "./DesktopBootGate";
import {
    DesktopMediaPreviewWindow,
    desktopMediaPreviewEscapeBind,
    desktopMediaPreviewStoreCreate,
} from "./desktopMediaPreview";

/**
 * Hands one workspace file to the shell to show in a window of its own. The
 * shell decides whether the address is one of its Rigs' and refuses otherwise,
 * so a failure here is reported rather than retried against another route.
 */
function desktopMediaWindowOpen(bridge: HappyDesktopBridge): MediaWindowOpener {
    return (request) => {
        void bridge.mediaPreviewOpen(request.url).catch((error: unknown) => {
            console.error("Could not open the file in its own window.", error);
        });
    };
}

const desktopBrowserContentRender: BrowserContentRenderer = (props) => (
    <DesktopBrowserView {...props} />
);

const desktopHtmlPreviewRender: HtmlPreviewRenderer = (props) => (
    <DesktopHtmlPreviewView {...props} />
);

function desktopAction(operation: Promise<void>): void {
    void operation.catch(() => undefined);
}

/**
 * Publishes Happy's selected appearance source to Chromium. Electron applies it
 * process-wide, which is the boundary shared by browser guests, HTML previews,
 * and the separate media-preview window.
 */
function desktopAppearanceSynchronize(
    appearance: AppearanceStore,
    bridge: HappyDesktopBridge,
): void {
    const publish = () => bridge.appearanceSet(appearance.get().mode);
    publish();
    appearance.subscribe(publish);
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
    debug: AppRigDebugStore;
    profiler: AppRigProfilerStore;
    bridge: HappyDesktopBridge;
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    mediaWindow?: MediaWindowOpener;
    experiments: ExperimentsStore;
    platform: "desktop" | "web";
    router: RigRouter;
    navigationOrder: RigNavigationOrderStore;
    sidebarCollapse: RigSidebarCollapseStore;
    rigs: RigDirectoryStore;
    settings: RigSettingsStore;
    titleShimmer: TitleShimmerStore;
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
                debug: props.debug,
                profiler: props.profiler,
                htmlPreview: props.htmlPreview,
                mediaWindow: props.mediaWindow,
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
                experiments: props.experiments,
                navigationOrder: props.navigationOrder,
                sidebarCollapse: props.sidebarCollapse,
                platform: props.platform,
                rigs: props.rigs,
                settings: props.settings,
                titleShimmer: props.titleShimmer,
                windowState: props.windowState,
            }}
            router={props.router}
        />
    );
}

/**
 * First-run setup, while there is any of it left to do.
 *
 * Within local mode it does own the whole window until the machine can actually
 * run Rig and the person has answered the questions that follow, so the
 * workspace below is never mounted against a machine that is not ready. Which
 * stage is on is the main process's answer, so a restart, an interrupted
 * install, or a Rig that disappeared resumes here rather than in a remembered
 * position.
 */
function DesktopOnboardingGate(props: {
    appearance: AppearanceStore;
    children: ReactNode;
    store: LocalOnboardingStore;
    welcome: WelcomeStore;
}) {
    const snapshot = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
    const welcome = useSyncExternalStore(
        props.welcome.subscribe,
        props.welcome.get,
        props.welcome.get,
    );
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    // Nothing has answered yet, so nothing is known to be owed. Deciding here
    // would put the welcome — a full-colour mark and a slogan — in front of a
    // machine that turns out to need no setup at all, for exactly as long as the
    // main process takes to say so. The boot cover holds the window meanwhile.
    if (!snapshot.onboarding) return null;
    const view = localOnboardingView(snapshot);
    if (!view) return <>{props.children}</>;
    // Only ever in front of setup that is genuinely still owed. A machine that
    // is already working has nothing to introduce, so an unacknowledged welcome
    // there stays unacknowledged rather than interrupting someone mid-flight.
    if (!welcome.welcomeAcknowledged)
        return (
            <WelcomeScreen
                appearance={appearance.mode}
                onAction={() => props.welcome.welcomeAcknowledge()}
                onAppearanceChange={(mode) => props.appearance.appearanceSelect(mode)}
                slides={WELCOME_SLIDES}
            />
        );
    return (
        <LocalOnboardingScreen
            onConnectRetry={() => props.store.connectRetry()}
            onProfileCreate={() => props.store.profileCreate()}
            onProfileEmailChange={(value) => props.store.profileEmailUpdate(value)}
            onProfileNameChange={(value) => props.store.profileNameUpdate(value)}
            onProjectChoose={() => props.store.projectChoose()}
            view={view}
        />
    );
}

/**
 * What Happy says for itself before it has been set up, in the order it says it.
 *
 * The words live here rather than in the component because they are the product
 * talking, not a layout: `WelcomeScreen` owns the centred column, the slideshow,
 * and the button, and this is the only place that decides what any of it means.
 * The first slide is the mark and the name, so the very first thing on screen is
 * what the app is called; the rest each take one of the shipped animations and
 * say one true thing about what Happy does with it.
 */
const WELCOME_SLIDES: readonly WelcomeSlide[] = [
    {
        art: { kind: "logo" },
        copy: "A desktop home for the agents you work with, and the code they work on.",
        id: "happy",
        title: "Happy",
    },
    {
        art: { kind: "scene", name: "robot" },
        copy: "Start a session in any project and hand it real work. It keeps going while you look elsewhere.",
        id: "agents",
        title: "Agents that stay running.",
    },
    {
        art: { kind: "scene", name: "wand" },
        copy: "Every change lands in your own checkout, where you can read it, run it, and undo it.",
        id: "workspaces",
        title: "Your files, your machine.",
    },
    {
        art: { kind: "scene", name: "sparkles" },
        copy: "Work on your own files here, and reach the other machines you own from the same window.",
        id: "local",
        title: "Happy runs on your machine.",
    },
];

/** True while the runtime is working on, or running, this machine's own Rig. */
function desktopLocalPhase(snapshot: DesktopRuntimeSnapshot): boolean {
    if (snapshot.phase === "choosing") return false;
    if (snapshot.phase === "ready") return snapshot.mode === "local";
    return snapshot.request.mode === "local";
}

interface DesktopRendererProps {
    appearance: AppearanceStore;
    debug: AppRigDebugStore;
    profiler: AppRigProfilerStore;
    onboarding: LocalOnboardingStore;
    browserContent?: BrowserContentRenderer;
    htmlPreview?: HtmlPreviewRenderer;
    mediaWindow?: MediaWindowOpener;
    bridge: HappyDesktopBridge;
    experiments: ExperimentsStore;
    navigationOrder: RigNavigationOrderStore;
    sidebarCollapse: RigSidebarCollapseStore;
    platform: "desktop" | "web";
    rigRouter: RigRouter;
    rigs: RigDirectoryStore;
    settings: RigSettingsStore;
    titleShimmer: TitleShimmerStore;
    startupValues: StartupValuesStore;
    store: DesktopRuntimeStore;
    welcome: WelcomeStore;
    localWebUpdate: LocalWebUpdateStore;
    windowState: RigWindowStore;
}

/**
 * The desktop's own screens: choosing where Happy should run, the startup and
 * failure states of that choice, and the workspace once a machine is connected.
 * First-run setup is layered over this rather than built into it, so the choice
 * itself is always reachable.
 */
function DesktopRenderer(props: DesktopRendererProps) {
    return (
        // Outside every screen below, so one mark spans the whole run-up to a
        // workspace instead of being unmounted and remounted as the window moves
        // between the screens that boot crosses.
        <DesktopBootGate onboarding={props.onboarding} rigs={props.rigs} runtime={props.store}>
            <DesktopScreens {...props} />
        </DesktopBootGate>
    );
}

function DesktopScreens(props: DesktopRendererProps) {
    const snapshot = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
    const hostedUpdate = useSyncExternalStore(
        props.localWebUpdate.subscribe,
        props.localWebUpdate.get,
        props.localWebUpdate.get,
    );
    const content = (
        <DesktopProtocolGate
            onUpdateInstall={() => desktopAction(props.bridge.updateInstall())}
            // A runtime that is still choosing, starting, or failing answers for
            // itself, and those screens are the more actionable ones: a version
            // gap learned from an earlier connection must not talk over the
            // reason this one is not up. The gate stays mounted across that so
            // the workspace below it is never rebuilt by the change.
            ready={snapshot?.phase === "ready"}
            rigs={props.rigs}
            {...(snapshot?.update ? { update: snapshot.update } : {})}
        >
            <DesktopRuntimeContent {...props} hostedUpdate={hostedUpdate} snapshot={snapshot} />
        </DesktopProtocolGate>
    );
    // Local setup gates the workspace until this machine can run Rig.
    if (!snapshot || !desktopLocalPhase(snapshot)) return content;
    return (
        <DesktopOnboardingGate
            appearance={props.appearance}
            store={props.onboarding}
            welcome={props.welcome}
        >
            {content}
        </DesktopOnboardingGate>
    );
}

/**
 * The window when this build and the host's Rig cannot read each other.
 *
 * Every other unavailability in Happy belongs beside the Rig it affects, and
 * this one deliberately does not. A version gap is not a connection that might
 * come back: the daemon is up, answering, and speaking a protocol this build has
 * no code for, so nothing behind this screen would work and nothing anyone does
 * in it would change that. Waiting is not one of the options, which is why it is
 * not shown as a state to wait in.
 *
 * It is the host alone. A node with the same gap is one machine of several
 * whose work is missing while the rest of the app still does its job, so that
 * stays a notice beside that node.
 */
function DesktopProtocolGate(props: {
    children: ReactNode;
    onUpdateInstall(): void;
    /** False while the runtime still owns the window with a screen of its own. */
    ready: boolean;
    rigs: RigDirectoryStore;
    update?: DesktopUpdateSnapshot;
}) {
    const directory = useSyncExternalStore(props.rigs.subscribe, props.rigs.get, props.rigs.get);
    const mismatch = props.ready
        ? directory.rigs.find((rig) => rig.id === LOCAL_RIG_ID)?.protocolMismatch
        : undefined;
    if (!mismatch) return <>{props.children}</>;
    // Happy is behind. It updates itself, so the only useful thing on screen is
    // the update it already has — and, until it has one, the plain fact. The
    // button arrives here on its own when the download lands, because this
    // screen is drawn from the same runtime snapshot the updater publishes to.
    if (mismatch.side === "app") {
        const downloaded = props.update?.status === "downloaded";
        return (
            <SetupPage
                {...(downloaded
                    ? {
                          action: {
                              label: "Install update and restart",
                              onSelect: props.onUpdateInstall,
                          },
                      }
                    : {})}
                copy={`Rig on this machine speaks protocol ${mismatch.serverProtocolVersion}, and this build of Happy reads up to ${mismatch.supportedMaximum}. ${
                    downloaded
                        ? "The update is downloaded and ready to install."
                        : "Happy is looking for its own update and will offer it here as soon as it has one."
                }`}
                data-testid="desktop-protocol-screen"
                scene="owl"
                title="Happy is out of date."
            />
        );
    }
    // The daemon is behind, which is not something Happy can fix from here: it
    // is a global npm package on this machine, so the command is the answer.
    return (
        <SetupPage
            copy={`Rig on this machine speaks protocol ${mismatch.serverProtocolVersion}, and this build of Happy needs at least ${mismatch.supportedMinimum}. Update Rig, then start Happy again.`}
            data-testid="desktop-protocol-screen"
            scene="owl"
            title="Rig is out of date."
        />
    );
}

function DesktopRuntimeContent(
    props: DesktopRendererProps & {
        hostedUpdate: LocalWebUpdateSnapshot;
        snapshot: DesktopRuntimeSnapshot | undefined;
    },
) {
    const { hostedUpdate, snapshot } = props;
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
    if (snapshot.phase === "error")
        return (
            <DesktopStartupScreen
                error={snapshot.message}
                onChange={() => undefined}
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

    return (
        <RigBoundary
            appearance={props.appearance}
            bridge={props.bridge}
            debug={props.debug}
            profiler={props.profiler}
            browserContent={props.browserContent}
            htmlPreview={props.htmlPreview}
            mediaWindow={props.mediaWindow}
            experiments={props.experiments}
            navigationOrder={props.navigationOrder}
            sidebarCollapse={props.sidebarCollapse}
            platform={props.platform}
            router={props.rigRouter}
            rigs={props.rigs}
            settings={props.settings}
            titleShimmer={props.titleShimmer}
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
// The preview window is this same document, launched with the reduced bridge and
// loaded with the view it should mount. Deciding it here rather than after a
// round trip means the first frame is already the file instead of the whole
// application appearing for a beat.
const mediaPreviewBridge =
    new URLSearchParams(location.search).get(mediaPreviewView.key) === mediaPreviewView.value
        ? window.happyMediaPreview
        : undefined;
if (mediaPreviewBridge) {
    const previewBridge = mediaPreviewBridge;
    desktopMediaPreviewEscapeBind(previewBridge);
    root.render(
        <DesktopAppearance appearance={appearanceStoreCreate()}>
            <DesktopMediaPreviewWindow store={desktopMediaPreviewStoreCreate(previewBridge)} />
        </DesktopAppearance>,
    );
} else if (bridge) {
    const desktopBridge = bridge;
    const guestKeyUnsubscribe = desktopBridge.guestKeySubscribe((input: DesktopGuestKeyEvent) => {
        window.dispatchEvent(
            new KeyboardEvent(input.type, {
                altKey: input.altKey,
                bubbles: true,
                cancelable: true,
                code: input.code,
                ctrlKey: input.ctrlKey,
                isComposing: input.isComposing,
                key: input.key,
                location: input.location,
                metaKey: input.metaKey,
                repeat: input.repeat,
                shiftKey: input.shiftKey,
            }),
        );
    });
    window.addEventListener("unload", guestKeyUnsubscribe, { once: true });
    const start = (config: DesktopConfig): void => {
        const runtimeStore = desktopRuntimeStoreCreate(desktopBridge);
        // First-run setup outlives every daemon connection this window makes, so
        // its store is created once here beside the runtime store.
        const onboardingStore = localOnboardingStoreCreate(desktopBridge);
        // The local router outlives any single daemon connection, so it is created
        // here and the session store navigates through it when a conversation it
        // created should be opened.
        const rigRouter = rigRouterCreate();
        // Appearance, title motion, and model choices share one durable desktop
        // document. The adapter keeps its current value synchronous so writes
        // from any product store preserve changes already made by the others.
        const preferences = desktopPreferencesCreate(desktopBridge, config);
        // Appearance is chosen for the window, not for one connection, so the store is
        // created here beside the router and outlives both.
        const appearance = appearanceStoreCreate({ mode: preferences.initialAppearance });
        desktopAppearanceSynchronize(appearance, desktopBridge);
        appearance.subscribe(() => preferences.appearanceChanged(appearance.get().mode));
        const debug = desktopDebugStoreCreate(desktopBridge);
        const profiler = desktopProfilerStoreCreate(desktopBridge);
        // Defaults and model picker memory belong to the desktop, not one daemon.
        // The state stores stay synchronous while the bridge persists their typed
        // snapshots through the main process.
        const settings = rigSettingsStoreCreate(preferences.initialSettings);
        settings.subscribe(() => preferences.settingsChanged(settings.get()));
        // How the reader arranged the sidebar's pinned rows. It is the window's
        // Those rows are window chrome whether or not any machine is reachable,
        // so the arrangement must outlive every connection this window makes.
        const navigationOrder = rigNavigationOrderStoreCreate(desktopNavigationOrderPersistence());
        // Which projects the reader folded shut, kept beside that arrangement
        // and for the same reason: a fold is about this window's
        // sidebar, so no machine coming or going may undo it.
        const sidebarCollapse = rigSidebarCollapseStoreCreate(desktopSidebarCollapsePersistence());
        // Whether this window offers the features that are not finished yet. It
        // is kept beside the arrangement above and for the same reason: it says
        // what this installation shows, so no machine has a say in it.
        const experiments = experimentsStoreCreate(desktopExperimentsPersistence());
        // Active-title motion is also this window's own choice. The store keeps
        // the product default in memory and writes only after the reader changes
        // the switch, so untouched installations follow future defaults.
        const titleShimmer = titleShimmerStoreCreate(preferences.titleShimmerPersistence);
        // Whether this machine's owner has been welcomed. Kept beside the two
        // above because it answers the same kind of question: what this
        // installation shows, rather than anything a Rig knows.
        const welcome = welcomeStoreCreate(desktopWelcomePersistence());
        // Every Rig in this window, each with its own product stores. The router is
        // told to resolve its address again whenever the set of connected Rigs
        // changes, so a machine that connects after the URL already named it opens
        // the addressed conversation without the reader navigating twice.
        const rigs = rigDirectoryStoreCreate(desktopBridge, runtimeStore, {
            conversationOpen: (rigId, location) =>
                rigRouterConversationOpen(rigRouter, rigId, location),
            groupOpen: (rigId, groupId) => rigRouterGroupOpen(rigRouter, rigId, groupId),
            listOpen: (rigId, groupId) => rigRouterListOpen(rigRouter, rigId, groupId),
            modelPreferencePersistence: preferences.preferencePersistence,
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
                        debug={debug}
                        profiler={profiler}
                        onboarding={onboardingStore}
                        browserContent={browserLocal ? undefined : desktopBrowserContentRender}
                        htmlPreview={browserLocal ? undefined : desktopHtmlPreviewRender}
                        bridge={desktopBridge}
                        mediaWindow={
                            browserLocal ? undefined : desktopMediaWindowOpen(desktopBridge)
                        }
                        experiments={experiments}
                        navigationOrder={navigationOrder}
                        sidebarCollapse={sidebarCollapse}
                        // Only the Electron window hides its title bar; the browser
                        // development server renders the same tree with web chrome.
                        platform={browserLocal ? "web" : "desktop"}
                        rigRouter={rigRouter}
                        rigs={rigs}
                        localWebUpdate={localWebUpdateStoreCreate(localWebBuild)}
                        settings={settings}
                        titleShimmer={titleShimmer}
                        startupValues={startupValuesStoreCreate()}
                        store={runtimeStore}
                        welcome={welcome}
                        windowState={windowStateStoreCreate(desktopBridge)}
                    />
                </CodeHighlightWorkers>
            </DesktopAppearance>,
        );
    };
    void desktopBridge.desktopConfigGet().then(start, (error: unknown) => {
        console.error("Could not read desktop preferences.", error);
        start({
            appearance: "system",
            defaultEffort: RIG_DEFAULT_THINKING_LEVEL,
            defaultPermissionMode: "auto",
            modelPreferences: [],
            version: 1,
        });
    });
}
