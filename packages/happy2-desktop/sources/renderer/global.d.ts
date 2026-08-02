import type { HappyDesktopBridge, HappyImagePreviewBridge } from "../shared/desktopContract";

declare global {
    interface Window {
        happyDesktop?: HappyDesktopBridge;
        /** Present only in the window that shows one picture, and never beside `happyDesktop`. */
        happyImagePreview?: HappyImagePreviewBridge;
    }
}

export {};
