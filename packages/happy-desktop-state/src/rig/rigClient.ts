import type { TerminalDriverCreate } from "../modules/terminal/terminalState.js";
import type { HappyAgentClient } from "@slopus/happy-agent-client";
import { UserError } from "../types.js";
import { rigProjectAddError } from "./rigProjectRegistration.js";
import type { MutationRejectedDelta } from "../happyAgentConnection/index.js";
import type { RigConnection } from "../happyAgentConnection/index.js";
import { rigTerminalOpen, type RigTerminalHandle } from "./rigTerminalStore.js";
import {
    rigChatStoreCreate,
    type RigChatDeps,
    type RigChatOutput,
    type RigChatStore,
    type RigChatTranscriptConnect,
} from "./rigChatStore.js";
import {
    rigSessionListStoreCreate,
    type RigSessionCatalogSource,
    type RigSessionListOutput,
    type RigSessionListStore,
} from "./rigSessionListStore.js";
import type { RigHostServices } from "./rigHostServices.js";
import {
    rigHappyAgentChangedFileProject,
    rigHappyAgentModelCatalogProject,
    rigTextDecodeBase64,
    rigTextEncodeBase64,
} from "./rigHappyAgentProject.js";
import type {
    RigChangedFileDocument,
    RigFileSearchResult,
    RigGroupId,
    RigOpenInTargets,
    RigWorkspaceFileBytes,
    RigWorkspaceFileDocument,
    RigWorkspaceFileTreePage,
    RigModelCatalog,
    RigProjectId,
    RigSessionId,
} from "./rigTypes.js";
import { rigModelStoreCreate, type RigModelStore } from "./rigModelStore.js";
import type { RigModelPreferencePersistence } from "./rigModelStore.js";
import {
    rigWorkspaceMemoryStoreCreate,
    type RigWorkspaceMemoryPersistence,
    type RigWorkspaceMemoryStore,
} from "./rigWorkspaceMemory.js";
import { rigInboxStoreCreate, type RigInboxSource, type RigInboxStore } from "./rigInboxStore.js";
import { rigInstructionsStoreCreate, type RigInstructionsStore } from "./rigInstructionsStore.js";
import {
    rigSecurityPolicyStoreCreate,
    type RigSecurityPolicyStore,
} from "./rigSecurityPolicyStore.js";
import {
    rigProviderUsageStoreCreate,
    type RigProviderUsageSource,
    type RigProviderUsageStore,
} from "./rigProviderUsageStore.js";
import {
    rigProfileStoreCreate,
    type RigProfileActions,
    type RigProfileSource,
    type RigProfileStore,
} from "./rigProfileStore.js";

/** A disposable view lease on one retained session chat store. */
export interface RigChatHandle {
    readonly store: RigChatStore;
    [Symbol.dispose](): void;
}

export interface RigClient {
    /** One model/capability/default/last-used authority for this daemon connection. */
    readonly models: RigModelStore;
    /**
     * What this Rig remembers between runs: each group's tabs and which sessions
     * have unseen finished work. Shared by the list and the workspace so both
     * read and write the one document the host persists.
     */
    readonly memory: RigWorkspaceMemoryStore;
    /** Loads (once) and returns the model catalog; cached for the client's lifetime. */
    catalogRead(): Promise<RigModelCatalog>;
    /** The single session-list store; materialized on first access. */
    sessionList(): RigSessionListStore;
    /**
     * The single inbox store for this Rig: every question its agents are waiting
     * on. Materialized on first access and shared, because the sidebar's pending
     * count and the open inbox are the same queue seen twice. Unavailable when the
     * host supplied no question feed, so a surface can say so instead of showing
     * an inbox that is empty for the wrong reason.
     */
    inbox(): RigInboxStore | undefined;
    /**
     * The single provider-usage store for this Rig: how much of each account's
     * plan its agents have spent. Materialized on first access and shared, so a
     * second surface reading the same accounts costs no extra daemon reads.
     * Unavailable when the host supplied no usage feed, so a surface can say the
     * machine does not report usage rather than showing an account list that is
     * empty for the wrong reason.
     */
    providerUsage(): RigProviderUsageStore | undefined;
    /** The one host-owned identity work is authored as. */
    profile(): RigProfileStore | undefined;
    /**
     * This Rig's own machine-wide instructions, as one editable document.
     * Materialized on first access and shared, so the settings window and
     * anything else showing them are looking at the same draft.
     */
    instructions(): RigInstructionsStore;
    /** This Rig's machine-wide permission-review policy, as one editable document. */
    securityPolicy(): RigSecurityPolicyStore;
    /** Reads one bounded page of one checkout directory. */
    workspaceFileTreeRead(
        groupId: RigGroupId,
        path: string,
        cursor?: string,
    ): Promise<RigWorkspaceFileTreePage>;
    /**
     * Searches one checkout for `@`-mention candidates. A pure query: the result
     * is transient composer typeahead and never enters a durable snapshot.
     */
    filesSearch(
        groupId: RigGroupId,
        query: string,
        limit?: number,
    ): Promise<readonly RigFileSearchResult[]>;
    /**
     * Reads one existing text file from a project/worktree checkout. A file
     * belongs to the checkout rather than to any conversation open over it, so
     * it is addressed by the group.
     */
    workspaceFileRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileDocument>;
    /**
     * Reads one workspace file as bytes, for showing it rather than editing it.
     * Makes no claim that the file is text, so an image or a video arrives whole.
     */
    workspaceFileBytesRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileBytes>;
    /**
     * Where one HTML document of a checkout is served as a page, for a viewer
     * that renders the document rather than its source.
     */
    htmlPreviewOpen(groupId: RigGroupId, path: string): Promise<string>;
    /** Writes one existing text file back to its checkout. */
    workspaceFileWrite(
        groupId: RigGroupId,
        path: string,
        content: string,
        expectedHash: string | null,
    ): Promise<void>;
    /**
     * Copies an attached file into a project or worktree checkout, answering
     * with the path it landed on relative to that checkout.
     */
    attachmentWrite(
        groupId: RigGroupId,
        name: string,
        content: string,
    ): Promise<{ readonly path: string }>;
    /**
     * Registers one folder on this Rig's machine as a project and resolves with
     * the identity Rig gave it. Nothing is started in it: a project is a folder
     * Rig knows about, and a conversation in it is a separate decision.
     *
     * Rig is authoritative for what may become a project and answers by
     * canonical path, so registering a folder it already holds returns the
     * project it already has rather than a second copy of it. A refusal arrives
     * as a displayable `UserError`.
     */
    projectAdd(path: string): Promise<RigProjectId>;
    /** Applications this host can open a project or worktree directory in. */
    openInTargetsRead(): Promise<RigOpenInTargets>;
    /** Opens one project or worktree root in one of those applications. */
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;
    /** Reads one changed text file from a project/worktree checkout. */
    changedFileRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigChangedFileDocument>;
    /**
     * Acquires a retained chat store for one session. Concurrent and later
     * acquisitions share its messages and model state; releasing a view lease
     * never evicts it or stops its client-owned background synchronization.
     */
    chat(sessionId: RigSessionId): Promise<RigChatHandle>;
    /** Stops background synchronization for an archived chat without evicting its memory. */
    chatArchive(sessionId: RigSessionId): void;
    /**
     * Opens one interactive terminal in a session's working directory. Unlike a
     * chat store these are not shared or reference-counted: two terminals in the
     * same session are two separate shells, which is the whole point of being able
     * to open more than one. Disposing the handle stops the remote terminal.
     */
    terminalOpen(sessionId: RigSessionId): RigTerminalHandle;
    [Symbol.dispose](): void;
}

export interface RigClientDeps {
    readonly client: HappyAgentClient;
    readonly connection: RigConnection;
    readonly hostServices: RigHostServices;
    /** Stream-owned read authority for the project/workspace/session catalog. */
    readonly catalogSource: RigSessionCatalogSource;
    /**
     * Stream-owned feed of the questions this Rig's agents are waiting on.
     * Omitted leaves the inbox unavailable rather than empty.
     */
    readonly inboxSource?: RigInboxSource;
    /**
     * Repeating read of each provider account's plan usage. Omitted leaves usage
     * unavailable rather than empty.
     */
    readonly providerUsageSource?: RigProviderUsageSource;
    /** Host-only profile read and mutation. Omitted on a node connection. */
    readonly profileSource?: RigProfileSource;
    readonly profileActions?: RigProfileActions;
    /** Opens the core transcript stream for one materialized chat. */
    readonly transcriptConnect: RigChatTranscriptConnect;
    /** Terminal failures emitted by the shared Happy Agent mutation authority. */
    readonly connectMutationSubscribe: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
    readonly sessionListOutput?: (event: RigSessionListOutput) => void;
    readonly chatOutput?: (sessionId: RigSessionId, event: RigChatOutput) => void;
    readonly modelPreferencePersistence?: RigModelPreferencePersistence;
    /** Where this Rig's tab and read memory is kept; omitted keeps it in memory. */
    readonly workspaceMemoryPersistence?: RigWorkspaceMemoryPersistence;
    /**
     * Builds the driver behind a terminal: the app-layer machinery that owns the
     * terminal protocol client and the VT emulator. Omitting it leaves terminals
     * unavailable — they report that instead of failing silently — which is what an
     * app with no emulator to offer should do.
     */
    readonly terminalDriverCreate?: TerminalDriverCreate;
}

interface ChatBinding {
    count: number;
    readonly storePromise: Promise<RigChatStore>;
    store?: RigChatStore;
    backgroundUnsubscribe?: () => void;
    archived: boolean;
}

async function workspaceFileTreeRead(
    client: Pick<HappyAgentClient, "getFileTree">,
    groupId: RigGroupId,
    path: string,
    cursor?: string,
): Promise<RigWorkspaceFileTreePage> {
    const page = await client.getFileTree(groupId, {
        ...(path === "" ? {} : { path }),
        ...(cursor === undefined ? {} : { cursor }),
        limit: 500,
    });
    const entries = page.entries.flatMap((entry) => {
        // `.git` is never a browsable project entry. Older daemons exposed it
        // and then refused expansion; newer ones omit it at the source.
        if (entry.name === ".git" || entry.type === "other") return [];
        return [
            {
                kind: entry.type === "directory" ? ("directory" as const) : ("file" as const),
                name: entry.name,
                path: entry.path,
            },
        ];
    });
    return {
        entries,
        ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
    };
}

async function changedFileRead(
    client: Pick<HappyAgentClient, "getWorkspaceGit" | "readFile" | "readFileRevision">,
    groupId: RigGroupId,
    path: string,
    signal?: AbortSignal,
): Promise<RigChangedFileDocument> {
    const { git } = await client.getWorkspaceGit(groupId, { signal });
    const change = git.files.find((candidate) => candidate.path === path);
    if (change === undefined) throw new UserError("That file is no longer changed.");

    const oldContent =
        change.status === "added" ||
        change.status === "untracked" ||
        git.comparison === "unavailable" ||
        git.base === null
            ? ""
            : rigTextDecodeBase64(
                  (await client.readFileRevision(groupId, { path, revision: git.base }, { signal }))
                      .content,
              );
    const current =
        change.status === "deleted" ? undefined : await client.readFile(groupId, path, { signal });
    return rigHappyAgentChangedFileProject({
        path,
        oldContent,
        newContent: current === undefined ? "" : rigTextDecodeBase64(current.content),
        ...(current === undefined ? {} : { hash: current.hash }),
    });
}

/**
 * Composition root for a direct Happy Agent client: it owns the stateless `/v0`
 * client, the live connection, model store, session list, and retained chats.
 * Once opened, a non-archived chat stays synchronized for this client's lifetime;
 * archiving suspends its live subscription but leaves messages and model state in memory.
 */
export function rigClientCreate(deps: RigClientDeps): RigClient {
    const models = rigModelStoreCreate({
        catalogRead: async () =>
            rigHappyAgentModelCatalogProject((await deps.client.getConfig()).config),
        ...(deps.modelPreferencePersistence
            ? { preferencePersistence: deps.modelPreferencePersistence }
            : {}),
    });
    const memory = rigWorkspaceMemoryStoreCreate(deps.workspaceMemoryPersistence);
    let sessionListStore: RigSessionListStore | undefined;
    let inboxStore: RigInboxStore | undefined;
    let providerUsageStore: RigProviderUsageStore | undefined;
    let profileStore: RigProfileStore | undefined;
    let instructionsStore: RigInstructionsStore | undefined;
    let securityPolicyStore: RigSecurityPolicyStore | undefined;
    const chats = new Map<RigSessionId, ChatBinding>();
    let disposed = false;

    return {
        models,
        memory,
        catalogRead: () => models.load().then((snapshot) => snapshot.catalog),
        changedFileRead: (groupId, path, signal) =>
            changedFileRead(deps.client, groupId, path, signal),
        workspaceFileTreeRead: (groupId, path, cursor) =>
            workspaceFileTreeRead(deps.client, groupId, path, cursor),
        filesSearch: async (groupId, query, limit) =>
            (
                await deps.client.searchFiles(groupId, {
                    query,
                    ...(limit === undefined ? {} : { limit }),
                })
            ).files.map((file) => ({ fileName: file.fileName, path: file.path })),
        workspaceFileRead: async (groupId, path, signal) => {
            const file = await deps.client.readFile(groupId, path, { signal });
            return { path, content: rigTextDecodeBase64(file.content), hash: file.hash };
        },
        workspaceFileBytesRead: (groupId, path, signal) =>
            deps.hostServices.workspaceFileBytesRead(groupId, path, signal),
        htmlPreviewOpen: (groupId, path) => deps.hostServices.htmlPreviewOpen(groupId, path),
        workspaceFileWrite: async (groupId, path, content, expectedHash) => {
            await deps.client.writeFile(groupId, {
                path,
                content: rigTextEncodeBase64(content),
                expectedHash,
            });
        },
        attachmentWrite: (groupId, name, content) =>
            deps.hostServices.attachmentWrite(groupId, name, content),
        async projectAdd(path) {
            // Registration is the daemon's own decision, so it goes directly
            // through the connection actions: the daemon validates the folder,
            // names the project, and is idempotent by canonical path. A
            // connection without project actions cannot ask, and says so rather
            // than pretending the folder was added.
            try {
                const project = await deps.connection.projects.add(path);
                return project.id as RigProjectId;
            } catch (error) {
                throw rigProjectAddError(error, path);
            }
        },
        openInTargetsRead: () => deps.hostServices.openInTargetsRead(),
        openIn: (groupId, targetId) => deps.hostServices.openIn(groupId, targetId),
        sessionList() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!sessionListStore) {
                sessionListStore = rigSessionListStoreCreate({
                    client: deps.client,
                    catalogSource: deps.catalogSource,
                    connectActions: deps.connection,
                    connectMutationSubscribe: deps.connectMutationSubscribe,
                    output: deps.sessionListOutput,
                });
            }
            return sessionListStore;
        },
        inbox() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const source = deps.inboxSource;
            if (!source) return undefined;
            inboxStore ??= rigInboxStoreCreate({
                source,
                output: (event) => {
                    const store = inboxStore;
                    if (!store) return;
                    deps.connection.answerUserInput(event.sessionId, event.requestId, {
                        answers: event.answers,
                    });
                    store.inboxInput({ type: "itemAnswerSucceeded", itemId: event.itemId });
                },
            });
            return inboxStore;
        },
        providerUsage() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const source = deps.providerUsageSource;
            if (!source) return undefined;
            providerUsageStore ??= rigProviderUsageStoreCreate({ source });
            return providerUsageStore;
        },
        profile() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!deps.profileSource || !deps.profileActions) return undefined;
            profileStore ??= rigProfileStoreCreate({
                source: deps.profileSource,
                actions: deps.profileActions,
            });
            return profileStore;
        },
        instructions() {
            if (disposed) throw new Error("The Rig client is disposed.");
            instructionsStore ??= rigInstructionsStoreCreate({ client: deps.client });
            return instructionsStore;
        },
        securityPolicy() {
            if (disposed) throw new Error("The Rig client is disposed.");
            securityPolicyStore ??= rigSecurityPolicyStoreCreate({ client: deps.client });
            return securityPolicyStore;
        },
        async chat(sessionId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            let binding = chats.get(sessionId);
            if (!binding) {
                const storePromise = models.load().then(({ catalog }) => {
                    const chatDeps: RigChatDeps = {
                        catalog,
                        transcriptConnect: deps.transcriptConnect,
                        connectActions: deps.connection,
                        connectMutationSubscribe: deps.connectMutationSubscribe,
                        selectionUsed: (selection) => models.selectionUsed(selection),
                        modelSelect: (current, input) => models.modelSelect(current, input),
                        output: deps.chatOutput
                            ? (event) => deps.chatOutput?.(sessionId, event)
                            : undefined,
                    };
                    const store = rigChatStoreCreate(sessionId, chatDeps);
                    const current = chats.get(sessionId);
                    if (current) {
                        current.store = store;
                        if (!current.archived) {
                            current.backgroundUnsubscribe = store.subscribe(() => {
                                if (!store.get().archived) return;
                                current.archived = true;
                                current.backgroundUnsubscribe?.();
                                current.backgroundUnsubscribe = undefined;
                            });
                        }
                    }
                    return store;
                });
                binding = { count: 0, storePromise, archived: false };
                chats.set(sessionId, binding);
            }
            binding.count += 1;
            let store: RigChatStore;
            try {
                store = await binding.storePromise;
            } catch (error) {
                const current = chats.get(sessionId);
                if (current === binding) chats.delete(sessionId);
                throw error;
            }
            let released = false;
            return {
                store,
                [Symbol.dispose]() {
                    if (released) return;
                    released = true;
                    const current = chats.get(sessionId);
                    if (!current) return;
                    current.count -= 1;
                    if (current.count <= 0) {
                        current.count = 0;
                        // A retained background subscriber keeps durable chat
                        // synchronization alive, but usage polling belongs only
                        // to a visible view lease.
                        current.store?.usagePanelClose();
                    }
                },
            };
        },
        chatArchive(sessionId) {
            const binding = chats.get(sessionId);
            if (!binding) return;
            binding.archived = true;
            binding.backgroundUnsubscribe?.();
            binding.backgroundUnsubscribe = undefined;
        },
        terminalOpen(sessionId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            return rigTerminalOpen(
                {
                    client: deps.client,
                    hostServices: deps.hostServices,
                    ...(deps.terminalDriverCreate
                        ? { driverCreate: deps.terminalDriverCreate }
                        : {}),
                },
                sessionId,
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            models[Symbol.dispose]();
            sessionListStore?.[Symbol.dispose]();
            sessionListStore = undefined;
            inboxStore?.[Symbol.dispose]();
            inboxStore = undefined;
            providerUsageStore?.[Symbol.dispose]();
            providerUsageStore = undefined;
            profileStore?.[Symbol.dispose]();
            profileStore = undefined;
            instructionsStore?.[Symbol.dispose]();
            instructionsStore = undefined;
            securityPolicyStore?.[Symbol.dispose]();
            securityPolicyStore = undefined;
            deps.catalogSource[Symbol.dispose]();
            for (const binding of chats.values()) {
                binding.backgroundUnsubscribe?.();
                binding.store?.[Symbol.dispose]();
            }
            chats.clear();
        },
    };
}
