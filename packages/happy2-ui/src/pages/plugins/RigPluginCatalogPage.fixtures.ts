import type { RigPluginCatalogEntry, RigPluginCatalogFailure } from "./RigPluginCatalogPage";

/*
 * Workbench fixtures for the plugin catalog and the store components it is made
 * of.
 *
 * These are specimens, not a catalog. They exist so the cards, the shelves, and
 * a package's own page can be reviewed in every state they support, including
 * the ones a real machine reaches only occasionally. Nothing here is exported
 * from the package and no application surface may import this file: the running
 * screen is handed what the machine actually said, and shows nothing when the
 * machine has nothing.
 *
 * The marks below are real PNG bytes, drawn for these specimens and carried as
 * data so the workbench needs no server. A running screen never sees a data
 * address: it is handed one the host made for bytes it fetched and checked, and
 * the component cannot tell the two apart, which is the point of reviewing it
 * against real images rather than against a placeholder.
 *
 * Every name below is invented. None refers to a package that exists.
 */

/* Marks drawn for these specimens. Original artwork, not any package's icon. */
const ARTWORK_RINGS =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAA/ElEQVR42u3bwRGDMAxEUZWSwqiN0lJCWiA3LgwEiCUt0meGW8ZkXwI2tmV283hN86J0muehFjYM5anBh0BUCX8LoVr4SwhVw59CqB7+EKFL+F2E1gDdwm8QAAAAgL4AXcOvCAAAEHvB92c5PEsC/AqdiWGq4aMQTDV4FIQp3ecZCBYVPqsdCQCFtkIAPL6wN4Iph49o2w0g+/OyAKN6CCmAs0H+6fO9bgNT+vUz/gVhACNGfgAAAAAPwUcAtOsG2w+EGArzMsTrMBMiTIkxKcq0OAsjLI2xOMryOADsE2KXGAAAAMCOceoFqBqhbojKMWoHqR6lhpiKcv2wX/BAorfG+iRWAAAAAElFTkSuQmCC";
const ARTWORK_BARS =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAw0lEQVR42u3bMQrDMAwFUB+kh8thcuBOXZMtS2hpghUs6xm8Gv6bZNBv7eZ5rcs20m2RZ7Swj6FkDd4FYpbwtxBmC38JYdbwfyHMHv4nQpXwXxFKA1QLf0IAAABAXYCq4Q8EAIGPv7dPlwsgI0Cv8NEIAAAkCB+JAACAQQgAAAAAAAAAMOjwEz0UAcgwAkeOxAAAJPkJRv0IAQAwCAEAAAAAAAAAANgTsiUGAAAAG+P6AlojRcMrTanNKU6qzipPF6zP7z6U4/Xac0hLAAAAAElFTkSuQmCC";
const ARTWORK_CHEVRON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABLElEQVR42u2byxGDMAwFXUrqSaWpLOd0AKdcGRDvScJez3BF2h0+tmyNERyf92vrdA3n6AabJuWp4BIRs8CHJMwGf0nCrPCnJMwOfyghcqPt9y2HieYgE1Ap4U58yaP/T6BCgiK2VECmBFVcuYAMCcqYFgFOCep4NgEOCY5Yt//9R0kpJTjjWAUoJLhjjM4JZggeGY9oJNEMeJkAdcJZ8FIBqsQz4eUC7gJkw1sEREEq4G0CrgJVwVsFnAWrhLcLUEiwV4cqlq9d4NMERCSk1Qerqjgd4BHAK8BHkN8gEyGmwiyGWA5TEKEkRlGUsjgbI2yNLbg5ahPwlO3x9HpAyxNjCEAAAhCwtICVzgjLT4khAAEImKdvYGl4BNAyQ9MUbXM0TtI6S/P0ku3zO2AP9bVxrqk8AAAAAElFTkSuQmCC";

/**
 * The complete card: the package's own mark, its publisher, its shelf, its
 * version, and the applications it contributes while running. This is what a
 * fully described package looks like, and every field on it is one Rig reports.
 */
export const PLUGIN_STORE_FIXTURE_COMPLETE: RigPluginCatalogEntry = {
    id: "cartographer",
    name: "Cartographer",
    description:
        "Keeps a symbol graph of a checkout beside the working tree, so an agent asked about a function is handed its callers instead of searching for them.",
    state: "running",
    glyph: "package",
    tone: "ocean",
    artworkUrl: ARTWORK_RINGS,
    author: "Westbourne Labs",
    category: "Developer tools",
    version: "2.4.0",
    contributions: ["Repository map", "Symbol search"],
    facts: [
        { label: "Folder", value: "cartographer", monospace: true },
        { label: "Installed at", value: "~/.happy/plugins/cartographer", monospace: true },
        { label: "Writes to", value: "~/.happy/plugin-data/cartographer", monospace: true },
    ],
};

/**
 * A package whose mark has not arrived. Its bytes are read on their own schedule,
 * so a card is drawn before them and falls back to its generated mark; when they
 * land the card changes and nothing else does. A package Rig has no mark for
 * looks exactly like this, permanently, which is why one specimen covers both.
 */
export const PLUGIN_STORE_FIXTURE_BARE: RigPluginCatalogEntry = {
    id: "lantern",
    name: "Lantern",
    description:
        "Follows a build as it streams and keeps the first failure rather than the last thousand lines.",
    state: "running",
    glyph: "package",
    tone: "mint",
    author: "Rowan Iyer",
    category: "Developer tools",
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
    artworkUrl: ARTWORK_CHEVRON,
    author: "Aoife Kelleher",
    category: "Productivity",
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
    glyph: "alert",
    tone: "ember",
    author: "Happy",
    category: "Data",
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
    artworkUrl: ARTWORK_BARS,
    author: "a-publisher-with-an-unreasonably-long-handle",
    category: "Collaboration",
    version: "0.0.1-alpha.7+build.20260318",
    facts: [
        {
            label: "Installed at",
            value: "~/.happy/plugins/annotate-every-single-changed-line-in-a-review",
            monospace: true,
        },
    ],
};

/**
 * A package whose every string is one unbroken token: the kind of note a module
 * loader actually produces, and the kind of path a nested checkout actually has.
 * There is nowhere for a line to break, which is what proves the card breaks it
 * anyway instead of growing wider than its column.
 */
export const PLUGIN_STORE_FIXTURE_UNBROKEN: RigPluginCatalogEntry = {
    id: "quarry",
    name: "quarry-workspace-indexer-daemon-supervisor",
    description:
        "file:///Users/someone/Development/checkouts/monorepo/packages/quarry-workspace-indexer-daemon-supervisor/dist/index.js",
    state: "failed",
    glyph: "alert",
    tone: "amber",
    author: "quarry-workspace-tools",
    category: "Utilities",
    version: "3.0.0",
    note: "Error: Cannot find module '/Users/someone/Development/checkouts/monorepo/packages/quarry-workspace-indexer-daemon-supervisor/node_modules/.pnpm/registry.example.com+quarry-core@3.0.0/dist/runtime/bootstrap.js'",
    contributions: ["QuarryWorkspaceIndexerDaemonSupervisorDiagnosticsAndTelemetryOverview"],
    facts: [
        {
            label: "Installed at",
            value: "/Users/someone/Development/checkouts/monorepo/packages/quarry-workspace-indexer-daemon-supervisor",
            monospace: true,
        },
    ],
};

/**
 * A package whose mark is addressable and does not draw. The host checks the
 * bytes it fetched against the media type and length the catalog declared, so
 * this is the residue: something that passed those checks and still will not
 * decode. The card must fall back to its generated mark rather than leave a
 * broken image where the package's identity should be.
 */
export const PLUGIN_STORE_FIXTURE_UNDRAWABLE: RigPluginCatalogEntry = {
    id: "sundial",
    name: "Sundial",
    description: "Keeps a session's elapsed work beside its transcript rather than in a log.",
    state: "running",
    glyph: "package",
    tone: "ocean",
    artworkUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    author: "Marta Oyelaran",
    category: "Productivity",
    version: "1.2.0",
    facts: [{ label: "Folder", value: "sundial", monospace: true }],
};

/**
 * The same package after its mark changed. Rig names a mark by the hash of its
 * bytes, so a replaced icon is a different address and nothing else about the
 * package moves: this is the pair to compare a generation update against.
 */
export const PLUGIN_STORE_FIXTURE_REGENERATED: RigPluginCatalogEntry = {
    ...PLUGIN_STORE_FIXTURE_COMPLETE,
    artworkUrl: ARTWORK_CHEVRON,
};

/** The shelves as the workbench shows them, in the page's own reading order. */
export const PLUGIN_STORE_FIXTURE_CATALOG: readonly RigPluginCatalogEntry[] = [
    PLUGIN_STORE_FIXTURE_FAILED,
    PLUGIN_STORE_FIXTURE_UNBROKEN,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_OVERLONG,
    PLUGIN_STORE_FIXTURE_STOPPED,
];

/** Folders a machine found where a plugin should be and could not read as one. */
export const PLUGIN_STORE_FIXTURE_FAILURES: readonly RigPluginCatalogFailure[] = [
    { folder: "hello-world", error: "happy.plugin.json is invalid. /entry: Unexpected property" },
];
