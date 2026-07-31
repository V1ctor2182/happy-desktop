import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import type {
    RigClockStore,
    RigConnectionStore,
    RigHost,
    RigModelStore,
    RigPanelStore,
    RigWorkspaceStore,
} from "happy2-state";
import { appearanceStoreCreate, rigHostNoop } from "happy2-state";
import {
    AppRigView,
    type AppRigDirectorySnapshot,
    type AppRigDirectoryStore,
} from "../../sources/AppRigView";

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

/* The right panel starts hidden, so these projections render the workspace
 * without it and never reach a terminal. */
const PANEL_CLOSED = { open: false, tabs: [] } as const;

function panel(): RigPanelStore {
    return {
        get: () => PANEL_CLOSED,
        subscribe: () => () => undefined,
        panelToggle: () => undefined,
        terminalAdd: () => undefined,
        tabSelect: () => undefined,
        tabClose: () => undefined,
        terminal: () => undefined,
        conversationApply: () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigPanelStore;
}

function workspace(): RigWorkspaceStore {
    const snapshot = {
        list: {
            projects: {
                type: "ready" as const,
                value: [
                    {
                        id: "prj_one",
                        path: "/Users/happy/happy2",
                        displayPath: "~/happy2",
                        name: "happy2",
                        kind: "regular" as const,
                        worktrees: [],
                        activity: "idle" as const,
                        updatedAt: 1_763_999_000_000,
                        conversations: [
                            {
                                id: "ses_one",
                                title: "Fix token rotation race",
                                subtitle: "~/happy2",
                                updatedAt: 1_763_999_000_000,
                                activity: "idle" as const,
                            },
                        ],
                    },
                ],
            },
        },
        conversation: { type: "unloaded" as const },
        fileTabs: [],
        openInTargets: [],
        fileViewMode: "unified" as const,
        fileScope: "changed" as const,
        fileLayout: "flat" as const,
        fileTreeExpanded: new Set<string>(),
        workspaceFilesLoading: false,
    };
    return {
        get: () => snapshot,
        panel: panel(),
        subscribe: () => () => undefined,
        conversationOpen: () => undefined,
        conversationClose: () => undefined,
        conversationListRetry: () => undefined,
        conversationRetry: () => undefined,
        [Symbol.dispose]: () => undefined,
    } as unknown as RigWorkspaceStore;
}

/* The catalog is only read by the settings window, so this projection needs
 * nothing more than a store that never resolves. */
function modelStore(): RigModelStore {
    return {
        get: () => MODELS_LOADING,
        subscribe: () => () => undefined,
        load: () => Promise.resolve(),
        [Symbol.dispose]: () => undefined,
    } as unknown as RigModelStore;
}

const MODELS_LOADING = { type: "loading" } as const;

/** One connected local Rig holding the project above; no remote machines. */
function directory(host: RigHost, projects: AppRigDirectorySnapshot["rigs"][number]["projects"]) {
    const snapshot: AppRigDirectorySnapshot = {
        add: { destination: "", label: "", open: false },
        rigs: [
            {
                connected: true,
                id: "local",
                kind: "local",
                label: "This Mac",
                projects,
                projectsStatus: "ready",
                session: {
                    clock: clock(),
                    connection: connection(),
                    host,
                    models: modelStore(),
                    workspace: workspace(),
                },
                status: "connected",
            },
        ],
    };
    const store: AppRigDirectoryStore = {
        get: () => snapshot,
        subscribe: () => () => undefined,
        addOpen: () => undefined,
        addClose: () => undefined,
        destinationUpdate: () => undefined,
        labelUpdate: () => undefined,
        addSubmit: () => undefined,
        rigConnect: () => undefined,
        rigDisconnect: () => undefined,
        rigRemove: () => undefined,
        rigActivate: () => undefined,
    };
    return store;
}

function view(
    options: {
        chatId?: string;
        groupId?: string;
        host?: RigHost;
        onChatSelect?: (rigId: string, groupId: string | undefined, chatId?: string) => void;
    } = {},
) {
    const projects = (
        workspace().get() as unknown as {
            list: { projects: { value: AppRigDirectorySnapshot["rigs"][number]["projects"] } };
        }
    ).list.projects.value;
    return render(
        <AppRigView
            appearance={appearanceStoreCreate({ mode: "light" })}
            chatId={options.chatId}
            groupId={options.groupId}
            onChatSelect={options.onChatSelect ?? (() => undefined)}
            onSettingsOpen={() => undefined}
            rigId="local"
            rigs={directory(options.host ?? rigHostNoop, projects)}
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
    expect(container.querySelector('[data-happy2-ui="sidebar-title"]')?.textContent).toBe("Happy");

    // The plain title row and its chevron affordance are gone.
    expect(container.textContent).not.toContain("Local");
    expect(container.querySelector(".happy2-sidebar__title-chevron")).toBeNull();
});

it("highlights the addressed project and asks to navigate into it when it is picked", () => {
    const selected: (string | undefined)[][] = [];
    const { container } = view({
        groupId: "prj_one",
        onChatSelect: (rigId, groupId, chatId) => selected.push([rigId, groupId, chatId]),
    });

    const row = container.querySelector('[data-item-id="local/prj_one"]');
    expect(row?.getAttribute("aria-current")).toBe("page");

    // Picking a row is a navigation request into the project's most recent
    // session; this surface never selects a conversation in the store itself.
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected).toEqual([["local", "prj_one", "ses_one"]]);
});

it("lists one row per project and its sessions as tabs", () => {
    const { container } = view({ groupId: "prj_one" });

    // The shared sidebar renders its compose row ("New session") and the pinned
    // window actions ahead of the list, so the project rows follow them.
    const rows = [...container.querySelectorAll('[data-happy2-ui="sidebar-item"]')];
    expect(rows.map((row) => row.getAttribute("data-item-id"))).toEqual([
        "new-chat",
        "friends",
        "local/prj_one",
    ]);
    // The row is the project's name alone; its path would crowd the name out,
    // and the heading over the open project states it in full.
    expect(rows[2]?.textContent).toContain("happy2");
    expect(rows[2]?.textContent).not.toContain("~/happy2");

    // The sessions inside the addressed project are its tabs.
    const tabs = [...container.querySelectorAll('[data-happy2-ui="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("data-tab-id"))).toEqual(["ses_one"]);
    expect(tabs[0]?.textContent).toContain("Fix token rotation race");
});
