use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use crate::connectivity::{
    AgentCatalogSnapshot, AgentNamespace, CatalogLifecycleState, ConversationCatalogRow,
    ConversationKey, WorkspaceKey,
};

use crate::files::RelativeFilePath;

use super::persistence::{RestoredWorkspace, WorkspacePersistence};

pub(crate) const ENTRY_LIMIT: usize = 1_000;
pub(crate) const RECENT_SESSION_LIMIT: usize = 200;
pub(crate) const DRAFT_BYTE_LIMIT: usize = 100_000;
pub(crate) const TOOL_LIMIT: usize = 100;
pub(crate) const TOOL_TAB_KEY_BYTE_LIMIT: usize = 256;
pub(crate) const TOOL_LABEL_BYTE_LIMIT: usize = 256;
pub(crate) const TOOL_FAILURE_MESSAGE_BYTE_LIMIT: usize = 512;
pub(crate) const BROWSER_TITLE_BYTE_LIMIT: usize = 1_024;
pub(crate) const BROWSER_URL_BYTE_LIMIT: usize = 8_192;
pub const DEFAULT_INSPECTOR_WIDTH_PX: f32 = 340.0;
pub const MIN_INSPECTOR_WIDTH_PX: f32 = 250.0;
pub const MAX_INSPECTOR_WIDTH_PX: f32 = 360.0;

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Arc<str>);

        impl $name {
            pub fn new(value: impl Into<Arc<str>>) -> Option<Self> {
                let value = value.into();
                (!value.is_empty()).then_some(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileTabKey(RelativeFilePath);
impl FileTabKey {
    pub fn new(value: impl AsRef<str>) -> Option<Self> {
        RelativeFilePath::parse(value).ok().map(Self)
    }
    pub fn from_path(path: RelativeFilePath) -> Self {
        Self(path)
    }
    pub fn path(&self) -> &RelativeFilePath {
        &self.0
    }
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ToolTabKey(Arc<str>);
impl ToolTabKey {
    pub fn new(value: impl Into<Arc<str>>) -> Option<Self> {
        let value = value.into();
        (!value.is_empty() && value.len() <= TOOL_TAB_KEY_BYTE_LIMIT).then_some(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

opaque_id!(TranscriptRowId);
opaque_id!(MutationId);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClientConversationId(Arc<str>);
impl ClientConversationId {
    /// CUID2 is lowercase alphanumeric, begins with a letter, and is bounded.
    pub fn new(value: impl Into<Arc<str>>) -> Option<Self> {
        let value = value.into();
        let bytes = value.as_bytes();
        (bytes.len() >= 2
            && bytes.len() <= 32
            && bytes[0].is_ascii_lowercase()
            && bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit()))
        .then_some(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Stable identity for the mixed main-content tab strip.
///
/// File and tool variants are deliberately opaque placeholders. Later phases
/// can attach content stores without changing tab identity or persisted order.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WorkspaceTab {
    Conversation(ConversationKey),
    File(FileTabKey),
    Tool(ToolTabKey),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WorkspaceBehavior {
    #[default]
    Standard,
    BotSingleChat,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScrollAnchor {
    pub row: TranscriptRowId,
    /// Signed subpixel offset from the top of the row, preserved exactly.
    pub offset_px: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptMemory {
    pub anchor: Option<ScrollAnchor>,
    pub following: bool,
    pub expanded_rows: BTreeSet<TranscriptRowId>,
}

impl Default for TranscriptMemory {
    fn default() -> Self {
        Self {
            anchor: None,
            following: true,
            expanded_rows: BTreeSet::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AsyncActionState {
    Idle,
    Pending { mutation: MutationId },
    Failed { message: Arc<str> },
}

impl Default for AsyncActionState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionArchiveOperation {
    Archive,
    Restore,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionArchiveState {
    pub operation: SessionArchiveOperation,
    pub state: AsyncActionState,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FileTabPresentation {
    #[default]
    File,
    Diff,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToolPlacement {
    Main,
    #[default]
    Inspector,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolCreateState {
    Creating,
    Ready,
    Failed { message: Arc<str> },
}

impl ToolCreateState {
    fn admitted(self) -> Self {
        match self {
            Self::Failed { message } => Self::Failed {
                message: bound_tool_text(message, TOOL_FAILURE_MESSAGE_BYTE_LIMIT),
            },
            state => state,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolKind {
    Terminal,
    Browser { url: Arc<str>, title: Arc<str> },
}

/// Stable workspace-owned metadata for a live or restorable tool surface.
///
/// The live terminal driver is deliberately not part of this value. It has a
/// separate lifetime and cannot be reconstructed from persisted chrome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolMetadata {
    pub owning_conversation: ConversationKey,
    pub label: Arc<str>,
    pub placement: ToolPlacement,
    pub create_state: ToolCreateState,
    pub kind: ToolKind,
}

pub(crate) fn bound_tool_text(value: Arc<str>, byte_limit: usize) -> Arc<str> {
    if value.len() <= byte_limit {
        return value;
    }
    let mut end = byte_limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    Arc::from(&value[..end])
}

pub(crate) fn admit_browser_url(candidate: Arc<str>) -> Option<Arc<str>> {
    if candidate.len() > BROWSER_URL_BYTE_LIMIT {
        return None;
    }
    if candidate.as_ref() == "about:blank" {
        return Some(candidate);
    }
    let mut parsed = url::Url::parse(&candidate).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    // Workspace metadata is durable chrome, not the browser's live navigation request.
    // Query and fragment data can contain credentials and never enter metadata snapshots.
    parsed.set_query(None);
    parsed.set_fragment(None);
    let admitted: Arc<str> = Arc::from(parsed.as_str());
    (admitted.len() <= BROWSER_URL_BYTE_LIMIT).then_some(admitted)
}

impl ToolMetadata {
    pub(crate) fn admitted(mut self) -> Option<Self> {
        self.label = bound_tool_text(self.label, TOOL_LABEL_BYTE_LIMIT);
        self.create_state = self.create_state.admitted();
        if let ToolKind::Browser { url, title } = &mut self.kind {
            *url = admit_browser_url(url.clone())?;
            *title = bound_tool_text(title.clone(), BROWSER_TITLE_BYTE_LIMIT);
        }
        Some(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InspectorSelection {
    Files,
    Activity {
        conversation: ConversationKey,
    },
    Usage {
        conversation: ConversationKey,
    },
    Trace {
        conversation: ConversationKey,
        run_id: Arc<str>,
    },
    Preview {
        conversation: ConversationKey,
        entry_id: Arc<str>,
    },
    LiveTool(ToolTabKey),
}

impl Default for InspectorSelection {
    fn default() -> Self {
        Self::Files
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct InspectorSnapshot {
    pub open: bool,
    pub selection: InspectorSelection,
    /// Inspector tool strip order, independent from the main tab strip.
    pub tool_order: Vec<ToolTabKey>,
    pub width_px: f32,
}

impl Default for InspectorSnapshot {
    fn default() -> Self {
        Self {
            open: true,
            selection: InspectorSelection::Files,
            tool_order: Vec::new(),
            width_px: DEFAULT_INSPECTOR_WIDTH_PX,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceSnapshot {
    pub namespace: AgentNamespace,
    pub workspace: WorkspaceKey,
    pub behavior: WorkspaceBehavior,
    /// Client-owned mixed ordering. Catalog order is used only when an
    /// authoritative conversation is first discovered.
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab: Option<WorkspaceTab>,
    pub file_tab_presentations: BTreeMap<FileTabKey, FileTabPresentation>,
    pub ephemeral_file_tab: Option<FileTabKey>,
    pub tools: BTreeMap<ToolTabKey, ToolMetadata>,
    pub inspector: InspectorSnapshot,
    /// Least-recent to most-recent activation history.
    pub activation_history: Vec<WorkspaceTab>,
    pub conversations: BTreeMap<ConversationKey, Arc<ConversationCatalogRow>>,
    pub archived_recents: Vec<ConversationKey>,
    pub group_draft: Arc<str>,
    pub session_create: AsyncActionState,
    pub session_create_id: Option<ClientConversationId>,
    pub session_archive: BTreeMap<ConversationKey, SessionArchiveState>,
    pub transcripts: BTreeMap<ConversationKey, TranscriptMemory>,
}

impl WorkspaceSnapshot {
    fn empty(namespace: AgentNamespace, workspace: WorkspaceKey) -> Self {
        Self {
            namespace,
            workspace,
            behavior: WorkspaceBehavior::Standard,
            tabs: Vec::new(),
            active_tab: None,
            file_tab_presentations: BTreeMap::new(),
            ephemeral_file_tab: None,
            tools: BTreeMap::new(),
            inspector: InspectorSnapshot::default(),
            activation_history: Vec::new(),
            conversations: BTreeMap::new(),
            archived_recents: Vec::new(),
            group_draft: Arc::from(""),
            session_create: AsyncActionState::Idle,
            session_create_id: None,
            session_archive: BTreeMap::new(),
            transcripts: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum WorkspaceOutput {
    SessionCreateRequested {
        workspace: WorkspaceKey,
        id: ClientConversationId,
        mutation: MutationId,
    },
    SessionArchiveRequested {
        conversation: ConversationKey,
        mutation: MutationId,
    },
    SessionRestoreRequested {
        conversation: ConversationKey,
        mutation: MutationId,
    },
    /// Controller-owned persistence performs blocking serialization/fsync.
    PersistenceRequested { snapshot: Arc<WorkspaceSnapshot> },
}

type OutputListener = Arc<dyn Fn(WorkspaceOutput) + Send + Sync + 'static>;

/// One materialized workspace surface.
///
/// Construction and restoration only read local state. Neither operation opens
/// transport resources. Authoritative catalog snapshots enter explicitly via
/// [`Self::catalog_reconcile`].
pub struct WorkspaceStore {
    snapshot: Arc<WorkspaceSnapshot>,
    archive_overrides: BTreeMap<ConversationKey, SessionArchiveOperation>,
    persistence: Option<WorkspacePersistence>,
    persistence_error: Option<Arc<str>>,
    output: OutputListener,
}

impl WorkspaceStore {
    pub fn new(namespace: AgentNamespace, workspace: WorkspaceKey) -> Self {
        Self::with_listener(namespace, workspace, |_| {})
    }

    pub fn with_listener(
        namespace: AgentNamespace,
        workspace: WorkspaceKey,
        output: impl Fn(WorkspaceOutput) + Send + Sync + 'static,
    ) -> Self {
        debug_assert_eq!(workspace.namespace(), &namespace);
        Self {
            snapshot: Arc::new(WorkspaceSnapshot::empty(namespace, workspace)),
            archive_overrides: BTreeMap::new(),
            persistence: None,
            persistence_error: None,
            output: Arc::new(output),
        }
    }

    pub fn restore(
        namespace: AgentNamespace,
        workspace: WorkspaceKey,
        persistence: WorkspacePersistence,
        output: impl Fn(WorkspaceOutput) + Send + Sync + 'static,
    ) -> Self {
        debug_assert_eq!(workspace.namespace(), &namespace);
        let mut restored = persistence.read(&workspace).unwrap_or_default();
        for metadata in restored.tools.values_mut() {
            metadata.create_state = metadata.create_state.clone().admitted();
        }
        let mut snapshot = WorkspaceSnapshot::empty(namespace, workspace);
        apply_restored(&mut snapshot, restored);
        repair(&mut snapshot);
        Self {
            snapshot: Arc::new(snapshot),
            archive_overrides: BTreeMap::new(),
            persistence: None,
            persistence_error: None,
            output: Arc::new(output),
        }
    }

    pub fn snapshot(&self) -> &Arc<WorkspaceSnapshot> {
        &self.snapshot
    }

    /// Replaces the authoritative conversation projection for this workspace.
    /// Disconnects do not call this method, so all readable state remains in
    /// place offline. A fresh reconnect snapshot repairs stale membership in
    /// place without replacing the store identity.
    pub fn catalog_reconcile(&mut self, catalog: &AgentCatalogSnapshot) {
        if catalog.namespace != self.snapshot.namespace {
            return;
        }
        let mut next = (*self.snapshot).clone();
        let mut rows = BTreeMap::new();
        for row in catalog
            .active_conversations
            .iter()
            .chain(&catalog.archived_conversations)
            .filter(|row| row.workspace_key == next.workspace)
        {
            rows.insert(row.key.clone(), Arc::clone(row));
        }
        next.behavior = if rows.values().any(|row| row.bot_key.is_some()) {
            // Protocol 23 publishes a bot's dedicated workspace only through
            // the bot resource, so `catalog.workspace` legitimately has no row.
            WorkspaceBehavior::BotSingleChat
        } else {
            WorkspaceBehavior::Standard
        };

        // A matching server lifecycle acknowledges the optimistic override.
        self.archive_overrides.retain(|key, operation| {
            let Some(row) = rows.get(key) else {
                return false;
            };
            match operation {
                SessionArchiveOperation::Archive => {
                    row.lifecycle.state != CatalogLifecycleState::Archived
                }
                SessionArchiveOperation::Restore => !row.lifecycle.is_active(),
            }
        });
        next.session_archive
            .retain(|key, _| self.archive_overrides.contains_key(key));
        next.conversations = rows;
        reconcile_membership(&mut next, &self.archive_overrides);
        self.set(next);
    }

    pub fn tab_open(&mut self, tab: WorkspaceTab) {
        let mut next = (*self.snapshot).clone();
        if !tab_is_known(&next, &tab) {
            return;
        }
        if next.tabs.contains(&tab) && next.active_tab.as_ref() == Some(&tab) {
            return;
        }
        if !next.tabs.contains(&tab) {
            next.tabs.push(tab.clone());
        }
        activate(&mut next, tab);
        self.set(next);
    }

    pub fn file_tab_preview_update(&mut self, key: Option<FileTabKey>) {
        let next_key = key.filter(|key| {
            self.snapshot
                .tabs
                .contains(&WorkspaceTab::File(key.clone()))
        });
        if self.snapshot.ephemeral_file_tab == next_key {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.ephemeral_file_tab = next_key;
        self.set(next);
    }

    pub fn file_tab_presentation_update(
        &mut self,
        key: FileTabKey,
        presentation: FileTabPresentation,
    ) {
        let mut next = (*self.snapshot).clone();
        if !next.tabs.contains(&WorkspaceTab::File(key.clone()))
            || next.file_tab_presentations.get(&key) == Some(&presentation)
        {
            return;
        }
        next.file_tab_presentations.insert(key, presentation);
        self.set(next);
    }

    pub fn terminal_tool_open(
        &mut self,
        key: ToolTabKey,
        conversation: ConversationKey,
        label: impl Into<Arc<str>>,
    ) -> bool {
        self.tool_open(
            key,
            ToolMetadata {
                owning_conversation: conversation,
                label: label.into(),
                placement: ToolPlacement::Inspector,
                create_state: ToolCreateState::Creating,
                kind: ToolKind::Terminal,
            },
        )
    }

    pub fn browser_tool_open(
        &mut self,
        key: ToolTabKey,
        conversation: ConversationKey,
        label: impl Into<Arc<str>>,
        url: impl Into<Arc<str>>,
    ) -> bool {
        self.tool_open(
            key,
            ToolMetadata {
                owning_conversation: conversation,
                label: label.into(),
                placement: ToolPlacement::Inspector,
                create_state: ToolCreateState::Ready,
                kind: ToolKind::Browser {
                    url: url.into(),
                    title: Arc::from(""),
                },
            },
        )
    }

    /// Inserts one tool once. Existing keys are never replaced, because a key
    /// identifies the live surface and not merely its current presentation.
    pub fn tool_open(&mut self, key: ToolTabKey, metadata: ToolMetadata) -> bool {
        if self.snapshot.tools.contains_key(&key) || self.snapshot.tools.len() >= TOOL_LIMIT {
            return false;
        }
        let Some(metadata) = metadata.admitted() else {
            return false;
        };
        let mut next = (*self.snapshot).clone();
        match metadata.placement {
            ToolPlacement::Main => {
                let tab = WorkspaceTab::Tool(key.clone());
                next.tabs.push(tab.clone());
                activate(&mut next, tab);
            }
            ToolPlacement::Inspector => {
                next.inspector.tool_order.push(key.clone());
                next.inspector.selection = InspectorSelection::LiveTool(key.clone());
                next.inspector.open = true;
            }
        }
        next.tools.insert(key, metadata);
        self.set(next);
        true
    }

    pub fn tool_create_state_update(&mut self, key: &ToolTabKey, state: ToolCreateState) {
        let mut next = (*self.snapshot).clone();
        let Some(tool) = next.tools.get_mut(key) else {
            return;
        };
        tool.create_state = state.admitted();
        self.set(next);
    }

    pub fn tool_label_update(&mut self, key: &ToolTabKey, label: impl Into<Arc<str>>) {
        let mut next = (*self.snapshot).clone();
        let Some(tool) = next.tools.get_mut(key) else {
            return;
        };
        tool.label = bound_tool_text(label.into(), TOOL_LABEL_BYTE_LIMIT);
        self.set(next);
    }

    pub fn browser_tool_update(
        &mut self,
        key: &ToolTabKey,
        url: impl Into<Arc<str>>,
        title: impl Into<Arc<str>>,
    ) {
        let Some(url) = admit_browser_url(url.into()) else {
            return;
        };
        let title = bound_tool_text(title.into(), BROWSER_TITLE_BYTE_LIMIT);
        let mut next = (*self.snapshot).clone();
        let Some(ToolMetadata {
            kind:
                ToolKind::Browser {
                    url: old_url,
                    title: old_title,
                },
            ..
        }) = next.tools.get_mut(key)
        else {
            return;
        };
        *old_url = url;
        *old_title = title;
        self.set(next);
    }

    /// Atomically transfers a tool between strips without changing its key or
    /// touching the live terminal/browser resource behind it.
    pub fn tool_placement_update(&mut self, key: &ToolTabKey, placement: ToolPlacement) {
        let mut next = (*self.snapshot).clone();
        let Some(tool) = next.tools.get_mut(key) else {
            return;
        };
        if tool.placement == placement {
            return;
        }
        tool.placement = placement;
        let tab = WorkspaceTab::Tool(key.clone());
        match placement {
            ToolPlacement::Main => {
                next.inspector.tool_order.retain(|item| item != key);
                if next.inspector.selection == InspectorSelection::LiveTool(key.clone()) {
                    next.inspector.selection = InspectorSelection::Files;
                }
                if !next.tabs.contains(&tab) {
                    next.tabs.push(tab.clone());
                }
                activate(&mut next, tab);
            }
            ToolPlacement::Inspector => {
                next.tabs.retain(|item| item != &tab);
                next.activation_history.retain(|item| item != &tab);
                if !next.inspector.tool_order.contains(key) {
                    next.inspector.tool_order.push(key.clone());
                }
                next.inspector.selection = InspectorSelection::LiveTool(key.clone());
                next.inspector.open = true;
                repair(&mut next);
            }
        }
        self.set(next);
    }

    /// Closing is the only metadata operation that forgets a tool. Callers own
    /// stopping a terminal or disposing a browser before invoking it.
    pub fn tool_close(&mut self, key: &ToolTabKey) {
        let mut next = (*self.snapshot).clone();
        if next.tools.remove(key).is_none() {
            return;
        }
        let tab = WorkspaceTab::Tool(key.clone());
        next.tabs.retain(|item| item != &tab);
        next.activation_history.retain(|item| item != &tab);
        next.inspector.tool_order.retain(|item| item != key);
        if next.inspector.selection == InspectorSelection::LiveTool(key.clone()) {
            next.inspector.selection = InspectorSelection::Files;
        }
        repair(&mut next);
        self.set(next);
    }

    pub fn inspector_open_update(&mut self, open: bool) {
        let mut next = (*self.snapshot).clone();
        next.inspector.open = open;
        self.set(next);
    }

    pub fn inspector_selection_update(&mut self, selection: InspectorSelection) {
        if let InspectorSelection::LiveTool(key) = &selection {
            if !self
                .snapshot
                .tools
                .get(key)
                .is_some_and(|tool| tool.placement == ToolPlacement::Inspector)
            {
                return;
            }
        }
        let mut next = (*self.snapshot).clone();
        next.inspector.selection = selection;
        next.inspector.open = true;
        self.set(next);
    }

    pub fn inspector_tool_move(&mut self, key: &ToolTabKey, target_index: usize) {
        let mut next = (*self.snapshot).clone();
        let Some(from) = next
            .inspector
            .tool_order
            .iter()
            .position(|item| item == key)
        else {
            return;
        };
        let value = next.inspector.tool_order.remove(from);
        let target = target_index.min(next.inspector.tool_order.len());
        next.inspector.tool_order.insert(target, value);
        self.set(next);
    }

    pub fn inspector_width_update(&mut self, width_px: f32) {
        if !width_px.is_finite() {
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.inspector.width_px = width_px.clamp(MIN_INSPECTOR_WIDTH_PX, MAX_INSPECTOR_WIDTH_PX);
        self.set(next);
    }

    pub fn tab_activate(&mut self, tab: &WorkspaceTab) {
        let mut next = (*self.snapshot).clone();
        if !next.tabs.contains(tab) || next.active_tab.as_ref() == Some(tab) {
            return;
        }
        activate(&mut next, tab.clone());
        self.set(next);
    }

    pub fn tab_close(&mut self, tab: &WorkspaceTab) {
        if let WorkspaceTab::Tool(key) = tab {
            self.tool_close(key);
            return;
        }
        let mut next = (*self.snapshot).clone();
        next.tabs.retain(|item| item != tab);
        next.activation_history.retain(|item| item != tab);
        if let WorkspaceTab::File(key) = tab {
            next.file_tab_presentations.remove(key);
            if next.ephemeral_file_tab.as_ref() == Some(key) {
                next.ephemeral_file_tab = None;
            }
        }
        repair(&mut next);
        self.set(next);
    }

    pub fn tab_move(&mut self, tab: &WorkspaceTab, target_index: usize) {
        let mut next = (*self.snapshot).clone();
        let Some(from) = next.tabs.iter().position(|item| item == tab) else {
            return;
        };
        let value = next.tabs.remove(from);
        let target = target_index.min(next.tabs.len());
        next.tabs.insert(target, value);
        self.set(next);
    }

    pub fn group_draft_update(&mut self, text: impl Into<Arc<str>>) {
        let mut text = text.into().to_string();
        if text.len() > DRAFT_BYTE_LIMIT {
            let mut boundary = DRAFT_BYTE_LIMIT;
            while !text.is_char_boundary(boundary) {
                boundary -= 1;
            }
            text.truncate(boundary);
        }
        let mut next = (*self.snapshot).clone();
        next.group_draft = Arc::from(text);
        self.set(next);
    }

    pub fn session_create(&mut self, id: ClientConversationId, mutation: MutationId) -> bool {
        if self.snapshot.behavior == WorkspaceBehavior::BotSingleChat
            || matches!(
                self.snapshot.session_create,
                AsyncActionState::Pending { .. }
            )
        {
            return false;
        }
        let mut next = (*self.snapshot).clone();
        let id = next.session_create_id.clone().unwrap_or(id);
        next.session_create_id = Some(id.clone());
        next.session_create = AsyncActionState::Pending {
            mutation: mutation.clone(),
        };
        let workspace = next.workspace.clone();
        self.set(next);
        (self.output)(WorkspaceOutput::SessionCreateRequested {
            workspace,
            id,
            mutation,
        });
        true
    }

    pub fn session_create_succeeded(&mut self) {
        let mut next = (*self.snapshot).clone();
        next.session_create = AsyncActionState::Idle;
        next.session_create_id = None;
        self.set(next);
    }

    pub fn session_create_failed(&mut self, message: impl Into<Arc<str>>) {
        let mut next = (*self.snapshot).clone();
        next.session_create = AsyncActionState::Failed {
            message: message.into(),
        };
        self.set(next);
    }

    pub fn conversation_archive(
        &mut self,
        conversation: &ConversationKey,
        mutation: MutationId,
    ) -> bool {
        if self.snapshot.behavior == WorkspaceBehavior::BotSingleChat
            || !self.snapshot.conversations.contains_key(conversation)
        {
            return false;
        }
        self.archive_action(conversation, mutation, SessionArchiveOperation::Archive)
    }

    pub fn conversation_restore(
        &mut self,
        conversation: &ConversationKey,
        mutation: MutationId,
    ) -> bool {
        if !self.snapshot.conversations.contains_key(conversation) {
            return false;
        }
        self.archive_action(conversation, mutation, SessionArchiveOperation::Restore)
    }

    pub fn conversation_archive_succeeded(&mut self, conversation: &ConversationKey) {
        let mut next = (*self.snapshot).clone();
        next.session_archive.remove(conversation);
        // Keep the override until a catalog snapshot acknowledges it. This
        // prevents an older reconnect response from flashing the row back.
        self.set(next);
    }

    pub fn conversation_archive_failed(
        &mut self,
        conversation: &ConversationKey,
        message: impl Into<Arc<str>>,
    ) {
        let Some(operation) = self.archive_overrides.remove(conversation) else {
            return;
        };
        let mut next = (*self.snapshot).clone();
        next.session_archive.insert(
            conversation.clone(),
            SessionArchiveState {
                operation,
                state: AsyncActionState::Failed {
                    message: message.into(),
                },
            },
        );
        reconcile_membership(&mut next, &self.archive_overrides);
        self.set(next);
    }

    pub fn transcript_anchor_update(
        &mut self,
        conversation: &ConversationKey,
        anchor: Option<ScrollAnchor>,
        following: bool,
    ) {
        if !self.snapshot.conversations.contains_key(conversation) {
            return;
        }
        let mut next = (*self.snapshot).clone();
        let memory = next.transcripts.entry(conversation.clone()).or_default();
        memory.anchor = anchor;
        memory.following = following;
        self.set(next);
    }

    pub fn transcript_row_expansion_update(
        &mut self,
        conversation: &ConversationKey,
        row: TranscriptRowId,
        expanded: bool,
    ) {
        if !self.snapshot.conversations.contains_key(conversation) {
            return;
        }
        let mut next = (*self.snapshot).clone();
        let rows = &mut next
            .transcripts
            .entry(conversation.clone())
            .or_default()
            .expanded_rows;
        if expanded {
            if rows.len() >= ENTRY_LIMIT {
                rows.pop_first();
            }
            rows.insert(row);
        } else {
            rows.remove(&row);
        }
        self.set(next);
    }

    pub fn take_persistence_error(&mut self) -> Option<Arc<str>> {
        self.persistence_error.take()
    }

    fn archive_action(
        &mut self,
        conversation: &ConversationKey,
        mutation: MutationId,
        operation: SessionArchiveOperation,
    ) -> bool {
        if self
            .snapshot
            .session_archive
            .get(conversation)
            .is_some_and(|value| matches!(value.state, AsyncActionState::Pending { .. }))
        {
            return false;
        }
        self.archive_overrides
            .insert(conversation.clone(), operation);
        let mut next = (*self.snapshot).clone();
        next.session_archive.insert(
            conversation.clone(),
            SessionArchiveState {
                operation,
                state: AsyncActionState::Pending {
                    mutation: mutation.clone(),
                },
            },
        );
        reconcile_membership(&mut next, &self.archive_overrides);
        self.set(next);
        let event = match operation {
            SessionArchiveOperation::Archive => WorkspaceOutput::SessionArchiveRequested {
                conversation: conversation.clone(),
                mutation,
            },
            SessionArchiveOperation::Restore => WorkspaceOutput::SessionRestoreRequested {
                conversation: conversation.clone(),
                mutation,
            },
        };
        (self.output)(event);
        true
    }

    fn set(&mut self, mut next: WorkspaceSnapshot) {
        bound(&mut next);
        repair(&mut next);
        if next == *self.snapshot {
            return;
        }
        self.snapshot = Arc::new(next);
        (self.output)(WorkspaceOutput::PersistenceRequested {
            snapshot: self.snapshot.clone(),
        });
    }
}

fn apply_restored(snapshot: &mut WorkspaceSnapshot, restored: RestoredWorkspace) {
    snapshot.behavior = restored.behavior;
    snapshot.tabs = restored.tabs;
    snapshot.active_tab = restored.active_tab;
    snapshot.file_tab_presentations = restored.file_tab_presentations;
    snapshot.ephemeral_file_tab = restored.ephemeral_file_tab;
    snapshot.tools = restored.tools;
    snapshot.inspector = restored.inspector;
    snapshot.activation_history = restored.activation_history;
    snapshot.archived_recents = restored.archived_recents;
    snapshot.group_draft = restored.group_draft;
    snapshot.session_create_id = restored.session_create_id;
    snapshot.transcripts = restored.transcripts;
}

fn reconcile_membership(
    snapshot: &mut WorkspaceSnapshot,
    overrides: &BTreeMap<ConversationKey, SessionArchiveOperation>,
) {
    let is_active = |key: &ConversationKey| {
        let Some(row) = snapshot.conversations.get(key) else {
            return false;
        };
        match overrides.get(key) {
            Some(SessionArchiveOperation::Archive) => false,
            Some(SessionArchiveOperation::Restore) => true,
            None => row.lifecycle.is_active(),
        }
    };

    let mut active: Vec<_> = snapshot
        .conversations
        .keys()
        .filter(|key| is_active(key))
        .cloned()
        .collect();
    active.sort_by(|a, b| {
        let a_row = &snapshot.conversations[a];
        let b_row = &snapshot.conversations[b];
        (&a_row.order_key, &a_row.key).cmp(&(&b_row.order_key, &b_row.key))
    });
    if snapshot.behavior == WorkspaceBehavior::BotSingleChat && active.len() > 1 {
        active.sort_by_key(|key| snapshot.conversations[key].updated_at);
        active.drain(..active.len() - 1);
    }
    let active_set: BTreeSet<_> = active.iter().cloned().collect();
    snapshot.tabs.retain(|tab| match tab {
        WorkspaceTab::Conversation(key) => active_set.contains(key),
        WorkspaceTab::File(_) | WorkspaceTab::Tool(_) => true,
    });
    for key in active {
        let tab = WorkspaceTab::Conversation(key);
        if !snapshot.tabs.contains(&tab) {
            snapshot.tabs.push(tab);
        }
    }

    let mut archived: Vec<_> = snapshot
        .conversations
        .keys()
        .filter(|key| !is_active(key))
        .cloned()
        .collect();
    archived.sort_by_key(|key| std::cmp::Reverse(snapshot.conversations[key].updated_at));
    archived.truncate(RECENT_SESSION_LIMIT);
    snapshot.archived_recents = archived;
    snapshot
        .transcripts
        .retain(|key, _| snapshot.conversations.contains_key(key));
    repair(snapshot);
}

fn activate(snapshot: &mut WorkspaceSnapshot, tab: WorkspaceTab) {
    snapshot.activation_history.retain(|item| item != &tab);
    snapshot.activation_history.push(tab.clone());
    snapshot.active_tab = Some(tab);
}

fn repair(snapshot: &mut WorkspaceSnapshot) {
    snapshot.tabs.retain(|tab| match tab {
        WorkspaceTab::Tool(key) => snapshot
            .tools
            .get(key)
            .is_some_and(|tool| tool.placement == ToolPlacement::Main),
        WorkspaceTab::Conversation(_) | WorkspaceTab::File(_) => true,
    });
    snapshot.inspector.tool_order.retain(|key| {
        snapshot
            .tools
            .get(key)
            .is_some_and(|tool| tool.placement == ToolPlacement::Inspector)
    });
    dedup(&mut snapshot.inspector.tool_order);
    for (key, tool) in &snapshot.tools {
        match tool.placement {
            ToolPlacement::Main => {
                let tab = WorkspaceTab::Tool(key.clone());
                if !snapshot.tabs.contains(&tab) {
                    snapshot.tabs.push(tab);
                }
            }
            ToolPlacement::Inspector if !snapshot.inspector.tool_order.contains(key) => {
                snapshot.inspector.tool_order.push(key.clone());
            }
            ToolPlacement::Inspector => {}
        }
    }
    if let InspectorSelection::LiveTool(key) = &snapshot.inspector.selection {
        if !snapshot
            .tools
            .get(key)
            .is_some_and(|tool| tool.placement == ToolPlacement::Inspector)
        {
            snapshot.inspector.selection = InspectorSelection::Files;
        }
    }
    if !snapshot.inspector.width_px.is_finite() {
        snapshot.inspector.width_px = DEFAULT_INSPECTOR_WIDTH_PX;
    }
    snapshot.inspector.width_px = snapshot
        .inspector
        .width_px
        .clamp(MIN_INSPECTOR_WIDTH_PX, MAX_INSPECTOR_WIDTH_PX);
    let valid: BTreeSet<_> = snapshot.tabs.iter().cloned().collect();
    snapshot
        .activation_history
        .retain(|tab| valid.contains(tab));
    dedup(&mut snapshot.tabs);
    dedup(&mut snapshot.activation_history);
    if snapshot
        .active_tab
        .as_ref()
        .is_none_or(|tab| !snapshot.tabs.contains(tab))
    {
        snapshot.active_tab = snapshot
            .activation_history
            .iter()
            .rev()
            .find(|tab| snapshot.tabs.contains(tab))
            .cloned()
            .or_else(|| snapshot.tabs.first().cloned());
    }
    if let Some(active) = snapshot.active_tab.clone() {
        snapshot.activation_history.retain(|tab| tab != &active);
        snapshot.activation_history.push(active);
    }
}

fn tab_is_known(snapshot: &WorkspaceSnapshot, tab: &WorkspaceTab) -> bool {
    match tab {
        WorkspaceTab::Conversation(key) => snapshot
            .conversations
            .get(key)
            .is_some_and(|row| row.lifecycle.is_active()),
        WorkspaceTab::File(_) => true,
        WorkspaceTab::Tool(key) => snapshot.tools.contains_key(key),
    }
}

fn bound(snapshot: &mut WorkspaceSnapshot) {
    if snapshot.tools.len() > TOOL_LIMIT {
        let mut keep = Vec::new();
        keep.extend(snapshot.tabs.iter().filter_map(|tab| match tab {
            WorkspaceTab::Tool(key) => Some(key.clone()),
            _ => None,
        }));
        keep.extend(snapshot.inspector.tool_order.iter().cloned());
        dedup(&mut keep);
        keep.truncate(TOOL_LIMIT);
        let keep: BTreeSet<_> = keep.into_iter().collect();
        snapshot.tools.retain(|key, _| keep.contains(key));
    }
    trim_front(&mut snapshot.tabs, ENTRY_LIMIT);
    let retained_files: BTreeSet<_> = snapshot
        .tabs
        .iter()
        .filter_map(|tab| match tab {
            WorkspaceTab::File(key) => Some(key.clone()),
            WorkspaceTab::Conversation(_) | WorkspaceTab::Tool(_) => None,
        })
        .collect();
    snapshot
        .file_tab_presentations
        .retain(|key, _| retained_files.contains(key));
    if snapshot
        .ephemeral_file_tab
        .as_ref()
        .is_some_and(|key| !retained_files.contains(key))
    {
        snapshot.ephemeral_file_tab = None;
    }
    trim_front(&mut snapshot.activation_history, ENTRY_LIMIT);
    snapshot.archived_recents.truncate(RECENT_SESSION_LIMIT);
    while snapshot.transcripts.len() > ENTRY_LIMIT {
        snapshot.transcripts.pop_first();
    }
    for memory in snapshot.transcripts.values_mut() {
        while memory.expanded_rows.len() > ENTRY_LIMIT {
            memory.expanded_rows.pop_first();
        }
    }
}

fn trim_front<T>(values: &mut Vec<T>, limit: usize) {
    if values.len() > limit {
        values.drain(..values.len() - limit);
    }
}

fn dedup<T: Ord + Clone>(values: &mut Vec<T>) {
    let mut seen = BTreeSet::new();
    values.retain(|value| seen.insert(value.clone()));
}
