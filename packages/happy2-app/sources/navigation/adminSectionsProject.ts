import { permissionAllowed, type PermissionsSnapshot } from "happy2-state";
import type { AdminPageSection } from "happy2-ui";

/**
 * The administration sections one session may actually reach, in menu order.
 *
 * This is the single authority for administration visibility: the workspace
 * sidebar shows the drill-down only when the list is non-empty, entering
 * `/admin` without a section lands on the first entry, and the section route
 * refuses a section that is absent here. Deriving it in one place keeps a
 * reachable menu row from pointing at a screen the session cannot open.
 */
export function adminSectionsProject(snapshot: PermissionsSnapshot): readonly AdminPageSection[] {
    const owner = snapshot.permissions.type === "ready" && snapshot.permissions.value.owner;
    const allowed = (permission: Parameters<typeof permissionAllowed>[1]) =>
        permissionAllowed(snapshot, permission);
    const sections: AdminPageSection[] = [];
    if (allowed("viewAllMembers")) sections.push("users");
    if (owner) sections.push("reports", "automations", "integrations");
    if (allowed("manageImages") || allowed("assignImagesToChats")) sections.push("images");
    if (allowed("manageSecrets") || allowed("assignSecrets")) sections.push("secrets");
    if (allowed("managePlugins")) sections.push("plugins");
    if (allowed("manageAdminRoles")) sections.push("roles");
    return sections;
}
