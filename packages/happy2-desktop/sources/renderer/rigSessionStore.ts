import {
    rigClientCreate,
    rigClockStoreCreate,
    rigConnectionLoaderCreate,
    rigWorkspaceStoreCreate,
    type RigClient,
    type RigClockStore,
    type RigConnectionStore,
    type RigDaemonHealth,
    type RigHost,
    type RigSessionId,
    type RigWorkspaceStore,
} from "happy2-state";
import { rigRendererTransportCreate } from "./rigRendererTransport";
import type { DesktopRuntimeStore } from "./runtimeStore";
import type { HappyDesktopBridge } from "../shared/desktopContract";

export interface RigSession {
    readonly connectionId: number;
    readonly connection: RigConnectionStore;
    readonly host: RigHost;
    /** The joined session-list + active-chat workspace store for this connection. */
    readonly workspace: RigWorkspaceStore;
    /** Ticking clock for relative timestamps, so surfaces never read `Date.now()` in render. */
    readonly clock: RigClockStore;
}

interface RigSessionInternal extends RigSession {
    readonly client: RigClient;
}

export interface RigSessionStore {
    get(): RigSession | undefined;
    subscribe(listener: () => void): () => void;
}

export interface RigSessionDeps {
    /**
     * Navigates to a conversation the workspace just created (compose or
     * `/fork`). The store never selects a conversation itself; the URL does.
     */
    readonly conversationOpen: (sessionId: RigSessionId) => void;
}

function healthProbe(rigHttpUrl: string): () => Promise<RigDaemonHealth> {
    return async () => {
        const response = await fetch(`${rigHttpUrl}/health`);
        // A non-OK response (the proxy could not reach the daemon) is a probe
        // failure so the loader disconnects and backs off rather than parsing an
        // error envelope as health.
        if (!response.ok) throw new Error(`The Rig daemon health responded ${response.status}.`);
        return (await response.json()) as RigDaemonHealth;
    };
}

function hostCreate(bridge: HappyDesktopBridge): RigHost {
    return {
        applicationMenuOpen: () => void bridge.applicationMenuOpen().catch(() => undefined),
        directoryPick: () => bridge.directoryPick(),
    };
}

/**
 * Owns the connection loader and host for the active local Rig connection outside
 * React. It follows the desktop runtime snapshot and rebuilds — disposing the
 * previous loader — whenever the committed process-connection identity changes,
 * so the renderer never manages this lifetime through a React effect. The loader
 * itself opens no transport until a subscriber (the mounted view) reads it.
 */
export function rigSessionStoreCreate(
    bridge: HappyDesktopBridge,
    runtime: DesktopRuntimeStore,
    deps: RigSessionDeps,
): RigSessionStore {
    let session: RigSessionInternal | undefined;
    let runtimeUnsubscribe: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const dispose = () => {
        if (!session) return;
        // Dispose the workspace (releasing chat leases) before the client that
        // owns those stores, then the connection loader and clock.
        session.workspace[Symbol.dispose]();
        session.client[Symbol.dispose]();
        session.connection[Symbol.dispose]();
        session.clock[Symbol.dispose]();
        session = undefined;
    };
    const reconcile = (): void => {
        const snapshot = runtime.get();
        const target =
            snapshot && snapshot.phase === "ready" && snapshot.activeTarget.mode === "local"
                ? {
                      connectionId: snapshot.connectionId,
                      rigHttpUrl: snapshot.activeTarget.rigHttpUrl,
                  }
                : undefined;
        if (!target) {
            if (session) {
                dispose();
                notify();
            }
            return;
        }
        if (session && session.connectionId === target.connectionId) return;
        dispose();
        const client = rigClientCreate({
            transport: rigRendererTransportCreate(target.rigHttpUrl),
        });
        session = {
            connectionId: target.connectionId,
            connection: rigConnectionLoaderCreate({ probe: healthProbe(target.rigHttpUrl) }),
            host: hostCreate(bridge),
            client,
            workspace: rigWorkspaceStoreCreate(client, {
                output: (event) => deps.conversationOpen(event.conversationId),
            }),
            clock: rigClockStoreCreate(),
        };
        notify();
    };
    return {
        get: () => session,
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                runtimeUnsubscribe = runtime.subscribe(reconcile);
                reconcile();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    runtimeUnsubscribe?.();
                    runtimeUnsubscribe = undefined;
                    dispose();
                }
            };
        },
    };
}
