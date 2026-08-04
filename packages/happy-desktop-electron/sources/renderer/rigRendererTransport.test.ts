// @vitest-environment jsdom
//
// The transport is renderer code: it reaches `happy-desktop-app`, and through it
// `happy-desktop-ui`, whose worker-backed syntax highlighting imports the Pierre
// worker module. That module is browser code and touches `self` the moment it
// is evaluated, so importing this file under the plain node environment throws
// before a single test runs. jsdom is where renderer code belongs anyway, and
// it is the environment the other renderer tests here use.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RigEventId, RigSessionEvent, RigSessionId } from "happy-desktop-state";
import { rigRendererTransportCreate } from "./rigRendererTransport";

const BASE = "http://127.0.0.1:9999";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as unknown as Response;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { EventSource?: unknown }).EventSource;
});

describe("rigRendererTransport", () => {
    it("carries the loopback capability into terminal WebSocket authentication", () => {
        const sockets: { protocols: string[] }[] = [];
        vi.stubGlobal(
            "WebSocket",
            class {
                static OPEN = 1;
                binaryType = "";
                readyState = 0;
                constructor(_url: string, protocols: string[]) {
                    sockets.push({ protocols });
                }
                addEventListener() {}
                close() {}
            },
        );
        const transport = rigRendererTransportCreate(`${BASE}/opaque-capability`);
        transport.terminalConnect("session-1" as RigSessionId, "terminal-1" as never);
        expect(sockets[0]?.protocols).toEqual([
            "happy2-terminal.v1",
            "happy2-capability.opaque-capability",
        ]);
    });

    it("reads the model catalog from GET /models", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            jsonResponse({
                defaultModelId: "m",
                defaultProviderId: "p",
                models: [],
                providers: [],
            }),
        );
        const transport = rigRendererTransportCreate(BASE);
        const catalog = await transport.modelsRead();
        expect(catalog.defaultModelId).toBe("m");
        expect(fetchMock).toHaveBeenCalledWith(`${BASE}/models`);
    });

    it("posts a submit with text and idempotency key", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
        const transport = rigRendererTransportCreate(BASE);
        await transport.messageSubmit("session-1" as RigSessionId, "hello", "key-1");
        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE}/sessions/session-1/messages`,
            expect.objectContaining({ method: "POST" }),
        );
        const call = fetchMock.mock.calls[0]![1] as RequestInit;
        expect(JSON.parse(call.body as string)).toEqual({ text: "hello", idempotencyKey: "key-1" });
    });

    it("throws a displayable error using the server error body", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            jsonResponse({ error: "boom" }, false, 502),
        );
        const transport = rigRendererTransportCreate(BASE);
        await expect(transport.sessionRead("x" as RigSessionId)).rejects.toThrow("boom");
    });

    it("opens an EventSource for session events and forwards parsed frames", () => {
        const instances: FakeEventSource[] = [];
        class FakeEventSource {
            onmessage: ((event: { data: string }) => void) | null = null;
            onerror: (() => void) | null = null;
            closed = false;
            constructor(readonly url: string) {
                instances.push(this);
            }
            close() {
                this.closed = true;
            }
        }
        (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;

        const transport = rigRendererTransportCreate(BASE);
        const received: RigSessionEvent[] = [];
        const unsubscribe = transport.sessionEventsSubscribe(
            "session-1" as RigSessionId,
            {
                event: (value) => received.push(value),
                error: () => undefined,
                end: () => undefined,
            },
            "cursor-1" as RigEventId,
        );

        const source = instances[0]!;
        expect(source.url).toBe(`${BASE}/sessions/session-1/events/stream?after=cursor-1`);
        source.onmessage!({ data: JSON.stringify({ type: "run_started", runId: "r" }) });
        expect(received).toEqual([{ type: "run_started", runId: "r" }]);

        unsubscribe();
        expect(source.closed).toBe(true);
    });
});
