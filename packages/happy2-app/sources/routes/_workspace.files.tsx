import { createFileRoute } from "@tanstack/react-router";
import type { FilesPageFilter } from "happy2-ui";
import { FilesView } from "../views/FilesView";

const filters: readonly FilesPageFilter[] = ["all", "photo", "video", "gif", "file"];

export interface FilesSearch {
    readonly filter: FilesPageFilter;
    readonly query: string;
}

/**
 * The files browser. Its type filter and text query stay in the URL because they
 * describe what the screen is showing and are worth reloading and sharing, unlike
 * the file preview itself, which is a transient overlay.
 *
 * `validateSearch` is the only place these are interpreted: an unknown filter falls
 * back to `all` rather than rendering an empty grid for a value nothing produces.
 */
export const Route = createFileRoute("/_workspace/files")({
    component: FilesScreen,
    staticData: { workspaceScreen: true },
    validateSearch: (search: Record<string, unknown>): FilesSearch => ({
        filter: filters.includes(search.filter as FilesPageFilter)
            ? (search.filter as FilesPageFilter)
            : "all",
        query: typeof search.query === "string" ? search.query : "",
    }),
});

function FilesScreen() {
    const state = Route.useRouteContext().state;
    const { filter, query } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
        <FilesView
            filter={filter}
            onFilterChange={(next) =>
                void navigate({
                    replace: true,
                    search: (current) => ({ ...current, filter: next }),
                })
            }
            onOpen={(fileId) => state.overlays().getState().overlayFileOpen(fileId)}
            onQueryChange={(next) =>
                void navigate({ replace: true, search: (current) => ({ ...current, query: next }) })
            }
            query={query}
            state={state}
        />
    );
}
