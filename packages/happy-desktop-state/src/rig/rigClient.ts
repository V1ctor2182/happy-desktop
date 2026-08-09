import type { TerminalDriverCreate } from "../modules/terminal/terminalState.js";
import { UserError } from "../types.js";
import { rigProjectAddError } from "./rigProjectRegistration.js";
import type { MutationRejectedDelta, RigConnection } from "@slopus/rig-connect";
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
import type { RigTransport } from "./rigTransport.js";
import { rigSlotsStoreCreate, type RigSlotsStore } from "./rigSlotsStore.js";
import { rigSecretsStoreCreate, type RigSecretsStore } from "./rigSecretsStore.js";
import type {
    RigChangedFileDocument,
    RigFileSearchResult,
    RigDocumentId,
    RigGroupId,
    RigOpenInTargets,
    RigWorkspaceFileBytes,
    RigWorkspaceFileDocument,
    RigWorkspaceFiles,
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
import { rigNodesStoreCreate, type RigNodesSource, type RigNodesStore } from "./rigNodesStore.js";
import {
    rigFoldersStoreCreate,
    type RigFoldersSource,
    type RigFoldersStore,
} from "./rigFoldersStore.js";
import { rigDocumentsStoreCreate, type RigDocumentsStore } from "./rigDocumentsStore.js";
import {
    rigDocumentStoreCreate,
    type RigDocumentActions,
    type RigDocumentSource,
    type RigDocumentStore,
} from "./rigDocumentStore.js";
import {
    rigPairingStoreCreate,
    type RigPairingSource,
    type RigPairingStore,
} from "./rigPairingStore.js";
import {
    rigProfilesStoreCreate,
    type RigProfilesActions,
    type RigProfileSelectionPersistence,
    type RigProfilesSource,
    type RigProfilesStore,
} from "./rigProfilesStore.js";

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
    /**
     * The single nodes store for this Rig: the machines this host is peered with
     * and how each link is doing. Materialized on first access and shared, so the
     * settings list and the sidebar read one stream rather than two. Unavailable
     * when the host supplied no P2P feed, so a surface can say the host does not
     * peer rather than showing a list that is empty for the wrong reason.
     */
    nodes(): RigNodesStore | undefined;
    /**
     * The single folders store for this Rig: the virtual tree its chats are
     * filed into. Materialized on first access and shared, because the tree
     * belongs to the machine rather than to any project or conversation.
     * Unavailable when the host supplied no folder feed, so a surface can say
     * this Rig has no folders rather than showing a tree that is empty for the
     * wrong reason.
     */
    folders(): RigFoldersStore | undefined;
    /**
     * What each document linked into this Rig's folders is called. Materialized
     * on first access and shared: a document carries no name on the Rig, so its
     * title is read from its content, and one store does that for every row
     * rather than each row opening a feed of its own.
     */
    documents(): RigDocumentsStore | undefined;
    /**
     * One open document, with a lifetime of its own rather than the client's.
     * The caller disposes it: which document is open is decided by the address,
     * and the collaborative document behind it must outlive any render.
     */
    documentOpen(documentId: RigDocumentId): RigDocumentStore | undefined;
    /** Creates one empty document on this Rig and returns its stable address. */
    documentCreate(): RigDocumentId | undefined;
    /** Host-owned human identities used to author work sent into remote Rigs. */
    profiles(): RigProfilesStore | undefined;
    /**
     * The single pairing store for this Rig: trusting a new machine by
     * comparing four emojis on both ends. Materialized on first access and
     * shared. Unavailable on a connection that does not own trust — a node is
     * reached because the host already trusts it, and this window does not
     * negotiate trust on another machine's behalf.
     */
    pairing(): RigPairingStore | undefined;
    /**
     * This Rig's own machine-wide instructions, as one editable document.
     * Materialized on first access and shared, so the settings window and
     * anything else showing them are looking at the same draft.
     */
    instructions(): RigInstructionsStore;
    /** This Rig's machine-wide permission-review policy, as one editable document. */
    securityPolicy(): RigSecurityPolicyStore;
    /**
     * This Rig's secret bundles: what it holds, and the one place they are
     * registered, replaced, and removed. Materialized on first access and
     * shared, because the registry belongs to the machine rather than to any
     * project or conversation.
     */
    secrets(): RigSecretsStore;
    /** Lists every file in a project or worktree checkout, changed or not. */
    workspaceFilesRead(groupId: RigGroupId): Promise<RigWorkspaceFiles>;
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
    /**
     * The slots/applets surface: one instance for the client's lifetime, because
     * both catalogs are Rig-global. What the window has open never replaces it.
     */
    slots(): RigSlotsStore;
    /** Resolves the current applet version into the host's isolated preview site. */
    appletPreviewOpen(name: string): Promise<string>;
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
     * Throws away the working-tree changes of the named files in one checkout.
     * The listing is not updated from here: the daemon's Git watch reports the
     * new state, which is the same path every other change to the checkout takes.
     */
    changedFilesRevert(groupId: RigGroupId, paths: readonly string[]): Promise<void>;
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
    readonly transport: RigTransport;
    /** Stream-owned read authority for the project/workspace/session catalog. */
    readonly catalogSource?: RigSessionCatalogSource;
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
    /**
     * Stream-owned feed of the host's P2P status: which machines it is peered
     * with, and how each link is doing. Omitted leaves nodes unavailable rather
     * than empty.
     */
    readonly nodesSource?: RigNodesSource;
    /**
     * Stream-owned feed of this Rig's folder tree. Omitted leaves folders
     * unavailable rather than empty.
     */
    readonly foldersSource?: RigFoldersSource;
    /**
     * Opens the host's feed for one document. Omitted leaves documents
     * unavailable rather than empty, which is what a Rig too old to serve them
     * should look like.
     */
    readonly documentSourceCreate?: (documentId: RigDocumentId) => RigDocumentSource;
    /** One compare-version-and-write per document. Omitted leaves them read-only. */
    readonly documentActions?: RigDocumentActions;
    /**
     * The host's own pairing service. Omitted on a connection that does not
     * own trust, which leaves pairing unavailable rather than idle.
     */
    readonly pairingSource?: RigPairingSource;
    /** Host-only profile catalog and mutations. Omitted on a node connection. */
    readonly profilesSource?: RigProfilesSource;
    readonly profilesActions?: RigProfilesActions;
    readonly profileSelectionPersistence?: RigProfileSelectionPersistence;
    /** Selected host identity required by work sent through a node route. */
    readonly peerIdentity?: () => string | undefined;
    /** Opens rig-connect's core transcript stream for one materialized chat. */
    readonly transcriptConnect?: RigChatTranscriptConnect;
    /** Shared rig-connect actions for session mutations. */
    readonly connectActions?: RigConnection;
    readonly connectMutationSubscribe?: (
        listener: (rejection: MutationRejectedDelta) => void,
    ) => () => void;
    readonly createId?: () => string;
    readonly now?: () => number;
    readonly sessionListOutput?: (event: RigSessionListOutput) => void;
    readonly chatOutput?: (sessionId: RigSessionId, event: RigChatOutput) => void;
    readonly backgroundError?: (error: UserError) => void;
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

/**
 * Composition root for a direct Rig client: it owns the injected transport, the
 * daemon-global model store, session list, and retained per-session chat stores.
 * Once opened, a non-archived chat stays synchronized for this client's lifetime;
 * archiving suspends its transport but leaves messages and model state in memory.
 */
export function rigClientCreate(deps: RigClientDeps): RigClient {
    const transport = deps.transport;
    const models = rigModelStoreCreate({
        catalogRead: () => transport.modelsRead(),
        ...(deps.modelPreferencePersistence
            ? { preferencePersistence: deps.modelPreferencePersistence }
            : {}),
    });
    const memory = rigWorkspaceMemoryStoreCreate(deps.workspaceMemoryPersistence);
    let sessionListStore: RigSessionListStore | undefined;
    let inboxStore: RigInboxStore | undefined;
    let providerUsageStore: RigProviderUsageStore | undefined;
    let nodesStore: RigNodesStore | undefined;
    let foldersStore: RigFoldersStore | undefined;
    let documentsStore: RigDocumentsStore | undefined;
    let pairingStore: RigPairingStore | undefined;
    let profilesStore: RigProfilesStore | undefined;
    let instructionsStore: RigInstructionsStore | undefined;
    let securityPolicyStore: RigSecurityPolicyStore | undefined;
    let secretsStore: RigSecretsStore | undefined;
    let slotsStore: RigSlotsStore | undefined;
    const chats = new Map<RigSessionId, ChatBinding>();
    let disposed = false;

    return {
        models,
        memory,
        catalogRead: () => models.load().then((snapshot) => snapshot.catalog),
        changedFileRead: (groupId, path, signal) =>
            transport.changedFileRead(groupId, path, signal),
        changedFilesRevert: (groupId, paths) => transport.changedFilesRevert(groupId, paths),
        workspaceFilesRead: (groupId) => transport.workspaceFilesRead(groupId),
        filesSearch: (groupId, query, limit) => transport.filesSearch(groupId, query, limit),
        workspaceFileRead: (groupId, path, signal) =>
            transport.workspaceFileRead(groupId, path, signal),
        workspaceFileBytesRead: (groupId, path, signal) =>
            transport.workspaceFileBytesRead(groupId, path, signal),
        htmlPreviewOpen: (groupId, path) => transport.htmlPreviewOpen(groupId, path),
        slots() {
            if (disposed) throw new Error("The Rig client is disposed.");
            slotsStore ??= rigSlotsStoreCreate({ transport });
            return slotsStore;
        },
        appletPreviewOpen: (name) => transport.appletPreviewOpen(name),
        workspaceFileWrite: (groupId, path, content, expectedHash) =>
            transport.workspaceFileWrite(groupId, path, content, expectedHash),
        attachmentWrite: (groupId, name, content) =>
            transport.attachmentWrite(groupId, name, content),
        async projectAdd(path) {
            // Registration is Rig's own decision, so it goes to Rig directly
            // rather than through the projected transport: the daemon validates
            // the folder, names the project, and is idempotent by canonical
            // path. A connection that carries no rig-connect actions cannot ask,
            // and says so rather than pretending the folder was added.
            const actions = deps.connectActions;
            if (!actions) throw new UserError("This Rig cannot add projects.");
            try {
                const project = await actions.projects.add(path);
                return project.id as RigProjectId;
            } catch (error) {
                throw rigProjectAddError(error, path);
            }
        },
        openInTargetsRead: () => transport.openInTargetsRead(),
        openIn: (groupId, targetId) => transport.openIn(groupId, targetId),
        sessionList() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!sessionListStore) {
                sessionListStore = rigSessionListStoreCreate({
                    transport,
                    catalogSource: deps.catalogSource,
                    ...(deps.connectActions ? { connectActions: deps.connectActions } : {}),
                    ...(deps.connectMutationSubscribe
                        ? { connectMutationSubscribe: deps.connectMutationSubscribe }
                        : {}),
                    ...(deps.peerIdentity ? { peerIdentity: deps.peerIdentity } : {}),
                    output: deps.sessionListOutput,
                    createId: deps.createId,
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
                    if (deps.connectActions) {
                        deps.connectActions.answerUserInput(event.sessionId, event.requestId, {
                            answers: event.answers,
                        });
                        store.inboxInput({ type: "itemAnswerSucceeded", itemId: event.itemId });
                        return;
                    }
                    transport
                        .answerUserInput(event.sessionId, {
                            requestId: event.requestId,
                            answers: event.answers,
                        })
                        .then(() => {
                            store.inboxInput({
                                type: "itemAnswerSucceeded",
                                itemId: event.itemId,
                            });
                        })
                        .catch((error: unknown) => {
                            store.inboxInput({
                                type: "itemAnswerFailed",
                                itemId: event.itemId,
                                error,
                            });
                        });
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
        nodes() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const source = deps.nodesSource;
            if (!source) return undefined;
            nodesStore ??= rigNodesStoreCreate({ source });
            return nodesStore;
        },
        folders() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const source = deps.foldersSource;
            const actions = deps.connectActions;
            // Both halves or neither: a tree that can be read but not changed
            // would offer controls that go nowhere, and a tree that can be
            // changed but not read would never show what happened.
            if (!source || !actions) return undefined;
            foldersStore ??= rigFoldersStoreCreate({
                source,
                ...(deps.connectMutationSubscribe
                    ? { mutationSubscribe: deps.connectMutationSubscribe }
                    : {}),
                actions: {
                    folderCreate: (input) =>
                        actions.folders.create({
                            name: input.name,
                            ...(input.icon === undefined ? {} : { icon: input.icon }),
                            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
                        }),
                    folderUpdate: (folderId, changes) => actions.folders.update(folderId, changes),
                    folderMove: (folderId, parentId, afterId) =>
                        actions.folders.move(folderId, { afterId, parentId }),
                    folderArchive: (folderId) => actions.folders.archive(folderId),
                    folderSessionSet: (sessionId, folderId) =>
                        actions.folders.setSessionFolder(sessionId, folderId),
                    folderItemLink: (folderId, target) =>
                        actions.folders.linkItem(folderId, { target }),
                    folderItemMove: (itemId, folderId, afterId) =>
                        actions.folders.moveItem(itemId, { afterId, folderId }),
                    folderItemUnlink: (itemId) => actions.folders.unlinkItem(itemId),
                },
            });
            return foldersStore;
        },
        documents() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const sourceCreate = deps.documentSourceCreate;
            // Titles are read from the documents the tree links, so both the
            // tree and a way to read one are needed before anything can be named.
            if (!sourceCreate) return undefined;
            const folders = this.folders();
            if (!folders) return undefined;
            documentsStore ??= rigDocumentsStoreCreate({ folders, sourceCreate });
            return documentsStore;
        },
        documentOpen(documentId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            const sourceCreate = deps.documentSourceCreate;
            const actions = deps.documentActions;
            // Both halves or neither: a document that could be read but not
            // written would offer an editor that silently discards every edit.
            if (!sourceCreate || !actions) return undefined;
            return rigDocumentStoreCreate(documentId, {
                actions,
                source: sourceCreate(documentId),
            });
        },
        documentCreate() {
            if (disposed) throw new Error("The Rig client is disposed.");
            return deps.documentActions?.documentCreate();
        },
        profiles() {
            if (disposed) throw new Error("The Rig client is disposed.");
            if (!deps.profilesSource || !deps.profilesActions) return undefined;
            profilesStore ??= rigProfilesStoreCreate({
                source: deps.profilesSource,
                actions: deps.profilesActions,
                ...(deps.profileSelectionPersistence
                    ? { selectionPersistence: deps.profileSelectionPersistence }
                    : {}),
            });
            return profilesStore;
        },
        pairing() {
            if (disposed) throw new Error("The Rig client is disposed.");
            const source = deps.pairingSource;
            if (!source) return undefined;
            pairingStore ??= rigPairingStoreCreate({ source });
            return pairingStore;
        },
        instructions() {
            if (disposed) throw new Error("The Rig client is disposed.");
            instructionsStore ??= rigInstructionsStoreCreate({ transport });
            return instructionsStore;
        },
        securityPolicy() {
            if (disposed) throw new Error("The Rig client is disposed.");
            securityPolicyStore ??= rigSecurityPolicyStoreCreate({ transport });
            return securityPolicyStore;
        },
        secrets() {
            if (disposed) throw new Error("The Rig client is disposed.");
            secretsStore ??= rigSecretsStoreCreate({ transport });
            return secretsStore;
        },
        async chat(sessionId) {
            if (disposed) throw new Error("The Rig client is disposed.");
            let binding = chats.get(sessionId);
            if (!binding) {
                const storePromise = models.load().then(({ catalog }) => {
                    const chatDeps: RigChatDeps = {
                        transport,
                        catalog,
                        ...(deps.transcriptConnect
                            ? { transcriptConnect: deps.transcriptConnect }
                            : {}),
                        ...(deps.connectActions ? { connectActions: deps.connectActions } : {}),
                        ...(deps.peerIdentity ? { messageIdentity: deps.peerIdentity } : {}),
                        ...(deps.connectMutationSubscribe
                            ? { connectMutationSubscribe: deps.connectMutationSubscribe }
                            : {}),
                        selectionUsed: (selection) => models.selectionUsed(selection),
                        modelSelect: (current, input) => models.modelSelect(current, input),
                        createId: deps.createId,
                        now: deps.now,
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
                    transport,
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
            nodesStore?.[Symbol.dispose]();
            nodesStore = undefined;
            foldersStore?.[Symbol.dispose]();
            foldersStore = undefined;
            documentsStore?.[Symbol.dispose]();
            documentsStore = undefined;
            pairingStore?.[Symbol.dispose]();
            pairingStore = undefined;
            profilesStore?.[Symbol.dispose]();
            profilesStore = undefined;
            instructionsStore?.[Symbol.dispose]();
            slotsStore?.[Symbol.dispose]();
            slotsStore = undefined;
            instructionsStore = undefined;
            securityPolicyStore?.[Symbol.dispose]();
            securityPolicyStore = undefined;
            secretsStore?.[Symbol.dispose]();
            secretsStore = undefined;
            deps.catalogSource?.[Symbol.dispose]();
            for (const binding of chats.values()) {
                binding.backgroundUnsubscribe?.();
                binding.store?.[Symbol.dispose]();
            }
            chats.clear();
        },
    };
}
