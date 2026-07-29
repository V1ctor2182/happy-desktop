import { useSyncExternalStore } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { StoreSurface, ThemeScope, type DesktopInstanceSwitcherProps } from "happy2-ui";
import type { AppearanceStore, HappyState } from "happy2-state";
import type { AuthSession } from "./AuthGate";
import type { AppRouter } from "../navigation/appRouter";
import type { AppRouterContext } from "../navigation/appRouterContext";

export interface DesktopAppProps {
    appearance: AppearanceStore;
    desktopRuntime?: DesktopInstanceSwitcherProps;
    platform?: "desktop" | "web";
    router: AppRouter;
    session?: AuthSession;
    state: HappyState;
}

/**
 * Mounts the route tree. It owns only what has to sit above every route: the
 * appearance scope and the router context.
 *
 * Permissions are subscribed here, once, and handed to routes through context.
 * Administration visibility and the reachable section list are derived from that
 * one projection, so no screen opens a second subscription and every route agrees
 * about what the session may see.
 */
export function DesktopApp(props: DesktopAppProps) {
    const appearance = useSyncExternalStore(
        props.appearance.subscribe,
        props.appearance.get,
        props.appearance.get,
    );
    return (
        <StoreSurface store={props.state.permissions()}>
            {(permissions) => {
                const context: AppRouterContext = {
                    appearance: appearance.appearance,
                    appearanceToggle: props.appearance.appearanceToggle,
                    desktopRuntime: props.desktopRuntime,
                    permissions,
                    platform: props.platform,
                    session: props.session,
                    state: props.state,
                    themeMode: appearance.mode,
                };
                return (
                    <ThemeScope mode={appearance.mode}>
                        <RouterProvider context={context} router={props.router} />
                    </ThemeScope>
                );
            }}
        </StoreSurface>
    );
}
