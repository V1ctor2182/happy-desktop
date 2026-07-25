import { createFileRoute } from "@tanstack/react-router";

/** One channel conversation; rendered by the workspace shell from this match. */
export const Route = createFileRoute("/_workspace/channels/$chatId")({});
