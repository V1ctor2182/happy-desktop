import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    rigDaemonConnectionUnavailable,
    RigDaemonHttpError,
    rigDaemonPathsResolve,
    rigDaemonTokenRead,
} from "./rigDaemonClient";

describe("rigDaemonPathsResolve", () => {
    it("matches Happy Agent's default and environment-overridden daemon paths", () => {
        const homeDirectory =
            process.platform === "win32" ? join("C:\\Users", "steve") : "/Users/steve";
        expect(rigDaemonPathsResolve({}, homeDirectory)).toEqual({
            socketPath: join(homeDirectory, ".happy", "agent", "server.sock"),
            tokenPath: join(homeDirectory, ".happy", "agent", "token"),
        });
        const configuredHome =
            process.platform === "win32" ? "C:\\private happy" : "/private/happy";
        expect(rigDaemonPathsResolve({ HAPPY_HOME_DIR: configuredHome }, homeDirectory)).toEqual({
            socketPath: join(configuredHome, "agent", "server.sock"),
            tokenPath: join(configuredHome, "agent", "token"),
        });
        expect(
            rigDaemonPathsResolve(
                {
                    RIG_SERVER_SOCKET_PATH: "/tmp/override.sock",
                    RIG_SERVER_TOKEN_PATH: "/tmp/override.token",
                },
                homeDirectory,
            ),
        ).toEqual({
            socketPath: "/tmp/override.sock",
            tokenPath: "/tmp/override.token",
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

describe("rigDaemonConnectionUnavailable", () => {
    it("treats a rejected token from a restarted daemon as an unusable connection", () => {
        expect(rigDaemonConnectionUnavailable(new RigDaemonHttpError(401, "unauthorized"))).toBe(
            true,
        );
        expect(rigDaemonConnectionUnavailable(new RigDaemonHttpError(403, "forbidden"))).toBe(true);
        expect(
            rigDaemonConnectionUnavailable(
                Object.assign(new Error("socket gone"), { code: "ENOENT" }),
            ),
        ).toBe(true);
    });

    it("leaves daemon-reported failures to the caller", () => {
        expect(rigDaemonConnectionUnavailable(new RigDaemonHttpError(404, "no session"))).toBe(
            false,
        );
        expect(rigDaemonConnectionUnavailable(new RigDaemonHttpError(500, "boom"))).toBe(false);
        expect(rigDaemonConnectionUnavailable(new Error("ordinary failure"))).toBe(false);
    });
});
