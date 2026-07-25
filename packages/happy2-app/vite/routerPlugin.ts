import { resolve } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const packageRoot = resolve(import.meta.dirname, "..");

/**
 * The TanStack Router plugin bound to this package's routes, shared by every
 * Vite config that serves or builds the app.
 *
 * Consumers need it for Fast Refresh, not only for route-tree generation. A
 * route module exports `Route`, which is not a component, so React Refresh
 * cannot use it as a boundary on its own: editing any component reachable from
 * a route invalidates upward through the generated route tree to the renderer
 * entry, and the entry has no exports at all, so Vite gives up and reloads the
 * page. This plugin's dev half rewrites route modules to accept their own
 * updates, which stops that propagation at the route.
 *
 * Route-tree generation is deliberately left enabled: the plugin only populates
 * the route map that its HMR half needs while it is generating, and the emitted
 * tree is deterministic, so regenerating it from a consumer's dev server is a
 * no-op whenever the routes have not changed.
 */
export function appRouterPlugin() {
    return tanstackRouter({
        generatedRouteTree: resolve(packageRoot, "sources/routeTree.gen.ts"),
        routesDirectory: resolve(packageRoot, "sources/routes"),
        quoteStyle: "double",
        semicolons: true,
        target: "react",
    });
}
