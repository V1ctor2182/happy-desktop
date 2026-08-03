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
}

export interface LocalOnboardingStore {
    get(): LocalOnboardingViewSnapshot;
    subscribe(listener: () => void): () => void;
    rigInstall(): void;
    terminalInput(data: string): void;
    terminalResize(cols: number, rows: number): void;
    connectRetry(): void;
    cloudSubmit(choice: LocalOnboardingCloudChoice): void;
    profileSubmit(create: boolean): void;
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
 * intent and keeps the screen current, and the emulator's transcript survives
 * the command exiting so a failure stays readable.
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
    let snapshot: LocalOnboardingViewSnapshot = {};
    let bridgeUnsubscribe: (() => void) | undefined;
    let installUnsubscribe: (() => void) | undefined;
    let emulator: TerminalEmulator | undefined;
    let emulatorPending: Promise<TerminalEmulator> | undefined;
    let size = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
    let eventReceived = false;

    const publish = (next: LocalOnboardingViewSnapshot) => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const onboardingSet = (next: LocalOnboardingSnapshot) => {
        if (Object.is(snapshot.onboarding, next)) return;
        publish({ ...snapshot, onboarding: next });
    };
    const emulatorEnsure = (): Promise<TerminalEmulator> => {
        emulatorPending ??= emulatorCreate(size.cols, size.rows).then((created) => {
            emulator = created;
            return created;
        });
        return emulatorPending;
    };
    const outputWrite = (data: string) => {
        void emulatorEnsure().then((live) => {
            live.write(encoder.encode(data));
            publish({ ...snapshot, terminal: live.snapshot() });
        });
    };
    const terminalId = () => snapshot.onboarding?.install?.terminalId;
    const forget = (operation: Promise<unknown>) => void operation.catch(() => undefined);

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
                    if (event.type === "output") outputWrite(event.data);
                });
                void bridge.onboardingGet().then((initial) => {
                    if (!eventReceived) onboardingSet(initial);
                });
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                bridgeUnsubscribe?.();
                bridgeUnsubscribe = undefined;
                installUnsubscribe?.();
                installUnsubscribe = undefined;
            };
        },
        rigInstall() {
            forget(bridge.onboardingRigInstall(size.cols, size.rows));
        },
        terminalInput(data) {
            const id = terminalId();
            if (!id || !snapshot.onboarding?.install?.running) return;
            forget(bridge.rigInstallInput(id, data));
        },
        terminalResize(cols, rows) {
            if (size.cols === cols && size.rows === rows) return;
            size = { cols, rows };
            emulator?.resize(cols, rows);
            const id = terminalId();
            if (id && snapshot.onboarding?.install?.running)
                forget(bridge.rigInstallResize(id, cols, rows));
        },
        connectRetry() {
            forget(bridge.runtimeRetry());
        },
        cloudSubmit(choice) {
            forget(bridge.onboardingCloudSubmit(choice));
        },
        profileSubmit(create) {
            forget(bridge.onboardingProfileSubmit(create));
        },
        projectChoose() {
            forget(bridge.onboardingProjectChoose());
        },
    };
}

/** The screen this snapshot is on, or nothing once setup is finished. */
export function localOnboardingView(
    snapshot: LocalOnboardingViewSnapshot,
): LocalOnboardingView | undefined {
    const onboarding = snapshot.onboarding;
    if (!onboarding) return { kind: "checking" };
    const terminal = {
        ...(snapshot.terminal ? { grid: snapshot.terminal } : {}),
        running: onboarding.install?.running === true,
    };
    switch (onboarding.stage) {
        case "checking":
            return { kind: "checking" };
        case "nodeMissing":
            return { kind: "node-missing" };
        case "rigMissing":
            return { kind: "rig-missing", nodeVersion: onboarding.node?.version ?? "" };
        case "rigInstalling":
            return { kind: "rig-installing", terminal };
        case "rigInstallFailed":
            return {
                kind: "rig-install-failed",
                message:
                    onboarding.message ?? "The installation ended without a usable rig command.",
                terminal,
            };
        case "connecting":
            return { kind: "connecting" };
        case "connectFailed":
            return {
                kind: "connect-failed",
                message: onboarding.message ?? "Happy could not reach your Rig daemon.",
            };
        case "cloud":
            return { kind: "cloud" };
        case "profile":
            return { kind: "profile" };
        case "project":
            return {
                busy: onboarding.busy,
                kind: "project",
                ...(onboarding.message ? { message: onboarding.message } : {}),
            };
        case "complete":
            return undefined;
    }
}
