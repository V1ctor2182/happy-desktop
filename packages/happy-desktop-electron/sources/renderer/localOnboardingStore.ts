import type { LocalOnboardingView } from "happy-desktop-ui";
import type { HappyDesktopBridge, LocalOnboardingSnapshot } from "../shared/desktopContract";

export interface LocalOnboardingViewSnapshot {
    readonly onboarding?: LocalOnboardingSnapshot;
    /** True while a request this window made is still in flight. */
    readonly pending: boolean;
    /** Why the last request could not be delivered, until another is made. */
    readonly failure?: string;
    readonly profileName: string;
    readonly profileEmail: string;
}

export interface LocalOnboardingStore {
    get(): LocalOnboardingViewSnapshot;
    subscribe(listener: () => void): () => void;
    connectRetry(): void;
    daemonDownload(): void;
    projectChoose(): void;
    profileNameUpdate(value: string): void;
    profileEmailUpdate(value: string): void;
    profileCreate(): void;
}

/**
 * The window's view of first-run setup: one coarse bridge subscription for the
 * durable stage.
 *
 * Nothing here decides anything. The stage, the install process, the folder
 * picker, and the daemon all belong to the main process; this store forwards
 * intent and keeps the screen current. What it does own is this window's side of
 * a request: an operation the shell refused is reported on screen rather than
 * dropped.
 */
export function localOnboardingStoreCreate(bridge: HappyDesktopBridge): LocalOnboardingStore {
    const listeners = new Set<() => void>();
    let snapshot: LocalOnboardingViewSnapshot = {
        pending: false,
        profileEmail: "",
        profileName: "",
    };
    let bridgeUnsubscribe: (() => void) | undefined;
    let eventReceived = false;
    let inFlight = 0;

    const publish = (next: LocalOnboardingViewSnapshot) => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const onboardingSet = (next: LocalOnboardingSnapshot) => {
        if (Object.is(snapshot.onboarding, next)) return;
        publish({
            ...snapshot,
            onboarding: next,
        });
    };
    /**
     * Sends one request and reports what happened to it. A bridge call that
     * rejects is the shell refusing — a stale window, a step that is no longer
     * current — and saying so is the only way the person is not left pressing an
     * inert button.
     */
    const attempt = (operation: Promise<unknown>, failure: string) => {
        inFlight += 1;
        publish({ ...snapshot, failure: undefined, pending: true });
        void operation.then(
            () => {
                inFlight -= 1;
                publish({ ...snapshot, pending: inFlight > 0 });
            },
            (error: unknown) => {
                inFlight -= 1;
                publish({
                    ...snapshot,
                    failure: `${failure} ${errorMessage(error)}`,
                    pending: inFlight > 0,
                });
            },
        );
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                eventReceived = false;
                bridgeUnsubscribe = bridge.onboardingSubscribe((next) => {
                    eventReceived = true;
                    onboardingSet(next);
                });
                void bridge.onboardingGet().then(
                    (initial) => {
                        if (!eventReceived) onboardingSet(initial);
                    },
                    (error: unknown) => {
                        publish({
                            ...snapshot,
                            failure: `Happy could not read the state of first-run setup. ${errorMessage(error)}`,
                        });
                    },
                );
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                bridgeUnsubscribe?.();
                bridgeUnsubscribe = undefined;
            };
        },
        connectRetry() {
            attempt(bridge.runtimeRetry(), "Happy could not ask Rig to start again.");
        },
        daemonDownload() {
            if (snapshot.pending) return;
            // Only the install is asked for here. Connecting to what it puts on
            // the machine belongs to the shell, which does it the moment the
            // agent lands rather than after a round trip back out to this
            // window — the wait for that round trip was long enough to show the
            // failure the install had already fixed.
            attempt(bridge.daemonDownload(), "Happy could not download Happy Agent.");
        },
        projectChoose() {
            attempt(bridge.onboardingProjectChoose(), "Happy could not open a project.");
        },
        profileNameUpdate(value) {
            publish({ ...snapshot, profileName: value });
        },
        profileEmailUpdate(value) {
            publish({ ...snapshot, profileEmail: value });
        },
        profileCreate() {
            if (snapshot.pending) return;
            attempt(
                bridge.onboardingProfileCreate({
                    email: snapshot.profileEmail.trim(),
                    name: snapshot.profileName.trim(),
                }),
                "Happy could not create that profile.",
            );
        },
    };
}

/** The screen this snapshot is on, or nothing once setup is finished. */
export function localOnboardingView(
    snapshot: LocalOnboardingViewSnapshot,
): LocalOnboardingView | undefined {
    const onboarding = snapshot.onboarding;
    if (!onboarding)
        return { kind: "checking", ...(snapshot.failure ? { message: snapshot.failure } : {}) };
    // What the shell reported about the step comes first; a request this window
    // could not even deliver is the fallback, so one failure is never shown as
    // if it were the other.
    const message = onboarding.message ?? snapshot.failure;
    const busy = onboarding.busy || snapshot.pending;
    switch (onboarding.stage) {
        case "inactive":
            return undefined;
        case "checking":
            return { kind: "checking", ...(message ? { message } : {}) };
        case "nodeMissing":
            return { kind: "node-missing" };
        case "rigMissing":
            return {
                kind: "rig-missing",
                ...(message ? { message } : {}),
            };
        case "daemonDownload":
            return {
                busy,
                ...(onboarding.download ? { download: onboarding.download } : {}),
                kind: "daemon-download",
                ...(message ? { message } : {}),
            };
        case "daemonStarting":
            return { kind: "agent-starting", ...(message ? { message } : {}) };
        case "connecting":
            return { kind: "connecting" };
        case "connectFailed":
            return {
                kind: "connect-failed",
                message: message ?? "Happy could not reach your Rig daemon.",
                retrying: onboarding.retrying === true,
            };
        case "providersMissing":
            return {
                kind: "providers-missing",
                providers: onboarding.providers ?? [],
                retrying: onboarding.retrying === true,
            };
        case "profileRequired":
            return {
                busy,
                email: snapshot.profileEmail,
                kind: "profile-required",
                name: snapshot.profileName,
                ...(message ? { message } : {}),
            };
        case "examining":
            return { kind: "examining" };
        case "project":
            return { busy, kind: "project", ...(message ? { message } : {}) };
        case "complete":
            return undefined;
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
