import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";
import type { RigFolderId } from "./rigTypes.js";

/**
 * The human behind a contact, as their own Rig published it.
 *
 * Absent while the far machine has not shared one yet. A contact is still a
 * contact then — the identity is what the two Rigs agreed on — so the surface
 * shows the identity rather than pretending there is nobody there.
 */
export interface RigSharingProfile {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly photo?: {
        readonly imageUrl: string;
        readonly width: number;
        readonly height: number;
        readonly thumbhash: string;
    };
}

/** One person this Rig shares with, keyed by the identity they proved. */
export interface RigSharingContact {
    readonly identity: string;
    /** `removing` while the Rig is still tearing the relationship down. */
    readonly status: "active" | "removing";
    readonly profile?: RigSharingProfile;
}

/** Someone asking to become a contact, waiting on an answer here. */
export interface RigSharingIncomingRequest {
    readonly id: string;
    readonly identity: string;
    readonly profile?: RigSharingProfile;
}

/** A request this Rig sent that the other side has not answered yet. */
export interface RigSharingOutgoingRequest {
    readonly id: string;
    readonly identity: string;
}

/** Where this Rig's sharing link stands with the network it publishes on. */
export type RigSharingConnection = "connecting" | "connected" | "disconnected";

/** One root folder's Murmur group and the latest sync state the Rig reported. */
export interface RigFolderShare {
    readonly groupId: string;
    readonly rootFolderId: RigFolderId;
    readonly members: readonly string[];
    readonly status: "syncing" | "synced" | "error";
    readonly lastSyncedAt?: number;
    readonly error?: string;
}

/**
 * The authoritative sharing picture, exactly as the Rig reports it.
 *
 * `profileId` is the whole of the enrolment question: a Rig that opted out of
 * Murmur has none, and no contact surface should be offered for it. It is
 * reported rather than inferred from the contact list, because a Rig that is
 * enrolled and has nobody yet is not the same thing as one that never enrolled.
 */
export interface RigSharingReading {
    readonly connection: RigSharingConnection;
    readonly identity: string;
    readonly profileId?: string;
    readonly contacts: readonly RigSharingContact[];
    readonly incomingRequests: readonly RigSharingIncomingRequest[];
    readonly outgoingRequests: readonly RigSharingOutgoingRequest[];
    /** Shared roots and their live Murmur sync state. */
    readonly folderShares: readonly RigFolderShare[];
}

/** An invitation this Rig made, for someone else to redeem. */
export interface RigSharingInvitation {
    readonly invitation: string;
    /** When it stops being redeemable, in milliseconds. */
    readonly expiresAt: number;
}

/**
 * The Rig's sharing service.
 *
 * Only the host owns this. A machine reached through the host shares under the
 * host's own identity, so there is no peer-side variant and nothing here is
 * ever handed a node connection.
 *
 * The feed is the Rig's: it publishes a whole snapshot when anything changes,
 * so this subscribes when a surface is watching and stops when the last one
 * leaves. Nothing here polls.
 */
export interface RigSharingSource {
    subscribe(
        listener: (reading: RigSharingReading) => void,
        onError: (error: unknown) => void,
    ): () => void;
    /** Makes an invitation for one other person to redeem. */
    invitationCreate(): Promise<RigSharingInvitation>;
    /** Redeems an invitation made by someone else, asking to be their contact. */
    contactRequest(invitation: string): Promise<RigSharingOutgoingRequest>;
    /** Answers someone who asked to become a contact here. */
    requestAnswer(requestId: string, accept: boolean): Promise<RigSharingReading>;
    /** Ends the relationship with one contact. */
    contactRemove(identity: string): Promise<RigSharingReading>;
    /** Creates one sharing group for a root folder and the selected contacts. */
    folderShare(folderId: RigFolderId, contacts: readonly string[]): Promise<RigFolderShare>;
    /** Replaces this Rig's Murmur identity and clears every local sharing relationship. */
    reset(): Promise<RigSharingReading>;
}

/** The invitation being pasted in, and whether it has been sent yet. */
export interface RigSharingRequestDraft {
    readonly invitation: string;
    readonly submitting: boolean;
}

/** The folder-sharing choice currently open in the window. */
export interface RigFolderShareDraft {
    readonly folderId: RigFolderId;
    readonly selectedContactIdentities: readonly string[];
    readonly submitting: boolean;
    readonly error?: string;
}

export interface RigSharingSnapshot {
    /** False until the Rig has answered at all. */
    readonly loading: boolean;
    readonly connection: RigSharingConnection;
    /** This Rig's own sharing identity, once it has published one. */
    readonly identity?: string;
    /**
     * The profile this Rig shares as. Absent means Murmur was declined, and no
     * contact surface belongs on screen for it.
     */
    readonly profileId?: string;
    readonly contacts: readonly RigSharingContact[];
    readonly incomingRequests: readonly RigSharingIncomingRequest[];
    readonly outgoingRequests: readonly RigSharingOutgoingRequest[];
    /** Shared roots and the latest status from their live sync feed. */
    readonly folderShares: readonly RigFolderShare[];
    /** True while the add-a-contact surface is open. */
    readonly addOpen: boolean;
    /** The invitation this Rig made, once it has made one. */
    readonly invitation?: RigSharingInvitation;
    /** True while an invitation is being made. */
    readonly creating: boolean;
    /** The invitation being pasted in to ask someone to be a contact. */
    readonly request: RigSharingRequestDraft;
    /** Requests currently being accepted or rejected, by request id. */
    readonly answering: ReadonlySet<string>;
    /** The folder-sharing surface, when one is open. */
    readonly folderShare?: RigFolderShareDraft;
    /** Why the feed itself failed, when it failed. */
    readonly error?: UserError;
    /** Why the last act was refused, in the Rig's own words. */
    readonly actionError?: string;
    /** True while the destructive reset confirmation is shown. */
    readonly resetConfirming: boolean;
    /** True while Rig is replacing the Murmur state. */
    readonly resetting: boolean;
}

export interface RigSharingStore {
    get(): RigSharingSnapshot;
    subscribe(listener: () => void): () => void;
    /** Opens the surface for making an invitation or redeeming one. */
    contactAddOpen(): void;
    /** Closes it, discarding the invitation on screen but revoking nothing. */
    contactAddClose(): void;
    /**
     * Asks the Rig for an invitation. It appears only once the Rig answers, so
     * what is on screen is always an invitation that can actually be redeemed.
     */
    invitationCreate(): void;
    /** Types or pastes the invitation someone else made. */
    requestInvitationUpdate(value: string): void;
    /** Sends the contact request. A blank invitation is not one, so nothing leaves. */
    requestSubmit(): void;
    /** Accepts someone waiting to become a contact. */
    requestAccept(requestId: string): void;
    /** Refuses someone waiting to become a contact. */
    requestReject(requestId: string): void;
    /** Ends the relationship with one contact. */
    contactRemove(identity: string): void;
    /** Opens the destructive Murmur reset confirmation. */
    resetOpen(): void;
    /** Closes the reset confirmation without changing Murmur. */
    resetCancel(): void;
    /** Clears Murmur's identity, contacts, requests, and folder shares. */
    resetConfirm(): void;
    /** Opens sharing for a folder, or its live details when it is already shared. */
    folderShareOpen(folderId: RigFolderId): void;
    /** Adds or removes one active contact from the new share. */
    folderShareContactToggle(identity: string): void;
    /** Creates the folder's Murmur group with the selected contacts. */
    folderShareSubmit(): void;
    /** Closes the folder-sharing surface. */
    folderShareClose(): void;
    [Symbol.dispose](): void;
}

export interface RigSharingStoreDeps {
    readonly source: RigSharingSource;
}

const EMPTY_REQUEST: RigSharingRequestDraft = { invitation: "", submitting: false };
const NO_ANSWERING: ReadonlySet<string> = new Set<string>();

/**
 * Who this Rig shares work with, from one surface.
 *
 * A contact is made in two halves: one side produces an invitation, the other
 * redeems it, and the first side then answers the request that arrives. Both
 * halves live here because they are one act to the person doing it, and either
 * end of it may be the one sitting at this window.
 *
 * The store predicts no remote outcome. Once Rig confirms an outgoing request
 * is durable, that request stays visible until the authoritative feed observes
 * it; becoming a contact still waits for the Rig's snapshot because the
 * handshake is between two machines and this one does not decide how it ended.
 */
export function rigSharingStoreCreate(deps: RigSharingStoreDeps): RigSharingStore {
    const store = createStore<RigSharingSnapshot>()(() => ({
        loading: true,
        connection: "connecting" as const,
        contacts: [],
        incomingRequests: [],
        outgoingRequests: [],
        folderShares: [],
        addOpen: false,
        creating: false,
        request: EMPTY_REQUEST,
        answering: NO_ANSWERING,
        resetConfirming: false,
        resetting: false,
    }));

    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;
    const pendingOutgoing = new Map<string, RigSharingOutgoingRequest>();

    /**
     * Which reading is current. An answer that arrives after the store stopped
     * watching describes something nobody is looking at, so it is dropped rather
     * than written over what replaced it.
     */
    let generation = 0;

    const readingInput = (reading: RigSharingReading): void => {
        if (disposed) return;
        const current = store.getState();
        if (current.resetting) return;
        const authoritativeOutgoingIds = new Set(
            reading.outgoingRequests.map((request) => request.id),
        );
        const resolvedIdentities = new Set([
            ...reading.contacts.map((contact) => contact.identity),
            ...reading.incomingRequests.map((request) => request.identity),
        ]);
        for (const [id, request] of pendingOutgoing) {
            if (authoritativeOutgoingIds.has(id) || resolvedIdentities.has(request.identity)) {
                pendingOutgoing.delete(id);
            }
        }
        const outgoingRequests = [...reading.outgoingRequests];
        for (const request of pendingOutgoing.values()) {
            if (!authoritativeOutgoingIds.has(request.id)) outgoingRequests.push(request);
        }
        store.setState({
            ...current,
            loading: false,
            connection: reading.connection,
            identity: reading.identity,
            contacts: referencesPreserve(current.contacts, reading.contacts),
            incomingRequests: referencesPreserve(
                current.incomingRequests,
                reading.incomingRequests,
            ),
            outgoingRequests: referencesPreserve(current.outgoingRequests, outgoingRequests),
            folderShares: referencesPreserve(current.folderShares, reading.folderShares),
            error: undefined,
            ...(reading.profileId === undefined
                ? { profileId: undefined }
                : { profileId: reading.profileId }),
        });
    };

    const answeringSet = (requestId: string, answering: boolean): void => {
        const current = store.getState();
        const next = new Set(current.answering);
        if (answering) next.add(requestId);
        else next.delete(requestId);
        store.setState({ ...current, answering: next });
    };

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        const current = generation;
        unsubscribeSource = deps.source.subscribe(
            (reading) => {
                if (current !== generation) return;
                readingInput(reading);
            },
            (error) => {
                if (disposed || current !== generation) return;
                store.setState({
                    ...store.getState(),
                    loading: false,
                    error: rigUserError(error),
                });
            },
        );
    };

    const stop = (): void => {
        generation += 1;
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
        contactAddOpen() {
            if (disposed) return;
            store.setState({ ...store.getState(), addOpen: true, actionError: undefined });
        },
        contactAddClose() {
            if (disposed) return;
            // The invitation is dropped from the screen rather than revoked: the
            // Rig offers no cancellation, and one already sent to someone must
            // keep working after the dialog is closed.
            store.setState({
                ...store.getState(),
                addOpen: false,
                creating: false,
                invitation: undefined,
                request: EMPTY_REQUEST,
                actionError: undefined,
            });
        },
        invitationCreate() {
            if (disposed) return;
            const current = store.getState();
            if (current.creating) return;
            const attempt = generation;
            store.setState({
                ...current,
                creating: true,
                invitation: undefined,
                actionError: undefined,
            });
            deps.source.invitationCreate().then(
                (invitation) => {
                    if (disposed || attempt !== generation) return;
                    store.setState({ ...store.getState(), creating: false, invitation });
                },
                (error: unknown) => {
                    if (disposed || attempt !== generation) return;
                    store.setState({
                        ...store.getState(),
                        creating: false,
                        actionError: rigUserError(error).message,
                    });
                },
            );
        },
        requestInvitationUpdate(value) {
            if (disposed) return;
            const current = store.getState();
            if (current.request.submitting) return;
            store.setState({
                ...current,
                request: { ...current.request, invitation: value },
                actionError: undefined,
            });
        },
        requestSubmit() {
            if (disposed) return;
            const current = store.getState();
            const invitation = current.request.invitation.trim();
            if (!invitation || current.request.submitting) return;
            const attempt = generation;
            store.setState({
                ...current,
                request: { invitation, submitting: true },
                actionError: undefined,
            });
            deps.source.contactRequest(invitation).then(
                (outgoing) => {
                    if (disposed || attempt !== generation) return;
                    pendingOutgoing.set(outgoing.id, outgoing);
                    const next = store.getState();
                    store.setState({
                        ...next,
                        outgoingRequests: next.outgoingRequests.some(
                            (request) => request.id === outgoing.id,
                        )
                            ? next.outgoingRequests
                            : [...next.outgoingRequests, outgoing],
                        request: EMPTY_REQUEST,
                    });
                },
                (error: unknown) => {
                    if (disposed || attempt !== generation) return;
                    const next = store.getState();
                    store.setState({
                        ...next,
                        request: { ...next.request, submitting: false },
                        actionError: rigUserError(error).message,
                    });
                },
            );
        },
        requestAccept(requestId) {
            answerRequest(requestId, true);
        },
        requestReject(requestId) {
            answerRequest(requestId, false);
        },
        contactRemove(identity) {
            if (disposed) return;
            const attempt = generation;
            store.setState({ ...store.getState(), actionError: undefined });
            deps.source.contactRemove(identity).then(
                (reading) => {
                    if (disposed || attempt !== generation) return;
                    readingInput(reading);
                },
                (error: unknown) => {
                    if (disposed || attempt !== generation) return;
                    store.setState({
                        ...store.getState(),
                        actionError: rigUserError(error).message,
                    });
                },
            );
        },
        resetOpen() {
            if (disposed) return;
            const current = store.getState();
            if (current.resetting) return;
            store.setState({
                ...current,
                resetConfirming: true,
                actionError: undefined,
            });
        },
        resetCancel() {
            if (disposed) return;
            const current = store.getState();
            if (current.resetting || !current.resetConfirming) return;
            store.setState({ ...current, resetConfirming: false });
        },
        resetConfirm() {
            if (disposed) return;
            const previous = store.getState();
            if (!previous.resetConfirming || previous.resetting) return;
            const attempt = generation;
            pendingOutgoing.clear();
            store.setState({
                ...previous,
                connection: "connecting",
                identity: undefined,
                contacts: [],
                incomingRequests: [],
                outgoingRequests: [],
                folderShares: [],
                resetting: true,
                actionError: undefined,
            });
            deps.source.reset().then(
                (reading) => {
                    if (disposed || attempt !== generation) return;
                    store.setState({
                        ...store.getState(),
                        resetConfirming: false,
                        resetting: false,
                    });
                    readingInput(reading);
                },
                (error: unknown) => {
                    if (disposed || attempt !== generation) return;
                    store.setState({
                        ...previous,
                        resetConfirming: false,
                        resetting: false,
                        actionError: rigUserError(error).message,
                    });
                },
            );
        },
        folderShareOpen(folderId) {
            if (disposed) return;
            const current = store.getState();
            const existing = current.folderShares.find((share) => share.rootFolderId === folderId);
            store.setState({
                ...current,
                folderShare: {
                    folderId,
                    selectedContactIdentities:
                        existing?.members.filter((identity) => identity !== current.identity) ?? [],
                    submitting: false,
                },
            });
        },
        folderShareContactToggle(identity) {
            if (disposed) return;
            const current = store.getState();
            const draft = current.folderShare;
            if (!draft || draft.submitting) return;
            if (
                !current.contacts.some(
                    (contact) => contact.identity === identity && contact.status === "active",
                )
            )
                return;
            const selected = new Set(draft.selectedContactIdentities);
            if (selected.has(identity)) selected.delete(identity);
            else selected.add(identity);
            store.setState({
                ...current,
                folderShare: {
                    ...draft,
                    selectedContactIdentities: [...selected],
                    error: undefined,
                },
            });
        },
        folderShareSubmit() {
            if (disposed) return;
            const current = store.getState();
            const draft = current.folderShare;
            if (
                !draft ||
                draft.submitting ||
                draft.selectedContactIdentities.length === 0 ||
                current.folderShares.some((share) => share.rootFolderId === draft.folderId)
            )
                return;
            const attempt = generation;
            const folderId = draft.folderId;
            const contacts = [...draft.selectedContactIdentities];
            store.setState({
                ...current,
                folderShare: { ...draft, submitting: true, error: undefined },
            });
            deps.source.folderShare(folderId, contacts).then(
                (folderShare) => {
                    if (disposed || attempt !== generation) return;
                    const next = store.getState();
                    if (next.folderShare?.folderId !== folderId) return;
                    const folderShares = next.folderShares.some(
                        (share) => share.rootFolderId === folderShare.rootFolderId,
                    )
                        ? next.folderShares.map((share) =>
                              share.rootFolderId === folderShare.rootFolderId ? folderShare : share,
                          )
                        : [...next.folderShares, folderShare];
                    store.setState({
                        ...next,
                        folderShares,
                        folderShare: { ...next.folderShare, submitting: false },
                    });
                },
                (error: unknown) => {
                    if (disposed || attempt !== generation) return;
                    const next = store.getState();
                    if (next.folderShare?.folderId !== folderId) return;
                    store.setState({
                        ...next,
                        folderShare: {
                            ...next.folderShare,
                            submitting: false,
                            error: rigUserError(error).message,
                        },
                    });
                },
            );
        },
        folderShareClose() {
            if (disposed || store.getState().folderShare === undefined) return;
            store.setState({ ...store.getState(), folderShare: undefined });
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
            pendingOutgoing.clear();
        },
    };

    function answerRequest(requestId: string, accept: boolean): void {
        if (disposed) return;
        const current = store.getState();
        if (current.answering.has(requestId)) return;
        const attempt = generation;
        store.setState({ ...current, actionError: undefined });
        answeringSet(requestId, true);
        deps.source.requestAnswer(requestId, accept).then(
            (reading) => {
                if (disposed || attempt !== generation) return;
                readingInput(reading);
                answeringSet(requestId, false);
            },
            (error: unknown) => {
                if (disposed || attempt !== generation) return;
                answeringSet(requestId, false);
                store.setState({
                    ...store.getState(),
                    actionError: rigUserError(error).message,
                });
            },
        );
    }
}

const NO_SHARING: RigSharingSnapshot = {
    loading: false,
    connection: "disconnected",
    contacts: [],
    incomingRequests: [],
    outgoingRequests: [],
    folderShares: [],
    addOpen: false,
    creating: false,
    request: EMPTY_REQUEST,
    answering: NO_ANSWERING,
    resetConfirming: false,
    resetting: false,
};

export const rigSharingStoreNoop: RigSharingStore = {
    get: () => NO_SHARING,
    subscribe: () => () => undefined,
    contactAddOpen: () => undefined,
    contactAddClose: () => undefined,
    invitationCreate: () => undefined,
    requestInvitationUpdate: () => undefined,
    requestSubmit: () => undefined,
    requestAccept: () => undefined,
    requestReject: () => undefined,
    contactRemove: () => undefined,
    resetOpen: () => undefined,
    resetCancel: () => undefined,
    resetConfirm: () => undefined,
    folderShareOpen: () => undefined,
    folderShareContactToggle: () => undefined,
    folderShareSubmit: () => undefined,
    folderShareClose: () => undefined,
    [Symbol.dispose]: () => undefined,
};
