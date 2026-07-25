import type { DesktopInstanceSwitcherProps, ThemeMode } from "happy2-ui";
import type { HappyState, PermissionsSnapshot } from "happy2-state";
import type { AuthSession } from "../components/AuthGate";

/**
 * Everything a route needs that the URL does not address. Route components are
 * statically declared modules and cannot receive props, so the values that used
 * to be threaded down from the application root travel here instead.
 *
 * This is deliberately narrow: product state, the authenticated session, host
 * identity, and the appearance control that the workspace sidebar renders. A
 * screen's own data is materialized from `state`; it is never added here.
 */
export interface AppRouterContext {
    /** The process-local product state every screen materializes its stores from. */
    readonly state: HappyState;
    /** Absent for the local, account-less deployment. */
    readonly session?: AuthSession;
    readonly platform?: "desktop" | "web";
    /**
     * The live effective-permission projection. Routes derive what they may show
     * from this with `adminSectionsProject` and `permissionAllowed`, so no screen
     * needs its own permissions subscription.
     */
    readonly permissions: PermissionsSnapshot;
    /** Resolved appearance and its toggle, owned above the router. */
    readonly appearance: "dark" | "light";
    readonly themeMode: ThemeMode;
    appearanceToggle(): void;
    /** Native runtime chooser, present only in the desktop shell. */
    readonly desktopRuntime?: DesktopInstanceSwitcherProps;
}

/**
 * Marks a workspace child route as one that replaces the conversation area. The
 * workspace layout renders its `Outlet` into `ChatPage`'s workspace slot only for
 * these routes; a conversation route leaves the slot alone so `ChatPage` shows the
 * conversation itself.
 */
export interface AppRouteStaticData {
    /** True when the route renders a screen in place of the conversation. */
    readonly workspaceScreen?: boolean;
}

declare module "@tanstack/react-router" {
    interface StaticDataRouteOption extends AppRouteStaticData {}
}
