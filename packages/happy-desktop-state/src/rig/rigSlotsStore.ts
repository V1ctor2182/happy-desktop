import type { UserError } from "../types.js";
import type { RigGlobalEvent, RigTransport } from "./rigTransport.js";
import { rigUserError } from "./rigSupport.js";
import type { RigProjectId, RigSessionId, RigThinkingLevel, RigWorktreeId } from "./rigTypes.js";

export type RigSlotName = "status-line" | "above-composer" | "title" | "sidebar";

export type RigSlotScope = "everywhere" | "project" | "workspace" | "session";

export type RigSlotAction =
    | { readonly type: "send-current-chat"; readonly message: string }
    | { readonly type: "open-applet"; readonly applet: string }
    | { readonly type: "send-chat"; readonly sessionId: RigSessionId; readonly message: string }
    | { readonly type: "draft-chat"; readonly sessionId: RigSessionId; readonly message: string }
    | {
          readonly type: "new-chat";
          readonly projectId?: RigProjectId;
          readonly workspaceId?: RigWorktreeId;
          readonly model?: string;
          readonly effort?: RigThinkingLevel;
          readonly prompt?: string;
      };

export type RigSlotContent =
    | { readonly type: "text"; readonly markdown: string }
    | { readonly type: "button"; readonly label: string; readonly action: RigSlotAction };

/** Who contributed a slot entry: an agent conversation or an installed plugin. */
export type RigSlotEntryAuthor =
    | { readonly type: "agent"; readonly sessionId: RigSessionId }
    | { readonly type: "plugin"; readonly folder: string; readonly name: string };

/** One contribution projected from Rig's durable slot catalog. */
export interface RigSlotEntry {
    readonly id: string;
    readonly slot: RigSlotName;
    readonly scope: RigSlotScope;
    readonly projectId?: RigProjectId;
    readonly workspaceId?: RigWorktreeId;
    readonly sessionId?: RigSessionId;
    readonly content: RigSlotContent;
    readonly author: RigSlotEntryAuthor;
    readonly description: string;
    readonly purpose: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RigAppletVersion {
    readonly version: number;
    readonly changeDescription: string;
    readonly createdAt: number;
}

/** One imported, versioned applet whose current static files Rig serves. */
export interface RigApplet {
    readonly name: string;
    readonly description: string;
    readonly purpose: string;
    readonly authorSessionId: string;
    readonly sourceDescription?: string;
    readonly currentVersion: number;
    readonly versions: readonly RigAppletVersion[];
    readonly createdAt: number;
    readonly updatedAt: number;
}

/**
 * What the window is currently addressing, against which a scoped entry is
 * resolved. It is a property of the route, not of this surface: the catalog
 * below is the same catalog whatever is open, so moving between chats resolves
 * the entries already held instead of asking for another set.
 */
export interface RigSlotsContext {
    readonly projectId?: RigProjectId;
    readonly workspaceId?: RigWorktreeId;
    readonly sessionId?: RigSessionId;
}

/**
 * Rig's whole durable slot catalog and its applet catalog. Both are Rig-global,
 * so this surface has one lifetime per connection: which entries a placement
 * shows is decided by `rigSlotEntriesInScope` at render time, and never by
 * replacing this store when the reader opens something else.
 */
export interface RigSlotsSnapshot {
    readonly entries: readonly RigSlotEntry[];
    readonly applets: readonly RigApplet[];
    readonly loading: boolean;
    readonly error?: UserError;
}

export interface RigSlotsStore {
    get(): RigSlotsSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigSlotsStoreOptions {
    readonly transport: RigTransport;
}

const NO_ENTRIES: readonly RigSlotEntry[] = [];
const NO_APPLETS: readonly RigApplet[] = [];
const EMPTY_SNAPSHOT: RigSlotsSnapshot = {
    entries: NO_ENTRIES,
    applets: NO_APPLETS,
    loading: true,
};
const NOOP_SNAPSHOT: RigSlotsSnapshot = { ...EMPTY_SNAPSHOT, loading: false };

type SlotsInput =
    | { readonly type: "slotsLoaded"; readonly entries: readonly RigSlotEntry[] }
    | { readonly type: "slotsFailed"; readonly error: UserError }
    | { readonly type: "appletsLoaded"; readonly applets: readonly RigApplet[] }
    | { readonly type: "appletsFailed"; readonly error: UserError };

/**
 * Creates the slot surface for one Rig connection.
 *
 * Construction opens no transport. The first subscriber reads the whole slot
 * catalog and the applets together and opens one global-event subscription; the
 * last subscriber tears that stream down. Realtime events are hints only: each
 * matching event re-reads its durable endpoint instead of accepting the full
 * event payload as authority.
 *
 * The catalog is read whole rather than per addressed context, because what the
 * reader has open is not a fact about the catalog. Resolving a scope is a
 * projection of state already held, so an entry that stays in scope while the
 * reader moves between chats is the same object across that move — the surface
 * never empties, reloads, or hands the view a different entry for the same
 * contribution.
 */
export function rigSlotsStoreCreate(options: RigSlotsStoreOptions): RigSlotsStore {
    const listeners = new Set<() => void>();
    let snapshot = EMPTY_SNAPSHOT;
    let active = false;
    let disposed = false;
    let slotsSettled = false;
    let appletsSettled = false;
    let slotsError: UserError | undefined;
    let appletsError: UserError | undefined;
    let slotsGeneration = 0;
    let appletsGeneration = 0;
    let unsubscribeGlobal: (() => void) | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const publish = (next: RigSlotsSnapshot): void => {
        if (snapshot === next) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };

    /** Private authoritative writer: transport results never pass through public actions. */
    const slotsInput = (input: SlotsInput): void => {
        if (input.type === "slotsLoaded") {
            slotsSettled = true;
            slotsError = undefined;
            publish({
                ...snapshot,
                entries: entriesPreserve(snapshot.entries, input.entries),
                loading: !(slotsSettled && appletsSettled),
                error: appletsError,
            });
            return;
        }
        if (input.type === "appletsLoaded") {
            appletsSettled = true;
            appletsError = undefined;
            publish({
                ...snapshot,
                applets: appletsPreserve(snapshot.applets, input.applets),
                loading: !(slotsSettled && appletsSettled),
                error: slotsError,
            });
            return;
        }
        if (input.type === "slotsFailed") {
            slotsSettled = true;
            slotsError = input.error;
        } else {
            appletsSettled = true;
            appletsError = input.error;
        }
        publish({
            ...snapshot,
            loading: !(slotsSettled && appletsSettled),
            error: slotsError ?? appletsError,
        });
    };

    const slotsLoad = async (): Promise<void> => {
        const generation = ++slotsGeneration;
        try {
            const entries = await options.transport.slotsRead();
            if (!active || disposed || generation !== slotsGeneration) return;
            slotsInput({ type: "slotsLoaded", entries });
        } catch (error) {
            if (!active || disposed || generation !== slotsGeneration) return;
            slotsInput({ type: "slotsFailed", error: rigUserError(error) });
        }
    };

    const appletsLoad = async (): Promise<void> => {
        const generation = ++appletsGeneration;
        try {
            const applets = await options.transport.appletsRead();
            if (!active || disposed || generation !== appletsGeneration) return;
            slotsInput({ type: "appletsLoaded", applets });
        } catch (error) {
            if (!active || disposed || generation !== appletsGeneration) return;
            slotsInput({ type: "appletsFailed", error: rigUserError(error) });
        }
    };

    const reconnect = (): void => {
        if (!active || disposed || reconnectTimer) return;
        unsubscribeGlobal?.();
        unsubscribeGlobal = undefined;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            if (active && !disposed) subscribeGlobal();
        }, 1_000);
    };

    const observer = {
        event(event: RigGlobalEvent) {
            if (!active || disposed) return;
            if (event.type === "slots_changed") void slotsLoad();
            else if (event.type === "applets_changed") void appletsLoad();
        },
        error() {
            if (!active || disposed) return;
            void Promise.all([slotsLoad(), appletsLoad()]);
            reconnect();
        },
        end() {
            reconnect();
        },
    };

    function subscribeGlobal(): void {
        unsubscribeGlobal = options.transport.globalEventsSubscribe(observer);
    }

    const start = (): void => {
        active = true;
        subscribeGlobal();
        void Promise.all([slotsLoad(), appletsLoad()]);
    };

    const stop = (): void => {
        active = false;
        slotsGeneration += 1;
        appletsGeneration += 1;
        unsubscribeGlobal?.();
        unsubscribeGlobal = undefined;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1 && !disposed) start();
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

/** Stable absent surface used while no Rig connection owns the addressed context. */
export const rigSlotsStoreNoop: RigSlotsStore = {
    get: () => NOOP_SNAPSHOT,
    subscribe: () => () => undefined,
    [Symbol.dispose]: () => undefined,
};

/**
 * The entries of one slot that the addressed context still resolves, in the
 * catalog's own order.
 *
 * An everywhere entry resolves everywhere, by definition: nothing about what is
 * open can withdraw it, so moving between chats never takes one off screen. A
 * scoped entry resolves only against its own project, workspace, or session, so
 * an entry addressed at a chat leaves with that chat and never leaks into a
 * window that is addressing nothing.
 */
export function rigSlotEntriesInScope(
    entries: readonly RigSlotEntry[],
    slot: RigSlotName,
    context: RigSlotsContext,
): readonly RigSlotEntry[] {
    return entries.filter((entry) => entry.slot === slot && rigSlotEntryInScope(entry, context));
}

/**
 * Whether one entry's scope resolves against the addressed context.
 *
 * The same question the list above asks, asked about a single entry, because
 * rendering is not the only moment it has to be asked: a handler held from an
 * earlier render would otherwise act on a contribution the reader has since
 * navigated away from. Deciding scope in one place is what keeps what is shown
 * and what can be performed the same answer.
 */
export function rigSlotEntryInScope(entry: RigSlotEntry, context: RigSlotsContext): boolean {
    switch (entry.scope) {
        case "everywhere":
            return true;
        case "project":
            return entry.projectId !== undefined && entry.projectId === context.projectId;
        case "workspace":
            return entry.workspaceId !== undefined && entry.workspaceId === context.workspaceId;
        case "session":
            return entry.sessionId !== undefined && entry.sessionId === context.sessionId;
    }
}

/*
 * Why the reconciliation below compares whole values rather than a revision.
 *
 * Rig stamps `createdAt`/`updatedAt` with the wall clock, so two edits to the
 * same entry inside one millisecond carry the same `updatedAt`. A timestamp is
 * therefore metadata about when something was written, not a revision that
 * orders writes, and treating it as one would let the second edit be dropped
 * and the stale content held for as long as nothing else touched that entry.
 * Happy has to be correct without Rig supplying a revision, so an object is
 * only reused when its complete public value is unchanged.
 */

/**
 * Keeps the object an unchanged entry already had, so a re-read of the catalog
 * leaves everything it did not change alone: a view holding one contribution is
 * looking at the same object it was before an unrelated entry arrived. The
 * whole array keeps its identity only when the order and every element are
 * unchanged too.
 */
function entriesPreserve(
    previous: readonly RigSlotEntry[],
    incoming: readonly RigSlotEntry[],
): readonly RigSlotEntry[] {
    const before = new Map(previous.map((entry) => [entry.id, entry]));
    const next = incoming.map((entry) => {
        const candidate = before.get(entry.id);
        return candidate !== undefined && slotEntryEquals(candidate, entry) ? candidate : entry;
    });
    return arrayPreserve(previous, next);
}

function appletsPreserve(
    previous: readonly RigApplet[],
    incoming: readonly RigApplet[],
): readonly RigApplet[] {
    const before = new Map(previous.map((applet) => [applet.name, applet]));
    const next = incoming.map((applet) => {
        const candidate = before.get(applet.name);
        return candidate !== undefined && appletEquals(candidate, applet) ? candidate : applet;
    });
    return arrayPreserve(previous, next);
}

function arrayPreserve<T>(previous: readonly T[], next: readonly T[]): readonly T[] {
    return next.length === previous.length && next.every((item, index) => item === previous[index])
        ? previous
        : next;
}

/** Every field of one entry, so no change to a contribution can be missed. */
function slotEntryEquals(a: RigSlotEntry, b: RigSlotEntry): boolean {
    return (
        a.id === b.id &&
        a.slot === b.slot &&
        a.scope === b.scope &&
        a.projectId === b.projectId &&
        a.workspaceId === b.workspaceId &&
        a.sessionId === b.sessionId &&
        a.description === b.description &&
        a.purpose === b.purpose &&
        a.createdAt === b.createdAt &&
        a.updatedAt === b.updatedAt &&
        slotAuthorEquals(a.author, b.author) &&
        slotContentEquals(a.content, b.content)
    );
}

function slotAuthorEquals(a: RigSlotEntryAuthor, b: RigSlotEntryAuthor): boolean {
    switch (a.type) {
        case "agent":
            return b.type === "agent" && a.sessionId === b.sessionId;
        case "plugin":
            return b.type === "plugin" && a.folder === b.folder && a.name === b.name;
    }
}

function slotContentEquals(a: RigSlotContent, b: RigSlotContent): boolean {
    switch (a.type) {
        case "text":
            return b.type === "text" && a.markdown === b.markdown;
        case "button":
            return (
                b.type === "button" && a.label === b.label && slotActionEquals(a.action, b.action)
            );
    }
}

function slotActionEquals(a: RigSlotAction, b: RigSlotAction): boolean {
    switch (a.type) {
        case "send-current-chat":
            return b.type === "send-current-chat" && a.message === b.message;
        case "open-applet":
            return b.type === "open-applet" && a.applet === b.applet;
        case "send-chat":
            return b.type === "send-chat" && a.sessionId === b.sessionId && a.message === b.message;
        case "draft-chat":
            return (
                b.type === "draft-chat" && a.sessionId === b.sessionId && a.message === b.message
            );
        case "new-chat":
            return (
                b.type === "new-chat" &&
                a.projectId === b.projectId &&
                a.workspaceId === b.workspaceId &&
                a.model === b.model &&
                a.effort === b.effort &&
                a.prompt === b.prompt
            );
    }
}

/** Every field of one applet, including its whole version history. */
function appletEquals(a: RigApplet, b: RigApplet): boolean {
    return (
        a.name === b.name &&
        a.description === b.description &&
        a.purpose === b.purpose &&
        a.authorSessionId === b.authorSessionId &&
        a.sourceDescription === b.sourceDescription &&
        a.currentVersion === b.currentVersion &&
        a.createdAt === b.createdAt &&
        a.updatedAt === b.updatedAt &&
        a.versions.length === b.versions.length &&
        a.versions.every((version, index) => appletVersionEquals(version, b.versions[index]!))
    );
}

function appletVersionEquals(a: RigAppletVersion, b: RigAppletVersion): boolean {
    return (
        a.version === b.version &&
        a.changeDescription === b.changeDescription &&
        a.createdAt === b.createdAt
    );
}
