import { useReducer, type ReactNode } from "react";
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
 * the setup route has become complete does the application take over. The latch
 * keeps the workspace mounted afterwards so a later reconciliation never tears
 * the app back down.
 */
export function OnboardingBoundary(props: OnboardingBoundaryProps) {
    const [complete, completeSet] = useReducer(() => true, false);
    return complete ? (
        props.children
    ) : (
        <ServerOnboarding
            onComplete={completeSet}
            showWindowDragRegion={props.showWindowDragRegion}
            state={props.session.state}
        />
    );
}
