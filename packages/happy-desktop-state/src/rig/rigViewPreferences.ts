import type { RigGroupId } from "./rigTypes.js";
import type { RigFileLayout, RigFileScope } from "./rigWorkspaceStore.js";

/**
 * How one project or worktree is being looked at, as opposed to what it holds.
 *
 * Every field here is a decision about the view rather than about the work, so
 * none of it is ever read back from a Rig: two people opening the same checkout
 * arrange it differently, and a machine has no opinion about how wide someone
 * wants their panel.
 *
 * Each field is optional because a record is written the moment any one of them
 * is chosen. A checkout whose panel has been widened but whose file listing was
 * never touched has said nothing about the listing, and must keep taking the
 * product's default rather than being pinned to whatever the default happened to
 * be on the day the panel moved.
 */
export interface RigGroupViewPreferences {
    readonly fileScope?: RigFileScope;
    readonly fileLayout?: RigFileLayout;
    /** Right panel width in CSS pixels, as the reader last left it. */
    readonly panelWidth?: number;
}

/**
 * Every checkout this window remembers the arrangement of, by group id.
 *
 * Keyed per group because that is the thing being arranged: a wide panel suits
 * the checkout whose diffs are wide, and forcing that width onto every other
 * project would make it a setting rather than a memory of what someone did here.
 */
export interface RigViewPreferencesDocument {
    readonly groups: Readonly<Record<string, RigGroupViewPreferences>>;
}

/**
 * Where those arrangements are kept. The state package never names a storage
 * medium: the host supplies one, and omitting it keeps the arrangements alive
 * for this window's lifetime only.
 */
export interface RigViewPreferencesPersistence {
    read(): RigViewPreferencesDocument | undefined;
    write(document: RigViewPreferencesDocument): void;
}

/** Wider than the widest panel and narrower than the narrowest; anything else is not a width. */
const PANEL_WIDTH_MIN = 120;
const PANEL_WIDTH_MAX = 2000;

/**
 * How many checkouts one window will remember the arrangement of. Far past the
 * number anybody has open, and small enough that a record nobody prunes stays a
 * record rather than a heap.
 */
const GROUP_MAX = 256;

function scopeParse(value: unknown): RigFileScope | undefined {
    return value === "changed" || value === "all" ? value : undefined;
}

function layoutParse(value: unknown): RigFileLayout | undefined {
    return value === "flat" || value === "tree" ? value : undefined;
}

function panelWidthParse(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const width = Math.round(value);
    return width >= PANEL_WIDTH_MIN && width <= PANEL_WIDTH_MAX ? width : undefined;
}

/**
 * One stored record read back as arrangements this version understands.
 *
 * Anything unrecognised is dropped field by field rather than record by record,
 * because these fields are independent decisions that were never written as a
 * set: a panel width this version cannot use says nothing about whether the file
 * scope beside it is still good. Dropping a field means the product's default,
 * which is always a safe thing to be wrong about.
 */
function groupParse(value: unknown): RigGroupViewPreferences | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const raw = value as Record<string, unknown>;
    const fileScope = scopeParse(raw.fileScope);
    const fileLayout = layoutParse(raw.fileLayout);
    const panelWidth = panelWidthParse(raw.panelWidth);
    if (fileScope === undefined && fileLayout === undefined && panelWidth === undefined)
        return undefined;
    return {
        ...(fileScope === undefined ? {} : { fileScope }),
        ...(fileLayout === undefined ? {} : { fileLayout }),
        ...(panelWidth === undefined ? {} : { panelWidth }),
    };
}

export function rigViewPreferencesParse(value: unknown): RigViewPreferencesDocument | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const groups = (value as { groups?: unknown }).groups;
    if (typeof groups !== "object" || groups === null) return undefined;
    const parsed: Record<string, RigGroupViewPreferences> = {};
    for (const [id, entry] of Object.entries(groups as Record<string, unknown>)) {
        const group = groupParse(entry);
        if (group) parsed[id] = group;
    }
    return { groups: parsed };
}

/**
 * The remembered arrangements with one group's changed.
 *
 * A group that now says nothing is dropped rather than kept as an empty record,
 * so a reader who puts everything back the way it started leaves no trace — and
 * the cap trims the least recently written arrangements rather than refusing to
 * record a new one, because the newest arrangement is the one somebody just made.
 */
export function rigViewPreferencesUpdate(
    document: RigViewPreferencesDocument,
    groupId: RigGroupId,
    change: RigGroupViewPreferences,
): RigViewPreferencesDocument {
    const current = document.groups[groupId] ?? {};
    const next: RigGroupViewPreferences = { ...current, ...change };
    const groups: Record<string, RigGroupViewPreferences> = { ...document.groups };
    if (
        next.fileScope === undefined &&
        next.fileLayout === undefined &&
        next.panelWidth === undefined
    )
        delete groups[groupId];
    else groups[groupId] = next;
    const ids = Object.keys(groups);
    if (ids.length > GROUP_MAX)
        for (const id of ids.slice(0, ids.length - GROUP_MAX)) delete groups[id];
    return { groups };
}

export const RIG_VIEW_PREFERENCES_EMPTY: RigViewPreferencesDocument = { groups: {} };
