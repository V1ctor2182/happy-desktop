import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings opens on the profile section by default. */
export const Route = createFileRoute("/settings/")({
    beforeLoad: () => {
        throw redirect({ params: { section: "profile" }, replace: true, to: "/settings/$section" });
    },
});
