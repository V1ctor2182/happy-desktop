import type { HappyDesktopBridge, HappyMediaPreviewBridge } from "../shared/desktopContract";

declare global {
    const __HAPPY2_DESKTOP_PROFILE__: boolean;

    interface Window {
        happyDesktop?: HappyDesktopBridge;
        /** Present only in the window that shows one file, and never beside `happyDesktop`. */
        happyMediaPreview?: HappyMediaPreviewBridge;
    }
}

export {};
