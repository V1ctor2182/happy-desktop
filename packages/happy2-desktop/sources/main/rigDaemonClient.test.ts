import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rigDaemonPathsResolve, rigDaemonTokenRead } from "./rigDaemonClient";

describe("rigDaemonPathsResolve", () => {
    it("matches Rig's default and environment-overridden daemon paths", () => {
        expect(rigDaemonPathsResolve({}, 42)).toEqual({
            socketPath: join(tmpdir(), "rig-42", "server.sock"),
            tokenPath: join(tmpdir(), "rig-42", "token"),
        });
        expect(
            rigDaemonPathsResolve(
                {
                    RIG_SERVER_DIRECTORY: "/var/run/custom-rig",
                    RIG_SERVER_SOCKET_PATH: "/tmp/override.sock",
                },
                42,
            ),
        ).toEqual({
            socketPath: "/tmp/override.sock",
            tokenPath: "/var/run/custom-rig/token",
        });
    });
});

describe("rigDaemonTokenRead", () => {
    it("reads a trimmed token and treats a missing token as unavailable", async () => {
        const directory = await mkdtemp(join(tmpdir(), "happy2-rig-token-"));
        const tokenPath = join(directory, "token");
        try {
            expect(await rigDaemonTokenRead(tokenPath)).toBeUndefined();
            await writeFile(tokenPath, "secret\n");
            expect(await rigDaemonTokenRead(tokenPath)).toBe("secret");
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });
});
