import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";

declare const rigFriendRequestIdBrand: unique symbol;
declare const rigFriendIdBrand: unique symbol;

/** Branded identity of one connection request waiting on an answer. */
export type RigFriendRequestId = string & { readonly [rigFriendRequestIdBrand]: true };

/** Branded identity of one person this account is connected to. */
export type RigFriendId = string & { readonly [rigFriendIdBrand]: true };

/** Accepting takes the person into the list; rejecting drops the request. */
export type RigFriendAnswer = "accept" | "reject";

/**
 * How a person is named and pictured. A last name is optional because plenty of
 * people are known by one name here, and a picture is optional because a face is
 * something someone chooses to give rather than something the product requires.
 */
export interface RigFriendProfile {
    readonly firstName: string;
    readonly lastName?: string;
    /** The person's picture, ready to render; absent when they have none. */
    readonly photoUrl?: string;
}

/** This account's own presence in the network, once it exists. */
export interface RigFriendsAccount {
    readonly id: string;
    readonly profile: RigFriendProfile;
}

/** Someone asking to connect, and when they asked. */
export interface RigFriendRequest {
    readonly id: RigFriendRequestId;
    readonly senderId: string;
    readonly profile: RigFriendProfile;
    /** When the request arrived, in milliseconds. */
    readonly receivedAt: number;
}

/** Someone this account is already connected to. */
export interface RigFriend {
    readonly id: RigFriendId;
    readonly profile: RigFriendProfile;
    /** When the connection was made, in milliseconds. */
    readonly addedAt: number;
}

/** A picture chosen for a profile that has not been sent yet. */
export interface RigFriendsPhotoDraft {
    /** The picture's bytes, base64 encoded, without a data-URL prefix. */
    readonly data: string;
    readonly mediaType: string;
    /** The same picture as a data URL, so it can be seen before it is sent. */
    readonly previewUrl: string;
}

/**
 * The profile someone is filling in. It lives here rather than in the form so
 * the half-written answer survives leaving the surface and coming back, which is
 * the difference between a form and a decision someone is still making.
 */
export interface RigFriendsProfileDraft {
    readonly firstName: string;
    readonly lastName: string;
    readonly photo?: RigFriendsPhotoDraft;
    /** True while the daemon is signing this profile up. */
    readonly submitting: boolean;
    /** Why the last attempt to create the profile failed. */
    readonly error?: UserError;
}

/** How one answer to a request is going, for the card that shows it. */
export type RigFriendsAnswerState =
    | { readonly type: "pending"; readonly answer: RigFriendAnswer }
    | { readonly type: "failed"; readonly answer: RigFriendAnswer; readonly error: UserError };

/** One reading of this account, its waiting requests, and the people it knows. */
export interface RigFriendsSourceReading {
    /** Absent while no profile has been created on this machine. */
    readonly account?: RigFriendsSourceAccount;
    readonly requests: readonly RigFriendsSourceRequest[];
    readonly friends: readonly RigFriendsSourceFriend[];
    /** True only before the first answer, so "nobody yet" is never claimed early. */
    readonly loading: boolean;
    /** Why the last attempt failed; the readings already held stay in place. */
    readonly error?: string;
}

export interface RigFriendsSourceProfile {
    readonly firstName: string;
    readonly lastName?: string;
    readonly photoUrl?: string;
}

export interface RigFriendsSourceAccount {
    readonly id: string;
    readonly profile: RigFriendsSourceProfile;
}

export interface RigFriendsSourceRequest {
    readonly id: string;
    readonly senderId: string;
    readonly profile: RigFriendsSourceProfile;
    readonly receivedAt: number;
}

export interface RigFriendsSourceFriend {
    readonly id: string;
    readonly profile: RigFriendsSourceProfile;
    readonly addedAt: number;
}

/** What signing up sends: the name someone gave, and the picture if they gave one. */
export interface RigFriendsSignupInput {
    readonly firstName: string;
    readonly lastName?: string;
    readonly photo?: { readonly data: string; readonly mediaType: string };
}

/**
 * The friends feed for one Rig, and the two things that can be done to it.
 *
 * The daemon reports requests on request rather than pushing them, so the source
 * repeats the read for as long as something is subscribed and stops when nothing
 * is: a surface nobody is looking at asks the machine nothing. Both actions
 * resolve when the daemon has carried them out, and the source is expected to
 * read again immediately afterwards so the surface never waits a whole interval
 * to catch up with a decision that was just made.
 */
export interface RigFriendsSource {
    subscribe(
        listener: (reading: RigFriendsSourceReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
    /** Creates this machine's profile in the network. */
    signup(input: RigFriendsSignupInput): Promise<void>;
    /** Answers one waiting request. */
    requestAnswer(requestId: string, answer: RigFriendAnswer): Promise<void>;
}

export interface RigFriendsSnapshot {
    /** This account's own profile, absent until one is created. */
    readonly account?: RigFriendsAccount;
    /** People waiting on an answer, most recent first. */
    readonly requests: readonly RigFriendRequest[];
    /** People already connected, most recently added first. */
    readonly friends: readonly RigFriend[];
    /** True until the first reading arrives. */
    readonly loading: boolean;
    /** Set when the feed itself failed; what was last read stays visible beneath it. */
    readonly error?: UserError;
    /** The profile being filled in, whether or not one exists yet. */
    readonly draft: RigFriendsProfileDraft;
    /** In-flight and failed answers, by request. */
    readonly answers: ReadonlyMap<RigFriendRequestId, RigFriendsAnswerState>;
}

/** What the store asks its owner to carry out; the transport is the owner's. */
export type RigFriendsOutput =
    | {
          readonly type: "profileCreateSubmitted";
          readonly firstName: string;
          readonly lastName?: string;
          readonly photo?: { readonly data: string; readonly mediaType: string };
      }
    | {
          readonly type: "requestAnswerSubmitted";
          readonly requestId: RigFriendRequestId;
          readonly answer: RigFriendAnswer;
      };

/** Authoritative results of the work the owner carried out. */
export type RigFriendsInput =
    | { readonly type: "profileCreateSucceeded" }
    | { readonly type: "profileCreateFailed"; readonly error: unknown }
    | { readonly type: "requestAnswerSucceeded"; readonly requestId: RigFriendRequestId }
    | {
          readonly type: "requestAnswerFailed";
          readonly requestId: RigFriendRequestId;
          readonly error: unknown;
      };

export interface RigFriendsStore {
    get(): RigFriendsSnapshot;
    subscribe(listener: () => void): () => void;
    /** Types the first name of the profile being created. */
    firstNameUpdate(value: string): void;
    /** Types the last name, which may stay empty. */
    lastNameUpdate(value: string): void;
    /** Chooses the picture for the profile being created. */
    photoAttach(photo: RigFriendsPhotoDraft): void;
    /** Takes the chosen picture back off. */
    photoRemove(): void;
    /**
     * Asks for this profile to be created. A blank first name is not a request,
     * so nothing leaves; otherwise the form shows the attempt and the account
     * appears only when the daemon reports it, never because this store assumed
     * it.
     */
    profileCreate(): void;
    /**
     * Accepts or rejects one waiting request. The card shows the answer
     * immediately, but the request stays in the list until the daemon's next
     * reading drops it: an answer is the daemon's to confirm.
     */
    requestAnswer(requestId: RigFriendRequestId, answer: RigFriendAnswer): void;
    /** Private authoritative input: how the owner's attempt actually ended. */
    friendsInput(event: RigFriendsInput): void;
    [Symbol.dispose](): void;
}

export interface RigFriendsStoreDeps {
    readonly source: RigFriendsSource;
    readonly output?: (event: RigFriendsOutput) => void;
}

const EMPTY_ANSWERS: ReadonlyMap<RigFriendRequestId, RigFriendsAnswerState> = new Map();

const EMPTY_DRAFT: RigFriendsProfileDraft = { firstName: "", lastName: "", submitting: false };

/**
 * Who this account is, who wants to know it, and who it already knows — as one
 * surface, because those three facts are read together and are meaningless
 * apart: a request means nothing until there is a profile to accept it with.
 *
 * The constructor opens nothing. The first subscriber starts the reading cycle
 * and the last one to leave stops it, so friends are watched only while someone
 * is watching them. Readings are authoritative and replace the lists wholesale,
 * with unchanged people keeping their identity so a row does not blink every
 * few seconds. Everything a person types is local intent that asks the owner to
 * act; nothing here invents a confirmed profile or a settled request.
 */
export function rigFriendsStoreCreate(deps: RigFriendsStoreDeps): RigFriendsStore {
    const output = deps.output ?? (() => undefined);
    const store = createStore<RigFriendsSnapshot>()(() => ({
        requests: [],
        friends: [],
        loading: true,
        draft: EMPTY_DRAFT,
        answers: EMPTY_ANSWERS,
    }));

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    const draftUpdate = (change: Partial<RigFriendsProfileDraft>): void => {
        store.setState({ draft: { ...store.getState().draft, ...change } }, false);
    };

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (disposed) return;
                const current = store.getState();
                const requests = referencesPreserve(
                    current.requests,
                    requestsProject(reading.requests),
                );
                const friends = referencesPreserve(
                    current.friends,
                    friendsProject(reading.friends),
                );
                // An answered request is gone from the reading, so the answer we
                // were showing for it has served its purpose.
                const live = new Set(requests.map((request) => request.id));
                let answers = current.answers;
                if ([...answers.keys()].some((id) => !live.has(id))) {
                    const next = new Map(answers);
                    for (const id of answers.keys()) if (!live.has(id)) next.delete(id);
                    answers = next;
                }
                store.setState(
                    {
                        ...(reading.account === undefined
                            ? {}
                            : { account: accountProject(reading.account) }),
                        requests,
                        friends,
                        loading: reading.loading,
                        ...(reading.error === undefined
                            ? {}
                            : { error: rigUserError(reading.error) }),
                        draft: current.draft,
                        answers,
                    },
                    true,
                );
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
        firstNameUpdate(value) {
            draftUpdate({ firstName: value, error: undefined });
        },
        lastNameUpdate(value) {
            draftUpdate({ lastName: value, error: undefined });
        },
        photoAttach(photo) {
            draftUpdate({ photo, error: undefined });
        },
        photoRemove() {
            draftUpdate({ photo: undefined, error: undefined });
        },
        profileCreate() {
            const draft = store.getState().draft;
            if (draft.submitting) return;
            const firstName = draft.firstName.trim();
            if (firstName === "") return;
            const lastName = draft.lastName.trim();
            draftUpdate({ submitting: true, error: undefined });
            output({
                type: "profileCreateSubmitted",
                firstName,
                ...(lastName === "" ? {} : { lastName }),
                ...(draft.photo
                    ? { photo: { data: draft.photo.data, mediaType: draft.photo.mediaType } }
                    : {}),
            });
        },
        requestAnswer(requestId, answer) {
            const current = store.getState();
            if (!current.requests.some((request) => request.id === requestId)) return;
            if (current.answers.get(requestId)?.type === "pending") return;
            const answers = new Map(current.answers);
            answers.set(requestId, { type: "pending", answer });
            store.setState({ answers }, false);
            output({ type: "requestAnswerSubmitted", requestId, answer });
        },
        friendsInput(event) {
            if (event.type === "profileCreateSucceeded") {
                // The daemon still owes us the reading that carries the account;
                // until then the form simply stops showing an attempt, and the
                // draft is emptied because it has been spent.
                store.setState({ draft: EMPTY_DRAFT }, false);
                return;
            }
            if (event.type === "profileCreateFailed") {
                draftUpdate({ submitting: false, error: rigUserError(event.error) });
                return;
            }
            const answers = new Map(store.getState().answers);
            if (event.type === "requestAnswerSucceeded") {
                // The request leaves the list when the next reading drops it, so
                // the card only stops showing an answer of its own.
                answers.delete(event.requestId);
            } else {
                const pending = answers.get(event.requestId);
                answers.set(event.requestId, {
                    type: "failed",
                    answer: pending?.answer ?? "accept",
                    error: rigUserError(event.error),
                });
            }
            store.setState({ answers }, false);
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

const INERT_SNAPSHOT: RigFriendsSnapshot = {
    requests: [],
    friends: [],
    loading: false,
    draft: EMPTY_DRAFT,
    answers: EMPTY_ANSWERS,
};

/**
 * Friends for a Rig that offers none. It is permanently empty and settled rather
 * than loading, so a surface that must subscribe unconditionally reads "this
 * machine cannot say" instead of waiting forever for a reading that is not
 * coming.
 */
export const rigFriendsStoreNoop: RigFriendsStore = {
    get: () => INERT_SNAPSHOT,
    subscribe: () => () => undefined,
    firstNameUpdate: () => undefined,
    lastNameUpdate: () => undefined,
    photoAttach: () => undefined,
    photoRemove: () => undefined,
    profileCreate: () => undefined,
    requestAnswer: () => undefined,
    friendsInput: () => undefined,
    [Symbol.dispose]: () => undefined,
};

function profileProject(profile: RigFriendsSourceProfile): RigFriendProfile {
    return {
        firstName: profile.firstName,
        ...(profile.lastName === undefined || profile.lastName === ""
            ? {}
            : { lastName: profile.lastName }),
        ...(profile.photoUrl === undefined ? {} : { photoUrl: profile.photoUrl }),
    };
}

function accountProject(account: RigFriendsSourceAccount): RigFriendsAccount {
    return { id: account.id, profile: profileProject(account.profile) };
}

/** Newest first: a request that just arrived is the one being looked for. */
function requestsProject(source: readonly RigFriendsSourceRequest[]): readonly RigFriendRequest[] {
    return source
        .map(
            (request): RigFriendRequest => ({
                id: request.id as RigFriendRequestId,
                senderId: request.senderId,
                profile: profileProject(request.profile),
                receivedAt: request.receivedAt,
            }),
        )
        .sort((left, right) => right.receivedAt - left.receivedAt);
}

/** Newest first as well, so the person just added is at the top where they are looked for. */
function friendsProject(source: readonly RigFriendsSourceFriend[]): readonly RigFriend[] {
    return source
        .map(
            (friend): RigFriend => ({
                id: friend.id as RigFriendId,
                profile: profileProject(friend.profile),
                addedAt: friend.addedAt,
            }),
        )
        .sort((left, right) => right.addedAt - left.addedAt);
}

/** How a person is addressed in one line: both names when there are two. */
export function rigFriendName(profile: RigFriendProfile): string {
    return profile.lastName ? `${profile.firstName} ${profile.lastName}` : profile.firstName;
}

/** The one or two letters that stand in for a face nobody has given a picture to. */
export function rigFriendInitials(profile: RigFriendProfile): string {
    const first = profile.firstName.trim().charAt(0);
    const last = profile.lastName?.trim().charAt(0) ?? "";
    return `${first}${last}`.toUpperCase() || "?";
}
