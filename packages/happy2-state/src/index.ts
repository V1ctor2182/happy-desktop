export {
    rigSlotEntriesInScope,
    rigSlotEntryInScope,
    rigSlotsStoreCreate,
    rigSlotsStoreNoop,
    type RigSlotAction,
    type RigSlotContent,
    type RigSlotEntry,
    type RigSlotEntryAuthor,
    type RigSlotName,
    type RigSlotScope,
    type RigSlotsContext,
    type RigSlotsSnapshot,
    type RigSlotsStore,
    type RigSlotsStoreOptions,
    type RigWebapp,
    type RigWebappVersion,
} from "./rig/rigSlotsStore.js";
export {
    TransportError,
    type ClientTransport,
    type HttpRequest,
    type HttpResponse,
    type HttpStreamEvent,
    type HttpStreamObserver,
    type RealtimeObserver,
    type TerminalConnection,
    type TerminalConnectTarget,
} from "./transport.js";
export * from "./types.js";
export * from "./resources.js";
export type { TerminalSummary, TerminalIdentity } from "./backend.js";
export {
    HappyState,
    happyStateCreate,
    type HappyStateEvent,
    type HappyStateOptions,
} from "./happyState.js";
export { type DeepReadonly } from "./deepReadonly.js";
export {
    composerStoreCreate,
    type ComposerStoreOptions,
} from "./modules/composer/composerState.js";
export {
    composerCapabilitiesNone,
    type ComposerCapabilities,
    type ComposerCommand,
    type ComposerMention,
} from "./modules/composer/composerState.js";
export {
    type ComposerAttachment,
    type ComposerOutput,
    type ComposerSnapshot,
    type ComposerStore,
    type ComposerSubmission,
} from "./modules/composer/composerState.js";
export type {
    ChatHandle,
    ChatInput,
    ChatMemberProjection,
    ChatOutput,
    ChatPinProjection,
    ChatSnapshot,
    ChatStore,
    PortShareAccess,
    PortShareAccessTarget,
    ReactionActors,
} from "./modules/chat/chatState.js";
export type { Loadable } from "./conversation/loadable.js";
export type { ConversationAuthor } from "./conversation/conversationAuthor.js";
export type {
    ConversationActivity,
    ConversationActivityEntry,
    ConversationActivityFailure,
    ConversationActivityPresentation,
    ConversationActivityReview,
    ConversationActivityStatus,
    ConversationDiffHunk,
    ConversationDiffKind,
    ConversationDiffLine,
    ConversationDiffLineKind,
    ConversationEntry,
    ConversationFileDiff,
    ConversationAttachment,
    ConversationComputeNoticeEntry,
    ConversationComputeState,
    ConversationJson,
    ConversationMessageEntry,
    ConversationMessageProjection,
    ConversationNoticeEntry,
    ConversationReaction,
    ConversationRequest,
    ConversationRequestEntry,
    ConversationRequestOption,
    ConversationRequestSubmission,
    ConversationRequestStatus,
    ConversationRequestQuestion,
    ConversationServiceNoticeEntry,
    ConversationToolCall,
    ConversationTurnStatusEntry,
} from "./conversation/conversationEntry.js";
export { entryKey, entrySequence } from "./conversation/conversationEntry.js";
export { entriesMerge, entryCompare, entryEquivalent } from "./conversation/conversationEntries.js";
export type {
    ConversationListSnapshot,
    ConversationSummary,
} from "./conversation/conversationSummary.js";
export type {
    SidebarChatProjection,
    SidebarSnapshot,
    SidebarStatus,
    SidebarStore,
} from "./modules/sidebar/sidebarState.js";
export { chatOrderCompare } from "./modules/sidebar/chatOrder.js";
export type { ChatOrderPosition } from "./modules/sidebar/chatOrder.js";
export type {
    WorkspaceHandle,
    WorkspaceSnapshot,
    WorkspaceStore,
} from "./modules/workspace/workspaceState.js";
export type {
    WorkspaceFileHandle,
    WorkspaceFileSaveState,
    WorkspaceFileSnapshot,
    WorkspaceFileStore,
} from "./modules/workspace-file/workspaceFileState.js";
export type {
    SettingsSaveState,
    SettingsFieldStates,
    SettingsSnapshot,
    SettingsStore,
    SettingsStoreOptions,
} from "./modules/settings/settingsState.js";
export type {
    SearchResultProjection,
    SearchSnapshot,
    SearchStore,
} from "./modules/search/searchState.js";
export type { FilesSnapshot, FilesStore } from "./modules/files/filesState.js";
export type {
    DirectorySnapshot,
    DirectoryStore,
    DirectoryUserProjection,
} from "./modules/directory/directoryState.js";
export type {
    AgentModelsSnapshot,
    AgentModelsStore,
} from "./modules/agent-models/agentModelsState.js";
export type { AdminSection, AdminSnapshot, AdminStore } from "./modules/admin/adminState.js";
export {
    assetUrlKey,
    assetUrlsStoreCreate,
    type AssetUrlEntry,
    type AssetUrlRequest,
    type AssetUrlsSnapshot,
    type AssetUrlsStore,
} from "./modules/asset-urls/assetUrlsState.js";
export {
    overlaysStoreCreate,
    type AppOverlayPresentation,
    type InspectorSnapshot,
    type OverlaySnapshot,
    type OverlaysSnapshot,
    type OverlaysStore,
    type TerminalPanelSnapshot,
} from "./modules/overlays/overlaysState.js";
export type {
    AgentImagesSnapshot,
    AgentImagesStore,
} from "./modules/agent-images/agentImagesState.js";
export type {
    SetupAction,
    SetupPending,
    SetupSnapshot,
    SetupStore,
} from "./modules/setup/setupState.js";
export {
    setupDraftStoreCreate,
    type SetupDraftSnapshot,
    type SetupDraftState,
    type SetupDraftStore,
    type SetupDraftStoreOptions,
} from "./modules/setup/setupDraftState.js";
export {
    fileDownloadStoreCreate,
    type FileDownloadInput,
    type FileDownloadOutput,
    type FileDownloadSnapshot,
    type FileDownloadState,
    type FileDownloadStore,
} from "./modules/files/fileDownloadState.js";
export type {
    AgentSecretsSnapshot,
    AgentSecretsStore,
} from "./modules/agent-secrets/agentSecretsState.js";
export type {
    PluginsSnapshot,
    PluginsStore,
    PluginUpdateCheckState,
    PluginInstallationUpdateState,
    PluginDiagnosticsState,
} from "./modules/plugins/pluginsState.js";
export {
    permissionAllowed,
    type PermissionsSnapshot,
    type PermissionsStore,
} from "./modules/permissions/permissionsState.js";
export type { RolesCatalog, RolesSnapshot, RolesStore } from "./modules/roles/rolesState.js";
export type {
    PluginArchiveDraft,
    PluginInstallSnapshot,
    PluginInstallSourceKind,
    PluginInstallStep,
    PluginInstallStore,
    PluginPrepareSource,
} from "./modules/plugin-install/pluginInstallState.js";
export type { McpAppHandle, McpAppSnapshot, McpAppStore } from "./modules/mcp-apps/mcpAppState.js";
export {
    documentRemoteOrigin,
    documentStoreCreate,
    type DocumentHandle,
    type DocumentLocalPresence,
    type DocumentOutput,
    type DocumentSessionSnapshot,
    type DocumentSessionState,
    type DocumentStore,
} from "./modules/document/documentState.js";
export {
    documentListStoreCreate,
    type DocumentListHandle,
    type DocumentListSnapshot,
    type DocumentListState,
    type DocumentListStore,
} from "./modules/document-list/documentListState.js";
export {
    documentCollectionStoreCreate,
    type DocumentCollectionInput,
    type DocumentCollectionSnapshot,
    type DocumentCollectionState,
    type DocumentCollectionStore,
} from "./modules/document-collection/documentCollectionState.js";
export type {
    ChatContributionsHandle,
    ChatContributionsSnapshot,
    ChatContributionsStore,
    PluginActionState,
    PluginAppHandle,
    PluginAppInstanceSnapshot,
    PluginAppInstanceStore,
    PluginMenuState,
    PluginNavigationSnapshot,
    PluginNavigationStore,
    PluginPresentationState,
} from "./modules/plugin-surfaces/pluginSurfacesState.js";
export type {
    NotificationProjection,
    NotificationsSnapshot,
    NotificationsStore,
} from "./modules/notifications/notificationsState.js";
export type {
    CallParticipantProjection,
    CallProjection,
    CallsSnapshot,
    CallsStore,
    CallSignalProjection,
} from "./modules/calls/callsState.js";
export type { ChannelUpdateInput } from "./modules/chat-actions/chatActionsState.js";
export type {
    TerminalCellSnapshot,
    TerminalCursorSnapshot,
    TerminalDriver,
    TerminalDriverCreate,
    TerminalDriverStatus,
    TerminalGridSnapshot,
    TerminalHandle,
    TerminalInputModesSnapshot,
    TerminalReplica,
    TerminalRowSnapshot,
    TerminalSnapshot,
    TerminalState,
    TerminalStore,
} from "./modules/terminal/terminalState.js";
export type { ReactionSelector } from "./modules/reaction/reactionState.js";
export {
    rigConnectionLoaderCreate,
    type RigConnectionLoaderOptions,
    type RigConnectionSnapshot,
    type RigConnectionStore,
    type RigDaemonHealth,
} from "./rig/rigConnection.js";
export { rigHostNoop, type RigHost } from "./rig/rigHost.js";
export {
    rigWindowStoreNoop,
    type RigWindowSnapshot,
    type RigWindowStore,
} from "./rig/rigWindowStore.js";
export * from "./rig/rigTypes.js";
export type {
    RigAgentEvent,
    RigEventObserver,
    RigGlobalEvent,
    RigSessionEvent,
    RigTransport,
} from "./rig/rigTransport.js";
export {
    rigMenusDerive,
    rigMenusStoreCreate,
    type RigMenusStore,
    type RigMenusStoreOptions,
} from "./rig/rigMenusStore.js";
export {
    rigSessionListStoreCreate,
    type RigSessionCatalogSnapshot,
    type RigSessionCatalogSource,
    type RigSessionListDeps,
    type RigSessionListOutput,
    type RigSessionListSnapshot,
    type RigSessionListStore,
    type RigSessionLocation,
} from "./rig/rigSessionListStore.js";
export {
    rigProjectGroupsProject,
    rigSessionGroupIdOf,
    type RigProjectGroup,
    type RigWorktreeGroup,
} from "./rig/rigProjectGroupProject.js";
export {
    rigChatStoreCreate,
    type RigChatDeps,
    type RigChatOutput,
    type RigChatSnapshot,
    type RigChatStore,
    type RigChatTranscriptConnect,
    type RigChatTranscriptConnection,
    type RigWorkingWait,
} from "./rig/rigChatStore.js";
export {
    rigClientCreate,
    type RigChatHandle,
    type RigClient,
    type RigClientDeps,
} from "./rig/rigClient.js";
export {
    rigInboxStoreCreate,
    rigInboxStoreNoop,
    type RigInboxInput,
    type RigInboxOutput,
    type RigInboxSnapshot,
    type RigInboxSource,
    type RigInboxSourceItem,
    type RigInboxStore,
    type RigInboxStoreDeps,
    type RigInboxSubmission,
} from "./rig/rigInboxStore.js";
export {
    rigInstructionsStoreCreate,
    RIG_INSTRUCTIONS_MAX_BYTES,
    type RigInstructionsSnapshot,
    type RigInstructionsStore,
    type RigInstructionsStoreDeps,
} from "./rig/rigInstructionsStore.js";
export {
    rigSecurityPolicyStoreCreate,
    RIG_SECURITY_POLICY_MAX_BYTES,
    type RigSecurityPolicySnapshot,
    type RigSecurityPolicyStore,
    type RigSecurityPolicyStoreDeps,
} from "./rig/rigSecurityPolicyStore.js";
export {
    rigPluginApplicationStoreCreate,
    rigPluginApplicationStoreNoop,
    type RigPluginApplication,
    type RigPluginApplicationSource,
    type RigPluginApplicationSourceReading,
    type RigPluginApplicationStatus,
    type RigPluginApplicationStore,
    type RigPluginApplicationStoreDeps,
    type RigPluginApplicationsSnapshot,
    type RigPluginCatalogConnection,
} from "./rig/rigPluginApplicationStore.js";
export { rigFriendsPhotoRead } from "./rig/rigFriendsPhoto.js";
export {
    rigFriendInitials,
    rigFriendName,
    rigFriendsStoreCreate,
    rigFriendsStoreNoop,
    type RigFriend,
    type RigFriendAnswer,
    type RigFriendId,
    type RigFriendProfile,
    type RigFriendRequest,
    type RigFriendRequestId,
    type RigFriendsAccount,
    type RigFriendsAnswerState,
    type RigFriendsInput,
    type RigFriendsInviteDraft,
    type RigFriendsOutput,
    type RigFriendsPhotoDraft,
    type RigFriendsProfileDraft,
    type RigFriendsSignupInput,
    type RigFriendsSnapshot,
    type RigFriendsSource,
    type RigFriendsSourceAccount,
    type RigFriendsSourceFriend,
    type RigFriendsSourceProfile,
    type RigFriendsSourceReading,
    type RigFriendsSourceRequest,
    type RigFriendsStore,
    type RigFriendsStoreDeps,
} from "./rig/rigFriendsStore.js";
export {
    rigProviderUsageStoreCreate,
    rigProviderUsageStoreNoop,
    type RigProviderUsageCredits,
    type RigProviderUsageEntry,
    type RigProviderUsageReading,
    type RigProviderUsageSnapshot,
    type RigProviderUsageSource,
    type RigProviderUsageSourceReading,
    type RigProviderUsageStore,
    type RigProviderUsageStoreDeps,
    type RigProviderUsageWindow,
    type RigProviderVendor,
} from "./rig/rigProviderUsageStore.js";
export {
    rigTerminalOpen,
    type RigTerminalDeps,
    type RigTerminalHandle,
    type RigTerminalSnapshot,
    type RigTerminalStore,
} from "./rig/rigTerminalStore.js";
export {
    rigPanelStoreCreate,
    type RigBrowserUpdate,
    type RigPanelDeps,
    type RigPanelSnapshot,
    type RigPanelStore,
    type RigPanelTabId,
    type RigPanelTabKind,
    type RigPanelTabSnapshot,
    type RigViewPlacement,
} from "./rig/rigPanelStore.js";
export {
    rigSelectionEffortUpdate,
    rigSelectionEqual,
    rigSelectionModelUpdate,
    rigSelectionPermissionModeUpdate,
    rigSelectionServiceTierUpdate,
    rigSessionDraftStoreCreate,
    rigSessionSelectionDefault,
    type RigSessionDraftOptions,
    type RigSessionDraftSnapshot,
    type RigSessionDraftStore,
} from "./rig/rigSessionDraftStore.js";
export {
    rigComposerCommands,
    rigWorkspaceStoreCreate,
    type RigFileTabKind,
    type RigFileTabSnapshot,
    RIG_PANEL_FILE_VIEW_ID,
    type RigPanelFileKind,
    type RigPanelFileSnapshot,
    type RigCreateGroupOption,
    type RigCreateSnapshot,
    type RigFileLayout,
    type RigFileScope,
    type RigFileViewMode,
    type RigRenameSnapshot,
    type RigConversationSnapshot,
    type RigWorkspaceDeps,
    type RigWorkspaceNewChatInput,
    type RigWorkspaceOutput,
    type RigWorkspaceSnapshot,
    type RigWorkspaceStore,
} from "./rig/rigWorkspaceStore.js";
export {
    rigAgentAuthor,
    rigConversationSummaryProject,
    rigOwnerAuthor,
} from "./rig/rigConversationProject.js";
export { rigConversationAttachTurnTraces } from "./rig/rigConversationTurnTrace.js";
export { notesStoreCreate, type NotesSnapshot, type NotesStore } from "./notes/notesStore.js";
export {
    noteStoreCreate,
    type NoteSnapshot,
    type NoteStore,
    type NoteStoreDeps,
} from "./notes/noteStore.js";
export {
    notesSessionStoreCreate,
    type NotesSessionSnapshot,
    type NotesSessionStore,
} from "./notes/notesSessionStore.js";
export type {
    NoteApplyRequest,
    NoteContent,
    NoteSaveState,
    NoteSummary,
    NotesTransport,
} from "./notes/notesTypes.js";
export {
    rigModelStoreCreate,
    type RigModelStore,
    type RigModelPreference,
    type RigModelPreferenceDefault,
    type RigModelPreferenceDocument,
    type RigModelPreferenceIdentity,
    type RigModelPreferences,
    type RigModelPreferencePersistence,
    type RigModelStoreOptions,
    type RigModelStoreReadySnapshot,
    type RigModelStoreSnapshot,
} from "./rig/rigModelStore.js";
export {
    rigNavigationOrderApply,
    rigNavigationOrderStoreCreate,
    rigNavigationOrderStoreNoop,
    type RigNavigationOrderDocument,
    type RigNavigationOrderPersistence,
    type RigNavigationOrderSnapshot,
    type RigNavigationOrderStore,
} from "./rig/rigNavigationOrderStore.js";
export {
    rigWorkspaceMemoryStoreCreate,
    type RigFileTabMemory,
    type RigGroupTabMemory,
    type RigWorkspaceMemoryDocument,
    type RigWorkspaceMemoryPersistence,
    type RigWorkspaceMemoryStore,
} from "./rig/rigWorkspaceMemory.js";
export {
    rigModelKey,
    rigSettingsStoreCreate,
    type RigModelKey,
    type RigSettingsSnapshot,
    type RigSettingsInitial,
    type RigSettingsStore,
} from "./rig/rigSettingsStore.js";
export {
    rigClockStoreCreate,
    type RigClockStore,
    type RigClockStoreOptions,
} from "./rig/rigClock.js";
export { rigPermissionLabel, rigServiceTierLabel, rigThinkingLabel } from "./rig/rigSupport.js";
export {
    appearanceStoreCreate,
    type AppearanceSnapshot,
    type AppearanceStore,
    type AppearanceStoreOptions,
    type ThemeMode,
} from "./appearance/appearanceStore.js";
