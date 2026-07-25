import { createFileRoute } from "@tanstack/react-router";
import { HomeView } from "../views/HomeView";

/** The home screen, rendered in the workspace area beside the conversation list. */
export const Route = createFileRoute("/_workspace/home")({
    component: HomeScreen,
    staticData: { workspaceScreen: true },
});

function HomeScreen() {
    return <HomeView state={Route.useRouteContext().state} />;
}
