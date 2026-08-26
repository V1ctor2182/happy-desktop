import {
    HappyAgentApiError,
    type ApiErrorBody,
    type Cloud,
    type CloudEnvironment,
    type CloudProfile,
    type HappyAgentClient,
} from "@slopus/happy-agent-client";
import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { happyAgentUserError } from "./happyAgentSupport.js";

export type HappyAgentCloudStatus =
    | "loading"
    | "disconnected"
    | "authorizing"
    | "connected"
    | "unavailable";

export type HappyAgentCloudEnrollment =
    | { readonly status: "inactive" }
    | { readonly status: "loading" }
    | {
          readonly enrolling: boolean;
          readonly error?: UserError;
          readonly status: "unenrolled";
          readonly username: string;
      }
    | {
          readonly firstName: string;
          readonly lastName?: string;
          readonly status: "enrolled";
          readonly username: string;
      }
    | { readonly error: UserError; readonly status: "error" };

export interface HappyAgentCloudSnapshot {
    readonly authorizationCompleting: boolean;
    readonly authorizationExpiresAt?: number;
    readonly authorizationStarting: boolean;
    readonly disconnecting: boolean;
    readonly enrollment: HappyAgentCloudEnrollment;
    readonly environment?: CloudEnvironment;
    readonly error?: UserError;
    /** Enrollment authority carried by desktop bootstrap's Cloud Social snapshot. */
    readonly socialEnrollment?: "enrolled" | "unenrolled";
    readonly status: HappyAgentCloudStatus;
    readonly user?: {
        readonly email: string;
        readonly firstName?: string;
        readonly id: string;
        readonly lastName?: string;
    };
}

export interface HappyAgentCloudStore {
    get(): HappyAgentCloudSnapshot;
    subscribe(listener: () => void): () => void;
    cloudAccountConnect(): void;
    cloudAccountDisconnect(): void;
    cloudProfileUsernameUpdate(value: string): void;
    cloudProfileEnroll(): void;
    [Symbol.dispose](): void;
}

export interface HappyAgentCloudHost {
    cloudAuthCallbackSubscribe(listener: () => void): () => void;
    cloudAuthCallbackTake(): Promise<string | undefined>;
    cloudAuthConfigurationGet(): Promise<{
        readonly environment: CloudEnvironment;
        readonly redirectUri: string;
    }>;
    cloudAuthOpen(url: string): Promise<void>;
}

export interface HappyAgentCloudStoreDeps {
    readonly client: Pick<
        HappyAgentClient,
        | "completeCloudAuthorization"
        | "disconnectCloud"
        | "enrollCloudProfile"
        | "getDesktopBootstrap"
        | "getCloudProfile"
        | "getCloudSocial"
        | "startCloudAuthorization"
        | "updates"
    >;
    readonly host: HappyAgentCloudHost;
}

const EMPTY: HappyAgentCloudSnapshot = {
    authorizationCompleting: false,
    authorizationStarting: false,
    disconnecting: false,
    enrollment: { status: "inactive" },
    status: "loading",
};

/**
 * Creates the daemon-owned Happy Social account surface. Reads begin with the
 * first subscriber; an authorization in progress keeps following updates and
 * callback delivery even if the Settings screen closes before the browser
 * returns.
 */
export function happyAgentCloudStoreCreate(deps: HappyAgentCloudStoreDeps): HappyAgentCloudStore {
    const store = createStore<HappyAgentCloudSnapshot>()(() => EMPTY);
    const listeners = new Set<() => void>();
    let callbackReading = false;
    let callbackUnsubscribe: (() => void) | undefined;
    let controller: AbortController | undefined;
    let disposed = false;
    let profileReadingFor: string | undefined;
    let profileRequest = 0;
    let socialRequest = 0;
    let version: string | undefined;

    const lifecycleNeeded = (): boolean => {
        const current = store.getState();
        return (
            listeners.size > 0 ||
            current.authorizationStarting ||
            current.authorizationCompleting ||
            current.enrollment.status === "loading" ||
            (current.enrollment.status === "unenrolled" && current.enrollment.enrolling) ||
            current.status === "authorizing"
        );
    };

    const lifecycleStopIfIdle = (): void => {
        if (lifecycleNeeded()) return;
        controller?.abort();
        controller = undefined;
        callbackUnsubscribe?.();
        callbackUnsubscribe = undefined;
    };

    const profileAdopt = (profile: CloudProfile, userId: string): void => {
        const current = store.getState();
        if (current.status !== "connected" || current.user?.id !== userId) return;
        if (profile.username === null) {
            const username =
                current.enrollment.status === "unenrolled" ? current.enrollment.username : "";
            store.setState(
                {
                    ...current,
                    enrollment: {
                        enrolling: false,
                        status: "unenrolled",
                        username,
                    },
                },
                true,
            );
            return;
        }
        store.setState(
            {
                ...current,
                enrollment: {
                    firstName: profile.firstName,
                    ...(profile.lastName ? { lastName: profile.lastName } : {}),
                    status: "enrolled",
                    username: profile.username,
                },
            },
            true,
        );
    };

    const profileRead = (): void => {
        const current = store.getState();
        if (disposed || current.status !== "connected" || !current.user) return;
        const userId = current.user.id;
        if (profileReadingFor === userId) return;
        const request = ++profileRequest;
        const signal = controller?.signal;
        profileReadingFor = userId;
        if (current.enrollment.status === "inactive" || current.enrollment.status === "error")
            store.setState({ enrollment: { status: "loading" } }, false);
        void deps.client
            .getCloudProfile({ signal })
            .then((response) => {
                if (disposed || request !== profileRequest) return;
                profileAdopt(response.profile, userId);
            })
            .catch((error: unknown) => {
                if (disposed || request !== profileRequest || signal?.aborted) return;
                const latest = store.getState();
                if (latest.status !== "connected" || latest.user?.id !== userId) return;
                if (latest.enrollment.status === "loading")
                    store.setState(
                        {
                            enrollment: {
                                error: happyAgentUserError(error),
                                status: "error",
                            },
                        },
                        false,
                    );
            })
            .finally(() => {
                if (request === profileRequest) profileReadingFor = undefined;
                lifecycleStopIfIdle();
            });
    };

    const socialEnrollmentRead = (signal?: AbortSignal): void => {
        const request = ++socialRequest;
        void deps.client.getCloudSocial({ signal }).then(
            (response) => {
                if (disposed || signal?.aborted || request !== socialRequest) return;
                if (store.getState().status !== "connected") return;
                store.setState({ socialEnrollment: response.cloudSocial.status }, false);
            },
            () => undefined,
        );
    };

    const cloudAdopt = (cloud: Cloud): void => {
        if (version !== undefined && version.localeCompare(cloud.version) >= 0) {
            const { error: _cleared, ...current } = store.getState();
            if (_cleared) store.setState(current, true);
            return;
        }
        version = cloud.version;
        const current = store.getState();
        const projected = cloudProject(cloud);
        const connectedUserChanged =
            projected.status === "connected" && projected.user?.id !== current.user?.id;
        if (connectedUserChanged) socialRequest += 1;
        if (projected.status !== "connected") {
            profileRequest += 1;
            socialRequest += 1;
            profileReadingFor = undefined;
        }
        store.setState(
            {
                ...projected,
                authorizationCompleting: current.authorizationCompleting,
                authorizationStarting: current.authorizationStarting,
                disconnecting: current.disconnecting,
                enrollment:
                    projected.status === "connected"
                        ? connectedUserChanged || current.enrollment.status === "inactive"
                            ? { status: "loading" }
                            : current.enrollment
                        : { status: "inactive" },
                ...(projected.status === "connected" &&
                !connectedUserChanged &&
                current.socialEnrollment
                    ? { socialEnrollment: current.socialEnrollment }
                    : {}),
            },
            true,
        );
        if (projected.status === "connected") profileRead();
        lifecycleStopIfIdle();
    };

    const callbackForward = async (): Promise<void> => {
        if (disposed || callbackReading) return;
        callbackReading = true;
        try {
            const callbackUrl = await deps.host.cloudAuthCallbackTake();
            if (!callbackUrl || disposed) return;
            store.setState({ authorizationCompleting: true, error: undefined }, false);
            const response = await deps.client.completeCloudAuthorization({ callbackUrl });
            if (disposed) return;
            cloudAdopt(response.cloud);
            store.setState({ authorizationCompleting: false }, false);
        } catch (error) {
            if (disposed) return;
            const authoritativeCloud = cloudApiErrorSnapshot(error);
            if (authoritativeCloud) cloudAdopt(authoritativeCloud);
            store.setState(
                {
                    authorizationCompleting: false,
                    error:
                        error instanceof HappyAgentApiError && error.code === "invalid_request"
                            ? undefined
                            : happyAgentUserError(error),
                },
                false,
            );
        } finally {
            callbackReading = false;
            lifecycleStopIfIdle();
        }
    };

    const follow = async (active: AbortController): Promise<void> => {
        for (;;) {
            const bootstrap = await deps.client.getDesktopBootstrap({ signal: active.signal });
            if (active.signal.aborted) return;
            if (!bootstrap.cloud) {
                store.setState({ ...EMPTY, status: "unavailable" }, true);
                return;
            }
            cloudAdopt(bootstrap.cloud);
            if (bootstrap.cloudSocial)
                store.setState({ socialEnrollment: bootstrap.cloudSocial.status }, false);
            else if (bootstrap.cloud.status === "connected") socialEnrollmentRead(active.signal);
            if (bootstrap.cloud.status === "connected") profileRead();

            let reconcile = false;
            for await (const update of deps.client.updates({
                after: bootstrap.cursor,
                signal: active.signal,
            })) {
                if (update.kind === "state_lost") {
                    reconcile = true;
                    break;
                }
                if (update.kind === "daemon_started" && update.replaced) {
                    reconcile = true;
                    break;
                }
                if (update.kind === "event") {
                    if (update.event.type === "cloud.updated")
                        cloudAdopt(update.event.payload.cloud);
                    if (update.event.type === "cloud.profile.updated") profileRead();
                    if (update.event.type === "cloud.social.updated")
                        socialEnrollmentRead(active.signal);
                }
            }
            if (active.signal.aborted) return;
            if (!reconcile) throw new Error("Happy Social authentication updates stopped.");
            version = undefined;
        }
    };

    const lifecycleEnsure = (): void => {
        if (disposed) return;
        if (!callbackUnsubscribe) {
            callbackUnsubscribe = deps.host.cloudAuthCallbackSubscribe(() => {
                void callbackForward();
            });
            void callbackForward();
        }
        if (controller) return;
        const active = new AbortController();
        controller = active;
        void follow(active)
            .catch((error: unknown) => {
                if (disposed || active.signal.aborted) return;
                store.setState({ error: happyAgentUserError(error) }, false);
            })
            .finally(() => {
                if (controller === active) controller = undefined;
                lifecycleStopIfIdle();
            });
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            if (listeners.size === 1) lifecycleEnsure();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                lifecycleStopIfIdle();
            };
        },
        cloudAccountConnect() {
            const current = store.getState();
            if (
                disposed ||
                current.authorizationStarting ||
                current.authorizationCompleting ||
                (current.status !== "disconnected" && current.status !== "authorizing")
            )
                return;
            store.setState({ authorizationStarting: true, error: undefined }, false);
            lifecycleEnsure();
            void deps.host
                .cloudAuthConfigurationGet()
                .then((configuration) =>
                    deps.client.startCloudAuthorization({
                        environment: configuration.environment,
                        redirectUri: configuration.redirectUri,
                    }),
                )
                .then(async (response) => {
                    if (disposed) return;
                    cloudAdopt(response.cloud);
                    await deps.host.cloudAuthOpen(response.cloud.authorization.url);
                    if (!disposed) store.setState({ authorizationStarting: false }, false);
                })
                .catch((error: unknown) => {
                    if (disposed) return;
                    store.setState(
                        {
                            authorizationStarting: false,
                            error: happyAgentUserError(error),
                        },
                        false,
                    );
                    lifecycleStopIfIdle();
                });
        },
        cloudAccountDisconnect() {
            const current = store.getState();
            if (disposed || current.status !== "connected" || current.disconnecting) return;
            store.setState({ disconnecting: true, error: undefined }, false);
            void deps.client.disconnectCloud().then(
                (response) => {
                    if (disposed) return;
                    cloudAdopt(response.cloud);
                    store.setState({ disconnecting: false }, false);
                },
                (error: unknown) => {
                    if (disposed) return;
                    store.setState(
                        { disconnecting: false, error: happyAgentUserError(error) },
                        false,
                    );
                },
            );
        },
        cloudProfileUsernameUpdate(value) {
            const current = store.getState();
            if (
                disposed ||
                current.enrollment.status !== "unenrolled" ||
                current.enrollment.enrolling
            )
                return;
            store.setState(
                {
                    enrollment: {
                        enrolling: false,
                        status: "unenrolled",
                        username: value,
                    },
                },
                false,
            );
        },
        cloudProfileEnroll() {
            const current = store.getState();
            if (
                disposed ||
                current.status !== "connected" ||
                current.enrollment.status !== "unenrolled" ||
                current.enrollment.enrolling
            )
                return;
            const username = current.enrollment.username.trim();
            if (!/^[a-z0-9_]{3,24}$/u.test(username)) {
                store.setState(
                    {
                        enrollment: {
                            ...current.enrollment,
                            error: happyAgentUserError(
                                new Error("Use 3–24 lowercase letters, digits, or underscores."),
                            ),
                            username,
                        },
                    },
                    false,
                );
                return;
            }
            store.setState(
                {
                    enrollment: {
                        enrolling: true,
                        status: "unenrolled",
                        username,
                    },
                },
                false,
            );
            lifecycleEnsure();
            void deps.client
                .enrollCloudProfile({ username })
                .then(
                    (response) => {
                        if (disposed) return;
                        const latest = store.getState();
                        if (latest.status !== "connected" || !latest.user) return;
                        profileAdopt(response.profile, latest.user.id);
                        socialEnrollmentRead(controller?.signal);
                    },
                    (error: unknown) => {
                        if (disposed) return;
                        const latest = store.getState();
                        if (latest.enrollment.status !== "unenrolled") return;
                        store.setState(
                            {
                                enrollment: {
                                    enrolling: false,
                                    error: happyAgentUserError(error),
                                    status: "unenrolled",
                                    username: latest.enrollment.username,
                                },
                            },
                            false,
                        );
                    },
                )
                .finally(() => lifecycleStopIfIdle());
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            socialRequest += 1;
            controller?.abort();
            controller = undefined;
            callbackUnsubscribe?.();
            callbackUnsubscribe = undefined;
            listeners.clear();
        },
    };
}

type CloudApiErrorBody = ApiErrorBody & { readonly cloud?: Cloud };

/** Cloud operation errors document their authoritative snapshot in the generic API error body. */
function cloudApiErrorSnapshot(error: unknown): Cloud | undefined {
    if (!(error instanceof HappyAgentApiError) || error.body === null) return undefined;
    return (error.body as CloudApiErrorBody).cloud;
}

function cloudProject(cloud: Cloud): Omit<HappyAgentCloudSnapshot, "enrollment"> {
    const base = {
        authorizationCompleting: false,
        authorizationStarting: false,
        disconnecting: false,
    } as const;
    if (cloud.status === "connected")
        return {
            ...base,
            environment: cloud.environment,
            status: "connected",
            user: {
                email: cloud.user.email,
                ...(cloud.user.firstName ? { firstName: cloud.user.firstName } : {}),
                id: cloud.user.id,
                ...(cloud.user.lastName ? { lastName: cloud.user.lastName } : {}),
            },
        };
    if (cloud.status === "authorizing")
        return {
            ...base,
            authorizationExpiresAt: cloud.authorization.expiresAt,
            environment: cloud.environment,
            status: "authorizing",
        };
    return {
        ...base,
        status: "disconnected",
        ...(cloud.error ? { error: happyAgentUserError(new Error(cloud.error.message)) } : {}),
    };
}

const UNAVAILABLE: HappyAgentCloudSnapshot = { ...EMPTY, status: "unavailable" };

/** A settled stand-in when this Happy Agent does not expose Cloud authentication. */
export const happyAgentCloudStoreNoop: HappyAgentCloudStore = {
    get: () => UNAVAILABLE,
    subscribe: () => () => undefined,
    cloudAccountConnect: () => undefined,
    cloudAccountDisconnect: () => undefined,
    cloudProfileUsernameUpdate: () => undefined,
    cloudProfileEnroll: () => undefined,
    [Symbol.dispose]: () => undefined,
};
