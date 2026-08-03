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
            // One reconciler per subscription, so a card's projection keeps its
            // identity across announcements for as long as the screen is up.
            const reconcile = readingReconcilerCreate();
            const unsubscribe = desktop.pluginInventorySubscribe((inventory) => {
                if (closed) return;
                listener(reconcile(inventory));
            });
            return () => {
                if (closed) return;
                closed = true;
                unsubscribe();
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
function readingReconcilerCreate(): (
    inventory: DesktopPluginInventory,
) => RigPluginCatalogSourceReading {
    let held = new Map<string, RigPluginPackage>();
    let previousPackages: readonly RigPluginPackage[] = [];
    let previousFailures: readonly RigPluginPackageFailure[] = [];
    return (inventory) => {
        const next = new Map<string, RigPluginPackage>();
        const packages = inventory.packages.map((entry) => {
            const projected = packageProject(entry);
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

function packageProject(entry: DesktopPluginPackage): RigPluginPackage {
    return {
        contributions: entry.contributions,
        dataDirectory: entry.dataDirectory,
        description: entry.description,
        directory: entry.directory,
        id: entry.id,
        logAvailable: entry.logAvailable,
        name: entry.name,
        status: entry.status,
        version: entry.version,
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
