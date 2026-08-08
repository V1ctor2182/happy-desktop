import type { RigConnection, RigProfile as ConnectRigProfile } from "@slopus/rig-connect";
import type { RigProfile, RigProfilesActions, RigProfilesSource } from "happy-desktop-state";

/** Projects the host Rig's live human-profile catalog into product state. */
export function rigConnectProfilesSourceCreate(rig: RigConnection): {
    readonly source: RigProfilesSource;
    readonly actions: RigProfilesActions;
} {
    return {
        source: {
            subscribe(listener, onError) {
                let closed = false;
                let profilesConnection: ReturnType<RigConnection["connectProfiles"]> | undefined;
                let p2pConnection: ReturnType<RigConnection["connectP2p"]> | undefined;
                let profiles: readonly ConnectRigProfile[] | undefined;
                let ownerInstanceId: string | undefined;
                const publish = (): void => {
                    if (closed || profiles === undefined || ownerInstanceId === undefined) return;
                    listener(
                        profiles
                            .filter((profile) => profile.parentInstanceId === ownerInstanceId)
                            .map(profileProject),
                    );
                };
                try {
                    profilesConnection = rig.connectProfiles({
                        onChange: (reading) => {
                            profiles = reading;
                            publish();
                        },
                        onError,
                    });
                    p2pConnection = rig.connectP2p({
                        onChange: (status) => {
                            ownerInstanceId = status.instanceId;
                            publish();
                        },
                        onError,
                    });
                } catch (error) {
                    onError(error);
                }
                return () => {
                    if (closed) return;
                    closed = true;
                    profilesConnection?.close();
                    p2pConnection?.close();
                };
            },
        },
        actions: {
            profileCreate: (input) => rig.createProfile(input).then(profileProject),
            profileUpdate: (profileId, input) =>
                rig.updateProfile(profileId, input).then(profileProject),
        },
    };
}

function profileProject(profile: ConnectRigProfile): RigProfile {
    return {
        id: profile.id,
        name: profile.name,
        parentInstanceId: profile.parentInstanceId,
        version: profile.version,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
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
