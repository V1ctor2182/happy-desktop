import { useLayoutEffect, useReducer } from "react";
import { happyStateCreate } from "happy2-state";
import { AuthGate, type AuthCredentialStore, type AuthSession } from "./components/AuthGate";
import { DesktopApp } from "./components/DesktopApp";
import { DevTokenGate } from "./components/DevTokenGate";
import { OnboardingBoundary } from "./components/OnboardingBoundary";
import { appRouterCreate, type AppRouter } from "./navigation/appRouter";
import type {
    DesktopInstanceStatus,
    DesktopInstanceTarget,
    DesktopInstanceUpdate,
} from "happy2-ui";

export interface AppDesktopRuntime {
    activeTargetId: string;
    notice?: string;
    onChangeMode(): void;
    onInstallUpdate?(): void;
    onTargetSelect(id: string): void;
    status?: DesktopInstanceStatus;
    targets: readonly DesktopInstanceTarget[];
    update?: DesktopInstanceUpdate;
}
export interface AppProps {
    /** Supplied by tests to drive the app over a deterministic history. */
    router?: AppRouter;
    platform?: "desktop" | "web";
    serverUrl?: string;
    /**
     * Web deployments authenticate every request through a same-origin HttpOnly
     * cookie the gateway sets and the browser attaches automatically; the app
     * never handles a bearer token in JavaScript. When true, no session token is
     * persisted and the workspace transport carries no Authorization header — the
     * cookie alone authenticates it.
     */
    cookieAuth?: boolean;
    /**
     * A cookie deployment whose only sign-in bootstraps the cookie from a
     * development token the user types. Renders the development-token gate, which
     * validates the token through a single bearer `/v0/me` and then relies on the
     * cookie. Only meaningful together with `cookieAuth`, and takes precedence over
     * the header sign-in flow.
     */
    requireDevelopmentToken?: boolean;
    /** Optional native credential boundary; browser header auth keeps localStorage. */
    credentialStore?: AuthCredentialStore;
    /** Native runtime identity rendered consistently in every sidebar variant. */
    desktopRuntime?: AppDesktopRuntime;
}

/**
 * Owns host authentication plus the process-local state and router boundaries.
 *
 * Authentication and durable server setup are resolved here, above the route tree,
 * because until they succeed there is no product state for a route to read. Only
 * once a session exists does `DesktopApp` mount the router.
 */
export function App(props: AppProps) {
    const usesServer = !!props.serverUrl;
    const [resources] = useReducer(
        (value: {
            state?: ReturnType<typeof happyStateCreate>;
            router: AppRouter;
            ownsRouter: boolean;
        }) => value,
        undefined,
        () => ({
            state: usesServer ? undefined : happyStateCreate(),
            router: props.router ?? appRouterCreate(),
            ownsRouter: !props.router,
        }),
    );
    // eslint-disable-next-line happy2-react/no-layout-effect -- disposes the process-local state and router history this component created
    useLayoutEffect(() => {
        const { state, router, ownsRouter } = resources;
        return () => {
            state?.[Symbol.dispose]();
            if (ownsRouter) router.history.destroy();
        };
    }, [resources]);
    const desktop = props.platform === "desktop";
    const renderWorkspace = (session: AuthSession) => (
        <DesktopApp
            desktopRuntime={props.desktopRuntime}
            platform={props.platform}
            router={resources.router}
            session={session}
            state={session.state}
        />
    );
    if (props.cookieAuth && props.requireDevelopmentToken)
        // Cookie-authenticated web mode: the user types a development token, it is
        // validated once through a bearer `/v0/me`, and every later request rides
        // the HttpOnly cookie. No header sign-in or server-onboarding boundary.
        return (
            <DevTokenGate serverUrl={props.serverUrl ?? ""} showWindowDragRegion={desktop}>
                {renderWorkspace}
            </DevTokenGate>
        );
    if (props.serverUrl)
        return (
            <AuthGate
                cookieAuth={props.cookieAuth}
                credentialStore={props.credentialStore}
                serverUrl={props.serverUrl}
                showWindowDragRegion={desktop}
            >
                {(session: AuthSession) => (
                    <OnboardingBoundary session={session} showWindowDragRegion={desktop}>
                        {renderWorkspace(session)}
                    </OnboardingBoundary>
                )}
            </AuthGate>
        );
    return (
        <DesktopApp
            desktopRuntime={props.desktopRuntime}
            platform={props.platform}
            router={resources.router}
            state={resources.state!}
        />
    );
}
