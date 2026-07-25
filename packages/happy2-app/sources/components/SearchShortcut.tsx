import { useLayoutEffect } from "react";
import type { OverlaysStore } from "happy2-state";

export interface SearchShortcutProps {
    overlays: OverlaysStore;
}

/**
 * Binds the application-wide search shortcut and renders nothing. A window-level
 * key listener is the only way to catch the shortcut regardless of which control
 * holds focus, so this is a genuine imperative browser integration rather than
 * something a handler on a rendered element could express.
 *
 * It ignores composition and modifier combinations that belong to the focused
 * control, and it never re-opens an already open palette, so a repeated press
 * cannot discard a query the user is part-way through typing.
 */
export function SearchShortcut(props: SearchShortcutProps) {
    const overlays = props.overlays;
    // eslint-disable-next-line happy2-react/no-layout-effect -- a window-level keydown listener cannot be expressed as a handler on a rendered element
    useLayoutEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            if (event.key !== "k" && event.key !== "K") return;
            event.preventDefault();
            overlays.getState().overlaySearchOpen();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [overlays]);
    return null;
}
