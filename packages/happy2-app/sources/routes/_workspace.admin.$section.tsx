import { createFileRoute } from "@tanstack/react-router";
import { permissionAllowed, type PermissionsSnapshot } from "happy2-state";
import { EmptyState, type AdminPageSection } from "happy2-ui";
import { adminSectionsProject } from "../navigation/adminSectionsProject";
import { AdminView } from "../views/AdminView";

/**
 * One administration section. The section is a path parameter so an administrator
 * can link a colleague straight to it, and the permitted set is re-derived here on
 * every render: a role change that removes access replaces the screen with an
 * explanation rather than leaving a privileged surface addressable by its URL.
 */
export const Route = createFileRoute("/_workspace/admin/$section")({
    component: AdminScreen,
    staticData: { workspaceScreen: true },
});

function AdminScreen() {
    const context = Route.useRouteContext();
    const navigate = Route.useNavigate();
    const { section } = Route.useParams();
    const sections = adminSectionsProject(context.permissions);
    if (!sections.includes(section as AdminPageSection))
        return (
            <EmptyState
                description="Your current roles do not grant access to this administration section."
                icon="shield"
                title="Administration unavailable"
            />
        );
    const allowed = (permission: Parameters<typeof permissionAllowed>[1]) =>
        permissionAllowed(context.permissions as PermissionsSnapshot, permission);
    return (
        <AdminView
            canAssignSecrets={allowed("assignSecrets")}
            canManageImages={allowed("manageImages")}
            canManageSecrets={allowed("manageSecrets")}
            canResetPasswords={allowed("resetPasswords")}
            canViewRoleMembers={allowed("manageAdminRoles")}
            onSectionChange={(next) =>
                void navigate({ params: { section: next }, to: "/admin/$section" })
            }
            section={section as AdminPageSection}
            sections={sections}
            state={context.state}
        />
    );
}
