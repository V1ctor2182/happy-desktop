import { createHistory, type HistoryLocation, type RouterHistory } from "@tanstack/react-router";
import {
    rigRouteInGroup,
    rigRouteParse,
    rigRoutePath,
    rigRoutePathParse,
    rigRouteSame,
    RIG_ROUTE_HOME,
    type RigRoute,
} from "./rigRoute";

/** How many places a window remembers, oldest dropped first. */
const ENTRY_LIMIT = 100;

type LocationState = HistoryLocation["state"];

/**
 * One window's stack as it is written down: places it has been, oldest first,
 * and which it was showing. Entries are places, not paths.
 */
export interface RigHistoryDocument {
    readonly entries: readonly RigRoute[];
    readonly index: number;
}

/** Where a window's navigation stack is kept between runs. */
export interface RigHistoryPersistence {
    read(): unknown;
    write(document: RigHistoryDocument): void;
}

/**
 * A window's navigation stack, owned here rather than by the browser.
 *
 * The browser's stack can only be pushed onto and walked — an entry naming
 * something that stopped existing cannot be taken out of it, or even read. These
 * entries are an array, so such an entry is removed outright.
 */
export interface RigRouterHistory extends RouterHistory {
    /**
     * Removes every remembered place inside one group, showing the nearest
     * survivor if the window stood on one. Answers whether the stack changed,
     * which is not the same as the window having moved: places behind the reader
     * can go without disturbing where they stand.
     */
    groupForget(rigId: string, groupId: string): boolean;
}

function locationOf(route: RigRoute, state: LocationState): HistoryLocation {
    const path = rigRoutePath(route);
    return { hash: "", href: path, pathname: path, search: "", state };
}

function stateOf(): LocationState {
    const key = Math.random().toString(36).slice(2, 10);
    return { __TSR_index: 0, __TSR_key: key, key };
}

/**
 * The place the router just asked for. A path that does not parse means the
 * route tree grew a place `RigRoute` was never told about — a defect in this
 * module. Nothing at the type level ties the two together, so the drift is only
 * found by walking into it: worth stopping on in development, worth a console
 * line and the one always-addressable place in a reader's hands.
 */
function routeOf(path: string): RigRoute {
    const route = rigRoutePathParse(path);
    if (route !== undefined) return route;
    const complaint = `[rigHistory] no place matches ${path}; add it to RigRoute`;
    if (import.meta.env.DEV) throw new Error(complaint);
    console.error(complaint);
    return RIG_ROUTE_HOME;
}

/**
 * Reads a stored stack, keeping the places it can still read. An older build's
 * record can name a place this one lacks: that is one entry lost, not a reason
 * to forget the session.
 */
function documentParse(value: unknown): RigHistoryDocument | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as { entries?: unknown; index?: unknown };
    if (!Array.isArray(record.entries)) return undefined;
    const stored = record.index;
    const at = typeof stored === "number" && Number.isInteger(stored) ? stored : 0;
    const entries: RigRoute[] = [];
    // Where the reader was, after the unreadable entries around it are gone.
    let index = 0;
    for (let position = 0; position < record.entries.length; position++) {
        const route = rigRouteParse(record.entries[position]);
        if (route === undefined) continue;
        entries.push(route);
        if (position <= at) index = entries.length - 1;
    }
    return entries.length === 0 ? undefined : { entries, index };
}

/**
 * The place the document was opened at, when somebody asked for one. A bare
 * document addresses nothing and is left to what the window remembers. An
 * address is a request — except when it is this window's own reflection, since
 * the URL is kept in step and a reload finds the record's current place sitting
 * in it; restoring that one entry would throw the rest of the stack away.
 */
function documentRoute(restored: RigHistoryDocument | undefined): RigRoute | undefined {
    if (typeof window === "undefined") return undefined;
    const route = rigRoutePathParse(window.location.hash.slice(1));
    if (route === undefined || route.kind === "home") return undefined;
    const standing = restored?.entries[restored.index];
    return standing !== undefined && rigRouteSame(standing, route) ? undefined : route;
}

/**
 * Mirrors the place into the document's URL, always in place. This window's
 * stack is the only one there is: growing a second one in the document would be
 * a stack we do not walk, cannot remove entries from, and would have to keep in
 * step with the one we own.
 */
function urlSync(path: string): void {
    if (typeof window === "undefined") return;
    try {
        window.history.replaceState(null, "", `#${path}`);
    } catch {
        // A document refusing a URL rewrite still navigates; only the address
        // shown in developer tools goes stale.
    }
}

/**
 * Creates the navigation stack for one window. Given somewhere to keep it, the
 * window reopens where it was left. The stored stack is parsed rather than
 * trusted, so a damaged record costs the reader their position and nothing else.
 */
export function rigHistoryCreate(
    options: {
        readonly persistence?: RigHistoryPersistence;
        readonly initialEntries?: readonly RigRoute[];
    } = {},
): RigRouterHistory {
    const persistence = options.persistence;
    const restored = persistence ? documentParse(persistence.read()) : undefined;
    const asked = options.initialEntries?.length
        ? { entries: [...options.initialEntries], index: options.initialEntries.length - 1 }
        : undefined;
    const opened = documentRoute(restored);
    const initial = asked ??
        (opened ? { entries: [opened], index: 0 } : undefined) ??
        restored ?? { entries: [RIG_ROUTE_HOME], index: 0 };

    let entries: RigRoute[] = [...initial.entries];
    let states: LocationState[] = entries.map(() => stateOf());
    let index = initial.index;

    const persist = (): void => {
        if (!persistence) return;
        // The window kept has to contain the cursor: trimming past it would
        // write a position that is not in the record.
        const from = Math.min(Math.max(0, entries.length - ENTRY_LIMIT), index);
        persistence.write({
            entries: entries.slice(from, from + ENTRY_LIMIT),
            index: index - from,
        });
    };

    const settle = (): void => {
        urlSync(rigRoutePath(entries[index]));
        persist();
    };

    let blockers: Parameters<NonNullable<Parameters<typeof createHistory>[0]["setBlockers"]>>[0] =
        [];

    const history = createHistory({
        back: () => {
            index = Math.max(index - 1, 0);
            settle();
        },
        createHref: (path) => `#${path}`,
        forward: () => {
            index = Math.min(index + 1, entries.length - 1);
            settle();
        },
        getBlockers: () => blockers,
        getLength: () => entries.length,
        getLocation: () =>
            locationOf(entries[index], {
                ...states[index],
                // `canGoBack` reads this, so it is answered from the array at
                // every read instead of stored and kept in step.
                __TSR_index: index,
            }),
        go: (step) => {
            index = Math.min(Math.max(index + step, 0), entries.length - 1);
            settle();
        },
        pushState: (path, state) => {
            // Somewhere new from part-way back abandons what was ahead.
            if (index < entries.length - 1) {
                entries.splice(index + 1);
                states.splice(index + 1);
            }
            entries.push(routeOf(path));
            states.push(state as LocationState);
            index = entries.length - 1;
            settle();
        },
        replaceState: (path, state) => {
            entries[index] = routeOf(path);
            states[index] = state as LocationState;
            settle();
        },
        setBlockers: (next) => {
            blockers = next;
        },
    });

    // An address arriving in the URL after startup is the same request as one
    // sitting there at startup. Only an address from outside reaches here, since
    // `replaceState` raises no such event, so it is honoured rather than
    // mirrored back — otherwise the URL is writable and inert.
    if (typeof window !== "undefined") {
        window.addEventListener("hashchange", () => {
            const route = rigRoutePathParse(window.location.hash.slice(1));
            // A hash naming no place, and the reflection of a step already
            // taken, are both nothing to act on.
            if (route === undefined || rigRouteSame(entries[index], route)) return;
            history.push(rigRoutePath(route));
        });
    }

    return Object.assign(history, {
        groupForget: (rigId: string, groupId: string): boolean => {
            const keptEntries: RigRoute[] = [];
            const keptStates: LocationState[] = [];
            let keptIndex = -1;
            for (let at = 0; at < entries.length; at++) {
                const route = entries[at];
                if (rigRouteInGroup(route, rigId, groupId)) continue;
                // Removing what sat between two visits to one place would leave
                // it twice in a row, and a Back that appears to do nothing.
                const previous = keptEntries[keptEntries.length - 1];
                if (previous === undefined || !rigRouteSame(previous, route)) {
                    keptEntries.push(route);
                    keptStates.push(states[at]);
                }
                if (at <= index) keptIndex = keptEntries.length - 1;
            }
            if (keptEntries.length === entries.length) return false;
            if (keptEntries.length === 0) {
                entries = [RIG_ROUTE_HOME];
                states = [stateOf()];
                index = 0;
            } else {
                entries = keptEntries;
                states = keptStates;
                index = keptIndex === -1 ? 0 : keptIndex;
            }
            settle();
            // Told whether or not the place changed: what it can go back to has.
            history.notify({ type: "REPLACE" });
            return true;
        },
    });
}
