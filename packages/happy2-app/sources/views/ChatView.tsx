import { useLayoutEffect, useReducer, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    ChatPage,
    StoreSurface,
    type AdminPageSection,
    type ChatPageActions,
    type ChatPageNavigation,
    type ChatPagePanel,
    type MessageListScrollPosition,
    type SidebarSection,
} from "happy2-ui";
import type {
    AgentTraceHandle,
    ChatContributionsHandle,
    ChatContributionsSnapshot,
    ChatHandle,
    ComposerStore,
    DocumentHandle,
    DocumentListHandle,
    HappyState,
    TerminalHandle,
    WorkspaceFileHandle,
    WorkspaceHandle,
} from "happy2-state";
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
const AGENT_MODEL_CATALOG_POLL_MS = 5_000;
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
type ChatResources = {
    chat?: ChatHandle;
    composer?: ComposerStore;
    chatContributions?: ChatContributionsHandle;
    trace?: AgentTraceHandle;
    workspace?: WorkspaceHandle;
    workspaceFile?: WorkspaceFileHandle;
    terminal?: TerminalHandle;
    documentList?: DocumentListHandle;
    document?: DocumentHandle;
    chatId?: string;
    conversationKind?: "chat" | "channel";
    traceMessageId?: string;
    workspaceChatId?: string;
    workspaceFileKey?: string;
    documentListChatId?: string;
    documentId?: string;
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
    const [resources, resourcesReplace] = useReducer(
        (_current: ChatResources, next: ChatResources) => next,
        {},
    );
    const resourcesRef = useRef<ChatResources>({});
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
    const nextChatId = props.chatId;
    const nextConversationKind = props.chatId ? props.conversationKind : undefined;
    const nextTraceMessageId = inspector.type === "trace" ? inspector.messageId : undefined;
    const nextWorkspaceChatId =
        inspector.type === "workspace" || workspaceFileOverlay ? nextChatId : undefined;
    const nextWorkspaceFileKey =
        workspaceFileOverlay?.chatId && workspaceFileOverlay.path
            ? `${workspaceFileOverlay.chatId}\u0000${workspaceFileOverlay.path}`
            : undefined;
    const nextDocumentListChatId = inspector.type === "documents" ? nextChatId : undefined;
    const nextDocumentId = documentOverlay?.documentId;
    const resourcesCommit = (next: ChatResources) => {
        resourcesRef.current = next;
        resourcesReplace(next);
    };
    const chatScrollPositionUpdate = (chatId: string, position: MessageListScrollPosition) => {
        const cache = chatScrollPositions;
        cache.delete(chatId);
        cache.set(chatId, position);
        if (cache.size <= CHAT_SCROLL_CACHE_CAPACITY) return;
        const oldestChatId = cache.keys().next().value;
        if (oldestChatId) cache.delete(oldestChatId);
    };
    useLayoutEffect(() => {
        let next = resourcesRef.current;
        let changed = false;
        const replace = (patch: Partial<ChatResources>) => {
            next = { ...next, ...patch };
            changed = true;
        };
        if (next.chatId !== nextChatId || next.conversationKind !== nextConversationKind) {
            // The inspector and any chat-scoped overlay described the conversation
            // being left, so they retire with it rather than describing the new one.
            overlays.getState().chatContextUpdate(nextChatId);
            next.trace?.[Symbol.dispose]();
            next.workspaceFile?.[Symbol.dispose]();
            next.workspace?.[Symbol.dispose]();
            next.terminal?.[Symbol.dispose]();
            next.chatContributions?.[Symbol.dispose]();
            next.chat?.[Symbol.dispose]();
            if (next.chatId) state.composerRelease(next.chatId);
            if (!nextChatId) next = {};
            else {
                const chat = state.chatOpen(nextChatId);
                if (nextConversationKind === "channel") chat.getState().membersRetain();
                // Agent plugin install/uninstall requests render as approval
                // cards in every conversation and reconcile with the chat.
                chat.getState().pluginRequestsRetain();
                // Agent document writes render as approval cards and only apply
                // once a member approves them here.
                chat.getState().documentWriteRequestsRetain();
                // Active port shares appear in the header and info panel of every
                // conversation and reconcile with the chat over the sync stream.
                chat.getState().portSharesRetain();
                next = {
                    chatId: nextChatId,
                    conversationKind: nextConversationKind,
                    chat,
                    // Channels expose the same agent-first routing control as
                    // direct conversations; people remains an explicit choice.
                    composer: state.composer(
                        nextChatId,
                        nextConversationKind === "channel" ? { audience: "agents" } : {},
                    ),
                    // One retained chat-contribution surface fans out to the
                    // header, composer, and every message row.
                    chatContributions: state.chatContributionsOpen(nextChatId),
                };
            }
            changed = true;
        }
        if (next.traceMessageId !== nextTraceMessageId) {
            next.trace?.[Symbol.dispose]();
            replace({
                traceMessageId: nextTraceMessageId,
                trace: nextTraceMessageId ? state.agentTraceOpen(nextTraceMessageId) : undefined,
            });
        }
        if (next.workspaceChatId !== nextWorkspaceChatId) {
            next.workspaceFile?.[Symbol.dispose]();
            next.workspace?.[Symbol.dispose]();
            replace({
                workspaceChatId: nextWorkspaceChatId,
                workspace: nextWorkspaceChatId
                    ? state.workspaceOpen(nextWorkspaceChatId)
                    : undefined,
                workspaceFileKey: undefined,
                workspaceFile: undefined,
            });
        }
        if (next.workspaceFileKey !== nextWorkspaceFileKey) {
            next.workspaceFile?.[Symbol.dispose]();
            replace({
                workspaceFileKey: nextWorkspaceFileKey,
                workspaceFile:
                    workspaceFileOverlay && nextWorkspaceFileKey
                        ? state.workspaceFileOpen(
                              workspaceFileOverlay.chatId,
                              workspaceFileOverlay.path,
                          )
                        : undefined,
            });
        }
        if (next.documentListChatId !== nextDocumentListChatId) {
            next.documentList?.[Symbol.dispose]();
            replace({
                documentListChatId: nextDocumentListChatId,
                documentList: nextDocumentListChatId
                    ? state.documentListOpen(nextDocumentListChatId)
                    : undefined,
            });
        }
        if (next.documentId !== nextDocumentId) {
            next.document?.[Symbol.dispose]();
            replace({
                documentId: nextDocumentId,
                document: nextDocumentId ? state.documentOpen(nextDocumentId) : undefined,
            });
        }
        if (changed) resourcesCommit(next);
    }, [
        overlays,
        state,
        nextChatId,
        nextConversationKind,
        nextTraceMessageId,
        nextWorkspaceChatId,
        nextWorkspaceFileKey,
        workspaceFileOverlay,
        nextDocumentListChatId,
        nextDocumentId,
    ]);
    useLayoutEffect(
        () => () => {
            const current = resourcesRef.current;
            current.trace?.[Symbol.dispose]();
            current.workspaceFile?.[Symbol.dispose]();
            current.workspace?.[Symbol.dispose]();
            current.terminal?.[Symbol.dispose]();
            current.documentList?.[Symbol.dispose]();
            current.document?.[Symbol.dispose]();
            current.chatContributions?.[Symbol.dispose]();
            current.chat?.[Symbol.dispose]();
            if (current.chatId) state.composerRelease(current.chatId);
            resourcesRef.current = {};
        },
        [state],
    );
    // Rig's catalog can change outside Happy Place. Load it as the desktop app
    // enters the chat surface, then refresh only while that surface is visible;
    // picker clicks consume this already-materialized catalog and never fetch.
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
        profileOpen: (userId) => overlays.getState().inspectorProfileShow(userId),
        panelClose: () => overlays.getState().inspectorClose(),
        traceOpen: (messageId) => overlays.getState().inspectorTraceShow(messageId),
        traceClose: () => overlays.getState().inspectorClose(),
        workspaceOpen: () => overlays.getState().inspectorWorkspaceShow(),
        workspaceClose: () => overlays.getState().inspectorClose(),
        workspaceFileOpen(nextChatId, path) {
            const current = workspaceFileOverlay;
            if (current?.chatId === nextChatId && current.path === path) return;
            overlays.getState().overlayWorkspaceFileOpen(nextChatId, path);
        },
        workspaceFileReload(nextChatId, path) {
            const current = resourcesRef.current;
            current.workspaceFile?.[Symbol.dispose]();
            resourcesCommit({
                ...current,
                workspaceFileKey: `${nextChatId}\u0000${path}`,
                workspaceFile: state.workspaceFileOpen(nextChatId, path),
            });
        },
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
        terminalOpen(agentUserId) {
            const current = resourcesRef.current;
            if (!current.chatId) return;
            current.terminal?.[Symbol.dispose]();
            resourcesCommit({
                ...current,
                terminal: state.terminalOpen(current.chatId, agentUserId),
            });
        },
        terminalClose() {
            const current = resourcesRef.current;
            current.terminal?.getState().terminalClose();
            current.terminal?.[Symbol.dispose]();
            resourcesCommit({ ...current, terminal: undefined });
        },
    };
    const pageNavigation = (): ChatPageNavigation => {
        const renderedChatId = resources.chatId;
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
            chat={resources.chat}
            chatMenuContributions={contributions.chatMenuContributions}
            composer={resources.composer}
            composerContributions={contributions.composerContributions}
            createRequest={props.createRequest}
            directory={state.directory()}
            messageContributions={contributions.messageContributions}
            messageListScrollPosition={
                resources.chatId ? chatScrollPositions.get(resources.chatId) : undefined
            }
            navActiveId={props.navActiveId}
            navSection={props.navSection}
            navigation={pageNavigation()}
            onMessageListScrollPositionChange={
                resources.chatId
                    ? (position) => chatScrollPositionUpdate(resources.chatId!, position)
                    : undefined
            }
            onNavSelect={props.onNavSelect}
            renderMcpApp={(input) => <MessageApp input={input} state={state} />}
            sidebar={state.sidebar()}
            sidebarFooter={props.sidebarFooter}
            sidebarHeaderAccessory={props.sidebarHeaderAccessory}
            sidebarOverride={props.sidebarOverride}
            workspaceOverride={props.workspaceOverride}
            trace={resources.trace}
            terminal={resources.terminal}
            windowControls={props.windowControls}
            user={props.session?.user ?? { id: "local-user", firstName: "Happy" }}
            workspace={resources.workspace}
            workspaceFile={resources.workspaceFile}
            documentList={resources.documentList}
            document={resources.document}
            documents={state.documentCollection()}
        />
    );
    const contributionHandle = resources.chatContributions;
    if (!contributionHandle) return renderPage({});
    // One coarse subscription for the active chat's contributions; the header,
    // composer, and every message row are fanned out from this single snapshot.
    return (
        <StoreSurface store={contributionHandle}>
            {(snapshot: ChatContributionsSnapshot & ContributionSurface) => {
                const contributions =
                    snapshot.contributions.type === "ready" ? snapshot.contributions.value : [];
                return renderPage({
                    chatMenuContributions: chatMenuContributionNodes(
                        contributions,
                        snapshot,
                        masks,
                    ),
                    composerContributions: composerContributionNodes(
                        contributions,
                        snapshot,
                        masks,
                    ),
                    messageContributions: (messageId: string) =>
                        messageMenuContributionNodes(contributions, snapshot, masks, messageId),
                });
            }}
        </StoreSurface>
    );
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
        case "trace":
            return { kind: "trace", messageId: inspector.messageId };
        case "workspace":
            return { kind: "workspace" };
        case "documents":
            return { kind: "documents" };
    }
}
