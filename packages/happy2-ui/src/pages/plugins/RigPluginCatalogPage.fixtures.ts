import type { RigPluginCatalogEntry, RigPluginCatalogFailure } from "./RigPluginCatalogPage";

/*
 * Workbench fixtures for the plugin catalog and the store components it is made
 * of.
 *
 * These are specimens, not a catalog. They exist so the cards, the shelves, and
 * a package's own page can be reviewed in every state they support — including
 * the ones a real machine reaches only occasionally, and the ones no machine can
 * reach yet because Rig reports no such field. Nothing here is exported from the
 * package and no application surface may import this file: the running screen is
 * handed what the machine actually said, and shows nothing when the machine has
 * nothing.
 *
 * Every name below is invented. None refers to a package that exists.
 */

/**
 * The complete card: mark, publisher, category, version, and a running package
 * with applications behind it. Publisher and category are the two fields Rig's
 * plugin manifest has no place for today, so this is what the card is ready for
 * rather than what any machine currently fills in.
 */
export const PLUGIN_STORE_FIXTURE_COMPLETE: RigPluginCatalogEntry = {
    id: "cartographer",
    name: "Cartographer",
    description:
        "Keeps a symbol graph of a checkout beside the working tree, so an agent asked about a function is handed its callers instead of searching for them.",
    state: "running",
    glyph: "package",
    tone: "ocean",
    author: "Westbourne Labs",
    category: "Code intelligence",
    version: "2.4.0",
    contributions: ["Repository map", "Symbol search"],
    facts: [
        { label: "Folder", value: "cartographer", monospace: true },
        { label: "Installed at", value: "~/.happy/plugins/cartographer", monospace: true },
        { label: "Writes to", value: "~/.happy/plugin-data/cartographer", monospace: true },
    ],
};

/** The card a real machine draws today: a name, a version, and a description. */
export const PLUGIN_STORE_FIXTURE_BARE: RigPluginCatalogEntry = {
    id: "lantern",
    name: "Lantern",
    description:
        "Follows a build as it streams and keeps the first failure rather than the last thousand lines.",
    state: "running",
    glyph: "package",
    tone: "mint",
    version: "0.9.4",
    contributions: ["Build watch"],
    facts: [{ label: "Folder", value: "lantern", monospace: true }],
};

/** Installed and deliberately off, with the package's own word for why. */
export const PLUGIN_STORE_FIXTURE_STOPPED: RigPluginCatalogEntry = {
    id: "postmark",
    name: "Postmark",
    description: "Posts what a session finished with to somewhere a person will see it.",
    state: "stopped",
    glyph: "package",
    tone: "amber",
    author: "Aoife Kelleher",
    category: "Notifications",
    version: "0.4.1",
    note: "Stopped after its last run and not restarted.",
    facts: [{ label: "Folder", value: "postmark", monospace: true }],
};

/** Installed, tried to start, and could not. */
export const PLUGIN_STORE_FIXTURE_FAILED: RigPluginCatalogEntry = {
    id: "millstone",
    name: "Millstone",
    description: "Applies a migration to a throwaway copy of a schema and reports what it did.",
    state: "failed",
    glyph: "package",
    tone: "ember",
    author: "Happy",
    category: "Databases",
    version: "2.1.0",
    note: "Its entry point threw before it could register anything: Cannot find module './server.js'.",
    facts: [
        { label: "Folder", value: "millstone", monospace: true },
        { label: "Log", value: "Available" },
    ],
};

/**
 * A name, a description, and a path all far past any reasonable length, which is
 * what proves a card keeps its mark, its badge, and its footprint whatever it is
 * handed.
 */
export const PLUGIN_STORE_FIXTURE_OVERLONG: RigPluginCatalogEntry = {
    id: "annotate-every-single-changed-line-in-a-review",
    name: "Annotate Every Single Changed Line In A Review",
    description:
        "A deliberately over-named package with over-long metadata, here to prove that a name, a publisher, and a path far beyond any reasonable length still ellipsize or wrap inside the card and leave the mark, the badge, and the action lane exactly where they are on every other card.",
    state: "running",
    glyph: "package",
    tone: "violet",
    author: "a-publisher-with-an-unreasonably-long-handle",
    category: "Review and annotation tooling for very long names",
    version: "0.0.1-alpha.7+build.20260318",
    facts: [
        {
            label: "Installed at",
            value: "~/.happy/plugins/annotate-every-single-changed-line-in-a-review",
            monospace: true,
        },
    ],
};

/** The shelves as the workbench shows them, in the page's own reading order. */
export const PLUGIN_STORE_FIXTURE_CATALOG: readonly RigPluginCatalogEntry[] = [
    PLUGIN_STORE_FIXTURE_FAILED,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_OVERLONG,
    PLUGIN_STORE_FIXTURE_STOPPED,
];

/** Folders a machine found where a plugin should be and could not read as one. */
export const PLUGIN_STORE_FIXTURE_FAILURES: readonly RigPluginCatalogFailure[] = [
    { folder: "hello-world", error: "happy.plugin.json is invalid. /entry: Unexpected property" },
];
