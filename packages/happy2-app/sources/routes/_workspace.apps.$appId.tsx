import { createFileRoute } from "@tanstack/react-router";

/** One durable plugin app page; rendered by the Apps layout from this match. */
export const Route = createFileRoute("/_workspace/apps/$appId")({});
