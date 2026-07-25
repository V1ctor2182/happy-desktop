import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    ChatPage,
    type AdminPageSection,
    type ChatPageActions,
    type ChatPageNavigation,
    type ChatPagePanel,
    type MessageListScrollPosition,
    type SidebarSection,
} from "happy2-ui";
import type { ChatContributionsSnapshot, HappyState } from "happy2-state";
import type { InspectorSnapshot, OverlaysStore } from "happy2-state";
import type { AuthSession } from "../components/AuthGate";
import { useAssetUrls } from "../assetUrls";
import {
    chatMenuContributionNodes,
    composerContributionNodes,
    messageMenuContributionNodes,
    type ContributionSurface,
} from "./PluginContributionRenderer";
import { MessageApp } from "./MessageApp";
import { openExternalLink } from "../externalLink";
import { useDisposableLease } from "../useDisposableLease";
const AGENT_MODEL_CATALOG_POLL_MS = 5_000;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => undefined;
export type ChatViewProps = {
    platform?: "desktop" | "web";
    session?: AuthSession;
    state: HappyState;
    /** The conversation addressed by the URL, absent when none is selected. */
    chatId?: string;
    conversationKind: "chat" | "channel";
    /** The transient inspector and overlay layers for this conversation. */
    overlays: OverlaysStore;
    onChatSelect: (chatId: string | undefined, kind: "chat" | "channel", replace?: boolean) => void;
    createRequest?: {
        kind: "agent" | "channel";
        nonce: number;
    };
    windowControls?: boolean;
    /** @deprecated the feature rail was removed; retained for existing callers/tests. */
    rail?: ReactNode;
    navSection?: SidebarSection;
    navActiveId?: string;
    onNavSelect?: (id: string) => void;
    sidebarFooter?: ReactNode;
    sidebarHeaderAccessory?: ReactNode;
    /** Non-conversation primary view rendered in the workspace while the sidebar stays. */
    workspaceOverride?: ReactNode;
    /** Replaces the chat sidebar with a pushed detail level (admin sub-nav). */
    sidebarOverride?: ReactNode;
    canOpenAdmin: boolean;
    adminStartSection: AdminPageSection;
};
const CHAT_SCROLL_CACHE_CAPACITY = 128;
const chatScrollCaches = new WeakMap<HappyState, Map<string, MessageListScrollPosition>>();

function chatScrollCache(state: HappyState): Map<string, MessageListScrollPosition> {
    const existing = chatScrollCaches.get(state);
    if (existing) return existing;
    const created = new Map<string, MessageListScrollPosition>();
    chatScrollCaches.set(state, created);
    return created;
}
/** Owns route-keyed HappyState leases while the reusable ChatPage remains props-only. */
export function ChatView(props: ChatViewProps) {
    const state = props.state;
    const navigate = useNavigate();
    const masks = useAssetUrls(state);
    const chatScrollPositions = chatScrollCache(state);
    const overlays = props.overlays;
    // One coarse subscription to the transient layers; the inspector selection and
    // the open overlay both feed the leases and the page props below.
    const layers = useSyncExternalStore(
        overlays.subscribe,
        overlays.getState,
        overlays.getInitialState,
    );
    const inspector = layers.inspector;
    const workspaceFileOverlay =
        layers.overlay.type === "workspaceFile" ? layers.overlay : undefined;
    const documentOverlay = layers.overlay.type === "document" ? layers.overlay : undefined;
    const workspaceFileChatId = workspaceFileOverlay?.chatId;
    const workspaceFilePath = workspaceFileOverlay?.path;
    const nextChatId = props.chatId;
    const nextConversationKind = props.chatId ? props.conversationKind : undefined;
    const nextWorkspaceChatId =
        inspector.type === "workspace" || workspaceFileOverlay ? nextChatId : undefined;
    const nextWorkspaceFileKey =
        workspaceFileChatId && workspaceFilePath
            ? `${workspaceFileChatId}\u0000${workspaceFilePath}`
            : undefined;
    const nextDocumentListChatId = inspector.type === "documents" ? nextChatId : undefined;
    const nextDocumentId = documentOverlay?.documentId;
    const chatScrollPositionUpdate = (chatId: string, position: MessageListScrollPosition) => {
        const cache = chatScrollPositions;
        cache.delete(chatId);
        cache.set(chatId, position);
        if (cache.size <= CHAT_SCROLL_CACHE_CAPACITY) return;
        const oldestChatId = cache.keys().next().value;
        if (oldestChatId) cache.delete(oldestChatId);
    };
    // Each retained handle is leased for exactly as long as the surface addresses
    // it, keyed by that address, so a selection change disposes the old lease
    // before taking the new one and unmounting releases everything.
    const conversation = useDisposableLease(
        nextChatId ? `${nextChatId}\u0000${nextConversationKind}` : undefined,
        () => conversationLease(state, overlays, nextChatId!, nextConversationKind!),
    );
    const workspace = useDisposableLease(nextWorkspaceChatId, () =>
        state.workspaceOpen(nextWorkspaceChatId!),
    );
    const workspaceFile = useDisposableLease(
        // The reload generation is part of the identity: re-reading the same path
        // is a new lease, not the existing one.
        nextWorkspaceFileKey && `${nextWorkspaceFileKey}\u0000${layers.workspaceFileGeneration}`,
        () => state.workspaceFileOpen(workspaceFileChatId!, workspaceFilePath!),
    );
    const documentList = useDisposableLease(nextDocumentListChatId, () =>
        state.documentListOpen(nextDocumentListChatId!),
    );
    const documentHandle = useDisposableLease(nextDocumentId, () =>
        state.documentOpen(nextDocumentId!),
    );
    const terminalAgentUserId =
        layers.terminal.type === "open" && nextChatId ? layers.terminal.agentUserId : undefined;
    const terminal = useDisposableLease(terminalAgentUserId, () =>
        terminalLease(state, nextChatId!, terminalAgentUserId!),
    );
    // Rig's catalog can change outside Happy Place. Load it as the desktop app
    // enters the chat surface, then refresh only while that surface is visible;
    // picker clicks consume this already-materialized catalog and never fetch.
    // eslint-disable-next-line happy2-react/no-layout-effect -- the catalog has no realtime channel, so this surface polls while visible; the interval and listener are an imperative browser integration with complete cleanup
    useLayoutEffect(() => {
        const syncModels = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            void state.agentModelsLoad();
        };
        syncModels();
        const timer = setInterval(syncModels, AGENT_MODEL_CATALOG_POLL_MS);
        const visibilityChange = () => syncModels();
        document.addEventListener("visibilitychange", visibilityChange);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", visibilityChange);
        };
    }, [state]);
    const actions: ChatPageActions = {
        adminOpen() {
            void navigate({ params: { section: props.adminStartSection }, to: "/admin/$section" });
        },
        chatSelect(nextChatId, kind, replace) {
            props.onChatSelect(nextChatId, kind, replace);
        },
        infoOpen: () => overlays.getState().inspectorInfoShow(),
        channelInfoOpen(chatId) {
            props.onChatSelect(chatId, "channel");
            overlays.getState().inspectorInfoShow();
        },
        profileOpen: (userId) => overlays.getState().inspectorProfileShow(userId),
        panelClose: () => overlays.getState().inspectorClose(),
        searchOpen: () => overlays.getState().overlaySearchOpen(),
        workspaceOpen: () => overlays.getState().inspectorWorkspaceShow(),
        workspaceClose: () => overlays.getState().inspectorClose(),
        workspaceFileOpen(nextChatId, path) {
            const current = workspaceFileOverlay;
            if (current?.chatId === nextChatId && current.path === path) return;
            overlays.getState().overlayWorkspaceFileOpen(nextChatId, path);
        },
        workspaceFileReload: () => overlays.getState().overlayWorkspaceFileReload(),
        workspaceFileClose: () => overlays.getState().overlayClose(),
        documentsOpen: () => overlays.getState().inspectorDocumentsShow(),
        documentsClose: () => overlays.getState().inspectorClose(),
        documentOpen(selectedChatId, documentId) {
            overlays.getState().overlayDocumentOpen(selectedChatId, documentId);
        },
        documentClose: () => overlays.getState().overlayClose(),
        async documentCreate(selectedChatId) {
            const document = await state.documentCreate(selectedChatId, { title: "" });
            overlays.getState().overlayDocumentOpen(selectedChatId, document.id);
        },
        documentRename: (documentId, title) => state.documentRename(documentId, title),
        documentAttach: (documentId, chatId) => state.documentAttach(documentId, chatId),
        documentDetach: (documentId, chatId) => state.documentDetach(documentId, chatId),
        documentDelete: (documentId) => state.documentDelete(documentId),
        fileUpload: (body) => state.fileUpload(body),
        fileDownload: (fileId) => state.fileDownload(fileId),
        filePreviewDownload: (fileId) => state.filePreviewDownload(fileId),
        chatReadMark: (selectedChatId, messageId) => state.chatReadMark(selectedChatId, messageId),
        typingSet: (selectedChatId, active) => state.typingSet(selectedChatId, active),
        reactionAdd: (selectedChatId, messageId, emoji) =>
            state.reactionAdd(selectedChatId, messageId, { emoji }),
        reactionRemove: (selectedChatId, messageId, emoji) =>
            state.reactionRemove(selectedChatId, messageId, { emoji }),
        messageEdit: (selectedChatId, messageId, text, revision) =>
            state.messageEdit(selectedChatId, messageId, text, revision),
        messageDelete: (selectedChatId, messageId) =>
            state.messageDelete(selectedChatId, messageId),
        chatJoin: (selectedChatId) => state.chatJoin(selectedChatId),
        chatLeave: (selectedChatId) => state.chatLeave(selectedChatId),
        chatStarSet: (selectedChatId, starred) => state.chatStarSet(selectedChatId, starred),
        channelCreate: (input) => state.channelCreate(input),
        projectCreate: (input) => state.projectCreate(input),
        channelCreateChild: (input) => state.channelCreateChild(input),
        channelArchive: (selectedChatId) => state.channelArchive(selectedChatId),
        channelUnarchive: (selectedChatId) => state.channelUnarchive(selectedChatId),
        chatModelChange: (chatId, modelId) => state.chatModelChange(chatId, modelId),
        channelUpdate: (selectedChatId, input) => state.channelUpdate(selectedChatId, input),
        channelDefaultAgentUpdate: (selectedChatId, agentUserId) =>
            state.channelDefaultAgentUpdate(selectedChatId, agentUserId),
        agentCreate: (input) => state.agentCreate(input),
        agentConversationCreate: async (agentUserId) => {
            const chat = await state.agentConversationCreate(agentUserId);
            return chat.id;
        },
        agentEffortChange: (chatId, agentUserId, effort) =>
            state.agentEffortChange(chatId, agentUserId, effort),
        directMessageCreate: (userId) => state.directMessageCreate(userId),
        messageSend: (chatId, text) => state.messageSend(chatId, { text }),
        sharedLinkOpen: (uri) => openExternalLink(uri),
        pluginRequestImageDownload: (chatId, requestId) =>
            state.pluginManagementRequestImageDownload(chatId, requestId),
        terminalOpen: (agentUserId) => overlays.getState().terminalOpen(agentUserId),
        terminalClose: () => overlays.getState().terminalClose(),
    };
    const pageNavigation = (): ChatPageNavigation => {
        const renderedChatId = conversation?.chatId;
        const file = workspaceFileOverlay;
        return {
            chatId: renderedChatId,
            panel: panelProject(inspector),
            workspaceFilePath: file?.chatId === renderedChatId ? file?.path : undefined,
            documentId:
                documentOverlay?.chatId === renderedChatId
                    ? documentOverlay?.documentId
                    : undefined,
        };
    };
    const renderPage = (contributions: {
        chatMenuContributions?: ReactNode;
        composerContributions?: ReactNode;
        messageContributions?: (messageId: string) => ReactNode;
    }) => (
        <ChatPage
            actions={actions}
            agentModels={state.agentModels()}
            canOpenAdmin={props.canOpenAdmin}
            chat={conversation?.chat}
            chatMenuContributions={contributions.chatMenuContributions}
            composer={conversation?.composer}
            composerContributions={contributions.composerContributions}
            createRequest={props.createRequest}
            directory={state.directory()}
            messageContributions={contributions.messageContributions}
            messageListScrollPosition={
                conversation ? chatScrollPositions.get(conversation.chatId) : undefined
            }
            navActiveId={props.navActiveId}
            navSection={props.navSection}
            navigation={pageNavigation()}
            onMessageListScrollPositionChange={
                conversation
                    ? (position) => chatScrollPositionUpdate(conversation.chatId, position)
                    : undefined
            }
            onNavSelect={props.onNavSelect}
            renderMcpApp={(input) => <MessageApp input={input} state={state} />}
            sidebar={state.sidebar()}
            sidebarFooter={props.sidebarFooter}
            sidebarHeaderAccessory={props.sidebarHeaderAccessory}
            sidebarOverride={props.sidebarOverride}
            workspaceOverride={props.workspaceOverride}
            terminal={terminal?.handle}
            windowControls={props.windowControls}
            user={props.session?.user ?? { id: "local-user", firstName: "Happy" }}
            workspace={workspace}
            workspaceFile={workspaceFile}
            documentList={documentList}
            document={documentHandle}
            documents={state.documentCollection()}
        />
    );
    const contributionHandle = conversation?.contributions;
    // This subscription stays inside ChatView instead of wrapping ChatPage in a
    // keyed StoreSurface. Selecting the first conversation or changing chats must
    // replace only this store subscription, not remount the sidebar, composer, or
    // workspace DOM below it.
    const contributionSnapshot: (ChatContributionsSnapshot & ContributionSurface) | undefined =
        useSyncExternalStore(
            contributionHandle?.subscribe ?? emptySubscribe,
            contributionHandle?.getState ?? emptySnapshot,
            contributionHandle?.getInitialState ?? emptySnapshot,
        );
    if (!contributionSnapshot) return renderPage({});
    const contributions =
        contributionSnapshot.contributions.type === "ready"
            ? contributionSnapshot.contributions.value
            : [];
    return renderPage({
        chatMenuContributions: chatMenuContributionNodes(
            contributions,
            contributionSnapshot,
            masks,
        ),
        composerContributions: composerContributionNodes(
            contributions,
            contributionSnapshot,
            masks,
        ),
        messageContributions: (messageId: string) =>
            messageMenuContributionNodes(contributions, contributionSnapshot, masks, messageId),
    });
}

/**
 * Projects the inspector selection into `ChatPage`'s panel contract. The store and
 * the visual component name these layers differently on purpose: the store models
 * a closed inspector explicitly, while the component treats an absent panel as
 * closed.
 */
function panelProject(inspector: InspectorSnapshot): ChatPagePanel | undefined {
    switch (inspector.type) {
        case "closed":
            return undefined;
        case "info":
            return { kind: "info" };
        case "profile":
            return { kind: "profile", userId: inspector.userId };
        case "workspace":
            return { kind: "workspace" };
        case "documents":
            return { kind: "documents" };
    }
}

/**
 * The handles one open conversation needs, leased and released together: they
 * describe the same chat and a surface never wants a subset of them.
 *
 * The retains are what make the header, approval cards, and port-share rows
 * reconcile over the sync stream for as long as the conversation is open.
 * Disposing also retires the inspector and any chat-scoped overlay, because
 * those described the conversation being left.
 */
function conversationLease(
    state: HappyState,
    overlays: OverlaysStore,
    chatId: string,
    kind: "chat" | "channel",
) {
    const chat = state.chatOpen(chatId);
    if (kind === "channel") chat.getState().membersRetain();
    // Agent plugin install/uninstall requests render as approval cards in every
    // conversation and reconcile with the chat.
    chat.getState().pluginRequestsRetain();
    // Agent document writes render as approval cards and only apply once a
    // member approves them here.
    chat.getState().documentWriteRequestsRetain();
    // Active port shares appear in the header and info panel of every
    // conversation and reconcile with the chat over the sync stream.
    chat.getState().portSharesRetain();
    return {
        chatId,
        chat,
        // Channels expose the same agent-first routing control as direct
        // conversations; people remains an explicit choice.
        composer: state.composer(chatId, kind === "channel" ? { audience: "agents" } : {}),
        // One retained chat-contribution surface fans out to the header,
        // composer, and every message row.
        contributions: state.chatContributionsOpen(chatId),
        [Symbol.dispose]() {
            this.contributions[Symbol.dispose]();
            chat[Symbol.dispose]();
            state.composerRelease(chatId);
            overlays.getState().chatContextUpdate(undefined);
        },
    };
}

/**
 * One agent terminal. Closing it tells the daemon before releasing the handle,
 * so the remote session ends rather than being abandoned.
 */
function terminalLease(state: HappyState, chatId: string, agentUserId: string) {
    const handle = state.terminalOpen(chatId, agentUserId);
    return {
        handle,
        [Symbol.dispose]() {
            handle.getState().terminalClose();
            handle[Symbol.dispose]();
        },
    };
}
