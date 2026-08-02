import type { RigPluginEntry } from "./RigPluginCatalogPage";

/*
 * A placeholder plugin catalog.
 *
 * The Rig daemon reports which *applications* a locally installed plugin
 * contributes — that is what the sidebar's plugin rows open onto — but it does
 * not yet report the packages themselves: what is installed, what version, who
 * published it, what is waiting to be updated, or what any of it is allowed to
 * do. The Plugins screen is the surface that reading belongs on, so it is built
 * against this list until the daemon can answer.
 *
 * Every package below is invented. None of these names, publishers, or versions
 * refers to anything that exists, deliberately so: a placeholder that borrowed a
 * real package's name would be mistaken for a reading of this machine. The
 * screen says as much on its own face, and every control on it reports what it
 * would do rather than doing it, so nothing here can be taken for the truth
 * about the machine it is running on.
 *
 * When the daemon reports packages, this file is deleted and the screen is handed
 * a store snapshot instead. Nothing about the screen changes but where its
 * entries come from.
 *
 * It lives here rather than beside the glue that renders it so there is one copy
 * to delete, and so the workbench and the running window show the same catalog.
 */
export const RIG_PLUGIN_CATALOG_PLACEHOLDER: readonly RigPluginEntry[] = [
    {
        id: "cartographer",
        name: "Cartographer",
        purpose: "maps a repository into a graph agents can navigate",
        summary:
            "Cartographer walks a checkout and keeps a symbol graph of it beside the working tree, so an agent asked about a function can be handed its callers and its call sites instead of searching for them. It re-walks only what changed.",
        version: "2.3.1",
        availableVersion: "2.4.0",
        state: "update",
        icon: "branch",
        origin: { publisher: "Happy", source: "Happy registry", verified: true },
        surfaces: ["Apps", "Sidebar", "Tools"],
        capabilities: ["read the working tree", "index symbols", "answer graph queries"],
        apps: ["Repository map", "Symbol search"],
        updateSummary: [
            "Indexes TypeScript project references instead of skipping them.",
            "Halves the memory a first walk of a large checkout needs.",
            "Fixes a stale graph after a branch switch that changed no files.",
        ],
        facts: [
            { label: "Installed", value: "14 March, 09:12" },
            { label: "Package size", value: "4.2 MB" },
            { label: "Runs as", value: "Bundled container" },
        ],
    },
    {
        id: "understudy",
        name: "Understudy",
        purpose: "drives a browser so an agent can check its own work",
        summary:
            "Understudy gives an agent a real browser it can open a page in, fill a form in, and read back, so a change to a web surface can be verified rather than asserted.",
        version: "1.2.9",
        availableVersion: "1.3.0",
        state: "update",
        icon: "globe",
        origin: { publisher: "Happy", source: "Happy registry", verified: true },
        surfaces: ["Apps", "Tools"],
        capabilities: ["open a page", "fill a form", "capture a screenshot"],
        apps: ["Browser session"],
        updateSummary: [
            "Waits for fonts before capturing, which stops a blurred first screenshot.",
            "Adds a device scale option so a capture can be taken at 2×.",
        ],
        facts: [
            { label: "Installed", value: "19 February, 13:27" },
            { label: "Package size", value: "88.4 MB" },
            { label: "Runs as", value: "Bundled container" },
        ],
    },
    {
        id: "lantern",
        name: "Lantern",
        purpose: "watches a long build and says what broke",
        summary:
            "Lantern follows a build or test run as it streams, keeps the first failure rather than the last thousand lines, and offers the agent a short reading of what went wrong instead of the whole log.",
        version: "0.9.4",
        state: "attention",
        attention:
            "Lantern stopped four minutes into its last run and has not restarted. Its log ends mid-write, which usually means the machine ran out of disk.",
        icon: "zap",
        origin: { publisher: "Happy", source: "Happy registry", verified: true },
        surfaces: ["Chat menu", "Tools"],
        capabilities: ["follow a process", "read build output", "summarise a failure"],
        facts: [
            { label: "Installed", value: "2 February, 16:40" },
            { label: "Package size", value: "1.1 MB" },
            { label: "Last started", value: "Today, 11:58" },
        ],
    },
    {
        id: "ledger",
        name: "Ledger",
        purpose: "keeps a running account of what each session cost",
        summary:
            "Ledger records the tokens and wall time every session spends and totals them per project, so a week's work has a number beside it rather than an impression.",
        version: "1.7.0",
        state: "installed",
        icon: "doc",
        origin: { publisher: "Happy", source: "Happy registry", verified: true },
        surfaces: ["Apps", "Profile section"],
        capabilities: ["read session totals", "write a monthly summary"],
        apps: ["Spending"],
        facts: [
            { label: "Installed", value: "8 January, 10:03" },
            { label: "Package size", value: "820 KB" },
            { label: "Runs as", value: "Bundled container" },
        ],
    },
    {
        id: "quarry",
        name: "Quarry",
        purpose: "answers questions from a folder of documents",
        summary:
            "Quarry keeps an index of whatever documents it is pointed at and answers from them with citations, so an agent working against a specification quotes the specification rather than remembering it.",
        version: "3.0.2",
        state: "installed",
        icon: "search",
        origin: { publisher: "westbourne-labs", source: "GitHub · westbourne-labs/quarry" },
        surfaces: ["Apps", "Tools"],
        capabilities: ["read a document folder", "index text", "answer with citations"],
        apps: ["Document index"],
        facts: [
            { label: "Installed", value: "27 February, 08:19" },
            { label: "Package size", value: "11.6 MB" },
            { label: "Runs as", value: "Selected container" },
        ],
    },
    {
        id: "postmark",
        name: "Postmark",
        purpose: "sends a session's outcome to a channel",
        summary:
            "Postmark posts what a session finished with to somewhere a person will see it, so a long run does not need to be watched.",
        version: "0.4.1",
        state: "disabled",
        icon: "send",
        origin: { publisher: "aoife-kelleher", source: "GitHub · aoife-kelleher/postmark" },
        surfaces: ["Chat menu"],
        capabilities: ["read a session outcome", "post to a channel"],
        facts: [
            { label: "Installed", value: "3 December, 21:44" },
            { label: "Package size", value: "310 KB" },
            { label: "Turned off", value: "11 March, 09:02" },
        ],
    },
    {
        id: "millstone",
        name: "Millstone",
        purpose: "runs a migration against a scratch copy of a database first",
        summary:
            "Millstone takes a migration, applies it to a throwaway copy of the schema, and reports what it did to the data before anything touches the real one.",
        version: "2.1.0",
        state: "available",
        icon: "shield",
        origin: { publisher: "Happy", source: "Happy registry", verified: true },
        surfaces: ["Apps", "Tools"],
        capabilities: ["copy a schema", "apply a migration", "compare two schemas"],
        apps: ["Migration preview"],
        facts: [
            { label: "Package size", value: "6.9 MB" },
            { label: "Runs as", value: "Bundled container" },
        ],
    },
    {
        id: "sightline",
        name: "Sightline",
        purpose: "keeps a channel's decisions where the next session can find them",
        summary:
            "Sightline reads what a channel settled on and writes it into one document per project, so a session starting next week is handed the decision rather than the argument.",
        version: "1.0.3",
        state: "available",
        icon: "chat",
        origin: { publisher: "orla-devane", source: "GitHub · orla-devane/sightline" },
        surfaces: ["Apps", "Message menu"],
        capabilities: ["read a channel", "write a document"],
        apps: ["Decisions"],
        facts: [
            { label: "Package size", value: "1.9 MB" },
            { label: "Runs as", value: "Bundled container" },
        ],
    },
    {
        id: "annotate-every-single-changed-line",
        name: "Annotate Every Single Changed Line In A Review",
        purpose:
            "leaves a note on each line a change touches, however many that is, which is the longest purpose line this catalog has to set without letting it push the state column off the row",
        summary:
            "A deliberately over-named package with over-long metadata, here to prove that a name and a purpose far beyond any reasonable length still ellipsize inside the row and leave the version, the state, and the margin mark exactly where they are on every other row.",
        version: "0.0.1-alpha.7+build.20260318",
        state: "available",
        icon: "edit",
        origin: {
            publisher: "a-publisher-with-an-unreasonably-long-handle",
            source: "GitHub · a-publisher-with-an-unreasonably-long-handle/annotate-every-single-changed-line-in-a-review",
        },
        surfaces: ["Message menu", "Composer button", "Chat menu", "Tools", "Profile section"],
        capabilities: [
            "read a diff",
            "write a review comment",
            "read a repository",
            "read a session transcript",
        ],
        facts: [
            { label: "Package size", value: "just under two hundred and forty megabytes" },
            { label: "Runs as", value: "A container that has to be selected before it can start" },
        ],
    },
];
