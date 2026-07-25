import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RigDaemonClient } from "./rigDaemonClient";
import type { DesktopRuntimeSnapshot } from "../shared/desktopContract";
import {
    RigCommandMissingError,
    type LocalRigConnection,
    type LocalRigConnector,
} from "./localRig";
import { DesktopRuntime, type DesktopRuntimePaths } from "./desktopRuntime";

const directories: string[] = [];
const runtimes: DesktopRuntime[] = [];

afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("desktop direct Rig topology", () => {
    it("connects to the normal daemon and leaves daemon ownership outside Happy", async () => {
        const close = vi.fn();
        const connector = connectorSequence([connection(close)]);
        const proxyClose = vi.fn();
        const runtime = await runtimeCreate(connector, proxyClose);

        await runtime.start({ mode: "local" });

        expect(readySnapshot(runtime.get())).toMatchObject({
            activeTarget: {
                authentication: "rig",
                kind: "local",
                label: "This Mac",
                mode: "local",
                rigVersion: "0.0.45",
                rigHttpUrl: "http://127.0.0.1:0",
            },
            mode: "local",
        });
        await runtime.close();
        expect(proxyClose).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it("publishes install-required without persisting a failed local activation", async () => {
        const connector = connectorSequence([new RigCommandMissingError()]);
        const { runtime, paths } = await runtimeCreateWithPaths(connector);

        await runtime.start({ mode: "local" });

        expect(runtime.get()).toMatchObject({
            phase: "installRequired",
            command: "npm install --global @slopus/rig",
            request: { mode: "local" },
        });
        await expect(
            readFile(join(paths.root, "desktop-settings.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("retries discovery after installation and then persists the local choice", async () => {
        const connector = connectorSequence([new RigCommandMissingError(), connection(vi.fn())]);
        const { runtime, paths } = await runtimeCreateWithPaths(connector);
        await runtime.start({ mode: "local" });
        expect(runtime.get().phase).toBe("installRequired");

        await runtime.retry();

        expect(runtime.get()).toMatchObject({ phase: "ready", mode: "local" });
        expect(
            JSON.parse(await readFile(join(paths.root, "desktop-settings.json"), "utf8")),
        ).toMatchObject({
            version: 2,
            topologies: [{ mode: "local" }],
        });
    });

    it("keeps an ordinary daemon-start failure retryable without persisting it", async () => {
        const connector = connectorSequence([
            new Error("daemon start failed"),
            connection(vi.fn()),
        ]);
        const { runtime, paths } = await runtimeCreateWithPaths(connector);

        await expect(runtime.start({ mode: "local" })).rejects.toThrow("daemon start failed");
        expect(runtime.get()).toMatchObject({
            phase: "error",
            retryable: true,
            message: "daemon start failed",
        });
        await expect(
            readFile(join(paths.root, "desktop-settings.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });

        await runtime.retry();
        expect(runtime.get()).toMatchObject({ phase: "ready", mode: "local" });
    });

    it("keeps cloud topology behavior independent from local Rig discovery", async () => {
        const connector: LocalRigConnector = { connect: vi.fn() };
        const runtime = await runtimeCreate(connector);

        await runtime.start({ mode: "cloud", serverUrl: "https://happy.example" });

        expect(readySnapshot(runtime.get())).toMatchObject({
            activeTarget: {
                authentication: "account",
                mode: "cloud",
                serverUrl: "https://happy.example",
            },
            mode: "cloud",
        });
        expect(connector.connect).not.toHaveBeenCalled();
    });

    it("disposes the local proxy while switching topology without stopping the daemon", async () => {
        const connectionClose = vi.fn();
        const connector = connectorSequence([connection(connectionClose)]);
        const proxyClose = vi.fn();
        const runtime = await runtimeCreate(connector, proxyClose);
        await runtime.start({ mode: "local" });

        await runtime.start({ mode: "cloud", serverUrl: "https://happy.example" });

        expect(proxyClose).toHaveBeenCalledOnce();
        expect(connectionClose).toHaveBeenCalledOnce();
        expect(runtime.get()).toMatchObject({ phase: "ready", mode: "cloud" });
    });

    it("restores the persisted topology through the same connector after restart", async () => {
        const connector = connectorSequence([connection(vi.fn()), connection(vi.fn())]);
        const { runtime: first, paths } = await runtimeCreateWithPaths(connector);
        await first.start({ mode: "local" });
        await first.close();

        const second = await DesktopRuntime.create(paths, {
            localRigConnector: connector,
            rigHttpProxyStart: proxyStub(),
        });
        runtimes.push(second);
        await waitFor(() => second.get().phase === "ready");
        expect(second.get()).toMatchObject({ phase: "ready", mode: "local" });
    });

    it("coalesces dead-socket failures into one normal-daemon reconnection", async () => {
        const firstClose = vi.fn();
        const secondClose = vi.fn();
        const connector = connectorSequence([connection(firstClose), connection(secondClose)]);
        const runtime = await runtimeCreate(connector);
        await runtime.start({ mode: "local" });
        const firstConnectionId = readySnapshot(runtime.get()).connectionId;
        const refused = Object.assign(new Error("socket refused"), { code: "ECONNREFUSED" });

        await Promise.all([
            runtime.reconnectLocal(refused),
            runtime.reconnectLocal(refused),
            runtime.reconnectLocal(refused),
        ]);

        expect(connector.connect).toHaveBeenCalledTimes(2);
        expect(firstClose).toHaveBeenCalledOnce();
        expect(readySnapshot(runtime.get()).connectionId).toBeGreaterThan(firstConnectionId);
        await runtime.reconnectLocal(new Error("ordinary request failure"));
        expect(connector.connect).toHaveBeenCalledTimes(2);
    });
});

function connectorSequence(values: readonly (LocalRigConnection | Error)[]): LocalRigConnector {
    const remaining = [...values];
    return {
        connect: vi.fn(async () => {
            const value = remaining.shift();
            if (!value) throw new Error("No fake Rig connection remains.");
            if (value instanceof Error) throw value;
            return value;
        }),
    };
}

function connection(close: () => void): LocalRigConnection {
    return {
        client: {} as RigDaemonClient,
        command: "/usr/local/bin/rig",
        environment: { PATH: "/usr/local/bin:/usr/bin" },
        version: "0.0.45",
        close,
    };
}

function proxyStub(close?: () => void) {
    return async () => ({ url: "http://127.0.0.1:0", close: close ?? vi.fn() });
}

async function runtimeCreate(
    connector: LocalRigConnector,
    proxyClose?: () => void,
): Promise<DesktopRuntime> {
    return (await runtimeCreateWithPaths(connector, proxyClose)).runtime;
}

async function runtimeCreateWithPaths(
    connector: LocalRigConnector,
    proxyClose?: () => void,
): Promise<{ readonly runtime: DesktopRuntime; readonly paths: DesktopRuntimePaths }> {
    const root = await mkdtemp(join(tmpdir(), "happy2-desktop-runtime-"));
    directories.push(root);
    const paths = { root };
    const runtime = await DesktopRuntime.create(paths, {
        localRigConnector: connector,
        rigHttpProxyStart: proxyStub(proxyClose),
    });
    runtimes.push(runtime);
    return { runtime, paths };
}

function readySnapshot(
    snapshot: DesktopRuntimeSnapshot,
): Extract<DesktopRuntimeSnapshot, { readonly phase: "ready" }> {
    if (snapshot.phase !== "ready") throw new Error("Expected ready desktop runtime.");
    return snapshot;
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for desktop runtime.");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
}
