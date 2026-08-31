import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import type {
    DesktopPersonalRemoteMacMountWriteRequest,
    DesktopPersonalRemoteMacSnapshot,
} from "../../shared/desktopContract";
import type { DesktopLocalHappyAgentBacking } from "../desktopRuntime";
import { happyAgentHttpProxyCreate, type HappyAgentHttpProxyHandle } from "../happyAgentHttpProxy";
import type { HtmlPreviewProxyHandle } from "../htmlPreviewProxy";
import { RemoteHappyAgentClient } from "./remoteHappyAgentClient";
import {
    personalRemoteMacIdCreate,
    personalRemoteMacSettingsRead,
    personalRemoteMacSettingsWrite,
    personalRemoteMacTailnetAddresses,
    personalRemoteMacTailnetAddressRequireLocal,
    personalRemoteMacTokenCreate,
    type PersonalRemoteMacMountSettings,
    type PersonalRemoteMacSettings,
    type PersonalRemoteMacShareSettings,
} from "./personalRemoteMacSettings";
import {
    tailnetHappyAgentBridgeCreate,
    type TailnetHappyAgentBridgeHandle,
} from "./tailnetHappyAgentBridge";

export interface PersonalRemoteMacManagerOptions {
    readonly settingsPath: string;
    readonly rendererOrigin?: string;
    readonly htmlPreview?: HtmlPreviewProxyHandle;
    readonly localBackingGet: () => DesktopLocalHappyAgentBacking | undefined;
    readonly localBackingSubscribe: (
        listener: (backing: DesktopLocalHappyAgentBacking | undefined) => void,
    ) => () => void;
}

/** Owns one optional B listener and one optional B mount without widening DesktopRuntime. */
export class PersonalRemoteMacManager implements AsyncDisposable {
    readonly #listeners = new Set<(snapshot: DesktopPersonalRemoteMacSnapshot) => void>();
    readonly #options: PersonalRemoteMacManagerOptions;
    #settings: PersonalRemoteMacSettings;
    #shareStatus: DesktopPersonalRemoteMacSnapshot["share"]["status"] = "disabled";
    #shareMessage?: string;
    #bridge?: TailnetHappyAgentBridgeHandle;
    #remoteClient?: RemoteHappyAgentClient;
    #remoteProxy?: HappyAgentHttpProxyHandle;
    #mountGeneration = 0;
    #backing?: DesktopLocalHappyAgentBacking;
    #backingUnsubscribe?: () => void;
    #retryTimer?: NodeJS.Timeout;
    #retryAttempt = 0;
    #closed = false;
    #operation = Promise.resolve();

    private constructor(
        options: PersonalRemoteMacManagerOptions,
        settings: PersonalRemoteMacSettings,
    ) {
        this.#options = options;
        this.#settings = settings;
        this.#backing = options.localBackingGet();
    }

    static async create(
        options: PersonalRemoteMacManagerOptions,
    ): Promise<PersonalRemoteMacManager> {
        const settings = await personalRemoteMacSettingsRead(options.settingsPath);
        const manager = new PersonalRemoteMacManager(options, settings);
        manager.#backingUnsubscribe = options.localBackingSubscribe((backing) => {
            manager.#backing = backing;
            manager.#bridge?.replace(backing);
        });
        if (settings.mount) await manager.#mountCreate(settings.mount);
        if (settings.share) await manager.#shareStart(settings.share).catch(() => undefined);
        return manager;
    }

    get(): DesktopPersonalRemoteMacSnapshot {
        const share = this.#settings.share;
        const mount = this.#settings.mount;
        return {
            tailnetAddresses: personalRemoteMacTailnetAddresses(),
            share: share
                ? {
                      enabled: true,
                      bindAddress: share.bindAddress,
                      port: share.port,
                      status: this.#shareStatus,
                      ...(this.#shareMessage ? { message: this.#shareMessage } : {}),
                  }
                : { enabled: false, status: "disabled" },
            ...(mount && this.#remoteProxy
                ? {
                      mount: {
                          id: mount.id,
                          label: mount.label,
                          sourceAddress: mount.sourceAddress,
                          address: mount.address,
                          port: mount.port,
                          credentialConfigured: true as const,
                          generation: this.#mountGeneration,
                          happyAgentHttpUrl: this.#remoteProxy.url,
                      },
                  }
                : {}),
        };
    }

    subscribe(listener: (snapshot: DesktopPersonalRemoteMacSnapshot) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    shareEnable(bindAddress: string): Promise<string> {
        return this.#serial(async () => {
            if (this.#settings.share) throw new Error("Remote Mac sharing is already enabled.");
            this.#retryReset();
            const address = personalRemoteMacTailnetAddressRequireLocal(bindAddress);
            const token = personalRemoteMacTokenCreate();
            const tokenSha256 = tokenDigest(token);
            this.#shareStatus = "starting";
            this.#shareMessage = undefined;
            this.#publish();
            const candidate = await tailnetHappyAgentBridgeCreate({
                address,
                tokenSha256,
                backing: this.#backing,
                active: false,
            });
            const share: PersonalRemoteMacShareSettings = {
                enabled: true,
                bindAddress: address,
                port: candidate.port,
                tokenSha256,
            };
            const next = { ...this.#settings, share };
            try {
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
            } catch (error) {
                await candidate.close();
                throw error;
            }
            candidate.activate();
            this.#settings = next;
            this.#bridge = candidate;
            this.#shareStatus = "listening";
            this.#shareMessage = undefined;
            this.#retryAttempt = 0;
            this.#publish();
            return token;
        });
    }

    shareDisable(): Promise<void> {
        return this.#serial(async () => {
            this.#retryReset();
            const { share: _share, ...rest } = this.#settings;
            const next: PersonalRemoteMacSettings = rest;
            const bridge = this.#bridge;
            bridge?.deactivate();
            try {
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
            } catch (error) {
                bridge?.activate();
                throw error;
            }
            this.#bridge = undefined;
            this.#settings = next;
            this.#shareStatus = "disabled";
            this.#shareMessage = undefined;
            await bridge?.close();
            this.#publish();
        });
    }

    shareRotate(): Promise<string> {
        return this.#serial(async () => {
            const current = this.#settings.share;
            if (!current) throw new Error("Remote Mac sharing is not enabled.");
            const token = personalRemoteMacTokenCreate();
            const replacement: PersonalRemoteMacShareSettings = {
                ...current,
                tokenSha256: tokenDigest(token),
            };
            this.#retryReset();
            this.#shareStatus = "starting";
            this.#shareMessage = undefined;
            this.#publish();
            const bridge = this.#bridge;
            this.#bridge = undefined;
            await bridge?.close();
            let candidate: TailnetHappyAgentBridgeHandle;
            try {
                candidate = await tailnetHappyAgentBridgeCreate({
                    address: replacement.bindAddress,
                    port: replacement.port,
                    tokenSha256: replacement.tokenSha256,
                    backing: this.#backing,
                    active: false,
                });
            } catch (error) {
                this.#shareFailed(error);
                throw error;
            }
            const next = { ...this.#settings, share: replacement };
            try {
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
            } catch (error) {
                await candidate.close();
                this.#shareFailed(error);
                throw error;
            }
            candidate.activate();
            this.#settings = next;
            this.#bridge = candidate;
            this.#shareStatus = "listening";
            this.#shareMessage = undefined;
            this.#retryAttempt = 0;
            this.#publish();
            return token;
        });
    }

    mountWrite(request: DesktopPersonalRemoteMacMountWriteRequest): Promise<void> {
        return this.#serial(async () => {
            const previous = this.#settings.mount;
            const endpointChanged =
                !!previous &&
                (previous.address !== request.address || previous.port !== request.port);
            const token = request.token ?? (!endpointChanged ? previous?.token : undefined);
            if (!token) throw new Error("A remote Mac token is required.");
            const mount: PersonalRemoteMacMountSettings = {
                id: previous && !endpointChanged ? previous.id : personalRemoteMacIdCreate(),
                label: request.label,
                sourceAddress: request.sourceAddress,
                address: request.address,
                port: request.port,
                token,
            };
            const unchangedTransport =
                previous &&
                !endpointChanged &&
                previous.sourceAddress === mount.sourceAddress &&
                previous.token === mount.token;
            const next = { ...this.#settings, mount };
            if (unchangedTransport) {
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
                this.#settings = next;
                this.#publish();
                return;
            }
            if (!endpointChanged && this.#remoteProxy) {
                const replacement = remoteClientCreate(mount);
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
                this.#remoteClient?.close();
                this.#remoteClient = replacement;
                this.#remoteProxy.replace({ client: replacement });
                this.#settings = next;
                this.#mountGeneration += 1;
                this.#publish();
                return;
            }
            const candidateClient = remoteClientCreate(mount);
            let candidateProxy: HappyAgentHttpProxyHandle;
            try {
                candidateProxy = await this.#proxyCreate(candidateClient);
                await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
            } catch (error) {
                candidateClient.close();
                throw error;
            }
            this.#remoteClient?.close();
            this.#remoteProxy?.close();
            this.#remoteClient = candidateClient;
            this.#remoteProxy = candidateProxy;
            this.#settings = next;
            this.#mountGeneration += 1;
            this.#publish();
        });
    }

    mountRemove(): Promise<void> {
        return this.#serial(async () => {
            const { mount: _mount, ...rest } = this.#settings;
            const next: PersonalRemoteMacSettings = rest;
            await personalRemoteMacSettingsWrite(this.#options.settingsPath, next);
            this.#settings = next;
            this.#remoteClient?.close();
            this.#remoteClient = undefined;
            this.#remoteProxy?.close();
            this.#remoteProxy = undefined;
            this.#mountGeneration += 1;
            this.#publish();
        });
    }

    retry(): Promise<void> {
        return this.#serial(async () => {
            this.#retryReset();
            if (this.#settings.share) await this.#shareStart(this.#settings.share);
            const mount = this.#settings.mount;
            if (mount && this.#remoteProxy) {
                const replacement = remoteClientCreate(mount);
                this.#remoteClient?.close();
                this.#remoteClient = replacement;
                this.#remoteProxy.replace({ client: replacement });
                this.#mountGeneration += 1;
            }
            this.#publish();
        });
    }

    openHttpProxy(happyAgentId: string, sessionId: string): Promise<Duplex> {
        if (this.#settings.mount?.id !== happyAgentId || !this.#remoteClient)
            throw new Error("That remote Mac is not mounted.");
        return this.#remoteClient.openHttpProxy(sessionId);
    }

    generation(happyAgentId: string): number | undefined {
        return this.#settings.mount?.id === happyAgentId ? this.#mountGeneration : undefined;
    }

    proxyUrl(): string | undefined {
        return this.#remoteProxy?.url;
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        this.#retryReset();
        await this.#operation;
        this.#backingUnsubscribe?.();
        this.#backingUnsubscribe = undefined;
        this.#remoteClient?.close();
        this.#remoteClient = undefined;
        this.#remoteProxy?.close();
        this.#remoteProxy = undefined;
        await this.#bridge?.close();
        this.#bridge = undefined;
        this.#listeners.clear();
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    async #shareStart(share: PersonalRemoteMacShareSettings): Promise<void> {
        this.#retryClear();
        this.#shareStatus = "starting";
        this.#shareMessage = undefined;
        this.#publish();
        try {
            await this.#bridge?.close();
            this.#bridge = undefined;
            personalRemoteMacTailnetAddressRequireLocal(share.bindAddress);
            const candidate = await tailnetHappyAgentBridgeCreate({
                address: share.bindAddress,
                port: share.port,
                tokenSha256: share.tokenSha256,
                backing: this.#backing,
            });
            this.#bridge = candidate;
            this.#shareStatus = "listening";
            this.#shareMessage = undefined;
            this.#retryAttempt = 0;
            this.#publish();
        } catch (error) {
            this.#shareStatus = "error";
            this.#shareMessage = error instanceof Error ? error.message : String(error);
            this.#publish();
            this.#shareRetrySchedule();
            throw error;
        }
    }

    async #mountCreate(mount: PersonalRemoteMacMountSettings): Promise<void> {
        const client = remoteClientCreate(mount);
        try {
            const proxy = await this.#proxyCreate(client);
            this.#remoteClient = client;
            this.#remoteProxy = proxy;
            this.#mountGeneration += 1;
        } catch (error) {
            client.close();
            throw error;
        }
    }

    #proxyCreate(client: RemoteHappyAgentClient): Promise<HappyAgentHttpProxyHandle> {
        return happyAgentHttpProxyCreate({
            client,
            nativeHost: false,
            ...(this.#options.rendererOrigin
                ? { allowedOrigin: this.#options.rendererOrigin }
                : {}),
            ...(this.#options.htmlPreview ? { htmlPreview: this.#options.htmlPreview } : {}),
        });
    }

    #shareRetrySchedule(): void {
        if (this.#closed || this.#retryTimer || !this.#settings.share) return;
        const baseDelay = Math.min(60_000, 1_000 * 2 ** Math.min(this.#retryAttempt, 6));
        const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
        this.#retryAttempt += 1;
        this.#shareStatus = "retrying";
        this.#publish();
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = undefined;
            const share = this.#settings.share;
            if (share) void this.#serial(() => this.#shareStart(share)).catch(() => undefined);
        }, delay);
        this.#retryTimer.unref();
    }

    #shareFailed(error: unknown): void {
        this.#shareStatus = "error";
        this.#shareMessage = error instanceof Error ? error.message : String(error);
        this.#publish();
        this.#shareRetrySchedule();
    }

    #retryClear(): void {
        if (this.#retryTimer) clearTimeout(this.#retryTimer);
        this.#retryTimer = undefined;
    }

    #retryReset(): void {
        this.#retryClear();
        this.#retryAttempt = 0;
    }

    #publish(): void {
        const snapshot = this.get();
        for (const listener of this.#listeners) listener(snapshot);
    }

    #serial<T>(work: () => Promise<T>): Promise<T> {
        if (this.#closed) return Promise.reject(new Error("The remote Mac manager is closed."));
        const next = this.#operation.then(work, work);
        this.#operation = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }
}

function tokenDigest(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
}

function remoteClientCreate(mount: PersonalRemoteMacMountSettings): RemoteHappyAgentClient {
    return new RemoteHappyAgentClient({
        address: mount.address,
        port: mount.port,
        sourceAddress: mount.sourceAddress,
        token: mount.token,
    });
}
