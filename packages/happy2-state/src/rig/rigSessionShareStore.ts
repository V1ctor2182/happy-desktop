import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigSessionId } from "./rigTypes.js";

declare const rigSessionShareMemberIdBrand: unique symbol;

/** Branded identity of one person's membership of one shared session. */
export type RigSessionShareMemberId = string & {
    readonly [rigSessionShareMemberIdBrand]: true;
};

/**
 * How a share is doing, in the three conditions a reader has to tell apart.
 *
 * `live` is the ordinary state. `behind` is transport pressure the machine
 * expects to recover from on its own — it is emphatically not a failure, and the
 * share keeps running underneath it. `ended` is the one terminal condition:
 * a stopped share can never be started again, and nothing brings it back.
 */
export type RigSessionShareCondition = "live" | "behind" | "ended";

/**
 * What one member may do right now. `watching` is the only state in which a
 * person still receives anything; the other two describe access that is over,
 * either because the owner took it from this person or because the whole share
 * ended.
 */
export type RigSessionShareAccess = "watching" | "revoked" | "ended";

/** One person the owner is showing this session to. */
export interface RigSessionShareMember {
    readonly id: RigSessionShareMemberId;
    /**
     * The name the owner registered for this person when they were added.
     * It is never a name supplied over the network by the member's machine:
     * attribution here has to be something the owner themselves chose.
     */
    readonly name: string;
    readonly peerId: string;
    readonly access: RigSessionShareAccess;
    /** When they were given access, in milliseconds. */
    readonly addedAt: number;
}

/**
 * How far behind the share's delivery is, as the machine last measured it. It
 * is read rather than streamed, so it carries the moment it was taken.
 */
export interface RigSessionShareHealth {
    readonly condition: RigSessionShareCondition;
    /** Transcript rows written but not yet delivered to members. */
    readonly pendingEntries: number;
    /** How much those rows weigh, in bytes. */
    readonly pendingBytes: number;
    /** When this reading was taken, in milliseconds. */
    readonly checkedAt: number;
}

/** The share itself: one owner, one session, and the people watching it. */
export interface RigSessionShare {
    readonly shareId: string;
    readonly condition: RigSessionShareCondition;
    /** How many people can see this session right now. */
    readonly watching: number;
    /** Whether what friends write reaches the agent rather than only the owner. */
    readonly friendMessagesInContext: boolean;
}

/**
 * Which decision the owner currently has open over the conversation. They are
 * one field rather than four flags because they are modal: exactly one of them
 * can be being made at a time, and a second one opening replaces the first.
 */
export type RigSessionShareDialog =
    | { readonly type: "start" }
    | { readonly type: "add" }
    | { readonly type: "revoke"; readonly memberId: RigSessionShareMemberId }
    | { readonly type: "stop" };

/** One friend ticked in the picker, with the name the owner will register. */
export interface RigSessionShareChoice {
    readonly peerId: string;
    readonly displayName: string;
}

export interface RigSessionShareSnapshot {
    /** The session this is about, or nothing while no conversation is open. */
    readonly sessionId?: RigSessionId;
    /** The share on that session, absent when it is not being shared. */
    readonly share?: RigSessionShare;
    /** Everyone who has been given access, including those who have lost it. */
    readonly members: readonly RigSessionShareMember[];
    readonly health?: RigSessionShareHealth;
    /** True until the first reading of the focused session arrives. */
    readonly loading: boolean;
    /** The reading itself failed; whatever was last read stays visible beneath. */
    readonly error?: UserError;
    /** Whether the owner has the management panel open beside the conversation. */
    readonly panelOpen: boolean;
    readonly dialog?: RigSessionShareDialog;
    /** Who is ticked in the picker, in the order they were ticked. */
    readonly choices: readonly RigSessionShareChoice[];
    /** Whether the picker will let friend messages reach the agent. */
    readonly choiceFriendMessages: boolean;
    /** True while the open decision is being carried out. */
    readonly submitting: boolean;
    /** Why the last decision failed. */
    readonly submitError?: UserError;
}

/** What the store asks its owner to carry out; the transport is the owner's. */
export type RigSessionShareOutput =
    | {
          readonly type: "shareStartSubmitted";
          readonly sessionId: RigSessionId;
          readonly friends: readonly RigSessionShareChoice[];
          readonly friendMessagesInContext: boolean;
      }
    | {
          readonly type: "memberAddSubmitted";
          readonly sessionId: RigSessionId;
          readonly friend: RigSessionShareChoice;
      }
    | {
          readonly type: "memberRevokeSubmitted";
          readonly sessionId: RigSessionId;
          readonly memberId: RigSessionShareMemberId;
      }
    | { readonly type: "shareStopSubmitted"; readonly sessionId: RigSessionId }
    | {
          readonly type: "friendMessagesUpdateSubmitted";
          readonly sessionId: RigSessionId;
          readonly value: boolean;
      };

/** One reading of the share on one session, as the machine reports it. */
export interface RigSessionShareSourceReading {
    /** Absent when this session is not shared at all. */
    readonly share?: {
        readonly shareId: string;
        readonly state: string;
        readonly memberCount: number;
        readonly includeFriendMessagesInModel: boolean;
    };
    readonly members: readonly {
        readonly shareMemberId: string;
        readonly displayName: string;
        readonly murmurPeerId: string;
        readonly state: string;
        readonly createdAt: number;
    }[];
    readonly health?: {
        readonly state: string;
        readonly pendingEntries: number;
        readonly pendingBytes: number;
        readonly checkedAt: number;
    };
    /** True only before the first answer, so "not shared" is never claimed early. */
    readonly loading: boolean;
    /** Why the last attempt failed; the reading already held stays in place. */
    readonly error?: string;
}

/**
 * The share on one session, and the five decisions only its owner can make.
 *
 * The machine answers about a share rather than announcing it, so the source
 * repeats the read for as long as a session is focused and something is
 * subscribed, and stops when either stops being true. Each decision is issued
 * through the machine's own mutation queue, which is why it returns an identity
 * rather than a promise: the queue retries it, the reading confirms it, and a
 * refusal names it. `rejectionsSubscribe` is how that refusal gets back here.
 */
export interface RigSessionShareSource {
    subscribe(
        sessionId: RigSessionId,
        listener: (reading: RigSessionShareSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
    /** Starts showing this session to one or more friends. */
    shareCreate(
        sessionId: RigSessionId,
        friends: readonly RigSessionShareChoice[],
        friendMessagesInContext: boolean,
    ): string;
    /** Gives one more friend access to a share that already exists. */
    memberAdd(sessionId: RigSessionId, friend: RigSessionShareChoice): string;
    /** Takes one person's access away from this point on. */
    memberRevoke(sessionId: RigSessionId, memberId: string): string;
    /** Ends the share for everyone, permanently. */
    shareStop(sessionId: RigSessionId): string;
    /** Decides whether what friends write reaches the agent. */
    friendMessagesSet(sessionId: RigSessionId, value: boolean): string;
    /** Terminal refusals for the decisions issued above, by their identity. */
    rejectionsSubscribe(
        listener: (rejection: { readonly mutationId: string; readonly message: string }) => void,
    ): () => void;
}

export interface RigSessionShareStore {
    get(): RigSessionShareSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * Names the conversation this store is about. It is driven by whatever owns
     * navigation rather than by a surface, because the share belongs to the
     * session the reader is in, not to the panel that happens to be open. Every
     * decision in flight for the session being left is abandoned with it.
     */
    sessionFocus(sessionId?: RigSessionId): void;
    /** Shows or hides the management panel beside the conversation. */
    panelToggle(): void;
    /** Opens the picker that starts a share, or adds one more person to one. */
    choiceOpen(mode: "start" | "add"): void;
    /** Ticks or unticks one friend in the picker. */
    choiceToggle(choice: RigSessionShareChoice): void;
    /** Decides, in the picker, whether friend messages will reach the agent. */
    choiceFriendMessagesUpdate(value: boolean): void;
    /** Asks whether one person should lose access, before anything happens. */
    memberRevokeOpen(memberId: RigSessionShareMemberId): void;
    /** Asks whether the share should end, before anything happens. */
    shareStopOpen(): void;
    /** Closes whichever decision is open without making it. */
    dialogClose(): void;
    /**
     * Carries out the decision that is open. Nothing here claims the decision
     * took effect: the panel shows the attempt, and what exists changes only
     * when the machine's next reading says so.
     */
    dialogConfirm(): void;
    /** Changes whether friend messages reach the agent, on an existing share. */
    friendMessagesUpdate(value: boolean): void;
    [Symbol.dispose](): void;
}

export interface RigSessionShareStoreDeps {
    readonly source: RigSessionShareSource;
    readonly output?: (event: RigSessionShareOutput) => void;
}

const NO_MEMBERS: readonly RigSessionShareMember[] = [];
const NO_CHOICES: readonly RigSessionShareChoice[] = [];

const EMPTY: RigSessionShareSnapshot = {
    members: NO_MEMBERS,
    loading: false,
    panelOpen: false,
    choices: NO_CHOICES,
    choiceFriendMessages: true,
    submitting: false,
};

/**
 * The share on the conversation the reader is in: who can see it, how well it
 * is keeping up, and the decisions only its owner may make.
 *
 * It is one store rather than one per session because the reader is in one
 * conversation at a time, and because the panel, the indicator over the
 * transcript, and the confirmation dialogs are one surface that has to agree
 * with itself. Focusing another session abandons everything the last one was
 * showing, including a decision still in flight — that decision belongs to a
 * session nobody is looking at any more, and its outcome will be in the reading
 * when it is looked at again.
 *
 * Nothing here invents a share, a member, or an ending. Every decision is local
 * intent that asks the owner to act; the machine's reading is the only thing
 * that changes what this store says exists.
 */
/**
 * What one decision asked the machine for, so a later reading can be recognized
 * as the answer to it. Every one of them is a statement about what the reading
 * will look like once the decision has been carried out.
 */
type ShareDecision =
    | { readonly kind: "start"; readonly peerIds: readonly string[] }
    | { readonly kind: "memberAdd"; readonly peerIds: readonly string[] }
    | { readonly kind: "memberRevoke"; readonly memberId: RigSessionShareMemberId }
    | { readonly kind: "stop" }
    | { readonly kind: "friendMessages"; readonly value: boolean };

/**
 * A decision with the machine. Adding several people at once is several
 * mutations, so the identities are a set: any one of them being refused refuses
 * the decision, and the whole of it is answered only once the reading shows
 * every person in.
 */
interface SharePending {
    readonly mutationIds: ReadonlySet<string>;
    readonly sessionId: RigSessionId;
    readonly decision: ShareDecision;
}

/** A share this window watched end, as the surface must go on showing it. */
interface EndedShare {
    readonly sessionId: RigSessionId;
    readonly share: RigSessionShare;
    readonly members: readonly RigSessionShareMember[];
}

/**
 * The ending to go on showing once the machine stops reporting a share.
 *
 * It is built from the last reading that still described the share, and
 * everybody who was watching becomes somebody whose access is over, because
 * that is what ending did to them. Nobody is added and nobody is dropped: this
 * is a record of who was in the share, which is the whole of what an ended one
 * has to say.
 */
function endedRecord(
    sessionId: RigSessionId,
    share: RigSessionShare,
    members: readonly RigSessionShareMember[],
): EndedShare {
    return {
        sessionId,
        share: { ...share, condition: "ended", watching: 0 },
        members: members.map((member) =>
            member.access === "watching" ? { ...member, access: "ended" as const } : member,
        ),
    };
}

/**
 * Whether a reading is the machine's answer to the decision that is waiting.
 *
 * A share the machine no longer reports at all is the answer to a stop and to
 * nothing else: every other decision is about a share that still exists, so a
 * reading with no share in it means the queue has not carried that decision yet.
 */
function decisionAnswered(
    decision: ShareDecision,
    share: RigSessionShare | undefined,
    members: readonly RigSessionShareMember[],
): boolean {
    if (decision.kind === "stop") return share === undefined || share.condition === "ended";
    if (share === undefined) return false;
    switch (decision.kind) {
        // Starting and adding ask the same thing of the reading: everybody
        // chosen is in and can see the session. A share this window did not
        // create — another of the account's windows made one first — therefore
        // does not answer for the people this reader ticked.
        case "start":
        case "memberAdd":
            return decision.peerIds.every((peerId) =>
                members.some((member) => member.peerId === peerId && member.access === "watching"),
            );
        case "memberRevoke":
            return !members.some(
                (member) => member.id === decision.memberId && member.access === "watching",
            );
        case "friendMessages":
            return share.friendMessagesInContext === decision.value;
    }
}

export function rigSessionShareStoreCreate(deps: RigSessionShareStoreDeps): RigSessionShareStore {
    const output = deps.output ?? (() => undefined);
    const store = createStore<RigSessionShareSnapshot>()(() => EMPTY);

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let unsubscribeRejections: (() => void) | undefined;
    let focusedId: RigSessionId | undefined;
    /**
     * The decision waiting on the machine, and which session it was made in.
     *
     * It carries what was asked for rather than only an identity, because the
     * machine has no way to announce that a decision was carried out: it says
     * so only by answering differently the next time it is read. So the attempt
     * stands until a reading actually shows what was asked for, and a reading
     * that arrives while the queue is still carrying the decision changes
     * nothing. A refusal naming another identity belongs to another surface,
     * and one arriving after the reader has moved on is not this session's.
     */
    let pending: SharePending | undefined;
    /**
     * The share this window watched end, kept after the machine stopped
     * reporting it.
     *
     * A stopped share is not something the machine answers about any more — it
     * answers as though the session were never shared — so without this the
     * ending would be told by the whole surface silently vanishing, which reads
     * as nothing having happened. This is only ever set by a stop this window
     * issued and saw take effect, so it is a record of what this reader did,
     * not a guess about a share somebody else ended. It lasts until the reader
     * moves to another conversation.
     */
    let ended: EndedShare | undefined;
    let disposed = false;

    const patch = (change: Partial<RigSessionShareSnapshot>): void => {
        store.setState(change, false);
    };

    const start = (): void => {
        if (disposed || unsubscribeSource || focusedId === undefined) return;
        const sessionId = focusedId;
        unsubscribeRejections = deps.source.rejectionsSubscribe((rejection) => {
            if (disposed || pending?.mutationIds.has(rejection.mutationId) !== true) return;
            pending = undefined;
            patch({ submitting: false, submitError: rigUserError(new Error(rejection.message)) });
        });
        unsubscribeSource = deps.source.subscribe(
            sessionId,
            (reading) => {
                if (disposed || focusedId !== sessionId) return;
                const current = store.getState();
                const read = reading.share === undefined ? undefined : shareProject(reading.share);
                const readMembers = membersProject(reading.members);
                const answered =
                    pending !== undefined && decisionAnswered(pending.decision, read, readMembers);
                if (answered) pending = undefined;
                // A share is only reported while it is running, so a session the
                // machine has stopped answering about is one whose share has
                // just gone. That is an ending whoever caused it: this reader
                // stopping it, another window of the same account stopping it,
                // or the machine giving up on delivery. It is told apart from a
                // session that was simply never shared by what was on screen a
                // moment ago — a share that was here and now is not.
                if (
                    read === undefined &&
                    current.share !== undefined &&
                    current.share.condition !== "ended"
                )
                    ended = endedRecord(sessionId, current.share, current.members);
                // A share the machine is reporting again is a new one, and the
                // ending of the old one is not this share's to describe.
                if (read !== undefined && ended?.share.shareId !== read.shareId) ended = undefined;
                const remembered =
                    ended?.sessionId === sessionId && read === undefined ? ended : undefined;
                const share = remembered?.share ?? read;
                const members = referencesPreserve(
                    current.members,
                    remembered?.members ?? readMembers,
                );
                store.setState(
                    {
                        sessionId,
                        ...(share === undefined ? {} : { share }),
                        members,
                        // A share that is over is not falling behind, so the
                        // last delivery measurement taken while it ran is not
                        // something to go on showing.
                        ...(reading.health === undefined || remembered !== undefined
                            ? {}
                            : { health: healthProject(reading.health) }),
                        loading: reading.loading,
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(reading.error) }),
                        panelOpen: current.panelOpen,
                        ...(answered || current.dialog === undefined
                            ? {}
                            : { dialog: current.dialog }),
                        // A tick on somebody who is now in the share is not a
                        // choice any more: the picker stops offering them, so
                        // leaving them ticked would count somebody the reader
                        // can no longer see. This is what a partly refused add
                        // leaves behind — the people who did get in drop away,
                        // and the ones still to try stay ticked.
                        choices: answered
                            ? NO_CHOICES
                            : referencesPreserve(
                                  current.choices,
                                  current.choices.filter(
                                      (choice) =>
                                          !members.some(
                                              (member) =>
                                                  member.peerId === choice.peerId &&
                                                  member.access === "watching",
                                          ),
                                  ),
                              ),
                        choiceFriendMessages: current.choiceFriendMessages,
                        submitting: answered ? false : current.submitting,
                        ...(answered || current.submitError === undefined
                            ? {}
                            : { submitError: current.submitError }),
                    },
                    true,
                );
            },
            (error) => {
                if (disposed || focusedId !== sessionId) return;
                patch({ error: rigUserError(error), loading: false });
            },
        );
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
        unsubscribeRejections?.();
        unsubscribeRejections = undefined;
    };

    /** Records the decision now waiting on the machine, and shows the attempt. */
    const issue = (
        sessionId: RigSessionId,
        decision: ShareDecision,
        mutationIds: readonly string[],
    ): void => {
        pending = { mutationIds: new Set(mutationIds), sessionId, decision };
        patch({ submitting: true, submitError: undefined });
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
        sessionFocus(sessionId) {
            if (disposed || focusedId === sessionId) return;
            focusedId = sessionId;
            pending = undefined;
            // What this window watched end belongs to the conversation it
            // happened in, so it does not travel to the next one.
            ended = undefined;
            stop();
            // Everything on screen described the session being left, including
            // whether the panel was open: a share panel carried into a
            // conversation with no share behind it would be a control with
            // nothing to control.
            store.setState(
                sessionId === undefined ? EMPTY : { ...EMPTY, sessionId, loading: true },
                true,
            );
            if (listeners.size > 0) start();
        },
        panelToggle() {
            patch({ panelOpen: !store.getState().panelOpen });
        },
        choiceOpen(mode) {
            patch({
                dialog: { type: mode },
                choices: NO_CHOICES,
                choiceFriendMessages: store.getState().share?.friendMessagesInContext ?? true,
                submitError: undefined,
            });
        },
        choiceToggle(choice) {
            const choices = store.getState().choices;
            patch({
                choices: choices.some((candidate) => candidate.peerId === choice.peerId)
                    ? choices.filter((candidate) => candidate.peerId !== choice.peerId)
                    : [...choices, choice],
                submitError: undefined,
            });
        },
        choiceFriendMessagesUpdate(value) {
            patch({ choiceFriendMessages: value });
        },
        memberRevokeOpen(memberId) {
            patch({ dialog: { type: "revoke", memberId }, submitError: undefined });
        },
        shareStopOpen() {
            patch({ dialog: { type: "stop" }, submitError: undefined });
        },
        dialogClose() {
            // A decision already with the machine is not withdrawn by closing
            // the question that asked for it, so the attempt is left standing
            // and only the dialog goes away.
            patch({ dialog: undefined, choices: NO_CHOICES, submitError: undefined });
        },
        dialogConfirm() {
            const current = store.getState();
            const sessionId = current.sessionId;
            const dialog = current.dialog;
            if (!sessionId || !dialog || current.submitting) return;
            if (dialog.type === "start") {
                // A share with nobody in it is not a share, so an empty picker
                // is simply not a decision and nothing leaves.
                if (current.choices.length === 0) return;
                issue(
                    sessionId,
                    { kind: "start", peerIds: current.choices.map((choice) => choice.peerId) },
                    [
                        deps.source.shareCreate(
                            sessionId,
                            current.choices,
                            current.choiceFriendMessages,
                        ),
                    ],
                );
                output({
                    type: "shareStartSubmitted",
                    sessionId,
                    friends: current.choices,
                    friendMessagesInContext: current.choiceFriendMessages,
                });
                return;
            }
            if (dialog.type === "add") {
                // Adding is one decision made about several people, so it is
                // one attempt over as many mutations as there are people: the
                // picker offers a set, and everyone in it must arrive.
                const friends = current.choices;
                if (friends.length === 0) return;
                issue(
                    sessionId,
                    { kind: "memberAdd", peerIds: friends.map((friend) => friend.peerId) },
                    friends.map((friend) => deps.source.memberAdd(sessionId, friend)),
                );
                for (const friend of friends)
                    output({ type: "memberAddSubmitted", sessionId, friend });
                return;
            }
            if (dialog.type === "revoke") {
                issue(sessionId, { kind: "memberRevoke", memberId: dialog.memberId }, [
                    deps.source.memberRevoke(sessionId, dialog.memberId),
                ]);
                output({
                    type: "memberRevokeSubmitted",
                    sessionId,
                    memberId: dialog.memberId,
                });
                return;
            }
            issue(sessionId, { kind: "stop" }, [deps.source.shareStop(sessionId)]);
            output({ type: "shareStopSubmitted", sessionId });
        },
        friendMessagesUpdate(value) {
            const current = store.getState();
            const sessionId = current.sessionId;
            if (!sessionId || !current.share || current.submitting) return;
            if (current.share.friendMessagesInContext === value) return;
            issue(sessionId, { kind: "friendMessages", value }, [
                deps.source.friendMessagesSet(sessionId, value),
            ]);
            output({ type: "friendMessagesUpdateSubmitted", sessionId, value });
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

/**
 * A share store for a Rig that cannot share sessions at all. It is permanently
 * empty and settled rather than loading, so a surface that must subscribe
 * unconditionally reads "this machine cannot say" instead of waiting forever
 * for a reading that is not coming.
 */
export const rigSessionShareStoreNoop: RigSessionShareStore = {
    get: () => EMPTY,
    subscribe: () => () => undefined,
    sessionFocus: () => undefined,
    panelToggle: () => undefined,
    choiceOpen: () => undefined,
    choiceToggle: () => undefined,
    choiceFriendMessagesUpdate: () => undefined,
    memberRevokeOpen: () => undefined,
    shareStopOpen: () => undefined,
    dialogClose: () => undefined,
    dialogConfirm: () => undefined,
    friendMessagesUpdate: () => undefined,
    [Symbol.dispose]: () => undefined,
};

/**
 * The machine names the three conditions in its own words; a word it has not
 * used before is read as the share still being live, because a share the
 * machine is still reporting on is one that still exists.
 */
function conditionProject(state: string): RigSessionShareCondition {
    if (state === "stopped") return "ended";
    if (state === "degraded") return "behind";
    return "live";
}

function accessProject(state: string): RigSessionShareAccess {
    if (state === "revoked") return "revoked";
    if (state === "stopped") return "ended";
    return "watching";
}

function shareProject(share: {
    readonly shareId: string;
    readonly state: string;
    readonly memberCount: number;
    readonly includeFriendMessagesInModel: boolean;
}): RigSessionShare {
    return {
        shareId: share.shareId,
        condition: conditionProject(share.state),
        watching: share.memberCount,
        friendMessagesInContext: share.includeFriendMessagesInModel,
    };
}

function healthProject(health: {
    readonly state: string;
    readonly pendingEntries: number;
    readonly pendingBytes: number;
    readonly checkedAt: number;
}): RigSessionShareHealth {
    return {
        condition: conditionProject(health.state),
        pendingEntries: health.pendingEntries,
        pendingBytes: health.pendingBytes,
        checkedAt: health.checkedAt,
    };
}

/**
 * People in the order they were given access, oldest first: this is a record of
 * who was let in and when, and it reads as one.
 */
function membersProject(
    source: RigSessionShareSourceReading["members"],
): readonly RigSessionShareMember[] {
    return source
        .map(
            (member): RigSessionShareMember => ({
                id: member.shareMemberId as RigSessionShareMemberId,
                name: member.displayName,
                peerId: member.murmurPeerId,
                access: accessProject(member.state),
                addedAt: member.createdAt,
            }),
        )
        .sort((left, right) => left.addedAt - right.addedAt);
}
