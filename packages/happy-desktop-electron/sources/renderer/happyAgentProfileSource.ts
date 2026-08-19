import {
    type HappyAgentClient,
    type RigProfile,
    type RigProfilesActions,
    type RigProfilesSource,
    type happyAgentProtocol,
    UserError,
} from "happy-desktop-state";

const PROFILE_ID = "installation-profile";
const POLL_MS = 5_000;

export interface HappyAgentProfileAdapter {
    readonly actions: RigProfilesActions;
    readonly source: RigProfilesSource;
}

/**
 * Adapts the daemon's single installation profile to the existing profile
 * surface. The source polls only while that surface has a subscriber.
 */
export function happyAgentProfileSourceCreate(
    client: HappyAgentClient,
    installationId: string,
): HappyAgentProfileAdapter {
    let latestUpdatedAt = 0;

    const profileProject = (profile: happyAgentProtocol.Profile): RigProfile | undefined => {
        if (profile.email === null && profile.name === null) return undefined;
        return {
            email: profile.email ?? "",
            id: PROFILE_ID,
            name: profile.name ?? "",
            parentInstanceId: installationId,
            updatedAt: profile.updatedAt,
            version: profile.version,
        };
    };

    const profileProjectRequired = (profile: happyAgentProtocol.Profile): RigProfile => {
        const projected = profileProject(profile);
        if (projected !== undefined) return projected;
        throw new UserError("Rig saved an empty profile. Add a name and email, then try again.");
    };

    const profileUpdate = async (input: {
        readonly email: string;
        readonly name: string;
    }): Promise<RigProfile> => {
        const current = (await client.getProfile()).profile;
        const updated = await client.updateProfile(
            {
                email: input.email,
                mutationId: crypto.randomUUID(),
                name: input.name,
            },
            { ifMatch: current.version },
        );
        latestUpdatedAt = Math.max(latestUpdatedAt, updated.profile.updatedAt);
        return profileProjectRequired(updated.profile);
    };

    return {
        actions: {
            profileCreate: profileUpdate,
            profileUpdate: (profileId, input) => {
                if (profileId !== PROFILE_ID)
                    return Promise.reject(new Error("This profile no longer exists."));
                return profileUpdate(input);
            },
        },
        source: {
            subscribe(listener, onError) {
                let closed = false;
                let loading = false;
                let request: AbortController | undefined;

                const load = (): void => {
                    if (closed || loading) return;
                    loading = true;
                    request = new AbortController();
                    void client.getProfile({ signal: request.signal }).then(
                        ({ profile }) => {
                            loading = false;
                            if (closed) return;
                            if (profile.updatedAt < latestUpdatedAt) return;
                            latestUpdatedAt = profile.updatedAt;
                            const projected = profileProject(profile);
                            listener(projected === undefined ? [] : [projected]);
                        },
                        (error: unknown) => {
                            loading = false;
                            if (closed || request?.signal.aborted) return;
                            onError(error);
                        },
                    );
                };

                load();
                const timer = setInterval(load, POLL_MS);
                return () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(timer);
                    request?.abort();
                };
            },
        },
    };
}
