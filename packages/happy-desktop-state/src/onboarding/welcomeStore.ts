/**
 * Whether the person has been welcomed to Happy on this machine yet.
 *
 * First-run setup derives every stage it shows from a fact it can check again —
 * whether Node is there, whether Rig is installed, whether this Rig has ever
 * been used — which is what lets an interrupted setup resume truthfully instead
 * of at a position someone remembered. The welcome is the one screen that has no
 * such fact behind it: nothing about the machine says whether its owner has read
 * a slogan. So it is deliberately kept out of that derivation and held here, as
 * a window-level choice the host stores, in the same way the sidebar arrangement
 * and the experiments switch are.
 *
 * Following the state principles, the constructor opens nothing: it reads the
 * host's record once, and writes back only when the welcome is acknowledged.
 */
export interface WelcomeDocument {
    readonly welcomeAcknowledged: boolean;
}

/**
 * Where that answer is kept. The state package never names a storage medium: the
 * host supplies one, and omitting it means the welcome is shown once per window
 * rather than once per machine.
 */
export interface WelcomePersistence {
    read(): WelcomeDocument | undefined;
    write(document: WelcomeDocument): void;
}

export interface WelcomeSnapshot {
    /** False until the person has read the welcome and asked to go on. */
    readonly welcomeAcknowledged: boolean;
}

export interface WelcomeStore {
    get(): WelcomeSnapshot;
    subscribe(listener: () => void): () => void;
    /** Records that the welcome has been read, for good, on this machine. */
    welcomeAcknowledge(): void;
}

/**
 * A stored record read back as this window's own value.
 *
 * The document comes from the host's storage, which an older version of this app
 * wrote and a person can edit by hand, so anything that is not the answer this
 * version knows is treated as no record at all — which shows the welcome again,
 * the safe way to be wrong.
 */
function documentParse(value: unknown): WelcomeDocument | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const acknowledged = (value as { welcomeAcknowledged?: unknown }).welcomeAcknowledged;
    return typeof acknowledged === "boolean" ? { welcomeAcknowledged: acknowledged } : undefined;
}

const UNWELCOMED: WelcomeSnapshot = { welcomeAcknowledged: false };

export function welcomeStoreCreate(persistence?: WelcomePersistence): WelcomeStore {
    let snapshot: WelcomeSnapshot = (() => {
        try {
            return documentParse(persistence?.read()) ?? UNWELCOMED;
        } catch {
            // Storage the host refused is a machine with no record, which is the
            // same as one whose owner has never been welcomed.
            return UNWELCOMED;
        }
    })();
    const listeners = new Set<() => void>();

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        welcomeAcknowledge() {
            if (snapshot.welcomeAcknowledged) return;
            snapshot = { welcomeAcknowledged: true };
            try {
                persistence?.write(snapshot);
            } catch {
                // A storage-denied renderer still moves this window on, so the
                // welcome is never a screen a person cannot get past.
            }
            for (const listener of listeners) listener();
        },
    };
}

/**
 * The store a host that remembers nothing stands in. It reports an unwelcomed
 * machine and never changes, so the welcome is shown and acknowledging it moves
 * nothing — which is why a real host always supplies persistence.
 */
export const welcomeStoreNoop: WelcomeStore = {
    get: () => UNWELCOMED,
    subscribe: () => () => {},
    welcomeAcknowledge: () => {},
};
