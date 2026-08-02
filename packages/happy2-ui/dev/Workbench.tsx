import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";
import "../src/index";
import { Icon } from "../src/Icon";
import { SegmentedControl } from "../src/SegmentedControl";
import { ThemeScope, type ThemeMode } from "../src/ThemeScope";
import "./workbench.css";
import { AgentDeskPage } from "./pages/AgentDeskPage";
import { AgentTracePanelPage } from "./pages/AgentTracePanelPage";
import { AgentWorkingStatusPage } from "./pages/AgentWorkingStatusPage";
import { AgentTraceRowPage } from "./pages/AgentTraceRowPage";
import { TurnSummaryPage } from "./pages/TurnSummaryPage";
import { ConversationErrorCardPage } from "./pages/ConversationErrorCardPage";
import { AgentImageDetailPage } from "./pages/AgentImageDetailPage";
import { AgentImagePanelPage } from "./pages/AgentImagePanelPage";
import { AgentRunCardPage } from "./pages/AgentRunCardPage";
import { AgentSecretDetailPage } from "./pages/AgentSecretDetailPage";
import { AgentSecretPanelPage } from "./pages/AgentSecretPanelPage";
import { ApprovalCardPage } from "./pages/ApprovalCardPage";
import { AppShellPage } from "./pages/AppShellPage";
import { AutomationCardPage } from "./pages/AutomationCardPage";
import { AutomatedTagPage } from "./pages/AutomatedTagPage";
import { ChannelAccessSummaryPage } from "./pages/ChannelAccessSummaryPage";
import { ChannelDirectoryListPage } from "./pages/ChannelDirectoryListPage";
import { AuthScreenPage } from "./pages/AuthScreenPage";
import { AvatarBrutalistPage } from "./pages/AvatarBrutalistPage";
import { AvatarPage } from "./pages/AvatarPage";
import { BadgePage } from "./pages/BadgePage";
import { BannerPage } from "./pages/BannerPage";
import { PortShareControlPage } from "./pages/PortShareControlPage";
import { BoxPage } from "./pages/BoxPage";
import { BuildIdentityPillPage } from "./pages/BuildIdentityPillPage";
import { ButtonPage } from "./pages/ButtonPage";
import { CallPanelPage } from "./pages/CallPanelPage";
import { ChannelHeaderPage } from "./pages/ChannelHeaderPage";
import { PanelHeaderPage } from "./pages/PanelHeaderPage";
import { CheckboxPage } from "./pages/CheckboxPage";
import { CommandPalettePage } from "./pages/CommandPalettePage";
import { ChatStorePage } from "./pages/ChatStorePage";
import { ChatProjectCreateDialogPage } from "./pages/ChatProjectCreateDialogPage";
import { AudienceTogglePage } from "./pages/AudienceTogglePage";
import { PluginCatalogPanelPage } from "./pages/PluginCatalogPanelPage";
import { PermissionChecklistPage } from "./pages/PermissionChecklistPage";
import { RolesPanelPage } from "./pages/RolesPanelPage";
import { RoleEditorPage } from "./pages/RoleEditorPage";
import { MemberAccessPanelPage } from "./pages/MemberAccessPanelPage";
import { PluginInstallDialogPage } from "./pages/PluginInstallDialogPage";
import { PluginUninstallDialogPage } from "./pages/PluginUninstallDialogPage";
import { PluginPermissionCardPage } from "./pages/PluginPermissionCardPage";
import { PluginDiagnosticsViewerPage } from "./pages/PluginDiagnosticsViewerPage";
import { McpAppShellPage } from "./pages/McpAppShellPage";
import { RigPluginApplicationBlueprintPage } from "./pages/RigPluginApplicationBlueprintPage";
import { ComposerPage } from "./pages/ComposerPage";
import { DataTablePage } from "./pages/DataTablePage";
import { DiffSnippetPage } from "./pages/DiffSnippetPage";
import { EmojiPickerPage } from "./pages/EmojiPickerPage";
import { EmptyStatePage } from "./pages/EmptyStatePage";
import { EventCardPage } from "./pages/EventCardPage";
import { FadePage } from "./pages/FadePage";
import { CodeBlockPage } from "./pages/CodeBlockPage";
import { CodeEditorPage } from "./pages/CodeEditorPage";
import { FileAttachmentPage } from "./pages/FileAttachmentPage";
import { FileBrowserPage } from "./pages/FileBrowserPage";
import { FileEditorPage } from "./pages/FileEditorPage";
import { FilePanelPage } from "./pages/FilePanelPage";
import { FilePreviewPage } from "./pages/FilePreviewPage";
import { ImageViewerPage } from "./pages/ImageViewerPage";
import { VideoViewerPage } from "./pages/VideoViewerPage";
import { MarkdownDocumentPage } from "./pages/MarkdownDocumentPage";
import { FileTreePage } from "./pages/FileTreePage";
import { FormRowPage } from "./pages/FormRowPage";
import { IconPage } from "./pages/IconPage";
import { VectorIconPage } from "./pages/VectorIconPage";
import { InfoPanelPage } from "./pages/InfoPanelPage";
import { LightboxPage } from "./pages/LightboxPage";
import { MediaGalleryPage } from "./pages/MediaGalleryPage";
import { MemberListPage } from "./pages/MemberListPage";
import { MenuPage } from "./pages/MenuPage";
import { MessagePage } from "./pages/MessagePage";
import { ModalPage } from "./pages/ModalPage";
import { ModalOverlayPage } from "./pages/ModalOverlayPage";
import { DefaultAgentFormPage } from "./pages/DefaultAgentFormPage";
import { DevelopmentTokenModalPage } from "./pages/DevelopmentTokenModalPage";
import { UserPasswordResetDialogPage } from "./pages/UserPasswordResetDialogPage";
import { ModerationReportCardPage } from "./pages/ModerationReportCardPage";
import { NotificationListPage } from "./pages/NotificationListPage";
import { OnboardingScreenPage } from "./pages/OnboardingScreenPage";
import { SplashScreenPage } from "./pages/SplashScreenPage";
import { SplitColumnPage } from "./pages/SplitColumnPage";
import { PolicyControlPage } from "./pages/PolicyControlPage";
import { ProductStorePage } from "./pages/ProductStorePage";
import { ProfileCardPage } from "./pages/ProfileCardPage";
import { RailPage } from "./pages/RailPage";
import { SearchResultsPage } from "./pages/SearchResultsPage";
import { FloatingConversationDockPage } from "./pages/FloatingConversationDockPage";
import { RigSettingsBlueprintPage } from "./pages/RigSettingsPage";
import { FriendsBlueprintPage } from "./pages/FriendsBlueprintPage";
import { RigInboxBlueprintPage } from "./pages/RigInboxBlueprintPage";
import { RigProviderUsageBlueprintPage } from "./pages/RigProviderUsageBlueprintPage";
import { SettingsStorePage } from "./pages/SettingsStorePage";
import { SecretRevealPage } from "./pages/SecretRevealPage";
import { SegmentedControlPage } from "./pages/SegmentedControlPage";
import { SelectPage } from "./pages/SelectPage";
import { SetupOptionCardPage } from "./pages/SetupOptionCardPage";
import { BuildProgressPanelPage } from "./pages/BuildProgressPanelPage";
import { BrowserPanelPage } from "./pages/BrowserPanelPage";
import { SidebarPage } from "./pages/SidebarPage";
import { StatTilePage } from "./pages/StatTilePage";
import { StatusPickerPage } from "./pages/StatusPickerPage";
import { SpinnerPage } from "./pages/SpinnerPage";
import { SwitchPage } from "./pages/SwitchPage";
import { TabbedPanePage } from "./pages/TabbedPanePage";
import { TabsPage } from "./pages/TabsPage";
import { TextFieldPage } from "./pages/TextFieldPage";
import { TitleBarPage } from "./pages/TitleBarPage";
import { ToolbarPage } from "./pages/ToolbarPage";
import { TerminalPanelPage } from "./pages/TerminalPanelPage";
import { DocumentEditorPage } from "./pages/DocumentEditorPage";
import { DocumentsPanelPage } from "./pages/DocumentsPanelPage";
import { DocumentsPagePage } from "./pages/DocumentsPagePage";
import { DocumentDeleteDialogPage } from "./pages/DocumentDeleteDialogPage";
import { DocumentWritePermissionCardPage } from "./pages/DocumentWritePermissionCardPage";
import { DesktopStartupScreenPage } from "./pages/DesktopStartupScreenPage";
import { DesktopInstanceSwitcherPage } from "./pages/DesktopInstanceSwitcherPage";
import { RigConnectionStatusPage } from "./pages/RigConnectionStatusPage";
import { AgentActivityRowPage } from "./pages/AgentActivityRowPage";
import { WaitRingPage } from "./pages/WaitRingPage";
import { HtmlPreviewFramePage } from "./pages/HtmlPreviewFramePage";
import { ContextMeterPage } from "./pages/ContextMeterPage";
import { SlotEntriesPage } from "./pages/SlotEntriesPage";
import { ConversationEntryViewPage } from "./pages/ConversationEntryViewPage";
import { ConversationViewPage } from "./pages/ConversationViewPage";
import { RigUserInputPromptPage } from "./pages/RigUserInputPromptPage";
import { RigSessionControlsPage } from "./pages/RigSessionControlsPage";
import { CommandPickerPage } from "./pages/CommandPickerPage";
import { RigProjectSettingsDialogPage } from "./pages/RigProjectSettingsDialogPage";
import { RigUsagePanelPage } from "./pages/RigUsagePanelPage";
import { RigActivityPanelPage } from "./pages/RigActivityPanelPage";
import { ToolCallPreviewPage } from "./pages/ToolCallPreviewPage";
type BlueprintPage = {
    id: string;
    label: string;
    number: string;
    page: () => ReactNode;
};
const components: BlueprintPage[] = [
    { id: "box", label: "Box", number: "C-001", page: BoxPage },
    { id: "terminal-panel", label: "Terminal panel", number: "C-078", page: TerminalPanelPage },
    { id: "browser-panel", label: "Browser panel", number: "C-161", page: BrowserPanelPage },
    { id: "document-editor", label: "Document editor", number: "C-080", page: DocumentEditorPage },
    { id: "documents-panel", label: "Documents panel", number: "C-081", page: DocumentsPanelPage },
    { id: "documents-page", label: "Documents page", number: "C-140", page: DocumentsPagePage },
    {
        id: "document-delete-dialog",
        label: "Document delete dialog",
        number: "C-139",
        page: DocumentDeleteDialogPage,
    },
    {
        id: "document-write-permission-card",
        label: "Document write permission card",
        number: "C-141",
        page: DocumentWritePermissionCardPage,
    },
    {
        id: "user-password-reset-dialog",
        label: "User password reset dialog",
        number: "C-079",
        page: UserPasswordResetDialogPage,
    },
    { id: "icon", label: "Icon", number: "C-002", page: IconPage },
    { id: "button", label: "Button", number: "C-003", page: ButtonPage },
    { id: "avatar", label: "Avatar", number: "C-004", page: AvatarPage },
    { id: "badge", label: "Badge", number: "C-005", page: BadgePage },
    { id: "automated-tag", label: "Automated tag", number: "C-142", page: AutomatedTagPage },
    {
        id: "channel-access-summary",
        label: "Channel access summary",
        number: "C-143",
        page: ChannelAccessSummaryPage,
    },
    {
        id: "channel-directory-list",
        label: "Channel directory list",
        number: "C-144",
        page: ChannelDirectoryListPage,
    },
    { id: "diff-snippet", label: "Diff snippet", number: "C-006", page: DiffSnippetPage },
    { id: "title-bar", label: "Title bar", number: "C-007", page: TitleBarPage },
    { id: "rail", label: "Rail", number: "C-008", page: RailPage },
    { id: "sidebar", label: "Sidebar", number: "C-009", page: SidebarPage },
    {
        id: "chat-project-create-dialog",
        label: "Project create dialog",
        number: "C-142",
        page: ChatProjectCreateDialogPage,
    },
    {
        id: "desktop-startup-screen",
        label: "Desktop startup screen",
        number: "C-145",
        page: DesktopStartupScreenPage,
    },
    {
        id: "desktop-instance-switcher",
        label: "Desktop instance switcher",
        number: "C-146",
        page: DesktopInstanceSwitcherPage,
    },
    {
        id: "rig-connection-status",
        label: "Rig connection status",
        number: "C-147",
        page: RigConnectionStatusPage,
    },
    {
        id: "agent-activity-row",
        label: "Agent activity row",
        number: "C-148",
        page: AgentActivityRowPage,
    },
    {
        id: "wait-ring",
        label: "Wait ring",
        number: "C-172",
        page: WaitRingPage,
    },
    {
        id: "tool-call-preview",
        label: "Tool call preview",
        number: "C-165",
        page: ToolCallPreviewPage,
    },
    {
        id: "conversation-entry",
        label: "Conversation entry",
        number: "C-149",
        page: ConversationEntryViewPage,
    },
    {
        id: "turn-summary",
        label: "Turn summary",
        number: "C-164",
        page: TurnSummaryPage,
    },
    {
        id: "conversation-error-card",
        label: "Conversation error card",
        number: "C-166",
        page: ConversationErrorCardPage,
    },
    {
        id: "floating-conversation-dock",
        label: "Floating conversation dock",
        number: "C-167",
        page: FloatingConversationDockPage,
    },
    { id: "file-browser", label: "File browser", number: "C-168", page: FileBrowserPage },
    { id: "file-preview", label: "File preview", number: "C-169", page: FilePreviewPage },
    { id: "image-viewer", label: "Image viewer", number: "C-235", page: ImageViewerPage },
    { id: "video-viewer", label: "Video viewer", number: "C-236", page: VideoViewerPage },
    { id: "code-block", label: "Code block", number: "C-174", page: CodeBlockPage },
    { id: "code-editor", label: "Code editor", number: "C-175", page: CodeEditorPage },
    {
        id: "html-preview-frame",
        label: "HTML preview frame",
        number: "C-173",
        page: HtmlPreviewFramePage,
    },
    {
        id: "markdown-document",
        label: "Markdown document",
        number: "C-171",
        page: MarkdownDocumentPage,
    },
    {
        id: "avatar-brutalist",
        label: "Avatar brutalist",
        number: "C-170",
        page: AvatarBrutalistPage,
    },
    {
        id: "rig-user-input-prompt",
        label: "Rig user input prompt",
        number: "C-150",
        page: RigUserInputPromptPage,
    },
    {
        id: "rig-session-controls",
        label: "Rig session controls",
        number: "C-151",
        page: RigSessionControlsPage,
    },
    {
        id: "command-picker",
        label: "Command picker",
        number: "C-152",
        page: CommandPickerPage,
    },
    {
        id: "conversation-view",
        label: "Conversation view",
        number: "C-154",
        page: ConversationViewPage,
    },
    {
        id: "context-meter",
        label: "Context meter",
        number: "C-159",
        page: ContextMeterPage,
    },
    { id: "slot-entries", label: "Slot entries", number: "C-176", page: SlotEntriesPage },
    {
        id: "rig-usage-panel",
        label: "Rig usage panel",
        number: "C-156",
        page: RigUsagePanelPage,
    },
    {
        id: "rig-project-settings-dialog",
        label: "Rig project settings",
        number: "C-178",
        page: RigProjectSettingsDialogPage,
    },
    {
        id: "rig-activity-panel",
        label: "Rig activity panel",
        number: "C-157",
        page: RigActivityPanelPage,
    },
    { id: "app-shell", label: "App shell", number: "C-010", page: AppShellPage },
    { id: "channel-header", label: "Channel header", number: "C-011", page: ChannelHeaderPage },
    { id: "panel-header", label: "Panel header", number: "C-162", page: PanelHeaderPage },
    { id: "message", label: "Message", number: "C-012", page: MessagePage },
    { id: "agent-run-card", label: "Agent run card", number: "C-013", page: AgentRunCardPage },
    { id: "approval-card", label: "Approval card", number: "C-014", page: ApprovalCardPage },
    { id: "event-card", label: "Event card", number: "C-015", page: EventCardPage },
    { id: "agent-desk", label: "Agent desk", number: "C-016", page: AgentDeskPage },
    { id: "composer", label: "Composer", number: "C-017", page: ComposerPage },
    { id: "text-field", label: "Text field", number: "C-018", page: TextFieldPage },
    { id: "select", label: "Select", number: "C-019", page: SelectPage },
    { id: "switch", label: "Switch", number: "C-020", page: SwitchPage },
    { id: "spinner", label: "Spinner", number: "C-160", page: SpinnerPage },
    { id: "checkbox", label: "Checkbox", number: "C-021", page: CheckboxPage },
    {
        id: "segmented-control",
        label: "Segmented control",
        number: "C-022",
        page: SegmentedControlPage,
    },
    { id: "banner", label: "Banner", number: "C-023", page: BannerPage },
    {
        id: "port-share-control",
        label: "Port share control",
        number: "C-080",
        page: PortShareControlPage,
    },
    { id: "empty-state", label: "Empty state", number: "C-024", page: EmptyStatePage },
    { id: "tabs", label: "Tabs", number: "C-025", page: TabsPage },
    { id: "tabbed-pane", label: "Tabbed pane", number: "C-160", page: TabbedPanePage },
    { id: "toolbar", label: "Toolbar", number: "C-026", page: ToolbarPage },
    { id: "menu", label: "Menu", number: "C-027", page: MenuPage },
    { id: "modal", label: "Modal", number: "C-028", page: ModalPage },
    { id: "form-row", label: "Form row", number: "C-029", page: FormRowPage },
    { id: "data-table", label: "Data table", number: "C-030", page: DataTablePage },
    { id: "stat-tile", label: "Stat tile", number: "C-031", page: StatTilePage },
    { id: "auth-screen", label: "Auth screen", number: "C-032", page: AuthScreenPage },
    { id: "profile-card", label: "Profile card", number: "C-033", page: ProfileCardPage },
    { id: "status-picker", label: "Status picker", number: "C-034", page: StatusPickerPage },
    {
        id: "notification-list",
        label: "Notification list",
        number: "C-035",
        page: NotificationListPage,
    },
    { id: "search-results", label: "Search results", number: "C-036", page: SearchResultsPage },
    { id: "media-gallery", label: "Media gallery", number: "C-038", page: MediaGalleryPage },
    { id: "member-list", label: "Member list", number: "C-039", page: MemberListPage },
    { id: "call-panel", label: "Call panel", number: "C-040", page: CallPanelPage },
    { id: "policy-control", label: "Policy control", number: "C-041", page: PolicyControlPage },
    { id: "secret-reveal", label: "Secret reveal", number: "C-042", page: SecretRevealPage },
    { id: "emoji-picker", label: "Emoji picker", number: "C-043", page: EmojiPickerPage },
    { id: "automation-card", label: "Automation card", number: "C-044", page: AutomationCardPage },
    {
        id: "moderation-report-card",
        label: "Moderation report card",
        number: "C-045",
        page: ModerationReportCardPage,
    },
    { id: "lightbox", label: "Lightbox", number: "C-046", page: LightboxPage },
    { id: "info-panel", label: "Info panel", number: "C-047", page: InfoPanelPage },
    { id: "file-attachment", label: "File attachment", number: "C-049", page: FileAttachmentPage },
    {
        id: "agent-image-panel",
        label: "Agent image panel",
        number: "C-050",
        page: AgentImagePanelPage,
    },
    {
        id: "agent-image-detail",
        label: "Agent image detail",
        number: "C-051",
        page: AgentImageDetailPage,
    },
    { id: "file-tree", label: "File tree", number: "C-052", page: FileTreePage },
    { id: "file-panel", label: "File panel", number: "C-053", page: FilePanelPage },
    { id: "file-editor", label: "File editor", number: "C-054", page: FileEditorPage },
    {
        id: "agent-secret-panel",
        label: "Agent secret panel",
        number: "C-055",
        page: AgentSecretPanelPage,
    },
    {
        id: "agent-secret-detail",
        label: "Agent secret detail",
        number: "C-056",
        page: AgentSecretDetailPage,
    },
    { id: "fade", label: "Fade", number: "C-057", page: FadePage },
    { id: "modal-overlay", label: "Modal overlay", number: "C-058", page: ModalOverlayPage },
    { id: "command-palette", label: "Command palette", number: "C-060", page: CommandPalettePage },
    {
        id: "onboarding-screen",
        label: "Onboarding screen",
        number: "C-061",
        page: OnboardingScreenPage,
    },
    {
        id: "splash-screen",
        label: "Splash screen",
        number: "C-161",
        page: SplashScreenPage,
    },
    {
        id: "split-column",
        label: "Split column",
        number: "C-163",
        page: SplitColumnPage,
    },
    {
        id: "setup-option-card",
        label: "Setup option card",
        number: "C-062",
        page: SetupOptionCardPage,
    },
    {
        id: "build-progress-panel",
        label: "Build progress panel",
        number: "C-063",
        page: BuildProgressPanelPage,
    },
    {
        id: "default-agent-form",
        label: "Default agent form",
        number: "C-064",
        page: DefaultAgentFormPage,
    },
    {
        id: "audience-toggle",
        label: "Audience toggle",
        number: "C-065",
        page: AudienceTogglePage,
    },
    {
        id: "build-identity-pill",
        label: "Build identity pill",
        number: "C-177",
        page: BuildIdentityPillPage,
    },
    {
        id: "plugin-catalog-panel",
        label: "Plugin catalog panel",
        number: "C-066",
        page: PluginCatalogPanelPage,
    },
    {
        id: "permission-checklist",
        label: "Permission checklist",
        number: "C-067",
        page: PermissionChecklistPage,
    },
    { id: "roles-panel", label: "Roles panel", number: "C-068", page: RolesPanelPage },
    { id: "role-editor", label: "Role editor", number: "C-069", page: RoleEditorPage },
    {
        id: "member-access-panel",
        label: "Member access panel",
        number: "C-070",
        page: MemberAccessPanelPage,
    },
    {
        id: "development-token-modal",
        label: "Development token modal",
        number: "C-071",
        page: DevelopmentTokenModalPage,
    },
    {
        id: "agent-working-status",
        label: "Agent working status",
        number: "C-072",
        page: AgentWorkingStatusPage,
    },
    {
        id: "agent-trace-row",
        label: "Agent trace row",
        number: "C-073",
        page: AgentTraceRowPage,
    },
    {
        id: "agent-trace-panel",
        label: "Agent trace panel",
        number: "C-074",
        page: AgentTracePanelPage,
    },
    {
        id: "plugin-install-dialog",
        label: "Plugin install dialog",
        number: "C-075",
        page: PluginInstallDialogPage,
    },
    {
        id: "plugin-uninstall-dialog",
        label: "Plugin uninstall dialog",
        number: "C-076",
        page: PluginUninstallDialogPage,
    },
    {
        id: "plugin-permission-card",
        label: "Plugin permission card",
        number: "C-077",
        page: PluginPermissionCardPage,
    },
    {
        id: "plugin-diagnostics-viewer",
        label: "Plugin diagnostics viewer",
        number: "C-069",
        page: PluginDiagnosticsViewerPage,
    },
    { id: "mcp-app-shell", label: "MCP app shell", number: "C-080", page: McpAppShellPage },
];
const fullScreens: BlueprintPage[] = [
    { id: "settings-store", label: "Settings", number: "P-001", page: SettingsStorePage },
    {
        id: "rig-settings",
        label: "Rig settings",
        number: "P-012",
        page: RigSettingsBlueprintPage,
    },
    { id: "chat-store", label: "Chat", number: "P-002", page: ChatStorePage },
    {
        id: "home-store",
        label: "Home",
        number: "P-003",
        page: () => <ProductStorePage kind="home" />,
    },
    {
        id: "activity-store",
        label: "Activity",
        number: "P-004",
        page: () => <ProductStorePage kind="activity" />,
    },
    {
        id: "calls-store",
        label: "Calls",
        number: "P-006",
        page: () => <ProductStorePage kind="calls" />,
    },
    {
        id: "files-store",
        label: "Files",
        number: "P-007",
        page: () => <ProductStorePage kind="files" />,
    },
    {
        id: "search-store",
        label: "Search",
        number: "P-008",
        page: () => <ProductStorePage kind="search" />,
    },
    {
        id: "admin-store",
        label: "Admin",
        number: "P-009",
        page: () => <ProductStorePage kind="admin" />,
    },
    {
        id: "agent-images-store",
        label: "Agent images",
        number: "P-010",
        page: () => <ProductStorePage kind="agent-images" />,
    },
    {
        id: "agent-secrets-store",
        label: "Agent secrets",
        number: "P-011",
        page: () => <ProductStorePage kind="agent-secrets" />,
    },
    { id: "rig-inbox", label: "Rig inbox", number: "P-013", page: RigInboxBlueprintPage },
    { id: "friends", label: "Friends", number: "P-014", page: FriendsBlueprintPage },
    {
        id: "rig-provider-usage",
        label: "Provider usage",
        number: "P-015",
        page: RigProviderUsageBlueprintPage,
    },
    {
        id: "rig-plugin-application",
        label: "Plugin application",
        number: "P-016",
        page: RigPluginApplicationBlueprintPage,
    },
];
const pageNumberCompare = (left: BlueprintPage, right: BlueprintPage) =>
    left.number.localeCompare(right.number, undefined, { numeric: true });
const componentOptions = [...components].sort(pageNumberCompare);
const fullScreenOptions = [...fullScreens].sort(pageNumberCompare);
const pages = [...components, ...fullScreens];
function componentFromHash(): string {
    const id = window.location.hash.slice(1).toLowerCase();
    return pages.some((page) => page.id === id) ? id : "icon";
}
export interface WorkbenchProps {
    /**
     * Whether the browser hash names the open page. The standalone Blueprint owns
     * its document, so its address is the hash. A workbench mounted inside the
     * application does not: that window's address belongs to its own router, so
     * there the open page is only this component's own selection.
     */
    readonly hashAddressed?: boolean;
}

/**
 * The Blueprint workbench: the component index, its selector, and the active page.
 * It lives here rather than in the dev entry so the application can mount the same
 * workbench in a development-only screen.
 */
export function Workbench(props: WorkbenchProps = {}) {
    const hashAddressed = props.hashAddressed ?? true;
    const [active, setActive] = useState(hashAddressed ? componentFromHash() : "icon");
    /* "system" applies no theme class, so the workbench keeps whatever appearance
       its host already has — the OS scheme standalone, the app's own selection
       when embedded — until a reviewer deliberately pins light or dark. */
    const [appearance, setAppearance] = useState<ThemeMode>("system");
    const syncHash = () => setActive(componentFromHash());
    // eslint-disable-next-line happy2-react/no-layout-effect -- the standalone Blueprint route is driven by the browser hash, so this mounted workbench owns one hashchange listener with complete cleanup
    useLayoutEffect(() => {
        if (!hashAddressed) return;
        window.addEventListener("hashchange", syncHash);
        return () => window.removeEventListener("hashchange", syncHash);
    });
    const selectComponent = (id: string) => {
        if (hashAddressed) window.location.hash = id;
        setActive(id);
    };
    const brandContent = (
        <>
            <span>
                <Icon name="star" size={14} />
            </span>
            <strong>happy2-ui</strong>
            <i>component plans</i>
        </>
    );
    return (
        <ThemeScope mode={appearance}>
            <div className="workbench-shell">
                <header className="workbench-header">
                    {/* Standalone, the mark is the address of the first page. Embedded,
                        the address belongs to the app's router, so the same mark has to
                        be a real button rather than an anchor with no href, which no
                        keyboard could reach. */}
                    {hashAddressed ? (
                        <a aria-label="happy2-ui home" className="workbench-brand" href="#icon">
                            {brandContent}
                        </a>
                    ) : (
                        <button
                            aria-label="happy2-ui home"
                            className="workbench-brand"
                            onClick={() => selectComponent("icon")}
                            type="button"
                        >
                            {brandContent}
                        </button>
                    )}
                    <div className="header-axis" aria-hidden="true">
                        <i />
                        <span>16 px minor · 80 px major</span>
                        <i />
                    </div>
                    <div
                        aria-label="Blueprint appearance"
                        className="workbench-appearance"
                        role="group"
                    >
                        <span>Appearance</span>
                        <SegmentedControl
                            onChange={(value) => setAppearance(value as ThemeMode)}
                            segments={[
                                { value: "system", label: "Auto" },
                                { value: "light", label: "Light", icon: "sun" },
                                { value: "dark", label: "Dark", icon: "moon" },
                            ]}
                            size="small"
                            value={appearance}
                        />
                    </div>
                    <label className="component-select">
                        <span>Page</span>
                        <span className="component-select-field">
                            <select
                                aria-label="Open component page"
                                value={active}
                                onInput={(event) => selectComponent(event.currentTarget.value)}
                            >
                                <optgroup label="Components">
                                    {componentOptions.map((component) => (
                                        <option key={component.id} value={component.id}>
                                            {component.number} · {component.label}
                                        </option>
                                    ))}
                                </optgroup>
                                {fullScreenOptions.length > 0 ? (
                                    <optgroup label="Full screens">
                                        {fullScreenOptions.map((screen) => (
                                            <option key={screen.id} value={screen.id}>
                                                {screen.number} · {screen.label}
                                            </option>
                                        ))}
                                    </optgroup>
                                ) : null}
                            </select>
                            <span className="component-select-chevron">
                                <Icon name="chevron-down" size={14} />
                            </span>
                        </span>
                    </label>
                </header>
                <div className="blueprint-field">
                    {pages.map(({ id, page: Page }) =>
                        active === id ? (
                            <Fragment key={id}>
                                <Page />
                            </Fragment>
                        ) : null,
                    )}
                </div>
            </div>
        </ThemeScope>
    );
}
