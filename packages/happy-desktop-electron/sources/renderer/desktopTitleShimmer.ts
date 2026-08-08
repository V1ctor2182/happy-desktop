import type { TitleShimmerDocument, TitleShimmerPersistence } from "happy-desktop-state";

const TITLE_SHIMMER_KEY = "happy2.title-shimmer.v1";

/**
 * Where this installation remembers an explicit title-shimmer choice.
 *
 * No record is created by reading. The state store writes only after the reader
 * changes the setting, which leaves the product default free to change for
 * untouched installations in a later release.
 */
export function desktopTitleShimmerPersistence(): TitleShimmerPersistence {
    return {
        read() {
            try {
                const value = localStorage.getItem(TITLE_SHIMMER_KEY);
                return value ? (JSON.parse(value) as TitleShimmerDocument) : undefined;
            } catch {
                return undefined;
            }
        },
        write(document) {
            try {
                localStorage.setItem(TITLE_SHIMMER_KEY, JSON.stringify(document));
            } catch {
                // A storage-denied renderer still honours the choice for as long
                // as the window stays open.
            }
        },
    };
}
