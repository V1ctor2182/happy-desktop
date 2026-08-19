import {
    createBrowserHistory,
    createHashHistory,
    createMemoryHistory,
    createRootRouteWithContext,
    createRoute,
    createRouter,
    Outlet,
    redirect,
    useNavigate,
    useParams,
    useRouteContext,
    type RouterHistory,
} from "@tanstack/react-router";
import type {
    AppearanceStore,
    ExperimentsStore,
    RigGroupId,
    RigNavigationOrderStore,
    RigSidebarCollapseStore,
    RigSessionId,
    RigSessionLocation,
    RigSettingsStore,
    TitleShimmerStore,
    RigWindowStore,
    RigWorkspaceStore,
} from "happy-desktop-state";
import type {
    BrowserContentRenderer,
    HtmlPreviewRenderer,
    MediaWindowOpener,
} from "happy-desktop-ui";
import {
    AppRigView,
    type AppBuildIdentity,
    type AppRigDirectoryStore,
    type AppRigUpdate,
} from "../AppRigView";
import {
    AppRigSettingsView,
    RIG_SETTINGS_DEFAULT_CATEGORY,
    rigSettingsCategoryExists,
    type AppRigDebugStore,
    type AppRigProfilerStore,
} from "../views/AppRigSettingsView";

/**
 * Everything the local route tree needs that the URL does not address: the
 * directory of Rigs this window can work in — each carrying its own connection,
 * workspace, host, clock, and model catalog — the window's own preferences, and
 * the appearance selection. It is the local counterpart of `AppRouterContext`
 * and is supplied to `RouterProvider` once the directory exists, so the router
 * can be constructed before any Rig connects.
 */
export interface RigRouterContext {
    /** Native Chromium guest renderer, present only in packaged Electron. */
    readonly browserContent?: BrowserContentRenderer;
    /** Renders one HTML workspace file as a page, in a host that has an engine. */
    readonly htmlPreview?: HtmlPreviewRenderer;
    /**
     * Shows one workspace picture or recording in a window outside this one.
     * Present only in a shell that has separate windows to open, which is
     * packaged Electron.
     */
    readonly mediaWindow?: MediaWindowOpener;
    readonly debug?: AppRigDebugStore;
    readonly profiler?: AppRigProfilerStore;
    readonly rigs: AppRigDirectoryStore;
    /** This build's development identity; absent in the packaged product. */
    readonly buildIdentity?: AppBuildIdentity;
    readonly appearance: AppearanceStore;
    /** The window's own local preferences: default model, effort, and permissions. */
    readonly settings: RigSettingsStore;
    /**
     * Where this window remembers the order the reader arranged the sidebar's
     * pinned rows in. Absent in a host that keeps no such record, which leaves
     * the rows in the order the window offers them.
     */
    readonly navigationOrder?: RigNavigationOrderStore;
    /**
     * Where this window remembers which sidebar rows the reader folded shut.
     * Absent in a host that keeps no such record, which leaves every row open.
     */
    readonly sidebarCollapse?: RigSidebarCollapseStore;
    /**
     * Whether this window offers the features that are not finished yet. Absent
     * in a host that remembers no such choice, which withholds them.
     */
    readonly experiments?: ExperimentsStore;
    /** Window-local preference for animated activity titles. */
    readonly titleShimmer?: TitleShimmerStore;
    /**
     * Which shell hosts this router. The Electron window has no native title bar,
     * so the workspace draws the traffic-light inset and drag lanes itself; the
     * browser development mode renders ordinary web chrome.
     */
    readonly platform?: "desktop" | "web";
    /**
     * The window's own chrome state. Full screen takes the native controls away,
     * so the inset the workspace reserves for them has to follow the window
     * rather than the platform.
     */
    readonly windowState?: RigWindowStore;
    /** Desktop-shell update state; absent when this route tree runs as plain web UI. */
    readonly update?: AppRigUpdate;
    readonly onUpdateApply?: () => void;
}

const rootRoute = createRootRouteWithContext<RigRouterContext>()({
    component: () => <Outlet />,
});

/**
 * The Rig a bare address lands on: the first one in the window, which is the
 * machine this window runs on. The default is read rather than written down so
 * this file never names one Rig as special.
 */
function rigDefaultId(context: RigRouterContext | undefined): string {
    return context?.rigs?.get().rigs[0]?.id ?? "local";
}

/**
 * Redirects to one machine's list. The router helper's generic path type does not
 * retain this locally assembled tree, so `rigRouterCreate` checks the path here.
 */
function rigListRedirect(rigId: string): never {
    throw redirect({
        params: { rigId },
        replace: true,
        to: "/chats/$rigId",
    } as unknown as Parameters<typeof redirect>[0]);
}

/** The addressed Rig's workspace store, absent while that Rig is not connected. */
function rigWorkspace(context: RigRouterContext, rigId: string): RigWorkspaceStore | undefined {
    context.rigs.rigActivate(rigId);
    return context.rigs.get().rigs.find((rig) => rig.id === rigId)?.session?.workspace;
}

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: ({ context }) => rigListRedirect(rigDefaultId(context)),
});

const chatsRootRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/chats",
    beforeLoad: ({ context }) => rigListRedirect(rigDefaultId(context)),
});

/**
 * The workspace layout is pathless so the shell, session list, and open
 * transcript keep one instance while the addressed machine and conversation
 * change underneath them.
 */
const workspaceRoute = createRoute({
    component: RigWorkspaceLayout,
    getParentRoute: () => rootRoute,
    id: "_workspace",
});

/**
 * Addressing one Rig without a conversation releases whichever one was open in
 * it. Materialization is a store concern applied on navigation; the URL alone
 * says which Rig and which conversation that is.
 */
const chatsIndexRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        rigWorkspace(context, params.rigId)?.conversationClose();
    },
    path: "/chats/$rigId",
});

/**
 * Addressing a project or worktree without one of its sessions: the group's tabs
 * are on screen but no session is open, so any previous one is released.
 */
const groupRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        rigWorkspace(context, params.rigId)?.groupOpen(params.groupId as RigGroupId);
    },
    path: "/chats/$rigId/$groupId",
});

/** Addressing one session materializes it, releasing the previous one. */
const chatRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        const groupId = params.groupId as RigGroupId;
        rigWorkspace(context, params.rigId)?.conversationOpen(
            params.chatId as RigSessionId,
            groupId,
        );
    },
    path: "/chats/$rigId/$groupId/$chatId",
});

/**
 * One machine's inbox of agent questions. The Rig is in the address because the
 * queue is that machine's — its agents are the ones waiting — so the window's
 * back and forward move between machines' inboxes rather than between two views
 * of one ambiguous list.
 */
const inboxRoute = createRoute({
    component: RigInboxRoute,
    getParentRoute: () => rootRoute,
    path: "/inbox/$rigId",
});

/**
 * The component workbench, addressed without a Rig because it renders component
 * pages rather than anything a machine holds. The route is registered only in a
 * development build, which is also the only build whose sidebar offers it.
 */
const blueprintRoute = createRoute({
    component: RigBlueprintRoute,
    getParentRoute: () => rootRoute,
    path: "/blueprint",
});

const settingsIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    beforeLoad: () => {
        throw redirect({
            params: { section: RIG_SETTINGS_DEFAULT_CATEGORY },
            replace: true,
            to: "/settings/$section",
        });
    },
});

/**
 * One settings category, addressed the same way a conversation is: the URL names
 * which category is open, so the window's back/forward and its permanent category
 * column agree without a second selection living in a store.
 */
const settingsSectionRoute = createRoute({
    component: RigSettingsRoute,
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    beforeLoad: ({ params }) => {
        if (!rigSettingsCategoryExists(params.section))
            throw redirect({
                params: { section: RIG_SETTINGS_DEFAULT_CATEGORY },
                replace: true,
                to: "/settings/$section",
            });
    },
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    chatsRootRoute,
    workspaceRoute.addChildren([chatsIndexRoute, groupRoute, chatRoute]),
    inboxRoute,
    ...(import.meta.env.DEV ? [blueprintRoute] : []),
    settingsIndexRoute,
    settingsSectionRoute,
]);

/**
 * The inbox address renders the same window a conversation does: the shell and
 * its sidebar stay, and only the content area changes, so working through
 * questions is not leaving the workspace.
 */
function RigInboxRoute() {
    return <RigWorkspaceLayout inbox />;
}

/**
 * The workbench address renders the same window a conversation does: the shell
 * and its sidebar stay, and only the content area changes.
 */
function RigBlueprintRoute() {
    return <RigWorkspaceLayout blueprint />;
}

function RigWorkspaceLayout(
    props: {
        blueprint?: boolean;
        inbox?: boolean;
    } = {},
) {
    // The hook's generic inference does not retain this locally assembled route
    // tree. Route definitions above are still typed by `RigRouterContext`;
    // only this hook needs to be told which context it is reading.
    const context = useRouteContext({ strict: false }) as unknown as RigRouterContext;
    // Likewise, the hook cannot infer this tree's literal path union. The paths
    // below are checked against the tree by `rigRouterCreate`.
    const navigate = useNavigate() as unknown as (options: {
        params?: Record<string, string>;
        replace?: boolean;
        to: string;
    }) => Promise<void>;
    // `strict: false` because a Rig's list carries only `rigId`, and a group
    // carries no `chatId`.
    const params = useParams({ strict: false }) as {
        rigId?: string;
        groupId?: string;
        chatId?: string;
    };
    // The router is constructed before RouterProvider supplies the real context,
    // so the very first render of a deep-linked URL can arrive with an empty
    // context; the provider's context lands on the next synchronous pass.
    if (!context.rigs) return null;
    return (
        <AppRigView
            appearance={context.appearance}
            browserContent={context.browserContent}
            buildIdentity={context.buildIdentity}
            htmlPreview={context.htmlPreview}
            mediaWindow={context.mediaWindow}
            chatId={params.chatId}
            groupId={params.groupId}
            {...(context.experiments ? { experiments: context.experiments } : {})}
            {...(context.titleShimmer ? { titleShimmer: context.titleShimmer } : {})}
            {...(context.navigationOrder ? { navigationOrder: context.navigationOrder } : {})}
            {...(context.sidebarCollapse ? { sidebarCollapse: context.sidebarCollapse } : {})}
            inboxOpen={props.inbox}
            blueprintOpen={props.blueprint}
            // Offered only where the route exists, which is what puts the
            // workbench row in a development sidebar and nowhere else.
            {...(import.meta.env.DEV
                ? { onBlueprintOpen: () => void navigate({ to: "/blueprint" }) }
                : {})}
            onInboxOpen={() =>
                void navigate({
                    params: { rigId: params.rigId ?? rigDefaultId(context) },
                    to: "/inbox/$rigId",
                })
            }
            onUpdateApply={context.onUpdateApply}
            platform={context.platform}
            rigId={params.rigId ?? rigDefaultId(context)}
            rigs={context.rigs}
            update={context.update}
            windowState={context.windowState}
            onChatSelect={(rigId, groupId, chatId, replace) =>
                void navigate(
                    groupId === undefined
                        ? { params: { rigId }, replace, to: "/chats/$rigId" }
                        : chatId
                          ? {
                                params: { chatId, groupId, rigId },
                                replace,
                                to: "/chats/$rigId/$groupId/$chatId",
                            }
                          : { params: { groupId, rigId }, replace, to: "/chats/$rigId/$groupId" },
                )
            }
            onSettingsOpen={() =>
                void navigate({
                    params: { section: RIG_SETTINGS_DEFAULT_CATEGORY },
                    to: "/settings/$section",
                })
            }
        />
    );
}

/**
 * Local route glue. Leaving settings addresses the conversation list rather than
 * popping history, so the way out is the same wherever the window was opened
 * from — including a cold start straight onto a settings URL.
 */
function RigSettingsRoute() {
    const context = useRouteContext({ strict: false }) as unknown as RigRouterContext;
    const navigate = useNavigate() as unknown as (options: {
        params?: Record<string, string>;
        replace?: boolean;
        to: string;
    }) => Promise<void>;
    const params = useParams({ strict: false }) as { section?: string };
    return (
        <AppRigSettingsView
            appearance={context.appearance}
            {...(context.debug ? { debug: context.debug } : {})}
            {...(context.profiler ? { profiler: context.profiler } : {})}
            {...(context.experiments ? { experiments: context.experiments } : {})}
            onCategorySelect={(section) =>
                void navigate({ params: { section }, to: "/settings/$section" })
            }
            onClose={() => void navigate({ to: "/chats" })}
            rigs={context.rigs}
            platform={context.platform}
            section={params.section ?? RIG_SETTINGS_DEFAULT_CATEGORY}
            settings={context.settings}
            {...(context.titleShimmer ? { titleShimmer: context.titleShimmer } : {})}
            windowState={context.windowState}
        />
    );
}

/**
 * Creates the router that owns the local window's location lifetime. Local
 * sessions are grouped by the daemon's projects, so their address is the group —
 * the project, or the worktree inside it, by the durable id the daemon assigned
 * it, which keeps a filesystem layout out of the URL and survives a rename — and
 * then the session inside it. The machine comes first, because the same project
 * name may exist on several of them: `/chats/$rigId/$groupId/$chatId`. It stays
 * one stable address, so the UI never keeps a second competing selection in a
 * store.
 */
export function rigRouterCreate(history: RouterHistory = defaultHistory()) {
    return createRouter({
        context: undefined as unknown as RigRouterContext,
        defaultPreload: false,
        history,
        routeTree,
        // The application owns scrolling inside its own scrollports; letting the
        // router restore or reset window scroll would fight them.
        scrollRestoration: () => false,
        scrollToTopSelectors: [],
    });
}

/**
 * Addresses one local session: the single place that turns a session's location
 * into a local URL. The cast stays inside this module because the router helper
 * cannot expose this assembled tree's literal paths to outside callers; the
 * desktop shell never hand-builds a local URL.
 */
export function rigRouterConversationOpen(
    router: RigRouter,
    rigId: string,
    location: RigSessionLocation,
): void {
    void (
        router.navigate as unknown as (options: {
            params: Record<string, string>;
            to: string;
        }) => Promise<void>
    )({
        params: { chatId: location.sessionId, groupId: location.groupId, rigId },
        to: "/chats/$rigId/$groupId/$chatId",
    });
}

/**
 * Addresses a group that holds no conversation yet, such as a worktree the
 * reader has just added. The conversation started in it re-addresses the same
 * group through `rigRouterConversationOpen` once it exists.
 */
export function rigRouterGroupOpen(router: RigRouter, rigId: string, groupId: string): void {
    void (
        router.navigate as unknown as (options: {
            params: Record<string, string>;
            to: string;
        }) => Promise<void>
    )({ params: { groupId, rigId }, to: "/chats/$rigId/$groupId" });
}

/**
 * Addresses a Rig's own list because one of its groups stopped existing — its
 * project archived, here or from another window or another machine. It is the
 * nearest address that is still true for a reader who was inside that group.
 *
 * It moves nobody who is not standing on the thing that went. A Rig reports the
 * removal of its own group whether or not the window is currently showing it, so
 * the current address is what decides: only a route naming this exact Rig and
 * this exact group is replaced. Everything else — another project, the Rig's own
 * list or settings — is already a valid address, and a removal elsewhere
 * is inert against it.
 *
 * Replace rather than push: the entry being left names a row that is gone, so
 * keeping it in history would only offer a Back that lands nowhere.
 */
export function rigRouterListOpen(router: RigRouter, rigId: string, groupId: string): void {
    // The router's own matched route, never a hand-parsed path: it already
    // knows which route the window is showing and what its parameters decoded
    // to, and the leaf match is the whole answer. Only the two routes that put
    // the reader *inside* a group qualify — the group itself and a conversation
    // in it. Any other address, including one that matched nothing, is left
    // alone.
    //
    // The matches are read through the same structural cast this file already
    // uses for `navigate`: the ambient route registration these types resolve
    // against is not this router's tree, so the generated union names routes
    // that do not exist here. The values are the router's own.
    const matches = router.state.matches as unknown as readonly {
        readonly params: Record<string, string | undefined>;
        readonly routeId: string;
    }[];
    const match = matches.at(-1);
    if (match === undefined) return;
    if (match.routeId !== groupRoute.id && match.routeId !== chatRoute.id) return;
    if (match.params.rigId !== rigId || match.params.groupId !== groupId) return;
    void (
        router.navigate as unknown as (options: {
            params: Record<string, string>;
            replace: boolean;
            to: string;
        }) => Promise<void>
    )({ params: { rigId }, replace: true, to: "/chats/$rigId" });
}

/** Creates deterministic local-router history for application and navigation tests. */
export function rigMemoryHistoryCreate(initialEntry = "/chats/local"): RouterHistory {
    return createMemoryHistory({ initialEntries: [initialEntry] });
}

/**
 * Packaged desktop builds load over `file:`, where a browser history would
 * rewrite the document URL to a path that does not exist on disk. The hosted
 * local shell has the same constraint because its static Pages host has no SPA
 * fallback. Both use hash history; browser-local development retains normal
 * browser URLs.
 */
function defaultHistory(): RouterHistory {
    if (typeof window === "undefined") return rigMemoryHistoryCreate();
    const hostedDesktop = new URLSearchParams(window.location.search).get("desktop") === "1";
    return window.location.protocol === "file:" || hostedDesktop
        ? createHashHistory()
        : createBrowserHistory();
}

export type RigRouter = ReturnType<typeof rigRouterCreate>;
