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
    NotesSessionStore,
    RigGroupId,
    RigNavigationOrderStore,
    RigSessionId,
    RigSessionLocation,
    RigSettingsStore,
    RigWindowStore,
    RigWorkspaceStore,
} from "happy2-state";
import type {
    BrowserContentRenderer,
    HtmlPreviewRenderer,
    MediaWindowOpener,
    RigPluginApplicationContentRenderer,
} from "happy2-ui";
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
    /**
     * Mounts a local plugin's own isolated view. Present only in packaged
     * Electron, which is the only shell that can isolate one.
     */
    readonly pluginApplicationContent?: RigPluginApplicationContentRenderer;
    /** Renders one HTML workspace file as a page, in a host that has an engine. */
    readonly htmlPreview?: HtmlPreviewRenderer;
    /**
     * Shows one workspace picture or recording in a window outside this one.
     * Present only in a shell that has separate windows to open, which is
     * packaged Electron.
     */
    readonly mediaWindow?: MediaWindowOpener;
    readonly rigs: AppRigDirectoryStore;
    /** This build's development identity; absent in the packaged product. */
    readonly buildIdentity?: AppBuildIdentity;
    readonly appearance: AppearanceStore;
    /**
     * This machine's notes, absent in a host that stores none. They are the
     * window's, not a Rig's: the files live in the reader's home directory, so
     * they outlive every connection this window makes.
     */
    readonly notes?: NotesSessionStore;
    /** The window's own local preferences: default model, effort, and permissions. */
    readonly settings: RigSettingsStore;
    /**
     * Where this window remembers the order the reader arranged the sidebar's
     * pinned rows in. Absent in a host that keeps no such record, which leaves
     * the rows in the order the window offers them.
     */
    readonly navigationOrder?: RigNavigationOrderStore;
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
function rigDefaultId(context: RigRouterContext): string {
    return context.rigs.get().rigs[0]?.id ?? "local";
}

/**
 * Redirects to one Rig's list. The global TanStack `Register` names the cloud
 * route tree, so a local path cannot be expressed in the router's own types here;
 * `rigRouterCreate` checks these paths against this route tree instead.
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
 * The local workspace layout, pathless for the same reason the cloud one is: the
 * shell, the session list, and the open conversation's transcript keep one
 * instance while the addressed Rig and conversation change underneath them.
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
 * This machine's notes, addressed without a Rig: they are files in the reader's
 * home directory, so no machine appears in their address. The note itself is a
 * path segment for the same reason a conversation is — the window's back and
 * forward move between notes, and the open one survives a reload.
 */
const notesIndexRoute = createRoute({
    component: RigNotesRoute,
    getParentRoute: () => rootRoute,
    loader: ({ context }) => {
        context.notes?.notesOpen();
    },
    path: "/notes",
});

const noteRoute = createRoute({
    component: RigNotesRoute,
    getParentRoute: () => rootRoute,
    loader: ({ context, params }) => {
        context.notes?.notesOpen(params.noteId);
    },
    path: "/notes/$noteId",
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
 * One machine's provider usage. The Rig is in the address for the same reason
 * the inbox carries it: the accounts being spent are that machine's, so the
 * window's back and forward move between machines rather than between two views
 * of one ambiguous total.
 */
const usageRoute = createRoute({
    component: RigUsageRoute,
    getParentRoute: () => rootRoute,
    path: "/usage/$rigId",
});

/**
 * One machine's plugin packages: what is installed on it, what is waiting to be
 * updated, and what is on offer. The Rig is in the address for the same reason
 * the inbox and usage carry it — the packages are that machine's, so the window's
 * back and forward move between machines rather than between two views of one
 * ambiguous list.
 *
 * It sits directly above the application address below it, which is the
 * relationship between the two: this reading is the packages, and that one is a
 * destination one of them contributes.
 */
const pluginsRoute = createRoute({
    component: RigPluginsRoute,
    getParentRoute: () => rootRoute,
    path: "/plugins/$rigId",
});

/**
 * One application a locally installed plugin contributes. The Rig is in the
 * address because the plugin is installed on that machine, and the application's
 * stable identity follows it — not its generation, so the window stays where it
 * is while that plugin restarts and its code is replaced.
 */
const pluginApplicationRoute = createRoute({
    component: RigPluginApplicationRoute,
    getParentRoute: () => rootRoute,
    path: "/plugins/$rigId/$applicationId",
});

/**
 * The account's friends, addressed without a Rig: who a person is connected to
 * does not belong to one machine, so no machine appears in the address.
 */
const friendsRoute = createRoute({
    component: RigFriendsRoute,
    getParentRoute: () => rootRoute,
    path: "/friends",
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
    notesIndexRoute,
    noteRoute,
    inboxRoute,
    usageRoute,
    pluginsRoute,
    pluginApplicationRoute,
    friendsRoute,
    ...(import.meta.env.DEV ? [blueprintRoute] : []),
    settingsIndexRoute,
    settingsSectionRoute,
]);

/**
 * The notes address renders the same window as a conversation does: the shell and
 * its sidebar stay, and only the content area changes, so opening notes is not
 * leaving the workspace.
 */
function RigNotesRoute() {
    return <RigWorkspaceLayout notes />;
}

/**
 * The inbox address renders the same window a conversation does: the shell and
 * its sidebar stay, and only the content area changes, so working through
 * questions is not leaving the workspace.
 */
function RigInboxRoute() {
    return <RigWorkspaceLayout inbox />;
}

/**
 * The usage address renders the same window a conversation does: the shell and
 * its sidebar stay, and only the content area changes.
 */
function RigUsageRoute() {
    return <RigWorkspaceLayout usage />;
}

/**
 * The friends address renders the same window a conversation does: the shell and
 * its sidebar stay, and only the content area changes.
 */
function RigFriendsRoute() {
    return <RigWorkspaceLayout friends />;
}

/**
 * The workbench address renders the same window a conversation does: the shell
 * and its sidebar stay, and only the content area changes.
 */
function RigBlueprintRoute() {
    return <RigWorkspaceLayout blueprint />;
}

/**
 * The plugin catalog renders the same window a conversation does: the shell and
 * its sidebar stay, and only the content area changes, so managing what is
 * installed is not leaving the workspace.
 */
function RigPluginsRoute() {
    return <RigWorkspaceLayout plugins />;
}

/**
 * A plugin application renders the same window a conversation does: the shell
 * and its sidebar stay, and only the content area changes, so opening one is not
 * leaving the workspace.
 */
function RigPluginApplicationRoute() {
    return <RigWorkspaceLayout pluginApplication />;
}

function RigWorkspaceLayout(
    props: {
        blueprint?: boolean;
        friends?: boolean;
        inbox?: boolean;
        notes?: boolean;
        pluginApplication?: boolean;
        plugins?: boolean;
        usage?: boolean;
    } = {},
) {
    // The router hooks resolve their types through the single global `Register`
    // declaration, which names the cloud router. Route definitions above are
    // still typed by `RigRouterContext` (loaders read it directly); only this
    // hook needs to be told which context it is reading.
    const context = useRouteContext({ strict: false }) as unknown as RigRouterContext;
    // Same reason: the global `Register` names the cloud route tree, so the
    // hook's literal path union is the cloud one. The local paths below are
    // checked against this route tree by `rigRouterCreate`, not by this hook.
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
        noteId?: string;
        applicationId?: string;
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
            noteId={params.noteId}
            {...(context.navigationOrder ? { navigationOrder: context.navigationOrder } : {})}
            notes={context.notes}
            notesOpen={props.notes}
            inboxOpen={props.inbox}
            usageOpen={props.usage}
            friendsOpen={props.friends}
            blueprintOpen={props.blueprint}
            // Offered only where the route exists, which is what puts the
            // workbench row in a development sidebar and nowhere else.
            {...(import.meta.env.DEV
                ? { onBlueprintOpen: () => void navigate({ to: "/blueprint" }) }
                : {})}
            pluginsOpen={props.plugins}
            onPluginsOpen={() =>
                void navigate({
                    params: { rigId: params.rigId ?? rigDefaultId(context) },
                    to: "/plugins/$rigId",
                })
            }
            pluginApplicationContent={context.pluginApplicationContent}
            {...(props.pluginApplication && params.applicationId
                ? { pluginApplicationId: params.applicationId }
                : {})}
            onPluginApplicationOpen={(applicationId) =>
                void navigate({
                    params: { applicationId, rigId: params.rigId ?? rigDefaultId(context) },
                    to: "/plugins/$rigId/$applicationId",
                })
            }
            onFriendsOpen={() => void navigate({ to: "/friends" })}
            onInboxOpen={() =>
                void navigate({
                    params: { rigId: params.rigId ?? rigDefaultId(context) },
                    to: "/inbox/$rigId",
                })
            }
            onUsageOpen={() =>
                void navigate({
                    params: { rigId: params.rigId ?? rigDefaultId(context) },
                    to: "/usage/$rigId",
                })
            }
            onNotesOpen={(noteId) =>
                void navigate(
                    noteId === undefined
                        ? { to: "/notes" }
                        : { params: { noteId }, to: "/notes/$noteId" },
                )
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
            onCategorySelect={(section) =>
                void navigate({ params: { section }, to: "/settings/$section" })
            }
            onClose={() => void navigate({ to: "/chats" })}
            rigs={context.rigs}
            platform={context.platform}
            section={params.section ?? RIG_SETTINGS_DEFAULT_CATEGORY}
            settings={context.settings}
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
 * the same cloud-shaped addressing, so a session is a URL in both modes and
 * neither keeps a second, competing selection in a store.
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
 * into a local URL. It exists because the global TanStack `Register` names the
 * cloud route tree, so a caller outside this module cannot express a local path
 * in the router's own types; keeping the cast here means the desktop shell never
 * hand-builds a local URL.
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
