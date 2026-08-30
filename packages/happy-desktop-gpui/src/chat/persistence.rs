use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::connectivity::{AgentNamespace, ConversationKey, WorkspaceKey};

use super::workspace::{
    ClientConversationId, DEFAULT_INSPECTOR_WIDTH_PX, DRAFT_BYTE_LIMIT, ENTRY_LIMIT, FileTabKey,
    FileTabPresentation, InspectorSelection, InspectorSnapshot, RECENT_SESSION_LIMIT, ScrollAnchor,
    TOOL_LIMIT, ToolCreateState, ToolKind, ToolMetadata, ToolPlacement, ToolTabKey,
    TranscriptMemory, TranscriptRowId, WorkspaceBehavior, WorkspaceSnapshot, WorkspaceTab,
    admit_browser_url,
};

const DOCUMENT_VERSION: u32 = 1;
const DOCUMENT_BYTE_LIMIT: u64 = 8 * 1024 * 1024;

/// Private, per-Happy-Agent persistence for workspace UI memory.
///
/// The namespace is both embedded in the document and hashed into its file
/// name. Writes use a sibling temporary file, file `fsync`, atomic rename, and
/// directory `fsync`, so readers observe either complete version. A single
/// controller-created worker coalesces queued snapshots per workspace and keeps
/// serialization and fsync off the GPUI thread.
#[derive(Clone, Debug)]
pub struct WorkspacePersistence {
    namespace: AgentNamespace,
    path: PathBuf,
    latest_writes: Arc<Mutex<BTreeMap<WorkspaceKey, (u64, Arc<WorkspaceSnapshot>)>>>,
    write_sequence: Arc<AtomicU64>,
    write_wake: mpsc::SyncSender<()>,
    event_wake: async_channel::Sender<()>,
    events: WorkspacePersistenceEvents,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WorkspacePersistenceEvent {
    Saved {
        workspace: WorkspaceKey,
    },
    Failed {
        workspace: WorkspaceKey,
        message: Arc<str>,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspacePersistenceEvents {
    latest: Arc<Mutex<Option<WorkspacePersistenceEvent>>>,
    wake: async_channel::Receiver<()>,
}

impl WorkspacePersistenceEvents {
    pub(crate) async fn recv(&self) -> Result<WorkspacePersistenceEvent, async_channel::RecvError> {
        loop {
            self.wake.recv().await?;
            if let Some(event) = self
                .latest
                .lock()
                .expect("workspace persistence event state is not poisoned")
                .take()
            {
                return Ok(event);
            }
        }
    }
}

fn publish_persistence_event(
    latest: &Arc<Mutex<Option<WorkspacePersistenceEvent>>>,
    event: WorkspacePersistenceEvent,
) {
    let mut pending = latest
        .lock()
        .expect("workspace persistence event state is not poisoned");
    let preserve_failure = matches!(
        (&*pending, &event),
        (
            Some(WorkspacePersistenceEvent::Failed { workspace: failed, .. }),
            WorkspacePersistenceEvent::Saved { workspace: saved },
        ) if failed != saved
    );
    if !preserve_failure {
        *pending = Some(event);
    }
}

impl WorkspacePersistence {
    pub fn open(root: impl AsRef<Path>, namespace: &AgentNamespace) -> io::Result<Self> {
        let root = root.as_ref();
        fs::create_dir_all(root)?;
        set_private_directory(root)?;
        let digest = Sha256::digest(namespace.as_str().as_bytes());
        let file_name = format!("workspace-memory-{:x}.json", digest);
        let path = root.join(file_name);
        let worker_namespace = namespace.clone();
        let worker_path = path.clone();
        let latest_writes = Arc::new(Mutex::new(BTreeMap::<
            WorkspaceKey,
            (u64, Arc<WorkspaceSnapshot>),
        >::new()));
        let worker_writes = latest_writes.clone();
        let write_sequence = Arc::new(AtomicU64::new(0));
        let (write_wake, receiver) = mpsc::sync_channel::<()>(1);
        let (event_wake_sender, event_wake) = async_channel::bounded(1);
        let worker_event_wake = event_wake_sender.clone();
        let latest_event = Arc::new(Mutex::new(None));
        let worker_event = latest_event.clone();
        thread::Builder::new()
            .name("happy-workspace-persistence".into())
            .spawn(move || {
                let mut failed_workspaces = std::collections::BTreeSet::new();
                while receiver.recv().is_ok() {
                    let batch = std::mem::take(
                        &mut *worker_writes
                            .lock()
                            .expect("workspace persistence writes are not poisoned"),
                    );
                    for (_, snapshot) in batch.into_values() {
                        let event = match write_snapshot(&worker_namespace, &worker_path, &snapshot)
                        {
                            Ok(()) => {
                                failed_workspaces.remove(&snapshot.workspace);
                                failed_workspaces
                                    .is_empty()
                                    .then_some(WorkspacePersistenceEvent::Saved {
                                        workspace: snapshot.workspace.clone(),
                                    })
                            }
                            Err(_) => {
                                failed_workspaces.insert(snapshot.workspace.clone());
                                Some(WorkspacePersistenceEvent::Failed {
                                    workspace: snapshot.workspace.clone(),
                                    message: Arc::from(
                                        "Workspace history and drafts could not be saved. Check Application Support permissions.",
                                    ),
                                })
                            }
                        };
                        if let Some(event) = event {
                            publish_persistence_event(&worker_event, event);
                            let _ = worker_event_wake.try_send(());
                        }
                    }
                }
            })?;
        Ok(Self {
            namespace: namespace.clone(),
            path,
            latest_writes,
            write_sequence,
            write_wake,
            event_wake: event_wake_sender,
            events: WorkspacePersistenceEvents {
                latest: latest_event,
                wake: event_wake,
            },
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn event_receiver(&self) -> WorkspacePersistenceEvents {
        self.events.clone()
    }

    pub(crate) fn read(&self, workspace: &WorkspaceKey) -> io::Result<RestoredWorkspace> {
        if workspace.namespace() != &self.namespace {
            return Ok(RestoredWorkspace::default());
        }
        let document = self.read_document()?;
        let Some(record) = document
            .workspaces
            .into_iter()
            .find(|record| record.workspace_id == workspace.id())
        else {
            return Ok(RestoredWorkspace::default());
        };
        Ok(record.restore(&self.namespace))
    }

    pub(crate) fn write_async(&self, snapshot: Arc<WorkspaceSnapshot>) -> io::Result<()> {
        if snapshot.namespace != self.namespace || snapshot.workspace.namespace() != &self.namespace
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "workspace memory namespace mismatch",
            ));
        }
        let mut latest = self
            .latest_writes
            .lock()
            .map_err(|_| io::Error::other("workspace persistence state is unavailable"))?;
        let mut sequence = self.write_sequence.fetch_add(1, Ordering::Relaxed);
        if sequence == u64::MAX {
            let mut ordered: Vec<_> = latest
                .iter()
                .map(|(workspace, (sequence, _))| (workspace.clone(), *sequence))
                .collect();
            ordered.sort_by_key(|(workspace, sequence)| (*sequence, workspace.clone()));
            for (next, (workspace, _)) in ordered.into_iter().enumerate() {
                if let Some((value, _)) = latest.get_mut(&workspace) {
                    *value = next as u64;
                }
            }
            sequence = latest.len() as u64;
            self.write_sequence
                .store(sequence.saturating_add(1), Ordering::Relaxed);
        }
        let mut dropped = None;
        if latest.len() >= ENTRY_LIMIT && !latest.contains_key(&snapshot.workspace) {
            if let Some(oldest) = latest
                .iter()
                .min_by_key(|(_, (touched_at, _))| *touched_at)
                .map(|(workspace, _)| workspace.clone())
            {
                latest.remove(&oldest);
                dropped = Some(oldest);
            }
        }
        latest.insert(snapshot.workspace.clone(), (sequence, snapshot));
        drop(latest);
        if let Some(workspace) = dropped {
            publish_persistence_event(
                &self.events.latest,
                WorkspacePersistenceEvent::Failed {
                    workspace,
                    message: Arc::from(
                        "A queued workspace update could not be saved because the persistence queue is full.",
                    ),
                },
            );
            let _ = self.event_wake.try_send(());
        }
        match self.write_wake.try_send(()) {
            Ok(()) | Err(mpsc::TrySendError::Full(())) => Ok(()),
            Err(mpsc::TrySendError::Disconnected(())) => Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "workspace persistence worker stopped",
            )),
        }
    }

    fn read_document(&self) -> io::Result<StoredDocument> {
        read_document_at(&self.namespace, &self.path)
    }
}

fn write_snapshot(
    namespace: &AgentNamespace,
    path: &Path,
    snapshot: &WorkspaceSnapshot,
) -> io::Result<()> {
    if snapshot.namespace != *namespace || snapshot.workspace.namespace() != namespace {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace memory namespace mismatch",
        ));
    }
    let persistence_document = read_document_at(namespace, path)?;
    let mut document = persistence_document;
    document.namespace = namespace.as_str().to_owned();
    document
        .workspaces
        .retain(|record| record.workspace_id != snapshot.workspace.id());
    document
        .workspaces
        .push(StoredWorkspace::from_snapshot(snapshot));
    document.workspaces.sort_by_key(|record| record.touched_at);
    if document.workspaces.len() > ENTRY_LIMIT {
        document
            .workspaces
            .drain(..document.workspaces.len() - ENTRY_LIMIT);
    }
    for workspace in &mut document.workspaces {
        workspace.tools.retain_mut(|tool| {
            let Some(url) = sanitize_persisted_browser_url(&tool.url) else {
                return false;
            };
            tool.url = url.to_string();
            true
        });
    }
    let bytes = serde_json::to_vec(&document).map_err(io::Error::other)?;
    if bytes.len() as u64 > DOCUMENT_BYTE_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "workspace memory exceeds its durable size bound",
        ));
    }
    atomic_write(path, &bytes)
}

fn read_document_at(namespace: &AgentNamespace, path: &Path) -> io::Result<StoredDocument> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(StoredDocument::empty(namespace));
        }
        Err(error) => return Err(error),
    };
    if metadata.len() > DOCUMENT_BYTE_LIMIT {
        return Ok(StoredDocument::empty(namespace));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(DOCUMENT_BYTE_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > DOCUMENT_BYTE_LIMIT {
        return Ok(StoredDocument::empty(namespace));
    }
    let Ok(mut document) = serde_json::from_slice::<StoredDocument>(&bytes) else {
        return Ok(StoredDocument::empty(namespace));
    };
    if document.version != DOCUMENT_VERSION || document.namespace != namespace.as_str() {
        return Ok(StoredDocument::empty(namespace));
    }
    document.workspaces.truncate(ENTRY_LIMIT);
    Ok(document)
}

#[derive(Default)]
pub(crate) struct RestoredWorkspace {
    pub behavior: WorkspaceBehavior,
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab: Option<WorkspaceTab>,
    pub file_tab_presentations: BTreeMap<FileTabKey, FileTabPresentation>,
    pub ephemeral_file_tab: Option<FileTabKey>,
    pub tools: BTreeMap<ToolTabKey, ToolMetadata>,
    pub inspector: InspectorSnapshot,
    pub activation_history: Vec<WorkspaceTab>,
    pub archived_recents: Vec<ConversationKey>,
    pub group_draft: Arc<str>,
    pub session_create_id: Option<ClientConversationId>,
    pub transcripts: BTreeMap<ConversationKey, TranscriptMemory>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredDocument {
    version: u32,
    namespace: String,
    workspaces: Vec<StoredWorkspace>,
}

impl StoredDocument {
    fn empty(namespace: &AgentNamespace) -> Self {
        Self {
            version: DOCUMENT_VERSION,
            namespace: namespace.as_str().to_owned(),
            workspaces: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredWorkspace {
    workspace_id: String,
    touched_at: u128,
    behavior: StoredBehavior,
    tabs: Vec<StoredTab>,
    active_tab: Option<StoredTab>,
    activation_history: Vec<StoredTab>,
    archived_recents: Vec<String>,
    group_draft: String,
    #[serde(default)]
    session_create_id: Option<String>,
    transcripts: Vec<StoredTranscript>,
    #[serde(default)]
    tools: Vec<StoredTool>,
    #[serde(default)]
    inspector: StoredInspector,
}

impl StoredWorkspace {
    fn from_snapshot(snapshot: &WorkspaceSnapshot) -> Self {
        Self {
            workspace_id: snapshot.workspace.id().to_owned(),
            touched_at: now_nanos(),
            behavior: StoredBehavior::from(snapshot.behavior),
            tabs: snapshot
                .tabs
                .iter()
                .filter_map(|tab| StoredTab::from_snapshot_tab(snapshot, tab))
                .collect(),
            active_tab: snapshot
                .active_tab
                .as_ref()
                .and_then(|tab| StoredTab::from_snapshot_tab(snapshot, tab)),
            activation_history: snapshot
                .activation_history
                .iter()
                .filter_map(|tab| StoredTab::from_snapshot_tab(snapshot, tab))
                .collect(),
            archived_recents: snapshot
                .archived_recents
                .iter()
                .map(|key| key.id().to_owned())
                .collect(),
            group_draft: snapshot.group_draft.to_string(),
            session_create_id: snapshot
                .session_create_id
                .as_ref()
                .map(|id| id.as_str().to_owned()),
            transcripts: snapshot
                .transcripts
                .iter()
                .map(|(key, memory)| StoredTranscript::from_memory(key, memory))
                .collect(),
            tools: snapshot
                .tools
                .iter()
                .filter_map(StoredTool::from_metadata)
                .collect(),
            inspector: StoredInspector::from_snapshot(snapshot),
        }
    }

    fn restore(self, namespace: &AgentNamespace) -> RestoredWorkspace {
        let restore_tab = |tab: StoredTab| tab.restore(namespace);
        let mut draft = self.group_draft;
        truncate_utf8(&mut draft, DRAFT_BYTE_LIMIT);
        let mut transcripts = BTreeMap::new();
        for value in self.transcripts.into_iter().take(ENTRY_LIMIT) {
            if let Some((key, memory)) = value.restore(namespace) {
                transcripts.insert(key, memory);
            }
        }
        let mut file_tab_presentations = BTreeMap::new();
        let mut ephemeral_file_tab = None;
        for tab in &self.tabs {
            if let StoredTab::File {
                file_id,
                presentation,
                preview,
            } = tab
            {
                if let Some(key) = FileTabKey::new(file_id) {
                    file_tab_presentations.insert(key.clone(), presentation.restore());
                    if *preview {
                        ephemeral_file_tab = Some(key);
                    }
                }
            }
        }
        let mut tools = BTreeMap::new();
        for stored in self.tools.into_iter().take(TOOL_LIMIT) {
            if let Some((key, metadata)) = stored.restore(namespace) {
                tools.insert(key, metadata);
            }
        }
        let inspector = self.inspector.restore(&tools);
        RestoredWorkspace {
            behavior: self.behavior.restore(),
            tabs: self
                .tabs
                .into_iter()
                .take(ENTRY_LIMIT)
                .filter_map(restore_tab)
                .collect(),
            active_tab: self.active_tab.and_then(restore_tab),
            file_tab_presentations,
            ephemeral_file_tab,
            tools,
            inspector,
            activation_history: self
                .activation_history
                .into_iter()
                .take(ENTRY_LIMIT)
                .filter_map(restore_tab)
                .collect(),
            archived_recents: self
                .archived_recents
                .into_iter()
                .take(RECENT_SESSION_LIMIT)
                .filter(|id| !id.is_empty())
                .map(|id| ConversationKey::new(namespace.clone(), id))
                .collect(),
            group_draft: Arc::from(draft),
            session_create_id: self.session_create_id.and_then(ClientConversationId::new),
            transcripts,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StoredBehavior {
    Standard,
    BotSingleChat,
}

impl From<WorkspaceBehavior> for StoredBehavior {
    fn from(value: WorkspaceBehavior) -> Self {
        match value {
            WorkspaceBehavior::Standard => Self::Standard,
            WorkspaceBehavior::BotSingleChat => Self::BotSingleChat,
        }
    }
}

impl StoredBehavior {
    fn restore(self) -> WorkspaceBehavior {
        match self {
            Self::Standard => WorkspaceBehavior::Standard,
            Self::BotSingleChat => WorkspaceBehavior::BotSingleChat,
        }
    }
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StoredFilePresentation {
    #[default]
    File,
    Diff,
}
impl StoredFilePresentation {
    fn restore(self) -> FileTabPresentation {
        match self {
            Self::File => FileTabPresentation::File,
            Self::Diff => FileTabPresentation::Diff,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum StoredTab {
    Conversation {
        conversation_id: String,
    },
    File {
        file_id: String,
        #[serde(default)]
        presentation: StoredFilePresentation,
        #[serde(default)]
        preview: bool,
    },
    Tool {
        tool_id: String,
    },
}
impl StoredTab {
    fn from_snapshot_tab(snapshot: &WorkspaceSnapshot, value: &WorkspaceTab) -> Option<Self> {
        match value {
            WorkspaceTab::Conversation(key) => Some(Self::Conversation {
                conversation_id: key.id().to_owned(),
            }),
            WorkspaceTab::File(key) => {
                let presentation = match snapshot
                    .file_tab_presentations
                    .get(key)
                    .copied()
                    .unwrap_or_default()
                {
                    FileTabPresentation::File => StoredFilePresentation::File,
                    FileTabPresentation::Diff => StoredFilePresentation::Diff,
                };
                Some(Self::File {
                    file_id: key.as_str().to_owned(),
                    presentation,
                    preview: snapshot.ephemeral_file_tab.as_ref() == Some(key),
                })
            }
            WorkspaceTab::Tool(key) => snapshot.tools.get(key).and_then(|tool| {
                matches!(&tool.kind, ToolKind::Browser { .. }).then(|| Self::Tool {
                    tool_id: key.as_str().to_owned(),
                })
            }),
        }
    }
    fn restore(self, namespace: &AgentNamespace) -> Option<WorkspaceTab> {
        match self {
            Self::Conversation { conversation_id } if !conversation_id.is_empty() => {
                Some(WorkspaceTab::Conversation(ConversationKey::new(
                    namespace.clone(),
                    conversation_id,
                )))
            }
            Self::File { file_id, .. } => FileTabKey::new(file_id).map(WorkspaceTab::File),
            Self::Tool { tool_id } => ToolTabKey::new(tool_id).map(WorkspaceTab::Tool),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTool {
    id: String,
    owner_conversation_id: String,
    label: String,
    placement: StoredToolPlacement,
    url: String,
    title: String,
}

fn sanitize_persisted_browser_url(value: &str) -> Option<Arc<str>> {
    let admitted = admit_browser_url(Arc::from(value))?;
    if admitted.as_ref() == "about:blank" {
        return Some(admitted);
    }
    let mut parsed = url::Url::parse(&admitted).ok()?;
    parsed.set_query(None);
    parsed.set_fragment(None);
    admit_browser_url(Arc::from(parsed.as_str()))
}

impl StoredTool {
    fn from_metadata((key, metadata): (&ToolTabKey, &ToolMetadata)) -> Option<Self> {
        let metadata = metadata.clone().admitted()?;
        let ToolKind::Browser { url, title } = &metadata.kind else {
            return None;
        };
        let url = sanitize_persisted_browser_url(url)?;
        Some(Self {
            id: key.as_str().to_owned(),
            owner_conversation_id: metadata.owning_conversation.id().to_owned(),
            label: metadata.label.to_string(),
            placement: metadata.placement.into(),
            url: url.to_string(),
            title: title.to_string(),
        })
    }

    fn restore(self, namespace: &AgentNamespace) -> Option<(ToolTabKey, ToolMetadata)> {
        let key = ToolTabKey::new(self.id)?;
        if self.owner_conversation_id.is_empty() {
            return None;
        }
        let url = sanitize_persisted_browser_url(&self.url)?;
        let metadata = ToolMetadata {
            owning_conversation: ConversationKey::new(
                namespace.clone(),
                self.owner_conversation_id,
            ),
            label: Arc::from(self.label),
            placement: self.placement.restore(),
            create_state: ToolCreateState::Creating,
            kind: ToolKind::Browser {
                url,
                title: Arc::from(self.title),
            },
        }
        .admitted()?;
        Some((key, metadata))
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StoredToolPlacement {
    Main,
    Inspector,
}

impl From<ToolPlacement> for StoredToolPlacement {
    fn from(value: ToolPlacement) -> Self {
        match value {
            ToolPlacement::Main => Self::Main,
            ToolPlacement::Inspector => Self::Inspector,
        }
    }
}

impl StoredToolPlacement {
    fn restore(self) -> ToolPlacement {
        match self {
            Self::Main => ToolPlacement::Main,
            Self::Inspector => ToolPlacement::Inspector,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredInspector {
    #[serde(default = "default_inspector_open")]
    open: bool,
    #[serde(default = "default_inspector_width")]
    width_px: f32,
    #[serde(default)]
    tool_order: Vec<String>,
    #[serde(default)]
    active_tool_id: Option<String>,
}

impl Default for StoredInspector {
    fn default() -> Self {
        Self {
            open: true,
            width_px: DEFAULT_INSPECTOR_WIDTH_PX,
            tool_order: Vec::new(),
            active_tool_id: None,
        }
    }
}

impl StoredInspector {
    fn from_snapshot(snapshot: &WorkspaceSnapshot) -> Self {
        Self {
            open: snapshot.inspector.open,
            width_px: snapshot.inspector.width_px,
            tool_order: snapshot
                .inspector
                .tool_order
                .iter()
                .filter(|key| {
                    matches!(
                        snapshot.tools.get(*key).map(|tool| &tool.kind),
                        Some(ToolKind::Browser { .. })
                    )
                })
                .map(|key| key.as_str().to_owned())
                .collect(),
            active_tool_id: match &snapshot.inspector.selection {
                InspectorSelection::LiveTool(key)
                    if matches!(
                        snapshot.tools.get(key).map(|tool| &tool.kind),
                        Some(ToolKind::Browser { .. })
                    ) =>
                {
                    Some(key.as_str().to_owned())
                }
                _ => None,
            },
        }
    }

    fn restore(self, tools: &BTreeMap<ToolTabKey, ToolMetadata>) -> InspectorSnapshot {
        let mut tool_order: Vec<_> = self
            .tool_order
            .into_iter()
            .take(TOOL_LIMIT)
            .filter_map(ToolTabKey::new)
            .filter(|key| {
                tools
                    .get(key)
                    .is_some_and(|tool| tool.placement == ToolPlacement::Inspector)
            })
            .collect();
        for (key, tool) in tools {
            if tool.placement == ToolPlacement::Inspector && !tool_order.contains(key) {
                tool_order.push(key.clone());
            }
        }
        let selection = self
            .active_tool_id
            .and_then(ToolTabKey::new)
            .filter(|key| tool_order.contains(key))
            .map(InspectorSelection::LiveTool)
            .unwrap_or(InspectorSelection::Files);
        InspectorSnapshot {
            open: self.open,
            selection,
            tool_order,
            width_px: if self.width_px.is_finite() {
                self.width_px
            } else {
                DEFAULT_INSPECTOR_WIDTH_PX
            },
        }
    }
}

fn default_inspector_open() -> bool {
    true
}

fn default_inspector_width() -> f32 {
    DEFAULT_INSPECTOR_WIDTH_PX
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredTranscript {
    conversation_id: String,
    anchor: Option<StoredAnchor>,
    following: bool,
    expanded_rows: Vec<String>,
}

impl StoredTranscript {
    fn from_memory(key: &ConversationKey, value: &TranscriptMemory) -> Self {
        Self {
            conversation_id: key.id().to_owned(),
            anchor: value.anchor.as_ref().map(|anchor| StoredAnchor {
                row_id: anchor.row.as_str().to_owned(),
                offset_px: anchor.offset_px,
            }),
            following: value.following,
            expanded_rows: value
                .expanded_rows
                .iter()
                .map(|row| row.as_str().to_owned())
                .collect(),
        }
    }

    fn restore(self, namespace: &AgentNamespace) -> Option<(ConversationKey, TranscriptMemory)> {
        if self.conversation_id.is_empty() {
            return None;
        }
        let anchor = self.anchor.and_then(|anchor| {
            Some(ScrollAnchor {
                row: TranscriptRowId::new(anchor.row_id)?,
                offset_px: anchor.offset_px,
            })
        });
        let expanded_rows = self
            .expanded_rows
            .into_iter()
            .take(ENTRY_LIMIT)
            .filter_map(TranscriptRowId::new)
            .collect();
        Some((
            ConversationKey::new(namespace.clone(), self.conversation_id),
            TranscriptMemory {
                anchor,
                following: self.following,
                expanded_rows,
            },
        ))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredAnchor {
    row_id: String,
    offset_px: f32,
}

fn truncate_utf8(value: &mut String, limit: usize) {
    if value.len() <= limit {
        return;
    }
    let mut boundary = limit;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
}

fn set_private_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    set_private_directory(parent)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace-memory");
    let temporary = parent.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        now_nanos()
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
