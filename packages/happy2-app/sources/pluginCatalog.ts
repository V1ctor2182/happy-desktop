import type {
    RigPluginCatalogSnapshot,
    RigPluginCatalogStore,
    RigPluginCategory,
    RigPluginInstallState,
    RigPluginManagementFailure,
    RigPluginPackage,
    RigPluginRemovalState,
} from "happy2-state";
import {
    pluginStoreTone,
    type RigPluginCatalogEntry,
    type RigPluginCatalogInstall,
    type RigPluginCatalogRemoval,
} from "happy2-ui";

/**
 * Projects one reading of this machine's plugins into the cards the catalog
 * screen draws, reusing every entry whose package did not change.
 *
 * The identity contract this exists for: the store re-announces its whole
 * reading for any change in it, so one package starting would otherwise hand
 * every other card a new `entry`, a new `contributions` array, and a new `facts`
 * array. Those are props of a keyed card, so React would reconcile the changed
 * package and leave the rest alone either way — but the arrays inside them are
 * what a memoized card would compare, and rebuilding them makes every card in
 * the catalog look different to any such comparison. Holding the projection per
 * package id is what keeps "one plugin started" to one changed card.
 *
 * The reconciler is stateful and must therefore live exactly as long as the
 * store it reads, which is why it is built from that store: one per store
 * identity, seeded from what the store already holds, and replaced when the
 * store is. A different store is a different machine's reading and inherits
 * nothing from the last one.
 *
 * Everything projected is something the machine said. A package's name, version,
 * description, state, publisher, shelf, the folders it lives in and writes to,
 * whether it kept a log, and the labels of what it contributes are all reported
 * by Rig in the same reading. Nothing is invented to fill a card out: a package
 * with no note carries no note, and a machine with no packages produces no
 * entries.
 *
 * The mark is the one thing that may be missing. A package declares an icon and
 * the host fetches and checks it, but a package whose icon cannot be served has
 * none, and a reading taken before the bytes arrived does not have it yet. In
 * both cases the card wears a house glyph in a colour derived from the package's
 * own identity — a generated mark, not a claim that this is the package's
 * artwork, and never something derived from why the real one is absent.
 */
export interface PluginCatalogProjection {
    (snapshot: RigPluginCatalogSnapshot): readonly RigPluginCatalogEntry[];
}

/** One package as it was last projected, with what it was projected from. */
interface Held {
    readonly source: RigPluginPackage;
    /** The card without anything this screen has asked of the package. */
    readonly base: RigPluginCatalogEntry;
    /** The removal the card was built with, so an unchanged one keeps the card. */
    readonly removal: RigPluginRemovalState | undefined;
    readonly entry: RigPluginCatalogEntry;
}

export function pluginCatalogProjectionCreate(
    store: RigPluginCatalogStore,
): PluginCatalogProjection {
    let held = new Map<string, Held>();
    let previous: readonly RigPluginCatalogEntry[] = [];
    const project: PluginCatalogProjection = (snapshot) => {
        const next = new Map<string, Held>();
        const entries = snapshot.packages.map((source) => {
            const kept = held.get(source.id);
            // The source reconciles by package id already, so an unchanged
            // package arrives as the very same object. Field equality is checked
            // as well rather than instead, because this projection may not assume
            // how the reading it was handed was built.
            const base =
                kept && (kept.source === source || packageSame(kept.source, source))
                    ? kept.base
                    : entryProject(source);
            /*
             * What has been asked of this package rides on the card, so it is
             * part of what makes a card the same card. The states themselves are
             * held by the store and only replaced when they change, so comparing
             * them by identity is what keeps a package nobody is touching on the
             * very object it already had.
             */
            const removal = snapshot.removals.get(source.id);
            const entry =
                kept && kept.base === base && kept.removal === removal
                    ? kept.entry
                    : removal === undefined
                      ? base
                      : { ...base, removal: removalProject(removal) };
            next.set(source.id, { base, entry, removal, source });
            return entry;
        });
        held = next;
        const unchanged =
            entries.length === previous.length &&
            entries.every((entry, index) => entry === previous[index]);
        if (!unchanged) previous = entries;
        return previous;
    };
    // Seeded with what the store already holds, so the first render after the
    // screen opens reuses those cards instead of starting from nothing.
    project(store.get());
    return project;
}

function entryProject(source: RigPluginPackage): RigPluginCatalogEntry {
    // A failure is what a reader has to act on, so it wins over the state
    // message; a package that is merely off usually only has the latter.
    const note = source.error ?? source.statusMessage;
    return {
        id: source.id,
        folder: source.id,
        name: source.name,
        description: source.description,
        state: source.status,
        glyph: source.status === "failed" ? "close" : "package",
        tone: pluginStoreTone(source.id),
        author: source.author,
        category: CATEGORY_LABELS[source.category],
        // Absent until the host has the bytes, and absent for good when it has
        // none to get. Either way the card falls back to its generated mark.
        ...(source.artworkUrl === undefined ? {} : { artworkUrl: source.artworkUrl }),
        ...(source.version.length > 0 ? { version: source.version } : {}),
        ...(note === undefined || note.length === 0 ? {} : { note }),
        ...(source.contributions.length > 0 ? { contributions: source.contributions } : {}),
        facts: [
            { label: "Folder", value: source.id, monospace: true },
            { label: "Installed at", value: source.directory, monospace: true },
            { label: "Writes to", value: source.dataDirectory, monospace: true },
            // Stated, not offered: Rig keeps a log for this package and nothing
            // on this screen reads one yet, so saying it exists is the whole of
            // what can honestly be said about it.
            ...(source.logAvailable ? [{ label: "Log", value: "Available" }] : []),
        ],
    };
}

/**
 * Where one package's removal has got to, in words.
 *
 * `removed` says the part a reader would otherwise get wrong: Rig deletes the
 * code it manages and keeps the folder the plugin writes to, and it names that
 * folder because it is the thing still on the disk afterwards.
 */
function removalProject(state: RigPluginRemovalState): RigPluginCatalogRemoval {
    switch (state.kind) {
        case "working":
            return { kind: "working" };
        case "removed":
            return {
                kind: "removed",
                message: `Rig kept what it wrote, in ${state.dataDirectory}.`,
            };
        case "failed":
            return { kind: "failed", ...failureText(state.failure, "remove") };
    }
}

/**
 * Where the one install has got to, in words.
 *
 * What an install turned out to be is Rig's to say and is only known afterwards:
 * it stages the folder, checks it, and then reports whether that was a package
 * this machine did not have, a newer version of one it did, an older one, or the
 * same one again. Each of those is said as what it was, and none of them is
 * predicted anywhere before the machine answers.
 */
export function pluginInstallProject(state: RigPluginInstallState): RigPluginCatalogInstall {
    switch (state.kind) {
        case "idle":
            return { kind: "idle" };
        case "working":
            return { kind: "working" };
        case "failed":
            return { kind: "failed", ...failureText(state.failure, "install") };
        case "installed": {
            const plugin = state.plugin;
            const version = plugin.version.length > 0 ? ` ${plugin.version}` : "";
            const title =
                plugin.classification === "upgrade"
                    ? `Updated ${plugin.name} to${version.trim() === "" ? " a new version" : version}`
                    : plugin.classification === "downgrade"
                      ? `Put ${plugin.name} back to${version.trim() === "" ? " an earlier version" : version}`
                      : plugin.classification === "reinstall"
                        ? `Reinstalled ${plugin.name}${version}`
                        : `Installed ${plugin.name}${version}`;
            return {
                kind: "installed",
                message: `Rig installed ${state.source} and this machine now lists it as ${plugin.id}.`,
                title,
            };
        }
    }
}

/**
 * Why a lifecycle request did not happen, as a heading and a sentence.
 *
 * The machine's own message is passed through untouched, because it is the only
 * part that knows anything about the folder or the package. The heading is the
 * one thing written here, and it says no more than which of the machine's closed
 * set of answers this was. A failure the machine never gave is never attributed
 * to it: a host that could not ask says so as itself.
 */
function failureText(
    failure: RigPluginManagementFailure,
    operation: "install" | "remove",
): { readonly title: string; readonly message: string } {
    if (failure.reason === "host")
        return {
            message: failure.message,
            title:
                failure.kind === "unavailable"
                    ? "This window cannot change what is installed"
                    : failure.kind === "superseded"
                      ? "This machine was replaced before it answered"
                      : "This machine could not be reached",
        };
    switch (failure.code) {
        case "invalid_request":
            return { message: failure.message, title: "This machine did not accept that request" };
        case "plugin_not_found":
            return { message: failure.message, title: "This machine has no such plugin" };
        case "plugins_unavailable":
            return { message: failure.message, title: "This machine is not managing plugins" };
        case "install_failed":
        case "uninstall_failed":
            return {
                message: failure.message,
                title:
                    operation === "install"
                        ? "This machine did not install that folder"
                        : "This machine did not remove it",
            };
    }
}

/**
 * The shelves in a reader's words, one for each shelf Rig has.
 *
 * The mapping is deliberately total and deliberately literal: every value the
 * host can report gets exactly one label, so a shelf can never be dropped or
 * quietly turned into another one, and no label says more than the package
 * claimed. `other` is what Rig fills in for a package that declared nothing, so
 * it is named as the absence it is rather than dressed up as a category.
 */
const CATEGORY_LABELS: Record<RigPluginCategory, string> = {
    automation: "Automation",
    collaboration: "Collaboration",
    data: "Data",
    "developer-tools": "Developer tools",
    media: "Media",
    other: "Uncategorized",
    productivity: "Productivity",
    utilities: "Utilities",
};

/** Every field `entryProject` reads, which is what makes two readings the same card. */
function packageSame(held: RigPluginPackage, next: RigPluginPackage): boolean {
    return (
        held.id === next.id &&
        held.author === next.author &&
        held.category === next.category &&
        held.artworkUrl === next.artworkUrl &&
        held.name === next.name &&
        held.version === next.version &&
        held.description === next.description &&
        held.status === next.status &&
        held.statusMessage === next.statusMessage &&
        held.error === next.error &&
        held.directory === next.directory &&
        held.dataDirectory === next.dataDirectory &&
        held.logAvailable === next.logAvailable &&
        held.contributions.length === next.contributions.length &&
        held.contributions.every((label, index) => label === next.contributions[index])
    );
}
