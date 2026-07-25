import { createFileRoute, redirect } from "@tanstack/react-router";
import { adminSectionsProject } from "../navigation/adminSectionsProject";

/**
 * Entering administration without naming a section lands on the first section the
 * session may actually open, so the URL is usable without knowing the section
 * names and never resolves to a screen the roles forbid.
 */
export const Route = createFileRoute("/_workspace/admin/")({
    beforeLoad: ({ context }) => {
        const sections = adminSectionsProject(context.permissions);
        throw redirect({
            params: { section: sections[0] ?? "users" },
            replace: true,
            to: "/admin/$section",
        });
    },
});
