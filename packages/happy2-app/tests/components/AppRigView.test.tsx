import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import type { RigClockStore, RigConnectionStore, RigHost, RigWorkspaceStore } from "happy2-state";
import { rigHostNoop } from "happy2-state";
import { AppRigView } from "../../sources/AppRigView";

/* The local workspace renders the shared cloud components with local product
 * state. These tests pin the parts of that contract the app layer owns: which
 * shared component it composes and which props it supplies. The stores are
 * inert stubs because this boundary is a pure projection — no store here starts
 * transport, timers, or authentication work. */

/* `useSyncExternalStore` requires a cached snapshot, so every stub `get()`
 * returns one stable object rather than a fresh literal per call. */
const CONNECTED = { connection: "connected", daemon: "ready", attempt: 0 } as const;

function connection(): RigConnectionStore {
    return {
        get: () => CONNECTED,
        subscribe: () => () => undefined,
        retry: () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigConnectionStore;
}

function clock(): RigClockStore {
    return {
        get: () => 1_764_000_000_000,
        subscribe: () => () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigClockStore;
}

function workspace(): RigWorkspaceStore {
    const snapshot = {
        list: {
            conversations: {
                type: "ready" as const,
                value: [
                    {
                        id: "ses_one",
                        title: "Fix token rotation race",
                        subtitle: "~/happy2",
                        updatedAt: 1_763_999_000_000,
                        activity: "idle" as const,
                    },
                ],
            },
        },
        conversation: { type: "unloaded" as const },
    };
    return {
        get: () => snapshot,
        subscribe: () => () => undefined,
        conversationOpen: () => undefined,
        conversationClose: () => undefined,
        conversationListRetry: () => undefined,
        conversationRetry: () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigWorkspaceStore;
}

function view(
    options: { chatId?: string; host?: RigHost; onChatSelect?: (id?: string) => void } = {},
) {
    return render(
        <AppRigView
            chatId={options.chatId}
            clock={clock()}
            connection={connection()}
            host={options.host ?? rigHostNoop}
            onChatSelect={options.onChatSelect ?? (() => undefined)}
            workspace={workspace()}
        />,
    );
}

it("heads the local sidebar with the shared brand mark, not a local-only title", () => {
    const { container } = view();

    // Local renders the same brand heading the cloud surface does, so the two
    // modes stay one component rendered twice rather than a local variant.
    const logo = container.querySelector('[data-happy2-ui="sidebar-brand-logo"]');
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-happy2-ui="sidebar-title"]')?.textContent).toBe(
        "Happy Place",
    );

    // The plain title row and its chevron affordance are gone.
    expect(container.textContent).not.toContain("Local");
    expect(container.querySelector(".happy2-sidebar__title-chevron")).toBeNull();
});

it("highlights the addressed session and asks to navigate when another is picked", () => {
    const selected: (string | undefined)[] = [];
    const { container } = view({ chatId: "ses_one", onChatSelect: (id) => selected.push(id) });

    const row = container.querySelector('[data-item-id="ses_one"]');
    expect(row?.getAttribute("aria-current")).toBe("page");

    // Picking a row is a navigation request; this surface never selects a
    // conversation in the workspace store itself.
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toEqual(["ses_one"]);
});

it("still lists local sessions under the branded heading", () => {
    const { container } = view();

    // The shared sidebar renders its compose row ("New session") ahead of the
    // session list, so the local rows follow it.
    const rows = [...container.querySelectorAll('[data-happy2-ui="sidebar-item"]')];
    expect(rows.map((row) => row.getAttribute("data-item-id"))).toEqual(["new-chat", "ses_one"]);
    expect(rows[0]?.textContent).toContain("New session");
    expect(rows[1]?.textContent).toContain("Fix token rotation race");
});
