import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "happy2-ui";
import { SettingsView } from "../views/SettingsView";

/**
 * Settings is a focused account surface rather than a workspace screen, so it sits
 * outside the workspace layout and renders without the conversation sidebar.
 */
export const Route = createFileRoute("/settings/$section")({
    component: SettingsScreen,
});

function SettingsScreen() {
    const context = Route.useRouteContext();
    return (
        <AppShell windowControls={context.platform === "desktop"}>
            <SettingsView session={context.session} state={context.state} />
        </AppShell>
    );
}
