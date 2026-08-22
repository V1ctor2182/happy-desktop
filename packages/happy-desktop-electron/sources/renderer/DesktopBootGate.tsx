import { useSyncExternalStore, type ReactNode } from "react";
import { SplashCover } from "happy-desktop-ui";
import type { DesktopRuntimeSnapshot } from "../shared/desktopContract";
import type { LocalOnboardingStore } from "./localOnboardingStore";
import type {
    HappyAgentDirectoryEntry,
    HappyAgentDirectoryStore,
} from "./happyAgentDirectoryStore";
import type { DesktopRuntimeStore } from "./runtimeStore";

/**
 * Whether this window has ever finished starting up.
 *
 * A window-lifetime fact rather than component state: the mark belongs in front
 * of the very first mount and never again, so losing a Happy Agent an hour later
 * degrades the surfaces that Happy Agent owns instead of replacing the app with a
 * loader. Module scope is what makes that hold however the tree below remounts —
 * a flag inside a component could be reset by a remount, which is exactly the
 * case it exists to rule out.
 */
let booted = false;

/**
 * Forgets that this window ever started, so the next mount boots as a cold one.
 *
 * The single caller is the agent restart, which discards the entire app and
 * builds it again from nothing. That is a real cold start — new stores, no
 * carried state, every Happy Agent connected from scratch — so the mark belongs in front
 * of it exactly as it belongs in front of the first one. This is not a way to
 * bring the cover back for a disconnect; a disconnect never calls it.
 */
export function desktopBootForget(): void {
    booted = false;
}

/** A Happy Agent that has said something conclusive about what it holds. */
function happyAgentSettled(happyAgent: HappyAgentDirectoryEntry): boolean {
    // Only a Happy Agent that is up owes an answer about its projects. One that is
    // unreachable has already given its answer, and waiting for a catalog it
    // cannot send would hold the mark for as long as that machine stays down.
    if (happyAgent.status !== "connected") return happyAgent.status !== "connecting";
    return happyAgent.projectsStatus !== "loading";
}

/**
 * Whether the window has something whole to show.
 *
 * Every screen before the workspace answers for itself: a machine that has to be
 * set up, a choice to make, a failure to read. Those are the window's real
 * content and the mark must get out of their way, so only the run-up to a
 * mounted workspace is covered.
 */
function bootReady(
    runtime: DesktopRuntimeSnapshot | undefined,
    happyAgents: readonly HappyAgentDirectoryEntry[],
    setupAnswered: boolean,
): boolean {
    // Nothing published yet: the main process has not even read its settings.
    if (!runtime) return false;
    // A screen someone is meant to read and act on is not a boot step.
    if (runtime.phase !== "starting" && runtime.phase !== "ready") return true;
    if (runtime.phase === "starting") return false;
    // Whether this machine still owes any setup is the main process's answer,
    // and it arrives on its own channel. Uncovering before it lands is a race
    // the machine can lose either way: quick, and the workspace mounts against a
    // machine that turns out to need setting up; slow, and setup's own first
    // screen appears after the mark has already gone.
    if (!setupAnswered) return false;
    // Connected, so the workspace is what comes next: wait for it to be worth
    // looking at rather than mounting an app around an empty sidebar.
    if (happyAgents.length === 0) return false;
    return happyAgents.every(happyAgentSettled);
}

/** Keep the one allowed initial cover honest about what the window is waiting for. */
function bootNote(runtime: DesktopRuntimeSnapshot | undefined): string | undefined {
    return runtime?.phase === "starting" ? runtime.message : undefined;
}

/**
 * Holds the window on the Happy mark for the whole run-up to a mounted
 * workspace, then dissolves the mark off it.
 *
 * It sits above every desktop screen rather than inside the router, because the
 * boot crosses several of them — reading settings, connecting, first-run setup,
 * then the workspace — and a cover mounted inside any one of them is unmounted
 * and remounted as the window moves between them. That is visible: the mark
 * leaves and a new one arrives a frame later, which is the flicker this replaces.
 * One cover, mounted once, spans all of it.
 *
 * It is deliberately the one full-app loader the multiple-happy-agents plan allows, and only
 * that one. `booted` latches on the first complete boot, so no later disconnect,
 * reconnect, or navigation can bring it back.
 *
 * Nothing here has a timeout, because nothing here waits on silence: a Happy Agent that
 * cannot be reached resolves to `disconnected` or `error` on its own and counts
 * as settled, so the window opens onto a truthful failure rather than being held
 * by a machine that is never going to answer.
 */
export function DesktopBootGate(props: {
    children: ReactNode;
    onboarding: LocalOnboardingStore;
    happyAgents: HappyAgentDirectoryStore;
    runtime: DesktopRuntimeStore;
}) {
    const runtime = useSyncExternalStore(
        props.runtime.subscribe,
        props.runtime.get,
        props.runtime.get,
    );
    const directory = useSyncExternalStore(
        props.happyAgents.subscribe,
        props.happyAgents.get,
        props.happyAgents.get,
    );
    const setup = useSyncExternalStore(
        props.onboarding.subscribe,
        props.onboarding.get,
        props.onboarding.get,
    );
    if (booted) return <>{props.children}</>;
    const ready = bootReady(runtime, directory.happyAgents, setup.onboarding !== undefined);
    if (ready) booted = true;
    return (
        <SplashCover note={bootNote(runtime)} ready={ready}>
            {props.children}
        </SplashCover>
    );
}
