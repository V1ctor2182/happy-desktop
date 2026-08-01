// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RigPluginAppFrameProps } from "happy2-ui";
import { DesktopPluginApplicationView } from "./desktopPluginApplicationView";
import type { DesktopPluginAppRequest, HappyDesktopBridge } from "../shared/desktopContract";

/**
 * How this view names the requests it sends the main process.
 *
 * A name is what carries a View's cancellation across the process boundary,
 * where an abort signal cannot go, and the main process keys a request by its
 * origin and that name. A name repeated while an earlier request is still in
 * flight is therefore not a harmless collision: it replaces that request and
 * aborts it. The name has to stay unique for the whole mounted application
 * rather than for one render, which is what these tests hold the view to.
 *
 * The MCP Apps frame is stood in for here. Its own dialect is proven against the
 * published schema and against a real daemon elsewhere; what matters at this
 * boundary is only what the view hands it, so the stand-in captures those
 * handlers and the test calls them exactly as a mounted View makes the frame
 * call them.
 */
let handlers: RigPluginAppFrameProps | undefined;

vi.mock("happy2-ui", () => ({
    RigPluginAppFrame: (props: RigPluginAppFrameProps) => {
        handlers = props;
        return <div data-testid="frame" />;
    },
}));

interface SentRequest {
    readonly body: DesktopPluginAppRequest;
    readonly origin: string;
    readonly requestId: string;
}

function bridgeCreate() {
    const cancelled: { origin: string; requestId: string }[] = [];
    const sent: SentRequest[] = [];
    const bridge = {
        pluginAppCancel: async (origin: string, requestId: string) => {
            cancelled.push({ origin, requestId });
        },
        // Never settles, so every request stays in flight for as long as the
        // test needs it to. A request that has already answered could not
        // collide with anything.
        pluginAppRequest: (origin: string, requestId: string, body: DesktopPluginAppRequest) =>
            new Promise<unknown>(() => {
                sent.push({ body, origin, requestId });
            }),
    } as unknown as HappyDesktopBridge;
    return { bridge, cancelled, sent };
}

const SOURCE = "happy-plugin://abc123def456/index.html";
// Derived rather than written out: `happy-plugin` is a standard scheme only
// because Electron registers it as one before Chromium starts, and a plain URL
// parser has no such registration. What this boundary owes is one consistent
// origin per mounted application, not a particular spelling of it.
const ORIGIN = new URL(SOURCE).origin;

function element(bridge: HappyDesktopBridge, title: string) {
    return (
        <DesktopPluginApplicationView
            applicationId="reporter:overview"
            bridge={bridge}
            generation="g1"
            source={SOURCE}
            title={title}
        />
    );
}

describe("DesktopPluginApplicationView request names", () => {
    it("keeps naming requests uniquely across a rerender, and withdraws none of them", () => {
        const { bridge, cancelled, sent } = bridgeCreate();
        const { rerender } = render(element(bridge, "Account overview"));

        // One request, deliberately unanswered, so it is still in flight below.
        const first = new AbortController();
        void handlers!.storageGet("layout", { signal: first.signal });
        expect(sent).toHaveLength(1);

        // Anything above re-renders. A per-render counter starts again here.
        rerender(element(bridge, "Account overview (renamed)"));

        const second = new AbortController();
        void handlers!.storageGet("theme", { signal: second.signal });
        expect(sent).toHaveLength(2);

        // The names differ, so the main process holds two requests rather than
        // one request silently replaced by another.
        expect(sent[1]!.requestId).not.toBe(sent[0]!.requestId);
        expect(new Set(sent.map((request) => request.requestId)).size).toBe(2);
        // The request still in flight was not withdrawn, which is what a reused
        // name would have caused.
        expect(cancelled).toEqual([]);
        // Both were sent for the same mounted origin, which is the scope a name
        // has to be unique within: a new generation is a new frame on a new
        // origin, so names never have to be unique across generations.
        expect(sent.map((request) => request.origin)).toEqual([ORIGIN, ORIGIN]);
    });

    it("keeps naming them uniquely across many renders and every operation", () => {
        const { bridge, sent } = bridgeCreate();
        const { rerender } = render(element(bridge, "Account overview"));

        for (let round = 0; round < 5; round += 1) {
            const controller = new AbortController();
            void handlers!.toolCall("refresh", {}, { signal: controller.signal });
            void handlers!.resourceRead("ui://a/b", { signal: controller.signal });
            void handlers!.storageList({ signal: controller.signal });
            rerender(element(bridge, `Account overview ${round}`));
        }

        expect(sent).toHaveLength(15);
        expect(new Set(sent.map((request) => request.requestId)).size).toBe(15);
    });

    it("withdraws exactly the request whose View gave up on it", async () => {
        const { bridge, cancelled, sent } = bridgeCreate();
        render(element(bridge, "Account overview"));

        const first = new AbortController();
        const second = new AbortController();
        void handlers!.storageGet("layout", { signal: first.signal });
        void handlers!.storageGet("theme", { signal: second.signal });

        first.abort();
        await Promise.resolve();

        expect(cancelled).toEqual([{ origin: ORIGIN, requestId: sent[0]!.requestId }]);
    });
});
