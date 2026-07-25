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
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigSessionId,
    RigWorkspaceStore,
} from "happy2-state";
import { AppRigView } from "../AppRigView";

/**
 * Everything the local route tree needs that the URL does not address: the
 * daemon connection, the workspace product store, the host, and the clock. It is
 * the local counterpart of `AppRouterContext` and is supplied to
 * `RouterProvider` once a connection exists, so the router can be constructed
 * before any of these do.
 */
export interface RigRouterContext {
    readonly host: RigHost;
    readonly connection: RigConnectionStore;
    readonly workspace: RigWorkspaceStore;
    readonly clock: RigClockStore;
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

/** Addressing one local session materializes it, releasing the previous one. */
const chatRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    loader: ({ context, params }) => {
        context.workspace.conversationOpen(params.chatId as RigSessionId);
    },
    path: "/chats/$chatId",
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    workspaceRoute.addChildren([chatsIndexRoute, chatRoute]),
]);

function RigWorkspaceLayout() {
    // The router hooks resolve their types through the single global `Register`
    // declaration, which names the cloud router. Route definitions above are
    // still typed by `RigRouterContext` (loaders read it directly); only this
    // hook needs to be told which context it is reading.
    const context = useRouteContext({ strict: false }) as unknown as RigRouterContext;
    const navigate = useNavigate();
    // `strict: false` because the conversation list carries no `chatId`.
    const params = useParams({ strict: false });
    return (
        <AppRigView
            chatId={params.chatId}
            clock={context.clock}
            connection={context.connection}
            host={context.host}
            onChatSelect={(chatId, replace) =>
                void navigate(
                    chatId
                        ? { params: { chatId }, replace, to: "/chats/$chatId" }
                        : { replace, to: "/chats" },
                )
            }
            workspace={context.workspace}
        />
    );
}

/**
 * Creates the router that owns the local window's location lifetime. Local mode
 * addresses its sessions with the same `/chats/$chatId` shape the cloud workspace
 * uses, so a session is a URL in both modes and neither keeps a second, competing
 * selection in a store.
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
