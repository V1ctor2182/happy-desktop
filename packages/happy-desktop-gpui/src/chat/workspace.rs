use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use crate::connectivity::{
    AgentCatalogSnapshot, AgentNamespace, CatalogLifecycleState, ConversationCatalogRow,
    ConversationKey, WorkspaceKey,
};

use super::persistence::{RestoredWorkspace, WorkspacePersistence};

pub(crate) const ENTRY_LIMIT: usize = 1_000;
pub(crate) const RECENT_SESSION_LIMIT: usize = 200;
pub(crate) const DRAFT_BYTE_LIMIT: usize = 100_000;

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

opaque_id!(FileTabKey);
opaque_id!(ToolTabKey);
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

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceSnapshot {
    pub namespace: AgentNamespace,
    pub workspace: WorkspaceKey,
    pub behavior: WorkspaceBehavior,
    /// Client-owned mixed ordering. Catalog order is used only when an
    /// authoritative conversation is first discovered.
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab: Option<WorkspaceTab>,
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
        let restored = persistence.read(&workspace).unwrap_or_default();
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
        if !next.tabs.contains(&tab) {
            next.tabs.push(tab.clone());
        }
        activate(&mut next, tab);
        self.set(next);
    }

    pub fn tab_activate(&mut self, tab: &WorkspaceTab) {
        let mut next = (*self.snapshot).clone();
        if !next.tabs.contains(tab) {
            return;
        }
        activate(&mut next, tab.clone());
        self.set(next);
    }

    pub fn tab_close(&mut self, tab: &WorkspaceTab) {
        let mut next = (*self.snapshot).clone();
        next.tabs.retain(|item| item != tab);
        next.activation_history.retain(|item| item != tab);
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
        WorkspaceTab::File(_) | WorkspaceTab::Tool(_) => true,
    }
}

fn bound(snapshot: &mut WorkspaceSnapshot) {
    trim_front(&mut snapshot.tabs, ENTRY_LIMIT);
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
