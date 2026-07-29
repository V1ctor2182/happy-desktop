import { RigDaemonClient } from "./rigDaemonClient";

/**
 * Everything needed to reach one Rig on another machine: the endpoint it answers
 * on and the token it accepts. There is nothing else — no transport to set up, no
 * shell to log into — which is what lets a remote Rig behave like the local one.
 */
export interface RemoteRigEndpoint {
    readonly token: string;
    readonly url: string;
}

export interface RemoteRigConnection {
    readonly client: RigDaemonClient;
    readonly version: string;
    close(): void;
}

export interface RemoteRigConnector {
    connect(endpoint: RemoteRigEndpoint): Promise<RemoteRigConnection>;
}

/**
 * Opens an authenticated connection to a Rig daemon reachable over HTTP and
 * confirms it is ready before the caller advertises it. The client is
 * request-scoped, so closing a connection only stops Happy from using it.
 */
export function remoteRigConnectorCreate(): RemoteRigConnector {
    return {
        async connect(endpoint) {
            const client = new RigDaemonClient({
                token: endpoint.token,
                url: remoteRigUrlValidate(endpoint.url),
            });
            const health = await client.health();
            if (health.status !== "ready")
                throw new Error(
                    health.status === "error"
                        ? `The remote Rig daemon reported an error: ${health.error}`
                        : "The remote Rig daemon is not ready yet.",
                );
            return {
                client,
                version: health.identity.version,
                close: () => undefined,
            };
        },
    };
}

/** Canonical endpoint text: an http/https origin, keeping any proxy path prefix. */
export function remoteRigUrlValidate(value: string): string {
    const trimmed = value.trim();
    let url: URL;
    try {
        url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    } catch {
        throw new Error("Enter the Rig endpoint as a URL, for example http://desk.local:4711.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("A Rig endpoint must use http or https.");
    if (!url.hostname) throw new Error("A Rig endpoint must name a host.");
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

/** The short name a reader recognizes the machine by when none was given. */
export function remoteRigLabelDerive(url: string): string {
    return new URL(url).host;
}

export function remoteRigTokenValidate(value: string): string {
    const token = value.trim();
    if (!token) throw new Error("Enter the token the remote Rig accepts.");
    return token;
}
