import {
    type HappyAgentClient,
    type HappyAgentProfile,
    type HappyAgentProfileActions,
    type HappyAgentProfileSource,
    type happyAgentProtocol,
    UserError,
} from "happy-desktop-state";

const POLL_MS = 5_000;

export interface HappyAgentProfileAdapter {
    readonly actions: HappyAgentProfileActions;
    readonly source: HappyAgentProfileSource;
}

/**
 * Adapts the daemon's installation profile to the profile surface. The source
 * polls only while that surface has a subscriber.
 */
export function happyAgentProfileSourceCreate(client: HappyAgentClient): HappyAgentProfileAdapter {
    let latestUpdatedAt = 0;

    const profileProject = (profile: happyAgentProtocol.Profile): HappyAgentProfile | undefined => {
        if (profile.email === null && profile.name === null) return undefined;
        return {
            email: profile.email ?? "",
            name: profile.name ?? "",
            updatedAt: profile.updatedAt,
        };
    };

    return {
        actions: {
            async profileSave(input) {
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
                const projected = profileProject(updated.profile);
                if (projected === undefined)
                    throw new UserError(
                        "Happy Agent saved an empty profile. Add a name and email, then try again.",
                    );
                return projected;
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
                            listener(profileProject(profile));
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
