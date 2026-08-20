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

/**
 * How many places a window remembers. Long enough to hold a working session's
 * worth of steps, short enough that the record stays small and cheap to write.
 */
const ENTRY_LIMIT = 100;

type LocationState = HistoryLocation["state"];

/**
 * One window's navigation stack as it is written down: the places it has been,
 * oldest first, and which of them it was showing. The entries are places, not
 * paths — a path is only how a place is handed to the router.
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
 * A window's navigation stack, owned by this application rather than by the
 * browser it runs in.
 *
 * The browser's own stack can only be pushed onto, replaced at the cursor, and
 * walked; an entry naming something that no longer exists cannot be taken out of
 * it, or even read. Here the entries are an array of places, so one that stops
 * existing is removed and is simply not there any more — no entry to step over,
 * and nothing to find by going forward.
 */
export interface RigRouterHistory extends RouterHistory {
    /**
     * Removes every remembered place inside this machine's group, and shows the
     * nearest survivor if the window was standing on one of them. Answers
     * whether the stack changed at all, which is not the same as the window
     * having moved: places behind the reader can go without disturbing where
     * they are standing.
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
 * The place the router just asked for. Every route this window has is a member
 * of the union, so a path that does not parse means the route tree grew a place
 * the union was never told about — a defect in this module, reported here rather
 * than stored as text nobody can reason about later.
 */
function routeOf(path: string): RigRoute {
    const route = rigRoutePathParse(path);
    if (route !== undefined) return route;
    const complaint = `[rigHistory] no place matches ${path}; add it to RigRoute`;
    // Nothing at the type level ties the route tree to the union, so the drift is
    // only ever found by walking into it. In development that is a defect worth
    // stopping on; in a reader's hands it is worth a line in the console and the
    // one place that is always addressable.
    if (import.meta.env.DEV) throw new Error(complaint);
    console.error(complaint);
    return RIG_ROUTE_HOME;
}

/**
 * Reads a stored stack, keeping the places it can still read. A record written
 * by an older build can name a place this one no longer has; that is one entry
 * this window cannot go to, not a reason to forget the rest of the session.
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
 * The place the document was opened at, when it names one somebody asked for.
 *
 * A window opened on a bare document is not addressing anything and is left to
 * whatever it remembers. An address in the URL is a request for that exact
 * place — except when it is this window's own reflection: the URL is kept in
 * step with where the reader is, so a reload finds the record's own current
 * place sitting in it, and restoring a single entry from that would throw the
 * rest of the stack away.
 */
function documentRoute(restored: RigHistoryDocument | undefined): RigRoute | undefined {
    if (typeof window === "undefined") return undefined;
    const route = rigRoutePathParse(window.location.hash.slice(1));
    if (route === undefined || route.kind === "home") return undefined;
    const standing = restored?.entries[restored.index];
    return standing !== undefined && rigRouteSame(standing, route) ? undefined : route;
}

/**
 * Mirrors the place into the document's own URL.
 *
 * A window running in a real browser tab keeps one browser entry per step it
 * takes, so that browser's own Back and Forward buttons — and the trackpad
 * gesture the browser drives from them — have something to move between; each
 * entry is stamped with its depth, which is how a `popstate` says which way it
 * went. A window in the desktop shell gets its Back and Forward from the shell
 * instead, so it never grows a second stack it would then have to keep in step
 * with the one it owns.
 */
function urlSync(path: string, step: "push" | "replace", ticket: number): void {
    if (typeof window === "undefined") return;
    try {
        const url = `#${path}`;
        if (step === "push") window.history.pushState({ happyTicket: ticket }, "", url);
        else window.history.replaceState({ happyTicket: ticket }, "", url);
    } catch {
        // A document that refuses a URL rewrite still navigates; only the
        // address shown in developer tools goes stale.
    }
}

/**
 * Creates the navigation stack for one window.
 *
 * Given somewhere to keep it, the window reopens where it was left, which is
 * what makes a reload during development land back on the same conversation.
 * The stored stack is parsed rather than trusted, so a damaged record costs the
 * reader their position and nothing else.
 */
export function rigHistoryCreate(
    options: {
        readonly persistence?: RigHistoryPersistence;
        readonly initialEntries?: readonly RigRoute[];
        /**
         * Whether to keep one of the browser's own history entries per step, so
         * that a real browser tab's Back and Forward buttons work. The desktop
         * shell supplies those inputs itself and leaves this off.
         */
        readonly nativeEntries?: boolean;
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
        // Only the newest places are worth keeping, and the window kept has to
        // contain the cursor: trimming past it would write a position that is
        // not in the record, which is no longer a stack anybody can be restored
        // to.
        const from = Math.min(Math.max(0, entries.length - ENTRY_LIMIT), index);
        persistence.write({
            entries: entries.slice(from, from + ENTRY_LIMIT),
            index: index - from,
        });
    };

    // The browser's own stack is grown only where the browser's own buttons are
    // the ones a reader presses. In the desktop shell those inputs are delivered
    // as a direction instead, and this window's array is the only stack there is.
    const nativeEntries = options.nativeEntries ?? false;
    const settle = (step: "push" | "replace" = "replace"): void => {
        urlSync(rigRoutePath(entries[index]), nativeEntries ? step : "replace", index);
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
                // Where the entry sits now. `canGoBack` reads this rather than
                // counting the array, so it is answered from the array at every
                // read instead of being stored and kept in step.
                __TSR_index: index,
            }),
        go: (step) => {
            index = Math.min(Math.max(index + step, 0), entries.length - 1);
            settle();
        },
        pushState: (path, state) => {
            // Going somewhere new from part-way back abandons what was ahead,
            // exactly as a browser does.
            if (index < entries.length - 1) {
                entries.splice(index + 1);
                states.splice(index + 1);
            }
            entries.push(routeOf(path));
            states.push(state as LocationState);
            index = entries.length - 1;
            settle("push");
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

    // A real browser tab has its own Back and Forward buttons, and they move
    // through the native entries `settle` stamped. Each stamp is the position it
    // was made at, so the entry the browser landed on says where to stand — which
    // is also what makes the browser's long-press menu, jumping several entries
    // at once, land in the right place. The stamp is clamped because the stack it
    // indexes can have shrunk since, when a group was forgotten out from under it.
    if (nativeEntries && typeof window !== "undefined") {
        window.addEventListener("popstate", () => {
            const state = window.history.state as { happyTicket?: unknown } | null;
            if (typeof state?.happyTicket !== "number") return;
            const moved = Math.min(Math.max(state.happyTicket, 0), entries.length - 1);
            if (moved === index) return;
            index = moved;
            // The URL is already where the browser put it, so only the record
            // needs catching up.
            persist();
            history.notify({ type: "REPLACE" });
        });
    }

    // An address that appears in the document's URL after startup is the same
    // request as one that was sitting there at startup: somewhere to go. Only an
    // address from outside this window reaches here — the window's own steps are
    // mirrored out with `pushState`/`replaceState`, and neither raises this
    // event — so it is honoured rather than mirrored back. Without this the URL
    // would be writable and inert, showing one place while the window stood on
    // another.
    if (typeof window !== "undefined") {
        window.addEventListener("hashchange", () => {
            const route = rigRoutePathParse(window.location.hash.slice(1));
            // A hash naming no place, and the reflection of a step this window
            // has already taken, are both nothing to act on. The second is what
            // a browser's own Back raises alongside the `popstate` that has
            // already been answered above.
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
                // Removing what sat between two visits to the same place would
                // otherwise leave it twice in a row, and a Back that appears to
                // do nothing.
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
            // Told once, whether or not the place itself changed: the window may
            // now be standing somewhere else, and what it can go back to has
            // changed either way.
            history.notify({ type: "REPLACE" });
            return true;
        },
    });
}
