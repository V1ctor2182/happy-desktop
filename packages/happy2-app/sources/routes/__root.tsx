import { createRootRouteWithContext, Outlet, useNavigate } from "@tanstack/react-router";
import { StoreSurface } from "happy2-ui";
import type { AppRouterContext } from "../navigation/appRouterContext";
import { DesktopOverlaySurface } from "../components/DesktopOverlaySurface";
import { PluginOpenAppWatcher } from "../views/PluginOpenAppWatcher";
import { SearchShortcut } from "../components/SearchShortcut";

/**
 * The root of the application route tree. It declares the context every route
 * reads and hosts the layers that sit above all screens: the transient overlay
 * stack, the global search shortcut, and the watcher that opens a plugin app when
 * a contribution asks for one.
 *
 * Overlays live here rather than inside a screen so opening one never unmounts
 * the screen behind it, and so the same modal stack is reachable from every route.
 */
export const Route = createRootRouteWithContext<AppRouterContext>()({
    component: RootRoute,
});

function RootRoute() {
    const context = Route.useRouteContext();
    const navigate = useNavigate();
    const overlays = context.state.overlays();
    return (
        <>
            <Outlet />
            <SearchShortcut overlays={overlays} />
            <DesktopOverlaySurface
                onChannelOpen={(chatId) =>
                    void navigate({ to: "/channels/$chatId", params: { chatId } })
                }
                overlays={overlays}
                session={context.session}
                state={context.state}
            />
            <StoreSurface store={context.state.pluginNavigation()}>
                {(nav) => (
                    <PluginOpenAppWatcher
                        actionStates={nav.actionStates}
                        onAppOpen={(instanceId) =>
                            void navigate({ to: "/apps/$appId", params: { appId: instanceId } })
                        }
                        overlays={overlays}
                    />
                )}
            </StoreSurface>
        </>
    );
}
