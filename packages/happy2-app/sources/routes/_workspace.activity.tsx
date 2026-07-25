import { createFileRoute } from "@tanstack/react-router";
import { InboxView } from "../views/InboxView";

/** The activity inbox. */
export const Route = createFileRoute("/_workspace/activity")({
    component: ActivityScreen,
    staticData: { workspaceScreen: true },
});

function ActivityScreen() {
    return <InboxView state={Route.useRouteContext().state} />;
}
