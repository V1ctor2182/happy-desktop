/**
 * Every place this window can be, as a value.
 *
 * The router addresses places with paths, and storage holds them between runs,
 * but neither is where a place is *defined*. This union is. A path is what a
 * `RigRoute` looks like once it is rendered for the router, and a stored record
 * is what one looks like written down; both are rendered from, and parsed back
 * into, the value below.
 *
 * That is what lets a place be reasoned about instead of pattern-matched. Asking
 * whether an address is inside some group is a comparison of two fields, not a
 * path re-run through the router's matcher and hoped to decode the same way.
 *
 * A place is its identifiers and nothing else: no query and no fragment. A route
 * that needs to carry something further becomes a field here, so that it is kept
 * between runs and can be reasoned about like the rest.
 */
export type RigRoute =
    | { readonly kind: "blueprint" }
    | {
          readonly kind: "chat";
          readonly rigId: string;
          readonly groupId: string;
          readonly chatId: string;
      }
    | { readonly kind: "chats" }
    | { readonly kind: "group"; readonly rigId: string; readonly groupId: string }
    | { readonly kind: "home" }
    | { readonly kind: "inbox"; readonly rigId: string }
    | { readonly kind: "rig"; readonly rigId: string }
    | { readonly kind: "settings" }
    | { readonly kind: "settingsSection"; readonly section: string };

/** The place a window opens on before it has been anywhere. */
export const RIG_ROUTE_HOME: RigRoute = { kind: "home" };

/**
 * The path the router addresses this place by. Identifiers are encoded because
 * they are values, not path syntax: one containing a slash names one thing, and
 * must not read as two segments.
 */
export function rigRoutePath(route: RigRoute): string {
    const part = encodeURIComponent;
    switch (route.kind) {
        case "blueprint":
            return "/blueprint";
        case "chat":
            return `/chats/${part(route.rigId)}/${part(route.groupId)}/${part(route.chatId)}`;
        case "chats":
            return "/chats";
        case "group":
            return `/chats/${part(route.rigId)}/${part(route.groupId)}`;
        case "home":
            return "/";
        case "inbox":
            return `/inbox/${part(route.rigId)}`;
        case "rig":
            return `/chats/${part(route.rigId)}`;
        case "settings":
            return "/settings";
        case "settingsSection":
            return `/settings/${part(route.section)}`;
    }
}

/** The segments of a path, decoded, with any query or fragment dropped. */
function segmentsOf(pathname: string): string[] | undefined {
    const cut = pathname.search(/[?#]/);
    const path = cut === -1 ? pathname : pathname.slice(0, cut);
    if (!path.startsWith("/")) return undefined;
    const parts = path.slice(1).split("/").filter(Boolean);
    try {
        return parts.map(decodeURIComponent);
    } catch {
        // A path holding a broken escape names nothing this router can address.
        return undefined;
    }
}

/**
 * The place a path addresses, or nothing when it addresses none.
 *
 * The router hands locations over as paths, so this is the boundary where an
 * address stops being text and becomes one of the places above. A path that
 * matches no route is not a place, and is refused here rather than carried
 * around as a string that might be one.
 */
export function rigRoutePathParse(pathname: string): RigRoute | undefined {
    const segments = segmentsOf(pathname);
    if (segments === undefined) return undefined;
    const [head, first, second, third] = segments;
    if (head === undefined) return RIG_ROUTE_HOME;
    switch (head) {
        case "blueprint":
            return segments.length === 1 ? { kind: "blueprint" } : undefined;
        case "chats":
            if (first === undefined) return { kind: "chats" };
            if (second === undefined) return { kind: "rig", rigId: first };
            if (third === undefined) return { kind: "group", groupId: second, rigId: first };
            return segments.length === 4
                ? { chatId: third, groupId: second, kind: "chat", rigId: first }
                : undefined;
        case "inbox":
            return first !== undefined && segments.length === 2
                ? { kind: "inbox", rigId: first }
                : undefined;
        case "settings":
            if (first === undefined) return { kind: "settings" };
            return segments.length === 2 ? { kind: "settingsSection", section: first } : undefined;
        default:
            return undefined;
    }
}

/** A required string field of a stored record, absent when it is not one. */
function fieldOf(record: Record<string, unknown>, name: string): string | undefined {
    const value = record[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The place a stored record describes, or nothing when it describes none.
 *
 * What comes back from storage was written by an older build of this app, or
 * edited by hand, so it is parsed into the union rather than asserted to be one
 * of its members. A record naming a place this build no longer has, or missing
 * what that place needs to be addressed, is not a place here any more.
 */
export function rigRouteParse(value: unknown): RigRoute | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    switch (record["kind"]) {
        case "blueprint":
            return { kind: "blueprint" };
        case "chat": {
            const rigId = fieldOf(record, "rigId");
            const groupId = fieldOf(record, "groupId");
            const chatId = fieldOf(record, "chatId");
            return rigId && groupId && chatId
                ? { chatId, groupId, kind: "chat", rigId }
                : undefined;
        }
        case "chats":
            return { kind: "chats" };
        case "group": {
            const rigId = fieldOf(record, "rigId");
            const groupId = fieldOf(record, "groupId");
            return rigId && groupId ? { groupId, kind: "group", rigId } : undefined;
        }
        case "home":
            return RIG_ROUTE_HOME;
        case "inbox": {
            const rigId = fieldOf(record, "rigId");
            return rigId ? { kind: "inbox", rigId } : undefined;
        }
        case "rig": {
            const rigId = fieldOf(record, "rigId");
            return rigId ? { kind: "rig", rigId } : undefined;
        }
        case "settings":
            return { kind: "settings" };
        case "settingsSection": {
            const section = fieldOf(record, "section");
            return section ? { kind: "settingsSection", section } : undefined;
        }
        default:
            return undefined;
    }
}

/** Whether two places are the same place. */
export function rigRouteSame(one: RigRoute, other: RigRoute): boolean {
    return rigRoutePath(one) === rigRoutePath(other);
}

/**
 * Whether a place sits inside one machine's group — the group itself, or a
 * conversation in it. Everything else exists in its own right and outlives the
 * group going away.
 */
export function rigRouteInGroup(route: RigRoute, rigId: string, groupId: string): boolean {
    return (
        (route.kind === "group" || route.kind === "chat") &&
        route.rigId === rigId &&
        route.groupId === groupId
    );
}
