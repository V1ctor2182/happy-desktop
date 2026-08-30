use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use gpui::{
    AnyElement, App, Context, Entity, EntityInputHandler, FocusHandle, Focusable, Image,
    ImageFormat, IntoElement, PathPromptOptions, Render, SharedString, Subscription, Window, div,
    prelude::*, px,
};

use crate::{
    chat::{
        AgentAvailability as ChatAvailability, AsyncActionState, AttachmentId, AttachmentRejection,
        AttachmentState, ChatMutationId, ChatSnapshot, ChatStore, ChatTranscriptBlockKind,
        ChatTranscriptMessageRole, ChatTranscriptRowId as ProductRowId, ChatTranscriptRowKind,
        ClientConversationId, ClientMessageId, FileTabKey, FileTabPresentation, HistoryPage,
        InlineImageAttachment, LoadState, MutationId, OperationState, ScrollAnchor,
        TranscriptRowId, WorkspaceBehavior, WorkspaceStore, WorkspaceTab, transcript_project,
    },
    connectivity::{
        AgentStatus, CatalogConversationStatus, ConnectivityController, ConversationKey,
        CreatedChatNavigation, WorkspaceKey,
        chat_protocol::{
            BackgroundProcessStatus, CompactionBlock as ProtocolCompaction, Message, MessageBlock,
            MessageDelivery as ProtocolDelivery, MessageMetadata, MessagePermissionMode,
            QuestionStatus, RunStatus, ToolCallStatus, ToolPermissionReview, UnprovenReviewKind,
            UserMessage, UserMessageStatus,
        },
    },
    fonts,
    theme::Theme,
    ui::{
        Button, ButtonVariant, ControlSize, IconName, ScrollbarAppearance, ScrollbarPlacement,
        ScrollbarState,
        chat_composer::{
            ComposerCard, ComposerDock, ComposerFailureBanner, ComposerToolbarFocusTarget,
            ComposerToolbarItem,
        },
        chat_header::{
            ProjectHeader as ChatHeader, ProjectHeaderAction, ProjectHeaderStatus,
            ProjectStatusTone,
        },
        chat_markdown::{MarkdownDocument, MarkdownLinkActivate, MarkdownLinkTarget},
        chat_message::{
            ChatImageActivate, ChatImageBlock, ChatMessageBlock, ChatMessageModel, CompactionBlock,
            DelegationRowModel, GenericQuestion, InlineImageLightbox, MessageDelivery,
            MessageGeneration, MessageRole, NoticeRowModel, ProcessRowModel, QuestionOption,
            QuestionRowModel, ReasoningBlock, SemanticTone, StatusRowModel, ToolBlock,
            ToolPresentation, ToolReview, ToolReviewStatus, ToolStatus,
        },
        chat_transcript::{
            ChatTranscript, ChatTranscriptContent, ChatTranscriptEvent, ChatTranscriptRow,
            ChatTranscriptState, TranscriptAnchor,
        },
        composer_controls::{
            AUDIENCE_UNAVAILABLE_WIDTH, AttachmentKind, AttachmentPreviewItem, AttachmentPreviews,
            AudienceControl, COMPACT_CONTROL_WIDTH, CONTEXT_METER_WIDTH, CommandPicker,
            CommandPickerItem, ContextMeter, EmojiItem, EmojiPicker, MODEL_EFFORT_CONTROL_WIDTH,
            ModelEffortControl, PermissionControl, TierControl,
        },
        scrollbar::SharedScrollHandle,
        text_area::{TextArea, TextAreaCommand, TextAreaCommandHandler, TextAreaEvent},
        theme_roles::ThemeRole,
        workspace_lifecycle::{
            WorkspaceLifecycleLane, WorkspaceLifecycleNotice, WorkspaceLifecycleNoticeSize,
            WorkspaceLifecyclePhase,
        },
        workspace_tabs::{
            RecentSessionItem, RecentSessionsAffordance, WorkspaceCreateAffordance,
            WorkspaceTabItem, WorkspaceTabKind, WorkspaceTabMove, WorkspaceTabs,
        },
    },
};

use crate::{files::RelativeFilePath, navigation::FileKind};

use super::FilesInspectorSurface;

/// A route transition requested by a retained workspace surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatWorkspaceNavigation {
    Conversation(CreatedChatNavigation),
    Workspace(WorkspaceKey),
    WorkspaceTab {
        workspace: WorkspaceKey,
        tab: WorkspaceTab,
    },
    File {
        workspace: WorkspaceKey,
        path: RelativeFilePath,
        kind: FileKind,
    },
    FilePreview {
        workspace: WorkspaceKey,
        conversation: Option<ConversationKey>,
        path: RelativeFilePath,
    },
}

pub type ChatWorkspaceNavigationHandler = Rc<dyn Fn(ChatWorkspaceNavigation, &mut App)>;

/// Caller-owned display facts. They are reconciled without replacing the surface entity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatWorkspaceLabels {
    pub workspace_name: SharedString,
    pub workspace_location: Option<SharedString>,
}

impl ChatWorkspaceLabels {
    pub fn new(name: impl Into<SharedString>, location: Option<SharedString>) -> Self {
        Self {
            workspace_name: name.into(),
            workspace_location: location,
        }
    }
}

/// Route-local catalog and connectivity facts which can change without remounting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatWorkspaceCatalogFacts {
    pub unavailable_reason: Option<SharedString>,
    pub lifecycle: WorkspaceLifecyclePhase,
    pub lifecycle_detail: Option<SharedString>,
}

impl Default for ChatWorkspaceCatalogFacts {
    fn default() -> Self {
        Self {
            unavailable_reason: None,
            lifecycle: WorkspaceLifecyclePhase::Ready,
            lifecycle_detail: None,
        }
    }
}

fn reveal_horizontal_focus(
    scroll: &gpui::ScrollHandle,
    left: f32,
    right: f32,
    focus: &FocusHandle,
    window: &mut Window,
) {
    let viewport_width = f32::from(scroll.bounds().size.width);
    let visible_left = f32::from(-scroll.offset().x);
    let next_left = if left < visible_left {
        Some(left)
    } else if right > visible_left + viewport_width {
        Some((right - viewport_width).max(0.0))
    } else {
        None
    };
    if let Some(next_left) = next_left {
        scroll.set_offset(gpui::point(px(-next_left), scroll.offset().y));
    }
    focus.focus(window);
    window.refresh();
}

#[derive(Clone)]
struct AttachmentActionFocus {
    open: FocusHandle,
    remove: FocusHandle,
    retry: FocusHandle,
}

#[derive(Clone)]
struct ToolbarFocus {
    attach: FocusHandle,
    model: FocusHandle,
    effort: FocusHandle,
    permission: FocusHandle,
    tier: FocusHandle,
    audience: FocusHandle,
    emoji: FocusHandle,
    submit: FocusHandle,
}

struct ConversationUi {
    composer: Entity<TextArea>,
    transcript: Entity<TranscriptEntity>,
    transcript_focus: FocusHandle,
    question_inputs: BTreeMap<Arc<str>, Entity<TextArea>>,
    question_input_subscriptions: BTreeMap<Arc<str>, Subscription>,
    command_picker_focus: FocusHandle,
    command_picker_active: usize,
    command_picker_dismissed: bool,
    emoji_picker_focus: FocusHandle,
    emoji_picker_active: usize,
    row_cache: Rc<RefCell<BTreeMap<String, (u64, ChatTranscriptRow)>>>,
    history_revision_cache: Rc<RefCell<HistoryRevisionCache>>,
    attachment_horizontal_scrollbar: Entity<ScrollbarState>,
    attachment_vertical_scrollbar: Entity<ScrollbarState>,
    toolbar_scrollbar: Entity<ScrollbarState>,
    attachment_action_focus: BTreeMap<AttachmentId, AttachmentActionFocus>,
    toolbar_focus: ToolbarFocus,
    _subscriptions: Vec<Subscription>,
}

#[derive(Default)]
struct HistoryRevisionCache {
    pages: BTreeMap<usize, CachedHistoryPage>,
    messages: BTreeMap<usize, CachedMessageRevision>,
    pending_messages: BTreeMap<usize, CachedPendingMessageRevision>,
}

struct CachedHistoryPage {
    page: Arc<HistoryPage>,
    message_revisions: Arc<BTreeMap<String, u64>>,
}

struct CachedMessageRevision {
    message: Arc<Message>,
    revision: u64,
}

struct CachedPendingMessageRevision {
    message: Arc<UserMessage>,
    revision: u64,
}

const MAX_LOCAL_ATTACHMENT_PREVIEWS: usize = 32;
const MAX_DECODED_IMAGE_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_DECODED_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DECODED_TRANSCRIPT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DECODED_LOCAL_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DECODED_TRANSCRIPT_IMAGES: usize = 256;
const MAX_REJECTED_TRANSCRIPT_IMAGES: usize = 512;
const MAX_LOCAL_ATTACHMENT_FILES: usize = MAX_LOCAL_ATTACHMENT_PREVIEWS - 1;

#[derive(Clone)]
struct LocalAttachmentPreview {
    id: AttachmentId,
    name: Arc<str>,
    path: PathBuf,
    image: Option<Arc<Image>>,
    decoded_bytes: u64,
    failure: Option<Arc<str>>,
    omitted_count: usize,
}

fn omitted_attachment_record(
    items: &mut BTreeMap<AttachmentId, LocalAttachmentPreview>,
    omitted: usize,
) {
    if let Some(preview) = items.values_mut().find(|preview| preview.omitted_count > 0) {
        preview.omitted_count = preview.omitted_count.saturating_add(omitted);
        preview.name = Arc::from(format!(
            "{} image selections omitted",
            preview.omitted_count
        ));
        preview.failure = Some(Arc::from(format!(
            "Only {MAX_LOCAL_ATTACHMENT_FILES} local image previews can be retained; {} selections were omitted.",
            preview.omitted_count
        )));
        return;
    }
    let id = AttachmentId::new(format!("omitted-{}", cuid2::create_id()))
        .expect("generated attachment id is nonempty");
    items.insert(
        id.clone(),
        LocalAttachmentPreview {
            id,
            name: Arc::from(format!("{omitted} image selections omitted")),
            path: PathBuf::new(),
            image: None,
            decoded_bytes: 0,
            failure: Some(Arc::from(format!(
                "Only {MAX_LOCAL_ATTACHMENT_FILES} local image previews can be retained; {omitted} selections were omitted."
            ))),
            omitted_count: omitted,
        },
    );
}

#[derive(Clone)]
struct OpenedInlineImage {
    id: SharedString,
    alt: SharedString,
    image: Arc<Image>,
}

fn rejected_image_record(rejected: &mut BTreeSet<String>, id: String) {
    if rejected.len() >= MAX_REJECTED_TRANSCRIPT_IMAGES
        && let Some(oldest) = rejected.first().cloned()
    {
        rejected.remove(&oldest);
    }
    rejected.insert(id);
}

#[derive(Clone)]
struct DecodedInlineImage {
    image: Arc<Image>,
    width: u32,
    height: u32,
    decoded_bytes: u64,
}

struct TranscriptEntity {
    id: SharedString,
    theme: Theme,
    state: ChatTranscriptState,
    scrollbar: Entity<ScrollbarState>,
    rows: Rc<Vec<ChatTranscriptRow>>,
    focus: FocusHandle,
}

impl Render for TranscriptEntity {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        ChatTranscript {
            id: self.id.clone(),
            theme: self.theme,
            state: self.state.clone(),
            scrollbar: self.scrollbar.clone(),
            rows: self.rows.clone(),
            focus: Some(self.focus.clone()),
        }
    }
}

/// One stable project/worktree chat surface.
///
/// It owns one workspace observation for its whole life and exactly one chat observation for the
/// currently focused conversation. Local editor and transcript entities are retained by
/// conversation key, so route and availability changes do not discard drafts, selection, focus,
/// or scroll identity.
pub struct ChatWorkspaceSurface {
    connectivity: Entity<ConnectivityController>,
    workspace_key: WorkspaceKey,
    workspace: Entity<WorkspaceStore>,
    files: Entity<FilesInspectorSurface>,
    desired_conversation: Option<ConversationKey>,
    desired_file: Option<(RelativeFilePath, FileKind)>,
    focused_conversation: Option<ConversationKey>,
    active: bool,
    theme: Theme,
    labels: ChatWorkspaceLabels,
    catalog_facts: ChatWorkspaceCatalogFacts,
    on_navigate: ChatWorkspaceNavigationHandler,
    link_open: MarkdownLinkActivate,
    recent_open: bool,
    pending_restore: Option<ConversationKey>,
    tabs_scrollbar: Entity<ScrollbarState>,
    recent_scrollbar: Entity<ScrollbarState>,
    emoji_open: BTreeSet<ConversationKey>,
    mutation_serial: u64,
    persistence_error: Option<Arc<str>>,
    inspector_visible: bool,
    ui: BTreeMap<ConversationKey, ConversationUi>,
    images: RefCell<BTreeMap<String, DecodedInlineImage>>,
    rejected_images: RefCell<BTreeSet<String>>,
    opened_image: Option<OpenedInlineImage>,
    image_return_focus: Option<FocusHandle>,
    image_overlay_focus: FocusHandle,
    image_close_focus: FocusHandle,
    local_attachments: BTreeMap<ConversationKey, BTreeMap<AttachmentId, LocalAttachmentPreview>>,
    _workspace_subscription: Subscription,
    chat_subscription: Option<Subscription>,
}

impl ChatWorkspaceSurface {
    /// Shell integration constructor. Call it inside `cx.new`.
    pub fn new(
        connectivity: Entity<ConnectivityController>,
        workspace_key: WorkspaceKey,
        files: Entity<FilesInspectorSurface>,
        desired_conversation: Option<ConversationKey>,
        desired_file: Option<(RelativeFilePath, FileKind)>,
        theme: Theme,
        labels: ChatWorkspaceLabels,
        catalog_facts: ChatWorkspaceCatalogFacts,
        on_navigate: ChatWorkspaceNavigationHandler,
        cx: &mut Context<Self>,
    ) -> Self {
        let workspace = connectivity
            .update(cx, |controller, cx| {
                controller.workspace_materialize(workspace_key.clone(), cx)
            })
            .expect("workspace namespace must belong to the controller");
        let workspace_subscription = cx.observe(&workspace, |this, workspace, cx| {
            if let Some(error) = workspace.update(cx, |store, _| store.take_persistence_error()) {
                this.persistence_error = Some(error);
            }
            let (restored, restore_failed) = this
                .pending_restore
                .as_ref()
                .map(|key| {
                    let snapshot = workspace.read(cx).snapshot();
                    (
                        snapshot
                            .tabs
                            .contains(&WorkspaceTab::Conversation(key.clone()))
                            && !snapshot.session_archive.contains_key(key),
                        snapshot.session_archive.get(key).is_some_and(|operation| {
                            matches!(operation.state, AsyncActionState::Failed { .. })
                        }),
                    )
                })
                .unwrap_or((false, false));
            if restore_failed {
                this.pending_restore = None;
            } else if restored && let Some(conversation) = this.pending_restore.take() {
                (this.on_navigate)(
                    ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                        workspace: this.workspace_key.clone(),
                        conversation,
                    }),
                    cx,
                );
            }
            this.route_reconcile(cx);
            cx.notify();
        });
        let tabs_scrollbar = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let recent_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let link_surface = cx.entity();
        let link_open: MarkdownLinkActivate = Rc::new(move |target, _window, cx| match target {
            MarkdownLinkTarget::Http(url) => cx.open_url(url.as_ref()),
            MarkdownLinkTarget::WorkspaceRelative(path) => {
                if let Ok(path) = RelativeFilePath::parse(path.as_ref()) {
                    link_surface.update(cx, |this, cx| {
                        (this.on_navigate)(
                            ChatWorkspaceNavigation::FilePreview {
                                workspace: this.workspace_key.clone(),
                                conversation: this.focused_conversation.clone(),
                                path,
                            },
                            cx,
                        );
                    });
                }
            }
            MarkdownLinkTarget::SameDocumentAnchor(_) => {}
        });
        let mut this = Self {
            connectivity,
            workspace_key,
            workspace,
            files,
            desired_conversation,
            desired_file,
            focused_conversation: None,
            active: true,
            theme,
            labels,
            catalog_facts,
            on_navigate,
            link_open,
            recent_open: false,
            pending_restore: None,
            tabs_scrollbar,
            recent_scrollbar,
            emoji_open: BTreeSet::new(),
            mutation_serial: 0,
            persistence_error: None,
            inspector_visible: true,
            ui: BTreeMap::new(),
            images: RefCell::new(BTreeMap::new()),
            rejected_images: RefCell::new(BTreeSet::new()),
            opened_image: None,
            image_return_focus: None,
            image_overlay_focus: cx.focus_handle().tab_index(0).tab_stop(false),
            image_close_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            local_attachments: BTreeMap::new(),
            _workspace_subscription: workspace_subscription,
            chat_subscription: None,
        };
        this.route_reconcile(cx);
        this
    }

    /// Reconcile route, appearance, and caller-authored labels in place.
    pub fn reconcile(
        &mut self,
        desired_conversation: Option<ConversationKey>,
        desired_file: Option<(RelativeFilePath, FileKind)>,
        theme: Theme,
        labels: ChatWorkspaceLabels,
        catalog_facts: ChatWorkspaceCatalogFacts,
        cx: &mut Context<Self>,
    ) {
        if self.desired_conversation == desired_conversation
            && self.desired_file == desired_file
            && self.theme == theme
            && self.labels == labels
            && self.catalog_facts == catalog_facts
        {
            return;
        }
        self.desired_conversation = desired_conversation;
        self.desired_file = desired_file;
        if self.theme != theme {
            self.theme = theme;
            for ui in self.ui.values() {
                ui.composer
                    .update(cx, |area, cx| area.theme_reconcile(theme, cx));
                for input in ui.question_inputs.values() {
                    input.update(cx, |area, cx| area.theme_reconcile(theme, cx));
                }
                ui.transcript.update(cx, |transcript, cx| {
                    transcript.theme = theme;
                    cx.notify();
                });
            }
        }
        self.labels = labels;
        self.catalog_facts = catalog_facts;
        self.route_reconcile(cx);
        cx.notify();
    }

    /// Reconciles whether this retained workspace is the shell's visible lifetime.
    /// Deactivation drops only the focused product-store observation. It deliberately does not
    /// call the controller's global unfocus because the newly active workspace owns that decision.
    pub fn active_reconcile(&mut self, active: bool, cx: &mut Context<Self>) {
        if self.active == active {
            return;
        }
        self.active = active;
        self.files
            .update(cx, |files, cx| files.workspace_active_reconcile(active, cx));
        if active {
            self.route_reconcile(cx);
        } else {
            self.chat_subscription = None;
            self.focused_conversation = None;
            cx.notify();
        }
    }

    /// Reapply the semantic transcript anchor after composer or surrounding viewport resize.
    pub fn viewport_resized(&mut self, cx: &mut Context<Self>) {
        let Some(key) = self.focused_conversation.as_ref() else {
            return;
        };
        let Some(ui) = self.ui.get(key) else {
            return;
        };
        ui.transcript.read(cx).state.composer_resized();
    }

    pub fn workspace_key(&self) -> &WorkspaceKey {
        &self.workspace_key
    }

    pub fn workspace_store(&self) -> &Entity<WorkspaceStore> {
        &self.workspace
    }

    pub fn files_inspector(&self) -> Entity<FilesInspectorSurface> {
        self.files.clone()
    }
    pub fn inspector_reveal(&mut self, cx: &mut Context<Self>) {
        if !self.inspector_visible {
            self.inspector_visible = true;
            self.files
                .update(cx, |files, cx| files.inspector_visible_reconcile(true, cx));
            cx.notify();
        }
    }
    pub fn file_preview_reconcile(
        &mut self,
        path: RelativeFilePath,
        ephemeral: bool,
        cx: &mut Context<Self>,
    ) {
        let key = FileTabKey::from_path(path);
        let old = self
            .workspace
            .read(cx)
            .snapshot()
            .ephemeral_file_tab
            .clone();
        if ephemeral && old.as_ref() != Some(&key) {
            if let Some(old) = old {
                let dirty = self
                    .files
                    .read(cx)
                    .document(old.path())
                    .is_some_and(|doc| doc.read(cx).dirty(cx));
                if !dirty {
                    self.workspace.update(cx, |store, cx| {
                        store.tab_close(&WorkspaceTab::File(old));
                        cx.notify();
                    });
                }
            }
        }
        let path = key.path().clone();
        let presentation = self
            .workspace
            .read(cx)
            .snapshot()
            .file_tab_presentations
            .get(&key)
            .copied()
            .unwrap_or_default();
        let kind = if presentation == FileTabPresentation::Diff {
            FileKind::Diff
        } else {
            FileKind::File
        };
        self.workspace.update(cx, |store, cx| {
            store.file_tab_preview_update(ephemeral.then_some(key));
            cx.notify();
        });
        self.files.update(cx, |files, cx| {
            files.main_file_kind_reconcile(path, kind, ephemeral, cx)
        });
    }

    pub fn inspector_visible(&self) -> bool {
        self.inspector_visible
    }

    pub fn focused_chat_store(&self, cx: &App) -> Option<Entity<ChatStore>> {
        self.focused_conversation
            .as_ref()
            .and_then(|key| self.connectivity.read(cx).chat(key, cx))
    }

    fn navigate_after_update(&self, navigation: ChatWorkspaceNavigation, cx: &mut Context<Self>) {
        let on_navigate = self.on_navigate.clone();
        cx.defer(move |cx| on_navigate(navigation, cx));
    }

    fn open_file_tab(&mut self, path: RelativeFilePath, cx: &mut Context<Self>) -> bool {
        let tab = WorkspaceTab::File(FileTabKey::from_path(path.clone()));
        let snapshot = self.workspace.read(cx).snapshot().clone();
        if snapshot.tabs.contains(&tab) {
            self.files.update(cx, |files, cx| {
                files.document_materialize(path, cx);
            });
            if snapshot.active_tab.as_ref() != Some(&tab) {
                self.workspace.update(cx, |store, cx| {
                    store.tab_activate(&tab);
                    cx.notify();
                });
            }
            return true;
        }
        let file_count = snapshot
            .tabs
            .iter()
            .filter(|tab| matches!(tab, WorkspaceTab::File(_)))
            .count();
        if file_count >= 20 {
            let clean_lru =
                snapshot
                    .activation_history
                    .iter()
                    .find_map(|candidate| match candidate {
                        WorkspaceTab::File(key) => {
                            let dirty = self
                                .files
                                .read(cx)
                                .document(key.path())
                                .is_some_and(|doc| doc.read(cx).dirty(cx));
                            (!dirty).then(|| candidate.clone())
                        }
                        _ => None,
                    });
            let Some(clean_lru) = clean_lru else {
                self.persistence_error = Some(Arc::from(
                    "All 20 file tabs have unsaved changes. Close or save one before opening another.",
                ));
                cx.notify();
                return false;
            };
            self.workspace.update(cx, |store, cx| {
                store.tab_close(&clean_lru);
                cx.notify();
            });
        }
        self.files.update(cx, |files, cx| {
            files.document_materialize(path, cx);
        });
        self.workspace.update(cx, |store, cx| {
            store.tab_open(tab);
            cx.notify();
        });
        true
    }

    fn route_reconcile(&mut self, cx: &mut Context<Self>) {
        if !self.active {
            return;
        }
        if let Some((path, kind)) = self.desired_file.clone() {
            if self.open_file_tab(path.clone(), cx) {
                let key = FileTabKey::from_path(path.clone());
                let presentation = if kind == FileKind::Diff {
                    FileTabPresentation::Diff
                } else {
                    FileTabPresentation::File
                };
                let presentation_changed = self
                    .workspace
                    .read(cx)
                    .snapshot()
                    .file_tab_presentations
                    .get(&key)
                    .copied()
                    .unwrap_or_default()
                    != presentation;
                if presentation_changed {
                    self.workspace.update(cx, |store, cx| {
                        store.file_tab_presentation_update(key, presentation);
                        cx.notify();
                    });
                }
                self.files.update(cx, |files, cx| {
                    files.main_file_kind_reconcile(path, kind, false, cx)
                });
            } else {
                self.desired_file = None;
                match self.workspace.read(cx).snapshot().active_tab.clone() {
                    Some(WorkspaceTab::Conversation(conversation)) => (self.on_navigate)(
                        ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                            workspace: self.workspace_key.clone(),
                            conversation,
                        }),
                        cx,
                    ),
                    Some(WorkspaceTab::File(key)) => {
                        let fallback_kind = self
                            .workspace
                            .read(cx)
                            .snapshot()
                            .file_tab_presentations
                            .get(&key)
                            .copied()
                            .map(|value| {
                                if value == FileTabPresentation::Diff {
                                    FileKind::Diff
                                } else {
                                    FileKind::File
                                }
                            })
                            .unwrap_or(FileKind::File);
                        (self.on_navigate)(
                            ChatWorkspaceNavigation::File {
                                workspace: self.workspace_key.clone(),
                                path: key.path().clone(),
                                kind: fallback_kind,
                            },
                            cx,
                        );
                    }
                    Some(tab @ WorkspaceTab::Tool(_)) => (self.on_navigate)(
                        ChatWorkspaceNavigation::WorkspaceTab {
                            workspace: self.workspace_key.clone(),
                            tab,
                        },
                        cx,
                    ),
                    None => (self.on_navigate)(
                        ChatWorkspaceNavigation::Workspace(self.workspace_key.clone()),
                        cx,
                    ),
                }
            }
        }
        let snapshot = self.workspace.read(cx).snapshot().clone();
        let main_paths = snapshot
            .tabs
            .iter()
            .filter_map(|tab| match tab {
                WorkspaceTab::File(key) => Some(key.path().clone()),
                _ => None,
            })
            .collect();
        let visible_main = match snapshot.active_tab.as_ref() {
            Some(WorkspaceTab::File(key)) => Some(key.path().clone()),
            _ => None,
        };
        self.files.update(cx, |files, cx| {
            files.main_paths_reconcile(main_paths, visible_main, cx)
        });
        let target =
            self.desired_conversation
                .clone()
                .or_else(|| match snapshot.active_tab.as_ref() {
                    Some(WorkspaceTab::Conversation(key)) => Some(key.clone()),
                    _ => None,
                });
        if let Some(key) = target.clone() {
            let tab = WorkspaceTab::Conversation(key);
            if snapshot.tabs.contains(&tab) && snapshot.active_tab.as_ref() != Some(&tab) {
                self.workspace.update(cx, |store, cx| {
                    store.tab_activate(&tab);
                    cx.notify();
                });
            }
        }
        if target != self.focused_conversation {
            self.focus_conversation(target, cx);
        } else if let Some(key) = target {
            self.reconcile_conversation_ui(&key, cx);
        }
    }

    fn focus_conversation(&mut self, target: Option<ConversationKey>, cx: &mut Context<Self>) {
        self.chat_subscription = None;
        self.focused_conversation = target.clone();
        let Some(key) = target else {
            self.connectivity.update(cx, |controller, _| {
                controller.chat_unfocus();
            });
            return;
        };
        let Some(chat) = self.connectivity.update(cx, |controller, cx| {
            let store = controller.chat_materialize(key.clone(), cx);
            controller.chat_focus(key.clone(), cx);
            store
        }) else {
            return;
        };
        self.ensure_conversation_ui(&key, &chat, cx);
        self.chat_subscription = Some(cx.observe(&chat, |this, _, cx| {
            if let Some(key) = this.focused_conversation.clone() {
                this.reconcile_conversation_ui(&key, cx);
            }
            cx.notify();
        }));
        self.reconcile_conversation_ui(&key, cx);
    }

    fn ensure_conversation_ui(
        &mut self,
        key: &ConversationKey,
        chat: &Entity<ChatStore>,
        cx: &mut Context<Self>,
    ) {
        if self.ui.contains_key(key) {
            return;
        }
        let snapshot = chat.read(cx).snapshot().clone();
        let composer_id = format!("composer:{}", key.id());
        let composer_value = snapshot.composer.text.to_string();
        let composer_placeholder = format!("Message Happy in “{}”…", self.labels.workspace_name);
        let theme = self.theme;
        let composer = cx.new(move |cx| {
            TextArea::new(composer_id, composer_value, composer_placeholder, theme, cx)
        });
        let command_surface = cx.entity();
        let command_store = chat.clone();
        let command_key = key.clone();
        let command_handler: TextAreaCommandHandler = Rc::new(move |command, window, cx| {
            let snapshot = command_store.read(cx).snapshot().clone();
            let online = matches!(snapshot.availability, ChatAvailability::Online);
            let (dismissed, emoji_open, active) = command_surface
                .read(cx)
                .ui
                .get(&command_key)
                .map(|ui| {
                    (
                        ui.command_picker_dismissed,
                        command_surface.read(cx).emoji_open.contains(&command_key),
                        ui.command_picker_active,
                    )
                })
                .unwrap_or((true, false, 0));
            let query = snapshot.composer.command_query.as_ref();
            let commands: Vec<_> = snapshot
                .slash_commands
                .iter()
                .filter(|candidate| candidate.name.starts_with(query))
                .cloned()
                .collect();
            let picker_open = online
                && !dismissed
                && !emoji_open
                && snapshot.composer.text.starts_with('/')
                && !commands.is_empty();
            if picker_open {
                match command {
                    TextAreaCommand::Previous | TextAreaCommand::Next => {
                        let count = commands.len();
                        command_surface.update(cx, |this, cx| {
                            if let Some(ui) = this.ui.get_mut(&command_key) {
                                ui.command_picker_active = match command {
                                    TextAreaCommand::Previous => (active + count - 1) % count,
                                    TextAreaCommand::Next => (active + 1) % count,
                                    TextAreaCommand::Commit
                                    | TextAreaCommand::FocusPrevious
                                    | TextAreaCommand::FocusNext => unreachable!(),
                                };
                            }
                            cx.notify();
                        });
                        return true;
                    }
                    TextAreaCommand::Commit
                    | TextAreaCommand::FocusPrevious
                    | TextAreaCommand::FocusNext => {
                        let selected = &commands[active.min(commands.len() - 1)];
                        let text = snapshot.composer.text.trim();
                        let arguments = selected
                            .has_arguments
                            .then_some(text)
                            .and_then(|text| text.strip_prefix('/'))
                            .and_then(|text| text.split_once(char::is_whitespace))
                            .map(|(_, arguments)| arguments.trim())
                            .filter(|arguments| !arguments.is_empty())
                            .map(Arc::from);
                        let mutation =
                            ChatMutationId::new(format!("command-{}", cuid2::create_id()))
                                .expect("mutation is nonempty");
                        command_store.update(cx, |store, cx| {
                            store.command_select(&selected.name, arguments, mutation);
                            cx.notify();
                        });
                        command_surface.update(cx, |this, cx| {
                            if let Some(ui) = this.ui.get_mut(&command_key) {
                                ui.command_picker_dismissed = true;
                            }
                            cx.notify();
                        });
                        return true;
                    }
                }
            }

            match command {
                TextAreaCommand::FocusNext => {
                    let surface = command_surface.read(cx);
                    let Some(ui) = surface.ui.get(&command_key) else {
                        return false;
                    };
                    let pending = matches!(
                        snapshot.composer.message_send,
                        OperationState::Pending { .. }
                    );
                    let locked = snapshot.agent.as_ref().is_some_and(|agent| {
                        agent.can_send_messages == Some(false)
                            || agent.managed_by_another_agent == Some(true)
                    });
                    let offline = !online;
                    let target = if !pending {
                        Some((ui.toolbar_focus.attach.clone(), 0.0, 28.0))
                    } else if !locked && !offline {
                        Some((ui.toolbar_focus.model.clone(), 36.0, 140.0))
                    } else if !locked {
                        let emoji_left = 712.0
                            + if snapshot.context.is_some() {
                                CONTEXT_METER_WIDTH + 8.0
                            } else {
                                0.0
                            };
                        Some((
                            ui.toolbar_focus.emoji.clone(),
                            emoji_left,
                            emoji_left + 28.0,
                        ))
                    } else {
                        None
                    };
                    let Some((focus, left, right)) = target else {
                        return false;
                    };
                    let scroll = ui.toolbar_scrollbar.read(cx).scroll_handle().clone();
                    reveal_horizontal_focus(&scroll, left, right, &focus, window);
                    true
                }
                TextAreaCommand::FocusPrevious => {
                    if matches!(
                        snapshot.composer.message_send,
                        OperationState::Pending { .. }
                    ) {
                        return false;
                    }
                    let surface = command_surface.read(cx);
                    let Some(ui) = surface.ui.get(&command_key) else {
                        return false;
                    };
                    let local = surface.local_attachments.get(&command_key);
                    let store_ids: BTreeSet<_> = snapshot
                        .composer
                        .attachments
                        .iter()
                        .map(|attachment| attachment.id.clone())
                        .collect();
                    let last_local = local.and_then(|items| {
                        items
                            .values()
                            .filter(|preview| !store_ids.contains(&preview.id))
                            .last()
                            .map(|preview| (preview.id.clone(), preview.failure.is_some()))
                    });
                    let last = last_local.or_else(|| {
                        snapshot.composer.attachments.last().map(|attachment| {
                            let failed = local
                                .and_then(|items| items.get(&attachment.id))
                                .is_some_and(|preview| preview.failure.is_some())
                                || matches!(attachment.state, AttachmentState::Failed { .. });
                            (attachment.id.clone(), failed)
                        })
                    });
                    let Some((id, failed)) = last else {
                        return false;
                    };
                    let has_omitted = local
                        .into_iter()
                        .flat_map(BTreeMap::values)
                        .any(|preview| preview.omitted_count > 0);
                    let Some(actions) = ui.attachment_action_focus.get(&id) else {
                        return false;
                    };
                    let focus = if failed && !has_omitted {
                        &actions.retry
                    } else {
                        &actions.remove
                    };
                    let scroll = ui
                        .attachment_horizontal_scrollbar
                        .read(cx)
                        .scroll_handle()
                        .clone();
                    scroll.set_offset(gpui::point(-scroll.max_offset().width, scroll.offset().y));
                    focus.focus(window);
                    window.refresh();
                    true
                }
                TextAreaCommand::Previous | TextAreaCommand::Next | TextAreaCommand::Commit => {
                    false
                }
            }
        });
        composer.update(cx, |area, _| {
            area.set_command_handler(Some(command_handler));
        });
        let composer_store = chat.clone();
        let composer_key = key.clone();
        let composer_subscription = cx.subscribe(&composer, move |this, _, event, cx| {
            let value = match event {
                TextAreaEvent::Changed { value } => {
                    if let Some(ui) = this.ui.get_mut(&composer_key) {
                        ui.command_picker_active = 0;
                        ui.command_picker_dismissed = false;
                    }
                    value.clone()
                }
                TextAreaEvent::Submit { value } => value.clone(),
            };
            composer_store.update(cx, |store, cx| {
                store.draft_text_update(value.as_ref());
                let query = value
                    .strip_prefix('/')
                    .unwrap_or("")
                    .split_whitespace()
                    .next()
                    .unwrap_or("");
                store.command_query_update(query);
                cx.notify();
            });
            this.viewport_resized(cx);
        });
        let row_cache = Rc::new(RefCell::new(BTreeMap::new()));
        let history_revision_cache = Rc::new(RefCell::new(HistoryRevisionCache::default()));
        let rows = Rc::new(self.rows_project(
            &snapshot,
            &BTreeMap::new(),
            &row_cache,
            &history_revision_cache,
            cx.entity(),
            cx,
        ));
        let state = ChatTranscriptState::new(&rows);
        let anchor_workspace = self.workspace.clone();
        let transcript_chat = chat.clone();
        let anchor_key = key.clone();
        state.set_event_handler(Some(Rc::new(move |event, _, cx| match event {
            ChatTranscriptEvent::AnchorChanged(anchor) => {
                let (anchor, following) = match anchor {
                    TranscriptAnchor::Following => (None, true),
                    TranscriptAnchor::Parked {
                        row_id,
                        offset_in_row,
                    } => (
                        TranscriptRowId::new(row_id.as_ref()).map(|row| ScrollAnchor {
                            row,
                            offset_px: offset_in_row,
                        }),
                        false,
                    ),
                };
                anchor_workspace.update(cx, |store, cx| {
                    store.transcript_anchor_update(&anchor_key, anchor, following);
                    cx.notify();
                });
            }
            ChatTranscriptEvent::StartReached => {
                transcript_chat.update(cx, |store, cx| {
                    store.history_older();
                    cx.notify();
                });
            }
        })));
        if let Some(memory) = self.workspace.read(cx).snapshot().transcripts.get(key) {
            if memory.following {
                state.follow();
            } else if let Some(anchor) = &memory.anchor {
                state.park_at(anchor.row.as_str().to_owned(), anchor.offset_px as f32);
            }
        }
        let scrollbar = cx.new(|_| {
            ScrollbarState::vertical_list(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                state.list_state(),
            )
        });
        let transcript_focus = cx.focus_handle();
        let transcript_entity_focus = transcript_focus.clone();
        let transcript_id = format!("transcript:{}", key.id()).into();
        let transcript_theme = self.theme;
        let transcript = cx.new(move |_| TranscriptEntity {
            id: transcript_id,
            theme: transcript_theme,
            state,
            scrollbar,
            rows,
            focus: transcript_entity_focus,
        });
        let attachment_scroll_handle = SharedScrollHandle::new();
        let horizontal_handle = attachment_scroll_handle.clone();
        let attachment_horizontal_scrollbar = cx.new(move |_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                horizontal_handle,
            )
        });
        let attachment_vertical_scrollbar = cx.new(move |_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                attachment_scroll_handle,
            )
        });
        let toolbar_scrollbar = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let toolbar_focus = ToolbarFocus {
            attach: cx.focus_handle(),
            model: cx.focus_handle(),
            effort: cx.focus_handle(),
            permission: cx.focus_handle(),
            tier: cx.focus_handle(),
            audience: cx.focus_handle(),
            emoji: cx.focus_handle(),
            submit: cx.focus_handle(),
        };
        self.ui.insert(
            key.clone(),
            ConversationUi {
                composer,
                transcript,
                transcript_focus,
                question_inputs: BTreeMap::new(),
                question_input_subscriptions: BTreeMap::new(),
                command_picker_focus: cx.focus_handle().tab_index(0).tab_stop(true),
                command_picker_active: 0,
                command_picker_dismissed: false,
                emoji_picker_focus: cx.focus_handle().tab_index(0).tab_stop(false),
                emoji_picker_active: 0,
                row_cache,
                history_revision_cache,
                attachment_horizontal_scrollbar,
                attachment_vertical_scrollbar,
                toolbar_scrollbar,
                attachment_action_focus: BTreeMap::new(),
                toolbar_focus,
                _subscriptions: vec![composer_subscription],
            },
        );
    }

    fn reconcile_conversation_ui(&mut self, key: &ConversationKey, cx: &mut Context<Self>) {
        let Some(chat) = self.connectivity.read(cx).chat(key, cx) else {
            return;
        };
        self.ensure_conversation_ui(key, &chat, cx);
        let snapshot = chat.read(cx).snapshot().clone();
        let attachment_ids: BTreeSet<_> = snapshot
            .composer
            .attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect();
        let mut released_local_images = Vec::new();
        let remove_local_entry = if let Some(previews) = self.local_attachments.get_mut(key) {
            previews.retain(|id, preview| {
                let retained = attachment_ids.contains(id) || preview.failure.is_some();
                if !retained && let Some(image) = preview.image.as_ref() {
                    released_local_images.push(image.clone());
                }
                retained
            });
            previews.is_empty()
        } else {
            false
        };
        for image in released_local_images {
            image.remove_asset(cx);
        }
        if remove_local_entry {
            self.local_attachments.remove(key);
        }
        let attachment_focus_ids: BTreeSet<_> = attachment_ids
            .iter()
            .cloned()
            .chain(
                self.local_attachments
                    .get(key)
                    .into_iter()
                    .flat_map(BTreeMap::keys)
                    .cloned(),
            )
            .collect();
        let ui = self
            .ui
            .get_mut(key)
            .expect("conversation UI was materialized");
        ui.attachment_action_focus
            .retain(|id, _| attachment_focus_ids.contains(id));
        for id in attachment_focus_ids {
            ui.attachment_action_focus
                .entry(id)
                .or_insert_with(|| AttachmentActionFocus {
                    open: cx.focus_handle(),
                    remove: cx.focus_handle(),
                    retry: cx.focus_handle(),
                });
        }
        if ui.composer.read(cx).value().as_ref() != snapshot.composer.text.as_ref() {
            let value = snapshot.composer.text.to_string();
            ui.composer
                .update(cx, move |area, cx| area.set_value(value, cx));
        }
        let disabled = snapshot.agent.as_ref().is_some_and(|agent| {
            agent.can_send_messages == Some(false) || agent.managed_by_another_agent == Some(true)
        });
        ui.composer.update(cx, |area, cx| {
            area.set_disabled(disabled, cx);
            area.set_placeholder(
                format!("Message Happy in “{}”…", self.labels.workspace_name),
                cx,
            );
        });
        let free_text_prompt_ids: BTreeSet<Arc<str>> = snapshot
            .question
            .iter()
            .flat_map(|question| question.questions.iter())
            .filter(|prompt| prompt.options.is_empty())
            .map(|prompt| Arc::from(prompt.id.as_str()))
            .collect();
        ui.question_inputs
            .retain(|id, _| free_text_prompt_ids.contains(id));
        ui.question_input_subscriptions
            .retain(|id, _| free_text_prompt_ids.contains(id));
        if let Some(question) = snapshot.question.as_ref() {
            for prompt in &question.questions {
                if prompt.options.is_empty() {
                    let id: Arc<str> = Arc::from(prompt.id.as_str());
                    let value = snapshot
                        .composer
                        .question_selections
                        .get(id.as_ref())
                        .and_then(|values| values.first())
                        .map(AsRef::as_ref)
                        .unwrap_or("")
                        .to_owned();
                    if let Some(input) = ui.question_inputs.get(&id) {
                        if input.read(cx).value().as_ref() != value {
                            input.update(cx, |input, cx| input.set_value(value, cx));
                        }
                    } else {
                        let input_id = format!("question:{}:{}", key.id(), prompt.id);
                        let theme = self.theme;
                        let input = cx.new(move |cx| {
                            TextArea::new(input_id, value, "Type an answer…", theme, cx)
                        });
                        let store = chat.clone();
                        let prompt_id = id.clone();
                        let subscription = cx.subscribe(&input, move |_, _, event, cx| {
                            if let TextAreaEvent::Changed { value } = event {
                                store.update(cx, |store, cx| {
                                    store.question_free_text_update(&prompt_id, value.as_ref());
                                    cx.notify();
                                });
                            }
                        });
                        ui.question_inputs.insert(id.clone(), input);
                        ui.question_input_subscriptions.insert(id, subscription);
                    }
                }
            }
        }
        let question_inputs = ui.question_inputs.clone();
        let transcript = ui.transcript.clone();
        let row_cache = ui.row_cache.clone();
        let history_revision_cache = ui.history_revision_cache.clone();
        let rows = Rc::new(self.rows_project(
            &snapshot,
            &question_inputs,
            &row_cache,
            &history_revision_cache,
            cx.entity(),
            cx,
        ));
        let retained_image_ids: BTreeSet<_> = rows
            .iter()
            .filter_map(|row| match &row.content {
                ChatTranscriptContent::Message(message) => Some(message.blocks.iter()),
                ChatTranscriptContent::Question(_)
                | ChatTranscriptContent::Delegation { .. }
                | ChatTranscriptContent::Process { .. }
                | ChatTranscriptContent::Status(_)
                | ChatTranscriptContent::Notice(_) => None,
            })
            .flatten()
            .filter_map(|block| match block {
                ChatMessageBlock::Image(image) => Some(image.id.as_ref().to_owned()),
                ChatMessageBlock::Text(_)
                | ChatMessageBlock::Reasoning(_)
                | ChatMessageBlock::Tool(_)
                | ChatMessageBlock::Compaction(_) => None,
            })
            .collect();
        let released_transcript_images: Vec<_> = {
            let mut images = self.images.borrow_mut();
            let released = images
                .iter()
                .filter(|(id, _)| !retained_image_ids.contains(*id))
                .map(|(_, value)| value.image.clone())
                .collect();
            images.retain(|id, _| retained_image_ids.contains(id));
            released
        };
        for image in released_transcript_images {
            image.remove_asset(cx);
        }
        self.rejected_images
            .borrow_mut()
            .retain(|id| retained_image_ids.contains(id));
        transcript.update(cx, |transcript, cx| {
            transcript.rows = rows;
            transcript.state.reconcile(&transcript.rows);
            cx.notify();
        });
        self.viewport_resized(cx);
    }

    fn next_mutation(&mut self, prefix: &str) -> String {
        self.mutation_serial = self.mutation_serial.wrapping_add(1);
        format!("surface-{prefix}-{}", self.mutation_serial)
    }

    fn load_older_handler(&self, key: ConversationKey) -> crate::ui::chat_message::ChatActivate {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(store) = connectivity.read(cx).chat(&key, cx) {
                store.update(cx, |store, cx| {
                    store.history_older();
                    cx.notify();
                });
            }
        })
    }
}

impl ChatWorkspaceSurface {
    fn rows_project(
        &self,
        snapshot: &ChatSnapshot,
        question_inputs: &BTreeMap<Arc<str>, Entity<TextArea>>,
        row_cache: &Rc<RefCell<BTreeMap<String, (u64, ChatTranscriptRow)>>>,
        history_revision_cache: &Rc<RefCell<HistoryRevisionCache>>,
        surface: Entity<Self>,
        cx: &App,
    ) -> Vec<ChatTranscriptRow> {
        let product = transcript_project(snapshot);
        let running_message_ids: BTreeSet<String> = snapshot
            .history_pages
            .iter()
            .flat_map(|page| page.runs.iter())
            .filter(|run| run.value.status == RunStatus::Running)
            .flat_map(|run| run.messages.iter())
            .map(|message| message_id(message).to_owned())
            .collect();
        let main_agent_id = snapshot.agent.as_ref().map(|agent| agent.id.as_str());
        let sender_authors: BTreeMap<String, (SharedString, SharedString)> = snapshot
            .subagents
            .iter()
            .map(|agent| {
                let author = agent
                    .title
                    .clone()
                    .unwrap_or_else(|| bounded_sender_label(&agent.id));
                let initials = author
                    .chars()
                    .next()
                    .map(|value| value.to_uppercase().collect::<String>())
                    .unwrap_or_else(|| "H".to_owned());
                (agent.id.clone(), (author.into(), initials.into()))
            })
            .collect();
        let (history_message_revisions, mut history_source_revisions) =
            history_message_revisions(snapshot, history_revision_cache);
        if let Some(question) = snapshot.question.as_ref() {
            history_source_revisions.insert(
                format!("question:{}", question.id),
                Arc::as_ptr(question) as *const () as usize as u64,
            );
        }
        for process in &snapshot.processes {
            history_source_revisions.insert(
                format!("process:{}", process.id),
                Arc::as_ptr(process) as *const () as usize as u64,
            );
        }
        for subagent in &snapshot.subagents {
            history_source_revisions.insert(
                format!("subagent:{}", subagent.id),
                Arc::as_ptr(subagent) as *const () as usize as u64,
            );
        }
        let image_surface = surface.clone();
        let on_image_open: ChatImageActivate = Rc::new(move |id, window, cx| {
            image_surface.update(cx, |this, cx| {
                if let Some(image) = this.images.borrow().get(id.as_ref()).cloned() {
                    this.image_return_focus = window.focused(cx);
                    this.opened_image = Some(OpenedInlineImage {
                        id: id.clone(),
                        alt: "Inline image".into(),
                        image: image.image,
                    });
                    window.focus(&this.image_close_focus);
                    cx.notify();
                }
            });
        });
        let mut previous_author = None;
        let rows: Vec<_> = product
            .iter()
            .map(|row| {
                let grouped = match &row.kind {
                    ChatTranscriptRowKind::Message { role, message } => {
                        let author = message_author_key(main_agent_id, *role, message);
                        let grouped = previous_author.as_ref() == Some(&author);
                        previous_author = Some(author);
                        grouped
                    }
                    ChatTranscriptRowKind::Block { .. }
                    | ChatTranscriptRowKind::Tool { .. }
                    | ChatTranscriptRowKind::Review { .. }
                    | ChatTranscriptRowKind::Compaction { .. } => true,
                    ChatTranscriptRowKind::Question { .. }
                    | ChatTranscriptRowKind::Subagent { .. }
                    | ChatTranscriptRowKind::Process { .. }
                    | ChatTranscriptRowKind::RunStatus { .. }
                    | ChatTranscriptRowKind::ConversationStatus { .. } => {
                        previous_author = None;
                        false
                    }
                };
                let id = product_row_id(&row.id);
                let mut revision = row_revision(
                    row,
                    history_message_revisions
                        .get(&product_row_id(&row.id))
                        .copied(),
                    product_row_source_key(row)
                        .and_then(|source| history_source_revisions.get(&source).copied()),
                )
                .rotate_left(1)
                    ^ u64::from(grouped);
                revision ^= row_dynamic_revision(row, snapshot, &running_message_ids);
                if let ChatTranscriptRowKind::Message { role, message } = &row.kind {
                    use std::hash::{Hash, Hasher};
                    let (author, initials) =
                        message_author(main_agent_id, &sender_authors, *role, message);
                    let mut author_hash = std::collections::hash_map::DefaultHasher::new();
                    author.hash(&mut author_hash);
                    initials.hash(&mut author_hash);
                    revision ^= author_hash.finish();
                }
                if let Some((cached_revision, cached)) = row_cache.borrow().get(&id)
                    && *cached_revision == revision
                {
                    return cached.clone();
                }
                let projected = ChatTranscriptRow {
                    id: id.clone().into(),
                    revision,
                    content: self.row_content(
                        row,
                        snapshot,
                        question_inputs,
                        grouped,
                        on_image_open.clone(),
                        main_agent_id,
                        &sender_authors,
                        &running_message_ids,
                        cx,
                    ),
                };
                row_cache
                    .borrow_mut()
                    .insert(id, (revision, projected.clone()));
                projected
            })
            .collect();
        let retained_ids: BTreeSet<_> = rows.iter().map(|row| row.id.as_ref().to_owned()).collect();
        row_cache
            .borrow_mut()
            .retain(|id, _| retained_ids.contains(id));
        rows
    }

    fn row_content(
        &self,
        row: &crate::chat::ChatTranscriptRow,
        snapshot: &ChatSnapshot,
        question_inputs: &BTreeMap<Arc<str>, Entity<TextArea>>,
        grouped: bool,
        on_image_open: ChatImageActivate,
        main_agent_id: Option<&str>,
        sender_authors: &BTreeMap<String, (SharedString, SharedString)>,
        running_message_ids: &BTreeSet<String>,
        _cx: &App,
    ) -> ChatTranscriptContent {
        match &row.kind {
            ChatTranscriptRowKind::Message { role, message } => {
                let (author, initials) =
                    message_author(main_agent_id, sender_authors, *role, message);
                ChatTranscriptContent::Message(message_model(
                    product_row_id(&row.id),
                    *role,
                    message,
                    author,
                    initials,
                    row.created_at,
                    grouped,
                    message_generation(running_message_ids, role, message),
                    Some(on_image_open),
                    self.link_open.clone(),
                    &self.images,
                    &self.rejected_images,
                ))
            }
            ChatTranscriptRowKind::Block { kind, block, .. } => match kind {
                ChatTranscriptBlockKind::ToolCallRequest => {
                    let (name, arguments) = match block.as_ref() {
                        MessageBlock::ToolCallRequest { name, arguments } => (
                            name.as_str(),
                            serde_json::to_string_pretty(arguments).unwrap_or_default(),
                        ),
                        _ => ("Tool request", String::new()),
                    };
                    ChatTranscriptContent::Message(ChatMessageModel {
                        id: product_row_id(&row.id).into(),
                        role: MessageRole::Agent,
                        author: "Happy".into(),
                        initials: "H".into(),
                        time: None,
                        context_note: None,
                        delivery: MessageDelivery::Sent,
                        generation: MessageGeneration::Complete,
                        grouped: true,
                        blocks: vec![ChatMessageBlock::Tool(ToolBlock {
                            title: name.to_owned().into(),
                            status: ToolStatus::Running,
                            presentation: ToolPresentation::Generic {
                                summary: name.to_owned().into(),
                                detail: Some(arguments.into()),
                            },
                            review: None,
                            expanded: false,
                        })],
                        on_link_open: Some(self.link_open.clone()),
                        on_image_open: None,
                        on_tool_open: None,
                        on_review_allow: None,
                        on_review_deny: None,
                    })
                }
                _ => ChatTranscriptContent::Notice(NoticeRowModel {
                    id: product_row_id(&row.id).into(),
                    title: None,
                    text: "Unsupported transcript block".into(),
                    tone: SemanticTone::Neutral,
                }),
            },
            ChatTranscriptRowKind::Tool { tool, .. } => {
                ChatTranscriptContent::Message(single_block_message(
                    product_row_id(&row.id),
                    ChatMessageBlock::Tool(tool_model(tool, false)),
                    self.link_open.clone(),
                ))
            }
            ChatTranscriptRowKind::Review { tool_id, review } => {
                let (status, prompt) = review_model(review);
                ChatTranscriptContent::Message(single_block_message(
                    product_row_id(&row.id),
                    ChatMessageBlock::Tool(ToolBlock {
                        title: format!("Permission review · {tool_id}").into(),
                        status: ToolStatus::Succeeded,
                        presentation: ToolPresentation::Generic {
                            summary: "Permission review".into(),
                            detail: None,
                        },
                        review: Some(ToolReview { status, prompt }),
                        expanded: true,
                    }),
                    self.link_open.clone(),
                ))
            }
            ChatTranscriptRowKind::Compaction { compaction, .. } => {
                let (title, summary, count) = compaction_model(compaction);
                ChatTranscriptContent::Message(single_block_message(
                    product_row_id(&row.id),
                    ChatMessageBlock::Compaction(CompactionBlock {
                        title: title.into(),
                        summary: MarkdownDocument::parse(&summary),
                        token_count: count,
                    }),
                    self.link_open.clone(),
                ))
            }
            ChatTranscriptRowKind::Question {
                question_id,
                status,
            } => {
                let question = snapshot
                    .question
                    .as_ref()
                    .filter(|question| question.id == question_id.as_ref());
                let pending = *status == QuestionStatus::Pending;
                let questions = question
                    .map(|question| {
                        question
                            .questions
                            .iter()
                            .map(|prompt| {
                                let selections = snapshot
                                    .composer
                                    .question_selections
                                    .get(prompt.id.as_str());
                                GenericQuestion {
                                    id: prompt.id.clone().into(),
                                    prompt: format!("{} · {}", prompt.header, prompt.question)
                                        .into(),
                                    multiple: prompt.multi_select,
                                    options: prompt
                                        .options
                                        .iter()
                                        .map(|option| QuestionOption {
                                            id: option.label.clone().into(),
                                            label: if option.description.is_empty() {
                                                option.label.clone().into()
                                            } else {
                                                format!("{} — {}", option.label, option.description)
                                                    .into()
                                            },
                                            selected: selections.is_some_and(|set| {
                                                set.contains(option.label.as_str())
                                            }),
                                            disabled: !pending,
                                        })
                                        .collect(),
                                    text_input: question_inputs.get(prompt.id.as_str()).cloned(),
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let complete = question.is_some_and(|question| {
                    question.questions.iter().all(|prompt| {
                        snapshot
                            .composer
                            .question_selections
                            .get(prompt.id.as_str())
                            .is_some_and(|answers| !answers.is_empty())
                    })
                });
                let on_select =
                    question.map(|_| self.question_select_handler(snapshot.conversation.clone()));
                let on_submit =
                    question.map(|_| self.question_submit_handler(snapshot.conversation.clone()));
                ChatTranscriptContent::Question(QuestionRowModel {
                    id: question_id.to_string().into(),
                    title: if pending {
                        "Happy needs input"
                    } else {
                        "Question resolved"
                    }
                    .into(),
                    questions,
                    pending,
                    submit_disabled: !pending
                        || !complete
                        || !matches!(snapshot.availability, ChatAvailability::Online),
                    submit_busy: matches!(
                        snapshot.composer.question_submit,
                        OperationState::Pending { .. }
                    ),
                    on_select,
                    on_submit,
                })
            }
            ChatTranscriptRowKind::Subagent {
                agent_id,
                status,
                title,
            } => ChatTranscriptContent::Delegation {
                model: DelegationRowModel {
                    id: product_row_id(&row.id).into(),
                    agent: title
                        .clone()
                        .unwrap_or_else(|| agent_id.clone())
                        .to_string()
                        .into(),
                    task: "Delegated agent".into(),
                    status: agent_status(status).into(),
                    elapsed: None,
                },
                on_open: None,
            },
            ChatTranscriptRowKind::Process {
                process_id,
                command,
                status,
                exit_code,
            } => {
                let running = *status == BackgroundProcessStatus::Running;
                let stopping = snapshot
                    .process_operations
                    .get(process_id.as_ref())
                    .is_some_and(|operation| matches!(operation, OperationState::Pending { .. }));
                ChatTranscriptContent::Process {
                    model: ProcessRowModel {
                        id: product_row_id(&row.id).into(),
                        label: process_id.to_string().into(),
                        detail: match exit_code {
                            Some(code) => format!("{command} · exit {code}"),
                            None => command.to_string(),
                        }
                        .into(),
                        running,
                    },
                    on_stop: (running
                        && !stopping
                        && matches!(snapshot.availability, ChatAvailability::Online))
                    .then(|| {
                        self.process_stop_handler(snapshot.conversation.clone(), process_id.clone())
                    }),
                }
            }
            ChatTranscriptRowKind::RunStatus { run_id, status } => {
                ChatTranscriptContent::Status(StatusRowModel {
                    id: product_row_id(&row.id).into(),
                    label: format!("Run {run_id}").into(),
                    detail: Some(run_status(*status).into()),
                    tone: if *status == RunStatus::Failed {
                        SemanticTone::Error
                    } else {
                        SemanticTone::Neutral
                    },
                })
            }
            ChatTranscriptRowKind::ConversationStatus { load, availability } => {
                let (label, detail, tone) = conversation_status(load, availability);
                ChatTranscriptContent::Status(StatusRowModel {
                    id: product_row_id(&row.id).into(),
                    label: label.into(),
                    detail: detail.map(Into::into),
                    tone,
                })
            }
        }
    }

    fn process_stop_handler(
        &self,
        key: ConversationKey,
        process_id: Arc<str>,
    ) -> crate::ui::chat_message::ChatActivate {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(store) = connectivity.read(cx).chat(&key, cx) {
                let mutation = ChatMutationId::new(format!("process-stop-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                let process_id = process_id.clone();
                store.update(cx, |store, cx| {
                    store.process_stop(process_id, mutation);
                    cx.notify();
                });
            }
        })
    }

    fn question_select_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::chat_message::QuestionSelect {
        let connectivity = self.connectivity.clone();
        Rc::new(move |prompt, option, selected, _, cx| {
            if let Some(store) = connectivity.read(cx).chat(&key, cx) {
                store.update(cx, |store, cx| {
                    store.question_selection_update(prompt.as_ref(), option.as_ref(), selected);
                    cx.notify();
                });
            }
        })
    }

    fn question_submit_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::chat_message::ChatActivate {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(store) = connectivity.read(cx).chat(&key, cx) {
                let mutation = ChatMutationId::new(format!("question-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                store.update(cx, |store, cx| {
                    store.question_submit(mutation);
                    cx.notify();
                });
            }
        })
    }
}

fn message_author_key(
    main_agent_id: Option<&str>,
    role: ChatTranscriptMessageRole,
    message: &Message,
) -> (ChatTranscriptMessageRole, Option<String>) {
    let sender = match message {
        Message::User(value) => value.metadata.sender_agent_id.clone(),
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            value.metadata.sender_agent_id.clone()
        }
    };
    let sender = sender.filter(|sender| main_agent_id != Some(sender.as_str()));
    (role, sender)
}

fn bounded_sender_label(sender: &str) -> String {
    const MAX_SENDER_LABEL_CHARS: usize = 20;
    let mut chars = sender.chars();
    let prefix: String = chars.by_ref().take(MAX_SENDER_LABEL_CHARS).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn message_author(
    main_agent_id: Option<&str>,
    sender_authors: &BTreeMap<String, (SharedString, SharedString)>,
    role: ChatTranscriptMessageRole,
    message: &Message,
) -> (SharedString, SharedString) {
    match role {
        ChatTranscriptMessageRole::User => ("You".into(), "Y".into()),
        ChatTranscriptMessageRole::System => ("System".into(), "S".into()),
        ChatTranscriptMessageRole::Service => ("Service".into(), "S".into()),
        ChatTranscriptMessageRole::Agent => {
            let sender = match message {
                Message::Agent(value) => value.metadata.sender_agent_id.as_deref(),
                Message::User(value) => value.metadata.sender_agent_id.as_deref(),
                Message::System(value) | Message::Service(value) => {
                    value.metadata.sender_agent_id.as_deref()
                }
            };
            if sender.is_none() || sender == main_agent_id {
                return ("Happy".into(), "H".into());
            }
            let sender = sender.expect("sender was checked above");
            sender_authors.get(sender).cloned().unwrap_or_else(|| {
                let author = bounded_sender_label(sender);
                let initials = author
                    .chars()
                    .next()
                    .map(|value| value.to_uppercase().collect::<String>())
                    .unwrap_or_else(|| "H".to_owned());
                (author.into(), initials.into())
            })
        }
    }
}

fn message_model(
    id: String,
    role: ChatTranscriptMessageRole,
    message: &Arc<Message>,
    author: SharedString,
    initials: SharedString,
    created_at: Option<i64>,
    grouped: bool,
    generation: MessageGeneration,
    on_image_open: Option<ChatImageActivate>,
    on_link_open: MarkdownLinkActivate,
    images: &RefCell<BTreeMap<String, DecodedInlineImage>>,
    rejected_images: &RefCell<BTreeSet<String>>,
) -> ChatMessageModel {
    let (content, metadata, delivery) = match message.as_ref() {
        Message::User(value) => (
            &value.content,
            &value.metadata,
            Some((value.delivery, value.status)),
        ),
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            (&value.content, &value.metadata, None)
        }
    };
    let blocks = content
        .iter()
        .enumerate()
        .filter_map(|(index, block)| match block {
            MessageBlock::Text { text } => {
                Some(ChatMessageBlock::Text(MarkdownDocument::parse(text)))
            }
            MessageBlock::Image { mime_type, data } => {
                let image_id = format!("{id}:image:{index}");
                if !images.borrow().contains_key(&image_id)
                    && !rejected_images.borrow().contains(&image_id)
                {
                    match inline_image_decode(mime_type, data) {
                        Some(image) => {
                            let cache = images.borrow();
                            let decoded_total: u64 =
                                cache.values().map(|value| value.decoded_bytes).sum();
                            let admitted = cache.len() < MAX_DECODED_TRANSCRIPT_IMAGES
                                && decoded_total
                                    .checked_add(image.decoded_bytes)
                                    .is_some_and(|total| total <= MAX_DECODED_TRANSCRIPT_BYTES);
                            drop(cache);
                            if admitted {
                                images.borrow_mut().insert(image_id.clone(), image);
                            } else {
                                rejected_image_record(
                                    &mut rejected_images.borrow_mut(),
                                    image_id.clone(),
                                );
                            }
                        }
                        None => {
                            rejected_image_record(
                                &mut rejected_images.borrow_mut(),
                                image_id.clone(),
                            );
                        }
                    }
                }
                let rejected = rejected_images.borrow().contains(&image_id);
                let cache = images.borrow();
                let cached = cache.get(&image_id);
                Some(ChatMessageBlock::Image(ChatImageBlock {
                    id: image_id.into(),
                    alt: if rejected {
                        "Inline image unavailable"
                    } else {
                        "Inline image"
                    }
                    .into(),
                    image: cached.map(|value| value.image.clone()),
                    width: cached.map(|value| value.width),
                    height: cached.map(|value| value.height),
                }))
            }
            MessageBlock::Reasoning { text } => Some(ChatMessageBlock::Reasoning(ReasoningBlock {
                summary: "Reasoning".into(),
                detail: MarkdownDocument::parse(text),
                expanded: false,
            })),
            // These have their own stable product rows and must not be duplicated here.
            MessageBlock::ToolCallRequest { .. }
            | MessageBlock::ToolCall(_)
            | MessageBlock::Compaction(_) => None,
        })
        .collect();
    ChatMessageModel {
        id: id.into(),
        role: match role {
            ChatTranscriptMessageRole::User => MessageRole::User,
            ChatTranscriptMessageRole::Agent => MessageRole::Agent,
            ChatTranscriptMessageRole::System | ChatTranscriptMessageRole::Service => {
                MessageRole::System
            }
        },
        author,
        initials,
        time: created_at.and_then(message_time_label).map(Into::into),
        context_note: metadata.model_id.as_ref().map(|model| {
            match metadata.provider_id.as_ref() {
                Some(provider) => format!("{provider} · {model}"),
                None => model.clone(),
            }
            .into()
        }),
        delivery: match delivery {
            Some((_, UserMessageStatus::Accepted)) => MessageDelivery::Sent,
            Some((ProtocolDelivery::Queue, UserMessageStatus::Pending)) => MessageDelivery::Sending,
            Some((ProtocolDelivery::Steer, UserMessageStatus::Pending)) => {
                MessageDelivery::PendingSteering
            }
            None => MessageDelivery::Sent,
        },
        generation,
        grouped,
        blocks,
        on_link_open: Some(on_link_open),
        on_image_open,
        on_tool_open: None,
        on_review_allow: None,
        on_review_deny: None,
    }
}

fn message_time_label(value: i64) -> Option<String> {
    let seconds = if value.abs() >= 100_000_000_000 {
        value / 1_000
    } else {
        value
    };
    let time = libc::time_t::try_from(seconds).ok()?;
    let mut local = std::mem::MaybeUninit::<libc::tm>::uninit();
    // SAFETY: `localtime_r` writes one caller-owned `tm`; `time` lives for the call.
    let local = unsafe {
        let result = libc::localtime_r(&time, local.as_mut_ptr());
        (!result.is_null()).then(|| local.assume_init())
    }?;
    Some(format!("{:02}:{:02}", local.tm_hour, local.tm_min))
}

fn single_block_message(
    id: String,
    block: ChatMessageBlock,
    on_link_open: MarkdownLinkActivate,
) -> ChatMessageModel {
    ChatMessageModel {
        id: id.into(),
        role: MessageRole::Agent,
        author: "Happy".into(),
        initials: "H".into(),
        time: None,
        context_note: None,
        delivery: MessageDelivery::Sent,
        generation: MessageGeneration::Complete,
        grouped: true,
        blocks: vec![block],
        on_link_open: Some(on_link_open),
        on_image_open: None,
        on_tool_open: None,
        on_review_allow: None,
        on_review_deny: None,
    }
}

fn tool_model(
    tool: &crate::connectivity::chat_protocol::ToolCallBlock,
    review_only: bool,
) -> ToolBlock {
    let presentation = match &tool.presentation {
        Some(crate::connectivity::chat_protocol::ToolPresentation::Exploration { operations }) => {
            ToolPresentation::Generic {
                summary: "Exploration".into(),
                detail: Some(format!("{} exploration operations", operations.len()).into()),
            }
        }
        Some(crate::connectivity::chat_protocol::ToolPresentation::ExecCommand {
            command,
            output,
            ..
        }) => ToolPresentation::Command {
            command: command.clone().into(),
            output: output.clone().map(Into::into),
        },
        Some(
            crate::connectivity::chat_protocol::ToolPresentation::BackgroundTerminalInteraction {
                command,
                input,
                ..
            },
        ) => ToolPresentation::Command {
            command: command.clone().into(),
            output: Some(input.clone().into()),
        },
        Some(crate::connectivity::chat_protocol::ToolPresentation::FileDiff {
            files,
            omitted_files,
        }) => ToolPresentation::File {
            operation: match omitted_files {
                Some(omitted) => format!("Diff · {omitted} files omitted"),
                None => "Diff".to_owned(),
            }
            .into(),
            path: files
                .first()
                .map(|file| file.path.clone())
                .unwrap_or_else(|| "Workspace changes".to_owned())
                .into(),
        },
        Some(crate::connectivity::chat_protocol::ToolPresentation::Search {
            query,
            sources,
            ..
        }) => ToolPresentation::Search {
            query: query.clone().into(),
            result_count: sources
                .as_ref()
                .map(Vec::len)
                .and_then(|count| u32::try_from(count).ok()),
        },
        None => ToolPresentation::Generic {
            summary: tool.name.clone().into(),
            detail: tool
                .arguments
                .as_ref()
                .and_then(|value| serde_json::to_string_pretty(value).ok())
                .map(Into::into),
        },
    };
    let review = tool.review.as_ref().map(|review| {
        let (status, prompt) = review_model(review);
        ToolReview { status, prompt }
    });
    ToolBlock {
        title: tool.name.clone().into(),
        status: match tool.status {
            ToolCallStatus::Running => ToolStatus::Running,
            ToolCallStatus::Completed => ToolStatus::Succeeded,
            ToolCallStatus::Failed => ToolStatus::Failed,
        },
        presentation,
        review: review_only.then_some(review).flatten(),
        expanded: false,
    }
}

fn review_model(review: &ToolPermissionReview) -> (ToolReviewStatus, SharedString) {
    match review {
        ToolPermissionReview::Allowed { reason, .. } => {
            (ToolReviewStatus::Allowed, reason.clone().into())
        }
        ToolPermissionReview::Denied { reason, .. } => {
            (ToolReviewStatus::Denied, reason.clone().into())
        }
        ToolPermissionReview::Unproven { kind, reason } => (
            match kind {
                UnprovenReviewKind::TimedOut | UnprovenReviewKind::Unavailable => {
                    ToolReviewStatus::Expired
                }
            },
            reason.clone().into(),
        ),
    }
}

fn compaction_model(value: &ProtocolCompaction) -> (&'static str, String, Option<u64>) {
    match value {
        ProtocolCompaction::Running { tokens_before, .. } => (
            "Compacting context",
            "Context compaction is running.".into(),
            *tokens_before,
        ),
        ProtocolCompaction::Completed {
            tokens_before,
            tokens_after,
            ..
        } => (
            "Context compacted",
            format!(
                "Reduced context from {} to {} tokens.",
                tokens_before.unwrap_or(0),
                tokens_after.unwrap_or(0)
            ),
            *tokens_after,
        ),
        ProtocolCompaction::Failed {
            failure_reason,
            tokens_before,
            ..
        } => ("Compaction failed", failure_reason.clone(), *tokens_before),
    }
}

fn inline_image_decode(mime: &str, encoded: &str) -> Option<DecodedInlineImage> {
    if !matches!(
        mime,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return None;
    }
    let format = inline_image_format(mime);
    let bytes = BASE64.decode(encoded).ok()?;
    if bytes.len() > crate::chat::MAX_INLINE_IMAGE_BYTES as usize {
        return None;
    }
    let (width, height, decoded_bytes) = validate_decoded_image(mime, &bytes).ok()?;
    Some(DecodedInlineImage {
        image: Arc::new(Image::from_bytes(format, bytes)),
        width,
        height,
        decoded_bytes,
    })
}

fn validate_decoded_image(mime: &str, bytes: &[u8]) -> Result<(u32, u32, u64), Arc<str>> {
    let (width, height, frames) = match mime {
        "image/png" if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") => (
            u32::from_be_bytes(bytes[16..20].try_into().expect("four PNG width bytes")),
            u32::from_be_bytes(bytes[20..24].try_into().expect("four PNG height bytes")),
            1,
        ),
        "image/jpeg" => {
            let (width, height) = jpeg_dimensions(bytes)
                .ok_or_else(|| Arc::from("The JPEG dimensions could not be read."))?;
            (width, height, 1)
        }
        "image/gif" => gif_dimensions_and_frames(bytes)
            .ok_or_else(|| Arc::from("The GIF frame structure could not be read."))?,
        "image/webp" => webp_dimensions_and_frames(bytes)
            .ok_or_else(|| Arc::from("The WebP dimensions could not be read."))?,
        _ => return Err(Arc::from("The image dimensions could not be read.")),
    };
    if width == 0 || height == 0 || frames == 0 {
        return Err(Arc::from("The image has invalid dimensions."));
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| Arc::from("The image dimensions are too large."))?;
    if pixels > MAX_DECODED_IMAGE_PIXELS {
        return Err(Arc::from(format!(
            "The image exceeds the {MAX_DECODED_IMAGE_PIXELS} pixel limit."
        )));
    }
    let decoded_bytes = pixels
        .checked_mul(4)
        .and_then(|value| value.checked_mul(frames))
        .ok_or_else(|| Arc::from("The decoded image is too large."))?;
    if decoded_bytes > MAX_DECODED_IMAGE_BYTES {
        return Err(Arc::from(format!(
            "The decoded image exceeds the {MAX_DECODED_IMAGE_BYTES} byte limit."
        )));
    }
    Ok((width, height, decoded_bytes))
}

fn gif_dimensions_and_frames(bytes: &[u8]) -> Option<(u32, u32, u64)> {
    if bytes.len() < 13 || !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return None;
    }
    let width = u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32;
    let height = u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32;
    let packed = bytes[10];
    let mut offset = 13usize;
    if packed & 0x80 != 0 {
        offset = offset.checked_add(3usize.checked_mul(1usize << ((packed & 0x07) + 1))?)?;
    }
    if offset > bytes.len() {
        return None;
    }
    let mut frames = 0u64;
    loop {
        match *bytes.get(offset)? {
            0x3b => break,
            0x2c => {
                let descriptor = bytes.get(offset..offset + 10)?;
                let left = u16::from_le_bytes(descriptor[1..3].try_into().ok()?) as u32;
                let top = u16::from_le_bytes(descriptor[3..5].try_into().ok()?) as u32;
                let frame_width = u16::from_le_bytes(descriptor[5..7].try_into().ok()?) as u32;
                let frame_height = u16::from_le_bytes(descriptor[7..9].try_into().ok()?) as u32;
                if frame_width == 0
                    || frame_height == 0
                    || left.checked_add(frame_width)? > width
                    || top.checked_add(frame_height)? > height
                    || u64::from(frame_width).checked_mul(u64::from(frame_height))?
                        > MAX_DECODED_IMAGE_PIXELS
                {
                    return None;
                }
                let local_packed = descriptor[9];
                offset += 10;
                if local_packed & 0x80 != 0 {
                    offset = offset
                        .checked_add(3usize.checked_mul(1usize << ((local_packed & 0x07) + 1))?)?;
                }
                bytes.get(offset)?; // LZW minimum code size.
                offset += 1;
                offset = skip_gif_sub_blocks(bytes, offset)?;
                frames = frames.checked_add(1)?;
            }
            0x21 => {
                bytes.get(offset + 1)?; // Extension label.
                offset = skip_gif_sub_blocks(bytes, offset + 2)?;
            }
            _ => return None,
        }
    }
    Some((width, height, frames))
}

fn skip_gif_sub_blocks(bytes: &[u8], mut offset: usize) -> Option<usize> {
    loop {
        let length = *bytes.get(offset)? as usize;
        offset += 1;
        if length == 0 {
            return Some(offset);
        }
        offset = offset.checked_add(length)?;
        if offset > bytes.len() {
            return None;
        }
    }
}

fn webp_dimensions_and_frames(bytes: &[u8]) -> Option<(u32, u32, u64)> {
    if bytes.len() < 20 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let (width, height) = match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => (
            1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
            1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
        ),
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => (
            u16::from_le_bytes(bytes[26..28].try_into().ok()?) as u32 & 0x3fff,
            u16::from_le_bytes(bytes[28..30].try_into().ok()?) as u32 & 0x3fff,
        ),
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => (
            1 + u32::from(bytes[21]) + (u32::from(bytes[22] & 0x3f) << 8),
            1 + (u32::from(bytes[22] >> 6)
                | (u32::from(bytes[23]) << 2)
                | (u32::from(bytes[24] & 0x0f) << 10)),
        ),
        _ => return None,
    };
    let mut offset = 12usize;
    let mut animation_frames = 0u64;
    while offset + 8 <= bytes.len() {
        let kind = bytes.get(offset..offset + 4)?;
        let length = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        let end = offset.checked_add(8)?.checked_add(length)?;
        if end > bytes.len() {
            return None;
        }
        if kind == b"ANMF" {
            let payload = bytes.get(offset + 8..end)?;
            if payload.len() < 16 {
                return None;
            }
            let x = 2 * u32::from_le_bytes([payload[0], payload[1], payload[2], 0]);
            let y = 2 * u32::from_le_bytes([payload[3], payload[4], payload[5], 0]);
            let frame_width = 1 + u32::from_le_bytes([payload[6], payload[7], payload[8], 0]);
            let frame_height = 1 + u32::from_le_bytes([payload[9], payload[10], payload[11], 0]);
            if x.checked_add(frame_width)? > width
                || y.checked_add(frame_height)? > height
                || u64::from(frame_width).checked_mul(u64::from(frame_height))?
                    > MAX_DECODED_IMAGE_PIXELS
            {
                return None;
            }
            animation_frames = animation_frames.checked_add(1)?;
        }
        offset = end.checked_add(length & 1)?;
    }
    Some((width, height, animation_frames.max(1)))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        offset += 2;
        if marker == 0xd8 || marker == 0xd9 {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if length < 2 || offset + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) && length >= 7 {
            let height = u16::from_be_bytes(bytes[offset + 3..offset + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[offset + 5..offset + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        offset += length;
    }
    None
}

fn message_generation(
    running_message_ids: &BTreeSet<String>,
    role: &ChatTranscriptMessageRole,
    message: &Arc<Message>,
) -> MessageGeneration {
    if *role != ChatTranscriptMessageRole::Agent {
        return MessageGeneration::Complete;
    }
    if running_message_ids.contains(message_id(message)) {
        MessageGeneration::Streaming
    } else {
        MessageGeneration::Complete
    }
}

fn message_id(message: &Message) -> &str {
    match message {
        Message::User(value) => &value.id,
        Message::Agent(value) | Message::System(value) | Message::Service(value) => &value.id,
    }
}

fn hash_message_revision<H: std::hash::Hasher>(message: &Message, hash: &mut H) {
    use std::hash::Hash;
    std::mem::discriminant(message).hash(hash);
    let (id, metadata, content) = match message {
        Message::User(value) => {
            std::mem::discriminant(&value.status).hash(hash);
            std::mem::discriminant(&value.delivery).hash(hash);
            value.run_id.hash(hash);
            (&value.id, &value.metadata, &value.content)
        }
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            (&value.id, &value.metadata, &value.content)
        }
    };
    id.hash(hash);
    hash_message_parts(metadata, content, hash);
}

fn hash_message_parts<H: std::hash::Hasher>(
    metadata: &MessageMetadata,
    content: &[MessageBlock],
    hash: &mut H,
) {
    use std::hash::Hash;
    metadata.provider_id.hash(hash);
    metadata.model_id.hash(hash);
    metadata.sender_agent_id.hash(hash);
    content.len().hash(hash);
    for block in content {
        match block {
            MessageBlock::Text { text } | MessageBlock::Reasoning { text } => {
                std::mem::discriminant(block).hash(hash);
                text.hash(hash);
            }
            MessageBlock::Image { mime_type, data } => {
                mime_type.hash(hash);
                data.hash(hash);
            }
            // These render through their own authoritative product rows.
            MessageBlock::ToolCallRequest { .. }
            | MessageBlock::ToolCall(_)
            | MessageBlock::Compaction(_) => {}
        }
    }
}

fn hash_bytes_bounded<H: std::hash::Hasher>(bytes: &[u8], hash: &mut H) {
    use std::hash::Hash;
    bytes.len().hash(hash);
    bytes.get(..64).unwrap_or(bytes).hash(hash);
    bytes
        .get(bytes.len().saturating_sub(64)..)
        .unwrap_or(bytes)
        .hash(hash);
}

fn history_message_revisions(
    snapshot: &ChatSnapshot,
    cache: &Rc<RefCell<HistoryRevisionCache>>,
) -> (BTreeMap<String, u64>, BTreeMap<String, u64>) {
    let mut active_pages = BTreeSet::new();
    let mut active_messages = BTreeSet::new();
    let mut active_pending = BTreeSet::new();
    let mut active_revisions = BTreeMap::new();
    let mut active_sources = BTreeMap::new();
    let mut cache = cache.borrow_mut();
    for page in &snapshot.history_pages {
        let identity = Arc::as_ptr(page) as usize;
        active_pages.insert(identity);
        for run in &page.runs {
            active_sources.insert(
                format!("run:{}", run.value.id),
                Arc::as_ptr(run) as *const () as usize as u64,
            );
            for message in &run.messages {
                let source = Arc::as_ptr(message) as *const () as usize;
                active_messages.insert(source);
                active_sources.insert(format!("message:{}", message_id(message)), source as u64);
                let content = match message.as_ref() {
                    Message::User(value) => &value.content,
                    Message::Agent(value) | Message::System(value) | Message::Service(value) => {
                        &value.content
                    }
                };
                for block in content {
                    if let MessageBlock::ToolCall(tool) = block
                        && tool.review.is_some()
                    {
                        active_sources.insert(format!("review:{}", tool.id), source as u64);
                    }
                }
            }
        }
        let cached = cache
            .pages
            .get(&identity)
            .filter(|cached| Arc::ptr_eq(&cached.page, page))
            .map(|cached| cached.message_revisions.clone());
        let revisions = if let Some(cached) = cached {
            cached
        } else {
            let revisions = Arc::new(history_page_message_revisions(page, &mut cache.messages));
            cache.pages.insert(
                identity,
                CachedHistoryPage {
                    page: page.clone(),
                    message_revisions: revisions.clone(),
                },
            );
            revisions
        };
        active_revisions.extend(
            revisions
                .iter()
                .map(|(id, revision)| (id.clone(), *revision)),
        );
    }
    for pending in &snapshot.pending_user_messages {
        let identity = Arc::as_ptr(pending) as usize;
        active_pending.insert(identity);
        active_sources
            .entry(format!("message:{}", pending.id))
            .or_insert(identity as u64);
        let revision = cache
            .pending_messages
            .get(&identity)
            .filter(|cached| Arc::ptr_eq(&cached.message, pending))
            .map(|cached| cached.revision)
            .unwrap_or_else(|| {
                let revision = pending_user_message_revision(pending);
                cache.pending_messages.insert(
                    identity,
                    CachedPendingMessageRevision {
                        message: pending.clone(),
                        revision,
                    },
                );
                revision
            });
        active_revisions
            .entry(format!("message:{}", pending.id))
            .or_insert(revision);
    }
    cache
        .pages
        .retain(|identity, _| active_pages.contains(identity));
    cache
        .messages
        .retain(|identity, _| active_messages.contains(identity));
    cache
        .pending_messages
        .retain(|identity, _| active_pending.contains(identity));
    (active_revisions, active_sources)
}

fn history_page_message_revisions(
    page: &HistoryPage,
    cache: &mut BTreeMap<usize, CachedMessageRevision>,
) -> BTreeMap<String, u64> {
    let mut revisions = BTreeMap::new();
    for run in &page.runs {
        for message in &run.messages {
            let identity = Arc::as_ptr(message) as *const () as usize;
            let revision = cache
                .get(&identity)
                .filter(|cached| Arc::ptr_eq(&cached.message, message))
                .map(|cached| cached.revision)
                .unwrap_or_else(|| {
                    let revision = authoritative_message_revision(message);
                    cache.insert(
                        identity,
                        CachedMessageRevision {
                            message: message.clone(),
                            revision,
                        },
                    );
                    revision
                });
            revisions.insert(format!("message:{}", message_id(message)), revision);
        }
    }
    revisions
}

fn authoritative_message_revision(message: &Message) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    format!("message:{}", message_id(message)).hash(&mut hash);
    message_created_at(message).hash(&mut hash);
    hash_message_revision(message, &mut hash);
    hash.finish()
}

fn pending_user_message_revision(message: &UserMessage) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    format!("message:{}", message.id).hash(&mut hash);
    message.created_at.hash(&mut hash);
    std::mem::discriminant(&message.status).hash(&mut hash);
    std::mem::discriminant(&message.delivery).hash(&mut hash);
    message.run_id.hash(&mut hash);
    hash_message_parts(&message.metadata, &message.content, &mut hash);
    hash.finish()
}

fn message_created_at(message: &Message) -> i64 {
    match message {
        Message::User(value) => value.created_at,
        Message::Agent(value) | Message::System(value) | Message::Service(value) => {
            value.created_at
        }
    }
}

fn row_dynamic_revision(
    row: &crate::chat::ChatTranscriptRow,
    snapshot: &ChatSnapshot,
    running_message_ids: &BTreeSet<String>,
) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    match &row.kind {
        ChatTranscriptRowKind::Message { role, message } => {
            std::mem::discriminant(&message_generation(running_message_ids, role, message))
                .hash(&mut hash);
        }
        ChatTranscriptRowKind::Question { .. } => {
            snapshot.composer.question_selections.len().hash(&mut hash);
            for (prompt_id, selections) in &snapshot.composer.question_selections {
                prompt_id.hash(&mut hash);
                selections.hash(&mut hash);
            }
            std::mem::discriminant(&snapshot.composer.question_submit).hash(&mut hash);
            if let OperationState::Failed { message } = &snapshot.composer.question_submit {
                message.hash(&mut hash);
            }
            std::mem::discriminant(&snapshot.availability).hash(&mut hash);
        }
        ChatTranscriptRowKind::Process { process_id, .. } => {
            if let Some(operation) = snapshot.process_operations.get(process_id.as_ref()) {
                std::mem::discriminant(operation).hash(&mut hash);
                if let OperationState::Failed { message } = operation {
                    message.hash(&mut hash);
                }
            }
            std::mem::discriminant(&snapshot.availability).hash(&mut hash);
        }
        ChatTranscriptRowKind::Block { .. }
        | ChatTranscriptRowKind::Tool { .. }
        | ChatTranscriptRowKind::Review { .. }
        | ChatTranscriptRowKind::Compaction { .. }
        | ChatTranscriptRowKind::Subagent { .. }
        | ChatTranscriptRowKind::RunStatus { .. }
        | ChatTranscriptRowKind::ConversationStatus { .. } => {}
    }
    hash.finish()
}

fn row_revision(
    row: &crate::chat::ChatTranscriptRow,
    cached_message_revision: Option<u64>,
    cached_source_revision: Option<u64>,
) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    product_row_id(&row.id).hash(&mut hash);
    row.created_at.hash(&mut hash);
    if let Some(source) = cached_source_revision
        && matches!(
            row.kind,
            ChatTranscriptRowKind::Block { .. }
                | ChatTranscriptRowKind::Tool { .. }
                | ChatTranscriptRowKind::Compaction { .. }
                | ChatTranscriptRowKind::Review { .. }
                | ChatTranscriptRowKind::Question { .. }
                | ChatTranscriptRowKind::Subagent { .. }
                | ChatTranscriptRowKind::Process { .. }
                | ChatTranscriptRowKind::RunStatus { .. }
        )
    {
        source.hash(&mut hash);
        return hash.finish();
    }
    match &row.kind {
        ChatTranscriptRowKind::Message { message, .. } => {
            if let Some(revision) = cached_message_revision {
                return revision;
            }
            hash_message_revision(message, &mut hash);
        }
        ChatTranscriptRowKind::Block {
            block_index, block, ..
        } => {
            block_index.hash(&mut hash);
            if let MessageBlock::ToolCallRequest { name, arguments } = block.as_ref() {
                name.hash(&mut hash);
                arguments.len().hash(&mut hash);
                for (key, value) in arguments {
                    key.hash(&mut hash);
                    if let Ok(encoded) = serde_json::to_vec(value) {
                        hash_bytes_bounded(&encoded, &mut hash);
                    }
                }
            }
        }
        ChatTranscriptRowKind::Tool { tool, .. } => {
            tool.id.hash(&mut hash);
            std::mem::discriminant(&tool.status).hash(&mut hash);
            match tool.presentation.as_ref() {
                Some(crate::connectivity::chat_protocol::ToolPresentation::ExecCommand {
                    command,
                    output,
                    terminal_id,
                }) => {
                    command.hash(&mut hash);
                    output.hash(&mut hash);
                    terminal_id.hash(&mut hash);
                }
                Some(
                    crate::connectivity::chat_protocol::ToolPresentation::BackgroundTerminalInteraction {
                        command,
                        input,
                        terminal_id,
                    },
                ) => {
                    command.hash(&mut hash);
                    input.hash(&mut hash);
                    terminal_id.hash(&mut hash);
                }
                Some(crate::connectivity::chat_protocol::ToolPresentation::FileDiff {
                    files,
                    omitted_files,
                }) => {
                    omitted_files.hash(&mut hash);
                    for file in files {
                        file.path.hash(&mut hash);
                        file.added.hash(&mut hash);
                        file.deleted.hash(&mut hash);
                        file.hunks.len().hash(&mut hash);
                    }
                }
                Some(crate::connectivity::chat_protocol::ToolPresentation::Search {
                    query,
                    sources,
                    ..
                }) => {
                    query.hash(&mut hash);
                    sources.as_ref().map(Vec::len).hash(&mut hash);
                }
                Some(crate::connectivity::chat_protocol::ToolPresentation::Exploration {
                    operations,
                }) => operations.len().hash(&mut hash),
                None => {
                    if let Some(arguments) = tool.arguments.as_ref() {
                        arguments.len().hash(&mut hash);
                        for (key, value) in arguments {
                            key.hash(&mut hash);
                            if let Ok(encoded) = serde_json::to_vec(value) {
                                hash_bytes_bounded(&encoded, &mut hash);
                            }
                        }
                    }
                }
            }
        }
        ChatTranscriptRowKind::Review { review, .. } => {
            std::mem::discriminant(review.as_ref()).hash(&mut hash);
            match review.as_ref() {
                ToolPermissionReview::Allowed { reason, .. }
                | ToolPermissionReview::Denied { reason, .. }
                | ToolPermissionReview::Unproven { reason, .. } => reason.hash(&mut hash),
            }
        }
        ChatTranscriptRowKind::Compaction { compaction, .. } => {
            std::mem::discriminant(compaction.as_ref()).hash(&mut hash);
            let (_, summary, count) = compaction_model(compaction);
            summary.hash(&mut hash);
            count.hash(&mut hash);
        }
        ChatTranscriptRowKind::Question { status, .. } => {
            std::mem::discriminant(status).hash(&mut hash)
        }
        ChatTranscriptRowKind::Subagent { status, title, .. } => {
            std::mem::discriminant(status).hash(&mut hash);
            title.hash(&mut hash);
        }
        ChatTranscriptRowKind::Process {
            status,
            exit_code,
            command,
            ..
        } => {
            std::mem::discriminant(status).hash(&mut hash);
            exit_code.hash(&mut hash);
            command.hash(&mut hash);
        }
        ChatTranscriptRowKind::RunStatus { status, .. } => {
            std::mem::discriminant(status).hash(&mut hash)
        }
        ChatTranscriptRowKind::ConversationStatus { load, availability } => {
            std::mem::discriminant(load).hash(&mut hash);
            if let LoadState::Error { message } = load {
                message.hash(&mut hash);
            }
            std::mem::discriminant(availability).hash(&mut hash);
            if let ChatAvailability::Unavailable { reason } = availability {
                reason.hash(&mut hash);
            }
        }
    }
    hash.finish()
}

fn product_row_source_key(row: &crate::chat::ChatTranscriptRow) -> Option<String> {
    match &row.kind {
        ChatTranscriptRowKind::Message { .. } => Some(product_row_id(&row.id)),
        ChatTranscriptRowKind::Block { message_id, .. }
        | ChatTranscriptRowKind::Tool { message_id, .. }
        | ChatTranscriptRowKind::Compaction { message_id, .. } => {
            Some(format!("message:{message_id}"))
        }
        ChatTranscriptRowKind::Question { .. }
        | ChatTranscriptRowKind::Subagent { .. }
        | ChatTranscriptRowKind::Process { .. }
        | ChatTranscriptRowKind::RunStatus { .. } => Some(product_row_id(&row.id)),
        ChatTranscriptRowKind::Review { .. } => Some(product_row_id(&row.id)),
        ChatTranscriptRowKind::ConversationStatus { .. } => None,
    }
}

fn product_row_id(id: &ProductRowId) -> String {
    match id {
        ProductRowId::Message(id) => format!("message:{id}"),
        ProductRowId::Block { message_id, index } => format!("block:{message_id}:{index}"),
        ProductRowId::Tool(id) => format!("tool:{id}"),
        ProductRowId::Review(id) => format!("review:{id}"),
        ProductRowId::Compaction { message_id, index } => {
            format!("compaction:{message_id}:{index}")
        }
        ProductRowId::Question(id) => format!("question:{id}"),
        ProductRowId::Subagent(id) => format!("subagent:{id}"),
        ProductRowId::Process(id) => format!("process:{id}"),
        ProductRowId::RunStatus(id) => format!("run:{id}"),
        ProductRowId::ConversationStatus => "conversation:status".into(),
    }
}

fn agent_status(status: &AgentStatus) -> &'static str {
    match status {
        AgentStatus::Idle => "idle",
        AgentStatus::Thinking => "thinking",
        AgentStatus::Working => "working",
        AgentStatus::GeneratingTools => "generating tools",
        AgentStatus::RunningTools => "running tools",
    }
}
fn run_status(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Completed => "completed",
        RunStatus::Aborted => "aborted",
        RunStatus::Failed => "failed",
    }
}
fn conversation_status(
    load: &LoadState,
    availability: &ChatAvailability,
) -> (String, Option<String>, SemanticTone) {
    match availability {
        ChatAvailability::Unavailable { reason } => (
            "Happy Agent unavailable".into(),
            Some(reason.to_string()),
            SemanticTone::Warning,
        ),
        ChatAvailability::Online => match load {
            LoadState::Initial | LoadState::Loading => {
                ("Loading conversation".into(), None, SemanticTone::Info)
            }
            LoadState::Ready => (
                "Conversation up to date".into(),
                None,
                SemanticTone::Success,
            ),
            LoadState::Error { message } => (
                "Conversation could not refresh".into(),
                Some(message.to_string()),
                SemanticTone::Error,
            ),
        },
    }
}

impl ChatWorkspaceSurface {
    fn chat_entity(&self, key: &ConversationKey, cx: &App) -> Option<Entity<ChatStore>> {
        self.connectivity.read(cx).chat(key, cx)
    }

    fn send_handler(&self, key: ConversationKey) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            let Some(chat) = connectivity.read(cx).chat(&key, cx) else {
                return;
            };
            let running = chat
                .read(cx)
                .snapshot()
                .history_pages
                .iter()
                .rev()
                .flat_map(|p| p.runs.iter().rev())
                .any(|run| run.value.status == RunStatus::Running);
            let id = ClientMessageId::new(cuid2::create_id())
                .expect("cuid2 is a valid client message id");
            let mutation = ChatMutationId::new(format!("send-{}", cuid2::create_id()))
                .expect("generated mutation id is nonempty");
            chat.update(cx, |store, cx| {
                if running {
                    store.message_steer(id, mutation);
                } else {
                    store.message_submit(id, mutation);
                }
                cx.notify();
            });
        })
    }

    fn abort_handler(&self, key: ConversationKey) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            let Some(chat) = connectivity.read(cx).chat(&key, cx) else {
                return;
            };
            let run = chat
                .read(cx)
                .snapshot()
                .history_pages
                .iter()
                .rev()
                .flat_map(|p| p.runs.iter().rev())
                .find(|run| run.value.status == RunStatus::Running)
                .map(|run| Arc::from(run.value.id.as_str()));
            let mutation = ChatMutationId::new(format!("abort-{}", cuid2::create_id()))
                .expect("generated mutation id is nonempty");
            chat.update(cx, |store, cx| {
                store.abort(run, mutation);
                cx.notify();
            });
        })
    }

    fn retry_send_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                chat.update(cx, |store, cx| {
                    store.message_send_retry();
                    cx.notify();
                });
            }
        })
    }

    fn attach_handler(
        &self,
        key: ConversationKey,
        surface: Entity<Self>,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            let prompt = cx.prompt_for_paths(PathPromptOptions {
                files: true,
                directories: false,
                multiple: true,
                prompt: Some("Choose inline images".into()),
            });
            let executor = cx.background_executor().clone();
            let connectivity = connectivity.clone();
            let key = key.clone();
            let surface = surface.clone();
            cx.spawn(async move |cx| {
                let Ok(Ok(Some(paths))) = prompt.await else {
                    return;
                };
                let Ok(existing_files) = surface.update(cx, |this, _| {
                    this.local_attachments
                        .get(&key)
                        .map(|items| {
                            items
                                .values()
                                .filter(|preview| preview.omitted_count == 0)
                                .count()
                        })
                        .unwrap_or(0)
                }) else {
                    return;
                };
                let available = MAX_LOCAL_ATTACHMENT_FILES.saturating_sub(existing_files);
                let omitted = paths.len().saturating_sub(available);
                let paths: Vec<_> = paths.into_iter().take(available).collect();
                if omitted > 0 {
                    let _ = surface.update(cx, |this, cx| {
                        omitted_attachment_record(
                            this.local_attachments.entry(key.clone()).or_default(),
                            omitted,
                        );
                        this.viewport_resized(cx);
                        cx.notify();
                    });
                }
                let loaded = executor
                    .spawn(async move {
                        paths
                            .into_iter()
                            .map(|path| {
                                let id = AttachmentId::new(format!("image-{}", cuid2::create_id()))
                                    .expect("generated attachment id is nonempty");
                                let name: Arc<str> = Arc::from(
                                    path.file_name()
                                        .and_then(|value| value.to_str())
                                        .unwrap_or("image"),
                                );
                                let loaded = inline_image_file(&path).map(|(mime, bytes, decoded_bytes)| {
                                    let byte_size = bytes.len() as u64;
                                    let image = Arc::new(Image::from_bytes(
                                        inline_image_format(mime),
                                        bytes.clone(),
                                    ));
                                    (
                                        mime,
                                        Arc::<str>::from(BASE64.encode(&bytes)),
                                        byte_size,
                                        image,
                                        decoded_bytes,
                                    )
                                });
                                (id, name, path, loaded)
                            })
                            .collect::<Vec<_>>()
                    })
                    .await;
                for (id, name, path, loaded) in loaded {
                    let failure = loaded.as_ref().err().cloned();
                    let image = loaded.as_ref().ok().map(|value| value.3.clone());
                    let decoded_bytes = loaded.as_ref().ok().map(|value| value.4).unwrap_or(0);
                    let mut preview = LocalAttachmentPreview {
                        id: id.clone(),
                        name: name.clone(),
                        path,
                        image,
                        decoded_bytes,
                        failure,
                        omitted_count: 0,
                    };
                    let inserted = surface
                        .update(cx, |this, cx| {
                            let decoded_total: u64 = this
                                .local_attachments
                                .values()
                                .flat_map(BTreeMap::values)
                                .map(|preview| preview.decoded_bytes)
                                .sum();
                            let items = this.local_attachments.entry(key.clone()).or_default();
                            let file_count = items
                                .values()
                                .filter(|preview| preview.omitted_count == 0)
                                .count();
                            if file_count >= MAX_LOCAL_ATTACHMENT_FILES {
                                omitted_attachment_record(items, 1);
                                let focus_ids: Vec<_> = items.keys().cloned().collect();
                                if let Some(ui) = this.ui.get_mut(&key) {
                                    for focus_id in focus_ids {
                                        ui.attachment_action_focus
                                            .entry(focus_id)
                                            .or_insert_with(|| AttachmentActionFocus {
                                                open: cx.focus_handle(),
                                                remove: cx.focus_handle(),
                                                retry: cx.focus_handle(),
                                            });
                                    }
                                }
                                this.viewport_resized(cx);
                                cx.notify();
                                false
                            } else {
                                let admitted = decoded_total
                                    .checked_add(preview.decoded_bytes)
                                    .is_some_and(|total| {
                                        total <= MAX_DECODED_LOCAL_ATTACHMENT_BYTES
                                    });
                                if !admitted {
                                    preview.image = None;
                                    preview.decoded_bytes = 0;
                                    preview.failure = Some(Arc::from(format!(
                                        "Decoded local image previews are limited to {MAX_DECODED_LOCAL_ATTACHMENT_BYTES} bytes. Remove another image and retry."
                                    )));
                                }
                                items.insert(id.clone(), preview);
                                if let Some(ui) = this.ui.get_mut(&key) {
                                    ui.attachment_action_focus
                                        .entry(id.clone())
                                        .or_insert_with(|| AttachmentActionFocus {
                                            open: cx.focus_handle(),
                                            remove: cx.focus_handle(),
                                            retry: cx.focus_handle(),
                                        });
                                }
                                this.viewport_resized(cx);
                                cx.notify();
                                admitted
                            }
                        })
                        .unwrap_or(false);
                    if !inserted {
                        continue;
                    }
                    if let Ok((mime, data, byte_size, _, _)) = loaded {
                        let rejection = connectivity
                            .update(cx, |controller, cx| {
                                controller.chat(&key, cx).and_then(|chat| {
                                    chat.update(cx, |store, cx| {
                                        let result =
                                            store.image_attachment_add(InlineImageAttachment {
                                                id: id.clone(),
                                                name: name.clone(),
                                                mime_type: Arc::from(mime),
                                                data,
                                                byte_size,
                                                state: AttachmentState::Ready,
                                            });
                                        cx.notify();
                                        result.err()
                                    })
                                })
                            })
                            .ok()
                            .flatten();
                        if let Some(rejection) = rejection {
                            let _ = surface.update(cx, |this, cx| {
                                if let Some(preview) = this
                                    .local_attachments
                                    .get_mut(&key)
                                    .and_then(|items| items.get_mut(&id))
                                {
                                    preview.failure =
                                        Some(attachment_rejection_message(&rejection));
                                }
                                this.viewport_resized(cx);
                                cx.notify();
                            });
                        }
                    }
                }
            })
            .detach();
        })
    }

    fn attachment_retry_handler(
        &self,
        key: ConversationKey,
        surface: Entity<Self>,
        composer_focus: FocusHandle,
    ) -> crate::ui::composer_controls::IdHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |id, window, cx| {
            window.focus(&composer_focus);
            let Some(id) = AttachmentId::new(id.as_ref()) else {
                return;
            };
            let local = surface
                .read(cx)
                .local_attachments
                .get(&key)
                .and_then(|items| items.get(&id))
                .cloned();
            let Some(local) = local else {
                if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                    chat.update(cx, |store, cx| {
                        store.image_attachment_retry(&id);
                        cx.notify();
                    });
                }
                return;
            };
            if local.omitted_count > 0 {
                return;
            }
            let executor = cx.background_executor().clone();
            let connectivity = connectivity.clone();
            let key = key.clone();
            let surface = surface.clone();
            cx.spawn(async move |cx| {
                let path = local.path.clone();
                let loaded = executor
                    .spawn(async move { inline_image_file(&path) })
                    .await;
                match loaded {
                    Ok((mime, bytes, decoded_bytes)) => {
                        let byte_size = bytes.len() as u64;
                        let image =
                            Arc::new(Image::from_bytes(inline_image_format(mime), bytes.clone()));
                        let admitted = surface
                            .update(cx, |this, cx| {
                                let decoded_total: u64 = this
                                    .local_attachments
                                    .values()
                                    .flat_map(BTreeMap::values)
                                    .filter(|preview| preview.image.is_some())
                                    .map(|preview| preview.decoded_bytes)
                                    .sum::<u64>()
                                    .saturating_sub(
                                        this.local_attachments
                                            .get(&key)
                                            .and_then(|items| items.get(&id))
                                            .filter(|preview| preview.image.is_some())
                                            .map(|preview| preview.decoded_bytes)
                                            .unwrap_or(0),
                                    );
                                let admitted = decoded_total
                                    .checked_add(decoded_bytes)
                                    .is_some_and(|total| {
                                        total <= MAX_DECODED_LOCAL_ATTACHMENT_BYTES
                                    });
                                if let Some(preview) = this
                                    .local_attachments
                                    .get_mut(&key)
                                    .and_then(|items| items.get_mut(&id))
                                {
                                    if admitted {
                                        if let Some(previous) = preview.image.replace(image) {
                                            previous.remove_asset(cx);
                                        }
                                        preview.decoded_bytes = decoded_bytes;
                                        preview.failure = None;
                                    } else {
                                        preview.failure = Some(Arc::from(format!(
                                            "Decoded local image previews are limited to {MAX_DECODED_LOCAL_ATTACHMENT_BYTES} bytes. Remove another image and retry."
                                        )));
                                    }
                                }
                                this.viewport_resized(cx);
                                cx.notify();
                                admitted
                            })
                            .unwrap_or(false);
                        if !admitted {
                            return;
                        }
                        let data: Arc<str> = Arc::from(BASE64.encode(&bytes));
                        let rejection = connectivity
                            .update(cx, |controller, cx| {
                                controller.chat(&key, cx).and_then(|chat| {
                                    chat.update(cx, |store, cx| {
                                        store.image_attachment_remove(&id);
                                        let result =
                                            store.image_attachment_add(InlineImageAttachment {
                                                id: id.clone(),
                                                name: local.name.clone(),
                                                mime_type: Arc::from(mime),
                                                data,
                                                byte_size,
                                                state: AttachmentState::Ready,
                                            });
                                        cx.notify();
                                        result.err()
                                    })
                                })
                            })
                            .ok()
                            .flatten();
                        let _ = surface.update(cx, |this, cx| {
                            if let Some(preview) = this
                                .local_attachments
                                .get_mut(&key)
                                .and_then(|items| items.get_mut(&id))
                            {
                                preview.failure =
                                    rejection.as_ref().map(attachment_rejection_message);
                            }
                            this.viewport_resized(cx);
                            cx.notify();
                        });
                    }

                    Err(message) => {
                        let _ = surface.update(cx, |this, cx| {
                            if let Some(preview) = this
                                .local_attachments
                                .get_mut(&key)
                                .and_then(|items| items.get_mut(&id))
                            {
                                preview.failure = Some(message);
                            }
                            this.viewport_resized(cx);
                            cx.notify();
                        });
                    }
                }
            })
            .detach();
        })
    }

    fn cycle_model_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                let snapshot = chat.read(cx).snapshot().clone();
                let catalog = chat.read(cx).model_catalog().clone();
                let choices: Vec<_> = catalog
                    .providers
                    .iter()
                    .flat_map(|p| p.models.iter().map(move |m| (p, m)))
                    .collect();
                if choices.is_empty() {
                    return;
                }
                let current = snapshot.composer.mode.as_ref();
                let index = choices
                    .iter()
                    .position(|(p, m)| {
                        current.is_some_and(|v| {
                            v.provider_id == p.id.as_ref() && v.model_id == m.id.as_ref()
                        })
                    })
                    .unwrap_or(choices.len() - 1);
                let (provider, model) = choices[(index + 1) % choices.len()];
                let mutation = ChatMutationId::new(format!("model-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                chat.update(cx, |store, cx| {
                    store.model_update(&provider.id, &model.id, mutation);
                    cx.notify();
                });
            }
        })
    }

    fn cycle_effort_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                let snapshot = chat.read(cx).snapshot().clone();
                let Some(mode) = snapshot.composer.mode.as_ref() else {
                    return;
                };
                let catalog = chat.read(cx).model_catalog().clone();
                let Some(model) = catalog
                    .providers
                    .iter()
                    .find(|p| p.id.as_ref() == mode.provider_id)
                    .and_then(|p| p.models.iter().find(|m| m.id.as_ref() == mode.model_id))
                else {
                    return;
                };
                let index = model
                    .efforts
                    .iter()
                    .position(|v| v.as_ref() == mode.effort)
                    .unwrap_or(model.efforts.len().saturating_sub(1));
                let Some(effort) = model.efforts.get((index + 1) % model.efforts.len().max(1))
                else {
                    return;
                };
                let mutation = ChatMutationId::new(format!("effort-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                chat.update(cx, |store, cx| {
                    store.effort_update(effort, mutation);
                    cx.notify();
                });
            }
        })
    }

    fn cycle_permission_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                let snapshot = chat.read(cx).snapshot().clone();
                let modes = chat.read(cx).model_catalog().permission_modes.clone();
                if modes.is_empty() {
                    return;
                }
                let current = snapshot.composer.mode.as_ref().map(|v| v.permission_mode);
                let index = modes
                    .iter()
                    .position(|v| Some(*v) == current)
                    .unwrap_or(modes.len() - 1);
                let mode = modes[(index + 1) % modes.len()];
                let mutation = ChatMutationId::new(format!("permission-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                chat.update(cx, |store, cx| {
                    store.permission_update(mode, mutation);
                    cx.notify();
                });
            }
        })
    }

    fn cycle_tier_handler(
        &self,
        key: ConversationKey,
    ) -> crate::ui::composer_controls::ComposerHandler {
        let connectivity = self.connectivity.clone();
        Rc::new(move |_, cx| {
            if let Some(chat) = connectivity.read(cx).chat(&key, cx) {
                let snapshot = chat.read(cx).snapshot().clone();
                let Some(mode) = snapshot.composer.mode.as_ref() else {
                    return;
                };
                let catalog = chat.read(cx).model_catalog().clone();
                let Some(provider) = catalog
                    .providers
                    .iter()
                    .find(|p| p.id.as_ref() == mode.provider_id)
                else {
                    return;
                };
                let index = mode
                    .service_tier
                    .as_ref()
                    .and_then(|tier| {
                        provider
                            .service_tiers
                            .iter()
                            .position(|v| v.as_ref() == tier)
                    })
                    .map(|v| v + 1)
                    .unwrap_or(0);
                let choices = provider.service_tiers.len() + 1;
                let next = (index + 1) % choices;
                let tier = next
                    .checked_sub(1)
                    .and_then(|v| provider.service_tiers.get(v))
                    .map(AsRef::as_ref);
                let mutation = ChatMutationId::new(format!("tier-{}", cuid2::create_id()))
                    .expect("generated mutation id is nonempty");
                chat.update(cx, |store, cx| {
                    store.tier_update(tier, mutation);
                    cx.notify();
                });
            }
        })
    }
}

fn inline_image_format(mime: &str) -> ImageFormat {
    match mime {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::Webp,
        "image/gif" => ImageFormat::Gif,
        _ => unreachable!("validated inline image MIME"),
    }
}

fn inline_image_file(path: &Path) -> Result<(&'static str, Vec<u8>, u64), Arc<str>> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let mime = match extension.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err(Arc::from("This file is not a supported inline image.")),
    };
    let file = File::open(path)
        .map_err(|error| Arc::from(format!("Could not read this file: {error}")))?;
    let metadata = file
        .metadata()
        .map_err(|error| Arc::from(format!("Could not inspect this file: {error}")))?;
    if !metadata.is_file() {
        return Err(Arc::from("This selection is not a file."));
    }
    if metadata.len() > crate::chat::MAX_INLINE_IMAGE_BYTES {
        return Err(Arc::from(format!(
            "This image is larger than the {} byte limit.",
            crate::chat::MAX_INLINE_IMAGE_BYTES
        )));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(crate::chat::MAX_INLINE_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| Arc::from(format!("Could not read this file: {error}")))?;
    if bytes.len() > crate::chat::MAX_INLINE_IMAGE_BYTES as usize {
        return Err(Arc::from(format!(
            "This image is larger than the {} byte limit.",
            crate::chat::MAX_INLINE_IMAGE_BYTES
        )));
    }
    let valid = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Err(Arc::from("The file contents do not match its image type."));
    }
    let (_, _, decoded_bytes) = validate_decoded_image(mime, &bytes)?;
    Ok((mime, bytes, decoded_bytes))
}

fn attachment_rejection_message(rejection: &AttachmentRejection) -> Arc<str> {
    Arc::from(match rejection {
        AttachmentRejection::DuplicateId => "This image is already attached.".to_owned(),
        AttachmentRejection::EmptyData => "The selected image is empty.".to_owned(),
        AttachmentRejection::InvalidBase64 => "The selected image could not be encoded.".to_owned(),
        AttachmentRejection::SizeMismatch => {
            "The selected image changed while it was read.".to_owned()
        }
        AttachmentRejection::UnsupportedMimeType => "This image type is not supported.".to_owned(),
        AttachmentRejection::TooLarge { limit } => {
            format!("This image is larger than the {limit} byte limit.")
        }
    })
}

impl Render for ChatWorkspaceSurface {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let workspace = self.workspace.read(cx).snapshot().clone();
        let focused = self.focused_conversation.clone();
        let chat = focused.as_ref().and_then(|key| self.chat_entity(key, cx));
        let chat_snapshot = chat.as_ref().map(|store| store.read(cx).snapshot().clone());
        let entity = cx.entity();

        let server_available = self.catalog_facts.unavailable_reason.is_none()
            && chat_snapshot
                .as_ref()
                .is_some_and(|snapshot| matches!(snapshot.availability, ChatAvailability::Online));
        let header_status = if let Some(reason) = self.catalog_facts.unavailable_reason.clone() {
            Some(ProjectHeaderStatus {
                label: reason,
                tone: ProjectStatusTone::Unavailable,
            })
        } else if let Some(snapshot) = chat_snapshot.as_ref() {
            match &snapshot.availability {
                ChatAvailability::Online => None,
                ChatAvailability::Unavailable { reason } => Some(ProjectHeaderStatus {
                    label: reason.to_string().into(),
                    tone: ProjectStatusTone::Unavailable,
                }),
            }
        } else {
            None
        };
        let header_key = focused.clone();
        let header_entity = entity.clone();
        let header = ChatHeader {
            id: format!("workspace-header:{}", self.workspace_key.id()).into(),
            theme: self.theme,
            title: self.labels.workspace_name.clone(),
            location: self.labels.workspace_location.clone(),
            status: header_status,
            actions: vec![
                ProjectHeaderAction {
                    id: "mark-read".into(),
                    label: "Mark read".into(),
                    icon: IconName::Check,
                    disabled: chat.is_none() || !server_available,
                    selected: false,
                },
                ProjectHeaderAction {
                    id: "archive".into(),
                    label: "Archive session".into(),
                    icon: IconName::Archive,
                    disabled: focused.is_none()
                        || !server_available
                        || workspace.behavior == WorkspaceBehavior::BotSingleChat,
                    selected: false,
                },
                ProjectHeaderAction {
                    id: "files-panel".into(),
                    label: if self.inspector_visible {
                        "Collapse Files"
                    } else {
                        "Expand Files"
                    }
                    .into(),
                    icon: if self.inspector_visible {
                        IconName::PanelCollapse
                    } else {
                        IconName::PanelExpand
                    },
                    disabled: false,
                    selected: self.inspector_visible,
                },
                ProjectHeaderAction {
                    id: "file-to-inspector".into(),
                    label: "Move file to Files panel".into(),
                    icon: IconName::PanelExpand,
                    disabled: !matches!(workspace.active_tab, Some(WorkspaceTab::File(_))),
                    selected: false,
                },
            ],
            on_action: Some(Rc::new(move |id, _, cx| {
                let header_entity = header_entity.clone();
                let header_key = header_key.clone();
                let id = id.clone();
                cx.defer(move |cx| {
                    header_entity.update(cx, |this, cx| {
                        if id.as_ref() == "files-panel" {
                            this.inspector_visible = !this.inspector_visible;
                            this.files.update(cx, |files, cx| {
                                files.inspector_visible_reconcile(this.inspector_visible, cx)
                            });
                            cx.notify();
                            return;
                        }
                        if id.as_ref() == "file-to-inspector" {
                            let active = this.workspace.read(cx).snapshot().active_tab.clone();
                            if let Some(WorkspaceTab::File(key)) = active {
                                let path = key.path().clone();
                                let kind = this
                                    .workspace
                                    .read(cx)
                                    .snapshot()
                                    .file_tab_presentations
                                    .get(&key)
                                    .copied()
                                    .map(|kind| {
                                        if kind == FileTabPresentation::Diff {
                                            FileKind::Diff
                                        } else {
                                            FileKind::File
                                        }
                                    })
                                    .unwrap_or(FileKind::File);
                                this.workspace.update(cx, |store, cx| {
                                    store.tab_close(&WorkspaceTab::File(key));
                                    cx.notify();
                                });
                                this.desired_file = None;
                                let fallback =
                                    this.workspace.read(cx).snapshot().active_tab.clone();
                                match fallback {
                                    Some(WorkspaceTab::Conversation(conversation)) => this
                                        .navigate_after_update(
                                            ChatWorkspaceNavigation::Conversation(
                                                CreatedChatNavigation {
                                                    workspace: this.workspace_key.clone(),
                                                    conversation,
                                                },
                                            ),
                                            cx,
                                        ),
                                    Some(WorkspaceTab::File(key)) => {
                                        let fallback_kind = this
                                            .workspace
                                            .read(cx)
                                            .snapshot()
                                            .file_tab_presentations
                                            .get(&key)
                                            .copied()
                                            .map(|kind| {
                                                if kind == FileTabPresentation::Diff {
                                                    FileKind::Diff
                                                } else {
                                                    FileKind::File
                                                }
                                            })
                                            .unwrap_or(FileKind::File);
                                        this.navigate_after_update(
                                            ChatWorkspaceNavigation::File {
                                                workspace: this.workspace_key.clone(),
                                                path: key.path().clone(),
                                                kind: fallback_kind,
                                            },
                                            cx,
                                        );
                                    }
                                    Some(tab @ WorkspaceTab::Tool(_)) => this
                                        .navigate_after_update(
                                            ChatWorkspaceNavigation::WorkspaceTab {
                                                workspace: this.workspace_key.clone(),
                                                tab,
                                            },
                                            cx,
                                        ),
                                    None => this.navigate_after_update(
                                        ChatWorkspaceNavigation::Workspace(
                                            this.workspace_key.clone(),
                                        ),
                                        cx,
                                    ),
                                }
                                this.inspector_visible = true;
                                this.files.update(cx, |files, cx| {
                                    files.inspector_visible_reconcile(true, cx);
                                    files.route_preview_reconcile(Some((path, kind)), cx);
                                });
                                this.route_reconcile(cx);
                                cx.notify();
                            }
                            return;
                        }
                        let Some(key) = header_key.clone() else {
                            return;
                        };
                        match id.as_ref() {
                            "mark-read" => {
                                if let Some(chat) = this.chat_entity(&key, cx) {
                                    let mutation =
                                        ChatMutationId::new(this.next_mutation("mark-read"))
                                            .expect("mutation is nonempty");
                                    chat.update(cx, |store, cx| {
                                        store.mark_read(mutation);
                                        cx.notify();
                                    });
                                }
                            }
                            "archive" => {
                                let snapshot = this.workspace.read(cx).snapshot().clone();
                                let fallback = conversation_fallback(
                                    &snapshot.tabs,
                                    &snapshot.activation_history,
                                    &key,
                                );
                                let mutation = MutationId::new(this.next_mutation("archive"))
                                    .expect("mutation is nonempty");
                                this.workspace.update(cx, |store, cx| {
                                    store.conversation_archive(&key, mutation);
                                    cx.notify();
                                });
                                match fallback {
                                    Some(conversation) => this.navigate_after_update(
                                        ChatWorkspaceNavigation::Conversation(
                                            CreatedChatNavigation {
                                                workspace: this.workspace_key.clone(),
                                                conversation,
                                            },
                                        ),
                                        cx,
                                    ),
                                    None => this.navigate_after_update(
                                        ChatWorkspaceNavigation::Workspace(
                                            this.workspace_key.clone(),
                                        ),
                                        cx,
                                    ),
                                }
                            }
                            _ => {}
                        }
                    });
                });
            })),
        };

        let tabs = workspace
            .tabs
            .iter()
            .map(|tab| {
                let (id, label, kind, status, closable) = match tab {
                    WorkspaceTab::Conversation(key) => {
                        let row = workspace.conversations.get(key);
                        let label = row
                            .and_then(|r| r.label.clone())
                            .unwrap_or_else(|| Arc::from("New chat"));
                        let status = row
                            .map(|r| r.status)
                            .unwrap_or(CatalogConversationStatus::Idle);
                        (
                            tab_id(tab),
                            label.to_string(),
                            WorkspaceTabKind::Session,
                            status,
                            workspace.behavior != WorkspaceBehavior::BotSingleChat,
                        )
                    }
                    WorkspaceTab::File(key) => (
                        tab_id(tab),
                        key.as_str().to_owned(),
                        WorkspaceTabKind::File,
                        CatalogConversationStatus::Idle,
                        true,
                    ),
                    WorkspaceTab::Tool(key) => (
                        tab_id(tab),
                        key.as_str().to_owned(),
                        WorkspaceTabKind::Activity,
                        CatalogConversationStatus::Idle,
                        true,
                    ),
                };
                WorkspaceTabItem {
                    id: id.into(),
                    label: label.into(),
                    kind,
                    active: workspace.active_tab.as_ref() == Some(tab),
                    preview: matches!(tab, WorkspaceTab::File(key) if workspace.ephemeral_file_tab.as_ref() == Some(key)),
                    dirty: match tab {
                        WorkspaceTab::File(key) => self
                            .files
                            .read(cx)
                            .document(key.path())
                            .is_some_and(|doc| doc.read(cx).dirty(cx)),
                        WorkspaceTab::Conversation(_) | WorkspaceTab::Tool(_) => false,
                    },
                    unread: match tab {
                        WorkspaceTab::Conversation(key) => workspace
                            .conversations
                            .get(key)
                            .and_then(|r| r.unread.as_ref())
                            .is_some(),
                        _ => false,
                    },
                    waiting: false,
                    running: status != CatalogConversationStatus::Idle,
                    disabled: false,
                    closable,
                }
            })
            .collect();
        let mut recent_keys: Vec<_> = workspace
            .tabs
            .iter()
            .filter_map(|tab| match tab {
                WorkspaceTab::Conversation(key) => Some(key.clone()),
                WorkspaceTab::File(_) | WorkspaceTab::Tool(_) => None,
            })
            .chain(workspace.archived_recents.iter().cloned())
            .collect();
        recent_keys.sort();
        recent_keys.dedup();
        recent_keys.sort_by(|a, b| {
            let a_row = workspace.conversations.get(a);
            let b_row = workspace.conversations.get(b);
            let a_mru = workspace
                .activation_history
                .iter()
                .rposition(|tab| matches!(tab, WorkspaceTab::Conversation(key) if key == a));
            let b_mru = workspace
                .activation_history
                .iter()
                .rposition(|tab| matches!(tab, WorkspaceTab::Conversation(key) if key == b));
            b_row
                .map(|row| row.updated_at)
                .cmp(&a_row.map(|row| row.updated_at))
                .then_with(|| b_mru.cmp(&a_mru))
                .then_with(|| a.cmp(b))
        });
        let select_entity = entity.clone();
        let close_entity = entity.clone();
        let move_entity = entity.clone();
        let create_entity = entity.clone();
        let recent_entity = entity.clone();
        let recent_select_entity = entity.clone();
        let tabs_view = WorkspaceTabs {
            id: format!("workspace-tabs:{}", self.workspace_key.id()).into(),
            theme: self.theme,
            tabs,
            create: (workspace.behavior == WorkspaceBehavior::Standard).then_some(
                WorkspaceCreateAffordance {
                    label: "Create a session".into(),
                    disabled: self.catalog_facts.unavailable_reason.is_some()
                        || matches!(workspace.session_create, AsyncActionState::Pending { .. }),
                },
            ),
            recent: Some(RecentSessionsAffordance {
                label: "Recent sessions".into(),
                open: self.recent_open,
                items: recent_keys
                    .iter()
                    .filter_map(|key| {
                        workspace.conversations.get(key).map(|row| {
                            let active = workspace
                                .tabs
                                .contains(&WorkspaceTab::Conversation(key.clone()));
                            RecentSessionItem {
                                id: format!("conversation:{}", key.id()).into(),
                                label: row
                                    .label
                                    .clone()
                                    .unwrap_or_else(|| Arc::from("Recent chat"))
                                    .to_string()
                                    .into(),
                                detail: Some(if active { "Active" } else { "Archived" }.into()),
                                disabled: !active
                                    && self.catalog_facts.unavailable_reason.is_some(),
                            }
                        })
                    })
                    .collect(),
            }),
            tabs_scrollbar: self.tabs_scrollbar.clone(),
            recent_scrollbar: self.recent_open.then(|| self.recent_scrollbar.clone()),
            on_select: Some(Rc::new(move |id, _window, cx| {
                select_entity.update(cx, |this, cx| {
                    let snapshot = this.workspace.read(cx).snapshot().clone();
                    if let Some(tab) = snapshot
                        .tabs
                        .iter()
                        .find(|tab| tab_id(tab) == id.as_ref())
                        .cloned()
                    {
                        this.workspace.update(cx, |store, cx| {
                            store.tab_activate(&tab);
                            cx.notify();
                        });
                        match tab {
                            WorkspaceTab::Conversation(conversation) => {
                                this.desired_conversation = Some(conversation.clone());
                                this.route_reconcile(cx);
                                (this.on_navigate)(
                                    ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                                        workspace: this.workspace_key.clone(),
                                        conversation,
                                    }),
                                    cx,
                                );
                            }
                            WorkspaceTab::File(key) => {
                                this.desired_conversation = None;
                                let presentation = this
                                    .workspace
                                    .read(cx)
                                    .snapshot()
                                    .file_tab_presentations
                                    .get(&key)
                                    .copied()
                                    .unwrap_or_default();
                                let kind = if presentation == FileTabPresentation::Diff {
                                    FileKind::Diff
                                } else {
                                    FileKind::File
                                };
                                this.desired_file = Some((key.path().clone(), kind));
                                this.focus_conversation(None, cx);
                                (this.on_navigate)(
                                    ChatWorkspaceNavigation::File {
                                        workspace: this.workspace_key.clone(),
                                        path: key.path().clone(),
                                        kind,
                                    },
                                    cx,
                                );
                            }
                            tab @ WorkspaceTab::Tool(_) => {
                                this.desired_conversation = None;
                                this.desired_file = None;
                                this.focus_conversation(None, cx);
                                (this.on_navigate)(
                                    ChatWorkspaceNavigation::WorkspaceTab {
                                        workspace: this.workspace_key.clone(),
                                        tab,
                                    },
                                    cx,
                                );
                            }
                        }
                    }
                });
            })),
            on_close: Some(Rc::new(move |id, _, cx| {
                close_entity.update(cx, |this, cx| {
                    let snapshot = this.workspace.read(cx).snapshot().clone();
                    let Some(tab) = snapshot
                        .tabs
                        .iter()
                        .find(|tab| tab_id(tab) == id.as_ref())
                        .cloned()
                    else {
                        return;
                    };
                    if let WorkspaceTab::Conversation(key) = &tab {
                        let fallback = conversation_fallback(
                            &snapshot.tabs,
                            &snapshot.activation_history,
                            key,
                        );
                        let mutation = MutationId::new(this.next_mutation("archive"))
                            .expect("mutation is nonempty");
                        this.workspace.update(cx, |store, cx| {
                            store.conversation_archive(key, mutation);
                            cx.notify();
                        });
                        match fallback {
                            Some(conversation) => (this.on_navigate)(
                                ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                                    workspace: this.workspace_key.clone(),
                                    conversation,
                                }),
                                cx,
                            ),
                            None => (this.on_navigate)(
                                ChatWorkspaceNavigation::Workspace(this.workspace_key.clone()),
                                cx,
                            ),
                        }
                    } else {
                        if let WorkspaceTab::File(key) = &tab {
                            let dirty = this
                                .files
                                .read(cx)
                                .document(key.path())
                                .is_some_and(|doc| doc.read(cx).dirty(cx));
                            if dirty {
                                this.persistence_error =
                                    Some(Arc::from("Save or revert this file before closing it."));
                                cx.notify();
                                return;
                            }
                        }
                        this.workspace.update(cx, |store, cx| {
                            store.tab_close(&tab);
                            cx.notify();
                        });
                        let active = this.workspace.read(cx).snapshot().active_tab.clone();
                        match active {
                            Some(WorkspaceTab::Conversation(conversation)) => {
                                this.desired_file = None;
                                this.desired_conversation = Some(conversation.clone());
                                (this.on_navigate)(
                                    ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                                        workspace: this.workspace_key.clone(),
                                        conversation,
                                    }),
                                    cx,
                                );
                            }
                            Some(WorkspaceTab::File(key)) => {
                                let presentation = this
                                    .workspace
                                    .read(cx)
                                    .snapshot()
                                    .file_tab_presentations
                                    .get(&key)
                                    .copied()
                                    .unwrap_or_default();
                                let kind = if presentation == FileTabPresentation::Diff {
                                    FileKind::Diff
                                } else {
                                    FileKind::File
                                };
                                this.desired_file = Some((key.path().clone(), kind));
                                this.desired_conversation = None;
                                (this.on_navigate)(
                                    ChatWorkspaceNavigation::File {
                                        workspace: this.workspace_key.clone(),
                                        path: key.path().clone(),
                                        kind,
                                    },
                                    cx,
                                );
                            }
                            Some(tab @ WorkspaceTab::Tool(_)) => (this.on_navigate)(
                                ChatWorkspaceNavigation::WorkspaceTab {
                                    workspace: this.workspace_key.clone(),
                                    tab,
                                },
                                cx,
                            ),
                            None => (this.on_navigate)(
                                ChatWorkspaceNavigation::Workspace(this.workspace_key.clone()),
                                cx,
                            ),
                        }
                    }
                });
            })),
            on_move: Some(Rc::new(move |id, direction, _, cx| {
                move_entity.update(cx, |this, cx| {
                    let snapshot = this.workspace.read(cx).snapshot().clone();
                    let Some(index) = snapshot
                        .tabs
                        .iter()
                        .position(|tab| tab_id(tab) == id.as_ref())
                    else {
                        return;
                    };
                    let target = match direction {
                        WorkspaceTabMove::Previous => index.saturating_sub(1),
                        WorkspaceTabMove::Next => {
                            (index + 1).min(snapshot.tabs.len().saturating_sub(1))
                        }
                    };
                    if target != index {
                        let tab = snapshot.tabs[index].clone();
                        this.workspace.update(cx, |store, cx| {
                            store.tab_move(&tab, target);
                            cx.notify();
                        });
                    }
                });
            })),
            on_create: Some(Rc::new(move |_, cx| {
                create_entity.update(cx, |this, cx| {
                    let snapshot = this.workspace.read(cx).snapshot().clone();
                    let id = snapshot.session_create_id.clone().unwrap_or_else(|| {
                        ClientConversationId::new(cuid2::create_id())
                            .expect("cuid2 is a conversation id")
                    });
                    let mutation = MutationId::new(this.next_mutation("create"))
                        .expect("mutation is nonempty");
                    this.workspace.update(cx, |store, cx| {
                        store.session_create(id, mutation);
                        cx.notify();
                    });
                });
            })),
            on_recent_toggle: Some(Rc::new(move |_, cx| {
                recent_entity.update(cx, |this, cx| {
                    this.recent_open = !this.recent_open;
                    cx.notify();
                });
            })),
            on_recent_select: Some(Rc::new(move |id, _window, cx| {
                recent_select_entity.update(cx, |this, cx| {
                    let snapshot = this.workspace.read(cx).snapshot().clone();
                    let Some(key) = snapshot
                        .conversations
                        .keys()
                        .find(|key| format!("conversation:{}", key.id()) == id.as_ref())
                        .cloned()
                    else {
                        return;
                    };
                    let active = snapshot
                        .tabs
                        .contains(&WorkspaceTab::Conversation(key.clone()));
                    if active {
                        (this.on_navigate)(
                            ChatWorkspaceNavigation::Conversation(CreatedChatNavigation {
                                workspace: this.workspace_key.clone(),
                                conversation: key,
                            }),
                            cx,
                        );
                    } else {
                        let mutation = MutationId::new(this.next_mutation("restore"))
                            .expect("mutation is nonempty");
                        this.pending_restore = Some(key.clone());
                        let started = this.workspace.update(cx, |store, cx| {
                            let started = store.conversation_restore(&key, mutation);
                            cx.notify();
                            started
                        });
                        if !started {
                            this.pending_restore = None;
                        }
                    }
                });
            })),
        };

        let lifecycle = WorkspaceLifecycleLane {
            id: format!("workspace-lifecycle:{}", self.workspace_key.id()).into(),
            theme: self.theme,
            name: self.labels.workspace_name.clone(),
            phase: self.catalog_facts.lifecycle,
            detail: self.catalog_facts.lifecycle_detail.clone(),
            path: self.labels.workspace_location.clone(),
        };

        let active_file = match workspace.active_tab.as_ref() {
            Some(WorkspaceTab::File(key)) => self.files.read(cx).document(key.path()),
            _ => None,
        };
        let body: AnyElement = if let Some(document) = active_file {
            document.into_any_element()
        } else {
            match (focused.as_ref(), chat_snapshot.as_ref()) {
                (Some(key), Some(snapshot)) => {
                    let ui = self.ui.get(key).expect("focused UI exists");
                    let transcript = ui.transcript.clone();
                    let composer = self.composer(key.clone(), snapshot, ui.composer.clone(), cx);
                    div()
                        .size_full()
                        .min_w_0()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .child(div().flex_1().min_h_0().min_w_0().child(transcript))
                        .child(composer)
                        .into_any_element()
                }
                _ if self.catalog_facts.lifecycle != WorkspaceLifecyclePhase::Ready => {
                    WorkspaceLifecycleNotice {
                        id: format!("workspace-lifecycle-panel:{}", self.workspace_key.id()).into(),
                        theme: self.theme,
                        name: self.labels.workspace_name.clone(),
                        phase: self.catalog_facts.lifecycle,
                        detail: self.catalog_facts.lifecycle_detail.clone(),
                        path: self.labels.workspace_location.clone(),
                        size: WorkspaceLifecycleNoticeSize::Panel,
                    }
                    .into_any_element()
                }
                _ => div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .font_family(fonts::UI_FAMILY)
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(if self.desired_conversation.is_some() {
                        "The requested conversation is not available"
                    } else {
                        "No conversation open"
                    })
                    .into_any_element(),
            }
        };

        let attachment_boundary = focused.as_ref().and_then(|key| {
            let snapshot = chat_snapshot.as_ref()?;
            if matches!(
                snapshot.composer.message_send,
                OperationState::Pending { .. }
            ) {
                return None;
            }
            let ui = self.ui.get(key)?;
            let local = self.local_attachments.get(key);
            let mut ordered = Vec::new();
            let mut store_ids = BTreeSet::new();
            for attachment in &snapshot.composer.attachments {
                store_ids.insert(attachment.id.clone());
                let failed = local
                    .and_then(|items| items.get(&attachment.id))
                    .is_some_and(|preview| preview.failure.is_some())
                    || matches!(attachment.state, AttachmentState::Failed { .. });
                ordered.push((attachment.id.clone(), failed));
            }
            if let Some(local) = local {
                ordered.extend(
                    local
                        .values()
                        .filter(|preview| !store_ids.contains(&preview.id))
                        .map(|preview| (preview.id.clone(), preview.failure.is_some())),
                );
            }
            let (first_id, first_failed) = ordered.first()?.clone();
            let (last_id, last_failed) = ordered.last()?.clone();
            let has_omitted = local
                .into_iter()
                .flat_map(BTreeMap::values)
                .any(|preview| preview.omitted_count > 0);
            let first_focus = ui.attachment_action_focus.get(&first_id)?;
            let first = if first_failed {
                first_focus.remove.clone()
            } else {
                first_focus.open.clone()
            };
            let last_focus = ui.attachment_action_focus.get(&last_id)?;
            let last = if last_failed && !has_omitted {
                last_focus.retry.clone()
            } else {
                last_focus.remove.clone()
            };
            Some((
                ui.transcript_focus.clone(),
                ui.composer.read(cx).focus_handle(cx),
                first,
                last,
                ui.attachment_horizontal_scrollbar
                    .read(cx)
                    .scroll_handle()
                    .clone(),
            ))
        });

        let image_lightbox = self.opened_image.clone().map(|opened| {
            let close_entity = entity.clone();
            InlineImageLightbox {
                id: format!("inline-image-lightbox:{}", opened.id).into(),
                theme: self.theme,
                image: opened.image,
                alt: opened.alt,
                overlay_focus: self.image_overlay_focus.clone(),
                close_focus: self.image_close_focus.clone(),
                on_close: Rc::new(move |window, cx| {
                    close_entity.update(cx, |this, cx| {
                        this.opened_image = None;
                        let return_focus = this.image_return_focus.take().or_else(|| {
                            this.focused_conversation
                                .as_ref()
                                .and_then(|key| this.ui.get(key))
                                .map(|ui| ui.composer.read(cx).focus_handle(cx))
                        });
                        if let Some(return_focus) = return_focus {
                            window.focus(&return_focus);
                        }
                        cx.notify();
                    });
                }),
            }
        });

        div()
            .size_full()
            .capture_key_down(move |event, window, cx| {
                if event.is_held || event.keystroke.key.as_str() != "tab" {
                    return;
                }
                let Some((transcript, composer, first, last, scroll)) =
                    attachment_boundary.as_ref()
                else {
                    return;
                };
                let Some(current) = window.focused(cx) else {
                    return;
                };
                if !event.keystroke.modifiers.shift && current == *transcript {
                    scroll.set_offset(gpui::point(px(0.0), scroll.offset().y));
                    first.focus(window);
                    window.refresh();
                    cx.stop_propagation();
                } else if !event.keystroke.modifiers.shift && current == *last {
                    composer.focus(window);
                    window.refresh();
                    cx.stop_propagation();
                } else if event.keystroke.modifiers.shift && current == *first {
                    transcript.focus(window);
                    window.refresh();
                    cx.stop_propagation();
                }
            })
            .min_w(px(220.0))
            .min_h_0()
            .overflow_hidden()
            .flex()
            .flex_col()
            .bg(self.theme.role(ThemeRole::Surface))
            .child(header)
            .child(lifecycle)
            .child(tabs_view)
            .child(div().flex_1().min_h_0().min_w_0().child(body))
            .when_some(image_lightbox, |root, lightbox| root.child(lightbox))
    }
}

fn conversation_fallback(
    tabs: &[WorkspaceTab],
    activation_history: &[WorkspaceTab],
    closing: &ConversationKey,
) -> Option<ConversationKey> {
    activation_history
        .iter()
        .rev()
        .chain(tabs.iter())
        .find_map(|tab| match tab {
            WorkspaceTab::Conversation(key) if key != closing => Some(key.clone()),
            _ => None,
        })
}

fn tab_id(tab: &WorkspaceTab) -> String {
    match tab {
        WorkspaceTab::Conversation(key) => format!("conversation:{}", key.id()),
        WorkspaceTab::File(key) => format!("file:{}", key.as_str()),
        WorkspaceTab::Tool(key) => format!("tool:{}", key.as_str()),
    }
}

impl ChatWorkspaceSurface {
    fn composer(
        &self,
        key: ConversationKey,
        snapshot: &ChatSnapshot,
        text_area: Entity<TextArea>,
        cx: &mut Context<Self>,
    ) -> ComposerDock {
        let offline = !matches!(snapshot.availability, ChatAvailability::Online);
        let locked = snapshot.agent.as_ref().is_some_and(|agent| {
            agent.can_send_messages == Some(false) || agent.managed_by_another_agent == Some(true)
        });
        let pending = matches!(
            snapshot.composer.message_send,
            OperationState::Pending { .. }
        );
        let running = snapshot
            .history_pages
            .iter()
            .rev()
            .flat_map(|page| page.runs.iter().rev())
            .any(|run| run.value.status == RunStatus::Running);
        let mode = snapshot.composer.mode.as_ref().or(snapshot.mode.as_ref());
        let model = mode.map(|m| m.model_id.as_str()).unwrap_or("Select model");
        let effort = mode.map(|m| m.effort.as_str()).unwrap_or("Effort");
        let permission = mode
            .map(|m| permission_label(m.permission_mode))
            .unwrap_or("Permission");
        let tier = mode
            .and_then(|m| m.service_tier.as_deref())
            .unwrap_or("Default tier");

        let surface = cx.entity();
        let composer_focus = text_area.read(cx).focus_handle(cx);
        let conversation_ui = self.ui.get(&key).expect("conversation UI exists");
        let attachment_horizontal_scrollbar =
            conversation_ui.attachment_horizontal_scrollbar.clone();
        let attachment_vertical_scrollbar = conversation_ui.attachment_vertical_scrollbar.clone();
        let toolbar_scrollbar = conversation_ui.toolbar_scrollbar.clone();
        let attachment_action_focus = conversation_ui.attachment_action_focus.clone();
        let toolbar_focus = conversation_ui.toolbar_focus.clone();
        let attachment_store = self.chat_entity(&key, cx);
        let local_attachments = self
            .local_attachments
            .get(&key)
            .cloned()
            .unwrap_or_default();
        let has_omitted_attachments = local_attachments
            .values()
            .any(|preview| preview.omitted_count > 0);
        let mut attachment_items = Vec::new();
        let mut store_ids = BTreeSet::new();
        for attachment in &snapshot.composer.attachments {
            store_ids.insert(attachment.id.clone());
            let local = local_attachments.get(&attachment.id);
            attachment_items.push(AttachmentPreviewItem {
                id: attachment.id.as_str().to_owned().into(),
                name: attachment.name.to_string().into(),
                kind: AttachmentKind::Image,
                image: local.and_then(|preview| preview.image.clone()),
                error: local
                    .and_then(|preview| preview.failure.as_ref())
                    .cloned()
                    .or_else(|| match &attachment.state {
                        AttachmentState::Failed { message } => Some(message.clone()),
                        AttachmentState::Ready => None,
                    })
                    .map(|message| message.to_string().into()),
                open_focus: attachment_action_focus
                    .get(&attachment.id)
                    .expect("attachment focus reconciled")
                    .open
                    .clone(),
                remove_focus: attachment_action_focus
                    .get(&attachment.id)
                    .expect("attachment focus reconciled")
                    .remove
                    .clone(),
                retry_focus: attachment_action_focus
                    .get(&attachment.id)
                    .expect("attachment focus reconciled")
                    .retry
                    .clone(),
            });
        }
        attachment_items.extend(
            local_attachments
                .values()
                .filter(|preview| !store_ids.contains(&preview.id))
                .map(|preview| AttachmentPreviewItem {
                    id: preview.id.as_str().to_owned().into(),
                    name: preview.name.to_string().into(),
                    kind: AttachmentKind::Image,
                    image: preview.image.clone(),
                    error: preview
                        .failure
                        .as_ref()
                        .map(|message| message.to_string().into()),
                    open_focus: attachment_action_focus
                        .get(&preview.id)
                        .expect("attachment focus reconciled")
                        .open
                        .clone(),
                    remove_focus: attachment_action_focus
                        .get(&preview.id)
                        .expect("attachment focus reconciled")
                        .remove
                        .clone(),
                    retry_focus: attachment_action_focus
                        .get(&preview.id)
                        .expect("attachment focus reconciled")
                        .retry
                        .clone(),
                }),
        );
        let attachments = (!attachment_items.is_empty()).then(|| {
            let remove_store = attachment_store.clone();
            let remove_surface = surface.clone();
            let remove_key = key.clone();
            let remove_focus = composer_focus.clone();
            AttachmentPreviews {
                id: format!("attachments:{}", key.id()).into(),
                theme: self.theme,
                items: attachment_items,
                horizontal_scrollbar: attachment_horizontal_scrollbar,
                vertical_scrollbar: attachment_vertical_scrollbar,
                disabled: pending,
                on_open: Some({
                    let open_surface = surface.clone();
                    let open_key = key.clone();
                    Rc::new(move |id: SharedString, window: &mut Window, cx: &mut App| {
                        let Some(attachment_id) = AttachmentId::new(id.as_ref()) else {
                            return;
                        };
                        open_surface.update(cx, |this, cx| {
                            let opened = this
                                .local_attachments
                                .get(&open_key)
                                .and_then(|items| items.get(&attachment_id))
                                .filter(|preview| preview.failure.is_none())
                                .and_then(|preview| {
                                    preview.image.as_ref().map(|image| OpenedInlineImage {
                                        id: id.clone(),
                                        alt: preview.name.to_string().into(),
                                        image: image.clone(),
                                    })
                                });
                            if let Some(opened) = opened {
                                this.image_return_focus = window.focused(cx);
                                this.opened_image = Some(opened);
                                window.focus(&this.image_close_focus);
                                cx.notify();
                            }
                        });
                    })
                }),
                on_remove: Some(Rc::new(move |id, window, cx| {
                    window.focus(&remove_focus);
                    let Some(id) = AttachmentId::new(id.as_ref()) else {
                        return;
                    };
                    if let Some(store) = remove_store.as_ref() {
                        store.update(cx, |store, cx| {
                            store.image_attachment_remove(&id);
                            cx.notify();
                        });
                    }
                    let _ = remove_surface.update(cx, |this, cx| {
                        let removed_image = this
                            .local_attachments
                            .get_mut(&remove_key)
                            .and_then(|items| items.remove(&id))
                            .and_then(|preview| preview.image);
                        if this
                            .local_attachments
                            .get(&remove_key)
                            .is_some_and(BTreeMap::is_empty)
                        {
                            this.local_attachments.remove(&remove_key);
                        }
                        if let Some(ui) = this.ui.get_mut(&remove_key) {
                            ui.attachment_action_focus.remove(&id);
                        }
                        if let Some(image) = removed_image {
                            image.remove_asset(cx);
                        }
                        this.viewport_resized(cx);
                        cx.notify();
                    });
                })),
                on_retry: (!has_omitted_attachments).then(|| {
                    self.attachment_retry_handler(
                        key.clone(),
                        surface.clone(),
                        composer_focus.clone(),
                    )
                }),
            }
            .into_any_element()
        });

        let attach = Button {
            id: format!("attach:{}", key.id()).into(),
            theme: self.theme,
            label: "Add inline image".into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(IconName::Paperclip),
            icon_only: true,
            disabled: pending,
            force_focused: false,
            focus_handle: Some(toolbar_focus.attach.clone()),
            on_activate: Some(self.attach_handler(key.clone(), surface.clone())),
        }
        .into_any_element();
        let model_control = ModelEffortControl {
            id: format!("model:{}", key.id()).into(),
            theme: self.theme,
            model: model.to_owned().into(),
            effort: effort.to_owned().into(),
            disabled: locked || offline,
            model_focus: toolbar_focus.model.clone(),
            effort_focus: toolbar_focus.effort.clone(),
            on_model: Some(self.cycle_model_handler(key.clone())),
            on_effort: Some(self.cycle_effort_handler(key.clone())),
        }
        .into_any_element();
        let permission_control = PermissionControl {
            id: format!("permission:{}", key.id()).into(),
            theme: self.theme,
            label: permission.into(),
            disabled: locked || offline,
            focus_handle: toolbar_focus.permission.clone(),
            on_activate: Some(self.cycle_permission_handler(key.clone())),
        }
        .into_any_element();
        let tier_control = TierControl {
            id: format!("tier:{}", key.id()).into(),
            theme: self.theme,
            label: tier.to_owned().into(),
            disabled: locked || offline,
            focus_handle: toolbar_focus.tier.clone(),
            on_activate: Some(self.cycle_tier_handler(key.clone())),
        }
        .into_any_element();
        let audience = AudienceControl {
            id: format!("audience:{}", key.id()).into(),
            theme: self.theme,
            label: "Audience".into(),
            protocol_available: false,
            disabled: true,
            focus_handle: toolbar_focus.audience.clone(),
            on_activate: None,
        }
        .into_any_element();
        let context = snapshot.context.as_ref().map(|context| {
            ContextMeter {
                id: format!("context:{}", key.id()).into(),
                theme: self.theme,
                used: context.context_tokens,
                limit: context
                    .context_window
                    .unwrap_or(context.context_tokens.max(1)),
                label: if context.approximate {
                    "Approx. context"
                } else {
                    "Context"
                }
                .into(),
            }
            .into_any_element()
        });
        let conversation_ui = self.ui.get(&key).expect("conversation UI exists");
        let command_picker_focus = conversation_ui.command_picker_focus.clone();
        let command_picker_active = conversation_ui.command_picker_active;
        let command_picker_dismissed = conversation_ui.command_picker_dismissed;
        let emoji_picker_focus = conversation_ui.emoji_picker_focus.clone();
        let emoji_picker_active = conversation_ui.emoji_picker_active;
        let emoji_entity = cx.entity();
        let emoji_button_focus = emoji_picker_focus.clone();
        let emoji_composer_focus = composer_focus.clone();
        let emoji_button = Button {
            id: format!("emoji:{}", key.id()).into(),
            theme: self.theme,
            label: "Insert emoji".into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(IconName::Smile),
            icon_only: true,
            disabled: locked,
            force_focused: false,
            focus_handle: Some(toolbar_focus.emoji.clone()),
            on_activate: Some(Rc::new({
                let key = key.clone();
                move |window, cx| {
                    emoji_entity.update(cx, |this, cx| {
                        if this.emoji_open.remove(&key) {
                            window.focus(&emoji_composer_focus);
                        } else {
                            this.emoji_open.insert(key.clone());
                            if let Some(ui) = this.ui.get_mut(&key) {
                                ui.emoji_picker_active = 0;
                            }
                            window.focus(&emoji_button_focus);
                        }
                        cx.notify();
                    })
                }
            })),
        }
        .into_any_element();

        let mut picker_previous: Option<crate::ui::composer_controls::ComposerHandler> = None;
        let mut picker_next: Option<crate::ui::composer_controls::ComposerHandler> = None;
        let mut picker_commit: Option<crate::ui::composer_controls::ComposerHandler> = None;
        let mut picker_dismiss: Option<crate::ui::composer_controls::ComposerHandler> = None;
        let picker = if self.emoji_open.contains(&key) {
            let picker_entity = cx.entity();
            let active_entity = picker_entity.clone();
            let dismiss_entity = picker_entity.clone();
            let select_entity = picker_entity.clone();
            let select_key = key.clone();
            let select_area = text_area.clone();
            let select_focus = composer_focus.clone();
            let dismiss_key = key.clone();
            let emoji_active_key = key.clone();
            let dismiss_focus = composer_focus.clone();
            let dismiss: crate::ui::composer_controls::ComposerHandler =
                Rc::new(move |window, cx| {
                    dismiss_entity.update(cx, |this, cx| {
                        this.emoji_open.remove(&dismiss_key);
                        window.focus(&dismiss_focus);
                        cx.notify();
                    });
                });
            picker_dismiss = Some(dismiss.clone());
            Some(
                EmojiPicker {
                    id: format!("emoji-picker:{}", key.id()).into(),
                    theme: self.theme,
                    items: emoji_items(),
                    columns: 6,
                    active: emoji_picker_active,
                    focus_handle: emoji_picker_focus,
                    on_active: Some(Rc::new(move |active, _, cx| {
                        active_entity.update(cx, |this, cx| {
                            if let Some(ui) = this.ui.get_mut(&emoji_active_key) {
                                ui.emoji_picker_active = active;
                            }
                            cx.notify();
                        });
                    })),
                    on_select: Some(Rc::new(move |id, window, cx| {
                        let glyph = emoji_items()
                            .into_iter()
                            .find(|item| item.id == id)
                            .map(|item| item.glyph);
                        if let Some(glyph) = glyph {
                            let selection = select_area.read(cx).selection();
                            select_area.update(cx, |area, cx| {
                                area.replace_text_in_range(
                                    Some(selection.range),
                                    glyph.as_ref(),
                                    window,
                                    cx,
                                );
                            });
                        }
                        select_entity.update(cx, |this, cx| {
                            this.emoji_open.remove(&select_key);
                            window.focus(&select_focus);
                            cx.notify();
                        });
                    })),
                    on_dismiss: Some(dismiss),
                    restore_focus: Some(composer_focus.clone()),
                }
                .into_any_element(),
            )
        } else if !offline
            && snapshot.composer.text.starts_with('/')
            && !snapshot.slash_commands.is_empty()
            && !command_picker_dismissed
        {
            let store = self.chat_entity(&key, cx);
            let active_entity = cx.entity();
            let active_key = key.clone();
            let dismiss_entity = active_entity.clone();
            let dismiss_key = key.clone();
            let dismiss_focus = composer_focus.clone();
            let dismiss: crate::ui::composer_controls::ComposerHandler =
                Rc::new(move |window, cx| {
                    dismiss_entity.update(cx, |this, cx| {
                        if let Some(ui) = this.ui.get_mut(&dismiss_key) {
                            ui.command_picker_dismissed = true;
                        }
                        window.focus(&dismiss_focus);
                        cx.notify();
                    });
                });
            picker_dismiss = Some(dismiss.clone());
            let query = snapshot.composer.command_query.as_ref();
            let items: Vec<_> = snapshot
                .slash_commands
                .iter()
                .filter(|command| command.name.starts_with(query))
                .map(|command| CommandPickerItem {
                    id: command.name.clone().into(),
                    slash: format!("/{}", command.name).into(),
                    description: command.description.clone().into(),
                    icon: IconName::Terminal,
                })
                .collect();
            if items.is_empty() {
                None
            } else {
                let item_ids: Vec<_> = items.iter().map(|item| item.id.clone()).collect();
                let item_count = item_ids.len();
                let previous_entity = cx.entity();
                let previous_key = key.clone();
                let previous_focus = composer_focus.clone();
                picker_previous = Some(Rc::new(move |window, cx| {
                    previous_entity.update(cx, |this, cx| {
                        if let Some(ui) = this.ui.get_mut(&previous_key) {
                            ui.command_picker_active =
                                (ui.command_picker_active + item_count - 1) % item_count;
                        }
                        window.focus(&previous_focus);
                        cx.notify();
                    });
                }));
                let next_entity = cx.entity();
                let next_key = key.clone();
                let next_focus = composer_focus.clone();
                picker_next = Some(Rc::new(move |window, cx| {
                    next_entity.update(cx, |this, cx| {
                        if let Some(ui) = this.ui.get_mut(&next_key) {
                            ui.command_picker_active = (ui.command_picker_active + 1) % item_count;
                        }
                        window.focus(&next_focus);
                        cx.notify();
                    });
                }));
                let select_entity = cx.entity();
                let select_key = key.clone();
                let select_focus = composer_focus.clone();
                let select_handler = (!offline).then(|| store).flatten().map(|store| {
                    Rc::new(move |id: SharedString, window: &mut Window, cx: &mut App| {
                        let mutation =
                            ChatMutationId::new(format!("command-{}", cuid2::create_id()))
                                .expect("mutation is nonempty");
                        store.update(cx, |store, cx| {
                            let allows_arguments = store
                                .snapshot()
                                .slash_commands
                                .iter()
                                .find(|command| command.name == id.as_ref())
                                .is_some_and(|command| command.has_arguments);
                            let text = store.snapshot().composer.text.trim();
                            let arguments = allows_arguments
                                .then_some(text)
                                .and_then(|text| text.strip_prefix('/'))
                                .and_then(|text| text.split_once(char::is_whitespace))
                                .map(|(_, arguments)| arguments.trim())
                                .filter(|arguments| !arguments.is_empty())
                                .map(Arc::from);
                            store.command_select(id.as_ref(), arguments, mutation);
                            cx.notify();
                        });
                        select_entity.update(cx, |this, cx| {
                            if let Some(ui) = this.ui.get_mut(&select_key) {
                                ui.command_picker_dismissed = true;
                            }
                            window.focus(&select_focus);
                            cx.notify();
                        });
                    }) as crate::ui::composer_controls::IdHandler
                });
                if let Some(commit_select) = select_handler.clone() {
                    let commit_entity = cx.entity();
                    let commit_key = key.clone();
                    let commit_ids = item_ids.clone();
                    let commit_focus = composer_focus.clone();
                    picker_commit = Some(Rc::new(move |window, cx| {
                        let active = commit_entity
                            .read(cx)
                            .ui
                            .get(&commit_key)
                            .map(|ui| ui.command_picker_active)
                            .unwrap_or(0)
                            .min(commit_ids.len().saturating_sub(1));
                        if let Some(id) = commit_ids.get(active) {
                            commit_select(id.clone(), window, cx);
                        }
                        window.focus(&commit_focus);
                    }));
                }
                let command_active_focus = composer_focus.clone();
                Some(
                    CommandPicker {
                        id: format!("command-picker:{}", key.id()).into(),
                        theme: self.theme,
                        items,
                        active: command_picker_active,
                        focus_handle: Some(command_picker_focus),
                        on_active: Some(Rc::new(move |active, window, cx| {
                            active_entity.update(cx, |this, cx| {
                                if let Some(ui) = this.ui.get_mut(&active_key) {
                                    ui.command_picker_active = active;
                                }
                                window.focus(&command_active_focus);
                                cx.notify();
                            });
                        })),
                        on_select: select_handler,
                        on_dismiss: Some(dismiss),
                        restore_focus: Some(composer_focus.clone()),
                    }
                    .into_any_element(),
                )
            }
        } else {
            None
        };

        let workspace = self.workspace.read(cx).snapshot().clone();
        let operation_failure = |operation: &OperationState| match operation {
            OperationState::Failed { message } => Some(message.clone()),
            _ => None,
        };
        let workspace_failure = |operation: &AsyncActionState| match operation {
            AsyncActionState::Failed { message } => Some(message.clone()),
            _ => None,
        };
        let failure_message = operation_failure(&snapshot.composer.message_send)
            .or_else(|| operation_failure(&snapshot.composer.draft_save))
            .or_else(|| operation_failure(&snapshot.composer.mode_save))
            .or_else(|| operation_failure(&snapshot.composer.abort))
            .or_else(|| operation_failure(&snapshot.composer.command))
            .or_else(|| operation_failure(&snapshot.composer.question_submit))
            .or_else(|| operation_failure(&snapshot.refresh))
            .or_else(|| operation_failure(&snapshot.mark_read))
            .or_else(|| {
                snapshot
                    .process_operations
                    .values()
                    .find_map(operation_failure)
            })
            .or_else(|| snapshot.retry.values().find_map(operation_failure))
            .or_else(|| {
                snapshot.composer.attachments.iter().find_map(|attachment| {
                    match &attachment.state {
                        AttachmentState::Failed { message } => Some(message.clone()),
                        AttachmentState::Ready => None,
                    }
                })
            })
            .or_else(|| {
                local_attachments
                    .values()
                    .find_map(|attachment| attachment.failure.clone())
            })
            .or_else(|| snapshot.pending_error.clone())
            .or_else(|| snapshot.older_error.clone())
            .or_else(|| workspace_failure(&workspace.session_create))
            .or_else(|| {
                workspace
                    .session_archive
                    .values()
                    .find_map(|archive| workspace_failure(&archive.state))
            })
            .or_else(|| self.persistence_error.clone())
            .or_else(|| {
                self.connectivity
                    .read(cx)
                    .workspace_persistence_error()
                    .map(Arc::from)
            });
        let failure_retry: Option<crate::ui::composer_controls::ComposerHandler> = if matches!(
            snapshot.composer.message_send,
            OperationState::Failed { .. }
        ) {
            Some(self.retry_send_handler(key.clone()))
        } else if snapshot.pending_error.is_none()
            && snapshot.older_error.is_some()
            && snapshot.has_more
        {
            Some(self.load_older_handler(key.clone()))
        } else {
            None
        };
        let failure = failure_message.map(|message| ComposerFailureBanner {
            id: format!("composer-failure:{}", key.id()).into(),
            theme: self.theme,
            message: message.to_string().into(),
            retry_disabled: failure_retry.is_none(),
            on_retry: failure_retry,
        });
        let has_send_content =
            !snapshot.composer.text.trim().is_empty() || !snapshot.composer.attachments.is_empty();
        let attachments_ready = snapshot
            .composer
            .attachments
            .iter()
            .all(|attachment| matches!(attachment.state, AttachmentState::Ready))
            && local_attachments
                .values()
                .all(|attachment| attachment.failure.is_none());
        let send_enabled = mode.is_some() && has_send_content && attachments_ready;
        ComposerDock {
            id: format!("composer-dock:{}", key.id()).into(),
            theme: self.theme,
            above: attachments,
            failure,
            composer: ComposerCard {
                id: format!("composer-card:{}", key.id()).into(),
                theme: self.theme,
                text_area,
                disabled: locked,
                pending,
                submit_disabled: offline,
                send_enabled,
                running,
                picker_open: picker.is_some(),
                attachment_previews: None,
                leading_controls: vec![
                    ComposerToolbarItem::new(
                        28.0,
                        vec![ComposerToolbarFocusTarget::new(
                            toolbar_focus.attach.clone(),
                            0.0,
                            28.0,
                        )],
                        attach,
                    ),
                    ComposerToolbarItem::new(
                        MODEL_EFFORT_CONTROL_WIDTH,
                        vec![
                            ComposerToolbarFocusTarget::new(
                                toolbar_focus.model.clone(),
                                0.0,
                                104.0,
                            ),
                            ComposerToolbarFocusTarget::new(
                                toolbar_focus.effort.clone(),
                                108.0,
                                212.0,
                            ),
                        ],
                        model_control,
                    ),
                    ComposerToolbarItem::new(
                        COMPACT_CONTROL_WIDTH,
                        vec![ComposerToolbarFocusTarget::new(
                            toolbar_focus.permission.clone(),
                            0.0,
                            104.0,
                        )],
                        permission_control,
                    ),
                    ComposerToolbarItem::new(
                        COMPACT_CONTROL_WIDTH,
                        vec![ComposerToolbarFocusTarget::new(
                            toolbar_focus.tier.clone(),
                            0.0,
                            104.0,
                        )],
                        tier_control,
                    ),
                    ComposerToolbarItem::new(AUDIENCE_UNAVAILABLE_WIDTH, Vec::new(), audience),
                ],
                trailing_controls: context
                    .into_iter()
                    .map(|context| {
                        ComposerToolbarItem::new(CONTEXT_METER_WIDTH, Vec::new(), context)
                    })
                    .chain(std::iter::once(ComposerToolbarItem::new(
                        28.0,
                        vec![ComposerToolbarFocusTarget::new(
                            toolbar_focus.emoji.clone(),
                            0.0,
                            28.0,
                        )],
                        emoji_button,
                    )))
                    .collect(),
                toolbar_scrollbar,
                submit_focus: toolbar_focus.submit.clone(),
                picker,
                on_picker_previous: picker_previous,
                on_picker_next: picker_next,
                on_picker_commit: picker_commit,
                on_picker_dismiss: picker_dismiss,
                on_send: Some(self.send_handler(key.clone())),
                on_abort: (!offline).then(|| self.abort_handler(key)),
            },
            footer: None,
        }
    }
}

fn permission_label(value: MessagePermissionMode) -> &'static str {
    match value {
        MessagePermissionMode::ReadOnly => "Read only",
        MessagePermissionMode::WorkspaceWrite => "Workspace write",
        MessagePermissionMode::Auto => "Auto",
        MessagePermissionMode::FullAccess => "Full access",
    }
}
fn emoji_items() -> Vec<EmojiItem> {
    [
        ("smile", "🙂", "Smile"),
        ("thumbs-up", "👍", "Thumbs up"),
        ("heart", "❤️", "Heart"),
        ("party", "🎉", "Party"),
        ("eyes", "👀", "Eyes"),
        ("rocket", "🚀", "Rocket"),
    ]
    .into_iter()
    .map(|(id, glyph, name)| EmojiItem {
        id: id.into(),
        glyph: glyph.into(),
        name: name.into(),
    })
    .collect()
}
