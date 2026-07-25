import { createFileRoute } from "@tanstack/react-router";

/** One opened document; rendered by the Documents layout from this match. */
export const Route = createFileRoute("/_workspace/documents/$documentId")({});
