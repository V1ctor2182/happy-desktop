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
    RigHost,
    RigSessionId,
    RigSessionLocation,
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
 * Addressing a working directory without one of its sessions: the directory's
 * tabs are on screen but no session is open, so any previous one is released.
 */
const folderRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context }) => {
        context.workspace.conversationClose();
    },
    path: "/chats/$folderId",
});

/** Addressing one local session materializes it, releasing the previous one. */
const chatRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        context.workspace.conversationOpen(params.chatId as RigSessionId);
    },
    path: "/chats/$folderId/$chatId",
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    workspaceRoute.addChildren([chatsIndexRoute, folderRoute, chatRoute]),
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
    // `strict: false` because the list carries neither param and a directory
    // carries only `folderId`.
    const params = useParams({ strict: false }) as {
        folderId?: string;
        chatId?: string;
    };
    return (
        <AppRigView
            appearance={context.appearance}
            chatId={params.chatId}
            clock={context.clock}
            connection={context.connection}
            folderId={params.folderId}
            host={context.host}
            onChatSelect={(folderId, chatId, replace) =>
                void navigate(
                    folderId === undefined
                        ? { replace, to: "/chats" }
                        : chatId
                          ? {
                                params: { chatId, folderId },
                                replace,
                                to: "/chats/$folderId/$chatId",
                            }
                          : { params: { folderId }, replace, to: "/chats/$folderId" },
                )
            }
            workspace={context.workspace}
        />
    );
}

/**
 * Creates the router that owns the local window's location lifetime. Local
 * sessions are grouped by working directory, so their address is the directory
 * — a hash of its path, which keeps a filesystem layout out of the URL — and
 * then the session inside it: `/chats/$folderId/$chatId`. It stays the same
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
        params: { chatId: location.sessionId, folderId: location.folderId },
        to: "/chats/$folderId/$chatId",
    });
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
