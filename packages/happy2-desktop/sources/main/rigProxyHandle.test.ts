import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionEvent } from "./rigDaemonTypes";
import { RigDaemonHttpError } from "./rigDaemonClient";
import { rigProxyHandle, type RigProxyClient } from "./rigProxyHandle";

const HOME = "/home/dev";

interface Captured {
    status?: number;
    body: string;
    chunks: string[];
    response: ServerResponse;
    headersSent: boolean;
}

function fakeResponse(): Captured {
    const captured: Captured = {
        body: "",
        chunks: [],
        headersSent: false,
        response: undefined as unknown as ServerResponse,
    };
    const response = {
        get headersSent() {
            return captured.headersSent;
        },
        writeHead(status: number) {
            captured.status = status;
            captured.headersSent = true;
            return response;
        },
        write(chunk: string) {
            captured.chunks.push(chunk);
            return true;
        },
        end(chunk?: string) {
            if (chunk) captured.body = chunk;
            return response;
        },
    } as unknown as ServerResponse;
    captured.response = response;
    return captured;
}

function getRequest(): IncomingMessage {
    const emitter = new EventEmitter() as unknown as IncomingMessage;
    return emitter;
}

function postRequest(body: unknown): IncomingMessage {
    return Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
}

function protocolSession(id = "session-1") {
    return {
        id,
        agentId: "a",
        cwd: `${HOME}/work`,
        providerId: "openai",
        permissionMode: "auto",
        modelId: "gpt-x",
        secretIds: [],
        projectSecretIds: [],
        sessionSecretIds: [],
        modelLocked: false,
        models: [],
        status: "idle",
        titleStatus: "ready",
        agent: { depth: 0, rootSessionId: id, type: "primary" },
        snapshot: {
            id: "a",
            providerId: "openai",
            modelId: "gpt-x",
            status: "idle",
            messages: [],
            queue: [],
            tools: [],
        },
        pendingUserInputs: [],
        mcpServers: [],
        tasks: [],
    };
}

function clientStub(overrides: Partial<RigProxyClient> = {}): RigProxyClient {
    return {
        health: vi.fn(async () => ({
            status: "ready",
            healthy: true,
            ready: true,
            identity: { version: "9.9" },
            catalog: { defaultModelId: "", defaultProviderId: "", models: [], providers: [] },
            durableGlobalEventQueue: false,
        })),
        models: vi.fn(async () => ({
            catalog: {
                defaultModelId: "gpt-x",
                defaultProviderId: "openai",
                models: [],
                providers: [],
            },
        })),
        listSessions: vi.fn(async () => ({
            sessions: [
                {
                    id: "session-1",
                    cwd: `${HOME}/work`,
                    projectId: "project-1",
                    providerId: "openai",
                    modelId: "gpt-x",
                    permissionMode: "auto",
                    status: "idle",
                    titleStatus: "ready",
                    createdAt: 1,
                    updatedAt: 2,
                },
            ],
        })),
        getSession: vi.fn(async () => ({ session: protocolSession() })),
        listSubagents: vi.fn(async () => ({ subagents: [] })),
        searchFiles: vi.fn(async () => ({
            files: [{ fileName: "a.ts", path: "src/a.ts" }],
        })),
        getSessionUsage: vi.fn(async () => ({
            currentProviderId: "openai",
            groups: [
                {
                    kind: "attributed",
                    modelId: "gpt-x",
                    providerId: "openai",
                    requestedModelId: "gpt-x",
                    usage: {
                        input: 100,
                        output: 40,
                        cacheRead: 10,
                        cacheWrite: 5,
                        totalTokens: 155,
                        reasoning: 12,
                        cost: {
                            input: 0.1,
                            output: 0.2,
                            cacheRead: 0,
                            cacheWrite: 0,
                            total: 0.3,
                        },
                    },
                },
            ],
            context: {
                approximate: true,
                modelId: "gpt-x",
                providerId: "openai",
                requestedModelId: "gpt-x",
                totalTokens: 155,
            },
            observedQuota: [],
            quotas: [
                {
                    providerId: "openai",
                    quota: {
                        capturedAt: 1,
                        source: "codex",
                        windows: {
                            fiveHour: {
                                capturedAt: 1,
                                status: "available",
                                usedPercent: 42,
                                resetsAt: 9_999,
                            },
                            weekly: { status: "unavailable" },
                        },
                    },
                },
            ],
        })),
        getEvents: vi.fn(async () => ({ events: [] })),
        createSession: vi.fn(async () => ({ session: protocolSession("created") })),
        forkSession: vi.fn(async () => ({ session: protocolSession("fork") })),
        reset: vi.fn(async () => ({ session: protocolSession() })),
        submitMessage: vi.fn(async () => ({ eventId: "e", runId: "r", sessionId: "session-1" })),
        steerMessage: vi.fn(async () => ({ eventId: "e", runId: "r", sessionId: "session-1" })),
        abort: vi.fn(async () => ({ aborted: true })),
        compact: vi.fn(async () => ({ result: {}, session: protocolSession() })),
        rewind: vi.fn(async () => ({ message: {}, session: protocolSession() })),
        runShellCommand: vi.fn(async () => ({
            status: "finished",
            command: "ls",
            commandId: "c1",
            output: "a\n",
            exitCode: 0,
            timedOut: false,
            eventId: "e1",
        })),
        stopBackgroundProcess: vi.fn(async () => ({ stopped: true })),
        answerUserInput: vi.fn(async () => ({ session: protocolSession() })),
        changeModel: vi.fn(async () => ({ session: protocolSession() })),
        changeEffort: vi.fn(async () => ({ session: protocolSession() })),
        changePermissionMode: vi.fn(async () => ({ session: protocolSession() })),
        changeServiceTier: vi.fn(async () => ({ session: protocolSession() })),
        watchSessionEvents: vi.fn(async () => undefined),
        watchGlobalEvents: vi.fn(async () => undefined),
        ...overrides,
    } as unknown as RigProxyClient;
}

async function handle(
    client: RigProxyClient,
    method: string,
    path: string,
    request: IncomingMessage,
    captured: Captured,
    query = new URLSearchParams(),
    onConnectionError?: (error: unknown) => void,
): Promise<boolean> {
    return rigProxyHandle({
        client,
        method,
        path,
        query,
        request,
        response: captured.response,
        homeDir: HOME,
        ...(onConnectionError ? { onConnectionError } : {}),
    });
}

describe("rigProxyHandle", () => {
    it("projects GET /health", async () => {
        const captured = fakeResponse();
        const handled = await handle(clientStub(), "GET", "/health", getRequest(), captured);
        expect(handled).toBe(true);
        expect(captured.status).toBe(200);
        expect(JSON.parse(captured.body)).toMatchObject({ status: "ready", version: "9.9" });
    });

    it("projects GET /sessions into summaries", async () => {
        const captured = fakeResponse();
        await handle(clientStub(), "GET", "/sessions", getRequest(), captured);
        const body = JSON.parse(captured.body);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ id: "session-1", displayCwd: "~/work" });
    });

    it("projects GET /sessions/:id", async () => {
        const captured = fakeResponse();
        await handle(clientStub(), "GET", "/sessions/session-1", getRequest(), captured);
        expect(JSON.parse(captured.body)).toMatchObject({ id: "session-1", displayCwd: "~/work" });
    });

    it("searches a worktree's files by the group that owns it, not by a session", async () => {
        const searchFiles = vi.fn(async () => ({
            files: [{ fileName: "a.ts", path: "src/a.ts" }],
        }));
        const listCatalog = vi.fn(async () => ({
            projects: [{ id: "project-1", path: "/work" }],
            workspaces: [{ id: "workspace-1", projectId: "project-1", path: "/work/wt" }],
        }));
        const client = clientStub({
            listCatalog,
            searchFiles,
        } as unknown as Partial<RigProxyClient>);
        const captured = fakeResponse();
        const handled = await handle(
            client,
            "GET",
            "/workspace-file-search",
            getRequest(),
            captured,
            new URLSearchParams({ group: "workspace-1", q: "a", limit: "10" }),
        );
        expect(handled).toBe(true);
        // A worktree resolves to its project plus itself, which is the scope the
        // daemon's file routes are rooted in.
        expect(searchFiles).toHaveBeenCalledWith(
            { projectId: "project-1", workspaceId: "workspace-1" },
            "a",
            10,
        );
        expect(JSON.parse(captured.body)).toEqual([{ fileName: "a.ts", path: "src/a.ts" }]);
    });

    it("reads HEAD and working-tree text for a changed-file diff", async () => {
        const root = await mkdtemp(join(tmpdir(), "happy2-changed-file-"));
        try {
            execFileSync("git", ["init", "--quiet"], { cwd: root });
            await mkdir(join(root, "src"));
            await writeFile(join(root, "src", "answer.ts"), "export const answer = 42;\n");
            execFileSync("git", ["add", "src/answer.ts"], { cwd: root });
            execFileSync(
                "git",
                [
                    "-c",
                    "user.name=Happy Test",
                    "-c",
                    "user.email=happy@example.invalid",
                    "commit",
                    "--quiet",
                    "-m",
                    "initial",
                ],
                { cwd: root },
            );
            await writeFile(
                join(root, "src", "answer.ts"),
                "export const answer = 43;\nexport const ready = true;\n",
            );

            const listCatalog = vi.fn(async () => ({
                projects: [{ id: "project-1", path: root }],
                workspaces: [],
            }));
            // Read through the daemon by project scope, never off this machine's
            // disk: the checkout may belong to a Rig running somewhere else.
            const readProjectFile = vi.fn(async (scope: { projectId: string }, path: string) => {
                expect(scope).toEqual({ projectId: "project-1" });
                const content = await readFile(join(root, path));
                return {
                    content: content.toString("base64"),
                    hash: "current-hash",
                };
            });
            const captured = fakeResponse();
            await handle(
                clientStub({
                    listCatalog,
                    readFile: readProjectFile,
                } as unknown as Partial<RigProxyClient>),
                "GET",
                "/changed-file",
                getRequest(),
                captured,
                new URLSearchParams({ group: "project-1", path: "src/answer.ts" }),
            );

            expect(captured.status, captured.body).toBe(200);
            expect(JSON.parse(captured.body)).toEqual({
                path: "src/answer.ts",
                oldPath: "src/answer.ts",
                oldContent: "export const answer = 42;\n",
                newContent: "export const answer = 43;\nexport const ready = true;\n",
                hash: "current-hash",
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("projects GET /sessions/:id/usage into token/cost totals and quota windows", async () => {
        const client = clientStub();
        const captured = fakeResponse();
        const handled = await handle(
            client,
            "GET",
            "/sessions/session-1/usage",
            getRequest(),
            captured,
        );
        expect(handled).toBe(true);
        const body = JSON.parse(captured.body);
        expect(body).toMatchObject({
            currentProviderId: "openai",
            totalTokens: 155,
            totalCost: 0.3,
            context: { totalTokens: 155, approximate: true },
        });
        expect(body.groups[0]).toMatchObject({
            modelId: "gpt-x",
            inputTokens: 100,
            outputTokens: 40,
            reasoningTokens: 12,
            cost: 0.3,
        });
        // Only the available window survives; the unavailable weekly window is dropped.
        expect(body.quotas[0].windows).toEqual([
            { kind: "fiveHour", usedPercent: 42, resetsAt: 9_999 },
        ]);
    });

    it("maps POST messages idempotencyKey to clientSubmissionId", async () => {
        const submitMessage = vi.fn(async () => ({
            eventId: "e",
            runId: "r",
            sessionId: "session-1",
        }));
        const client = clientStub({ submitMessage } as unknown as Partial<RigProxyClient>);
        const captured = fakeResponse();
        const handled = await handle(
            client,
            "POST",
            "/sessions/session-1/messages",
            postRequest({ text: "hello", idempotencyKey: "key-1" }),
            captured,
        );
        expect(handled).toBe(true);
        expect(submitMessage).toHaveBeenCalledWith("session-1", {
            text: "hello",
            clientSubmissionId: "key-1",
        });
    });

    it("runs a shell command and projects the result", async () => {
        const runShellCommand = vi.fn(async () => ({
            status: "finished" as const,
            command: "ls",
            commandId: "c1",
            output: "a\n",
            exitCode: 0,
            timedOut: false,
            eventId: "e1",
        }));
        const client = clientStub({ runShellCommand } as unknown as Partial<RigProxyClient>);
        const captured = fakeResponse();
        const handled = await handle(
            client,
            "POST",
            "/sessions/session-1/shell",
            postRequest({ command: "ls", commandId: "c1" }),
            captured,
        );
        expect(handled).toBe(true);
        expect(runShellCommand).toHaveBeenCalledWith("session-1", {
            command: "ls",
            commandId: "c1",
        });
        expect(JSON.parse(captured.body)).toMatchObject({
            command: "ls",
            output: "a\n",
            exitCode: 0,
        });
    });

    it("stops a background process by id", async () => {
        const stopBackgroundProcess = vi.fn(async () => ({ stopped: true }));
        const client = clientStub({
            stopBackgroundProcess,
        } as unknown as Partial<RigProxyClient>);
        const captured = fakeResponse();
        const handled = await handle(
            client,
            "POST",
            "/sessions/session-1/stopBackgroundProcess",
            postRequest({ processId: 7 }),
            captured,
        );
        expect(handled).toBe(true);
        expect(stopBackgroundProcess).toHaveBeenCalledWith("session-1", 7);
    });

    it("streams projected session events over SSE and filters unprojectable ones", async () => {
        const events: SessionEvent[] = [
            {
                id: "e1",
                sessionId: "session-1",
                createdAt: 1,
                type: "run_started",
                data: { runId: "r" },
            } as SessionEvent,
            {
                id: "e2",
                sessionId: "session-1",
                createdAt: 2,
                type: "abort_requested",
                data: {},
            } as SessionEvent,
        ];
        const watchSessionEvents = vi.fn(
            async (options: { onEvent: (event: SessionEvent) => void }) => {
                for (const event of events) options.onEvent(event);
            },
        );
        const client = clientStub({ watchSessionEvents } as unknown as Partial<RigProxyClient>);
        const captured = fakeResponse();
        await handle(client, "GET", "/sessions/session-1/events/stream", getRequest(), captured);
        const dataFrames = captured.chunks.filter((chunk) => chunk.startsWith("data:"));
        expect(dataFrames).toHaveLength(1);
        expect(dataFrames[0]).toContain('"type":"run_started"');
    });

    it("reports a rejected token so the host rebuilds the connection", async () => {
        const listSessions = vi.fn(async () => {
            throw new RigDaemonHttpError(401, "unauthorized");
        });
        const onConnectionError = vi.fn();
        const captured = fakeResponse();
        await handle(
            clientStub({ listSessions } as unknown as Partial<RigProxyClient>),
            "GET",
            "/sessions",
            getRequest(),
            captured,
            new URLSearchParams(),
            onConnectionError,
        );

        expect(captured.status).toBe(401);
        expect(captured.body).toContain("unauthorized");
        expect(onConnectionError).toHaveBeenCalledOnce();
    });

    it("leaves a daemon-reported failure to the reader without reconnecting", async () => {
        const getSession = vi.fn(async () => {
            throw new RigDaemonHttpError(404, "no such session");
        });
        const onConnectionError = vi.fn();
        const captured = fakeResponse();
        await handle(
            clientStub({ getSession } as unknown as Partial<RigProxyClient>),
            "GET",
            "/sessions/missing",
            getRequest(),
            captured,
            new URLSearchParams(),
            onConnectionError,
        );

        expect(captured.status).toBe(404);
        expect(captured.body).toContain("no such session");
        expect(onConnectionError).not.toHaveBeenCalled();
    });

    it("returns false for an unknown path", async () => {
        const captured = fakeResponse();
        expect(await handle(clientStub(), "GET", "/nope", getRequest(), captured)).toBe(false);
    });
});
