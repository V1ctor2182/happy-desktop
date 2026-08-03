import type { RigConnection, SessionShareReplica } from "@slopus/rig-connect";
import type {
    RigSharedSessionsSource,
    RigSharedSessionsSourceHistoryPage,
    RigSharedSessionsSourceReading,
    RigSharedSessionsSourceReplica,
} from "happy2-state";

/**
 * How often the daemon is asked again while someone is looking at shared
 * sessions. Replicas have no stream yet, and this one interval is both how
 * quickly a new share appears in the list and how quickly the open replica
 * catches up with what the owner just did — so it is set by the conversation
 * rather than by the list: a reply that took four seconds to show up reads as a
 * page that needed refreshing rather than as someone talking. Nothing is read at
 * all while the surface is closed or the window is hidden.
 */
const POLL_INTERVAL_MS = 3_000;

/** The daemon calls a member's side of session sharing is made of. */
const SESSION_SHARE_METHODS = [
    "listSessionShareReplicas",
    "getSessionShareReplicaHistory",
    "postSessionShareFriendMessage",
] as const satisfies readonly (keyof RigConnection)[];

/** The three reasons a replica can be over; anything else is one this cannot read. */
const ENDED_REASONS = ["revoked", "stopped", "unreadable"] as const;

/** Whether this window's daemon client carries the member-side calls at all. */
function sessionShareCalls(rig: RigConnection): boolean {
    const candidate = rig as unknown as Partial<Record<string, unknown>>;
    return SESSION_SHARE_METHODS.every((method) => typeof candidate[method] === "function");
}

/**
 * Adapts the daemon's replica calls to the shared-sessions store's source
 * contract, or reports that this daemon has none.
 *
 * The calls are typed by the published client, but a window can be connected to
 * an older daemon than the one this build was compiled against, so they are
 * probed before any of them is offered: a machine that cannot do this says so
 * once, rather than failing on a method that is not there every few seconds.
 *
 * The read cycle starts when the store's first subscriber arrives and stops when
 * its last one leaves, so a surface nobody is looking at asks the machine
 * nothing.
 */
export function rigConnectSharedSessionsSourceCreate(
    rig: RigConnection,
): RigSharedSessionsSource | undefined {
    if (!sessionShareCalls(rig)) return undefined;
    const refreshers = new Set<() => void>();
    const refresh = (): void => {
        for (const refresher of refreshers) refresher();
    };
    return {
        subscribe(listener, onError) {
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
                // A decision can ask for an immediate refresh while the regular
                // reading is still in flight. Queue exactly one follow-up so an
                // older response can never arrive after a newer one.
                if (reading) {
                    refreshQueued = true;
                    return;
                }
                reading = true;
                readingRead(rig, controller.signal).then(
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
            refreshers.add(read);
            if (typeof document !== "undefined")
                document.addEventListener("visibilitychange", visibilityChanged);
            read();
            return () => {
                if (closed) return;
                closed = true;
                refreshers.delete(read);
                if (typeof document !== "undefined")
                    document.removeEventListener("visibilitychange", visibilityChanged);
                if (timer !== undefined) clearTimeout(timer);
                controller.abort();
            };
        },
        async historyRead(shareId: string, after?: string) {
            const response = await rig.getSessionShareReplicaHistory(
                shareId,
                after === undefined ? undefined : { after },
            );
            return {
                entries: response.entries.map((entry) => ({
                    shareEventId: entry.shareEventId,
                    shareSequence: entry.shareSequence,
                    createdAt: entry.createdAt,
                    canonicalJson: entry.canonicalJson,
                })),
                complete: response.complete,
                ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
                replica: replicaRead(response.replica),
            } satisfies RigSharedSessionsSourceHistoryPage;
        },
        async messagePost(input) {
            try {
                // The identity is the caller's, minted once for the message and
                // reused by every attempt at it, so the owner's machine files two
                // attempts at one message as one message rather than two.
                const response = await rig.postSessionShareFriendMessage({
                    clientMessageId: input.clientMessageId,
                    grant: {
                        grantEpoch: input.grant.grantEpoch,
                        murmurPeerId: input.grant.murmurPeerId,
                        shareId: input.grant.shareId,
                        shareMemberId: input.grant.shareMemberId,
                    },
                    text: input.text,
                });
                return { accepted: response.accepted };
            } finally {
                // Whether it landed or not, a post is the moment this machine is
                // most likely to learn that access has ended, so the replicas are
                // read again rather than waiting out an interval to find out.
                refresh();
            }
        },
    };
}

/** Whether this window is on screen; a hidden one reads nothing. */
function documentHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** One complete reading: every session anyone is currently showing this machine. */
async function readingRead(
    rig: RigConnection,
    signal: AbortSignal,
): Promise<RigSharedSessionsSourceReading> {
    const response = await rig.listSessionShareReplicas({ signal });
    return { sessions: response.replicas.map(replicaRead), loading: false };
}

/**
 * One replica as the surface shows it.
 *
 * The share's own id lives on the grant rather than beside it, because the grant
 * is what a member holds: they were given access to a session, not handed the
 * session. A reason this build does not recognise is treated as a share that can
 * no longer be read — the access is over either way, and guessing at a newer
 * daemon's wording would put a protocol word on screen.
 */
function replicaRead(replica: SessionShareReplica): RigSharedSessionsSourceReplica {
    const ended =
        replica.state === "ended"
            ? (ENDED_REASONS.find((reason) => reason === replica.endedReason) ?? "unreadable")
            : undefined;
    return {
        id: replica.grant.shareId,
        title: replica.title.trim() === "" ? "Untitled session" : replica.title,
        ownerPeerId: replica.ownerPeerId,
        live: replica.state === "active",
        ...(ended === undefined ? {} : { ended }),
        startedAt: replica.createdAt,
        ...(replica.endedAt === undefined ? {} : { endedAt: replica.endedAt }),
        watching: replica.memberCount,
        grant: {
            grantEpoch: replica.grant.grantEpoch,
            murmurPeerId: replica.grant.murmurPeerId,
            shareId: replica.grant.shareId,
            shareMemberId: replica.grant.shareMemberId,
        },
    };
}
