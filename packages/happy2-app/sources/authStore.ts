import type { HappyState } from "happy2-state";
import type { AuthMethods, PublicSetupPhase, PublicSetupRegistration, User } from "./server";

export type AuthMode = "loading" | "sign-in" | "onboarding" | "ready" | "unavailable";

export interface AuthSnapshot {
    readonly mode: AuthMode;
    readonly methods?: AuthMethods;
    readonly phase?: PublicSetupPhase;
    readonly registration?: PublicSetupRegistration;
    readonly user?: User;
    readonly state?: HappyState;
    readonly isRegistering: boolean;
    readonly email: string;
    readonly password: string;
    readonly firstName: string;
    readonly username: string;
    /** The development token being typed. Never persisted, in any mode. */
    readonly devToken: string;
    /** Whether the sign-in screen is showing the development-token alternative. */
    readonly usingDevToken: boolean;
    readonly error?: string;
    readonly pending: boolean;
    readonly hasBearer: boolean;
    readonly loadingMessage: string;
}

export interface AuthStore {
    get(): AuthSnapshot;
    subscribe(listener: () => void): () => void;
    authUpdate(patch: Partial<AuthSnapshot>): void;
}

const initialAuthSnapshot: AuthSnapshot = {
    mode: "loading",
    isRegistering: false,
    email: "",
    password: "",
    firstName: "",
    username: "",
    devToken: "",
    usingDevToken: false,
    pending: false,
    hasBearer: false,
    loadingMessage: "Checking the server and your saved session.",
};

/**
 * Creates the pre-product authentication store. Authentication intentionally sits
 * outside happy2-state; this store gives its gate immutable snapshots without
 * putting credentials, session bootstrap, or server capability probing in React.
 */
export function authStoreCreate(): AuthStore {
    const listeners = new Set<() => void>();
    let snapshot = initialAuthSnapshot;
    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        authUpdate(patch) {
            snapshot = { ...snapshot, ...patch };
            for (const listener of listeners) listener();
        },
    };
}
