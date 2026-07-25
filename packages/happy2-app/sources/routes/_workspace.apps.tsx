import { createFileRoute, useParams } from "@tanstack/react-router";
import { AppsView } from "../views/AppsView";

/**
 * The Apps area: a durable plugin app page when one is addressed, otherwise the
 * apps and plugin management panel. A layout route keeps one `AppsView` mounted so
 * moving between apps reuses its retained instance handles.
 */
export const Route = createFileRoute("/_workspace/apps")({
    component: AppsScreen,
    staticData: { workspaceScreen: true },
});

function AppsScreen() {
    const params = useParams({ strict: false });
    return <AppsView appId={params.appId} state={Route.useRouteContext().state} />;
}
