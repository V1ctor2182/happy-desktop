import {
    createFileRoute,
    Outlet,
    useChildMatches,
    useNavigate,
    useParams,
} from "@tanstack/react-router";
import type { AdminPageSection } from "happy2-ui";
import { WorkspaceShell, type WorkspaceSidebarSelection } from "../components/WorkspaceShell";

/**
 * The workspace layout: one persistent shell holding the conversation sidebar and
 * the workspace area. It is pathless so that moving between Home, Files, Apps,
 * Administration, and a conversation reuses the same shell instance instead of
 * tearing down the sidebar and every retained conversation lease on each
 * navigation.
 *
 * A child route that renders a screen in place of the conversation marks itself
 * with `staticData.workspaceScreen`; this layout then routes its `Outlet` into the
 * workspace slot. A conversation route leaves the slot empty so the shell renders
 * the conversation addressed by the URL.
 */
export const Route = createFileRoute("/_workspace")({
    component: WorkspaceLayout,
});

function WorkspaceLayout() {
    const context = Route.useRouteContext();
    const navigate = useNavigate();
    // `strict: false` because only the conversation children carry `chatId`; every
    // other workspace screen reads it as absent.
    const params = useParams({ strict: false });
    const children = useChildMatches();
    const workspaceScreen = children.some((match) => match.staticData.workspaceScreen === true);
    const routeId = children.at(-1)?.routeId ?? "";
    const channel = routeId.startsWith("/_workspace/channels");
    const sidebar: WorkspaceSidebarSelection = routeId.startsWith("/_workspace/admin")
        ? { kind: "admin", section: params.section as AdminPageSection }
        : routeId.startsWith("/_workspace/apps")
          ? { kind: "apps", appId: params.appId }
          : { kind: "chats" };
    return (
        <WorkspaceShell
            chatId={params.chatId}
            context={context}
            conversationKind={channel ? "channel" : "chat"}
            navActiveId={navActiveId(routeId)}
            sidebar={sidebar}
            onChatSelect={(chatId, kind, replace) =>
                void navigate(
                    chatId
                        ? {
                              params: { chatId },
                              replace,
                              to: kind === "channel" ? "/channels/$chatId" : "/chats/$chatId",
                          }
                        : { replace, to: kind === "channel" ? "/channels" : "/chats" },
                )
            }
            workspaceScreen={workspaceScreen ? <Outlet /> : undefined}
        />
    );
}

/**
 * The workspace navigation row to highlight. Conversations highlight the chat row;
 * Apps and Documents highlight their own; the remaining screens are reached from
 * elsewhere and highlight nothing.
 */
function navActiveId(routeId: string): string {
    if (routeId.startsWith("/_workspace/apps")) return "apps";
    if (routeId.startsWith("/_workspace/documents")) return "documents";
    if (routeId.startsWith("/_workspace/chats") || routeId.startsWith("/_workspace/channels"))
        return "chat";
    return "";
}
