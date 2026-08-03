import { useState, type CSSProperties, type ReactNode } from "react";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { SegmentedControl } from "../../SegmentedControl";
import { TextField } from "../../TextField";
import { Toolbar } from "../../Toolbar";
import {
    PluginStoreCard,
    type PluginStoreEntry,
    type PluginStoreState,
} from "../../PluginStoreCard";
import { PluginStoreDetail, type PluginStoreFact } from "../../PluginStoreDetail";
import { PluginStoreSection } from "../../PluginStoreSection";

/**
 * One plugin package as this machine knows it, ready to render.
 *
 * It is the card's entry plus the two things only the package's own page shows:
 * what it contributes, and the ledger of facts about the copy that is here.
 * Whoever owns the catalog formats every string, so this surface holds no clock
 * and no path handling.
 */
export interface RigPluginCatalogEntry extends PluginStoreEntry {
    /** The sidebar destinations this package contributes, by their labels. */
    readonly contributions?: readonly string[];
    readonly facts?: readonly PluginStoreFact[];
}

/** A folder this machine found where a package should be and could not read. */
export interface RigPluginCatalogFailure {
    readonly folder: string;
    readonly error: string;
}

export interface RigPluginCatalogPageProps {
    /** Every package installed on this machine, in the order they should be read. */
    entries: readonly RigPluginCatalogEntry[];
    /** Folders that are not packages yet, reported beside the shelves rather than on one. */
    failures?: readonly RigPluginCatalogFailure[];
    /** True before the first catalog arrives, so "nothing installed" is not claimed early. */
    loading?: boolean;
    /** The catalog itself could not be read; it replaces the shelves. */
    error?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Which packages a filter admits, and what its tab is called. */
type CatalogFilter = "all" | PluginStoreState;

const FILTER_LABELS: Record<CatalogFilter, string> = {
    all: "All",
    running: "Running",
    stopped: "Off",
    failed: "Failed",
};

/** The shelves, in reading order: what wants attention first, then the rest. */
const SHELVES: readonly {
    readonly state: PluginStoreState;
    readonly title: string;
    readonly subtitle: string;
}[] = [
    {
        state: "failed",
        title: "Needs attention",
        subtitle: "Installed, but its code could not be started.",
    },
    {
        state: "running",
        title: "Running",
        subtitle: "Installed and up, contributing whatever it offers Happy.",
    },
    {
        state: "stopped",
        title: "Off",
        subtitle: "Installed and not running, so it contributes nothing right now.",
    },
];

/**
 * RigPluginCatalogPage — the plugins this machine has, offered as a catalog.
 *
 * It is a store rather than a settings table. A package is a card with a mark
 * you can recognize at a glance, its name in the bright weight, one line of what
 * it is for, and the small print — who publishes it, what shelf it is on, which
 * version is here — under that. Cards wrap into as many columns as the surface
 * can hold, and they are grouped onto shelves by what each package is doing, so
 * the shape of the machine reads as headings rather than as a column of badges
 * to compare.
 *
 * Choosing a card gives the surface to that package's own page, the way a store
 * opens a product. The search box and the shelf filter belong to the catalog and
 * are gone while a package is open; the way back is the first control on it.
 *
 * Every card and every package page keep a declared action lane. Installing,
 * updating, and removing a package are not this screen's to perform and exist
 * nowhere behind it yet, so the lane stays empty rather than being filled with
 * controls that would do nothing. When those actions exist they land in that
 * lane and nothing else here changes.
 *
 * The search term, the filter, and the open package are this surface's own view
 * state and live nowhere else: none of them is worth a URL, and all of them are
 * forgotten when the screen closes.
 */
export function RigPluginCatalogPage(props: RigPluginCatalogPageProps) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<CatalogFilter>("all");
    const [chosenId, setChosenId] = useState<string | undefined>(undefined);
    /*
     * The package a reader just backed out of. Its card takes the focus as it
     * mounts, so leaving a package returns the reader to where they were in the
     * catalog rather than to the top of the page.
     */
    const [returnFocusId, setReturnFocusId] = useState<string | undefined>(undefined);

    const entries = props.entries;
    const failures = props.failures ?? [];
    const counts = filterCounts(entries);
    const visible = entriesFilter(entries, filter, query);
    // Derived, not mirrored: an open package is only open while it is still in
    // the catalog, so nothing has to watch the list and a package uninstalled
    // underneath the reader cannot leave a page describing it.
    const chosen = entries.find((entry) => entry.id === chosenId);
    const searching = query.trim().length > 0;
    const subtitle = catalogSubtitle(entries, failures, props.loading);

    if (chosen)
        return (
            <CatalogFrame
                className={props.className}
                data-testid={props["data-testid"]}
                style={props.style}
                subtitle={subtitle}
                view="detail"
            >
                <PluginStoreDetail
                    entry={chosen}
                    onBack={() => {
                        setReturnFocusId(chosen.id);
                        setChosenId(undefined);
                    }}
                    {...(chosen.contributions?.length
                        ? { contributions: chosen.contributions }
                        : {})}
                    {...(chosen.facts?.length ? { facts: chosen.facts } : {})}
                />
            </CatalogFrame>
        );

    return (
        <CatalogFrame
            className={props.className}
            data-testid={props["data-testid"]}
            filters={
                <>
                    <TextField
                        aria-label="Search plugins"
                        className="happy2-rig-plugin-catalog__search"
                        leadingIcon="search"
                        onValueChange={setQuery}
                        placeholder="Search plugins"
                        size="small"
                        value={query}
                    />
                    <SegmentedControl
                        aria-label="Show which plugins"
                        onChange={(value) => setFilter(value as CatalogFilter)}
                        segments={(Object.keys(FILTER_LABELS) as CatalogFilter[]).map((value) => ({
                            value,
                            label:
                                value === "all"
                                    ? FILTER_LABELS.all
                                    : `${FILTER_LABELS[value]} ${String(counts[value])}`,
                        }))}
                        size="small"
                        value={filter}
                    />
                </>
            }
            style={props.style}
            subtitle={subtitle}
            view="catalog"
        >
            {props.error !== undefined ? (
                <EmptyState
                    description={props.error}
                    icon="package"
                    title="This machine's plugins could not be read"
                />
            ) : visible.length === 0 ? (
                <EmptyState
                    // Only the wait is illustrated. A search that matched nothing
                    // is a miss the reader is already fixing, one keystroke at a
                    // time.
                    animation={props.loading ? "snail" : undefined}
                    description={emptyDescription(props.loading, searching, query, filter)}
                    icon={props.loading ? "clock" : searching ? "search" : "package"}
                    {...(searching
                        ? { action: { label: "Clear search", onClick: () => setQuery("") } }
                        : {})}
                    title={emptyTitle(props.loading, searching)}
                />
            ) : (
                SHELVES.map((shelf) => {
                    const shelved = visible.filter((entry) => entry.state === shelf.state);
                    if (shelved.length === 0) return null;
                    return (
                        <PluginStoreSection
                            count={shelved.length}
                            key={shelf.state}
                            subtitle={shelf.subtitle}
                            title={shelf.title}
                        >
                            {shelved.map((entry) => (
                                <PluginStoreCard
                                    // Coming back from a package, this is the card
                                    // the reader was on, so it takes the focus.
                                    autoFocus={entry.id === returnFocusId}
                                    entry={entry}
                                    key={entry.id}
                                    onOpen={() => setChosenId(entry.id)}
                                />
                            ))}
                        </PluginStoreSection>
                    );
                })
            )}

            {/*
             * Folders that are not packages. They are shown whatever the filter
             * says, because a filter chooses among packages and this is the
             * machine reporting something it could not read as one at all —
             * hiding it behind a tab would lose the one message explaining why a
             * plugin a reader installed is nowhere on this page.
             */}
            {failures.length > 0 && props.error === undefined ? (
                <PluginStoreSection
                    count={failures.length}
                    subtitle="This machine found these folders where a plugin should be and could not read one."
                    title="Could not be read"
                >
                    {failures.map((failure) => (
                        <div
                            className="happy2-rig-plugin-catalog__failure"
                            data-happy2-ui="rig-plugin-catalog-failure"
                            key={failure.folder}
                        >
                            <Icon name="shield" size={16} />
                            <div className="happy2-rig-plugin-catalog__failure-text">
                                <span className="happy2-rig-plugin-catalog__failure-folder">
                                    {failure.folder}
                                </span>
                                <span className="happy2-rig-plugin-catalog__failure-error">
                                    {failure.error}
                                </span>
                            </div>
                        </div>
                    ))}
                </PluginStoreSection>
            ) : null}
        </CatalogFrame>
    );
}

/**
 * The screen around whichever of the two readings has the surface: the heading,
 * the catalog's own controls when it is the catalog, and the scrollport. The
 * scrollport spans the whole region it is given and owns no spacing; the measure
 * inside it holds the content and every gap between its parts.
 */
function CatalogFrame(props: {
    children: ReactNode;
    className?: string;
    "data-testid"?: string;
    filters?: ReactNode;
    style?: CSSProperties;
    subtitle: string;
    view: "catalog" | "detail";
}) {
    return (
        <div
            className={["happy2-rig-plugin-catalog", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-plugin-catalog"
            data-testid={props["data-testid"]}
            data-view={props.view}
            style={props.style}
        >
            {/* This toolbar heads the whole screen, so its title is the screen's
                heading and a package's own name sits under it. */}
            <Toolbar
                className="happy2-rig-plugin-catalog__header"
                height={SURFACE_HEADER_HEIGHT}
                subtitle={props.subtitle}
                title="Plugins"
                titleLevel={1}
            />
            {props.filters ? (
                <div
                    className="happy2-rig-plugin-catalog__filters"
                    data-happy2-ui="rig-plugin-catalog-filters"
                >
                    {props.filters}
                </div>
            ) : null}
            <div
                className="happy2-rig-plugin-catalog__body"
                data-happy2-ui="rig-plugin-catalog-body"
            >
                <div className="happy2-rig-plugin-catalog__measure">{props.children}</div>
            </div>
        </div>
    );
}

function emptyTitle(loading: boolean | undefined, searching: boolean): string {
    if (loading) return "Reading this machine's plugins…";
    return searching ? "Nothing matches" : "No plugins here";
}

function emptyDescription(
    loading: boolean | undefined,
    searching: boolean,
    query: string,
    filter: CatalogFilter,
): string {
    if (loading) return "Asking this machine which packages it has.";
    if (searching) return `No plugin matches “${query.trim()}”.`;
    switch (filter) {
        case "running":
            return "No plugin on this machine is running.";
        case "stopped":
            return "Every plugin on this machine is running.";
        case "failed":
            return "Every plugin on this machine started.";
        case "all":
            return "This machine has no plugins installed.";
    }
}

/** How many packages each filter would admit, which is what its tab reports. */
function filterCounts(entries: readonly RigPluginCatalogEntry[]): Record<CatalogFilter, number> {
    const counts: Record<CatalogFilter, number> = {
        all: entries.length,
        running: 0,
        stopped: 0,
        failed: 0,
    };
    for (const entry of entries) counts[entry.state] += 1;
    return counts;
}

/** The packages a filter and a search term leave, in the order they were given. */
function entriesFilter(
    entries: readonly RigPluginCatalogEntry[],
    filter: CatalogFilter,
    query: string,
): readonly RigPluginCatalogEntry[] {
    const term = query.trim().toLowerCase();
    return entries.filter((entry) => {
        if (filter !== "all" && entry.state !== filter) return false;
        if (term.length === 0) return true;
        return (
            entry.name.toLowerCase().includes(term) ||
            entry.description.toLowerCase().includes(term) ||
            (entry.author?.toLowerCase().includes(term) ?? false) ||
            (entry.category?.toLowerCase().includes(term) ?? false)
        );
    });
}

/** The header's second line: what this machine has, and what wants looking at. */
function catalogSubtitle(
    entries: readonly RigPluginCatalogEntry[],
    failures: readonly RigPluginCatalogFailure[],
    loading: boolean | undefined,
): string {
    if (entries.length === 0 && failures.length === 0)
        return loading ? "Reading…" : "Nothing installed";
    const counts = filterCounts(entries);
    const parts = [`${String(entries.length)} installed`];
    if (counts.failed > 0) parts.push(`${String(counts.failed)} failed`);
    if (counts.stopped > 0) parts.push(`${String(counts.stopped)} off`);
    if (failures.length > 0) parts.push(`${String(failures.length)} unreadable`);
    return parts.join(" · ");
}
