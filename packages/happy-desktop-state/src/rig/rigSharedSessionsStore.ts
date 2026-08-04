import { createStore } from "zustand/vanilla";
import type { ConversationEntry } from "../conversation/conversationEntry.js";
import type { UserError } from "../types.js";
import {
    rigSessionShareReplicaProject,
    type RigSessionShareReplicaEntry,
} from "./rigSessionShareReplicaProject.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";

declare const rigSharedSessionIdBrand: unique symbol;

/** Branded identity of one session someone is showing this machine. */
export type RigSharedSessionId = string & { readonly [rigSharedSessionIdBrand]: true };

/**
 * The authenticated membership a friend message is posted through.
 *
 * It is carried whole rather than reduced to an id because the owner's machine
 * checks all four parts of it: a membership that was revoked and granted again
 * is a different epoch, and a message posted through the old one is refused.
 */
export interface RigSharedSessionGrant {
    readonly grantEpoch: number;
    readonly murmurPeerId: string;
    readonly shareId: string;
    readonly shareMemberId: string;
}

/**
 * One session this machine holds a replica of.
 *
 * A replica is somewhere to read, and nothing else: it is not a project, a
 * workspace, or a chat, and opening one creates none of those. `live` and
 * `ended` are the whole of its life — a member cannot leave it, cannot pass it
 * on, and cannot end it, so the only thing that changes here is what the owner
 * decides.
 */
export interface RigSharedSession {
    readonly id: RigSharedSessionId;
    readonly title: string;
    readonly ownerPeerId: string;
    /** True while the owner is still sharing. */
    readonly live: boolean;
    /** Why it ended, when it has. */
    readonly ended?: "revoked" | "stopped" | "unreadable";
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly watching: number;
    readonly grant: RigSharedSessionGrant;
}

/**
 * The replica currently being read.
 *
 * The transcript arrives from its beginning forwards, a page at a time, so
 * `complete` is the honest answer to "is this the whole conversation so far":
 * while it is false, the newest part of the session has not been read yet and
 * nothing on screen should suggest otherwise.
 */
export interface RigSharedSessionReading {
    readonly id: RigSharedSessionId;
    readonly entries: readonly ConversationEntry[];
    /** True until the first page arrives. */
    readonly loading: boolean;
    /** True while another page is being read. */
    readonly loadingMore: boolean;
    /** False while the replica holds less than the whole conversation so far. */
    readonly complete: boolean;
    readonly error?: UserError;
    /** What is being written back to the owner. */
    readonly draft: string;
    readonly sending: boolean;
    readonly sendError?: UserError;
    /** True once the last message was accepted, cleared when typing resumes. */
    readonly sent: boolean;
}

export interface RigSharedSessionsSnapshot {
    readonly sessions: readonly RigSharedSession[];
    readonly loading: boolean;
    readonly error?: UserError;
    /** The replica open for reading, absent when none is. */
    readonly reading?: RigSharedSessionReading;
}

/** One replica exactly as the machine holding it reports it. */
export interface RigSharedSessionsSourceReplica {
    readonly id: string;
    readonly title: string;
    readonly ownerPeerId: string;
    readonly live: boolean;
    readonly ended?: "revoked" | "stopped" | "unreadable";
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly watching: number;
    readonly grant: RigSharedSessionGrant;
}

/** One reading of every replica this machine holds. */
export interface RigSharedSessionsSourceReading {
    readonly sessions: readonly RigSharedSessionsSourceReplica[];
    /** True only before the first answer, so "nothing shared" is never claimed early. */
    readonly loading: boolean;
    /** Why the last attempt failed; the replicas already held stay in place. */
    readonly error?: string;
}

/**
 * One page of a replica's history. The cursor runs forwards, from the beginning
 * of the conversation towards the present, so `complete` is what says the page
 * reached the newest row the machine has.
 */
export interface RigSharedSessionsSourceHistoryPage {
    readonly entries: readonly RigSessionShareReplicaEntry[];
    readonly complete: boolean;
    readonly nextCursor?: string;
    /** The replica as the host now reports it, so an ended share is noticed here. */
    readonly replica: RigSharedSessionsSourceReplica;
}

export interface RigSharedSessionsSource {
    /** Repeating read of the replicas this machine holds, while something watches. */
    subscribe(
        listener: (reading: RigSharedSessionsSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
    /** One page of a replica's history, forward from `after`. */
    historyRead(shareId: string, after?: string): Promise<RigSharedSessionsSourceHistoryPage>;
    /**
     * Posts one message into the owner's session through this membership. The
     * same `clientMessageId` must be reused across retries of one message.
     *
     * The owner's machine may refuse a message it accepted the request for — a
     * membership revoked a moment ago is the ordinary case — so a resolved call
     * that answers `accepted: false` is a failure to report, not a send.
     */
    messagePost(input: {
        readonly clientMessageId: string;
        readonly grant: RigSharedSessionGrant;
        readonly text: string;
    }): Promise<{ readonly accepted: boolean }>;
}

/** What the store asks its owner to carry out; the transport is the owner's. */
export type RigSharedSessionsOutput =
    | {
          readonly type: "sessionHistorySubmitted";
          readonly id: RigSharedSessionId;
          /** Absent for the first page, which is the oldest part of the conversation. */
          readonly after?: string;
      }
    | {
          readonly type: "draftSubmitted";
          readonly id: RigSharedSessionId;
          /** Minted once per message, so every retry of it is the same message. */
          readonly clientMessageId: string;
          readonly grant: RigSharedSessionGrant;
          readonly text: string;
      };

/**
 * Authoritative results of the work the owner carried out.
 *
 * A post the machine answered `accepted: false` for arrives here as
 * `draftFailed`: the owner of this store decides that, because it is the one
 * holding the answer, and this store must never turn a refusal into a sent
 * message.
 */
export type RigSharedSessionsInput =
    | {
          readonly type: "sessionHistorySucceeded";
          readonly id: RigSharedSessionId;
          readonly page: RigSharedSessionsSourceHistoryPage;
      }
    | {
          readonly type: "sessionHistoryFailed";
          readonly id: RigSharedSessionId;
          readonly error: unknown;
      }
    | { readonly type: "draftSucceeded"; readonly id: RigSharedSessionId }
    | {
          readonly type: "draftFailed";
          readonly id: RigSharedSessionId;
          readonly error: unknown;
      };

export interface RigSharedSessionsStore {
    get(): RigSharedSessionsSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Opens one replica for reading. The conversation is read from its
     * beginning forwards until the whole of it is here, and kept current for as
     * long as it stays open.
     */
    sessionOpen(id: RigSharedSessionId): void;
    /** Stops reading; nothing more of this replica is asked for. */
    sessionClose(): void;
    /**
     * Reads on towards the present, from wherever the automatic reading stopped.
     * A replica that already holds the whole conversation asks for nothing.
     */
    sessionMoreLoad(): void;
    /** Types the message being written back to the owner. */
    draftUpdate(value: string): void;
    /**
     * Sends what has been typed. A blank message is not a message, so nothing
     * leaves; neither does anything while a send is still in flight, or into a
     * session the owner has stopped sharing.
     */
    draftSubmit(): void;
    /** Private authoritative input: how the owner's attempt actually ended. */
    sharedSessionsInput(event: RigSharedSessionsInput): void;
    [Symbol.dispose](): void;
}

export interface RigSharedSessionsStoreDeps {
    readonly source: RigSharedSessionsSource;
    readonly output?: (event: RigSharedSessionsOutput) => void;
}

/**
 * How many pages one opening reads on its own before it stops and waits to be
 * asked again. A page is a hundred rows, so this is ten thousand of them: far
 * more than any real conversation, and few enough that a share written by
 * something other than Rig cannot hold this machine reading forever.
 */
const HISTORY_PAGE_LIMIT = 50;

/**
 * Sessions other people are showing this machine, and the one being read.
 *
 * They are one surface because they are one act: a replica is opened out of the
 * list, read, and closed back into it, and the list is where an ended share is
 * noticed. Nothing here creates anything locally — no project, no workspace, no
 * chat — because a member has nowhere to put one: they are reading somebody
 * else's session, and the only thing they can do to it is write back.
 *
 * The constructor opens nothing. The first subscriber starts the reading cycle
 * and the last one to leave stops it. There is no realtime channel for replicas
 * yet, so an open one is kept current by asking again on the same cadence the
 * list uses — the sanctioned stopgap, and it stops the moment the replica is
 * closed or the last subscriber leaves.
 */
export function rigSharedSessionsStoreCreate(
    deps: RigSharedSessionsStoreDeps,
): RigSharedSessionsStore {
    const output = deps.output ?? (() => undefined);
    const store = createStore<RigSharedSessionsSnapshot>()(() => ({
        sessions: [],
        loading: true,
    }));

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    // Everything about the open replica that is not something to render: where
    // the reading got to, how many pages it has taken, and whether the answer
    // now in flight was asked for by the reader or by the refresh cycle.
    let openId: RigSharedSessionId | undefined;
    let cursor: string | undefined;
    let pagesRead = 0;
    let historyMode: "page" | "refresh" | undefined;
    /**
     * The idempotency key of the message being written back, minted once when
     * it is first sent and kept across every retry of it. A send that failed is
     * usually one to try again, and the owner's machine must be able to see the
     * second attempt as the same message rather than as a second one — a post
     * that actually landed and only lost its answer would otherwise arrive
     * twice. It is cleared once the message is the owner's, or once the reader
     * writes something else.
     */
    let draftMessageId: string | undefined;
    let history: RigSessionShareReplicaEntry[] = [];
    let historySeen = new Set<string>();

    const readingUpdate = (change: Partial<RigSharedSessionReading>): void => {
        const reading = store.getState().reading;
        if (!reading) return;
        store.setState({ reading: { ...reading, ...change } }, false);
    };

    const readingReset = (): void => {
        openId = undefined;
        cursor = undefined;
        pagesRead = 0;
        historyMode = undefined;
        history = [];
        historySeen = new Set();
        draftMessageId = undefined;
    };

    const sessionOf = (id: RigSharedSessionId): RigSharedSession | undefined =>
        store.getState().sessions.find((session) => session.id === id);

    /** Asks for the next page forward, and remembers who asked. */
    const historyAsk = (id: RigSharedSessionId, mode: "page" | "refresh"): void => {
        historyMode = mode;
        output({
            type: "sessionHistorySubmitted",
            id,
            ...(cursor === undefined ? {} : { after: cursor }),
        });
    };

    /** Merges one replica the host has just described into the list it belongs in. */
    const replicaMerge = (replica: RigSharedSessionsSourceReplica): void => {
        const current = store.getState();
        const projected = sessionProject(replica);
        const known = current.sessions.some((session) => session.id === projected.id);
        const sessions = known
            ? current.sessions.map((session) => (session.id === projected.id ? projected : session))
            : [...current.sessions, projected];
        store.setState(
            { sessions: referencesPreserve(current.sessions, sessionsSort(sessions)) },
            false,
        );
    };

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                const current = store.getState();
                const sessions = referencesPreserve(
                    current.sessions,
                    sessionsSort(reading.sessions.map(sessionProject)),
                );
                store.setState(
                    {
                        sessions,
                        loading: reading.loading,
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(reading.error) }),
                        ...(current.reading === undefined ? {} : { reading: current.reading }),
                    },
                    true,
                );
                // The list's own cadence is the replica's: there is nothing to
                // subscribe to, so a replica that has caught up asks again for
                // whatever has happened since, and one that is still reading its
                // way forward is left to finish first.
                const open = store.getState().reading;
                if (!open || historyMode !== undefined) return;
                if (!open.complete) return;
                if (sessionOf(open.id)?.live === false) return;
                historyAsk(open.id, "refresh");
            },
            (error) => {
                if (disposed) return;
                store.setState({ error: rigUserError(error), loading: false }, false);
            },
        );
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        sessionOpen(id) {
            if (openId === id) return;
            readingReset();
            openId = id;
            store.setState(
                {
                    reading: {
                        id,
                        entries: [],
                        loading: true,
                        loadingMore: false,
                        complete: false,
                        draft: "",
                        sending: false,
                        sent: false,
                    },
                },
                false,
            );
            historyAsk(id, "page");
        },
        sessionClose() {
            if (!openId) return;
            readingReset();
            const current = store.getState();
            store.setState(
                {
                    sessions: current.sessions,
                    loading: current.loading,
                    ...(current.error === undefined ? {} : { error: current.error }),
                },
                true,
            );
        },
        sessionMoreLoad() {
            const reading = store.getState().reading;
            if (!reading || historyMode !== undefined) return;
            if (reading.complete) return;
            // Being asked for more is a fresh run of automatic reading, so the
            // page budget starts again from here.
            pagesRead = 0;
            readingUpdate({ loadingMore: true, error: undefined });
            historyAsk(reading.id, "page");
        },
        draftUpdate(value) {
            // Typing again is the start of a new message, so neither the last
            // failure nor the last confirmation is left standing over it.
            // Typing is a different message from the one that failed, so it
            // gets its own identity when it is sent.
            draftMessageId = undefined;
            readingUpdate({ draft: value, sendError: undefined, sent: false });
        },
        draftSubmit() {
            const reading = store.getState().reading;
            if (!reading || reading.sending) return;
            const text = reading.draft.trim();
            if (text === "") return;
            const session = sessionOf(reading.id);
            // A session that is over cannot be written into, and a membership
            // this machine has not been told about cannot be written through.
            if (!session || !session.live) return;
            draftMessageId ??= crypto.randomUUID();
            readingUpdate({ sending: true, sendError: undefined, sent: false });
            output({
                type: "draftSubmitted",
                id: reading.id,
                clientMessageId: draftMessageId,
                grant: session.grant,
                text,
            });
        },
        sharedSessionsInput(event) {
            const reading = store.getState().reading;
            // An answer about a replica nobody is reading any more is history:
            // the reader closed it, and reopening it starts from the beginning.
            if (!reading || reading.id !== event.id) return;
            if (event.type === "draftSucceeded") {
                // The message is the owner's now. It appears in the transcript
                // when their session replicates it back, so nothing is written
                // into the conversation here — this is the only local evidence
                // the send happened.
                draftMessageId = undefined;
                readingUpdate({ draft: "", sending: false, sent: true });
                return;
            }
            if (event.type === "draftFailed") {
                // The text stays in the field: a message that did not arrive is
                // usually one to send again rather than one to write out afresh.
                readingUpdate({
                    sending: false,
                    sendError: rigUserError(event.error),
                    sent: false,
                });
                return;
            }
            const mode = historyMode;
            historyMode = undefined;
            if (event.type === "sessionHistoryFailed") {
                // A refresh that failed says nothing about what is already read,
                // so it settles the reading rather than emptying it.
                readingUpdate({
                    loading: false,
                    loadingMore: false,
                    error: rigUserError(event.error),
                });
                return;
            }
            const page = event.page;
            replicaMerge(page.replica);
            for (const entry of page.entries) {
                if (historySeen.has(entry.shareEventId)) continue;
                historySeen.add(entry.shareEventId);
                history.push(entry);
            }
            if (page.nextCursor !== undefined) cursor = page.nextCursor;
            if (mode === "page") pagesRead += 1;
            const entries = referencesPreserve(
                reading.entries,
                rigSessionShareReplicaProject({
                    shareId: reading.id,
                    entries: history,
                    // A replica has no reasoning control of its own, so it
                    // follows the product's default of keeping the agent's
                    // thinking out of the transcript.
                    showReasoning: false,
                    viewerPeerId: page.replica.grant.murmurPeerId,
                }),
            );
            // Reading on is what makes a member see the conversation rather than
            // its opening. It stops at the end, at the page budget, or where the
            // host stopped handing out cursors.
            const more =
                mode === "page" &&
                !page.complete &&
                pagesRead < HISTORY_PAGE_LIMIT &&
                page.nextCursor !== undefined;
            readingUpdate({
                entries,
                loading: false,
                loadingMore: more,
                complete: page.complete,
                error: undefined,
            });
            if (more) historyAsk(reading.id, "page");
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            readingReset();
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigSharedSessionsSnapshot = { sessions: [], loading: false };

/**
 * Shared sessions for a Rig that cannot hold them. It is permanently empty and
 * settled rather than loading, so a surface that must subscribe unconditionally
 * reads "this machine cannot do this" instead of waiting forever for a reading
 * that is not coming.
 */
export const rigSharedSessionsStoreNoop: RigSharedSessionsStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    sessionOpen: () => undefined,
    sessionClose: () => undefined,
    sessionMoreLoad: () => undefined,
    draftUpdate: () => undefined,
    draftSubmit: () => undefined,
    sharedSessionsInput: () => undefined,
    [Symbol.dispose]: () => undefined,
};

function sessionProject(replica: RigSharedSessionsSourceReplica): RigSharedSession {
    return {
        id: replica.id as RigSharedSessionId,
        title: replica.title,
        ownerPeerId: replica.ownerPeerId,
        live: replica.live,
        ...(replica.ended === undefined ? {} : { ended: replica.ended }),
        startedAt: replica.startedAt,
        ...(replica.endedAt === undefined ? {} : { endedAt: replica.endedAt }),
        watching: replica.watching,
        grant: replica.grant,
    };
}

/**
 * Sessions still being shared first, then the most recently opened. A share
 * that has ended is still worth keeping — what was read is read, and nothing
 * takes that back — but it is no longer something to go and look at.
 */
function sessionsSort(sessions: readonly RigSharedSession[]): readonly RigSharedSession[] {
    return [...sessions].sort((left, right) => {
        if (left.live !== right.live) return left.live ? -1 : 1;
        return right.startedAt - left.startedAt;
    });
}
