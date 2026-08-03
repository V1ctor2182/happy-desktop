import type {
    RigPluginCatalogSource,
    RigPluginCatalogSourceReading,
    RigPluginPackage,
    RigPluginPackageFailure,
} from "happy2-state";
import type {
    DesktopPluginInventory,
    DesktopPluginPackage,
    DesktopPluginPackageFailure,
} from "../shared/desktopContract";

/**
 * Adapts the desktop shell's plugin inventory to the catalog store's source.
 *
 * Reading the machine belongs to the main process, which is the only place that
 * may hold the daemon endpoint and its token. This side receives a finished
 * description of every installed package, already carrying the labels of what
 * each one contributes, so the whole adapter is a subscription and a projection
 * with nothing to join and nothing to fetch.
 *
 * Subscribing is also what makes the shell project the inventory at all, and the
 * opening reading arrives through the same subscription rather than through a
 * second call. There is deliberately no read-without-following: a reading taken
 * separately from the subscription would have a gap between them, and a change
 * that landed in that gap would be a frame nobody was told about.
 *
 * A package's mark arrives as bytes and leaves here as one address the document
 * can point an image at. Making that address is this side's job because it is a
 * browser resource with a lifetime: it is made once per set of bytes, shared by
 * every card drawing that package, and released when the mark is replaced,
 * the package is uninstalled, or the screen closes. Nothing above ever holds a
 * mark longer than the subscription it came from.
 *
 * A shell that cannot read the machine supplies no bridge, and this returns
 * nothing rather than an empty feed, so the inventory is reported unavailable
 * instead of reported empty.
 */
export function rigPluginCatalogSourceCreate(
    desktop:
        | {
              pluginInventorySubscribe(
                  listener: (inventory: DesktopPluginInventory) => void,
              ): () => void;
          }
        | undefined,
): RigPluginCatalogSource | undefined {
    if (!desktop) return undefined;
    return {
        subscribe(listener) {
            let closed = false;
            // One reconciler and one set of marks per subscription, so a card's
            // projection keeps its identity across announcements for as long as
            // the screen is up, and every address made for it is released with it.
            const artwork = artworkGalleryCreate();
            const reconcile = readingReconcilerCreate(artwork);
            const unsubscribe = desktop.pluginInventorySubscribe((inventory) => {
                if (closed) return;
                listener(reconcile(inventory));
            });
            return () => {
                if (closed) return;
                closed = true;
                unsubscribe();
                artwork.release();
            };
        },
    };
}

/**
 * Projects each inventory the shell announces, reusing what has not changed.
 *
 * The shell re-announces the whole inventory for any change in it, so one
 * package starting would otherwise hand every other card a brand new object and
 * make every card look different to React. A package is identified by its folder
 * name, and its projection is kept as long as every projected field still reads
 * the same. The lists themselves are kept too when no member changed and the
 * order is the same, so an unchanged inventory is the same object it was.
 */
function readingReconcilerCreate(
    artwork: ArtworkGallery,
): (inventory: DesktopPluginInventory) => RigPluginCatalogSourceReading {
    let held = new Map<string, RigPluginPackage>();
    let previousPackages: readonly RigPluginPackage[] = [];
    let previousFailures: readonly RigPluginPackageFailure[] = [];
    return (inventory) => {
        // Addresses are kept for exactly the marks this reading names, so one
        // replaced or uninstalled releases its bytes in the same turn its card
        // stops using them.
        artwork.keep(inventory.packages);
        const next = new Map<string, RigPluginPackage>();
        const packages = inventory.packages.map((entry) => {
            const projected = packageProject(entry, artwork);
            const kept = held.get(entry.id);
            const value = kept && packageSame(kept, projected) ? kept : projected;
            next.set(entry.id, value);
            return value;
        });
        held = next;
        const packagesUnchanged =
            packages.length === previousPackages.length &&
            packages.every((entry, index) => entry === previousPackages[index]);
        if (!packagesUnchanged) previousPackages = packages;
        const failuresUnchanged =
            inventory.failures.length === previousFailures.length &&
            inventory.failures.every(
                (failure, index) =>
                    failure.folder === previousFailures[index]?.folder &&
                    failure.error === previousFailures[index]?.error,
            );
        if (!failuresUnchanged) previousFailures = inventory.failures.map(failureProject);
        return {
            packages: previousPackages,
            failures: previousFailures,
            connection: inventory.connection,
            loading: inventory.loading,
            ...(inventory.error === undefined ? {} : { error: inventory.error }),
        };
    };
}

function packageProject(entry: DesktopPluginPackage, artwork: ArtworkGallery): RigPluginPackage {
    const address = entry.icon ? artwork.address(entry.icon.generation) : undefined;
    return {
        author: entry.author,
        category: entry.category,
        contributions: entry.contributions,
        dataDirectory: entry.dataDirectory,
        description: entry.description,
        directory: entry.directory,
        id: entry.id,
        logAvailable: entry.logAvailable,
        name: entry.name,
        status: entry.status,
        version: entry.version,
        ...(address === undefined ? {} : { artworkUrl: address }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
        ...(entry.statusMessage === undefined ? {} : { statusMessage: entry.statusMessage }),
    };
}

function failureProject(failure: DesktopPluginPackageFailure): RigPluginPackageFailure {
    return { error: failure.error, folder: failure.folder };
}

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

/**
 * The addresses this screen has made for package marks, one per set of bytes.
 *
 * An object URL is a document-scoped resource: it holds its bytes alive until it
 * is revoked, and nothing revokes it on its own. So each is made once, from the
 * generation that names those exact bytes, and is shared by every card drawing
 * that package rather than made per card. It is released the moment no reading
 * names its generation any more, which covers a mark being replaced and a package
 * being uninstalled with one rule, and the whole gallery is released when the
 * screen closes.
 */
interface ArtworkGallery {
    /** The address for one generation's bytes, made once and then reused. */
    address(generation: string): string | undefined;
    /** Keeps the marks this reading names and releases every other. */
    keep(packages: readonly DesktopPluginPackage[]): void;
    /** Releases every address, which is what closing the screen does. */
    release(): void;
}

function artworkGalleryCreate(): ArtworkGallery {
    const addresses = new Map<string, string>();
    let held: readonly DesktopPluginPackage[] = [];
    return {
        address(generation) {
            const known = addresses.get(generation);
            if (known !== undefined) return known;
            const entry = held.find((each) => each.icon?.generation === generation);
            if (!entry?.icon) return undefined;
            // Copied into a plain buffer rather than handed the view: a Uint8Array
            // that arrived over IPC may be a window onto a larger buffer, and a
            // Blob built from the view alone would carry that whole buffer.
            const bytes = new Uint8Array(entry.icon.bytes);
            const address = URL.createObjectURL(new Blob([bytes], { type: entry.icon.mediaType }));
            addresses.set(generation, address);
            return address;
        },
        keep(packages) {
            held = packages;
            const named = new Set<string>();
            for (const entry of packages) if (entry.icon) named.add(entry.icon.generation);
            for (const [generation, address] of addresses) {
                if (named.has(generation)) continue;
                addresses.delete(generation);
                URL.revokeObjectURL(address);
            }
        },
        release() {
            for (const address of addresses.values()) URL.revokeObjectURL(address);
            addresses.clear();
            held = [];
        },
    };
}
