import { ghosttyEmulatorCreate, type TerminalEmulator } from "happy2-app";
import type { TerminalGridSnapshot } from "happy2-state";
import type { LocalOnboardingView } from "happy2-ui";
import type {
    HappyDesktopBridge,
    LocalOnboardingCloudChoice,
    LocalOnboardingSnapshot,
} from "../shared/desktopContract";

export interface LocalOnboardingViewSnapshot {
    readonly onboarding?: LocalOnboardingSnapshot;
    /** The install terminal's current screen, once any output has arrived. */
    readonly terminal?: TerminalGridSnapshot;
    /** True while a request this window made is still in flight. */
    readonly pending: boolean;
    /** Why the last request could not be delivered, until another is made. */
    readonly failure?: string;
}

export interface LocalOnboardingStore {
    get(): LocalOnboardingViewSnapshot;
    subscribe(listener: () => void): () => void;
    rigInstall(): void;
    terminalInput(data: string): void;
    terminalResize(cols: number, rows: number): void;
    connectRetry(): void;
    cloudSubmit(choice: LocalOnboardingCloudChoice): void;
    profileSubmit(request: boolean): void;
    projectChoose(): void;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * The window's view of first-run setup: one coarse bridge subscription for the
 * durable stage, plus a local VT emulator that turns the install PTY's bytes
 * into the same normalized grid every other terminal in Happy renders.
 *
 * Nothing here decides anything. The stage, the install process, the folder
 * picker, and the daemon all belong to the main process; this store forwards
 * intent and keeps the screen current. What it does own is this window's side of
 * a request: an operation the shell refused is reported on screen rather than
 * dropped, and the emulator is a real resource with a lifetime — it belongs to
 * one install terminal and is released with it.
 */
export function localOnboardingStoreCreate(
    bridge: HappyDesktopBridge,
    emulatorCreate: (
        cols: number,
        rows: number,
    ) => Promise<TerminalEmulator> = ghosttyEmulatorCreate,
): LocalOnboardingStore {
    const listeners = new Set<() => void>();
    const encoder = new TextEncoder();
    let snapshot: LocalOnboardingViewSnapshot = { pending: false };
    let bridgeUnsubscribe: (() => void) | undefined;
    let installUnsubscribe: (() => void) | undefined;
    let emulator: TerminalEmulator | undefined;
    let emulatorPending: Promise<TerminalEmulator> | undefined;
    let emulatorTerminalId: string | undefined;
    /** Bumped by every release, so a creation in flight knows it was let go. */
    let emulatorGeneration = 0;
    let size = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
    let eventReceived = false;
    let inFlight = 0;

    const publish = (next: LocalOnboardingViewSnapshot) => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const terminalId = () => snapshot.onboarding?.install?.terminalId;
    /**
     * Lets go of the emulator and the screen it was showing. A terminal that has
     * ended is not one this window keeps a WebAssembly emulator alive for, and
     * the transcript belongs to that install rather than to the next one.
     */
    const emulatorRelease = () => {
        emulatorGeneration += 1;
        const live = emulator;
        emulator = undefined;
        emulatorPending = undefined;
        emulatorTerminalId = undefined;
        live?.dispose();
    };
    /**
     * The install terminal is on screen only while an install is running or has
     * failed, and only for the terminal the shell is currently reporting. Any
     * other stage — installed, connecting, or setup moving on — ends its
     * lifetime, and the transcript is deliberately kept for a failure alone,
     * which is the one case someone still needs to read.
     */
    const onboardingSet = (next: LocalOnboardingSnapshot) => {
        if (Object.is(snapshot.onboarding, next)) return;
        const shows = next.stage === "rigInstalling" || next.stage === "rigInstallFailed";
        const ended =
            emulatorTerminalId !== undefined &&
            (!shows || emulatorTerminalId !== next.install?.terminalId);
        if (ended) emulatorRelease();
        publish({
            ...snapshot,
            ...(ended ? { terminal: undefined } : {}),
            onboarding: next,
        });
    };
    const emulatorEnsure = (id: string): Promise<TerminalEmulator> => {
        emulatorTerminalId = id;
        const generation = emulatorGeneration;
        emulatorPending ??= emulatorCreate(size.cols, size.rows).then((created) => {
            // Released while it was being built: this emulator belongs to a
            // terminal that is gone, so it is disposed here rather than stored
            // and disposed by nobody.
            if (generation !== emulatorGeneration) {
                created.dispose();
                throw new Error("The installation terminal was released.");
            }
            emulator = created;
            return created;
        });
        return emulatorPending;
    };
    const outputWrite = (id: string, data: string) => {
        const pending = emulatorEnsure(id);
        void pending
            .then((live) => {
                // The install ended and the emulator was released while this
                // frame was in flight; writing into it would resurrect a dead
                // screen.
                if (emulatorPending !== pending || emulatorTerminalId !== id) return;
                live.write(encoder.encode(data));
                publish({ ...snapshot, terminal: live.snapshot() });
            })
            .catch(() => undefined);
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
                installUnsubscribe = bridge.rigInstallSubscribe((event) => {
                    // The install-terminal channel carries every terminal this
                    // window opened, including the startup screen's own. Only the
                    // one setup is currently showing may write to this screen, so
                    // both output and the final event are matched against it and
                    // nothing else can contaminate the transcript.
                    if (event.terminalId !== terminalId()) return;
                    if (event.type === "output") outputWrite(event.terminalId, event.data);
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
                installUnsubscribe?.();
                installUnsubscribe = undefined;
                // Nothing is watching this screen any more, so the emulator it
                // was drawing into is released rather than kept for a window
                // that may never come back, and the frame it last produced goes
                // with it: a screen no emulator is behind is not one to show
                // again if someone comes back.
                emulatorRelease();
                publish({ ...snapshot, terminal: undefined });
            };
        },
        rigInstall() {
            attempt(
                bridge.onboardingRigInstall(size.cols, size.rows),
                "Happy could not start the installation.",
            );
        },
        terminalInput(data) {
            const id = terminalId();
            if (!id || !snapshot.onboarding?.install?.running) return;
            attempt(
                bridge.rigInstallInput(id, data),
                "Happy could not reach the installation terminal.",
            );
        },
        terminalResize(cols, rows) {
            if (size.cols === cols && size.rows === rows) return;
            size = { cols, rows };
            emulator?.resize(cols, rows);
            const id = terminalId();
            if (id && snapshot.onboarding?.install?.running)
                // A resize the shell refuses says nothing the person can act on;
                // the next keystroke or output frame reports the real state.
                void bridge.rigInstallResize(id, cols, rows).catch(() => undefined);
        },
        connectRetry() {
            attempt(bridge.runtimeRetry(), "Happy could not ask Rig to start again.");
        },
        cloudSubmit(choice) {
            attempt(
                bridge.onboardingCloudSubmit(choice),
                "Happy could not save your Happy Cloud choices.",
            );
        },
        profileSubmit(request) {
            attempt(
                bridge.onboardingProfileSubmit(request),
                "Happy could not save your Happy Profile choice.",
            );
        },
        projectChoose() {
            attempt(bridge.onboardingProjectChoose(), "Happy could not open a project.");
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
    const terminal = {
        ...(snapshot.terminal ? { grid: snapshot.terminal } : {}),
        running: onboarding.install?.running === true,
    };
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
                nodeVersion: onboarding.node?.version ?? "",
                ...(message ? { message } : {}),
            };
        case "rigInstalling":
            return { kind: "rig-installing", terminal };
        case "rigInstallFailed":
            return {
                kind: "rig-install-failed",
                message: message ?? "The installation ended without a usable rig command.",
                terminal,
            };
        case "connecting":
            return { kind: "connecting" };
        case "connectFailed":
            return {
                kind: "connect-failed",
                message: message ?? "Happy could not reach your Rig daemon.",
            };
        case "cloud":
            return { busy, kind: "cloud", ...(message ? { message } : {}) };
        case "profile":
            return { busy, kind: "profile", ...(message ? { message } : {}) };
        case "examining":
            return { kind: "examining" };
        case "project":
            return { busy, kind: "project", ...(message ? { message } : {}) };
        case "complete":
            return undefined;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
