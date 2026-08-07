import { useSyncExternalStore, type ReactNode } from "react";
import { SplashCover } from "happy-desktop-ui";
import type { DesktopRuntimeSnapshot } from "../shared/desktopContract";
import type { LocalOnboardingStore } from "./localOnboardingStore";
import type { RigDirectoryEntry, RigDirectoryStore } from "./rigDirectoryStore";
import type { DesktopRuntimeStore } from "./runtimeStore";

/**
 * Whether this window has ever finished starting up.
 *
 * A window-lifetime fact rather than component state: the mark belongs in front
 * of the very first mount and never again, so losing a Rig an hour later
 * degrades the surfaces that Rig owns instead of replacing the app with a
 * loader. Module scope is what makes that hold however the tree below remounts —
 * a flag inside a component could be reset by a remount, which is exactly the
 * case it exists to rule out.
 */
let booted = false;

/** A Rig that has said something conclusive about what it holds. */
function rigSettled(rig: RigDirectoryEntry): boolean {
    // Only a Rig that is up owes an answer about its projects. One that is
    // unreachable has already given its answer, and waiting for a catalog it
    // cannot send would hold the mark for as long as that machine stays down.
    if (rig.status !== "connected") return rig.status !== "connecting";
    return rig.projectsStatus !== "loading";
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
    rigs: readonly RigDirectoryEntry[],
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
    if (rigs.length === 0) return false;
    return rigs.every(rigSettled);
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
 * It is deliberately the one full-app loader the multirig plan allows, and only
 * that one. `booted` latches on the first complete boot, so no later disconnect,
 * reconnect, or navigation can bring it back.
 *
 * Nothing here has a timeout, because nothing here waits on silence: a Rig that
 * cannot be reached resolves to `disconnected` or `error` on its own and counts
 * as settled, so the window opens onto a truthful failure rather than being held
 * by a machine that is never going to answer.
 */
export function DesktopBootGate(props: {
    children: ReactNode;
    onboarding: LocalOnboardingStore;
    rigs: RigDirectoryStore;
    runtime: DesktopRuntimeStore;
}) {
    const runtime = useSyncExternalStore(
        props.runtime.subscribe,
        props.runtime.get,
        props.runtime.get,
    );
    const directory = useSyncExternalStore(props.rigs.subscribe, props.rigs.get, props.rigs.get);
    const setup = useSyncExternalStore(
        props.onboarding.subscribe,
        props.onboarding.get,
        props.onboarding.get,
    );
    if (booted) return <>{props.children}</>;
    const ready = bootReady(runtime, directory.rigs, setup.onboarding !== undefined);
    if (ready) booted = true;
    return <SplashCover ready={ready}>{props.children}</SplashCover>;
}
