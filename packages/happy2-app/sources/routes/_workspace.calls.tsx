import { createFileRoute } from "@tanstack/react-router";
import { CallsView } from "../views/CallsView";

/** The calls screen. */
export const Route = createFileRoute("/_workspace/calls")({
    component: CallsScreen,
    staticData: { workspaceScreen: true },
});

function CallsScreen() {
    return <CallsView state={Route.useRouteContext().state} />;
}
