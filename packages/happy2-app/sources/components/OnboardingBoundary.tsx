import type { ReactNode } from "react";
import type { AuthSession } from "./AuthGate";
import { ServerOnboarding } from "./ServerOnboarding";
export type OnboardingBoundaryProps = {
    session: AuthSession;
    showWindowDragRegion?: boolean;
    children: ReactNode;
};
/**
 * Blocks the main application until durable server setup is complete. It mounts
 * the centered server-onboarding surface first; only when that surface reports
 * the setup route has become complete does the application take over.
 */
export function OnboardingBoundary(props: OnboardingBoundaryProps) {
    return (
        <ServerOnboarding
            showWindowDragRegion={props.showWindowDragRegion}
            state={props.session.state}
        >
            {props.children}
        </ServerOnboarding>
    );
}
