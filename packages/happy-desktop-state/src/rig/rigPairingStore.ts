import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { rigUserError } from "./rigSupport.js";

/** Which side of one pairing this Rig is: it made the invitation, or it took one. */
export type RigPairingRole = "inviter" | "joiner";

/**
 * The four emojis both machines show while a pairing is being verified.
 *
 * They are derived from the key exchange, so two machines that agree on them
 * agree on who they are talking to. A person compares them by eye and answers
 * on both ends; that comparison is the whole of the trust decision, which is why
 * the tuple is fixed-length rather than a list that could arrive short.
 */
export type RigPairingEmojis = readonly [string, string, string, string];

/** The machine on the other end of a pairing, once it has identified itself. */
export interface RigPairingPeer {
    readonly instanceId: string;
    readonly name: string;
    readonly publicKey: string;
}

/**
 * Where one pairing has got to, exactly as the host Rig reports it.
 *
 * The phases are a closed progression and each one carries only what is true at
 * that point: there is no peer to name before the far machine has identified
 * itself, and no emojis to compare before the key exchange has produced them.
 * A surface therefore reads the phase and gets the fields that phase guarantees,
 * rather than checking optional fields that are only sometimes filled in.
 */
export type RigPairingState =
    | {
          readonly phase: "connecting" | "waiting";
          readonly id: string;
          readonly role: RigPairingRole;
          /** When this pairing stops being answerable, in milliseconds. */
          readonly expiresAt: number;
      }
    | {
          readonly phase: "verifying";
          readonly id: string;
          readonly role: RigPairingRole;
          readonly expiresAt: number;
          readonly emojis: RigPairingEmojis;
          readonly peer: RigPairingPeer;
      }
    | {
          readonly phase: "connected";
          readonly id: string;
          readonly role: RigPairingRole;
          readonly expiresAt: number;
          readonly peer: RigPairingPeer;
      }
    | {
          readonly phase: "expired" | "failed" | "rejected";
          readonly id: string;
          readonly role: RigPairingRole;
          readonly expiresAt: number;
          /** Why it ended this way, when the host said why. */
          readonly error?: string;
      };

/** The phases after which nothing more arrives, so following one stops here. */
const TERMINAL_PHASES: ReadonlySet<RigPairingState["phase"]> = new Set([
    "connected",
    "expired",
    "failed",
    "rejected",
]);

/** True once a pairing has finished, whichever way it finished. */
export function rigPairingSettled(state: RigPairingState): boolean {
    return TERMINAL_PHASES.has(state.phase);
}

/** An invitation this Rig made, and the exact command that redeems it. */
export interface RigPairingInvitation {
    readonly id: string;
    /** The invitation itself, which the other machine is given. */
    readonly invitation: string;
    /**
     * What to run on the machine being invited, ready to be copied whole. The
     * command is built here rather than in a component so every surface that
     * shows it shows the same one.
     */
    readonly command: string;
}

/** Builds the one command a person runs on the machine they are inviting. */
export function rigPairingJoinCommand(invitation: string): string {
    return `npm install -g @slopus/rig && rig join ${invitation}`;
}

/**
 * The host Rig's pairing service.
 *
 * Everything here is the host's: pairing is how the host decides which machines
 * it trusts, so there is no peer-side variant of this and no transport detail
 * above it. `available` is false on a daemon whose protocol does not carry
 * pairing, and a surface reads that rather than offering controls that would
 * fail.
 *
 * `pairingFollow` owns the repeated read. It is the source's, not a component's
 * and not a timer the store winds: the source knows when a pairing has settled
 * and stops by itself, and releasing the subscription stops it immediately
 * whether or not it has.
 */
export interface RigPairingSource {
    /** True when the host daemon's negotiated protocol carries pairing at all. */
    readonly available: boolean;
    /**
     * Follows whether the host can pair, reporting the current answer at once
     * and again whenever it changes.
     *
     * It is followed rather than read once because the answer is not known when
     * this store is built: the daemon's protocol is settled by a handshake that
     * completes on its own schedule, and a store that captured "not yet known"
     * would tell the reader their Rig is too old forever. Released with the
     * surface, like everything else here.
     */
    availabilityFollow(listener: (available: boolean) => void): () => void;
    /** Makes an invitation for another machine to redeem. */
    invitationCreate(): Promise<RigPairingInvitation>;
    /** Redeems an invitation made by another machine. */
    invitationJoin(invitation: string): Promise<string>;
    /**
     * Follows one pairing until it settles, reporting every state it passes
     * through. Stops on its own at a terminal phase and stops at once when the
     * returned release is called.
     */
    pairingFollow(
        id: string,
        listener: (state: RigPairingState) => void,
        onError: (error: unknown) => void,
    ): () => void;
    /** Accepts or rejects the machine whose emojis are being compared. */
    verificationAnswer(id: string, accept: boolean): Promise<RigPairingState>;
}

/** The invitation being pasted in, and whether it has been sent yet. */
export interface RigPairingJoinDraft {
    readonly invitation: string;
    readonly submitting: boolean;
}

export interface RigPairingSnapshot {
    /**
     * False on a host whose protocol does not carry pairing. The surface says
     * so instead of showing controls that cannot work — an older host still
     * reports the machines it is peered with, it just cannot be asked to pair
     * with a new one from here.
     */
    readonly available: boolean;
    /** The invitation this Rig made, once it has made one. */
    readonly invitation?: RigPairingInvitation;
    /** True while an invitation is being made. */
    readonly creating: boolean;
    /** The invitation being pasted in to join another machine. */
    readonly join: RigPairingJoinDraft;
    /** Where the pairing being followed has got to, once one is under way. */
    readonly state?: RigPairingState;
    /** True while an accept or reject is with the host. */
    readonly answering: boolean;
    /** Why the last attempt failed, when it failed. */
    readonly error?: UserError;
}

export interface RigPairingStore {
    get(): RigPairingSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Asks the host for an invitation. The invitation and its command appear
     * only when the host answers, and following it starts at the same moment,
     * so what is on screen is always a pairing the host actually has.
     */
    invitationCreate(): void;
    /** Types or pastes the invitation made by the machine being joined. */
    joinInvitationUpdate(value: string): void;
    /**
     * Redeems the pasted invitation. A blank one is not a request, so nothing
     * leaves; nothing here claims the pairing began until the host says so.
     */
    joinSubmit(): void;
    /**
     * Answers the machine whose emojis are being compared. The answer is the
     * host's to carry out, so the phase moves only when the host reports it.
     */
    verificationAnswer(accept: boolean): void;
    /**
     * Puts the pairing surface back to nothing: stops following whatever was
     * under way and clears what it left on screen. This is how a settled
     * pairing is dismissed and how a second one is started. It does not revoke
     * an invitation on the daemon; no daemon cancellation action exists.
     */
    pairingReset(): void;
    [Symbol.dispose](): void;
}

export interface RigPairingStoreDeps {
    readonly source: RigPairingSource;
}

const EMPTY_JOIN: RigPairingJoinDraft = { invitation: "", submitting: false };

/**
 * Pairing this Rig with another machine, from one surface.
 *
 * Trust is established by comparing four emojis on both machines and answering
 * on each. That is the only way a machine is trusted here: there is no key to
 * copy, no endpoint to allow, and nothing about a peer to configure. The host
 * owns the result — once a pairing connects, the machine appears in the host's
 * ordinary peer status like any other.
 *
 * The store winds no timer of its own. Following a pairing is the source's, and
 * this only decides when to start and when to stop: a settled pairing stops
 * itself, and resetting, replacing, or disposing stops it at once. So a window
 * that is not on this surface is not asking the host about a pairing.
 */
export function rigPairingStoreCreate(deps: RigPairingStoreDeps): RigPairingStore {
    const store = createStore<RigPairingSnapshot>()(() => ({
        available: deps.source.available,
        creating: false,
        join: EMPTY_JOIN,
        answering: false,
    }));

    const listeners = new Set<() => void>();
    let releaseFollow: (() => void) | undefined;
    let releaseAvailability: (() => void) | undefined;
    let disposed = false;
    /**
     * Which attempt is current. An answer that arrives for a pairing that has
     * been reset or replaced describes something the reader is no longer
     * looking at, so it is dropped rather than written over what is.
     */
    let generation = 0;

    const followStop = (): void => {
        releaseFollow?.();
        releaseFollow = undefined;
    };

    const follow = (id: string): void => {
        followStop();
        const current = generation;
        releaseFollow = deps.source.pairingFollow(
            id,
            (state) => {
                if (disposed || current !== generation) return;
                store.setState({ error: undefined, state }, false);
                // The source stops itself here; releasing as well keeps this
                // store from holding a subscription that can no longer report
                // anything.
                if (rigPairingSettled(state)) followStop();
            },
            (error) => {
                if (disposed || current !== generation) return;
                store.setState({ error: rigUserError(error) }, false);
            },
        );
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            // Whether the host can pair is only settled by its handshake, so the
            // first reader is what starts listening for the answer rather than
            // the store fixing one at the moment it was built.
            releaseAvailability ??= deps.source.availabilityFollow((available) => {
                if (disposed || store.getState().available === available) return;
                store.setState({ available }, false);
            });
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                // The last reader leaving ends the surface, and a pairing is
                // only ever followed for a surface that is on screen.
                if (listeners.size === 0) {
                    generation += 1;
                    followStop();
                    releaseAvailability?.();
                    releaseAvailability = undefined;
                }
            };
        },
        invitationCreate() {
            if (disposed || !deps.source.available) return;
            const snapshot = store.getState();
            if (snapshot.creating) return;
            generation += 1;
            const current = generation;
            followStop();
            store.setState(
                { creating: true, error: undefined, invitation: undefined, state: undefined },
                false,
            );
            deps.source.invitationCreate().then(
                (invitation) => {
                    if (disposed || current !== generation) return;
                    store.setState({ creating: false, invitation }, false);
                    follow(invitation.id);
                },
                (error: unknown) => {
                    if (disposed || current !== generation) return;
                    store.setState({ creating: false, error: rigUserError(error) }, false);
                },
            );
        },
        joinInvitationUpdate(value) {
            if (disposed) return;
            store.setState({ join: { ...store.getState().join, invitation: value } }, false);
        },
        joinSubmit() {
            if (disposed || !deps.source.available) return;
            const snapshot = store.getState();
            if (snapshot.join.submitting) return;
            const invitation = snapshot.join.invitation.trim();
            if (invitation.length === 0) return;
            generation += 1;
            const current = generation;
            followStop();
            store.setState(
                {
                    error: undefined,
                    invitation: undefined,
                    join: { ...snapshot.join, submitting: true },
                    state: undefined,
                },
                false,
            );
            deps.source.invitationJoin(invitation).then(
                (id) => {
                    if (disposed || current !== generation) return;
                    store.setState({ join: EMPTY_JOIN }, false);
                    follow(id);
                },
                (error: unknown) => {
                    if (disposed || current !== generation) return;
                    store.setState(
                        {
                            error: rigUserError(error),
                            join: { ...store.getState().join, submitting: false },
                        },
                        false,
                    );
                },
            );
        },
        verificationAnswer(accept) {
            if (disposed) return;
            const snapshot = store.getState();
            const state = snapshot.state;
            if (!state || state.phase !== "verifying" || snapshot.answering) return;
            const current = generation;
            const id = state.id;
            store.setState({ answering: true, error: undefined }, false);
            deps.source.verificationAnswer(id, accept).then(
                (answered) => {
                    if (disposed || current !== generation) return;
                    store.setState({ answering: false, state: answered }, false);
                    if (rigPairingSettled(answered)) followStop();
                },
                (error: unknown) => {
                    if (disposed || current !== generation) return;
                    store.setState({ answering: false, error: rigUserError(error) }, false);
                },
            );
        },
        pairingReset() {
            if (disposed) return;
            generation += 1;
            followStop();
            store.setState(
                {
                    answering: false,
                    creating: false,
                    error: undefined,
                    invitation: undefined,
                    join: EMPTY_JOIN,
                    state: undefined,
                },
                false,
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            generation += 1;
            followStop();
            releaseAvailability?.();
            releaseAvailability = undefined;
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigPairingSnapshot = {
    available: false,
    answering: false,
    creating: false,
    join: EMPTY_JOIN,
};

/**
 * Pairing for a host that cannot do it. Permanently unavailable rather than
 * merely idle, so a surface that must subscribe unconditionally reads "this
 * host cannot pair from here" instead of offering a control that would fail.
 */
export const rigPairingStoreNoop: RigPairingStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    invitationCreate: () => undefined,
    joinInvitationUpdate: () => undefined,
    joinSubmit: () => undefined,
    verificationAnswer: () => undefined,
    pairingReset: () => undefined,
    [Symbol.dispose]: () => undefined,
};
