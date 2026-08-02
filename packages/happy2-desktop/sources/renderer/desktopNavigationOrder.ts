import type { RigNavigationOrderDocument, RigNavigationOrderPersistence } from "happy2-state";

const NAVIGATION_ORDER_KEY = "happy2.sidebar-order.v1";

/**
 * Where the order the reader arranged the sidebar's pinned rows in is kept on
 * this machine. It is the window's, not a Rig's: Notes and Friends are here
 * whether or not any machine is reachable, so an arrangement that lived inside a
 * connection would come undone every time one went away.
 */
export function desktopNavigationOrderPersistence(): RigNavigationOrderPersistence {
    return {
        read() {
            try {
                const value = localStorage.getItem(NAVIGATION_ORDER_KEY);
                return value ? (JSON.parse(value) as RigNavigationOrderDocument) : undefined;
            } catch {
                return undefined;
            }
        },
        write(document) {
            try {
                localStorage.setItem(NAVIGATION_ORDER_KEY, JSON.stringify(document));
            } catch {
                // A storage-denied renderer still keeps the arrangement for as
                // long as the window stays open.
            }
        },
    };
}
