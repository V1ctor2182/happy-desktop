/**
 * What the surface must know about the window drawing it. macOS full screen
 * hides the traffic lights and no CSS display mode reports it, so the shell can
 * only learn it from the host; the surface reads it as an ordinary immutable
 * snapshot with a subscription, exactly like every other store it renders.
 */
export interface RigWindowSnapshot {
    /** The window fills the display and the native window controls are gone. */
    readonly fullScreen: boolean;
}

export interface RigWindowStore {
    get(): RigWindowSnapshot;
    subscribe(listener: () => void): () => void;
}

const windowed: RigWindowSnapshot = { fullScreen: false };

/** Inert windowed chrome for Blueprint fixtures, tests, and the browser shell. */
export const rigWindowStoreNoop: RigWindowStore = {
    get: () => windowed,
    subscribe: () => () => undefined,
};
