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
    RigClockStore,
    RigConnectionStore,
    RigGroupId,
    RigHost,
    RigSessionId,
    RigSessionLocation,
    RigWindowStore,
    RigWorkspaceStore,
} from "happy2-state";
import { AppRigView } from "../AppRigView";

/**
 * Everything the local route tree needs that the URL does not address: the
 * daemon connection, the workspace product store, the host, the clock, and the
 * appearance selection. It is
 * the local counterpart of `AppRouterContext` and is supplied to
 * `RouterProvider` once a connection exists, so the router can be constructed
 * before any of these do.
 */
export interface RigRouterContext {
    readonly host: RigHost;
    readonly connection: RigConnectionStore;
    readonly workspace: RigWorkspaceStore;
    readonly clock: RigClockStore;
    readonly appearance: AppearanceStore;
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
}

const rootRoute = createRootRouteWithContext<RigRouterContext>()({
    component: () => <Outlet />,
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
        throw redirect({ replace: true, to: "/chats" });
    },
});

/**
 * The local workspace layout, pathless for the same reason the cloud one is: the
 * shell, the session list, and the open conversation's transcript keep one
 * instance while the addressed conversation changes underneath them.
 */
const workspaceRoute = createRoute({
    component: RigWorkspaceLayout,
    getParentRoute: () => rootRoute,
    id: "_workspace",
});

/**
 * Addressing the list without a conversation releases whichever one was open.
 * Materialization is a store concern applied on navigation; the URL alone says
 * which conversation that is.
 */
const chatsIndexRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context }) => {
        context.workspace.conversationClose();
    },
    path: "/chats",
});

/**
 * Addressing a project or worktree without one of its sessions: the group's tabs
 * are on screen but no session is open, so any previous one is released.
 */
const groupRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        context.workspace.groupOpen(params.groupId as RigGroupId);
    },
    path: "/chats/$groupId",
});

/** Addressing one local session materializes it, releasing the previous one. */
const chatRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        context.workspace.conversationOpen(params.chatId as RigSessionId);
    },
    path: "/chats/$groupId/$chatId",
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    workspaceRoute.addChildren([chatsIndexRoute, groupRoute, chatRoute]),
]);

function RigWorkspaceLayout() {
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
    // `strict: false` because the list carries neither param and a group
    // carries only `groupId`.
    const params = useParams({ strict: false }) as {
        groupId?: string;
        chatId?: string;
    };
    return (
        <AppRigView
            appearance={context.appearance}
            chatId={params.chatId}
            clock={context.clock}
            connection={context.connection}
            groupId={params.groupId}
            host={context.host}
            platform={context.platform}
            windowState={context.windowState}
            onChatSelect={(groupId, chatId, replace) =>
                void navigate(
                    groupId === undefined
                        ? { replace, to: "/chats" }
                        : chatId
                          ? {
                                params: { chatId, groupId },
                                replace,
                                to: "/chats/$groupId/$chatId",
                            }
                          : { params: { groupId }, replace, to: "/chats/$groupId" },
                )
            }
            workspace={context.workspace}
        />
    );
}

/**
 * Creates the router that owns the local window's location lifetime. Local
 * sessions are grouped by the daemon's projects, so their address is the group —
 * the project, or the worktree inside it, by the durable id the daemon assigned
 * it, which keeps a filesystem layout out of the URL and survives a rename — and
 * then the session inside it: `/chats/$groupId/$chatId`. It stays the same
 * cloud-shaped addressing, so a session is a URL in both modes and neither keeps
 * a second, competing selection in a store.
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
export function rigRouterConversationOpen(router: RigRouter, location: RigSessionLocation): void {
    void (
        router.navigate as unknown as (options: {
            params: Record<string, string>;
            to: string;
        }) => Promise<void>
    )({
        params: { chatId: location.sessionId, groupId: location.groupId },
        to: "/chats/$groupId/$chatId",
    });
}

/**
 * Addresses a group that holds no conversation yet, such as a worktree the
 * reader has just added. The conversation started in it re-addresses the same
 * group through `rigRouterConversationOpen` once it exists.
 */
export function rigRouterGroupOpen(router: RigRouter, groupId: string): void {
    void (
        router.navigate as unknown as (options: {
            params: Record<string, string>;
            to: string;
        }) => Promise<void>
    )({ params: { groupId }, to: "/chats/$groupId" });
}

/** Creates deterministic local-router history for application and navigation tests. */
export function rigMemoryHistoryCreate(initialEntry = "/chats"): RouterHistory {
    return createMemoryHistory({ initialEntries: [initialEntry] });
}

/**
 * Packaged desktop builds load over `file:`, where a browser history would rewrite
 * the document URL to a path that does not exist on disk; those use hash history.
 */
function defaultHistory(): RouterHistory {
    if (typeof window === "undefined") return rigMemoryHistoryCreate();
    return window.location.protocol === "file:" ? createHashHistory() : createBrowserHistory();
}

export type RigRouter = ReturnType<typeof rigRouterCreate>;
