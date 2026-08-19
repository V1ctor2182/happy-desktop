import type { RigHistoryDocument, RigHistoryPersistence } from "happy-desktop-app";

const HISTORY_KEY = "happy2.router-history.v1";

/**
 * Where this window's navigation stack is kept between runs, so reopening the
 * app — or reloading it during development — lands back on the conversation the
 * reader was in rather than at the beginning.
 *
 * What comes back is whatever is under that key: written by an older build,
 * truncated by a failed write, or edited by hand. It is handed over as `unknown`
 * and parsed into places by the window that owns the stack; a record that does
 * not hold up costs the reader their position and nothing else.
 */
export function desktopHistoryPersistence(): RigHistoryPersistence {
    return {
        read(): unknown {
            try {
                const value = localStorage.getItem(HISTORY_KEY);
                return value === null ? undefined : (JSON.parse(value) as unknown);
            } catch {
                return undefined;
            }
        },
        write(document: RigHistoryDocument) {
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(document));
            } catch {
                // A storage-denied renderer still navigates; it simply opens at
                // its default address next time.
            }
        },
    };
}
