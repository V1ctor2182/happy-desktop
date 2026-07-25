import {
    createBrowserHistory,
    createHashHistory,
    createMemoryHistory,
    createRouter,
    type RouterHistory,
} from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";
import type { AppRouterContext } from "./appRouterContext";

/**
 * Creates the one router that owns a window's location lifetime. The real context
 * is supplied by `RouterProvider` once state and the session exist, so the router
 * can be constructed before either is available.
 */
export function appRouterCreate(history: RouterHistory = defaultHistory()) {
    return createRouter({
        context: undefined as unknown as AppRouterContext,
        defaultPreload: false,
        history,
        routeTree,
        // The application owns scrolling inside its own scrollports; letting the
        // router restore or reset window scroll would fight them.
        scrollRestoration: () => false,
        scrollToTopSelectors: [],
    });
}

/** Creates deterministic router history for application and navigation tests. */
export function appMemoryHistoryCreate(initialEntry = "/chats"): RouterHistory {
    return createMemoryHistory({ initialEntries: [initialEntry] });
}

/**
 * Packaged desktop builds load over `file:`, where a browser history would rewrite
 * the document URL to a path that does not exist on disk; those use hash history.
 */
function defaultHistory(): RouterHistory {
    if (typeof window === "undefined") return appMemoryHistoryCreate();
    return window.location.protocol === "file:" ? createHashHistory() : createBrowserHistory();
}

export type AppRouter = ReturnType<typeof appRouterCreate>;

declare module "@tanstack/react-router" {
    interface Register {
        router: AppRouter;
    }
}
