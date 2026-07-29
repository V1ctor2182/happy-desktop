import { useLayoutEffect, useState } from "react";
import type { AgentTurnTraceSummary, ChatSummary, ConversationMessageEntry } from "happy2-state";
import {
    chatStoreFixtureCreate,
    composerStoreFixtureCreate,
    directoryStoreFixtureCreate,
    sidebarStoreFixtureCreate,
} from "happy2-state/testing";
import { Avatar } from "../../src/Avatar";
import { Button } from "../../src/Button";
import {
    ChatPage,
    type ChatPageActions,
    type ChatPageNavigation,
} from "../../src/pages/chat/ChatPage";
import { ComponentPage, FullScreenSpecimen } from "../kit";
const chat: ChatSummary = {
    id: "chat-blueprint",
    kind: "public_channel",
    projectId: "project-blueprint",
    name: "State architecture",
    slug: "state-architecture",
    topic: "One coarse store per rendered surface",
    isListed: true,
    isMain: false,
    autoJoin: false,
    defaultAgentUserId: "happy-blueprint",
    retentionMode: "inherit",
    defaultExpiryMode: "none",
    defaultAfterReadScope: "all_readers",
    lifecycleVersion: "1",
    createdByUserId: "user-blueprint",
    pts: "0",
    lastMessageSequence: "0",
    membershipEpoch: "1",
    membershipRole: "owner",
    starred: true,
    lastReadSequence: "0",
    unreadCount: 0,
    mentionCount: 0,
    notificationLevel: "all",
    isDefaultAgentConversation: false,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
};
const passiveActions: ChatPageActions = {
    adminOpen: () => undefined,
    chatSelect: () => undefined,
    infoOpen: () => undefined,
    channelInfoOpen: () => undefined,
    profileOpen: () => undefined,
    panelClose: () => undefined,
    searchOpen: () => undefined,
    workspaceOpen: () => undefined,
    workspaceClose: () => undefined,
    workspaceFileOpen: () => undefined,
    workspaceFileReload: () => undefined,
    workspaceFileClose: () => undefined,
    documentsOpen: () => undefined,
    documentsClose: () => undefined,
    documentOpen: () => undefined,
    documentClose: () => undefined,
    documentCreate: async () => undefined,
    documentRename: async () => undefined,
    documentAttach: async () => undefined,
    documentDetach: async () => undefined,
    documentDelete: async () => undefined,
    fileUpload: async () => ({
        id: "file-blueprint",
        kind: "file",
        isPublic: false,
        contentType: "text/plain",
        size: 1,
    }),
    fileDownload: async () => new ArrayBuffer(0),
    filePreviewDownload: async () => new ArrayBuffer(0),
    chatReadMark: async () => undefined,
    typingSet: () => undefined,
    reactionAdd: async () => undefined,
    reactionRemove: async () => undefined,
    chatJoin: async () => undefined,
    chatLeave: async () => undefined,
    chatStarSet: async () => undefined,
    chatReorder: async () => undefined,
    channelCreate: async () => undefined,
    projectCreate: async () => undefined,
    channelCreateChild: async () => undefined,
    channelArchive: async () => undefined,
    channelUnarchive: async () => undefined,
    chatModelChange: async () => undefined,
    channelUpdate: async () => undefined,
    channelDefaultAgentUpdate: async () => undefined,
    agentCreate: async () => undefined,
    agentConversationCreate: async () => "chat-1",
    agentEffortChange: async () => undefined,
    agentRunStop: async () => undefined,
    directMessageCreate: async () => undefined,
    messageSend: () => undefined,
    sharedLinkOpen: () => undefined,
};
const REPLY_FIRST =
    "I'll create a dedicated subchannel for making document removal archive-only, with restore and visibility semantics defined at the backend first.";
const REPLY_LAST =
    "Created **Archive documents** and kicked off archive-only document removal, including restore behavior.";
const turnTrace: AgentTurnTraceSummary = {
    turnId: "message-blueprint-1",
    agentUserId: "happy-blueprint",
    status: "complete",
    startedAt: "2026-07-17T12:00:01.000Z",
    completedAt: "2026-07-17T12:00:09.000Z",
    latest: { kind: "status", title: "Turn completed", occurredAt: 6 },
    entryCount: 7,
    toolCallCount: 1,
    totalTokens: 4_200,
    subagents: [],
    backgroundTerminals: [],
};
function chatMessage(
    id: string,
    text: string,
    agent?: AgentTurnTraceSummary,
): ConversationMessageEntry {
    return {
        kind: "message",
        source: "server",
        delivery: "sent",
        message: {
            id,
            chatId: chat.id,
            sequence: id,
            changePts: "1",
            kind: agent ? "automated" : "user",
            automated: false,
            audience: agent ? "people" : "agents",
            agentUserIds: agent ? [] : ["happy-blueprint"],
            text,
            revision: 1,
            mentions: [],
            attachments: [],
            reactions: [],
            receipts: [],
            expiryMode: "none",
            createdAt: "2026-07-17T12:00:00.000Z",
            ...(agent ? { agentTrace: agent, generationStatus: "complete" as const } : {}),
        },
    };
}
export function ChatStorePage() {
    const [{ sidebar, directory, chatSurface, composer }] = useState(() => {
        const sidebar = sidebarStoreFixtureCreate();
        const directory = directoryStoreFixtureCreate();
        const chatSurface = chatStoreFixtureCreate(chat.id);
        const composer = composerStoreFixtureCreate(chat.id, { audience: "agents" });
        directory.input({
            type: "directoryLoaded",
            users: [
                {
                    id: "user-blueprint",
                    displayName: "Ada Lovelace",
                    username: "ada",
                    kind: "human",
                    role: "admin",
                    presence: "online",
                    availability: "online",
                    customStatusText: "Designing state surfaces",
                },
                {
                    id: "happy-blueprint",
                    displayName: "Happy",
                    username: "happy",
                    kind: "agent",
                    role: "member",
                    presence: "online",
                },
            ],
            channels: [],
        });
        sidebar.input({
            type: "sidebarLoaded",
            projects: [
                {
                    id: "project-blueprint",
                    name: "Core product",
                    isDefault: true,
                    syncSequence: "1",
                    createdAt: "2026-07-17T12:00:00.000Z",
                    updatedAt: "2026-07-17T12:00:00.000Z",
                },
            ],
            chats: [
                {
                    chat,
                    id: chat.id,
                    displayName: chat.name ?? "State architecture",
                    participants: [],
                },
            ],
            sync: { protocolVersion: 1, generation: "blueprint", sequence: "0" },
        });
        // One finished turn, so the blueprint shows both states: the reply with
        // its "View traces" control, and the turn expanded back into what the
        // agent wrote, did, and answered.
        chatSurface.input({
            type: "chatLoaded",
            chat,
            messages: [
                chatMessage("message-blueprint-1", "Move turn traces into the transcript"),
                chatMessage("message-blueprint-2", `${REPLY_FIRST}\n\n${REPLY_LAST}`, turnTrace),
            ],
            hasMoreMessages: false,
        });
        chatSurface.input({
            type: "traceLoaded",
            messageId: "message-blueprint-2",
            trace: {
                ...turnTrace,
                entries: [
                    {
                        id: "step-0",
                        kind: "status",
                        title: "Starting turn",
                        status: "complete",
                        occurredAt: 0,
                    },
                    {
                        id: "step-1",
                        kind: "reasoning",
                        title: "Reasoning",
                        detail: "**Planning the transcript** \nThe chat surface already owns the messages, so it can own the steps",
                        status: "complete",
                        occurredAt: 1,
                    },
                    {
                        id: "step-2",
                        kind: "response",
                        title: "Response completed",
                        detail: REPLY_FIRST,
                        status: "complete",
                        occurredAt: 2,
                    },
                    {
                        id: "step-3",
                        kind: "tool",
                        title: "Channel child create",
                        detail: "packages/happy2-server/sources/modules/chat",
                        status: "complete",
                        occurredAt: 3,
                    },
                    {
                        id: "step-4",
                        kind: "status",
                        title: "Inference 2",
                        status: "complete",
                        occurredAt: 4,
                    },
                    {
                        id: "step-5",
                        kind: "response",
                        title: "Response completed",
                        detail: REPLY_LAST,
                        status: "complete",
                        occurredAt: 5,
                    },
                    {
                        id: "step-6",
                        kind: "status",
                        title: "Turn completed",
                        status: "complete",
                        occurredAt: 6,
                    },
                ],
            },
        });
        return { sidebar, directory, chatSurface, composer };
    });
    const [navigation, setNavigation] = useState<ChatPageNavigation>({ chatId: chat.id });
    const actions: ChatPageActions = {
        ...passiveActions,
        chatSelect: (chatId) => setNavigation({ chatId }),
        infoOpen: () => setNavigation((value) => ({ ...value, panel: { kind: "info" } })),
        profileOpen: (userId) =>
            setNavigation((value) => ({ ...value, panel: { kind: "profile", userId } })),
        panelClose: () => setNavigation((value) => ({ ...value, panel: undefined })),
        workspaceOpen: () => setNavigation((value) => ({ ...value, panel: { kind: "workspace" } })),
        workspaceClose: () => setNavigation((value) => ({ ...value, panel: undefined })),
        workspaceFileOpen: (_chatId, path) =>
            setNavigation((value) => ({ ...value, workspaceFilePath: path })),
        workspaceFileClose: () =>
            setNavigation((value) => ({ ...value, workspaceFilePath: undefined })),
    };
    // eslint-disable-next-line happy2-react/no-layout-effect -- this Blueprint page owns several disposable fake surfaces whose subscriptions must be released together when the specimen unmounts
    useLayoutEffect(
        () => () => {
            sidebar[Symbol.dispose]();
            directory[Symbol.dispose]();
            chatSurface[Symbol.dispose]();
            composer[Symbol.dispose]();
        },
        [sidebar, directory, chatSurface, composer],
    );
    return (
        <ComponentPage
            contract="Surface store"
            number="P-002"
            summary="The complete chat page consumes independent sidebar, directory, chat, and composer stores with constant-size subscriptions and a closed orchestration controller."
            title="Chat page"
        >
            <FullScreenSpecimen
                detail="Loaded channel and composer · deterministic real stores · no transport, authentication, or aggregate state facade"
                label="Chat — ready"
                number="01"
            >
                <ChatPage
                    actions={actions}
                    chat={chatSurface.store}
                    composer={composer}
                    directory={directory.store}
                    navActiveId=""
                    navSection={{
                        id: "workspace",
                        items: [
                            {
                                id: "admin",
                                kind: "view",
                                icon: "settings",
                                label: "Administration",
                            },
                        ],
                    }}
                    navigation={navigation}
                    onNavSelect={() => undefined}
                    sidebar={sidebar.store}
                    sidebarFooter={
                        <div
                            style={{
                                alignItems: "center",
                                display: "flex",
                                gap: "4px",
                                width: "100%",
                            }}
                        >
                            <button className="happy2-sidebar__profile" type="button">
                                <Avatar initials="AL" online size="sm" tone="mint" />
                                <span className="happy2-sidebar__profile-name">Ada Lovelace</span>
                            </button>
                            <Button
                                aria-label="Use dark appearance"
                                icon="moon"
                                iconOnly
                                size="small"
                                variant="ghost"
                            />
                        </div>
                    }
                    user={{ id: "user-blueprint", firstName: "Ada" }}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
