import { useRef, useState, type CSSProperties } from "react";
import { Badge } from "../../Badge";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Icon, type IconName } from "../../Icon";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { SegmentedControl } from "../../SegmentedControl";
import { TextField } from "../../TextField";
import { Toolbar } from "../../Toolbar";

/**
 * Where a plugin stands on this machine. These are the five answers the catalog
 * sorts by, and every row is in exactly one of them.
 */
export type RigPluginState = "update" | "attention" | "installed" | "disabled" | "available";

/** Where a package came from, which is the whole of what trust means here. */
export interface RigPluginOrigin {
    /** Who publishes it, as they are known: "Happy", "matt-oakes", an organisation. */
    readonly publisher: string;
    /** Where the package itself is fetched from: a registry, a repository, a path. */
    readonly source: string;
    /**
     * True when the source is one this machine already trusts to run code. A
     * package from anywhere else is not accused of anything — it is simply
     * reported as unverified, which is a different sentence.
     */
    readonly verified?: boolean;
}

/** One labelled fact in a plugin's detail column. */
export interface RigPluginFact {
    readonly label: string;
    readonly value: string;
}

/**
 * One plugin package as this machine knows it. Every string arrives ready to
 * render: a date, a size, and a version are formatted by whoever owns the
 * catalog, so this surface stays deterministic and holds no clock.
 */
export interface RigPluginEntry {
    readonly id: string;
    readonly name: string;
    /** One line, sentence case, no trailing period: what it is for. */
    readonly purpose: string;
    /** A short paragraph for the detail column. */
    readonly summary: string;
    readonly version: string;
    readonly state: RigPluginState;
    readonly origin: RigPluginOrigin;
    /** The house glyph that stands for this plugin; plugins carry no artwork here. */
    readonly icon: IconName;
    /**
     * What it adds to Happy, in the product's own words — "Apps", "Sidebar",
     * "Chat menu", "Tools". These are surfaces, not permissions.
     */
    readonly surfaces: readonly string[];
    /** What it is able to do, as short lower-case phrases. */
    readonly capabilities: readonly string[];
    /** Named app destinations it contributes, which appear in the sidebar. */
    readonly apps?: readonly string[];
    /** The version waiting, set only while `state` is `update`. */
    readonly availableVersion?: string;
    /** What that update changes, one line each. */
    readonly updateSummary?: readonly string[];
    /** Why it needs looking at, set only while `state` is `attention`. */
    readonly attention?: string;
    /** Preformatted metadata rendered as the detail column's ledger. */
    readonly facts?: readonly RigPluginFact[];
}

export interface RigPluginCatalogPageProps {
    /** Every package this machine knows about, in the order they should be read. */
    entries: readonly RigPluginEntry[];
    /** True before the first catalog arrives, so "nothing installed" is not claimed early. */
    loading?: boolean;
    /** The catalog itself could not be read; it replaces the list. */
    error?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Which packages a filter admits, and what its tab is called. */
type CatalogFilter = "all" | "update" | "installed" | "disabled" | "available";

const FILTER_LABELS: Record<CatalogFilter, string> = {
    all: "All",
    update: "Updates",
    installed: "Installed",
    disabled: "Off",
    available: "Available",
};

const STATE_LABELS: Record<RigPluginState, string> = {
    update: "Update",
    attention: "Attention",
    installed: "Installed",
    disabled: "Off",
    available: "Available",
};

/**
 * An action a control here would perform, and the sentence it reports instead.
 * Naming them exhaustively is what keeps the preview honest: the copy says what
 * would happen, so nothing has to imply that it did.
 */
type PreviewAction = "install" | "update" | "updateAll" | "enable" | "disable" | "uninstall";

/** The state marked in the left margin. Everything else is left unmarked. */
const MARKED: ReadonlySet<RigPluginState> = new Set<RigPluginState>(["update", "attention"]);

/**
 * RigPluginCatalogPage — every plugin package this machine knows about, and what
 * would be done with each one.
 *
 * It is an index, not a storefront. Packages are a run of rows in one measured
 * column, told apart by the rule between them rather than by a card around each,
 * because a person opening this screen is reading a list to find one thing — not
 * being sold anything. Typography carries the hierarchy: the name, then the
 * version set in figures beside it, then the publisher and the one line that says
 * what it is for.
 *
 * State is readable down the left edge. A row that wants something — an update
 * waiting, or a plugin that stopped — carries a rule in its left margin, and a
 * row that wants nothing carries none, so the shape of the whole catalog's
 * outstanding work is one glance rather than five badges to compare. That is the
 * same reading the usage screen offers down its own left edge; the two Rig
 * screens are deliberately the same object.
 *
 * Colour says only "this one needs you": the accent for an update waiting, the
 * warning tone for a plugin that needs looking at. Installed is not green and
 * off is not red — neither is an event, and colouring them would leave nothing
 * for the two states that are.
 *
 * **Every control here reports what it would do instead of doing it.** This
 * machine has no plugin installer behind this screen yet, so installing,
 * updating, enabling, disabling, and uninstalling all open the same preview line
 * naming the exact change and stating that nothing was altered. The controls are
 * present and reachable because the screen is real; their effects are not, and
 * the screen says so rather than flipping a row and hoping. When an installer
 * exists it replaces the preview state with callbacks; nothing else here changes.
 *
 * Search, the filter, and the selected row are this surface's own view state and
 * live nowhere else: none of them is worth a URL, and all of them are forgotten
 * when the screen closes.
 */
export function RigPluginCatalogPage(props: RigPluginCatalogPageProps) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<CatalogFilter>("all");
    const [chosenId, setChosenId] = useState<string | undefined>(undefined);
    const [preview, setPreview] = useState<{ action: PreviewAction; name?: string } | undefined>(
        undefined,
    );
    /*
     * The package a reader just backed out of, so the row it belongs to can take
     * the focus back when the index returns. It is a ref rather than state because
     * nothing renders differently for it: the row that mounts under this id simply
     * claims the focus and clears it, with no second render.
     */
    const returnFocusId = useRef<string | undefined>(undefined);

    const entries = props.entries;
    const counts = filterCounts(entries);
    const visible = entriesFilter(entries, filter, query);
    // Derived, not mirrored: a chosen row is only chosen while it is on screen, so
    // no effect has to watch the list and narrowing the search never leaves a
    // detail column describing a row that is no longer above it.
    const chosen = visible.find((entry) => entry.id === chosenId);
    const searching = query.trim().length > 0;

    /*
     * A chosen row the new search or filter removes is let go for good, so
     * clearing the box cannot bring back a package the reader had already left.
     * A chosen row that survives stays chosen: typing to narrow the list beside
     * an open package should not close it. Computing the next list here, in the
     * event, is what lets both be true without an effect.
     */
    const releaseIfGone = (next: readonly RigPluginEntry[]) => {
        if (chosenId !== undefined && !next.some((entry) => entry.id === chosenId)) {
            setChosenId(undefined);
            setPreview(undefined);
        }
    };

    return (
        <div
            className={["happy2-rig-plugin-catalog", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-plugin-catalog"
            data-testid={props["data-testid"]}
            data-view={chosen ? "detail" : "index"}
            style={props.style}
        >
            <div className="happy2-rig-plugin-catalog__header">
                {/* This toolbar heads the whole screen, so its title is the screen's
                    heading and the package name and its sections sit under it. */}
                <Toolbar
                    height={SURFACE_HEADER_HEIGHT}
                    subtitle={catalogSubtitle(entries, props.loading)}
                    title="Plugins"
                    titleLevel={1}
                />
            </div>

            <div
                className="happy2-rig-plugin-catalog__filters"
                data-happy2-ui="rig-plugin-catalog-filters"
            >
                <TextField
                    aria-label="Search plugins"
                    className="happy2-rig-plugin-catalog__search"
                    leadingIcon="search"
                    onValueChange={(value) => {
                        setQuery(value);
                        releaseIfGone(entriesFilter(entries, filter, value));
                    }}
                    placeholder="Search plugins"
                    size="small"
                    value={query}
                />
                <SegmentedControl
                    aria-label="Show which plugins"
                    onChange={(value) => {
                        setFilter(value as CatalogFilter);
                        releaseIfGone(entriesFilter(entries, value as CatalogFilter, query));
                    }}
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
            </div>

            {/*
             * Two readings, stacked, and the first one never leaves. The top line
             * says what this whole screen is — invented packages, not a reading of
             * this machine — and stays there whatever is pressed. The second says
             * what the control that was just pressed would have done. An earlier
             * version put both sentences in one line and swapped between them,
             * which took the disclosure away at the one moment it matters most.
             *
             * The second line's box is always mounted, empty and zero-height when
             * there is nothing to say, because a live region has to be on the page
             * before its text changes for that change to be announced.
             */}
            <div
                className="happy2-rig-plugin-catalog__notice"
                data-happy2-ui="rig-plugin-catalog-notice"
            >
                <div className="happy2-rig-plugin-catalog__notice-line" data-tone="framing">
                    <Icon name="lock" size={14} />
                    <span
                        className="happy2-rig-plugin-catalog__notice-text"
                        data-happy2-ui="rig-plugin-catalog-notice-text"
                    >
                        Invented placeholder packages. Nothing here is read from this machine, and
                        no control on this screen changes it.
                    </span>
                    {counts.update > 0 ? (
                        <Button
                            onClick={() => setPreview({ action: "updateAll" })}
                            size="small"
                            variant="secondary"
                        >
                            {`Update ${String(counts.update)}`}
                        </Button>
                    ) : null}
                </div>
                <div
                    aria-live="polite"
                    className="happy2-rig-plugin-catalog__notice-line"
                    data-happy2-ui="rig-plugin-catalog-preview"
                    data-open={preview ? "true" : "false"}
                    data-tone="preview"
                >
                    {preview ? (
                        <>
                            <Icon name="eye" size={14} />
                            <span
                                className="happy2-rig-plugin-catalog__notice-text"
                                data-happy2-ui="rig-plugin-catalog-preview-text"
                            >
                                {previewSentence(preview.action, preview.name)}
                            </span>
                            <Button
                                onClick={(event) => {
                                    // Dismissing takes this button off the page. If it
                                    // was the focused thing, the focus would land on
                                    // the body and the next Tab would restart at the
                                    // top, so it is handed on before the button goes.
                                    previewDismissFocus(event.currentTarget);
                                    setPreview(undefined);
                                }}
                                size="small"
                                variant="ghost"
                            >
                                Dismiss
                            </Button>
                        </>
                    ) : null}
                </div>
            </div>

            <div className="happy2-rig-plugin-catalog__body">
                <div
                    className="happy2-rig-plugin-catalog__index"
                    data-happy2-ui="rig-plugin-catalog-index"
                >
                    {props.error !== undefined ? (
                        <div className="happy2-rig-plugin-catalog__index-empty">
                            <EmptyState
                                description={props.error}
                                icon="plugin"
                                size="inline"
                                title="This machine's plugins could not be read"
                            />
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="happy2-rig-plugin-catalog__index-empty">
                            <EmptyState
                                // Only the wait is illustrated. A search that
                                // matched nothing is a miss the reader is
                                // already fixing, one keystroke at a time.
                                animation={props.loading ? "snail" : undefined}
                                description={emptyDescription(
                                    props.loading,
                                    searching,
                                    query,
                                    filter,
                                )}
                                icon={props.loading ? "clock" : searching ? "search" : "plugin"}
                                size="inline"
                                {...(searching
                                    ? {
                                          action: {
                                              label: "Clear search",
                                              onClick: () => setQuery(""),
                                          },
                                      }
                                    : {})}
                                title={emptyTitle(props.loading, searching)}
                            />
                        </div>
                    ) : (
                        <ul
                            className="happy2-rig-plugin-catalog__rows"
                            data-happy2-ui="rig-plugin-catalog-rows"
                        >
                            {visible.map((entry) => (
                                <CatalogRow
                                    chosen={entry.id === chosen?.id}
                                    entry={entry}
                                    key={entry.id}
                                    onChoose={() => {
                                        setChosenId(entry.id);
                                        setPreview(undefined);
                                    }}
                                    returnFocusClaim={(id) => {
                                        if (returnFocusId.current !== id) return false;
                                        returnFocusId.current = undefined;
                                        return true;
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                <div
                    className="happy2-rig-plugin-catalog__detail"
                    data-happy2-ui="rig-plugin-catalog-detail"
                >
                    {chosen ? (
                        <CatalogDetail
                            entry={chosen}
                            onBack={() => {
                                returnFocusId.current = chosen.id;
                                setChosenId(undefined);
                            }}
                            onPreview={(action) => setPreview({ action, name: chosen.name })}
                        />
                    ) : (
                        <div className="happy2-rig-plugin-catalog__detail-empty">
                            <EmptyState
                                description="Choose one to read what it does, what it adds to Happy, and where it came from."
                                icon="plugin"
                                title="No plugin chosen"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * One package as one row: the margin rule, the glyph, the name with its version
 * beside it, and the line that says what it is for. The row is a button because
 * choosing it is the only thing it does — actions belong to the detail column, so
 * a list of twenty packages is twenty sentences rather than twenty buttons.
 */
function CatalogRow(props: {
    chosen: boolean;
    entry: RigPluginEntry;
    onChoose: () => void;
    /**
     * Asks whether this row is the one the reader backed out of, and if it is,
     * takes the request so no later render answers it again. Called once this
     * row is on the page rather than while it renders: which row wants the focus
     * is not something any row looks different for.
     */
    returnFocusClaim: (id: string) => boolean;
}) {
    const { entry } = props;
    return (
        <li className="happy2-rig-plugin-catalog__row-item">
            <button
                aria-current={props.chosen ? "true" : undefined}
                className="happy2-rig-plugin-catalog__row"
                data-happy2-ui="rig-plugin-catalog-row"
                data-marked={MARKED.has(entry.state) ? "true" : undefined}
                data-plugin={entry.id}
                data-state={entry.state}
                onClick={props.onChoose}
                ref={(element) => {
                    // Coming back from a package in the narrow window, this row is
                    // where the reader was, so it takes the focus back as it mounts.
                    if (element !== null && props.returnFocusClaim(entry.id)) element.focus();
                }}
                type="button"
            >
                <span
                    aria-hidden="true"
                    className="happy2-rig-plugin-catalog__rail"
                    data-happy2-ui="rig-plugin-catalog-rail"
                />
                <span className="happy2-rig-plugin-catalog__row-glyph">
                    <Icon name={entry.icon} size={16} />
                </span>
                <span className="happy2-rig-plugin-catalog__row-text">
                    <span className="happy2-rig-plugin-catalog__row-title">
                        <span
                            className="happy2-rig-plugin-catalog__row-name"
                            data-happy2-ui="rig-plugin-catalog-row-name"
                        >
                            {entry.name}
                        </span>
                        <span
                            className="happy2-rig-plugin-catalog__row-version"
                            data-happy2-ui="rig-plugin-catalog-row-version"
                        >
                            {entry.state === "update" && entry.availableVersion
                                ? `${entry.version} → ${entry.availableVersion}`
                                : entry.version}
                        </span>
                    </span>
                    <span
                        className="happy2-rig-plugin-catalog__row-meta"
                        data-happy2-ui="rig-plugin-catalog-row-meta"
                    >
                        {`${entry.origin.publisher} · ${entry.purpose}`}
                    </span>
                </span>
                <span className="happy2-rig-plugin-catalog__row-state">
                    {STATE_LABELS[entry.state]}
                </span>
            </button>
        </li>
    );
}

/**
 * The chosen package read in full: what it is, what an update would change, what
 * it adds to Happy, what it can do, where it came from, and the ledger of facts
 * about the copy on this machine. Its actions sit directly under the name because
 * that is the one place a decision is made about this package.
 */
function CatalogDetail(props: {
    entry: RigPluginEntry;
    onBack: () => void;
    onPreview: (action: PreviewAction) => void;
}) {
    const { entry } = props;
    return (
        <div
            className="happy2-rig-plugin-catalog__detail-scroll"
            ref={(element) => {
                /*
                 * In the narrow window, choosing a row hides the index that row
                 * lives in, which takes the focused button out of the document and
                 * leaves the focus on the body with nothing to pick it up. The
                 * column that replaced it takes it, so the next Tab carries on
                 * from the package rather than restarting at the search box.
                 *
                 * Both conditions are checked because neither alone is the case:
                 * a click that never focused anything is not a lost focus worth
                 * moving, and a hidden index in a window that still has focus
                 * somewhere real is not this situation either.
                 */
                if (element === null) return;
                const focus = element.ownerDocument.activeElement;
                const lost = focus === null || focus === element.ownerDocument.body;
                if (!lost) return;
                const index = element
                    .closest('[data-happy2-ui="rig-plugin-catalog"]')
                    ?.querySelector('[data-happy2-ui="rig-plugin-catalog-index"]');
                if (index instanceof HTMLElement && index.offsetParent === null) element.focus();
            }}
            tabIndex={-1}
        >
            <div className="happy2-rig-plugin-catalog__detail-content">
                {/* The way back out of the detail column, which exists only while
                    the column has the surface to itself. */}
                <Button
                    className="happy2-rig-plugin-catalog__back"
                    icon="arrow-right"
                    onClick={props.onBack}
                    size="small"
                    variant="ghost"
                >
                    All plugins
                </Button>

                <div className="happy2-rig-plugin-catalog__detail-head">
                    <span className="happy2-rig-plugin-catalog__detail-glyph">
                        <Icon name={entry.icon} size={20} />
                    </span>
                    <span className="happy2-rig-plugin-catalog__detail-identity">
                        <h2
                            className="happy2-rig-plugin-catalog__detail-name"
                            data-happy2-ui="rig-plugin-catalog-detail-name"
                        >
                            {entry.name}
                        </h2>
                        {/* The source belongs under "Where it came from", where it can run to
                            two lines. Here it would only repeat the publisher and then truncate. */}
                        <span className="happy2-rig-plugin-catalog__detail-origin">
                            {`${entry.origin.publisher} · ${entry.version}`}
                        </span>
                    </span>
                    <Badge
                        label={STATE_LABELS[entry.state]}
                        variant={
                            entry.state === "update"
                                ? "info"
                                : entry.state === "attention"
                                  ? "warning"
                                  : entry.state === "available"
                                    ? "outline"
                                    : "neutral"
                        }
                    />
                </div>

                <div
                    className="happy2-rig-plugin-catalog__actions"
                    data-happy2-ui="rig-plugin-catalog-actions"
                >
                    {entry.state === "available" ? (
                        <Button onClick={() => props.onPreview("install")} variant="primary">
                            Install
                        </Button>
                    ) : null}
                    {entry.state === "update" ? (
                        <Button onClick={() => props.onPreview("update")} variant="primary">
                            {entry.availableVersion
                                ? `Update to ${entry.availableVersion}`
                                : "Update"}
                        </Button>
                    ) : null}
                    {entry.state === "disabled" ? (
                        <Button onClick={() => props.onPreview("enable")} variant="secondary">
                            Turn on
                        </Button>
                    ) : null}
                    {entry.state === "installed" ||
                    entry.state === "update" ||
                    entry.state === "attention" ? (
                        <Button onClick={() => props.onPreview("disable")} variant="secondary">
                            Turn off
                        </Button>
                    ) : null}
                    {entry.state === "available" ? null : (
                        <Button onClick={() => props.onPreview("uninstall")} variant="ghost">
                            Uninstall
                        </Button>
                    )}
                </div>

                {entry.state === "attention" && entry.attention !== undefined ? (
                    <p
                        className="happy2-rig-plugin-catalog__attention"
                        data-happy2-ui="rig-plugin-catalog-attention"
                    >
                        <Icon name="shield" size={14} />
                        <span>{entry.attention}</span>
                    </p>
                ) : null}

                <p className="happy2-rig-plugin-catalog__summary">{entry.summary}</p>

                {entry.state === "update" && entry.updateSummary?.length ? (
                    <DetailSection
                        title={
                            entry.availableVersion
                                ? `What ${entry.availableVersion} changes`
                                : "What the update changes"
                        }
                    >
                        <ul
                            className="happy2-rig-plugin-catalog__changes"
                            data-happy2-ui="rig-plugin-catalog-changes"
                        >
                            {entry.updateSummary.map((line) => (
                                <li key={line}>{line}</li>
                            ))}
                        </ul>
                    </DetailSection>
                ) : null}

                <DetailSection title="What it adds to Happy">
                    <p className="happy2-rig-plugin-catalog__terms">{entry.surfaces.join(" · ")}</p>
                    {entry.apps?.length ? (
                        <p className="happy2-rig-plugin-catalog__apps">
                            {`Its apps appear beside your conversations: ${entry.apps.join(", ")}.`}
                        </p>
                    ) : null}
                </DetailSection>

                <DetailSection title="What it can do">
                    <p className="happy2-rig-plugin-catalog__terms">
                        {entry.capabilities.join(" · ")}
                    </p>
                </DetailSection>

                <DetailSection title="Where it came from">
                    <p className="happy2-rig-plugin-catalog__terms">{entry.origin.source}</p>
                    <p
                        className="happy2-rig-plugin-catalog__trust"
                        data-happy2-ui="rig-plugin-catalog-trust"
                        data-verified={entry.origin.verified ? "true" : "false"}
                    >
                        <Icon name={entry.origin.verified ? "check-circle" : "eye"} size={14} />
                        <span>
                            {entry.origin.verified
                                ? "From a source this machine already trusts to run code."
                                : "Not from a source this machine trusts yet; its code would run with whatever it is granted."}
                        </span>
                    </p>
                </DetailSection>

                {entry.facts?.length ? (
                    <DetailSection title="This copy">
                        <dl
                            className="happy2-rig-plugin-catalog__facts"
                            data-happy2-ui="rig-plugin-catalog-facts"
                        >
                            {entry.facts.map((fact) => (
                                <div className="happy2-rig-plugin-catalog__fact" key={fact.label}>
                                    <dt>{fact.label}</dt>
                                    <dd>{fact.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </DetailSection>
                ) : null}
            </div>
        </div>
    );
}

function DetailSection(props: { children: React.ReactNode; title: string }) {
    return (
        <section
            className="happy2-rig-plugin-catalog__section"
            data-happy2-ui="rig-plugin-catalog-section"
        >
            <h3 className="happy2-rig-plugin-catalog__section-title">{props.title}</h3>
            {props.children}
        </section>
    );
}

/**
 * Hands the focus on from the Dismiss button that is about to unmount, to the
 * open package if there is one and to the search box otherwise. Does nothing
 * when the button was not the focused element, because a mouse press that never
 * took the focus should not move it either.
 */
function previewDismissFocus(button: HTMLElement) {
    if (button.ownerDocument.activeElement !== button) return;
    const root = button.closest('[data-happy2-ui="rig-plugin-catalog"]');
    const next =
        root?.querySelector(".happy2-rig-plugin-catalog__detail-scroll") ??
        root?.querySelector(".happy2-rig-plugin-catalog__search input");
    if (next instanceof HTMLElement) next.focus();
}

/** What a control would have done, said plainly enough that nothing implies it happened. */
function previewSentence(action: PreviewAction, name?: string): string {
    const subject = name ?? "these plugins";
    switch (action) {
        case "install":
            return `Installing ${subject} would fetch its package and start it here. Nothing was installed.`;
        case "update":
            return `Updating ${subject} would replace its code with the newer version and restart it. Nothing was updated.`;
        case "updateAll":
            return "Updating would replace every waiting package with its newer version and restart each one. Nothing was updated.";
        case "enable":
            return `Turning ${subject} on would start it and let it contribute again. Nothing was turned on.`;
        case "disable":
            return `Turning ${subject} off would stop it and withdraw what it contributes. Nothing was turned off.`;
        case "uninstall":
            return `Uninstalling ${subject} would remove its package and everything it contributes. Nothing was removed.`;
    }
}

/** How many packages each filter would admit, which is what its tab reports. */
function filterCounts(entries: readonly RigPluginEntry[]): Record<CatalogFilter, number> {
    const counts: Record<CatalogFilter, number> = {
        all: entries.length,
        update: 0,
        installed: 0,
        disabled: 0,
        available: 0,
    };
    for (const entry of entries) {
        if (entry.state === "update") counts.update += 1;
        if (entry.state === "disabled") counts.disabled += 1;
        if (entry.state === "available") counts.available += 1;
        // Anything on this machine and running counts as installed, including the
        // ones with an update waiting or a problem to look at: they are installed,
        // and a count that excluded them would not add up to what is on screen.
        if (entry.state === "installed" || entry.state === "update" || entry.state === "attention")
            counts.installed += 1;
    }
    return counts;
}

/** The packages a filter and a search term leave, in the order they were given. */
function entriesFilter(
    entries: readonly RigPluginEntry[],
    filter: CatalogFilter,
    query: string,
): readonly RigPluginEntry[] {
    const term = query.trim().toLowerCase();
    return entries.filter((entry) => {
        if (!filterAdmits(filter, entry.state)) return false;
        if (term.length === 0) return true;
        return (
            entry.name.toLowerCase().includes(term) ||
            entry.origin.publisher.toLowerCase().includes(term) ||
            entry.purpose.toLowerCase().includes(term) ||
            entry.capabilities.some((capability) => capability.toLowerCase().includes(term))
        );
    });
}

function filterAdmits(filter: CatalogFilter, state: RigPluginState): boolean {
    if (filter === "all") return true;
    if (filter === "installed")
        return state === "installed" || state === "update" || state === "attention";
    return filter === state;
}

function emptyTitle(loading: boolean | undefined, searching: boolean): string {
    if (loading) return "Reading this machine's plugins…";
    return searching ? "Nothing matches" : "Nothing here";
}

function emptyDescription(
    loading: boolean | undefined,
    searching: boolean,
    query: string,
    filter: CatalogFilter,
): string {
    if (loading) return "Asking this machine which packages it has and what is waiting.";
    if (searching) return `No plugin matches “${query.trim()}”.`;
    switch (filter) {
        case "update":
            return "Every plugin on this machine is on its newest version.";
        case "installed":
            return "No plugin is installed on this machine yet.";
        case "disabled":
            return "Every installed plugin is turned on.";
        case "available":
            return "Nothing else is offered for this machine right now.";
        case "all":
            return "This machine has no plugins, and none are being offered.";
    }
}

/** The header's second line: what the catalog holds and what it wants. */
function catalogSubtitle(entries: readonly RigPluginEntry[], loading: boolean | undefined): string {
    if (entries.length === 0) return loading ? "Reading…" : "Nothing installed";
    const counts = filterCounts(entries);
    const installed = `${String(counts.installed)} installed`;
    const waiting: string[] = [];
    if (counts.update > 0) waiting.push(`${String(counts.update)} to update`);
    const attention = entries.filter((entry) => entry.state === "attention").length;
    if (attention > 0) waiting.push(`${String(attention)} needing attention`);
    if (counts.disabled > 0) waiting.push(`${String(counts.disabled)} off`);
    return waiting.length === 0 ? installed : `${installed} · ${waiting.join(" · ")}`;
}
