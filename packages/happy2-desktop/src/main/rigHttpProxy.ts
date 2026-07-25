import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { HealthResponse } from "@slopus/rig/types";
import type { RigDaemonHealth } from "happy2-state";
import { rigProxyHandle, type RigProxyClient } from "./rigProxyHandle";

export interface RigHttpProxyHandle {
    /** Loopback base URL, for example `http://127.0.0.1:52344`. */
    readonly url: string;
    close(): void;
}

export interface RigHttpProxyOptions {
    /** The daemon client whose projected surface this proxy exposes. */
    readonly client: RigProxyClient;
    /**
     * Invoked when a health request fails at the transport level (the daemon is
     * unreachable), so the runtime can restart the connection. Daemon-reported
     * `error`/`starting` states resolve normally and never trigger this.
     */
    readonly onConnectionError?: (error: unknown) => void;
}

/** Projects Rig's protocol health into the minimal liveness shape the renderer loader consumes. */
export function rigDaemonHealthProject(value: HealthResponse): RigDaemonHealth {
    if (value.status === "ready") return { status: "ready", version: value.identity.version };
    if (value.status === "error")
        return { status: "error", version: value.identity.version, message: value.error };
    return { status: "starting", version: value.identity.version };
}

/**
 * A loopback-only HTTP bridge from the sandboxed renderer to the daemon. The
 * renderer cannot open the daemon's Unix socket, so the main process listens on an
 * ephemeral 127.0.0.1 port and forwards the renderer transport's projected JSON/SSE
 * routes to the authenticated `ProtocolHttpClient` via `rigProxyHandle`, returning
 * only already-projected `happy2-state` shapes. It binds to loopback only and 404s
 * every unmatched path. Resolves once the port is bound so the caller can advertise
 * the URL.
 */
export function rigHttpProxyCreate(options: RigHttpProxyOptions): Promise<RigHttpProxyHandle> {
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        void rigProxyHandle({
            client: options.client,
            method: request.method ?? "GET",
            path: url.pathname,
            query: url.searchParams,
            request,
            response,
            onConnectionError: options.onConnectionError,
        }).then(
            (handled) => {
                if (!handled && !response.headersSent) {
                    response.writeHead(404, { "content-type": "application/json" });
                    response.end(JSON.stringify({ error: "Not found." }));
                }
            },
            (error: unknown) => {
                if (!response.headersSent) {
                    response.writeHead(500, { "content-type": "application/json" });
                    response.end(
                        JSON.stringify({
                            error: error instanceof Error ? error.message : String(error),
                        }),
                    );
                }
            },
        );
    });
    return new Promise<RigHttpProxyHandle>((resolvePromise, reject) => {
        const onError = (error: unknown) => reject(error as Error);
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", onError);
            const address = server.address() as AddressInfo | null;
            if (!address) {
                server.close();
                reject(new Error("The Rig HTTP proxy did not bind a loopback port."));
                return;
            }
            resolvePromise({
                url: `http://127.0.0.1:${address.port}`,
                close: () => server.close(),
            });
        });
    });
}
