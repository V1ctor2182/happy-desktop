import { useLayoutEffect, useReducer } from "react";
import { happyStateCreate } from "happy2-state";
import { AuthGate, type AuthCredentialStore, type AuthSession } from "./components/AuthGate";
import { DesktopApp } from "./components/DesktopApp";
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
