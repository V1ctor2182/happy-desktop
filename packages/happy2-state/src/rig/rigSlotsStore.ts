import type { UserError } from "../types.js";
import type { RigGlobalEvent, RigTransport } from "./rigTransport.js";
import { rigUserError } from "./rigSupport.js";
import type { RigProjectId, RigSessionId, RigThinkingLevel, RigWorktreeId } from "./rigTypes.js";

export type RigSlotName = "status-line" | "above-composer" | "title" | "sidebar";

export type RigSlotScope = "everywhere" | "project" | "workspace" | "session";

export type RigSlotAction =
    | { readonly type: "send-current-chat"; readonly message: string }
    | { readonly type: "open-webapp"; readonly webapp: string }
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

export interface RigWebappVersion {
    readonly version: number;
    readonly changeDescription: string;
    readonly createdAt: number;
}

/** One imported, versioned webapp whose current static files Rig serves. */
export interface RigWebapp {
    readonly name: string;
    readonly description: string;
    readonly purpose: string;
    readonly authorSessionId: string;
    readonly sourceDescription?: string;
    readonly currentVersion: number;
    readonly versions: readonly RigWebappVersion[];
    readonly createdAt: number;
    readonly updatedAt: number;
}

/** The route-owned context Rig uses to include matching scoped entries. */
export interface RigSlotsContext {
    readonly projectId?: RigProjectId;
    readonly workspaceId?: RigWorktreeId;
    readonly sessionId?: RigSessionId;
}

/**
 * The four render-ready slot collections for one addressed context, plus the
 * Rig-global webapp catalog used to validate open-webapp actions.
 */
export interface RigSlotsSnapshot {
    readonly statusLine: readonly RigSlotEntry[];
    readonly aboveComposer: readonly RigSlotEntry[];
    readonly title: readonly RigSlotEntry[];
    readonly sidebar: readonly RigSlotEntry[];
    readonly webapps: readonly RigWebapp[];
    readonly loading: boolean;
    readonly error?: UserError;
}

export interface RigSlotsStore {
    get(): RigSlotsSnapshot;
    subscribe(listener: () => void): () => void;
    [Symbol.dispose](): void;
}

export interface RigSlotsStoreOptions {
    readonly context?: RigSlotsContext;
    readonly transport: RigTransport;
}

const NO_ENTRIES: readonly RigSlotEntry[] = [];
const NO_WEBAPPS: readonly RigWebapp[] = [];
const EMPTY_SNAPSHOT: RigSlotsSnapshot = {
    statusLine: NO_ENTRIES,
    aboveComposer: NO_ENTRIES,
    title: NO_ENTRIES,
    sidebar: NO_ENTRIES,
    webapps: NO_WEBAPPS,
    loading: true,
};
const NOOP_SNAPSHOT: RigSlotsSnapshot = { ...EMPTY_SNAPSHOT, loading: false };

type SlotsInput =
    | { readonly type: "slotsLoaded"; readonly entries: readonly RigSlotEntry[] }
    | { readonly type: "slotsFailed"; readonly error: UserError }
    | { readonly type: "webappsLoaded"; readonly webapps: readonly RigWebapp[] }
    | { readonly type: "webappsFailed"; readonly error: UserError };

/**
 * Creates the slot surface for one immutable route context.
 *
 * Construction opens no transport. The first subscriber reads the filtered
 * slot catalog and webapps together and opens one global-event subscription;
 * the last subscriber tears that stream down. Realtime events are hints only:
 * each matching event re-reads its durable endpoint instead of accepting the
 * full event payload as authority.
 */
export function rigSlotsStoreCreate(options: RigSlotsStoreOptions): RigSlotsStore {
    const listeners = new Set<() => void>();
    let snapshot = EMPTY_SNAPSHOT;
    let active = false;
    let disposed = false;
    let slotsSettled = false;
    let webappsSettled = false;
    let slotsError: UserError | undefined;
    let webappsError: UserError | undefined;
    let slotsGeneration = 0;
    let webappsGeneration = 0;
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
            const entries = entriesPreserve(
                [
                    ...snapshot.statusLine,
                    ...snapshot.aboveComposer,
                    ...snapshot.title,
                    ...snapshot.sidebar,
                ],
                input.entries,
            );
            publish({
                ...snapshot,
                statusLine: slotEntries(entries, "status-line", snapshot.statusLine),
                aboveComposer: slotEntries(entries, "above-composer", snapshot.aboveComposer),
                title: slotEntries(entries, "title", snapshot.title),
                sidebar: slotEntries(entries, "sidebar", snapshot.sidebar),
                loading: !(slotsSettled && webappsSettled),
                error: webappsError,
            });
            return;
        }
        if (input.type === "webappsLoaded") {
            webappsSettled = true;
            webappsError = undefined;
            publish({
                ...snapshot,
                webapps: webappsPreserve(snapshot.webapps, input.webapps),
                loading: !(slotsSettled && webappsSettled),
                error: slotsError,
            });
            return;
        }
        if (input.type === "slotsFailed") {
            slotsSettled = true;
            slotsError = input.error;
        } else {
            webappsSettled = true;
            webappsError = input.error;
        }
        publish({
            ...snapshot,
            loading: !(slotsSettled && webappsSettled),
            error: slotsError ?? webappsError,
        });
    };

    const slotsLoad = async (): Promise<void> => {
        const generation = ++slotsGeneration;
        try {
            const entries = await options.transport.slotsRead(options.context ?? {});
            if (!active || disposed || generation !== slotsGeneration) return;
            slotsInput({ type: "slotsLoaded", entries });
        } catch (error) {
            if (!active || disposed || generation !== slotsGeneration) return;
            slotsInput({ type: "slotsFailed", error: rigUserError(error) });
        }
    };

    const webappsLoad = async (): Promise<void> => {
        const generation = ++webappsGeneration;
        try {
            const webapps = await options.transport.webappsRead();
            if (!active || disposed || generation !== webappsGeneration) return;
            slotsInput({ type: "webappsLoaded", webapps });
        } catch (error) {
            if (!active || disposed || generation !== webappsGeneration) return;
            slotsInput({ type: "webappsFailed", error: rigUserError(error) });
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
            else if (event.type === "webapps_changed") void webappsLoad();
        },
        error() {
            if (!active || disposed) return;
            void Promise.all([slotsLoad(), webappsLoad()]);
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
        void Promise.all([slotsLoad(), webappsLoad()]);
    };

    const stop = (): void => {
        active = false;
        slotsGeneration += 1;
        webappsGeneration += 1;
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

function entriesPreserve(
    previous: readonly RigSlotEntry[],
    incoming: readonly RigSlotEntry[],
): readonly RigSlotEntry[] {
    const before = new Map(previous.map((entry) => [entry.id, entry]));
    return incoming.map((entry) => {
        const candidate = before.get(entry.id);
        return candidate?.updatedAt === entry.updatedAt ? candidate : entry;
    });
}

function slotEntries(
    entries: readonly RigSlotEntry[],
    slot: RigSlotName,
    previous: readonly RigSlotEntry[],
): readonly RigSlotEntry[] {
    const next = entries.filter((entry) => entry.slot === slot);
    return next.length === previous.length &&
        next.every((entry, index) => entry === previous[index])
        ? previous
        : next;
}

function webappsPreserve(
    previous: readonly RigWebapp[],
    incoming: readonly RigWebapp[],
): readonly RigWebapp[] {
    const before = new Map(previous.map((webapp) => [webapp.name, webapp]));
    const next = incoming.map((webapp) => {
        const candidate = before.get(webapp.name);
        return candidate?.updatedAt === webapp.updatedAt ? candidate : webapp;
    });
    return next.length === previous.length &&
        next.every((webapp, index) => webapp === previous[index])
        ? previous
        : next;
}
