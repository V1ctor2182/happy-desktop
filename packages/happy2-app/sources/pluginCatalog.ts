import type {
    RigPluginCatalogSnapshot,
    RigPluginCatalogStore,
    RigPluginCategory,
    RigPluginPackage,
} from "happy2-state";
import { pluginStoreTone, type RigPluginCatalogEntry } from "happy2-ui";

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

export function pluginCatalogProjectionCreate(
    store: RigPluginCatalogStore,
): PluginCatalogProjection {
    let held = new Map<string, { source: RigPluginPackage; entry: RigPluginCatalogEntry }>();
    let previous: readonly RigPluginCatalogEntry[] = [];
    const project: PluginCatalogProjection = (snapshot) => {
        const next = new Map<string, { source: RigPluginPackage; entry: RigPluginCatalogEntry }>();
        const entries = snapshot.packages.map((source) => {
            const kept = held.get(source.id);
            // The source reconciles by package id already, so an unchanged
            // package arrives as the very same object. Field equality is checked
            // as well rather than instead, because this projection may not assume
            // how the reading it was handed was built.
            const entry =
                kept && (kept.source === source || packageSame(kept.source, source))
                    ? kept.entry
                    : entryProject(source);
            next.set(source.id, { source, entry });
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
