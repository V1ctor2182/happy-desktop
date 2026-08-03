import type {
    RigPluginApplication,
    RigPluginApplicationSource,
    RigPluginApplicationSourceReading,
} from "happy2-state";
import type { DesktopPluginApplication, DesktopPluginCatalog } from "../shared/desktopContract";

/**
 * Adapts the desktop shell's plugin catalog to the store's source contract.
 *
 * The catalog is prepared in the main process, which is the only place that may
 * hold the daemon endpoint, its token, and a plugin's bytes. This side receives
 * identities, labels, and — for a generation whose bundle is already cached —
 * the isolated origin its view may be pointed at. Nothing here reads the daemon,
 * so the whole adapter is a subscription and a projection.
 *
 * A shell that cannot mount plugin applications supplies no bridge, and this
 * returns nothing rather than an empty feed, so the catalog is reported
 * unavailable instead of empty.
 */
export function rigPluginApplicationSourceCreate(
    desktop:
        | {
              pluginApplicationsGet(): Promise<DesktopPluginCatalog>;
              pluginApplicationsSubscribe(
                  listener: (catalog: DesktopPluginCatalog) => void,
              ): () => void;
          }
        | undefined,
): RigPluginApplicationSource | undefined {
    if (!desktop) return undefined;
    return {
        subscribe(listener, onError) {
            let closed = false;
            // One reconciler per subscription, so a row's projection keeps its
            // identity across announcements for as long as the row itself is
            // being watched.
            const reconcile = readingReconcilerCreate();
            // The shell announces changes rather than replaying the current
            // catalog, so the opening read is asked for with the listener already
            // attached. An announcement that lands while that read is in flight
            // is the newer of the two and keeps its place: the read is only
            // applied when nothing has been announced yet.
            let announced = false;
            const unsubscribe = desktop.pluginApplicationsSubscribe((catalog) => {
                if (closed) return;
                announced = true;
                listener(reconcile(catalog));
            });
            void desktop.pluginApplicationsGet().then(
                (catalog) => {
                    if (closed || announced) return;
                    listener(reconcile(catalog));
                },
                (error: unknown) => {
                    if (closed || announced) return;
                    onError(error);
                },
            );
            return () => {
                if (closed) return;
                closed = true;
                unsubscribe();
            };
        },
    };
}

/**
 * Projects each catalog the shell announces, reusing what has not changed.
 *
 * The shell re-announces its whole catalog for any change in it, so a plugin
 * finishing its bundle would otherwise hand every other application a brand new
 * object and make every row look different to React. An application is
 * identified by its id and generation together — the id is the durable
 * navigation identity, the generation is the exact code behind it — and its
 * projection is kept as long as every projected field still reads the same. The
 * list itself is kept too when no member changed and the order is the same, so
 * an unchanged catalog is the same object it was before.
 *
 * Only the fields this projection exposes are compared, because they are the
 * only ones anything above can observe.
 */
function readingReconcilerCreate(): (
    catalog: DesktopPluginCatalog,
) => RigPluginApplicationSourceReading {
    let held = new Map<string, RigPluginApplication>();
    let previous: readonly RigPluginApplication[] = [];
    return (catalog) => {
        const next = new Map<string, RigPluginApplication>();
        const applications = catalog.applications.map((application) => {
            const key = `${application.id}\u0000${application.generation}`;
            const projected = applicationProject(application);
            const kept = held.get(key);
            const value = kept && applicationSame(kept, projected) ? kept : projected;
            next.set(key, value);
            return value;
        });
        held = next;
        const unchanged =
            applications.length === previous.length &&
            applications.every((application, index) => application === previous[index]);
        if (!unchanged) previous = applications;
        return {
            applications: previous,
            connection: catalog.connection,
            loading: catalog.loading,
        };
    };
}

function applicationProject(application: DesktopPluginApplication): RigPluginApplication {
    return {
        generation: application.generation,
        id: application.id,
        label: application.label,
        order: application.order,
        pluginId: application.pluginId,
        status: application.status,
        title: application.title,
        ...(application.error === undefined ? {} : { error: application.error }),
        ...(application.source === undefined ? {} : { source: application.source }),
    };
}

function applicationSame(held: RigPluginApplication, next: RigPluginApplication): boolean {
    return (
        held.generation === next.generation &&
        held.id === next.id &&
        held.label === next.label &&
        held.order === next.order &&
        held.pluginId === next.pluginId &&
        held.status === next.status &&
        held.title === next.title &&
        held.error === next.error &&
        held.source === next.source
    );
}
