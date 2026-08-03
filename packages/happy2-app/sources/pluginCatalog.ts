import type {
    RigPluginCatalogSnapshot,
    RigPluginCatalogStore,
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
 * description, state, the folders it lives in and writes to, whether it kept a
 * log, and the labels of what it contributes are all reported by Rig in the same
 * reading. Nothing is invented to fill a card out: a package with no note
 * carries no note, and a machine with no packages produces no entries.
 *
 * Three fields the card can show are deliberately never set. Rig's plugin
 * manifest has no publisher and no category, so a package on this machine has
 * neither, and guessing one from a folder name would put a claim about
 * authorship on screen that nothing stands behind. The same goes for the mark:
 * the manifest requires an icon file, but no Rig endpoint serves it, so every
 * package wears a house glyph in a colour derived from its own identity rather
 * than artwork we do not have.
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
        glyph: source.status === "failed" ? "alert" : "package",
        tone: pluginStoreTone(source.id),
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

/** Every field `entryProject` reads, which is what makes two readings the same card. */
function packageSame(held: RigPluginPackage, next: RigPluginPackage): boolean {
    return (
        held.id === next.id &&
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
