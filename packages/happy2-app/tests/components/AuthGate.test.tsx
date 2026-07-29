import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../sources/App";

/* AuthGate offers a development token as an alternative to the configured
 * sign-in whenever the server advertises that it accepts one. The token is an
 * ordinary bearer, so it reaches the workspace through the same HttpOnly cookie
 * a password sign-in mints. These tests drive that boundary through a routed
 * fetch mock so bearer handling and route usage stay observable. */

const expiresAt = "2026-07-16T01:00:00.000Z";
const tokenKey = "happy2.session-token";
type Handler = (init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/* A never-resolving realtime stream keeps the workspace live without frames. */
const hangingStream = () => new Promise<Response>(() => {});

function routedFetch(routes: Record<string, Handler>) {
    return vi.fn((input: string, init: RequestInit = {}) => {
        const { pathname } = new URL(input);
        const method = (init.method ?? "GET").toUpperCase();
        const handler = routes[`${method} ${pathname}`];
        if (handler) return Promise.resolve(handler(init));
        // Permissive fallback for the workspace's background state fetches.
        return Promise.resolve(json({}));
    });
}

const authHeader = (init: RequestInit) =>
    (init.headers as Record<string, string> | undefined)?.authorization;

function callsTo(fetchMock: ReturnType<typeof routedFetch>, method: string, pathname: string) {
    return fetchMock.mock.calls.filter(([input, init]) => {
        const call = init ?? {};
        return (
            new URL(input as string).pathname === pathname &&
            ((call.method ?? "GET") as string).toUpperCase() === method
        );
    });
}

function stubLocalStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
    });
    return store;
}

const passwordMethods: Handler = () =>
    json({ role: "all", method: "password", signupEnabled: true });

/* A durable setup status whose route is already complete, so the onboarding
 * boundary hands straight off to the workspace. */
const completeSetup = () =>
    json({
        server: {
            schemaVersion: 1,
            complete: true,
            canManage: true,
            registration: "open",
            steps: {},
        },
        user: { profile: "complete", complete: true, steps: {} },
        route: { scope: "complete" },
        complete: true,
    });

const workspaceRoutes: Record<string, Handler> = {
    "GET /v0/sync/state": () =>
        json({ state: { generation: "1", sequence: "0" }, serverTime: expiresAt }),
    "GET /v0/chats": () => json({ chats: [] }),
    "GET /v0/projects": () => json({ projects: [] }),
    "GET /v0/documents": () => json({ documents: [] }),
    "GET /v0/drafts": () => json({ drafts: [], serverTime: new Date().toISOString() }),
    "GET /v0/sync/events": () => hangingStream(),
    "GET /v0/setup": completeSetup,
    "GET /v0/setup/status": () =>
        json({ schemaVersion: 1, phase: "complete", registration: "open" }),
};

const adaProfile = {
    user: { id: "u_ada", firstName: "Ada", username: "ada", kind: "human" },
    permissions: { allowed: [], owner: false },
};

afterEach(() => vi.unstubAllGlobals());

/* A development token is an alternative way to reach the same cookie, never a
 * replacement for the configured sign-in. These tests hold that boundary: the
 * configured method always stays reachable, the token option only appears where
 * the server would actually accept one, and the token itself is never persisted. */
describe("AuthGate development-token sign-in", () => {
    const devTokenMethods: Handler = () =>
        json({ role: "all", method: "password", signupEnabled: true, devTokensEnabled: true });
    const unauthorized: Handler = () => json({ error: "unauthorized" }, 401);
    const tokenField = (screen: ReturnType<typeof render>) =>
        screen.getByTestId("development-token-field").querySelector("input")!;

    it("offers the development token without requiring it, keeping password sign-in in place", async () => {
        const fetchMock = routedFetch({
            ...workspaceRoutes,
            "GET /v0/auth/methods": devTokenMethods,
            "GET /v0/me": unauthorized,
        });
        vi.stubGlobal("fetch", fetchMock);
        stubLocalStorage();

        const screen = render(<App cookieAuth serverUrl="http://server" />);

        // The configured method is what the user lands on. The token is opt-in.
        await screen.findByRole("button", { name: "Sign in" });
        expect(screen.container.querySelector('input[type="email"]')).toBeTruthy();
        expect(screen.getByRole("button", { name: "Use a development token" })).toBeTruthy();
        expect(screen.queryByTestId("development-token-field")).toBeNull();
    });

    it("signs in with a development token through the cookie endpoint and persists nothing", async () => {
        let meCount = 0;
        const fetchMock = routedFetch({
            ...workspaceRoutes,
            "GET /v0/auth/methods": devTokenMethods,
            "GET /v0/me": () => {
                meCount += 1;
                return meCount === 1 ? json({ error: "unauthorized" }, 401) : json(adaProfile);
            },
            "GET /v0/auth/web/session": () => json(adaProfile),
        });
        vi.stubGlobal("fetch", fetchMock);
        const store = stubLocalStorage();

        const screen = render(<App cookieAuth serverUrl="http://server" />);
        fireEvent.click(await screen.findByRole("button", { name: "Use a development token" }));

        const field = tokenField(screen);
        fireEvent.input(field, { target: { value: "dev-token-value" } });
        fireEvent.submit(field.closest("form")!);

        expect(await screen.findByLabelText("Ada — online")).toBeTruthy();

        // The token is spent once, on the endpoint that mints the HttpOnly cookie.
        const sessionCalls = callsTo(fetchMock, "GET", "/v0/auth/web/session");
        expect(sessionCalls).toHaveLength(1);
        expect(authHeader(sessionCalls[0]![1] ?? {})).toBe("Bearer dev-token-value");
        // Everything afterwards rides the cookie, and nothing is stored.
        for (const [, init] of callsTo(fetchMock, "GET", "/v0/me"))
            expect(authHeader(init ?? {})).toBeUndefined();
        expect(store.get(tokenKey)).toBeUndefined();
    });

    it("keeps a rejected token on the same screen with an inline error", async () => {
        const fetchMock = routedFetch({
            ...workspaceRoutes,
            "GET /v0/auth/methods": devTokenMethods,
            "GET /v0/me": unauthorized,
            "GET /v0/auth/web/session": unauthorized,
        });
        vi.stubGlobal("fetch", fetchMock);
        stubLocalStorage();

        const screen = render(<App cookieAuth serverUrl="http://server" />);
        fireEvent.click(await screen.findByRole("button", { name: "Use a development token" }));

        const field = tokenField(screen);
        fireEvent.input(field, { target: { value: "wrong" } });
        fireEvent.submit(field.closest("form")!);

        expect(await screen.findByText("Sign-in failed")).toBeTruthy();
        // Still on the token form, and the workspace never opened.
        expect(screen.getByTestId("development-token-field")).toBeTruthy();
        expect(screen.queryByLabelText("Ada — online")).toBeNull();
    });

    it("hides the option when the server will not accept a development token", async () => {
        const fetchMock = routedFetch({
            ...workspaceRoutes,
            "GET /v0/auth/methods": passwordMethods,
            "GET /v0/me": unauthorized,
        });
        vi.stubGlobal("fetch", fetchMock);
        stubLocalStorage();

        const screen = render(<App cookieAuth serverUrl="http://server" />);

        await screen.findByRole("button", { name: "Sign in" });
        expect(screen.queryByRole("button", { name: "Use a development token" })).toBeNull();
    });
});
