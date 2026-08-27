import {
    HappyAgentApiError,
    type ApiErrorBody,
    type Cloud,
    type CloudEnrollment,
    type CloudEnvironment,
    type CloudKeys,
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
    | { readonly status: "checking" }
    | {
          readonly error?: UserError;
          readonly status: "required";
          readonly submitting: boolean;
          readonly username: string;
      }
    | { readonly status: "enrolling"; readonly username: string }
    | { readonly status: "enrolled"; readonly username: string }
    | { readonly status: "unsupported" };

export type HappyAgentCloudKeys =
    | { readonly status: "inactive" }
    | { readonly status: "create_required" }
    | { readonly status: "restore_required" }
    | { readonly identityKey: string; readonly status: "ready" }
    | { readonly status: "unsupported" };

export interface HappyAgentCloudSnapshot {
    readonly authorizationCompleting: boolean;
    readonly authorizationExpiresAt?: number;
    readonly authorizationStarting: boolean;
    readonly disconnecting: boolean;
    readonly enrollment: HappyAgentCloudEnrollment;
    readonly environment?: CloudEnvironment;
    readonly error?: UserError;
    readonly keys: HappyAgentCloudKeys;
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
    keys: { status: "inactive" },
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
    let socialRequest = 0;
    let version: string | undefined;

    const lifecycleNeeded = (): boolean => {
        const current = store.getState();
        return (
            listeners.size > 0 ||
            current.authorizationStarting ||
            current.authorizationCompleting ||
            (current.enrollment.status === "required" && current.enrollment.submitting) ||
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
        const connectedUserChanged =
            cloud.status === "connected" && cloud.user.id !== current.user?.id;
        const projected = cloudProject(
            cloud,
            connectedUserChanged ? { status: "inactive" } : current.enrollment,
        );
        if (connectedUserChanged) socialRequest += 1;
        if (projected.status !== "connected") {
            socialRequest += 1;
        }
        store.setState(
            {
                ...projected,
                authorizationCompleting: current.authorizationCompleting,
                authorizationStarting: current.authorizationStarting,
                disconnecting: current.disconnecting,
                ...(projected.status === "connected" &&
                !connectedUserChanged &&
                current.socialEnrollment
                    ? { socialEnrollment: current.socialEnrollment }
                    : {}),
            },
            true,
        );
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
                current.enrollment.status !== "required" ||
                current.enrollment.submitting
            )
                return;
            store.setState(
                {
                    enrollment: {
                        status: "required",
                        submitting: false,
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
                current.enrollment.status !== "required" ||
                current.enrollment.submitting
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
                        status: "required",
                        submitting: true,
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
                        if (latest.status !== "connected") return;
                        const settledEnrollment =
                            latest.enrollment.status === "required"
                                ? { ...latest.enrollment, submitting: false }
                                : latest.enrollment;
                        store.setState(
                            {
                                enrollment: cloudEnrollmentProject(
                                    response.enrollment,
                                    settledEnrollment,
                                ),
                            },
                            false,
                        );
                        socialEnrollmentRead(controller?.signal);
                    },
                    (error: unknown) => {
                        if (disposed) return;
                        const latest = store.getState();
                        if (latest.enrollment.status !== "required") return;
                        store.setState(
                            {
                                enrollment: {
                                    error: happyAgentUserError(error),
                                    status: "required",
                                    submitting: false,
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

function cloudProject(
    cloud: Cloud,
    currentEnrollment: HappyAgentCloudEnrollment,
): Omit<HappyAgentCloudSnapshot, "socialEnrollment"> {
    const base = {
        authorizationCompleting: false,
        authorizationStarting: false,
        disconnecting: false,
    } as const;
    if (cloud.status === "connected")
        return {
            ...base,
            enrollment: cloudEnrollmentProject(cloud.enrollment, currentEnrollment),
            environment: cloud.environment,
            keys: cloudKeysProject(cloud.keys),
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
            enrollment: { status: "inactive" },
            environment: cloud.environment,
            keys: { status: "inactive" },
            status: "authorizing",
        };
    return {
        ...base,
        enrollment: { status: "inactive" },
        keys: { status: "inactive" },
        status: "disconnected",
        ...(cloud.error ? { error: happyAgentUserError(new Error(cloud.error.message)) } : {}),
    };
}

/** Projects an explicitly reported daemon state without reconstructing it from profile data. */
function cloudEnrollmentProject(
    enrollment: CloudEnrollment | undefined,
    current: HappyAgentCloudEnrollment,
): HappyAgentCloudEnrollment {
    if (!enrollment) return { status: "unsupported" };
    switch (enrollment.status) {
        case "inactive":
        case "checking":
            return enrollment;
        case "required":
            return current.status === "required"
                ? current
                : { status: "required", submitting: false, username: "" };
        case "enrolling":
        case "enrolled":
            return enrollment;
    }
}

/** Missing means the connected daemon predates the explicit Cloud-key protocol. */
function cloudKeysProject(keys: CloudKeys | undefined): HappyAgentCloudKeys {
    return keys ?? { status: "unsupported" };
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
