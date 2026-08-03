import { useState, type CSSProperties, type ReactNode } from "react";
import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { SURFACE_HEADER_HEIGHT } from "../../InfoPanel";
import { SegmentedControl } from "../../SegmentedControl";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { Toolbar } from "../../Toolbar";
import {
    PluginStoreCard,
    type PluginStoreEntry,
    type PluginStoreState,
} from "../../PluginStoreCard";
import { PluginStoreDetail, type PluginStoreFact } from "../../PluginStoreDetail";
import { PluginStoreSection } from "../../PluginStoreSection";
import { RigPluginInstallDialog } from "../../RigPluginInstallDialog";
import { RigPluginRemoveDialog } from "../../RigPluginRemoveDialog";

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
    /**
     * The folder this machine knows the package by, shown when confirming a
     * removal so the target is unmistakable. It is a string this surface only
     * prints: nothing here reads, joins, or checks a path.
     */
    readonly folder?: string;
    /** Where a removal of this package has got to, when one has been asked for. */
    readonly removal?: RigPluginCatalogRemoval;
}

/**
 * Where one package's removal has got to, in words already chosen for a reader.
 *
 * `removed` is the machine having said so, and it stays on the card until the
 * catalog stops listing the package: what is installed is the machine's to
 * report, so a card does not vanish on this screen's say-so.
 */
export type RigPluginCatalogRemoval =
    | { readonly kind: "working" }
    | { readonly kind: "removed"; readonly message: string }
    | { readonly kind: "failed"; readonly title: string; readonly message: string };

/**
 * Where the one install this surface runs at a time has got to. Every string is
 * written by whoever owns the catalog, because only they know what the machine
 * actually answered.
 */
export type RigPluginCatalogInstall =
    | { readonly kind: "idle" }
    | { readonly kind: "working" }
    | { readonly kind: "installed"; readonly title: string; readonly message: string }
    | { readonly kind: "failed"; readonly title: string; readonly message: string };

/**
 * What this screen may do to what is installed, present only on a surface that
 * can actually do it. A window that can read the machine and not change it is
 * given nothing here, and then no control appears anywhere on the page — rather
 * than appearing and refusing, which would be a promise this screen cannot keep.
 */
export interface RigPluginCatalogManagement {
    readonly install: RigPluginCatalogInstall;
    /** States the intent. The answer comes back as a new `install` state. */
    onInstall: (source: string) => void;
    /** Puts the last install's answer away, which is also how the next one starts. */
    onInstallDismiss: () => void;
    onRemove: (id: string) => void;
    onRemoveDismiss: (id: string) => void;
    /**
     * The machine's own folder chooser, where the host has one. Without it the
     * dialog's field is the only way in, which is a complete way in.
     */
    onFolderPick?: () => Promise<string | undefined>;
}

/** A folder this machine found where a package should be and could not read. */
export interface RigPluginCatalogFailure {
    readonly folder: string;
    readonly error: string;
}

/**
 * Where the reading itself is. It is the difference between "this machine has no
 * plugins" and "nobody has been able to ask it lately", which are the same empty
 * shelf and are not the same fact.
 */
export type RigPluginCatalogFeedState = "connecting" | "live" | "reconnecting" | "closed";

export interface RigPluginCatalogPageProps {
    /** Every package installed on this machine, in the order they should be read. */
    entries: readonly RigPluginCatalogEntry[];
    /** Folders that are not packages yet, reported beside the shelves rather than on one. */
    failures?: readonly RigPluginCatalogFailure[];
    /** True before the first catalog arrives, so "nothing installed" is not claimed early. */
    loading?: boolean;
    /**
     * Where the reading is. Anything but `live` means what is on screen is the
     * last thing this machine said rather than what it is saying, which the page
     * states plainly instead of letting the counts imply otherwise.
     */
    connection?: RigPluginCatalogFeedState;
    /**
     * Why the reading failed, in words for a reader. It never removes packages:
     * with something already read it is said above the shelves, and it stands in
     * for them only when there is nothing to stand in front of.
     */
    error?: string;
    /**
     * Installing, updating, and removing, when this surface can do them. Absent
     * leaves the page exactly the catalog it was: every action lane stays empty
     * and nothing on screen offers a change it could not make.
     */
    manage?: RigPluginCatalogManagement;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Which packages a filter admits, and what its tab is called. */
type CatalogFilter = "all" | PluginStoreState;

/** What a surface with no way to install anything is standing in for. */
const IDLE_INSTALL: RigPluginCatalogInstall = { kind: "idle" };

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
 * Installing, updating, and removing land in the action lanes the card and the
 * package page already declared. They appear only when this surface was given a
 * way to perform them, so a window that can read the machine and not change it
 * shows the same catalog with no controls rather than controls that refuse.
 *
 * This screen performs none of them itself and claims none of them finished. It
 * states an intent, the machine answers, and the catalog — which is the machine
 * speaking — decides what is installed. That is why a removed package keeps its
 * card, marked, until the reading stops listing it: the alternative is a screen
 * that hides a package on its own authority and is wrong whenever the machine
 * disagrees. For the same reason nothing here says an update is available: the
 * machine reports no such thing, so updating is offered as installing the folder
 * a package came from, and the machine says afterwards what that turned out to
 * be.
 *
 * The search term, the filter, the open package, and which dialog is open are
 * this surface's own view state and live nowhere else: none of them is worth a
 * URL, and all of them are forgotten when the screen closes.
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
    /*
     * Whether the install dialog is being shown, and which package it was opened
     * from when it was opened from one. The subject changes only what the dialog
     * says: there is one install, and the folder decides what it turns out to be.
     */
    const [installOpen, setInstallOpen] = useState(false);
    const [installSubject, setInstallSubject] = useState<string | undefined>(undefined);
    /*
     * The package a removal is being confirmed for, and whether the machine has
     * already been asked. `requested` is what makes the confirmation disappear
     * once the machine says the package is gone, and is also what stops the same
     * folder — installed again later, and so the same identity — from finding an
     * old confirmation still open on it.
     */
    const [remove, setRemove] = useState<{ readonly id: string; readonly requested: boolean }>();

    /*
     * Search and filter are the reader deciding where to look, so either one
     * disarms the pending focus: the card it named may not even be on screen
     * after it, and moving the focus back to it would undo the move they just
     * made. `search` and `filterUse` are the only ways the two are set.
     */
    const search = (value: string): void => {
        setQuery(value);
        setReturnFocusId(undefined);
    };
    const filterUse = (value: CatalogFilter): void => {
        setFilter(value);
        setReturnFocusId(undefined);
    };

    const manage = props.manage;
    const install = manage?.install ?? IDLE_INSTALL;

    /*
     * Opening the install dialog clears whatever the last install answered
     * first, because that answer is about the last folder and would otherwise
     * greet the next one. The dialog is shown while `installOpen` holds and the
     * machine has not said it installed something: a success closes it, and what
     * the machine said is then reported on the page a reader is actually on.
     */
    const installOpenFor = (subject: string | undefined): void => {
        if (!manage) return;
        if (install.kind === "installed" || install.kind === "failed") manage.onInstallDismiss();
        setInstallSubject(subject);
        setInstallOpen(true);
    };
    const installClose = (): void => {
        setInstallOpen(false);
        setInstallSubject(undefined);
        if (manage && install.kind === "failed") manage.onInstallDismiss();
    };

    const entries = props.entries;
    const failures = props.failures ?? [];
    const connection = props.connection ?? "live";
    const counts = filterCounts(entries);
    const visible = entriesFilter(entries, filter, query);
    const held = entries.length > 0 || failures.length > 0;
    // A reading that is not live is the last thing this machine said. With
    // something already read that is a caption on it; with nothing read it is the
    // whole story, and the empty state tells it instead.
    const stale = connection !== "live" && !props.loading && held;
    // Derived, not mirrored: an open package is only open while it is still in
    // the catalog, so nothing has to watch the list and a package uninstalled
    // underneath the reader cannot leave a page describing it.
    const chosen = entries.find((entry) => entry.id === chosenId);
    const searching = query.trim().length > 0;
    const subtitle = catalogSubtitle(entries, failures, props.loading, connection, props.error);

    /*
     * What is wrong with the reading, said above whatever was read. It belongs to
     * the screen and not to the catalog: a package's own page is read from the
     * same subscription, so a reader who opened one is owed the same warning that
     * what they are reading has stopped changing.
     *
     * A dropped subscription uninstalls nothing, so this never removes a package.
     */
    const notice =
        stale || (props.error !== undefined && held) ? (
            <Banner
                className="happy2-rig-plugin-catalog__notice"
                icon={props.error === undefined ? "clock" : "close"}
                tone={props.error === undefined ? "neutral" : "warning"}
                title={noticeTitle(connection, props.error)}
            >
                {props.error ?? noticeDescription(connection)}
            </Banner>
        ) : null;

    /*
     * What the machine said about the last install, once it has said it. It is
     * reported on the page rather than in the dialog because by then the dialog
     * has done its job, and because what it says — installed, replaced by a newer
     * version, put back to an older one — is about the catalog the reader is now
     * looking at.
     */
    const installed =
        manage && install.kind === "installed" ? (
            <Banner
                className="happy2-rig-plugin-catalog__notice"
                data-testid="rig-plugin-catalog-installed"
                icon="check-circle"
                onDismiss={() => {
                    manage.onInstallDismiss();
                    setInstallOpen(false);
                    setInstallSubject(undefined);
                }}
                title={install.title}
                tone="success"
            >
                {install.message}
            </Banner>
        ) : null;

    /*
     * The confirmation, and the one package it is about. A confirmation only
     * exists while the catalog still lists that package: one that went while the
     * dialog was open would otherwise leave a reader confirming the removal of
     * something already gone.
     */
    const removeTarget = remove ? entries.find((entry) => entry.id === remove.id) : undefined;
    const removeVisible =
        remove !== undefined &&
        removeTarget !== undefined &&
        !(
            remove.requested &&
            (removeTarget.removal === undefined || removeTarget.removal.kind === "removed")
        );
    const removeClose = (): void => {
        if (remove && removeTarget?.removal?.kind === "failed") manage?.onRemoveDismiss(remove.id);
        setRemove(undefined);
    };

    /*
     * Both dialogs, rendered from the same expression on either reading. They
     * portal onto their own overlay, so where they sit in this tree costs
     * nothing and the two readings cannot disagree about what is open.
     */
    const dialogs =
        manage === undefined ? null : (
            <>
                {installOpen && install.kind !== "installed" ? (
                    <RigPluginInstallDialog
                        data-testid="rig-plugin-install-dialog"
                        onSubmit={manage.onInstall}
                        working={install.kind === "working"}
                        {...(install.kind === "working" ? {} : { onClose: installClose })}
                        {...(install.kind === "failed"
                            ? { failure: { message: install.message, title: install.title } }
                            : {})}
                        {...(manage.onFolderPick ? { onFolderPick: manage.onFolderPick } : {})}
                        {...(installSubject === undefined ? {} : { subject: installSubject })}
                    />
                ) : null}
                {removeVisible && removeTarget ? (
                    <RigPluginRemoveDialog
                        data-testid="rig-plugin-remove-dialog"
                        folder={removeTarget.folder ?? removeTarget.id}
                        name={removeTarget.name}
                        onConfirm={() => {
                            setRemove({ id: removeTarget.id, requested: true });
                            manage.onRemove(removeTarget.id);
                        }}
                        working={removeTarget.removal?.kind === "working"}
                        {...(removeTarget.removal?.kind === "working"
                            ? {}
                            : { onCancel: removeClose })}
                        {...(removeTarget.removal?.kind === "failed"
                            ? {
                                  failure: {
                                      message: removeTarget.removal.message,
                                      title: removeTarget.removal.title,
                                  },
                              }
                            : {})}
                        {...(removeTarget.version === undefined
                            ? {}
                            : { version: removeTarget.version })}
                    />
                ) : null}
            </>
        );

    /** One package's action lane, wherever it is drawn. */
    const entryActions = (entry: RigPluginCatalogEntry, where: "card" | "detail"): ReactNode => {
        if (!manage) return null;
        const removal = entry.removal;
        if (removal?.kind === "working")
            return (
                <span className="happy2-rig-plugin-catalog__working">
                    <Spinner tone="muted" variant="arc" />
                    <span>Removing…</span>
                </span>
            );
        if (removal?.kind === "removed")
            return (
                <span className="happy2-rig-plugin-catalog__working">
                    <Badge label="Removed" variant="neutral" />
                    {where === "detail" ? <span>{removal.message}</span> : null}
                </span>
            );
        return (
            <>
                {where === "detail" ? (
                    <Button
                        icon="package"
                        onClick={() => installOpenFor(entry.name)}
                        size="small"
                        variant="secondary"
                    >
                        Update…
                    </Button>
                ) : null}
                {/* Named on both surfaces, and named the same. A lone glyph in a
                    shelf of cards would be the one control here whose meaning a
                    reader has to be sure of before pressing it. */}
                <Button
                    icon="trash"
                    onClick={() => setRemove({ id: entry.id, requested: false })}
                    size="small"
                    variant={where === "detail" ? "danger" : "ghost"}
                >
                    {where === "detail" ? "Remove…" : "Remove"}
                </Button>
                {removal?.kind === "failed" ? (
                    <Badge icon="alert" label="Not removed" variant="warning" />
                ) : null}
            </>
        );
    };

    if (chosen)
        return (
            <CatalogFrame
                className={props.className}
                data-testid={props["data-testid"]}
                style={props.style}
                subtitle={subtitle}
                view="detail"
            >
                {/* A fixed slot: whether or not there is a notice, the detail
                    below it keeps its position, so appearing or clearing one
                    does not remount the page a reader is on. */}
                {notice}
                {installed}
                {chosen.removal?.kind === "failed" ? (
                    <Banner
                        className="happy2-rig-plugin-catalog__notice"
                        data-testid="rig-plugin-catalog-removal-failure"
                        icon="alert"
                        onDismiss={() => manage?.onRemoveDismiss(chosen.id)}
                        title={chosen.removal.title}
                        tone="danger"
                    >
                        {chosen.removal.message}
                    </Banner>
                ) : null}
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
                    {...(manage ? { actions: entryActions(chosen, "detail") } : {})}
                />
                {dialogs}
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
                        onValueChange={search}
                        placeholder="Search plugins"
                        size="small"
                        value={query}
                    />
                    <SegmentedControl
                        aria-label="Show which plugins"
                        onChange={(value) => filterUse(value as CatalogFilter)}
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
                    {manage ? (
                        <Button
                            className="happy2-rig-plugin-catalog__install"
                            data-testid="rig-plugin-catalog-install"
                            icon="plus"
                            onClick={() => installOpenFor(undefined)}
                            size="small"
                        >
                            Install plugin
                        </Button>
                    ) : null}
                </>
            }
            style={props.style}
            subtitle={subtitle}
            view="catalog"
        >
            {notice}
            {installed}

            {props.error !== undefined && !held ? (
                <EmptyState
                    description={props.error}
                    icon="close"
                    title="This machine's plugins could not be read"
                />
            ) : visible.length === 0 ? (
                <EmptyState
                    // Only the wait is illustrated. A search that matched nothing
                    // is a miss the reader is already fixing, one keystroke at a
                    // time.
                    animation={props.loading || connection === "connecting" ? "snail" : undefined}
                    description={emptyDescription(
                        props.loading,
                        searching,
                        query,
                        filter,
                        connection,
                    )}
                    icon={
                        props.loading || connection === "connecting"
                            ? "clock"
                            : searching
                              ? "search"
                              : "package"
                    }
                    {...(searching
                        ? { action: { label: "Clear search", onClick: () => search("") } }
                        : {})}
                    title={emptyTitle(props.loading, searching, connection)}
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
                                    // the reader was on, so it takes the focus —
                                    // once. Having taken it, the card says so and
                                    // the request is spent, so a later remount for
                                    // any other reason does not pull the focus back
                                    // here from wherever the reader has since gone.
                                    autoFocus={entry.id === returnFocusId}
                                    entry={entry}
                                    key={entry.id}
                                    onFocus={
                                        entry.id === returnFocusId
                                            ? () => setReturnFocusId(undefined)
                                            : undefined
                                    }
                                    onOpen={() => setChosenId(entry.id)}
                                    {...(manage ? { action: entryActions(entry, "card") } : {})}
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
            {failures.length > 0 ? (
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
                            <Icon name="close" size={16} />
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

            {dialogs}
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

/** What the notice above the shelves is called, in one line. */
function noticeTitle(connection: RigPluginCatalogFeedState, error: string | undefined): string {
    if (error !== undefined) return "This machine's plugins could not be read";
    switch (connection) {
        case "connecting":
            return "Connecting to this machine";
        case "reconnecting":
            return "Reconnecting to this machine";
        default:
            return "Not connected to this machine";
    }
}

function noticeDescription(connection: RigPluginCatalogFeedState): string {
    switch (connection) {
        case "connecting":
            return "These are the packages it last reported. The list will catch up once the connection is open.";
        case "reconnecting":
            return "These are the packages it last reported. The list will catch up on its own.";
        default:
            return "These are the packages it last reported, and they may since have changed.";
    }
}

function emptyTitle(
    loading: boolean | undefined,
    searching: boolean,
    connection: RigPluginCatalogFeedState,
): string {
    if (loading) return "Reading this machine's plugins…";
    if (searching) return "Nothing matches";
    // Being connected to is not being connected and is certainly not being
    // empty, so an open connection nobody has answered on yet says so.
    return connection === "connecting" ? "Connecting to this machine…" : "No plugins here";
}

function emptyDescription(
    loading: boolean | undefined,
    searching: boolean,
    query: string,
    filter: CatalogFilter,
    connection: RigPluginCatalogFeedState,
): string {
    if (loading) return "Asking this machine which packages it has.";
    if (searching) return `No plugin matches “${query.trim()}”.`;
    if (connection === "connecting")
        return "Waiting for this machine to answer which packages it has.";
    if (connection !== "live")
        return "This machine has not been reachable, so nothing has been read from it yet.";
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

/**
 * The header's second line: what this machine has, and what wants looking at.
 *
 * A count is a claim about now, so a reading that is not live says so in the same
 * breath rather than letting "5 installed" stand as current while the
 * subscription is down.
 */
function catalogSubtitle(
    entries: readonly RigPluginCatalogEntry[],
    failures: readonly RigPluginCatalogFailure[],
    loading: boolean | undefined,
    connection: RigPluginCatalogFeedState,
    error: string | undefined,
): string {
    if (entries.length === 0 && failures.length === 0) {
        if (loading) return "Reading…";
        if (error !== undefined) return "Could not be read";
        switch (connection) {
            case "live":
                return "Nothing installed";
            case "connecting":
                return "Connecting…";
            default:
                return "Not connected";
        }
    }
    const counts = filterCounts(entries);
    const parts = [`${String(entries.length)} installed`];
    if (counts.failed > 0) parts.push(`${String(counts.failed)} failed`);
    if (counts.stopped > 0) parts.push(`${String(counts.stopped)} off`);
    if (failures.length > 0) parts.push(`${String(failures.length)} unreadable`);
    // A count is a claim about now. Either a feed that is not live or a feed that
    // answered with a failure makes it a claim about the last time anyone heard,
    // and it is the same qualification either way.
    if (connection === "connecting") parts.push("connecting");
    else if (connection === "reconnecting") parts.push("reconnecting");
    else if (connection !== "live" || error !== undefined) parts.push("last read");
    return parts.join(" · ");
}
