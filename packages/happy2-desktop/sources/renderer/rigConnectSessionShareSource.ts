import type { RigConnection, SessionShareOwnerResponse } from "@slopus/rig-connect";
import type {
    RigSessionId,
    RigSessionShareChoice,
    RigSessionShareSource,
    RigSessionShareSourceReading,
} from "happy2-state";

/**
 * How often the machine is asked about the open session's share. The daemon
 * answers about a share rather than announcing it, so the panel and the
 * indicator over the transcript are kept current by reading — often enough that
 * a member joining or the delivery falling behind is noticed while the owner is
 * still looking, rarely enough that a machine is not interrogated. Nothing is
 * read at all while no conversation is focused or the window is hidden.
 */
const POLL_INTERVAL_MS = 4_000;

/** The calls this source needs; a daemon missing any of them cannot share. */
const SHARE_METHODS = [
    "createSessionShare",
    "addSessionShareMember",
    "revokeSessionShareMember",
    "stopSessionShare",
    "setSessionShareFriendMessages",
    "getSessionShareHealth",
] as const satisfies readonly (keyof RigConnection)[];

/** Whether this daemon client carries the session-sharing operations at all. */
function shareCapable(rig: RigConnection): boolean {
    const candidate = rig as unknown as Partial<Record<string, unknown>>;
    return SHARE_METHODS.every((method) => typeof candidate[method] === "function");
}

/**
 * Adapts the daemon's session-sharing routes to the owner store's source
 * contract, or reports that this daemon has none.
 *
 * The five decisions go through `rig-connect`'s own mutation queue rather than
 * being posted here: that queue retries them, resolves conflicts against the
 * session's event cursor, and — for a share — feeds the result back into the
 * transcript's session state, which is what keeps the indicator honest between
 * readings. It hands back an identity rather than a promise, so a refusal is
 * reported through `rejectionsSubscribe` instead of a rejected call, and a
 * decision that was taken is only ever visible in a later reading.
 *
 * The owner's own view of a share — who is in it and what state each membership
 * is in — has no `rig-connect` method, so it is read straight off the daemon
 * through the same capability-scoped bridge `rig-connect` itself uses. The
 * bridge is a transparent passthrough, so this is the same request the library
 * would make if it exposed one.
 */
export function rigConnectSessionShareSourceCreate(
    rig: RigConnection,
    rigHttpUrl: string,
    rejectionsSubscribe: RigSessionShareSource["rejectionsSubscribe"],
): RigSessionShareSource | undefined {
    if (!shareCapable(rig)) return undefined;
    const bridge = `${rigHttpUrl.replace(/\/$/u, "")}/rig-connect`;
    return {
        subscribe(sessionId, listener, onError) {
            let closed = false;
            let reading = false;
            let refreshQueued = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const controller = new AbortController();
            const finish = (): void => {
                reading = false;
                if (closed) return;
                if (refreshQueued && !documentHidden()) {
                    refreshQueued = false;
                    read();
                    return;
                }
                schedule();
            };
            const read = (): void => {
                if (closed) return;
                if (timer !== undefined) clearTimeout(timer);
                timer = undefined;
                // A hidden window is not a window anyone is reading. Its
                // visibility listener resumes the cycle, so no timer needs to
                // wake while the application is in the background.
                if (documentHidden()) return;
                // A decision can ask for an immediate read while the regular one
                // is still in flight. Queue exactly one follow-up so an older
                // answer can never arrive after a newer one.
                if (reading) {
                    refreshQueued = true;
                    return;
                }
                reading = true;
                readingRead(rig, bridge, sessionId, controller.signal).then(
                    (result) => {
                        if (closed) return;
                        listener(result);
                        finish();
                    },
                    (error: unknown) => {
                        if (closed) return;
                        onError(error);
                        finish();
                    },
                );
            };
            const schedule = (): void => {
                if (closed || timer !== undefined || documentHidden()) return;
                timer = setTimeout(read, POLL_INTERVAL_MS);
            };
            const visibilityChanged = (): void => {
                if (closed) return;
                if (documentHidden()) {
                    if (timer !== undefined) clearTimeout(timer);
                    timer = undefined;
                    return;
                }
                read();
            };
            if (typeof document !== "undefined")
                document.addEventListener("visibilitychange", visibilityChanged);
            read();
            return () => {
                if (closed) return;
                closed = true;
                if (typeof document !== "undefined")
                    document.removeEventListener("visibilitychange", visibilityChanged);
                if (timer !== undefined) clearTimeout(timer);
                controller.abort();
            };
        },
        // A decision is handed to the queue and nothing is read here on its
        // account. The queue posts it later, so a reading taken now would
        // answer about the machine as it was before the decision — and the
        // store settles an attempt on the reading that shows the decision took
        // effect, which such a reading would falsely be.
        shareCreate(sessionId, friends, friendMessagesInContext) {
            return rig.createSessionShare(sessionId, {
                friends: friends.map(friendInput),
                includeFriendMessagesInModel: friendMessagesInContext,
            });
        },
        memberAdd(sessionId, friend) {
            return rig.addSessionShareMember(sessionId, friendInput(friend));
        },
        memberRevoke(sessionId, memberId) {
            return rig.revokeSessionShareMember(sessionId, memberId);
        },
        shareStop(sessionId) {
            return rig.stopSessionShare(sessionId);
        },
        friendMessagesSet(sessionId, value) {
            return rig.setSessionShareFriendMessages(sessionId, value);
        },
        rejectionsSubscribe,
    };
}

/** Whether this window is on screen; a hidden one reads nothing. */
function documentHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** A ticked friend as the daemon takes them: their machine, and their name here. */
function friendInput(choice: RigSessionShareChoice): {
    displayName: string;
    peerId: string;
} {
    return { displayName: choice.displayName, peerId: choice.peerId };
}

/**
 * One complete reading of one session's share: whether it is shared, who is in
 * it, and how far behind delivery has fallen. A session that is not shared has
 * nothing else to read — members and health belong to a share — so the reading
 * stops there, and delivery health is asked for only while a share is live,
 * because a share that has ended is not falling behind, it is over.
 */
async function readingRead(
    rig: RigConnection,
    bridge: string,
    sessionId: RigSessionId,
    signal: AbortSignal,
): Promise<RigSessionShareSourceReading> {
    const owner = await ownerRead(bridge, sessionId, signal);
    if (!owner) return { members: [], loading: false };
    const share = {
        shareId: owner.share.shareId,
        state: owner.share.state,
        memberCount: owner.share.memberCount,
        includeFriendMessagesInModel: owner.share.includeFriendMessagesInModel,
    };
    const members = owner.members.map((member) => ({
        shareMemberId: member.shareMemberId,
        displayName: member.displayName,
        murmurPeerId: member.murmurPeerId,
        state: member.state,
        createdAt: member.createdAt,
    }));
    if (owner.share.state === "stopped") return { share, members, loading: false };
    // Delivery health is a second question, and a machine that cannot answer it
    // has not made the share itself unreadable: the panel simply shows no
    // measurement rather than reporting the whole reading as failed.
    const health = await rig
        .getSessionShareHealth(owner.share.shareId, { signal })
        .then((response) => response.health)
        .catch(() => undefined);
    return {
        share,
        members,
        ...(health === undefined
            ? {}
            : {
                  health: {
                      state: health.state,
                      pendingEntries: health.pendingEntries,
                      pendingBytes: health.pendingBytes,
                      checkedAt: health.checkedAt,
                  },
              }),
        loading: false,
    };
}

/**
 * The owner's view of one session's share, or nothing when that session is not
 * shared. A session that has never been shared answers 404, which is an answer
 * rather than a failure: it is how the machine says "not shared".
 */
async function ownerRead(
    bridge: string,
    sessionId: RigSessionId,
    signal: AbortSignal,
): Promise<SessionShareOwnerResponse | undefined> {
    const response = await fetch(`${bridge}/sessions/${encodeURIComponent(sessionId)}/share`, {
        signal,
    });
    if (response.status === 404) return undefined;
    if (!response.ok)
        throw new Error("This machine could not say who this session is shared with.");
    return (await response.json()) as SessionShareOwnerResponse;
}
