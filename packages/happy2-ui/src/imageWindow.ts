/** One picture a host can show in a window of its own. */
export interface ImageWindowRequest {
    /**
     * Where the picture is served. It is the same address the in-place viewer
     * fetches, so the window shows the revision that was opened rather than
     * whatever the path holds by the time it appears.
     */
    readonly url: string;
    /** Full workspace path, which is what the window is named after. */
    readonly path: string;
}

/**
 * Host-supplied opener for one picture shown outside the application window.
 *
 * A window is the shell's to make, so the reusable surfaces take this capability
 * instead of reaching for one. A host without separate windows — the browser
 * development server, the blueprint — supplies nothing, and the control is
 * absent rather than present and inert.
 */
export type ImageWindowOpener = (request: ImageWindowRequest) => void;
