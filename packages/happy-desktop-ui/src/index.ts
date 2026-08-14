import "./styles.css";

export { happyLogoUrl } from "./assets";
export { ChangedFileDiff, type ChangedFileDiffProps } from "./ChangedFileDiff";
export { CodeBlock, codeBlockLanguage, type CodeBlockProps } from "./CodeBlock";
export { CodeEditor, type CodeEditorProps } from "./CodeEditor";
export { CodeHighlightWorkers } from "./CodeHighlightWorkers";
export { SplashScreen, type SplashScreenProps } from "./SplashScreen";
export { SplashCover, type SplashCoverProps } from "./SplashCover";
export { SplitColumn, type SplitColumnProps } from "./SplitColumn";
export {
    AGENT_WORKING_STATUS_ROW_HEIGHT,
    AgentWorkingStatus,
    type AgentWaitStatus,
    type AgentWorkingPhase,
    type AgentWorkingStatusProps,
} from "./AgentWorkingStatus";
export { TurnSummary, type TurnSummaryProps } from "./TurnSummary";
export { CopyButton, type CopyButtonProps } from "./CopyButton";
export { ScrollingText, type ScrollingTextProps } from "./ScrollingText";
export { TypedText, type TypedTextProps } from "./TypedText";
export {
    ConversationComputeEvent,
    type ConversationComputeEventProps,
} from "./ConversationComputeEvent";
export { ConversationErrorCard, type ConversationErrorCardProps } from "./ConversationErrorCard";
export { AgentDesk, type AgentDeskProps, type DeskListItem, type DeskRun } from "./AgentDesk";
export {
    AgentTracePanel,
    type AgentTracePanelEntry,
    type AgentTracePanelProps,
    type AgentTracePanelStatus,
} from "./AgentTracePanel";
export {
    AgentTraceRow,
    type AgentTraceRowKind,
    type AgentTraceRowProps,
    type AgentTraceRowStatus,
} from "./AgentTraceRow";
export {
    AgentRunCard,
    type AgentRun,
    type AgentRunAction,
    type AgentRunCardProps,
    type AgentRunStatus,
    type AgentRunStep,
} from "./AgentRunCard";
export {
    ApprovalCard,
    type ApprovalCardProps,
    type ApprovalRequest,
    type ApprovalResolution,
} from "./ApprovalCard";
export { AppShell, APP_SHELL_PANEL_DEFAULT_WIDTH, type AppShellProps } from "./AppShell";
export {
    Avatar,
    type AvatarProps,
    type AvatarSize,
    type AvatarType,
    type ToneName,
} from "./Avatar";
export { AvatarBrutalist, type AvatarBrutalistProps } from "./AvatarBrutalist";
export { AutomatedTag, type AutomatedTagProps } from "./AutomatedTag";
export {
    Badge,
    type BadgeProps,
    type BadgeVariant,
    CountBadge,
    type CountBadgeProps,
    KeyCap,
    type KeyCapProps,
    ReactionChip,
    type ReactionChipProps,
} from "./Badge";
export { Box, type BoxProps } from "./Box";
export {
    BuildIdentityPill,
    buildIdentityTone,
    type BuildIdentityPillProps,
} from "./BuildIdentityPill";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { ChannelHeader, type ChannelHeaderProps, type ChannelMember } from "./ChannelHeader";
export {
    SlotEntries,
    type SlotActionIntent,
    type SlotEntriesPlacement,
    type SlotEntriesProps,
    type SlotVisualEntry,
} from "./SlotEntries";
export { PanelHeader, type PanelHeaderProps } from "./PanelHeader";
export { AudienceToggle, type AudienceToggleProps, type AudienceValue } from "./AudienceToggle";
export {
    Composer,
    type ComposerProps,
    ContextChips,
    type ContextChipsProps,
    type ContextItem,
    type ContextKind,
    type Mentionable,
    MentionPicker,
    type MentionPickerProps,
} from "./Composer";
export {
    type ComposerAttachmentPreview,
    type ComposerAttachmentPreviewKind,
    ComposerAttachmentPreviews,
    type ComposerAttachmentPreviewsProps,
} from "./ComposerAttachmentPreviews";
export {
    ComposerModelControl,
    type ComposerModelChoice,
    type ComposerModelControlProps,
} from "./ComposerModelControl";
export { rigComposerModelControlProps } from "./rigComposerModelControl";
export {
    DiffSnippet,
    type DiffLine,
    type DiffLineKind,
    type DiffSnippetProps,
} from "./DiffSnippet";
export { ToolCallPreview, type ToolCallPreviewProps } from "./ToolCallPreview";
export type { Dimension } from "./dimensions";
export { EventCard, type EventCardProps } from "./EventCard";
export { Fade, type FadeProps } from "./Fade";
export {
    FileTree,
    fileTreeFamily,
    type FileTreeFamily,
    type FileTreeGitStatus,
    type FileTreeNode,
    type FileTreeProps,
    type FileTreeSelectModifiers,
} from "./FileTree";
export { FilePanel, type FilePanelProps } from "./FilePanel";
export {
    FileBrowser,
    type FileBrowserLayout,
    type FileBrowserProps,
    type FileBrowserScope,
} from "./FileBrowser";
export {
    FilePreview,
    filePreviewKind,
    type FilePreviewContent,
    type FilePreviewKind,
    type FilePreviewProps,
} from "./FilePreview";
export { ImageViewer, type ImageViewerContent, type ImageViewerProps } from "./ImageViewer";
export { VideoViewer, type VideoViewerContent, type VideoViewerProps } from "./VideoViewer";
export { FileEditor, type FileEditorProps } from "./FileEditor";
export type { HtmlPreviewFailure, HtmlPreviewProps, HtmlPreviewRenderer } from "./htmlPreview";
export type { MediaWindowOpener, MediaWindowRequest } from "./mediaWindow";
export { HtmlPreviewFrame, type HtmlPreviewFrameProps } from "./HtmlPreviewFrame";
export { HtmlPreviewError, type HtmlPreviewErrorProps } from "./HtmlPreviewError";
export {
    MarkdownDocument,
    markdownDocumentLinkPath,
    type MarkdownDocumentProps,
} from "./MarkdownDocument";
export { Icon, type IconName, iconNames, type IconProps } from "./Icon";
export {
    Ionicon,
    type IoniconName,
    type IoniconProps,
    ioniconNames,
    Octicon,
    type OcticonName,
    type OcticonProps,
    octiconNames,
} from "./vectorIcons/VectorIcon";
export {
    DayDivider,
    Message,
    MessageList,
    type MessageDeliveryState,
    type MessageImage,
    type MessageListProps,
    type MessageListScrollPosition,
    type MessageProps,
    type MessageReaction,
    type MessageSegment,
    SteeringNotice,
    SystemNotice,
    type SystemNoticeSegment,
} from "./Message";
export { type MessageGenerationStatus } from "./MessageMarkdown";
export { Lightbox, type LightboxProps } from "./Lightbox";
export { Rail, type RailItem, type RailProps } from "./Rail";
export { ThemeScope, type ThemeMode, type ThemeScopeProps } from "./ThemeScope";
export { haptic, type HapticSignal } from "./haptics";
export {
    Sidebar,
    sidebarReorderMove,
    type SidebarItem,
    type SidebarItemAction,
    type SidebarProps,
    type SidebarReorder,
    type SidebarSection,
} from "./Sidebar";
export { SidebarNodes, type SidebarNode, type SidebarNodesProps } from "./SidebarNodes";
export { SidebarFooter, type SidebarFooterProps } from "./SidebarFooter";
export {
    SIDEBAR_SPACES_BAR_HEIGHT,
    SIDEBAR_SPACES_DOT_SIZE,
    SidebarSpaces,
    type SidebarSpace,
    type SidebarSpacesProps,
} from "./SidebarSpaces";
export { SidebarUpdateAction, type SidebarUpdateActionProps } from "./SidebarUpdateAction";
export {
    DesktopStartupScreen,
    type DesktopStartupPhase,
    type DesktopStartupScreenProps,
    type DesktopStartupUpdate,
    type DesktopStartupValues,
} from "./DesktopStartupScreen";
export { RigConnectionStatus, type RigConnectionStatusProps } from "./RigConnectionStatus";
export {
    RigPeerStatus,
    rigPeerStatusLabel,
    type RigPeerState,
    type RigPeerStatusProps,
} from "./RigPeerStatus";
export {
    RigPairing,
    type RigPairingEmojis,
    type RigPairingInvitationView,
    type RigPairingPeer,
    type RigPairingProgress,
    type RigPairingProps,
    type RigPairingRole,
} from "./RigPairing";
export {
    AgentActivityRow,
    type ActivityMotion,
    type ActivityTreatment,
    type AgentActivityRowProps,
} from "./AgentActivityRow";
export { ConversationEntryView, type ConversationEntryViewProps } from "./ConversationEntryView";
export { ContextMeter, type ContextMeterProps } from "./ContextMeter";
export {
    fileTreeBuild,
    fileTreeExpanded,
    fileTreeFlatten,
    fileTreeVisibleFiles,
    type FileTreeBuildEntry,
    type FileTreeExpansion,
} from "./fileTreeBuild";
export { fileEntriesSort, fileNameCompare, filePathCompare } from "./fileTreeSort";
export {
    ConversationStatus,
    ConversationView,
    type ConversationViewProps,
} from "./ConversationView";
export {
    ComposerFooterBar,
    ConversationDock,
    FloatingConversationDock,
    type ComposerFooterBarProps,
    type ConversationDockProps,
    type FloatingConversationDockProps,
} from "./ConversationDock";
export { ComposerPanel, type ComposerPanelProps } from "./ComposerPanel";
export {
    RigUserInputPrompt,
    type RigUserInputAnswerMap,
    type RigUserInputPromptProps,
    type RigUserInputPromptVariant,
} from "./RigUserInputPrompt";
export {
    RigControlMenu,
    type RigControlMenuProps,
    RigSessionControls,
    type RigSessionControlsProps,
} from "./RigSessionControls";
export {
    CommandPicker,
    commandPickerItems,
    type CommandPickerItem,
    type CommandPickerProps,
} from "./CommandPicker";
export { RigUsagePanel, type RigUsagePanelProps } from "./RigUsagePanel";
export {
    RigProjectSettingsDialog,
    type RigProjectComputeChoice,
    type RigProjectComputeMode,
    type RigProjectComputeSection,
    type RigProjectSettingsDialogProps,
} from "./RigProjectSettingsDialog";
export {
    RigFolderDialog,
    RIG_FOLDER_DEFAULT_EMOJI,
    RIG_FOLDER_EMOJI,
    type RigFolderDialogProps,
} from "./RigFolderDialog";
export {
    RigContactDialog,
    type RigContactDialogProps,
    type RigContactInvitationView,
    type RigContactOutgoingView,
    type RigContactRequestView,
} from "./RigContactDialog";
export {
    RigFolderShareDialog,
    type RigFolderShareContactView,
    type RigFolderShareDialogProps,
} from "./RigFolderShareDialog";
export {
    RigCreateSessionDialog,
    type RigCreateSessionDestination,
    type RigCreateSessionDialogProps,
} from "./RigCreateSessionDialog";
export { RigProjectCloneDialog, type RigProjectCloneDialogProps } from "./RigProjectCloneDialog";
export { RigActivityPanel, type RigActivityPanelProps } from "./RigActivityPanel";
export { RigActivityControl, type RigActivityControlProps } from "./RigActivityControl";
export {
    SearchField,
    type SearchFieldEditableProps,
    type SearchFieldOpenerProps,
    type SearchFieldProps,
    TitleBar,
    type TitleBarEditableProps,
    type TitleBarOpenerProps,
    type TitleBarPlainProps,
    type TitleBarProps,
    WindowDragRegion,
    type WindowDragRegionProps,
} from "./TitleBar";
export {
    TextField,
    type TextFieldProps,
    type TextFieldSize,
    type TextFieldType,
} from "./TextField";
export { Select, type SelectOption, type SelectProps, type SelectSize } from "./Select";
export { LoadingSwap, type LoadingSwapProps } from "./LoadingSwap";
export {
    SPINNER_FRAMES,
    SPINNER_VARIANTS,
    Spinner,
    type SpinnerProps,
    type SpinnerTone,
    type SpinnerVariant,
} from "./Spinner";
export {
    ShimmerText,
    type ShimmerTextProps,
    type ShimmerTextSweep,
    type ShimmerTextTone,
} from "./ShimmerText";
export { WaitRing, type WaitRingProps, waitFinishDateLabel, waitRemainingLabel } from "./WaitRing";
export { WorkspaceLifecycleLane, type WorkspaceLifecycleLaneProps } from "./WorkspaceLifecycleLane";
export {
    WorkspaceLifecycleNotice,
    type WorkspaceLifecycleNoticeProps,
    type WorkspaceLifecycleNoticeSize,
    type WorkspaceLifecyclePhase,
} from "./WorkspaceLifecycleNotice";
export { Switch, type SwitchProps, type SwitchSize } from "./Switch";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export {
    SegmentedControl,
    type SegmentedControlProps,
    type SegmentedControlSegment,
    type SegmentedControlSize,
} from "./SegmentedControl";
export { Banner, type BannerAction, type BannerProps, type BannerTone } from "./Banner";
export {
    EmptyState,
    type EmptyStateAction,
    type EmptyStateProps,
    type EmptyStateSize,
} from "./EmptyState";
export {
    LottieScene,
    type LottieSceneName,
    type LottieScenePlay,
    type LottieSceneProps,
} from "./LottieScene";
export { type TabItem, Tabs, type TabsProps, type TabsSize } from "./Tabs";
export { TabbedPane, type TabbedPaneProps } from "./TabbedPane";
export { TransferZone, type TransferZoneProps } from "./TransferZone";
export {
    TRANSFER_ZONE_ATTRIBUTE,
    type TabTransferTarget,
    type TransferZoneState,
} from "./tabTransfer";
export { Toolbar, type ToolbarProps, type ToolbarSearch } from "./Toolbar";
export { Menu, type MenuItem, type MenuProps } from "./Menu";
export { Modal, type ModalProps, type ModalSize, type ModalTone } from "./Modal";
export { ModalOverlay, type ModalOverlayProps } from "./ModalOverlay";
export {
    DefaultAgentForm,
    type DefaultAgentFormProps,
    DEFAULT_AGENT_LUCKY_LABEL,
} from "./DefaultAgentForm";
export { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
export { FormRow, type FormRowAlign, type FormRowLayout, type FormRowProps } from "./FormRow";
export { NotesPage, type NotesPageProps } from "./pages/notes/NotesPage";
export {
    DocumentSurface,
    type DocumentSurfaceParticipant,
    type DocumentSurfaceProps,
} from "./DocumentSurface";
export {
    DataTable,
    type DataTableAlign,
    type DataTableColumn,
    type DataTableProps,
    type DataTableRow,
} from "./DataTable";
export {
    type StatDelta,
    StatTile,
    type StatTileProps,
    type StatTone,
    type StatTrend,
} from "./StatTile";
export {
    LocalOnboardingScreen,
    type LocalOnboardingScreenProps,
    type LocalOnboardingTerminal,
    type LocalOnboardingView,
} from "./LocalOnboardingScreen";
export {
    WelcomeScreen,
    type WelcomeScreenProps,
    type WelcomeSlide,
    type WelcomeSlideArt,
} from "./WelcomeScreen";
export { SetupChoice, type SetupChoiceOption, type SetupChoiceProps } from "./SetupChoice";
export { SetupPage, type SetupPageAction, type SetupPageProps } from "./SetupPage";
export {
    SetupOptionCard,
    type SetupOptionCardProps,
    type SetupOptionHintTone,
    type SetupOptionStatus,
} from "./SetupOptionCard";
export {
    BuildProgressPanel,
    type BuildProgressPanelProps,
    type BuildProgressStatus,
} from "./BuildProgressPanel";
export { type Availability, StatusPicker, type StatusPickerProps } from "./StatusPicker";
export {
    type SearchResultAvatar,
    type SearchResultGroup,
    type SearchResultItem,
    SearchResults,
    type SearchResultsProps,
    type SearchResultsVariant,
    type SearchResultType,
} from "./SearchResults";
export {
    MediaGallery,
    type MediaGalleryProps,
    type MediaItem,
    type MediaKind,
} from "./MediaGallery";
export {
    FileAttachment,
    type FileAttachmentKind,
    type FileAttachmentProps,
    type FileAttachmentVariant,
} from "./FileAttachment";
export { type EmojiItem, EmojiPicker, type EmojiPickerProps } from "./EmojiPicker";
export { TerminalPanel, type TerminalPanelProps } from "./TerminalPanel";
export {
    BrowserPanel,
    type BrowserContentProps,
    type BrowserContentRenderer,
    type BrowserController,
    type BrowserFailure,
    type BrowserPanelProps,
} from "./BrowserPanel";
export {
    RigInboxPage,
    type RigInboxAnswerMap,
    type RigInboxPageProps,
} from "./pages/inbox/RigInboxPage";
export {
    RigSettingsSection,
    RigSettingsShell,
    type RigSettingsCategory,
    type RigSettingsSectionProps,
    type RigSettingsShellProps,
} from "./pages/settings/RigSettingsShell";
export {
    RigGeneralSettings,
    type RigAppearanceChoice,
    type RigGeneralSettingsProps,
} from "./pages/settings/RigGeneralSettings";
export {
    RigDebugSettings,
    type RigDebugSettingsProps,
    type RigDebugTarget,
} from "./pages/settings/RigDebugSettings";
export {
    RigInstructionsSettings,
    type RigInstructionDocument,
    type RigInstructionsSettingsProps,
} from "./pages/settings/RigInstructionsSettings";
export {
    RigNodeSettings,
    type RigNodeRouteRow,
    type RigNodeRow,
    type RigNodeSettingsProps,
    type RigNodeState,
    type RigNodeTransportRow,
} from "./pages/settings/RigNodeSettings";
export {
    RigProviderSettings,
    type RigProviderModelRow,
    type RigProviderRow,
    type RigProviderSettingsProps,
    type RigProviderStatus,
} from "./pages/settings/RigProviderSettings";
export {
    RigProfilesSettings,
    type RigProfileEditor,
    type RigProfileRow,
    type RigProfilesSettingsProps,
} from "./pages/settings/RigProfilesSettings";
export {
    RigMurmurSettings,
    type RigMurmurConnection,
    type RigMurmurContactRow,
    type RigMurmurIncomingRequestRow,
    type RigMurmurOutgoingRequestRow,
    type RigMurmurSettingsProps,
} from "./pages/settings/RigMurmurSettings";
export {
    RigSecretsSettings,
    type RigSecretEditor,
    type RigSecretRow,
    type RigSecretVariableField,
    type RigSecretsSettingsProps,
} from "./pages/settings/RigSecretsSettings";
export { RigUsageSettings, type RigUsageSettingsProps } from "./pages/settings/RigUsageSettings";
