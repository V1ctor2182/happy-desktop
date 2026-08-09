import type {
    RigConnection,
    SharingContact as ConnectSharingContact,
    SharingContactRequest as ConnectSharingContactRequest,
    SharingSnapshot,
} from "@slopus/rig-connect";
import type {
    RigSharingContact,
    RigSharingIncomingRequest,
    RigSharingProfile,
    RigSharingReading,
    RigSharingSource,
} from "happy-desktop-state";

/**
 * Adapts `rig-connect`'s Sharing calls to the sharing store's source contract.
 *
 * Sharing exists only on the host connection: a machine reached through the
 * host shares under the host's identity, so nothing here is ever handed a peer
 * connection. The Rig streams whole snapshots over the global feed, so this
 * opens the stream when a surface subscribes and closes it when the last one
 * leaves. Nothing here polls, and nothing here predicts a handshake's outcome.
 */
export function rigConnectSharingSourceCreate(rig: RigConnection): RigSharingSource {
    return {
        subscribe(listener, onError) {
            let closed = false;
            let connection: ReturnType<RigConnection["connectSharing"]> | undefined;
            try {
                connection = rig.connectSharing({
                    onChange: (snapshot) => {
                        if (closed) return;
                        listener(readingProject(snapshot));
                    },
                    onError,
                });
            } catch (error) {
                onError(error);
            }
            return () => {
                if (closed) return;
                closed = true;
                connection?.close();
            };
        },
        async invitationCreate() {
            const response = await rig.createSharingInvitation();
            return { expiresAt: response.expiresAt, invitation: response.invitation };
        },
        async contactRequest(invitation) {
            const request = await rig.requestSharingContact(invitation);
            return { id: request.id, identity: request.identity };
        },
        async requestAnswer(requestId, accept) {
            return readingProject(
                accept
                    ? await rig.acceptSharingContactRequest(requestId)
                    : await rig.rejectSharingContactRequest(requestId),
            );
        },
        async contactRemove(identity) {
            return readingProject(await rig.removeSharingContact(identity));
        },
    };
}

function readingProject(snapshot: SharingSnapshot): RigSharingReading {
    return {
        connection: snapshot.connection,
        identity: snapshot.identity,
        contacts: snapshot.contacts.map(contactProject),
        incomingRequests: snapshot.incomingRequests.map(incomingProject),
        outgoingRequests: snapshot.outgoingRequests.map((request) => ({
            id: request.id,
            identity: request.identity,
        })),
        // A Rig that declined Murmur reports no profile, which is the whole of
        // the enrolment question. It is passed through as absence rather than
        // normalized to a blank string, so a surface can tell "opted out" from
        // "enrolled under a profile with no name yet".
        ...(snapshot.profileId === null ? {} : { profileId: snapshot.profileId }),
    };
}

function contactProject(contact: ConnectSharingContact): RigSharingContact {
    return {
        identity: contact.identity,
        status: contact.status,
        ...(contact.profile === null ? {} : { profile: profileProject(contact.profile) }),
    };
}

function incomingProject(request: ConnectSharingContactRequest): RigSharingIncomingRequest {
    return {
        id: request.id,
        identity: request.identity,
        ...(request.profile === null ? {} : { profile: profileProject(request.profile) }),
    };
}

/**
 * The person behind a contact, in the store's shape.
 *
 * Only what a contact row shows: a Sharing profile carries the far Rig's own
 * bookkeeping — versions, timestamps, the instance that parented it — and none
 * of that is anything this window has a use for or should be tempted to render.
 */
function profileProject(profile: NonNullable<ConnectSharingContact["profile"]>): RigSharingProfile {
    return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        ...(profile.photo === undefined
            ? {}
            : {
                  photo: {
                      imageUrl: `data:${profile.photo.mediaType};base64,${profile.photo.data}`,
                      width: profile.photo.width,
                      height: profile.photo.height,
                      thumbhash: profile.photo.thumbhash,
                  },
              }),
    };
}
