import { useSyncExternalStore } from "react";
import { ImageViewer, type ImageViewerContent } from "happy2-ui";
import type { DesktopImagePreview, HappyImagePreviewBridge } from "../shared/desktopContract";

/** The picture this window is on, as a store the shell can subscribe to. */
export interface DesktopImagePreviewStore {
    get(): DesktopImagePreview | undefined;
    subscribe(listener: () => void): () => void;
}

/**
 * Follows the picture the shell points this window at.
 *
 * The first subject is asked for once, because a window that has just opened has
 * not been sent anything yet; every later one arrives on the bridge, so pointing
 * the window at a different file replaces the picture instead of opening a
 * second window.
 */
export function desktopImagePreviewStoreCreate(
    bridge: HappyImagePreviewBridge,
): DesktopImagePreviewStore {
    let preview: DesktopImagePreview | undefined;
    const listeners = new Set<() => void>();
    const publish = (next: DesktopImagePreview | undefined): void => {
        preview = next;
        // A copy, so a listener that unsubscribes while being told is told once
        // and does not disturb the set the loop is walking.
        const current = Array.from(listeners);
        for (const listener of current) listener();
    };
    void bridge.imagePreviewGet().then(
        (initial) => {
            if (preview === undefined) publish(initial);
        },
        () => undefined,
    );
    const stop = bridge.imagePreviewSubscribe(publish);
    return {
        get: () => preview,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
    };
}

/**
 * The whole of the separate picture window: one file, at whatever size the
 * reader wants it, and nothing else.
 *
 * It renders the same `ImageViewer` the file preview and the chat lightbox use,
 * so the zooming, panning, and keyboard a reader already knows are the ones they
 * get here. The window's own title bar names the file, which is why nothing is
 * drawn above the picture.
 */
export function DesktopImagePreviewWindow(props: { store: DesktopImagePreviewStore }) {
    const preview = useSyncExternalStore(props.store.subscribe, props.store.get);
    const content: ImageViewerContent = preview
        ? { type: "url", url: preview.url }
        : { type: "loading" };
    const name = preview ? preview.path.slice(preview.path.lastIndexOf("/") + 1) : "the picture";
    return <ImageViewer autoFocus content={content} name={name} />;
}

/**
 * Closes the picture window on Escape, from anywhere in it.
 *
 * The listener is on the document rather than on a React subtree because the
 * window is one picture: wherever focus happens to be — the frame, a tool button,
 * or nothing at all — Escape means the same thing. It lives as long as the window
 * does, which is why nothing here removes it.
 */
export function desktopImagePreviewEscapeBind(bridge: HappyImagePreviewBridge): void {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        void bridge.imagePreviewClose().catch(() => undefined);
    });
}
