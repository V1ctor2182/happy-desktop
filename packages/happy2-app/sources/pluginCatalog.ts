import type { RigPluginApplicationsSnapshot } from "happy2-state";
import { pluginStoreTone, type RigPluginCatalogEntry } from "happy2-ui";

/**
 * The catalog screen's entries, projected from one reading of this machine's
 * plugins.
 *
 * Everything here is something the machine said. A package's name, version,
 * description, state, and the folders it lives in and writes to are reported by
 * Rig; what it contributes is the labels of the applications it declared, which
 * are already in the same reading. Nothing is invented to fill the card out: a
 * package with no note carries no note, and a machine with no packages produces
 * no entries.
 *
 * Two fields the card can show are deliberately never set. Rig's plugin manifest
 * has no publisher and no category, so a package on this machine has neither,
 * and guessing one from a folder name would put a claim about authorship on
 * screen that nothing stands behind. The same goes for the mark: the manifest
 * requires an icon file, but no Rig endpoint serves it, so every package wears
 * the house package glyph in a colour derived from its own identity rather than
 * artwork we do not have.
 */
export function pluginCatalogEntries(
    snapshot: RigPluginApplicationsSnapshot,
): readonly RigPluginCatalogEntry[] {
    const labels = new Map(
        snapshot.applications.map((application) => [application.id, application.label]),
    );
    return snapshot.packages.map((entry) => {
        const contributions = entry.applicationIds.flatMap((id) => {
            const label = labels.get(id);
            return label === undefined ? [] : [label];
        });
        // A failure is what a reader has to act on, so it wins over the state
        // message; a package that is merely off usually only has the latter.
        const note = entry.error ?? entry.statusMessage;
        return {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            state: entry.status,
            glyph: "package" as const,
            tone: pluginStoreTone(entry.id),
            ...(entry.version.length > 0 ? { version: entry.version } : {}),
            ...(note === undefined || note.length === 0 ? {} : { note }),
            ...(contributions.length > 0 ? { contributions } : {}),
            facts: [
                { label: "Folder", value: entry.id, monospace: true },
                { label: "Installed at", value: entry.directory, monospace: true },
                { label: "Writes to", value: entry.dataDirectory, monospace: true },
            ],
        };
    });
}
