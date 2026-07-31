import { useLayoutEffect } from "react";

export interface NewSessionShortcutProps {
    /** Starts a session in the open project, exactly as the tab strip's "+" does. */
    onCreate: () => void;
}

/**
 * Binds the "new tab" shortcut — Cmd/Ctrl+T — and renders nothing. A tab here is
 * a session in the open project, so the shortcut does what the "+" beside the
 * last tab does. A window-level key listener is the only way to catch it whatever
 * holds focus, including the composer, so this is a genuine imperative browser
 * integration rather than a handler on a rendered element.
 *
 * It ignores composition and the modifier combinations that belong to the focused
 * control, and it is mounted only while a project is open, so the shortcut is
 * bound exactly when there is somewhere for the new session to go.
 */
export function NewSessionShortcut(props: NewSessionShortcutProps) {
    const onCreate = props.onCreate;
    // eslint-disable-next-line happy2-react/no-layout-effect -- a window-level keydown listener cannot be expressed as a handler on a rendered element
    useLayoutEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
            if (event.key !== "t" && event.key !== "T") return;
            event.preventDefault();
            onCreate();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onCreate]);
    return null;
}
