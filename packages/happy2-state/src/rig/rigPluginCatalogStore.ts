import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";
import type { RigPluginCatalogConnection } from "./rigPluginApplicationStore.js";

/** Whether a package's own code is up, deliberately stopped, or failed to start. */
export type RigPluginPackageStatus = "running" | "stopped" | "failed";

/**
 * The shelf a package declared for itself. It is a closed set the host reports
 * rather than free text, so a surface may put whatever words it likes in front
 * of a reader without ever inventing a shelf the package did not claim.
 */
export type RigPluginCategory =
    | "automation"
    | "collaboration"
    | "data"
    | "developer-tools"
    | "media"
    | "productivity"
    | "utilities"
    | "other";

/**
 * One plugin package installed on this machine.
 *
 * A package is a different reading from the applications it contributes: it
 * exists whether or not it contributes any, and a package that stopped
 * contributes nothing while remaining entirely installed. It carries the labels
 * of its own applications rather than their identities, so nothing above has to
 * join two feeds to draw one card.
 *
 * `directory` and `dataDirectory` are paths on the machine running the plugin.
 * They are here to be shown to a reader; nothing above may treat them as
 * addresses.
 */
export interface RigPluginPackage {
    /** The package's folder name, which is the machine's identity for it. */
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    /** Who publishes the package, as its own manifest names them. */
    readonly author: string;
    /** The shelf the package declared for itself. */
    readonly category: RigPluginCategory;
    /**
     * Where this screen may draw the package's own mark from, when the host read
     * one. It is an address the host made for the bytes it fetched and owns for
     * the life of this reading; nothing may keep it past the subscription it came
     * from. A package the host has no mark for simply has none here.
     */
    readonly artworkUrl?: string;
    readonly status: RigPluginPackageStatus;
    /** The package's own words about the state it is in, when it offered any. */
    readonly statusMessage?: string;
    readonly error?: string;
    readonly directory: string;
    readonly dataDirectory: string;
    readonly logAvailable: boolean;
    /** What it adds to Happy, by the labels a reader will meet it under. */
    readonly contributions: readonly string[];
}

/**
 * A folder the machine found where a package should be and could not read as
 * one. It does not become a package until the reason is fixed, so it is carried
 * beside the catalog rather than inside it.
 */
export interface RigPluginPackageFailure {
    readonly folder: string;
    readonly error: string;
}

/**
 * What the machine did when it accepted an install, in its own words.
 *
 * The host installs a folder, and only the machine can say what that folder
 * turned out to be: whether it is a package it already had, and whether the copy
 * that arrived is newer than the one it replaced. Nothing here is predicted
 * before the fact, which is why there is no "an update is available" anywhere in
 * this surface — the machine reports no such thing, so this cannot claim it.
 */
export type RigPluginInstallClassification =
    | "fresh-install"
    | "upgrade"
    | "downgrade"
    | "reinstall";

/** The copy of a package the machine has, as it described it after installing. */
export interface RigPluginInstalled {
    readonly classification: RigPluginInstallClassification;
    readonly description: string;
    /** The folder it was installed under, which is this machine's identity for it. */
    readonly id: string;
    readonly name: string;
    readonly version: string;
}

/**
 * The package the machine removed. `dataDirectory` is the folder it kept: an
 * uninstall takes away the code and leaves whatever the plugin wrote, and that
 * is the part a reader has to be told rather than left to assume either way.
 */
export interface RigPluginRemoved {
    readonly dataDirectory: string;
    readonly id: string;
    readonly name: string;
}

/** The machine's own closed vocabulary for refusing a lifecycle request. */
export type RigPluginManagementCode =
    | "install_failed"
    | "invalid_request"
    | "plugin_not_found"
    | "plugins_unavailable"
    | "uninstall_failed";

/**
 * Why a lifecycle request did not happen, kept as the two different things it
 * can be. `machine` is the host's own answer, with the code it chose and the
 * sentence it wrote, and is the only kind that says anything about the folder or
 * the package. `host` is never having been able to ask: the capability is not
 * here at all, the machine was replaced while the request was in flight, or the
 * request itself did not complete.
 *
 * They are kept apart because a surface must not put the machine's name to a
 * sentence the machine never said.
 */
export type RigPluginManagementFailure =
    | {
          readonly reason: "machine";
          readonly code: RigPluginManagementCode;
          readonly message: string;
      }
    | {
          readonly reason: "host";
          readonly kind: "unavailable" | "superseded" | "unreachable";
          readonly message: string;
      };

export type RigPluginInstallResult =
    | { readonly ok: true; readonly plugin: RigPluginInstalled }
    | { readonly ok: false; readonly failure: RigPluginManagementFailure };

export type RigPluginRemovalResult =
    | { readonly ok: true; readonly plugin: RigPluginRemoved }
    | { readonly ok: false; readonly failure: RigPluginManagementFailure };

/**
 * The one way this surface changes what is installed.
 *
 * Both operations are irreversible on the machine and neither is cancellable
 * here: once a request has been made, the machine finishes it whatever this
 * screen does next. There is deliberately no cancel — an install that has
 * already replaced a package cannot be un-replaced, and offering to stop it
 * would be offering something nothing can deliver. What can be given up is
 * waiting for the answer, and that is the store's business rather than this
 * contract's.
 *
 * `source` is passed through untouched: the machine decides what a folder is,
 * and this package holds no opinion it could check one against.
 */
export interface RigPluginManagementSource {
    install(source: string): Promise<RigPluginInstallResult>;
    remove(id: string): Promise<RigPluginRemovalResult>;
}

/**
 * Where the one install this surface runs at a time has got to.
 *
 * There is one because an install is a decision a person is making now, not a
 * queue: a second one started while the first is running would race for the same
 * folders on the same machine, and the answer that arrived last would be taken
 * for the answer to the one they are looking at.
 */
export type RigPluginInstallState =
    | { readonly kind: "idle" }
    | { readonly kind: "working"; readonly source: string }
    | { readonly kind: "installed"; readonly source: string; readonly plugin: RigPluginInstalled }
    | {
          readonly kind: "failed";
          readonly source: string;
          readonly failure: RigPluginManagementFailure;
      };

/**
 * Where one package's removal has got to. `removed` is the machine having said
 * so and is kept until the catalog stops listing that package, because the
 * catalog is what actually decides whether it is installed: a machine that
 * answered and then went quiet leaves a card that says it was removed and that
 * the reading has not caught up, rather than one that quietly vanishes on this
 * screen's say-so.
 */
export type RigPluginRemovalState =
    | { readonly kind: "working"; readonly name: string }
    | { readonly kind: "removed"; readonly name: string; readonly dataDirectory: string }
    | {
          readonly kind: "failed";
          readonly name: string;
          readonly failure: RigPluginManagementFailure;
      };

/**
 * One reading of this machine's installed plugins, with how the feed itself is
 * doing. `loading` is true only before the first reading arrives, so a screen
 * never claims a machine has nothing before it has asked.
 */
export interface RigPluginCatalogSourceReading {
    readonly packages: readonly RigPluginPackage[];
    readonly failures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
    /** The feed's own last failure, when the host reported one in words. */
    readonly error?: string;
}

/**
 * This machine's plugin inventory. Subscribing starts following it and releasing
 * the last subscriber stops, so the catalog is read only while a screen is
 * actually showing it.
 */
export interface RigPluginCatalogSource {
    subscribe(
        listener: (reading: RigPluginCatalogSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigPluginCatalogSnapshot {
    readonly packages: readonly RigPluginPackage[];
    readonly failures: readonly RigPluginPackageFailure[];
    readonly connection: RigPluginCatalogConnection;
    readonly loading: boolean;
    /** Set when the feed failed; the packages already read stay exactly as they are. */
    readonly error?: UserError;
    /**
     * Whether this host can change what is installed at all. It is false for a
     * window that can only read the machine, so a surface leaves the controls
     * out rather than showing ones that would refuse.
     */
    readonly manageable: boolean;
    readonly install: RigPluginInstallState;
    /**
     * Every removal this screen has asked for, by the package's own identity. A
     * package with no entry has nothing being done to it, which is why this is a
     * map rather than a field on each package: what is installed is the
     * machine's to say, and what has been asked of it is this screen's.
     */
    readonly removals: ReadonlyMap<string, RigPluginRemovalState>;
}

export interface RigPluginCatalogStore {
    get(): RigPluginCatalogSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Asks the machine to install the plugin in one folder on it, and updates a
     * package by installing the folder it came from. Returns at once: the work
     * is irreversible and belongs to the machine, so this states the intent and
     * the answer arrives in the snapshot.
     *
     * Exactly one runs at a time. A press while one is running is ignored
     * outright rather than queued, so a double press cannot install twice, and
     * an empty folder is not a request at all.
     */
    packageInstall(source: string): void;
    /** Puts the last install's answer away, which is also how the next one starts. */
    packageInstallDismiss(): void;
    /**
     * Asks the machine to remove one installed package. Ignored when that
     * package already has a removal running, and when the current reading does
     * not list it — a package this screen cannot see is not one it may act on.
     */
    packageRemove(id: string): void;
    /** Puts one removal's answer away. A removal that is running cannot be put away. */
    packageRemoveDismiss(id: string): void;
    [Symbol.dispose](): void;
}

export interface RigPluginCatalogStoreDeps {
    readonly source: RigPluginCatalogSource;
    /**
     * How this host changes what is installed. Omitted leaves the surface able
     * to read the machine and not to change it, which is exactly what a window
     * that cannot reach the machine's folders should offer.
     */
    readonly management?: RigPluginManagementSource;
}

const NO_REMOVALS: ReadonlyMap<string, RigPluginRemovalState> = new Map();

const IDLE_INSTALL: RigPluginInstallState = { kind: "idle" };

const EMPTY: RigPluginCatalogSnapshot = {
    packages: [],
    failures: [],
    connection: "connecting",
    loading: true,
    manageable: false,
    install: IDLE_INSTALL,
    removals: NO_REMOVALS,
};

/**
 * The plugin packages installed on this machine, as one surface.
 *
 * It is deliberately separate from the application store. The applications a
 * plugin contributes are pinned navigation, followed for as long as a window is
 * open; what is installed is one screen's subject and is followed only while
 * that screen is up. Keeping them apart is what lets this one be started and
 * stopped with the screen instead of running for the lifetime of the window.
 *
 * A failure never empties the store. Whatever was last read stays readable and
 * the error is carried beside it, because a subscription dropping does not
 * uninstall anything; the surface says the reading is old rather than pretending
 * the machine was emptied.
 *
 * Changing what is installed lives here rather than in a store of its own for one
 * reason: a card has to be drawn from the reading and from what is being done to
 * that package at the same moment. Two stores would be two notifications and one
 * frame in which a package the machine has just stopped listing still carries a
 * removal, or a card is drawn busy for something that finished. They are one
 * surface because they are read together.
 *
 * Nothing here is ever optimistic. An install that the machine accepted does not
 * put a card on the shelf and a removal it accepted does not take one off: the
 * catalog is the only thing that says what is installed, and what these actions
 * record is what was asked and what was answered. Neither is cancelled by this
 * screen closing, because both have already happened on the machine by then —
 * what a closed screen gives up is the answer, not the work.
 */
export function rigPluginCatalogStoreCreate(
    deps: RigPluginCatalogStoreDeps,
): RigPluginCatalogStore {
    const management = deps.management;
    const store = createStore<RigPluginCatalogSnapshot>()(() => ({
        ...EMPTY,
        manageable: management !== undefined,
    }));
    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;
    /*
     * Which install and which removals are the current ones. Every request takes
     * a number as it starts, and an answer is only ever applied while its number
     * is still the one being waited for. That is what keeps an answer to a
     * request that was superseded, dismissed, or asked for again from landing on
     * top of a newer one — the answers travel over a process boundary and may
     * arrive in any order at all.
     */
    let installTicket = 0;
    const removalTickets = new Map<string, number>();

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                const held = store.getState();
                store.setState(
                    {
                        packages: reading.packages,
                        failures: reading.failures,
                        connection: reading.connection,
                        loading: reading.loading,
                        manageable: held.manageable,
                        install: held.install,
                        // The catalog is what settles a removal. An entry the
                        // reading no longer lists has been confirmed and is over;
                        // anything else stands, including one still waiting.
                        removals: removalsReconcile(held.removals, reading.packages),
                        // The host's own words when it has any, so a reading that
                        // went stale says why in the same terms the host used.
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(new Error(reading.error)) }),
                    },
                    true,
                );
            },
            (error) => {
                if (disposed) return;
                store.setState({ error: rigUserError(error), loading: false }, false);
            },
        );
    };

    const removalSet = (id: string, state: RigPluginRemovalState | undefined): void => {
        const held = store.getState().removals;
        const next = new Map(held);
        if (state === undefined) next.delete(id);
        else next.set(id, state);
        store.setState({ removals: next }, false);
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        packageInstall(source) {
            if (disposed || !management) return;
            const value = source.trim();
            // Admission is here and nowhere else: one install at a time, and
            // nothing at all for an empty field. A press that is not admitted
            // changes nothing, so a second one cannot start a second install and
            // cannot clear the answer to the first.
            if (value.length === 0 || store.getState().install.kind === "working") return;
            const ticket = ++installTicket;
            store.setState({ install: { kind: "working", source: value } }, false);
            void management.install(value).then(
                (result) => {
                    if (disposed || installTicket !== ticket) return;
                    store.setState(
                        {
                            install: result.ok
                                ? { kind: "installed", plugin: result.plugin, source: value }
                                : { kind: "failed", failure: result.failure, source: value },
                        },
                        false,
                    );
                    // A package that has just been installed is not one that was
                    // removed, whatever this screen was told a moment ago. The
                    // machine has spoken about it more recently than that.
                    if (result.ok) removalSet(result.plugin.id, undefined);
                },
                (error: unknown) => {
                    if (disposed || installTicket !== ticket) return;
                    store.setState(
                        {
                            install: {
                                kind: "failed",
                                failure: hostFailure(error),
                                source: value,
                            },
                        },
                        false,
                    );
                },
            );
        },
        packageInstallDismiss() {
            if (disposed || store.getState().install.kind === "working") return;
            // The ticket moves on with the answer being put away, so a request
            // that somehow answers after this cannot reopen what was dismissed.
            installTicket += 1;
            store.setState({ install: IDLE_INSTALL }, false);
        },
        packageRemove(id) {
            if (disposed || !management) return;
            const held = store.getState();
            if (held.removals.get(id)?.kind === "working") return;
            const target = held.packages.find((entry) => entry.id === id);
            if (!target) return;
            const ticket = (removalTickets.get(id) ?? 0) + 1;
            removalTickets.set(id, ticket);
            removalSet(id, { kind: "working", name: target.name });
            void management.remove(id).then(
                (result) => {
                    if (disposed || removalTickets.get(id) !== ticket) return;
                    removalSet(
                        id,
                        result.ok
                            ? {
                                  kind: "removed",
                                  dataDirectory: result.plugin.dataDirectory,
                                  name: result.plugin.name,
                              }
                            : { kind: "failed", failure: result.failure, name: target.name },
                    );
                },
                (error: unknown) => {
                    if (disposed || removalTickets.get(id) !== ticket) return;
                    removalSet(id, {
                        kind: "failed",
                        failure: hostFailure(error),
                        name: target.name,
                    });
                },
            );
        },
        packageRemoveDismiss(id) {
            if (disposed) return;
            if (store.getState().removals.get(id)?.kind === "working") return;
            removalTickets.set(id, (removalTickets.get(id) ?? 0) + 1);
            removalSet(id, undefined);
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
            removalTickets.clear();
        },
    };
}

/**
 * Drops every removal the catalog has settled, keeping the map itself when it
 * settled none. An entry is over once the reading stops listing its package:
 * that is the machine agreeing, and it covers a package removed from somewhere
 * else just as well as one removed from here. A removal that failed is kept
 * while its package is still listed, because the package is still there and the
 * reason it is still there is the only thing on screen explaining it.
 */
function removalsReconcile(
    held: ReadonlyMap<string, RigPluginRemovalState>,
    packages: readonly RigPluginPackage[],
): ReadonlyMap<string, RigPluginRemovalState> {
    if (held.size === 0) return held;
    const installed = new Set(packages.map((entry) => entry.id));
    let next: Map<string, RigPluginRemovalState> | undefined;
    for (const id of held.keys()) {
        if (installed.has(id)) continue;
        next ??= new Map(held);
        next.delete(id);
    }
    return next ?? held;
}

/**
 * A rejection from the host itself rather than an answer from the machine. The
 * bridge answers with a value for anything the machine said, so reaching here
 * means the call did not complete at all.
 */
function hostFailure(error: unknown): RigPluginManagementFailure {
    return {
        kind: "unreachable",
        message: error instanceof Error ? error.message : String(error),
        reason: "host",
    };
}

const INERT_SNAPSHOT: RigPluginCatalogSnapshot = {
    packages: [],
    failures: [],
    connection: "closed",
    loading: false,
    manageable: false,
    install: IDLE_INSTALL,
    removals: NO_REMOVALS,
};

/**
 * The inventory for a Rig whose host cannot read the machine's plugins at all —
 * a browser window rather than the desktop shell. It is settled and empty rather
 * than loading, so a screen that subscribes unconditionally reads "none here"
 * instead of waiting for a list that is not coming.
 */
export const rigPluginCatalogStoreNoop: RigPluginCatalogStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    packageInstall: () => undefined,
    packageInstallDismiss: () => undefined,
    packageRemove: () => undefined,
    packageRemoveDismiss: () => undefined,
    [Symbol.dispose]: () => undefined,
};
