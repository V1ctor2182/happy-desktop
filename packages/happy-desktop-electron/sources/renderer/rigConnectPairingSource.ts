import type { P2pPairingState, RigConnection } from "@slopus/rig-connect";
import {
    rigPairingJoinCommand,
    rigPairingSettled,
    type RigPairingInvitation,
    type RigPairingSource,
    type RigPairingState,
} from "happy-desktop-state";

/**
 * The oldest daemon protocol that carries pairing.
 *
 * Invitations, joins, and emoji verification arrived together in protocol 10. An
 * older daemon still reports the machines it is peered with, so its nodes
 * surface works exactly as before; it simply has no route to ask it to trust a
 * new one, and the surface says so rather than offering a control that would
 * answer 404.
 */
export const RIG_PAIRING_PROTOCOL_VERSION = 10;

/**
 * How often the host is asked where a pairing has got to, in milliseconds.
 *
 * Pairing is a person waiting at two machines, so this is paced for a human
 * rather than for a progress bar: fast enough that comparing emojis does not
 * feel like waiting on a form, slow enough that a pairing left open on screen
 * is not a load on the daemon.
 */
const POLL_INTERVAL_MS = 1_000;
const POLL_RETRY_MAXIMUM_MS = 15_000;

/**
 * The protocol the daemon on the other end negotiated, as this source reads it.
 *
 * It is followed rather than read once because the handshake settles after the
 * connection is built: a source that captured the answer at construction would
 * report every Rig as too old to pair. `current` is the synchronous answer for
 * a surface that has not subscribed yet; `follow` reports it now and on every
 * change, and its release ends the interest.
 */
export interface RigPairingProtocol {
    current(): number | undefined;
    follow(listener: (version: number | undefined) => void): () => void;
}

/**
 * Adapts `rig-connect`'s pairing calls to the pairing store's source contract.
 *
 * Pairing exists only on the host connection. A machine reached *through* the
 * host is reached because the host already trusts it, and it is not this
 * window's business to negotiate trust on another machine's behalf — so this is
 * built for the host alone and nothing hands it a peer connection.
 *
 * The repeated read lives here rather than above it. The daemon reports a
 * pairing's phase on request instead of streaming it, so something has to ask;
 * doing it here means the loop knows what a terminal phase is, stops the moment
 * it sees one, and never has a second request in flight behind the first.
 */
export function rigConnectPairingSourceCreate(
    rig: RigConnection,
    protocol: RigPairingProtocol,
): RigPairingSource {
    const carries = (version: number | undefined): boolean =>
        version !== undefined && version >= RIG_PAIRING_PROTOCOL_VERSION;
    return {
        get available() {
            return carries(protocol.current());
        },
        availabilityFollow(listener) {
            return protocol.follow((version) => listener(carries(version)));
        },
        async invitationCreate(): Promise<RigPairingInvitation> {
            const response = await rig.createP2pInvitation();
            return {
                command: rigPairingJoinCommand(response.invitation),
                id: response.id,
                invitation: response.invitation,
            };
        },
        async invitationJoin(invitation): Promise<string> {
            const response = await rig.joinP2pInvitation(invitation);
            return response.id;
        },
        pairingFollow(id, listener, onError) {
            let released = false;
            let failedReads = 0;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const stop = (): void => {
                released = true;
                if (timer !== undefined) clearTimeout(timer);
                timer = undefined;
            };
            /**
             * One read at a time. The next is scheduled only once the previous
             * has answered, so a slow daemon accumulates no backlog and a
             * pairing that settles is never overtaken by a request that was
             * already in flight.
             */
            const read = (): void => {
                if (released) return;
                rig.getP2pPairing(id).then(
                    (state) => {
                        if (released) return;
                        failedReads = 0;
                        const projected = pairingProject(state);
                        listener(projected);
                        if (rigPairingSettled(projected)) {
                            stop();
                            return;
                        }
                        timer = setTimeout(read, POLL_INTERVAL_MS);
                    },
                    (error: unknown) => {
                        if (released) return;
                        onError(error);
                        failedReads += 1;
                        const retryDelay = Math.min(
                            POLL_INTERVAL_MS * 2 ** failedReads,
                            POLL_RETRY_MAXIMUM_MS,
                        );
                        // A pairing remains live on the daemon across a brief
                        // host or proxy interruption. Keep following it with a
                        // bounded backoff so the surface can recover and still
                        // observe its terminal phase without overlapping reads.
                        if (!released) timer = setTimeout(read, retryDelay);
                    },
                );
            };
            read();
            return stop;
        },
        async verificationAnswer(id, accept): Promise<RigPairingState> {
            return pairingProject(await rig.answerP2pVerification(id, accept));
        },
    };
}

/**
 * One pairing state in the store's shape.
 *
 * The daemon's phases are read explicitly rather than passed through, so a
 * surface is handed a closed union whose fields are guaranteed by its phase
 * instead of the wire object's optional ones.
 */
function pairingProject(state: P2pPairingState): RigPairingState {
    switch (state.phase) {
        case "connecting":
        case "waiting":
            return {
                expiresAt: state.expiresAt,
                id: state.id,
                phase: state.phase,
                role: state.role,
            };
        case "verifying":
            return {
                emojis: state.emojis,
                expiresAt: state.expiresAt,
                id: state.id,
                peer: state.peer,
                phase: "verifying",
                role: state.role,
            };
        case "connected":
            return {
                expiresAt: state.expiresAt,
                id: state.id,
                peer: state.peer,
                phase: "connected",
                role: state.role,
            };
        default:
            return {
                expiresAt: state.expiresAt,
                id: state.id,
                phase: state.phase,
                role: state.role,
                ...(state.error === undefined ? {} : { error: state.error }),
            };
    }
}
